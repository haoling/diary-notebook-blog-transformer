import { DriveNotFoundError } from "@/lib/drive-errors";
import type { DriveClient, DriveFile } from "@/lib/drive-client";

/** テスト用のインメモリ DriveClient。appDataFolder と可視フォルダのファイルを Map で保持する。 */
export class FakeDriveClient {
  /** appDataFolder 上の JSON ファイル（ID → 内容）。 */
  readonly files = new Map<string, { name: string; data: unknown }>();
  /** 可視フォルダにアップロードされた画像（ID → ファイル名）。 */
  readonly images = new Map<string, { name: string; folderId: string }>();
  /** 呼び出し履歴（"メソッド名:引数" 形式）。 */
  readonly calls: string[] = [];
  private nextId = 1;

  /** 次回の指定メソッド呼び出しを失敗させる。 */
  private failures = new Map<string, Error>();

  failNext(method: string, error: Error): void {
    this.failures.set(method, error);
  }

  private maybeFail(method: string): void {
    const err = this.failures.get(method);
    if (err) {
      this.failures.delete(method);
      throw err;
    }
  }

  /** 名前が一致する appDataFolder ファイルの ID を探す。 */
  private idByName(name: string): string | undefined {
    for (const [id, f] of this.files) if (f.name === name) return id;
    return undefined;
  }

  /** 事前にファイルを配置する（テストのセットアップ用）。 */
  seed(name: string, data: unknown): string {
    const id = `f${this.nextId++}`;
    this.files.set(id, { name, data: structuredClone(data) });
    return id;
  }

  /** 名前でファイル内容を取得する（検証用）。 */
  read<T = unknown>(name: string): T | undefined {
    const id = this.idByName(name);
    return id ? (this.files.get(id)!.data as T) : undefined;
  }

  async createAppDataFile<T>(name: string, data: T): Promise<DriveFile> {
    this.calls.push(`createAppDataFile:${name}`);
    this.maybeFail("createAppDataFile");
    const id = this.seed(name, data);
    return { id, name, kind: "drive#file" };
  }

  async findAppDataFileByName(name: string): Promise<DriveFile> {
    this.calls.push(`findAppDataFileByName:${name}`);
    this.maybeFail("findAppDataFileByName");
    const id = this.idByName(name);
    if (!id) throw new DriveNotFoundError(`'${name}' が見つかりません。`);
    return { id, name, kind: "drive#file" };
  }

  async getAppDataFileByName<T extends Record<string, unknown>>(
    name: string,
  ): Promise<T & { _fileId: string; _file: DriveFile }> {
    this.calls.push(`getAppDataFileByName:${name}`);
    this.maybeFail("getAppDataFileByName");
    const file = await this.findAppDataFileByName(name);
    const content = structuredClone(this.files.get(file.id)!.data) as T;
    return { ...content, _fileId: file.id, _file: file };
  }

  async getFileContent<T>(fileId: string): Promise<T> {
    this.calls.push(`getFileContent:${fileId}`);
    this.maybeFail("getFileContent");
    const f = this.files.get(fileId);
    if (!f) throw new DriveNotFoundError();
    return structuredClone(f.data) as T;
  }

  async listAppDataFiles(): Promise<DriveFile[]> {
    this.calls.push("listAppDataFiles");
    return [...this.files].map(([id, f]) => ({ id, name: f.name, kind: "drive#file" }));
  }

  async updateFileContent<T>(fileId: string, data: T): Promise<DriveFile> {
    this.calls.push(`updateFileContent:${fileId}`);
    this.maybeFail("updateFileContent");
    const f = this.files.get(fileId);
    if (!f) throw new DriveNotFoundError();
    f.data = structuredClone(data);
    return { id: fileId, name: f.name, kind: "drive#file" };
  }

  async deleteFile(fileId: string): Promise<void> {
    this.calls.push(`deleteFile:${fileId}`);
    this.maybeFail("deleteFile");
    if (!this.files.delete(fileId) && !this.images.delete(fileId)) {
      throw new DriveNotFoundError();
    }
  }

  async uploadImage(folderId: string, fileName: string, _blob: Blob): Promise<DriveFile> {
    this.calls.push(`uploadImage:${fileName}`);
    this.maybeFail("uploadImage");
    const id = `img${this.nextId++}`;
    this.images.set(id, { name: fileName, folderId });
    return { id, name: fileName, kind: "drive#file" };
  }

  /** DriveClient として渡すためのキャスト。 */
  asClient(): DriveClient {
    return this as unknown as DriveClient;
  }
}
