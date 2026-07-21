import { DriveClient } from "./drive-client";
import { DriveNotFoundError } from "./drive-errors";
import { IndexManager } from "./index-manager";
import { deleteCachedPhotoThumbnail } from "./photo-cache";
import type { PhotoObject } from "@/types/photo";
import type { PhotoSourceType } from "@/types/settings";

const PHOTO_FILE_PREFIX = "photo_";

function photoFileName(id: string): string {
  return `${PHOTO_FILE_PREFIX}${id}.json`;
}

/** ファイル名から写真 ID を抽出する。 */
function parsePhotoFileName(name: string): string | null {
  if (!name.startsWith(PHOTO_FILE_PREFIX) || !name.endsWith(".json")) {
    return null;
  }
  return name.slice(PHOTO_FILE_PREFIX.length, -".json".length);
}

/** Drive クエリ文字列値をエスケープする（`\` と `'`）。 */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ------------------------------------------------------------------
// Google Photos Picker API 型定義
// ------------------------------------------------------------------

/** Picker API セッション。 */
export type PickerSession = {
  id: string;
  pickerUri: string;
  pollingConfig: {
    /** ポーリング間隔（例: "5s"）。 */
    pollInterval: string;
    /** タイムアウト（例: "300s"）。 */
    timeoutIn: string;
  };
  /** ユーザーが写真の選択を完了したら true になる。 */
  mediaItemsSet?: boolean;
  expireTime?: string;
};

/** Picker API メディアアイテム。 */
export type PickerMediaItem = {
  id: string;
  createTime?: string;
  type?: string;
  mediaFile: {
    baseUrl: string;
    mimeType: string;
    filename: string;
    mediaFileMetadata?: {
      width?: number;
      height?: number;
      photoMetadata?: Record<string, unknown>;
      videoMetadata?: Record<string, unknown>;
    };
  };
};

export type PickerMediaItemsResult = {
  mediaItems: PickerMediaItem[];
  nextPageToken?: string;
};

// ------------------------------------------------------------------
// Google Drive 画像検索型定義
// ------------------------------------------------------------------

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

const PICKER_API_BASE = "https://photospicker.googleapis.com/v1";

/**
 * Google Photos Picker API / Google Drive から写真を検索し、
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
  // Google Photos Picker API
  // ------------------------------------------------------------------

  /** Picker セッションを作成する。 */
  async createPickerSession(): Promise<PickerSession> {
    const res = await fetch(`${PICKER_API_BASE}/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Picker API error ${res.status}: ${JSON.stringify(err)}`);
    }
    return res.json() as Promise<PickerSession>;
  }

  /** Picker セッションの状態を取得する（ポーリング用）。 */
  async getPickerSession(sessionId: string): Promise<PickerSession> {
    const res = await fetch(`${PICKER_API_BASE}/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Picker API error ${res.status}: ${JSON.stringify(err)}`);
    }
    return res.json() as Promise<PickerSession>;
  }

  /** Picker セッションで選択されたメディアアイテムを取得する。 */
  async listPickerMediaItems(
    sessionId: string,
    pageToken?: string,
  ): Promise<PickerMediaItemsResult> {
    const params = new URLSearchParams({ sessionId });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${PICKER_API_BASE}/mediaItems?${params}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Picker API error ${res.status}: ${JSON.stringify(err)}`);
    }
    const data = await res.json();
    return {
      mediaItems: data.mediaItems ?? [],
      nextPageToken: data.nextPageToken,
    };
  }

  /** Picker セッションを削除する。 */
  async deletePickerSession(sessionId: string): Promise<void> {
    await fetch(`${PICKER_API_BASE}/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
  }

  /**
   * Picker セッションを経由せず、ID から直接メディアアイテムを取得する。
   * 既に取り込み済みの写真のサムネイルを、ピッカーセッション終了後に再表示する用途で使用する。
   */
  async getMediaItem(mediaItemId: string): Promise<PickerMediaItem> {
    const res = await fetch(`${PICKER_API_BASE}/mediaItems/${encodeURIComponent(mediaItemId)}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Picker API error ${res.status}: ${JSON.stringify(err)}`);
    }
    return res.json() as Promise<PickerMediaItem>;
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

  /** Google Photos Picker のメディアアイテムを PhotoObject として保存する。 */
  async importFromGooglePhotos(
    item: PickerMediaItem,
  ): Promise<PhotoObject> {
    await this.ensureIndexLoaded();

    const id = crypto.randomUUID();
    const importedAt = new Date().toISOString();

    const photo: PhotoObject = {
      id,
      importedAt,
      sourceType: "google_photos" as PhotoSourceType,
      sourceRef: item.id,
      title: item.mediaFile.filename,
      takenAt: item.createTime,
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

  /** appDataFolder 内の全 PhotoObject を一覧する（インポート日時の新しい順）。 */
  async listAllPhotos(): Promise<PhotoObject[]> {
    const files = await this.client.listAppDataFiles();
    const photoFiles = files.filter((f) => parsePhotoFileName(f.name) !== null);

    const photos: PhotoObject[] = [];
    for (const file of photoFiles) {
      try {
        const photo = await this.client.getFileContent<PhotoObject>(file.id);
        photos.push(photo);
      } catch (err) {
        console.warn(`写真の読み込みに失敗しました (${file.name}):`, err);
      }
    }

    photos.sort(
      (a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime(),
    );

    return photos;
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
    await deleteCachedPhotoThumbnail(id);
  }

  /** PhotoObject の cropRect などを更新して保存する。 */
  async updatePhoto(photo: PhotoObject): Promise<void> {
    const file = await this.client.findAppDataFileByName(photoFileName(photo.id));
    await this.client.updateFileContent(file.id, photo);
  }

  /**
   * Google Photos Picker の baseUrl からサムネイル URL を生成する。
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
