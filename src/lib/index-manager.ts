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
 * - version カウンターをインクリメントして書き込み（ファイル消失時は新規作成にフォールバック）
 */
export class IndexManager {
  private readonly client: DriveClient;
  private index: AppIndex | null = null;
  private _fileId: string | null = null;
  private _version: number = 0;
  private persistChain: Promise<void> = Promise.resolve();

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
      this.index = {
        sessions: Array.isArray(rest.sessions)
          ? rest.sessions.map((s) => ({ ...s, pageCount: s.pageCount ?? 0 }))
          : [...DEFAULT_INDEX.sessions],
        photos: Array.isArray(rest.photos) ? [...rest.photos] : [...DEFAULT_INDEX.photos],
        articles: Array.isArray(rest.articles) ? [...rest.articles] : [...DEFAULT_INDEX.articles],
      };
      this._version = version ?? 0;
      return this.cloneIndex();
    } catch (err) {
      if (err instanceof DriveNotFoundError) {
        const newIndex: AppIndex = {
          sessions: [...DEFAULT_INDEX.sessions],
          photos: [...DEFAULT_INDEX.photos],
          articles: [...DEFAULT_INDEX.articles],
        };
        const file = await this.client.createAppDataFile(
          INDEX_FILE_NAME,
          { ...newIndex, version: 1 },
        );
        this._fileId = file.id;
        this.index = newIndex;
        this._version = 1;
        return this.cloneIndex();
      }
      throw err;
    }
  }

  /**
   * インメモリ状態を appDataFolder に永続化する。version をインクリメントする。
   *
   * - last-write-wins 方針を採用しており、並行書き込み検知は行わない。
   * - version は書き込みのたびに単調増加するスタンプであり、競合検知用ではない。
   * - ファイルが消えていた場合のみ新規作成にフォールバックする。
   */
  private persist(): Promise<void> {
    const p = this.persistChain.then(() => this.doPersist());
    this.persistChain = p.catch(() => {});
    return p;
  }

  private async doPersist(): Promise<void> {
    if (!this.index) {
      throw new Error("IndexManager: load() を先に呼び出してください。");
    }

    const nextVersion = this._version + 1;
    const data = {
      ...this.index,
      sessions: this.cloneEntries(this.index.sessions),
      photos: this.cloneEntries(this.index.photos),
      articles: this.cloneEntries(this.index.articles),
      version: nextVersion,
    };

    if (this._fileId) {
      try {
        await this.client.updateFileContent(this._fileId, data);
      } catch (err) {
        if (err instanceof DriveNotFoundError) {
          console.warn("IndexManager: ファイルが見つかりません。新規作成します。");
          this._fileId = null;
          const file = await this.client.createAppDataFile(INDEX_FILE_NAME, data);
          this._fileId = file.id;
          this._version = nextVersion;
          return;
        }
        throw err;
      }
    } else {
      const file = await this.client.createAppDataFile(INDEX_FILE_NAME, data);
      this._fileId = file.id;
    }

    this._version = nextVersion;
  }

  private cloneEntries<T>(entries: T[]): T[] {
    if (typeof structuredClone === "function") {
      return structuredClone(entries);
    }
    return entries.map((e) => ({ ...e }));
  }

  private cloneIndex(): AppIndex {
    const idx = this.index!;
    return {
      sessions: this.cloneEntries(idx.sessions),
      photos: this.cloneEntries(idx.photos),
      articles: this.cloneEntries(idx.articles),
      version: this._version,
    };
  }

  /** インデックス全体を取得する。 */
  getAll(): AppIndex {
    if (!this.index) {
      throw new Error("IndexManager: load() を先に呼び出してください。");
    }
    return this.cloneIndex();
  }

  getSessions(): IndexSessionEntry[] {
    if (!this.index) {
      throw new Error("IndexManager: load() を先に呼び出してください。");
    }
    return this.cloneEntries(this.index.sessions);
  }

  getPhotos(): IndexPhotoEntry[] {
    if (!this.index) {
      throw new Error("IndexManager: load() を先に呼び出してください。");
    }
    return this.cloneEntries(this.index.photos);
  }

  getArticles(): IndexArticleEntry[] {
    if (!this.index) {
      throw new Error("IndexManager: load() を先に呼び出してください。");
    }
    return this.cloneEntries(this.index.articles);
  }

  /** セッションエントリを追加する。同一 ID が既存の場合は置換（upsert）。 */
  async addSession(entry: IndexSessionEntry): Promise<void> {
    if (!this.index) {
      throw new Error("IndexManager: load() を先に呼び出してください。");
    }
    this.index.sessions = this.index.sessions.filter((s) => s.id !== entry.id);
    this.index.sessions.push(...this.cloneEntries([entry]));
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
    this.index.photos.push(...this.cloneEntries([entry]));
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
    this.index.articles.push(...this.cloneEntries([entry]));
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
