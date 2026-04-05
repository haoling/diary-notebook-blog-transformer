import { parseDriveError, DriveError, DriveNotFoundError } from "./drive-errors";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

/** Drive API v3 のファイルメタデータ（本モジュールで使用するフィールドのみ）。 */
export type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  parents?: string[];
  kind: string;
};

/** DriveClient のコンストラクタオプション。 */
export type DriveClientOptions = {
  accessToken: string;
};

/**
 * Google Drive API v3 をラップするクライアント。
 *
 * - appDataFolder への JSON ファイル CRUD
 * - 可視フォルダへの画像アップロード・取得
 * - フォルダの作成・検索・存在確認
 *
 * アクセストークンは AuthProvider から取得してコンストラクタに渡す。
 */
export class DriveClient {
  private readonly token: string;

  constructor({ accessToken }: DriveClientOptions) {
    this.token = accessToken;
  }

  // ------------------------------------------------------------------
  // 内部ヘルパー
  // ------------------------------------------------------------------

  /** デフォルトヘッダを生成し、init.headers で上書き可能にする。 */
  private buildHeaders(init?: RequestInit): Headers {
    const headers = new Headers({
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    });
    if (init?.headers) {
      const extra = new Headers(init.headers);
      extra.forEach((value, key) => headers.set(key, value));
    }
    return headers;
  }

  /** レスポンスを検査し、エラーなら適切な DriveError をスローする。 */
  private async assertOk(res: Response): Promise<void> {
    if (res.ok) return;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    throw parseDriveError(res.status, body);
  }

  private async apiFetch<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const url = `${DRIVE_API_BASE}${path}`;
    const headers = this.buildHeaders(init);
    const res = await fetch(url, { ...init, headers });
    await this.assertOk(res);

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private async apiFetchRaw(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const url = `${DRIVE_API_BASE}${path}`;
    const headers = this.buildHeaders(init);
    const res = await fetch(url, { ...init, headers });
    await this.assertOk(res);
    return res;
  }

  /** 指定した URL に Bearer 付きでリクエストを送り、レスポンスを返す。 */
  private async authFetch(url: string, init?: RequestInit): Promise<Response> {
    const headers = this.buildHeaders(init);
    const res = await fetch(url, { ...init, headers });
    await this.assertOk(res);
    return res;
  }

  // ------------------------------------------------------------------
  // appDataFolder CRUD
  // ------------------------------------------------------------------

  /** appDataFolder に JSON ファイルを作成する。 */
  async createAppDataFile<T>(
    name: string,
    data: T,
  ): Promise<DriveFile> {
    const metadata = {
      name,
      parents: ["appDataFolder"],
    };

    const boundary = "drive_boundary_" + Date.now();
    const jsonPart = JSON.stringify(metadata);
    const dataPart = JSON.stringify(data);

    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      jsonPart,
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      dataPart,
      `--${boundary}--`,
    ].join("\r\n");

