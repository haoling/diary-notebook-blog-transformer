import { DriveClient } from "./drive-client";
import { DriveNotFoundError } from "./drive-errors";
import { IndexManager } from "./index-manager";
import type { PhotoObject } from "@/types/photo";
import type { PhotoSourceType } from "@/types/settings";

const PHOTO_FILE_PREFIX = "photo_";

function photoFileName(id: string): string {
  return `${PHOTO_FILE_PREFIX}${id}.json`;
}

/** Drive クエリ文字列値をエスケープする（`\` と `'`）。 */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * ISO 8601 の日付文字列（YYYY-MM-DD または YYYY-MM-DDTHH:mm:ssZ）を
 * タイムゾーン非依存で year/month/day オブジェクトに変換する。
 * 形式が不正な場合はエラーをスローする。
 */
function parseIsoDateToYMD(iso: string): { year: number; month: number; day: number } {
  const datePart = iso.split("T")[0];
  const parts = datePart.split("-");
  if (parts.length !== 3) {
    throw new Error(`日付の形式が正しくありません: "${iso}"（YYYY-MM-DD 形式で入力してください）。`);
  }
  const [year, month, day] = parts.map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) ||
      month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`日付の値が不正です: "${iso}"（月は 1〜12、日は 1〜31 の範囲で指定してください）。`);
  }
  // Date.UTC で実在日付かどうかを検証（例: 2026-02-31 は 3 月に繰り越される）
  const utc = Date.UTC(year, month - 1, day);
  const d = new Date(utc);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) {
    throw new Error(`存在しない日付です: "${iso}"（${month} 月に ${day} 日はありません）。`);
  }
  return { year, month, day };
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
  /** 絞り込む開始日（YYYY-MM-DD または ISO 8601 形式）。 */
  startDate?: string;
  /** 絞り込む終了日（YYYY-MM-DD または ISO 8601 形式）。 */
  endDate?: string;
  /** ファイル名部分一致フィルタ（クライアントサイドで適用）。 */
  keyword?: string;
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
 *
 * IndexManager は初回操作時に自動で load() される。
 */
export class PhotoImporter {
  private readonly client: DriveClient;
  private readonly indexManager: IndexManager;
  private readonly accessToken: string;
  private indexLoaded = false;
  private indexLoadPromise: Promise<void> | null = null;

  constructor(
    client: DriveClient,
    indexManager: IndexManager,
    accessToken: string,
  ) {
    this.client = client;
    this.indexManager = indexManager;
    this.accessToken = accessToken;
  }

  /** IndexManager が未ロードなら load() を呼ぶ。並行呼び出しでも load() は1回だけ実行される。 */
  private ensureIndexLoaded(): Promise<void> {
    if (this.indexLoaded) return Promise.resolve();
    if (!this.indexLoadPromise) {
      this.indexLoadPromise = this.indexManager.load().then(() => {
        this.indexLoaded = true;
      });
    }
    return this.indexLoadPromise;
  }

  // ------------------------------------------------------------------
  // Google Photos 検索
  // ------------------------------------------------------------------

  /** Google Photos からメディアアイテムを検索する。 */
  async searchGooglePhotos(
    options: GooglePhotosSearchOptions = {},
  ): Promise<GooglePhotosSearchResult> {
    const { startDate, endDate, keyword, pageSize = 50, pageToken } = options;

    const filters: Record<string, unknown> = {
      // 動画を除外して写真のみ返す
      mediaTypeFilter: { mediaTypes: ["PHOTO"] },
    };

    if (startDate || endDate) {
      // Google Photos の dateFilter.ranges は startDate/endDate の両方が必須。
      // 片方のみ指定の場合は同じ日付を補完する。start > end の場合は入れ替えて正規化。
      let start = parseIsoDateToYMD(startDate ?? endDate!);
      let end = parseIsoDateToYMD(endDate ?? startDate!);
      // 年月日を比較して start <= end になるよう正規化
      const startTs = start.year * 10000 + start.month * 100 + start.day;
      const endTs = end.year * 10000 + end.month * 100 + end.day;
      if (startTs > endTs) {
        [start, end] = [end, start];
      }
      filters.dateFilter = {
        ranges: [{ startDate: start, endDate: end }],
      };
    }

    const body: Record<string, unknown> = {
      // Google Photos API の pageSize は 1..100 の範囲に制限
      pageSize: Math.min(100, Math.max(1, pageSize)),
      filters,
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
    let mediaItems: GooglePhotosMediaItem[] = data.mediaItems ?? [];

    // Google Photos API にファイル名検索がないため、クライアント側でフィルタする
    if (keyword) {
      const lower = keyword.toLowerCase();
      mediaItems = mediaItems.filter((item) =>
        item.filename.toLowerCase().includes(lower),
      );
    }

    return {
      mediaItems,
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
      ? ` and name contains '${escapeDriveQueryValue(keyword)}'`
      : "";
    const query = encodeURIComponent(mimeFilter + keywordFilter);

    const pageParam = pageToken
      ? `&pageToken=${encodeURIComponent(pageToken)}`
      : "";

    const fields = encodeURIComponent(
      "nextPageToken,files(id,name,mimeType,thumbnailLink,createdTime,modifiedTime)",
    );

    // Drive API の pageSize は 1..1000 の範囲に制限
    const clampedPageSize = Number.isFinite(pageSize)
      ? Math.min(1000, Math.max(1, pageSize))
      : 50;

    const url =
      `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive` +
      `&fields=${fields}&pageSize=${clampedPageSize}&orderBy=createdTime+desc${pageParam}`;

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
    await this.ensureIndexLoaded();

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

    const created = await this.client.createAppDataFile(photoFileName(id), photo);
    try {
      await this.indexManager.addPhoto({ id, importedAt, sourceType: "google_photos" });
    } catch (err) {
      // index 登録に失敗した場合、作成済みファイルをロールバック削除する
      await this.client.deleteFile(created.id).catch(() => {});
      throw err;
    }

    return photo;
  }

  /** Google Drive の画像ファイルを PhotoObject として保存する。 */
  async importFromGoogleDrive(file: DriveImageFile): Promise<PhotoObject> {
    await this.ensureIndexLoaded();

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

    const created = await this.client.createAppDataFile(photoFileName(id), photo);
    try {
      await this.indexManager.addPhoto({ id, importedAt, sourceType: "google_drive" });
    } catch (err) {
      await this.client.deleteFile(created.id).catch(() => {});
      throw err;
    }

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
    await this.ensureIndexLoaded();

    let file = null;
    try {
      file = await this.client.findAppDataFileByName(photoFileName(id));
    } catch (err) {
      // ファイルが存在しない場合のみ null 扱い。その他のエラーは再スロー
      if (!(err instanceof DriveNotFoundError)) throw err;
    }
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

  /**
   * Drive の thumbnailLink を Authorization ヘッダ付きで取得して Blob を返す。
   * Drive サムネイルはサードパーティ Cookie 制限下で img src に直接使えないことがあるため。
   * Blob URL が必要な場合は呼び出し側で URL.createObjectURL() し、
   * 不要になったら URL.revokeObjectURL() を呼んでください。
   */
  async fetchDriveThumbnailBlob(thumbnailLink: string): Promise<Blob> {
    const res = await fetch(thumbnailLink, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error(`thumbnail fetch failed: ${res.status}`);
    return res.blob();
  }
}
