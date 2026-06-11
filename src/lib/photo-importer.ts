import { DriveClient } from "./drive-client";
import { IndexManager } from "./index-manager";
import type { PhotoObject } from "@/types/photo";
import type { PhotoSourceType } from "@/types/settings";

const PHOTO_FILE_PREFIX = "photo_";

function photoFileName(id: string): string {
  return `${PHOTO_FILE_PREFIX}${id}.json`;
}

/** Google Photos API のメディアアイテム（必要フィールドのみ）。 */
export type GooglePhotosMediaItem = {
  id: string;
  filename: string;
  mediaMetadata: {
    creationTime?: string;
    width?: string;
    height?: string;
    photo?: Record<string, unknown>;
  };
  baseUrl: string;
};

/** Google Photos 検索オプション。 */
export type GooglePhotosSearchOptions = {
  /** 絞り込む開始日（ISO 8601 形式）。 */
  startDate?: string;
  /** 絞り込む終了日（ISO 8601 形式）。 */
  endDate?: string;
  /** 1ページあたりの件数（最大 100）。 */
  pageSize?: number;
  pageToken?: string;
};

export type GooglePhotosSearchResult = {
  mediaItems: GooglePhotosMediaItem[];
  nextPageToken?: string;
};

/** Google Drive の画像ファイル検索結果。 */
export type DriveImageFile = {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  createdTime?: string;
  modifiedTime?: string;
};

export type DriveImageSearchResult = {
  files: DriveImageFile[];
  nextPageToken?: string;
};

const PHOTOS_API_BASE = "https://photoslibrary.googleapis.com/v1";

/**
 * Google Photos / Google Drive から写真を検索し、
 * PhotoObject として appDataFolder に保存するクラス。
 */
export class PhotoImporter {
  private readonly client: DriveClient;
  private readonly indexManager: IndexManager;
  private readonly accessToken: string;

  constructor(
    client: DriveClient,
    indexManager: IndexManager,
    accessToken: string,
  ) {
    this.client = client;
    this.indexManager = indexManager;
    this.accessToken = accessToken;
  }

  // ------------------------------------------------------------------
  // Google Photos 検索
  // ------------------------------------------------------------------

  /** Google Photos からメディアアイテムを検索する。 */
  async searchGooglePhotos(
    options: GooglePhotosSearchOptions = {},
  ): Promise<GooglePhotosSearchResult> {
    const { startDate, endDate, pageSize = 50, pageToken } = options;

    const filters: Record<string, unknown> = {};

    if (startDate || endDate) {
      const parseDate = (iso: string) => {
        const d = new Date(iso);
        return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
      };
      filters.dateFilter = {
        ranges: [
          {
            ...(startDate ? { startDate: parseDate(startDate) } : {}),
            ...(endDate ? { endDate: parseDate(endDate) } : {}),
          },
        ],
      };
    }

    const body: Record<string, unknown> = {
      pageSize,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(`${PHOTOS_API_BASE}/mediaItems:search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        `Google Photos API error ${res.status}: ${JSON.stringify(err)}`,
      );
    }

    const data = await res.json();
    return {
      mediaItems: data.mediaItems ?? [],
      nextPageToken: data.nextPageToken,
    };
  }

  // ------------------------------------------------------------------
  // Google Drive 画像検索
  // ------------------------------------------------------------------

  /** Google Drive から画像ファイルを検索する。 */
  async searchDriveImages(options: {
    keyword?: string;
    pageSize?: number;
    pageToken?: string;
  } = {}): Promise<DriveImageSearchResult> {
    const { keyword, pageSize = 50, pageToken } = options;

    const mimeFilter =
      "(mimeType contains 'image/') and trashed = false";
    const keywordFilter = keyword
      ? ` and name contains '${keyword.replace(/'/g, "\\'")}'`
      : "";
    const query = encodeURIComponent(mimeFilter + keywordFilter);

    const pageParam = pageToken
      ? `&pageToken=${encodeURIComponent(pageToken)}`
      : "";

    const fields = encodeURIComponent(
      "nextPageToken,files(id,name,mimeType,thumbnailLink,createdTime,modifiedTime)",
    );

    const url =
      `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive` +
      `&fields=${fields}&pageSize=${pageSize}&orderBy=createdTime+desc${pageParam}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        `Drive API error ${res.status}: ${JSON.stringify(err)}`,
      );
    }

    const data = await res.json();
    return {
      files: data.files ?? [],
      nextPageToken: data.nextPageToken,
    };
  }

  // ------------------------------------------------------------------
  // 写真インポート
  // ------------------------------------------------------------------

  /** Google Photos のメディアアイテムを PhotoObject として保存する。 */
  async importFromGooglePhotos(
    item: GooglePhotosMediaItem,
  ): Promise<PhotoObject> {
    const id = crypto.randomUUID();
    const importedAt = new Date().toISOString();

    const photo: PhotoObject = {
      id,
      importedAt,
      sourceType: "google_photos" as PhotoSourceType,
      sourceRef: item.id,
      title: item.filename,
      takenAt: item.mediaMetadata.creationTime,
    };

    await this.client.createAppDataFile(photoFileName(id), photo);
    await this.indexManager.addPhoto({ id, importedAt, sourceType: "google_photos" });

    return photo;
  }

  /** Google Drive の画像ファイルを PhotoObject として保存する。 */
  async importFromGoogleDrive(file: DriveImageFile): Promise<PhotoObject> {
    const id = crypto.randomUUID();
    const importedAt = new Date().toISOString();

    const photo: PhotoObject = {
      id,
      importedAt,
      sourceType: "google_drive" as PhotoSourceType,
      sourceRef: file.id,
      title: file.name,
      takenAt: file.createdTime,
    };

    await this.client.createAppDataFile(photoFileName(id), photo);
    await this.indexManager.addPhoto({ id, importedAt, sourceType: "google_drive" });

    return photo;
  }

  /** PhotoObject を appDataFolder から読み込む。 */
  async loadPhoto(id: string): Promise<PhotoObject> {
    return this.client.getAppDataFileByName<PhotoObject>(photoFileName(id)).then(
      ({ _fileId: _, _file: __, ...photo }) => photo as PhotoObject,
    );
  }

  /** PhotoObject を削除する（appDataFolder のファイルと index から）。 */
  async deletePhoto(id: string): Promise<void> {
    const file = await this.client
      .findAppDataFileByName(photoFileName(id))
      .catch(() => null);
    if (file) {
      await this.client.deleteFile(file.id);
    }
    await this.indexManager.removePhoto(id);
  }

  /** PhotoObject の cropRect などを更新して保存する。 */
  async updatePhoto(photo: PhotoObject): Promise<void> {
    const file = await this.client.findAppDataFileByName(photoFileName(photo.id));
    await this.client.updateFileContent(file.id, photo);
  }

  /**
   * Google Photos のベース URL からサムネイル URL を生成する。
   * baseUrl に `=w<width>-h<height>` を付与するとリサイズされた画像が得られる。
   */
  static getThumbnailUrl(
    baseUrl: string,
    width = 256,
    height = 256,
  ): string {
    return `${baseUrl}=w${width}-h${height}`;
  }
}
