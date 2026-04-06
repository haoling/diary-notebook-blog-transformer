import { DriveClient } from "./drive-client";
import { DriveNotFoundError } from "./drive-errors";
import type { Settings } from "@/types/settings";

const SETTINGS_FILE_NAME = "settings.json";

/**
 * appDataFolder 上の settings.json を管理するクラス。
 *
 * - load() でファイルを読み込み（不在時はデフォルト値で作成）、インメモリにキャッシュ
 * - 変異メソッドはインメモリ状態を変更し即座に永続化
 * - version カウンターによる並行書き込み検知（last-write-wins）
 */
export class SettingsManager {
  private readonly client: DriveClient;
  private settings: Settings | null = null;
  private _fileId: string | null = null;
  private _version: number = 0;

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
      return this.settings;
    } catch (err) {
      if (err instanceof DriveNotFoundError) {
        const defaults: Settings = { version: 1 };
        const file = await this.client.createAppDataFile(
          SETTINGS_FILE_NAME,
          defaults,
        );
        this._fileId = file.id;
        this.settings = defaults;
        this._version = 1;
        return this.settings;
      }
      throw err;
    }
  }

  /** インメモリ状態を appDataFolder に永続化する。version をインクリメントする。 */
  private async persist(): Promise<void> {
    if (!this.settings) {
      throw new Error("SettingsManager: load() を先に呼び出してください。");
    }
    this._version++;
    const data: Settings = { ...this.settings, version: this._version };

    if (this._fileId) {
      await this.client.updateFileContent(this._fileId, data);
    } else {
      const file = await this.client.createAppDataFile(SETTINGS_FILE_NAME, data);
      this._fileId = file.id;
    }
  }

  /** 設定全体を取得する。 */
  getAll(): Settings {
    if (!this.settings) {
      throw new Error("SettingsManager: load() を先に呼び出してください。");
    }
    return this.settings;
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
  async update(partial: Partial<Settings>): Promise<void> {
    if (!this.settings) {
      throw new Error("SettingsManager: load() を先に呼び出してください。");
    }
    this.settings = { ...this.settings, ...partial };
    await this.persist();
  }
}
