import { DriveClient } from "./drive-client";
import { DriveNotFoundError } from "./drive-errors";
import { SettingsManager } from "./settings-manager";
import { IndexManager } from "./index-manager";
import type { ScanSession, ScanPage, CorrectionResult, SplitResult } from "@/types/scan";

const SESSION_FILE_PREFIX = "session_";

/** appDataFolder 内のセッションファイル名を生成する。 */
function sessionFileName(id: string): string {
  return `${SESSION_FILE_PREFIX}${id}.json`;
}

/** ファイル名からセッション ID を抽出する。 */
function parseSessionFileName(name: string): string | null {
  if (!name.startsWith(SESSION_FILE_PREFIX) || !name.endsWith(".json")) {
    return null;
  }
  return name.slice(SESSION_FILE_PREFIX.length, -".json".length);
}

/**
 * appDataFolder 上のスキャンセッションを管理するクラス。
 *
 * - セッションの作成・読み込み・保存・削除
 * - ページの追加（画像を Drive 可視フォルダにアップロード）
 * - ページの削除（画像を Drive から削除）
 * - IndexManager のセッションエントリを同期して更新
 */
export class SessionManager {
  private readonly client: DriveClient;
  private readonly settingsManager: SettingsManager;
  private readonly indexManager: IndexManager;
  private readonly sessionMutationChains = new Map<string, Promise<void>>();

  constructor(
    client: DriveClient,
    settingsManager: SettingsManager,
    indexManager: IndexManager,
  ) {
    this.client = client;
    this.settingsManager = settingsManager;
    this.indexManager = indexManager;
  }

  /** セッションID単位でミューテーションを直列化する。 */
  private async runSerialized(sessionId: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.sessionMutationChains.get(sessionId) ?? Promise.resolve();
    const next = prev.then(() => fn(), () => fn());
    this.sessionMutationChains.set(sessionId, next);
    await next;
    if (this.sessionMutationChains.get(sessionId) === next) {
      this.sessionMutationChains.delete(sessionId);
    }
  }

  /** 手帳画像フォルダ ID を取得する。未設定ならエラー。 */
  private getNotebookFolderId(): string {
    const id = this.settingsManager.getNotebookImageFolderId();
    if (!id) {
      throw new Error("手帳画像フォルダが設定されていません。設定ページからフォルダを選択してください。");
    }
    return id;
  }

  /** 新しい ID を生成する。 */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** セッションの appDataFolder ファイル ID を取得する。 */
  private async getSessionFileId(sessionId: string): Promise<string> {
    const fileName = sessionFileName(sessionId);
    const file = await this.client.findAppDataFileByName(fileName);
    return file.id;
  }

  /** セッションを読み込み、{ session, fileId } を返す（二重リクエストを回避）。 */
  private async loadSessionWithFileId(sessionId: string): Promise<{ session: ScanSession; fileId: string }> {
    const fileName = sessionFileName(sessionId);
    const result = await this.client.getAppDataFileByName<ScanSession>(fileName);
    const { _fileId, _file: _, ...session } = result;
    return { session, fileId: _fileId };
  }

  /** 新規セッションを作成する。 */
  async createSession(): Promise<ScanSession> {
    const session: ScanSession = {
      id: this.generateId(),
      createdAt: new Date().toISOString(),
      pages: [],
    };

    await this.saveSession(session);

    try {
      await this.indexManager.addSession({
        id: session.id,
        createdAt: session.createdAt,
        pageCount: 0,
      });
    } catch (indexErr) {
      try {
        const fileId = await this.getSessionFileId(session.id);
        await this.client.deleteFile(fileId);
      } catch (rollbackErr) {
        console.warn(
          `インデックス更新失敗後のセッションファイルロールバックに失敗しました:`,
          rollbackErr,
        );
      }
      throw indexErr;
    }

    return session;
  }

  /** セッションを読み込む。 */
  async loadSession(sessionId: string): Promise<ScanSession> {
    const { session } = await this.loadSessionWithFileId(sessionId);
    return session;
  }

  /** セッションを appDataFolder に保存する。 */
  async saveSession(session: ScanSession): Promise<void> {
    const fileName = sessionFileName(session.id);
    try {
      const fileId = await this.getSessionFileId(session.id);
      await this.client.updateFileContent(fileId, session);
    } catch (err) {
      if (err instanceof DriveNotFoundError) {
        await this.client.createAppDataFile(fileName, session);
        return;
      }
      throw err;
    }
  }

  /** セッションを保存し、インデックスのページ数を更新する。 */
  async saveSessionAndUpdateIndex(session: ScanSession): Promise<void> {
    await this.saveSession(session);
    await this.syncIndexEntry(session);
  }

  /** インデックスエントリをセッションの現在の状態と同期する。 */
  private async syncIndexEntry(session: ScanSession): Promise<void> {
    await this.indexManager.addSession({
      id: session.id,
      createdAt: session.createdAt,
      pageCount: session.pages.length,
    });
  }

