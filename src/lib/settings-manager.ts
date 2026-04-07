import { DriveClient } from "./drive-client";
import { DriveNotFoundError } from "./drive-errors";
import type { Settings } from "@/types/settings";

const SETTINGS_FILE_NAME = "settings.json";

/**
 * appDataFolder 上の settings.json を管理するクラス。
 *
 * - load() でファイルを読み込み（不在時はデフォルト値で作成）、インメモリにキャッシュ
 * - 変異メソッドはインメモリ状態を変更し即座に永続化
 * - version カウンターをインクリメントして書き込み（ファイル消失時は新規作成にフォールバック）
 */
export class SettingsManager {
  private readonly client: DriveClient;
  private settings: Settings | null = null;
  private _fileId: string | null = null;
  private _version: number = 0;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(client: DriveClient) {
    this.client = client;
  }

  /** settings.json を読み込む。不在時はデフォルト値で新規作成する。 */
  async load(): Promise<Settings> {
    try {
      const result = await this.client.getAppDataFileByName<Settings>(
        SETTINGS_FILE_NAME,
      );
      this._fileId = result._fileId;
      const { _fileId: _, _file: __, version, ...rest } = result;
      this.settings = rest;
      this._version = version ?? 0;
      return { ...this.settings, version: this._version };
    } catch (err) {
      if (err instanceof DriveNotFoundError) {
        const defaults: Settings = {};
        const file = await this.client.createAppDataFile(
          SETTINGS_FILE_NAME,
          { ...defaults, version: 1 },
        );
        this._fileId = file.id;
        this.settings = defaults;
        this._version = 1;
        return { ...this.settings, version: this._version };
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
    if (!this.settings) {
      throw new Error("SettingsManager: load() を先に呼び出してください。");
    }

    const nextVersion = this._version + 1;
    const data: Settings = { ...this.settings, version: nextVersion };

    if (this._fileId) {
      try {
        await this.client.updateFileContent(this._fileId, data);
      } catch (err) {
        if (err instanceof DriveNotFoundError) {
          console.warn("SettingsManager: ファイルが見つかりません。新規作成します。");
          this._fileId = null;
          const file = await this.client.createAppDataFile(SETTINGS_FILE_NAME, data);
          this._fileId = file.id;
          this._version = nextVersion;
          return;
        }
        throw err;
      }
    } else {
      const file = await this.client.createAppDataFile(SETTINGS_FILE_NAME, data);
      this._fileId = file.id;
    }

    this._version = nextVersion;
  }

  /** 設定全体を取得する。 */
  getAll(): Settings {
    if (!this.settings) {
      throw new Error("SettingsManager: load() を先に呼び出してください。");
    }
    return { ...this.settings, version: this._version };
  }

  getVisionApiKey(): string | undefined {
    return this.settings?.visionApiKey;
  }

  async setVisionApiKey(key: string | undefined): Promise<void> {
    if (!this.settings) {
      throw new Error("SettingsManager: load() を先に呼び出してください。");
    }
    this.settings.visionApiKey = key;
    await this.persist();
  }

  getNotebookImageFolderId(): string | undefined {
    return this.settings?.notebookImageFolderId;
  }

  async setNotebookImageFolderId(id: string | undefined): Promise<void> {
    if (!this.settings) {
      throw new Error("SettingsManager: load() を先に呼び出してください。");
    }
    this.settings.notebookImageFolderId = id;
    await this.persist();
  }

  getNotebookImageFolderName(): string | undefined {
    return this.settings?.notebookImageFolderName;
  }

  async setNotebookImageFolderName(name: string | undefined): Promise<void> {
    if (!this.settings) {
      throw new Error("SettingsManager: load() を先に呼び出してください。");
    }
    this.settings.notebookImageFolderName = name;
    await this.persist();
  }

  /** 複数の設定項目を一度に更新して永続化する。 */
  async update(partial: Partial<Omit<Settings, "version">>): Promise<void> {
    if (!this.settings) {
      throw new Error("SettingsManager: load() を先に呼び出してください。");
    }
    this.settings = { ...this.settings, ...partial };
    await this.persist();
  }
}
