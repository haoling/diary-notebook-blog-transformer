import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "./session-manager";
import { SettingsManager } from "./settings-manager";
import { IndexManager } from "./index-manager";
import { FakeDriveClient } from "@/test/fake-drive-client";
import type { CorrectionResult, ScanSession, SplitResult } from "@/types/scan";

describe("SessionManager", () => {
  let drive: FakeDriveClient;
  let settings: SettingsManager;
  let index: IndexManager;
  let manager: SessionManager;

  beforeEach(async () => {
    drive = new FakeDriveClient();
    settings = new SettingsManager(drive.asClient());
    index = new IndexManager(drive.asClient());
    await settings.load();
    await index.load();
    await settings.setNotebookImageFolderId("folder-1");
    manager = new SessionManager(drive.asClient(), settings, index);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const blob = () => new Blob(["x"], { type: "image/jpeg" });

  describe("createSession", () => {
    it("空のセッションをファイルとインデックスの両方に作成する", async () => {
      const session = await manager.createSession();
      expect(session.pages).toEqual([]);
      expect(drive.read(`session_${session.id}.json`)).toEqual(session);
      expect(index.getSessions()).toEqual([{ id: session.id, createdAt: session.createdAt, pageCount: 0 }]);
    });

    it("インデックス更新に失敗したらセッションファイルをロールバックして再スロー", async () => {
      drive.failNext("updateFileContent", new Error("index down"));
      await expect(manager.createSession()).rejects.toThrow("index down");
      expect([...drive.files.values()].some((f) => f.name.startsWith("session_"))).toBe(false);
      // インデックスのキャッシュにも削除済みセッションが残らない
      expect(index.getSessions()).toEqual([]);
    });
  });

  describe("addPage", () => {
    it("画像を手帳フォルダへアップロードし、ページとインデックスを更新する", async () => {
      const session = await manager.createSession();
      const page = await manager.addPage(session.id, blob(), "scan.jpg");

      const [uploadedId, uploaded] = [...drive.images][0];
      expect(uploaded).toEqual({ name: "scan.jpg", folderId: "folder-1" });
      expect(page.originalFileId).toBe(uploadedId);
      expect(page.correction).toBeUndefined();
      expect(page.split).toBeUndefined();

      const loaded = await manager.loadSession(session.id);
      expect(loaded.pages).toEqual([page]);
      expect(index.getSessions()[0].pageCount).toBe(1);
    });

    it("手帳画像フォルダ未設定ならエラー（アップロードしない）", async () => {
      await settings.setNotebookImageFolderId(undefined);
      const session = await manager.createSession();
      await expect(manager.addPage(session.id, blob(), "a.jpg")).rejects.toThrow("手帳画像フォルダ");
      expect(drive.images.size).toBe(0);
    });

    it("セッション保存に失敗したらアップロード済み画像を削除する", async () => {
      const session = await manager.createSession();
      drive.failNext("updateFileContent", new Error("save failed"));
      await expect(manager.addPage(session.id, blob(), "a.jpg")).rejects.toThrow("save failed");
      expect(drive.images.size).toBe(0);
      expect((await manager.loadSession(session.id)).pages).toEqual([]);
    });

    it("インデックス更新の失敗は警告のみでページ追加は成功する", async () => {
      const session = await manager.createSession();
      // saveSession の update は成功、その後のインデックス更新（2 回目の update）が失敗するよう細工
      const original = drive.updateFileContent.bind(drive);
      let calls = 0;
      drive.updateFileContent = async (id, data) => {
        if (++calls === 2) throw new Error("index failed");
        return original(id, data);
      };
      const page = await manager.addPage(session.id, blob(), "a.jpg");
      expect((await manager.loadSession(session.id)).pages).toEqual([page]);
    });

    it("同一セッションへの並行追加でページが失われない", async () => {
      const session = await manager.createSession();
      await Promise.all([
        manager.addPage(session.id, blob(), "1.jpg"),
        manager.addPage(session.id, blob(), "2.jpg"),
        manager.addPage(session.id, blob(), "3.jpg"),
      ]);
      expect((await manager.loadSession(session.id)).pages).toHaveLength(3);
      expect(index.getSessions()[0].pageCount).toBe(3);
    });
  });

  describe("removePage", () => {
    it("ページとその画像を削除し、ページ数を更新する", async () => {
      const session = await manager.createSession();
      const p1 = await manager.addPage(session.id, blob(), "1.jpg");
      const p2 = await manager.addPage(session.id, blob(), "2.jpg");
      await manager.removePage(session.id, p1.id);
      expect((await manager.loadSession(session.id)).pages.map((p) => p.id)).toEqual([p2.id]);
      expect(drive.images.has(p1.originalFileId)).toBe(false);
      expect(drive.images.has(p2.originalFileId)).toBe(true);
      expect(index.getSessions()[0].pageCount).toBe(1);
    });

    it("存在しないページはエラー", async () => {
      const session = await manager.createSession();
      await expect(manager.removePage(session.id, "nope")).rejects.toThrow("見つかりません");
    });

    it("画像削除の失敗は警告のみで、ページ自体は削除される", async () => {
      const session = await manager.createSession();
      const page = await manager.addPage(session.id, blob(), "1.jpg");
      drive.failNext("deleteFile", new Error("nope"));
      await manager.removePage(session.id, page.id);
      expect((await manager.loadSession(session.id)).pages).toEqual([]);
    });
  });

  describe("補正・段落分割結果の更新", () => {
    const correction: CorrectionResult = {
      correctedAt: "2026-01-01T00:00:00Z",
      skipped: false,
      rotation: 90,
      adjustments: { brightness: 10 },
    };
    const split: SplitResult = {
      splitAt: "2026-01-01T00:00:00Z",
      paragraphs: [{ id: "para1", order: 0, cropRect: { x: 0, y: 0, width: 10, height: 10 } }],
    };

    it("updatePageCorrection は他のページや段落分割結果に影響しない", async () => {
      const session = await manager.createSession();
      const p1 = await manager.addPage(session.id, blob(), "1.jpg");
      const p2 = await manager.addPage(session.id, blob(), "2.jpg");
      await manager.updatePageSplit(session.id, p1.id, split);
      await manager.updatePageCorrection(session.id, p1.id, correction);
      const loaded = await manager.loadSession(session.id);
      expect(loaded.pages[0]).toMatchObject({ correction, split });
      expect(loaded.pages[1]).toEqual(p2);
    });

    it("ステップは独立: 補正なしでも段落分割を保存できる", async () => {
      const session = await manager.createSession();
      const page = await manager.addPage(session.id, blob(), "1.jpg");
      await manager.updatePageSplit(session.id, page.id, split);
      const loaded = await manager.loadSession(session.id);
      expect(loaded.pages[0].split).toEqual(split);
      expect(loaded.pages[0].correction).toBeUndefined();
    });

    it("存在しないページはエラー", async () => {
      const session = await manager.createSession();
      await expect(manager.updatePageCorrection(session.id, "x", correction)).rejects.toThrow("見つかりません");
      await expect(manager.updatePageSplit(session.id, "x", split)).rejects.toThrow("見つかりません");
    });
  });

  describe("deleteSession", () => {
    it("ページ画像・セッションファイル・インデックスをすべて削除する", async () => {
      const session = await manager.createSession();
      await manager.addPage(session.id, blob(), "1.jpg");
      await manager.addPage(session.id, blob(), "2.jpg");
      await manager.deleteSession(session.id);
      expect(drive.images.size).toBe(0);
      expect(drive.read(`session_${session.id}.json`)).toBeUndefined();
      expect(index.getSessions()).toEqual([]);
    });

    it("ファイルが既に無くてもインデックスからは削除する", async () => {
      const session = await manager.createSession();
      drive.files.delete([...drive.files].find(([, f]) => f.name === `session_${session.id}.json`)![0]);
      await manager.deleteSession(session.id);
      expect(index.getSessions()).toEqual([]);
    });
  });

  describe("listAllSessions", () => {
    it("session_ ファイルのみを対象に、作成日時の新しい順で返す", async () => {
      const mk = (id: string, createdAt: string): ScanSession => ({ id, createdAt, pages: [] });
      drive.seed("session_old.json", mk("old", "2026-01-01T00:00:00Z"));
      drive.seed("session_new.json", mk("new", "2026-03-01T00:00:00Z"));
      drive.seed("article_x.json", { id: "x" });
      const sessions = await manager.listAllSessions();
      expect(sessions.map((s) => s.id)).toEqual(["new", "old"]);
    });

    it("読み込みに失敗したセッションはスキップする", async () => {
      drive.seed("session_a.json", { id: "a", createdAt: "2026-01-01T00:00:00Z", pages: [] });
      drive.seed("session_b.json", { id: "b", createdAt: "2026-02-01T00:00:00Z", pages: [] });
      drive.failNext("getFileContent", new Error("broken"));
      expect(await manager.listAllSessions()).toHaveLength(1);
    });
  });
});
