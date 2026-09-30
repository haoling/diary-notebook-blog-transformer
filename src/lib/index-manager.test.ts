import { beforeEach, describe, expect, it, vi } from "vitest";
import { IndexManager } from "./index-manager";
import { FakeDriveClient } from "@/test/fake-drive-client";

describe("IndexManager", () => {
  let drive: FakeDriveClient;
  let manager: IndexManager;

  beforeEach(() => {
    drive = new FakeDriveClient();
    manager = new IndexManager(drive.asClient());
  });

  describe("load", () => {
    it("index.json が無ければデフォルト値で新規作成する（version 1）", async () => {
      const index = await manager.load();
      expect(index).toEqual({ sessions: [], photos: [], articles: [], version: 1 });
      expect(drive.read("index.json")).toEqual({ sessions: [], photos: [], articles: [], version: 1 });
    });

    it("既存ファイルを読み込み、pageCount 欠落を 0 で補完する", async () => {
      drive.seed("index.json", {
        sessions: [{ id: "s1", createdAt: "2026-01-01T00:00:00Z" }],
        photos: [],
        articles: [{ id: "a1", title: "t", date: "2026-01-01" }],
        version: 5,
      });
      const index = await manager.load();
      expect(index.sessions).toEqual([{ id: "s1", createdAt: "2026-01-01T00:00:00Z", pageCount: 0 }]);
      expect(index.articles).toHaveLength(1);
      expect(index.version).toBe(5);
    });

    it("配列でないフィールドは空配列にフォールバックする", () => {
      drive.seed("index.json", { sessions: "bad", photos: null });
      return manager.load().then((index) => {
        expect(index.sessions).toEqual([]);
        expect(index.photos).toEqual([]);
        expect(index.articles).toEqual([]);
        expect(index.version).toBe(0);
      });
    });

    it("NotFound 以外のエラーは再スロー", async () => {
      drive.failNext("getAppDataFileByName", new Error("network"));
      await expect(manager.load()).rejects.toThrow("network");
    });
  });

  describe("load 前の操作", () => {
    it("getAll / 変更操作は load() を促すエラーになる", async () => {
      expect(() => manager.getAll()).toThrow("load()");
      expect(() => manager.getSessions()).toThrow("load()");
      await expect(manager.addSession({ id: "s", createdAt: "x", pageCount: 0 })).rejects.toThrow("load()");
      await expect(manager.removeArticle("a")).rejects.toThrow("load()");
    });
  });

  describe("変更操作", () => {
    beforeEach(async () => {
      await manager.load();
    });

    it("セッションは同一 ID なら置換（upsert）される", async () => {
      await manager.addSession({ id: "s1", createdAt: "c", pageCount: 1 });
      await manager.addSession({ id: "s1", createdAt: "c", pageCount: 3 });
      expect(manager.getSessions()).toEqual([{ id: "s1", createdAt: "c", pageCount: 3 }]);
    });

    it("記事も同一 ID なら置換される", async () => {
      await manager.addArticle({ id: "a1", title: "旧", date: "2026-01-01" });
      await manager.addArticle({ id: "a1", title: "新", date: "2026-01-02" });
      expect(manager.getArticles()).toEqual([{ id: "a1", title: "新", date: "2026-01-02" }]);
    });

    it("写真の追加・削除ができる", async () => {
      await manager.addPhoto({ id: "p1", importedAt: "t", sourceType: "google_drive" });
      await manager.addPhoto({ id: "p2", importedAt: "t", sourceType: "google_photos" });
      await manager.removePhoto("p1");
      expect(manager.getPhotos().map((p) => p.id)).toEqual(["p2"]);
    });

    it("削除操作は該当 ID のみ取り除く", async () => {
      await manager.addSession({ id: "s1", createdAt: "c", pageCount: 0 });
      await manager.addSession({ id: "s2", createdAt: "c", pageCount: 0 });
      await manager.removeSession("s1");
      await manager.addArticle({ id: "a1", title: "t", date: "d" });
      await manager.removeArticle("a1");
      expect(manager.getSessions().map((s) => s.id)).toEqual(["s2"]);
      expect(manager.getArticles()).toEqual([]);
    });

    it("変更のたびに永続化され、version が単調増加する", async () => {
      await manager.addSession({ id: "s1", createdAt: "c", pageCount: 0 });
      expect(manager.getAll().version).toBe(2);
      await manager.removeSession("s1");
      expect(manager.getAll().version).toBe(3);
      expect(drive.read<{ version: number }>("index.json")!.version).toBe(3);
    });

    it("返却値を変更しても内部状態に影響しない", async () => {
      await manager.addSession({ id: "s1", createdAt: "c", pageCount: 0 });
      manager.getSessions()[0].pageCount = 99;
      manager.getAll().sessions.pop();
      expect(manager.getSessions()).toEqual([{ id: "s1", createdAt: "c", pageCount: 0 }]);
    });

    it("並行して呼び出した変更も直列に永続化され、すべて反映される", async () => {
      await Promise.all([
        manager.addSession({ id: "s1", createdAt: "c", pageCount: 0 }),
        manager.addSession({ id: "s2", createdAt: "c", pageCount: 0 }),
        manager.addSession({ id: "s3", createdAt: "c", pageCount: 0 }),
      ]);
      const stored = drive.read<{ sessions: unknown[]; version: number }>("index.json")!;
      expect(stored.sessions).toHaveLength(3);
      expect(stored.version).toBe(4);
    });

    it("ファイルが消えていたら警告して新規作成にフォールバックする", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      drive.files.clear();
      await manager.addSession({ id: "s1", createdAt: "c", pageCount: 0 });
      expect(warn).toHaveBeenCalled();
      expect(drive.read<{ sessions: unknown[] }>("index.json")!.sessions).toHaveLength(1);
      warn.mockRestore();
    });

    it("永続化に失敗しても、後続の操作は継続できる", async () => {
      drive.failNext("updateFileContent", new Error("boom"));
      await expect(manager.addSession({ id: "s1", createdAt: "c", pageCount: 0 })).rejects.toThrow("boom");
      await expect(manager.addSession({ id: "s2", createdAt: "c", pageCount: 0 })).resolves.toBeUndefined();
    });
  });
});