    const url = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    await this.assertOk(res);
    return res.json() as Promise<DriveFile>;
  }

  /** appDataFolder のファイルを名前で検索して取得する。 */
  async getAppDataFileByName<T extends Record<string, unknown>>(name: string): Promise<T & { _fileId: string; _file: DriveFile }> {
    const query = encodeURIComponent(
      `'appDataFolder' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`,
    );
    const list = await this.apiFetch<{
      files: DriveFile[];
    }>(`/files?q=${query}&spaces=appDataFolder&fields=files(id,name,kind)`);

    if (!list.files || list.files.length === 0) {
      throw new DriveNotFoundError(
        `appDataFolder に '${name}' が見つかりません。`,
      );
    }

    const file = list.files[0];
    const content = await this.getFileContent<T>(file.id);
    return { ...content, _fileId: file.id, _file: file };
  }

  /** appDataFolder 内のファイル一覧を全件取得する。 */
  async listAppDataFiles(): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let nextPageToken: string | undefined;

    do {
      const pageQuery = nextPageToken
        ? `&pageToken=${encodeURIComponent(nextPageToken)}`
        : "";
      const q = encodeURIComponent("trashed = false");
      const result = await this.apiFetch<{
        files?: DriveFile[];
        nextPageToken?: string;
      }>(
        `/files?q=${q}&spaces=appDataFolder&fields=files(id,name,kind),nextPageToken&pageSize=100${pageQuery}`,
      );
      files.push(...(result.files ?? []));
      nextPageToken = result.nextPageToken;
    } while (nextPageToken);

    return files;
  }

  // ------------------------------------------------------------------
  // ファイルの読み書き（汎用）
  // ------------------------------------------------------------------

  /** ファイルのメタデータを取得する。 */
  async getFileInfo(fileId: string): Promise<DriveFile> {
    return this.apiFetch<DriveFile>(
      `/files/${fileId}?fields=id,name,mimeType,parents,kind`,
    );
  }

  /** ファイルの内容を JSON として取得する。 */
  async getFileContent<T>(fileId: string): Promise<T> {
    const url = `${DRIVE_API_BASE}/files/${fileId}?alt=media`;
    const res = await this.authFetch(url);
    return res.json() as Promise<T>;
  }

  /** ファイルの内容（バイナリ）を Blob として取得する。 */
  async getFileBlob(fileId: string): Promise<Blob> {
    const url = `${DRIVE_API_BASE}/files/${fileId}?alt=media`;
    const res = await this.authFetch(url);
    return res.blob();
  }

  /** ファイルの内容を更新する（JSON）。 */
  async updateFileContent<T>(
    fileId: string,
    data: T,
  ): Promise<DriveFile> {
    const boundary = "drive_boundary_" + Date.now();
    const metadata = JSON.stringify({});
    const dataPart = JSON.stringify(data);

    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      metadata,
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      dataPart,
      `--${boundary}--`,
    ].join("\r\n");

    const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    await this.assertOk(res);
    return res.json() as Promise<DriveFile>;
  }

  /** ファイルのメタデータ（名前など）を更新する。 */
  async updateFileMetadata(
    fileId: string,
    patch: { name?: string; addParents?: string; removeParents?: string },
  ): Promise<DriveFile> {
    const { name, addParents, removeParents } = patch;
    const params = new URLSearchParams();
    params.set("fields", "id,name,mimeType,parents,kind");

    if (addParents) params.set("addParents", addParents);
    if (removeParents) params.set("removeParents", removeParents);

    const metadata: { name?: string } = {};
    if (name !== undefined) metadata.name = name;

    return this.apiFetch<DriveFile>(
      `/files/${fileId}?${params.toString()}`,
      {
        method: "PATCH",
        body: JSON.stringify(metadata),
      },
    );
  }

  /** ファイルを削除する。 */
  async deleteFile(fileId: string): Promise<void> {
    await this.apiFetchRaw(`/files/${fileId}`, { method: "DELETE" });
  }

  /** ファイルが存在するか確認する。 */
  async fileExists(fileId: string): Promise<boolean> {
    try {
      await this.getFileInfo(fileId);
      return true;
    } catch (err: unknown) {
      if (err instanceof Error && "statusCode" in err && (err as DriveError).statusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------
  // 可視フォルダの画像アップロード
  // ------------------------------------------------------------------

  /** 指定フォルダに画像ファイルをアップロードする。 */
  async uploadImage(
    folderId: string,
    fileName: string,
    blob: Blob,
  ): Promise<DriveFile> {
    const metadata = {
      name: fileName,
      parents: [folderId],
    };
    const metadataJson = JSON.stringify(metadata);

    const boundary = "drive_boundary_" + Date.now();

    const encoder = new TextEncoder();
    const textParts: Uint8Array[] = [
      encoder.encode(`--${boundary}\r\n`),
      encoder.encode("Content-Type: application/json; charset=UTF-8\r\n\r\n"),
      encoder.encode(metadataJson),
      encoder.encode("\r\n"),
      encoder.encode(`--${boundary}\r\n`),
      encoder.encode(`Content-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`),
    ];

    const closing = encoder.encode(`\r\n--${boundary}--`);

    const fullBlob = new Blob(
      [...textParts, blob as BlobPart, closing] as BlobPart[],
      {
        type: `multipart/related; boundary=${boundary}`,
      },
    );

    const url = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,parents,kind`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
      body: fullBlob,
    });

    await this.assertOk(res);
    return res.json() as Promise<DriveFile>;
  }

  /** ファイルのダウンロード URL を取得する（webContentLink）。 */
  async getDownloadUrl(fileId: string): Promise<string> {
    const file = await this.apiFetch<{ webContentLink: string | null }>(
      `/files/${fileId}?fields=webContentLink`,
    );

    if (!file.webContentLink) {
      throw new DriveError(
        "このファイルのダウンロード URL を取得できません。",
        404,
      );
    }

    return file.webContentLink;
  }

  // ------------------------------------------------------------------
  // フォルダ管理
  // ------------------------------------------------------------------

  /** ルート（マイドライブ）にフォルダを作成する。 */
  async createFolder(name: string): Promise<DriveFile> {
    return this.apiFetch<DriveFile>("/files", {
      method: "POST",
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
      }),
    });
  }

  /** マイドライブ内から名前でフォルダを検索する。 */
  async findFolderByName(name: string): Promise<DriveFile | null> {
    const query = encodeURIComponent(
      `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    );
    const result = await this.apiFetch<{
      files: DriveFile[];
    }>(`/files?q=${query}&spaces=drive&fields=files(id,name,kind)`);

    if (!result.files || result.files.length === 0) {
      return null;
    }

    return result.files[0];
  }

  /** フォルダを作成または既存フォルダを取得する。 */
  async findOrCreateFolder(name: string): Promise<DriveFile> {
    const existing = await this.findFolderByName(name);
    if (existing) return existing;
    return this.createFolder(name);
  }

  /** 指定フォルダ内のファイル一覧を全件取得する。 */
  async listFilesInFolder(folderId: string): Promise<DriveFile[]> {
    const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const files: DriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const pageParam = pageToken
        ? `&pageToken=${encodeURIComponent(pageToken)}`
        : "";
      const result = await this.apiFetch<{
        files: DriveFile[];
        nextPageToken?: string;
      }>(
        `/files?q=${query}&fields=nextPageToken,files(id,name,mimeType,kind)&pageSize=100${pageParam}`,
      );
      files.push(...(result.files ?? []));
      pageToken = result.nextPageToken;
    } while (pageToken);

    return files;
  }
}

// ------------------------------------------------------------------
// ファクトリヘルパー
// ------------------------------------------------------------------

/** useAuth() の accessToken から DriveClient を生成するヘルパー。 */
export function createDriveClient(accessToken: string): DriveClient {
  return new DriveClient({ accessToken });
}