  /** 画像を Drive 可視フォルダにアップロードし、ページとしてセッションに追加する。 */
  async addPage(
    sessionId: string,
    imageBlob: Blob,
    fileName: string,
  ): Promise<ScanPage> {
    let result: ScanPage | undefined;
    await this.runSerialized(sessionId, async () => {
      const { session } = await this.loadSessionWithFileId(sessionId);
      const folderId = this.getNotebookFolderId();

      const driveFile = await this.client.uploadImage(
        folderId,
        fileName,
        imageBlob,
      );

      const page: ScanPage = {
        id: this.generateId(),
        capturedAt: new Date().toISOString(),
        originalFileId: driveFile.id,
      };

      session.pages.push(page);

      try {
        await this.saveSession(session);
      } catch (err) {
        try {
          await this.client.deleteFile(driveFile.id);
        } catch (rollbackErr) {
          console.warn(
            `セッション保存失敗後のページ画像ロールバックに失敗しました (fileId: ${driveFile.id}):`,
            rollbackErr,
          );
        }
        throw err;
      }

      try {
        await this.syncIndexEntry(session);
      } catch (indexErr) {
        console.warn(
          `インデックス更新に失敗しました（セッションは正常に保存済みです）:`,
          indexErr,
        );
      }

      result = page;
    });
    return result!;
  }

  /** ページをセッションから削除し、対応する Drive 上の画像も削除する。 */
  async removePage(sessionId: string, pageId: string): Promise<void> {
    await this.runSerialized(sessionId, async () => {
      const { session } = await this.loadSessionWithFileId(sessionId);
      const page = session.pages.find((p) => p.id === pageId);
      if (!page) {
        throw new Error(`ページ ${pageId} がセッション ${sessionId} に見つかりません。`);
      }

      session.pages = session.pages.filter((p) => p.id !== pageId);

      await this.saveSessionAndUpdateIndex(session);

      try {
        await this.client.deleteFile(page.originalFileId);
      } catch (err) {
        console.warn(`ページ画像の削除に失敗しました (fileId: ${page.originalFileId}):`, err);
      }
    });
  }

  /** ページの補正結果を更新して保存する。 */
  async updatePageCorrection(sessionId: string, pageId: string, correction: CorrectionResult): Promise<void> {
    await this.runSerialized(sessionId, async () => {
      const { session } = await this.loadSessionWithFileId(sessionId);
      const page = session.pages.find((p) => p.id === pageId);
      if (!page) {
        throw new Error(`ページ ${pageId} がセッション ${sessionId} に見つかりません。`);
      }

      page.correction = correction;
      await this.saveSession(session);
    });
  }

  /** ページの段落分割結果を更新して保存する。 */
  async updatePageSplit(sessionId: string, pageId: string, split: SplitResult): Promise<void> {
    await this.runSerialized(sessionId, async () => {
      const { session } = await this.loadSessionWithFileId(sessionId);
      const page = session.pages.find((p) => p.id === pageId);
      if (!page) {
        throw new Error(`ページ ${pageId} がセッション ${sessionId} に見つかりません。`);
      }

      page.split = split;
      await this.saveSession(session);
    });
  }

  /** セッション全体を削除する（ページ画像も Drive から削除）。 */
  async deleteSession(sessionId: string): Promise<void> {
    await this.runSerialized(sessionId, async () => {
      let session: ScanSession;
      try {
        session = await this.loadSession(sessionId);
      } catch (err) {
        if (err instanceof DriveNotFoundError) {
          await this.indexManager.removeSession(sessionId);
          return;
        }
        throw err;
      }

      for (const page of session.pages) {
        try {
          await this.client.deleteFile(page.originalFileId);
        } catch (err) {
          console.warn(`ページ画像の削除に失敗しました (fileId: ${page.originalFileId}):`, err);
        }
      }

      try {
        const fileId = await this.getSessionFileId(sessionId);
        await this.client.deleteFile(fileId);
      } catch (err) {
        console.warn(`セッションファイルの削除に失敗しました:`, err);
      }

      await this.indexManager.removeSession(sessionId);
    });
  }

  /** appDataFolder 内の全セッションファイルを一覧し、セッションデータを読み込む。 */
  async listAllSessions(): Promise<ScanSession[]> {
    const files = await this.client.listAppDataFiles();
    const sessionFiles = files.filter((f) => parseSessionFileName(f.name) !== null);

    const sessions: ScanSession[] = [];
    for (const file of sessionFiles) {
      try {
        const session = await this.client.getFileContent<ScanSession>(file.id);
        sessions.push(session);
      } catch (err) {
        console.warn(`セッションの読み込みに失敗しました (${file.name}):`, err);
      }
    }

    sessions.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return sessions;
  }
}
