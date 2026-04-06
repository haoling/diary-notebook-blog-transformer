import { DriveClient } from "./drive-client";
import { DriveNotFoundError } from "./drive-errors";
import type {
  AppIndex,
  IndexSessionEntry,
  IndexPhotoEntry,
  IndexArticleEntry,
} from "@/types/settings";

const INDEX_FILE_NAME = "index.json";

const DEFAULT_INDEX: AppIndex = {
  sessions: [],
  photos: [],
  articles: [],
};

/**
 * appDataFolder 上の index.json を管理するクラス。
 *
 * - load() でファイルを読み込み（不在時はデフォルト値で作成）、インメモリにキャッシュ
 * - 変異メソッドはインメモリ状態を変更し即座に永続化
 * - version カウンターによる上書き検知（last-write-wins: 書き込み前に最新 version を取得し差分をログ出力）
 */
export class IndexManager {
  private readonly client: DriveClient;
  private index: AppIndex | null = null;
  private _fileId: string | null = null;
  private _version: number = 0;

  constructor(client: DriveClient) {
    this.client = client;
  }

  /** index.json を読み込む。不在時はデフォルト値で新規作成する。 */
  async load(): Promise<AppIndex> {
    try {
      const result = await this.client.getAppDataFileByName<AppIndex>(
        INDEX_FILE_NAME,
      );
      this._fileId = result._fileId;
      const { _fileId: _, _file: __, version, ...rest } = result;
      this.index = rest as AppIndex;
      this._version = version ?? 0;
      return this.index;
    } catch (err) {
      if (err instanceof DriveNotFoundError) {
        const newIndex = { ...DEFAULT_INDEX };
        const file = await this.client.createAppDataFile(
          INDEX_FILE_NAME,
          newIndex,
        );
        this._fileId = file.id;
        this.index = newIndex;
        this._version = 1;
        return this.index;
      }
      throw err;
    }
  }

  /** インメモリ状態を appDataFolder に永続化する。version をインクリメントする。 */
  private async persist(): Promise<void> {
    if (!this.index) {
      throw new Error("IndexManager: load() を先に呼び出してください。");
    }

    if (this._fileId) {
      const remote = await this.client.getFileContent<{ version?: number }>(
        this._fileId,
      );
      const remoteVersion = remote.version ?? 0;
      if (remoteVersion > this._version) {
        console.warn(
          `IndexManager: 並行書き込みを検知 (remote version=${remoteVersion}, local version=${this._version})。last-write-wins で上書きします。`,
        );
        this._version = remoteVersion;
      }
    }

    this._version++;
    const data = { ...this.index, sessions: [...this.index.sessions], photos: [...this.index.photos], articles: [...this.index.articles], version: this._version };

    if (this._fileId) {
      await this.client.updateFileContent(this._fileId, data);
    } else {
      const file = await this.client.createAppDataFile(INDEX_FILE_NAME, data);
      this._fileId = file.id;
    }
  }

  /** インデックス全体を取得する。 */
  getAll(): AppIndex {
    if (!this.index) {
      throw new Error("IndexManager: load() を先に呼び出してください。");
    }
    return { ...this.index, sessions: [...this.index.sessions], photos: [...this.index.photos], articles: [...this.index.articles] };
  }

  getSessions(): IndexSessionEntry[] {
    return [...(this.index?.sessions ?? [])];
  }

  getPhotos(): IndexPhotoEntry[] {
    return [...(this.index?.photos ?? [])];
  }

  getArticles(): IndexArticleEntry[] {
    return [...(this.index?.articles ?? [])];
  }

  /** セッションエントリを追加する。 */
  async addSession(entry: IndexSessionEntry): Promise<void> {
    if (!this.index) {
      throw new Error("IndexManager: load() を先に呼び出してください。");
    }
    this.index.sessions.push(entry);
    await this.persist();
  }

  /** セッションエントリを ID で削除する。 */
  async removeSession(id: string): Promise<void> {
    if (!this.index) {
      throw new Error("IndexManager: load() を先に呼び出してください。");
    }
    this.index.sessions = this.index.sessions.filter((s) => s.id !== id);
    await this.persist();
  }

  /** 写真エントリを追加する。 */
  async addPhoto(entry: IndexPhotoEntry): Promise<void> {
    if (!this.index) {
      throw new Error("IndexManager: load() を先に呼び出してください。");
    }
    this.index.photos.push(entry);
    await this.persist();
  }

  /** 写真エントリを ID で削除する。 */
  async removePhoto(id: string): Promise<void> {
    if (!this.index) {
      throw new Error("IndexManager: load() を先に呼び出してください。");
    }
    this.index.photos = this.index.photos.filter((p) => p.id !== id);
    await this.persist();
  }

  /** 記事エントリを追加する。 */
  async addArticle(entry: IndexArticleEntry): Promise<void> {
    if (!this.index) {
      throw new Error("IndexManager: load() を先に呼び出してください。");
    }
    this.index.articles.push(entry);
    await this.persist();
  }

  /** 記事エントリを ID で削除する。 */
  async removeArticle(id: string): Promise<void> {
    if (!this.index) {
      throw new Error("IndexManager: load() を先に呼び出してください。");
    }
    this.index.articles = this.index.articles.filter((a) => a.id !== id);
    await this.persist();
  }
}
