import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArticleManager,
  blockKey,
  createEmptyArticle,
  findParagraph,
  listAvailableParagraphs,
  paragraphKey,
  photoKey,
} from "./article-manager";
import { IndexManager } from "./index-manager";
import { FakeDriveClient } from "@/test/fake-drive-client";
import type { Article } from "@/types/article";
import type { ScanSession } from "@/types/scan";

const article = (over: Partial<Article> = {}): Article => ({
  id: "a1",
  title: "タイトル",
  date: "2026-02-01",
  blocks: [],
  publishTargets: [],
  ...over,
});

describe("ArticleManager", () => {
  let drive: FakeDriveClient;
  let index: IndexManager;
  let manager: ArticleManager;

  beforeEach(async () => {
    drive = new FakeDriveClient();
    index = new IndexManager(drive.asClient());
    await index.load();
    manager = new ArticleManager(drive.asClient(), index);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  describe("saveArticle / loadArticle", () => {
    it("新規記事をファイルとインデックスに保存し、内部フィールドなしで読み込める", async () => {
      const a = article({ blocks: [{ type: "photo", photoId: "p1" }] });
      await manager.saveArticle(a);
      expect(index.getArticles()).toEqual([{ id: "a1", title: "タイトル", date: "2026-02-01" }]);
      const loaded = await manager.loadArticle("a1");
      expect(loaded).toEqual(a);
      expect(loaded).not.toHaveProperty("_fileId");
      expect(loaded).not.toHaveProperty("_file");
    });

    it("既存記事の保存は更新（upsert）になり、ファイルは 1 つのまま", async () => {
      await manager.saveArticle(article());
      await manager.saveArticle(article({ title: "更新後" }));
      expect([...drive.files.values()].filter((f) => f.name === "article_a1.json")).toHaveLength(1);
      expect((await manager.loadArticle("a1")).title).toBe("更新後");
      expect(index.getArticles()).toEqual([{ id: "a1", title: "更新後", date: "2026-02-01" }]);
    });

    it("新規作成時にインデックス更新が失敗したらファイルをロールバックする", async () => {
      const failing = vi.spyOn(index, "addArticle").mockRejectedValueOnce(new Error("index down"));
      await expect(manager.saveArticle(article())).rejects.toThrow("index down");
      expect(drive.read("article_a1.json")).toBeUndefined();
      failing.mockRestore();
    });

    it("更新時にインデックス更新が失敗しても既存ファイルは削除しない", async () => {
      await manager.saveArticle(article());
      vi.spyOn(index, "addArticle").mockRejectedValueOnce(new Error("index down"));
      await expect(manager.saveArticle(article({ title: "新" }))).rejects.toThrow("index down");
      expect(drive.read("article_a1.json")).toMatchObject({ title: "新" });
    });

    it("NotFound 以外のエラーは再スロー", async () => {
      drive.failNext("findAppDataFileByName", new Error("network"));
      await expect(manager.saveArticle(article())).rejects.toThrow("network");
    });

    it("同一記事への並行保存は直列化され、最後の呼び出しが最終状態になる", async () => {
      await Promise.all([
        manager.saveArticle(article({ title: "1" })),
        manager.saveArticle(article({ title: "2" })),
        manager.saveArticle(article({ title: "3" })),
      ]);
      expect([...drive.files.values()].filter((f) => f.name === "article_a1.json")).toHaveLength(1);
      expect((await manager.loadArticle("a1")).title).toBe("3");
    });

    it("直列化チェーンは失敗後も継続する", async () => {
      vi.spyOn(index, "addArticle").mockRejectedValueOnce(new Error("x"));
      const first = manager.saveArticle(article({ title: "1" }));
      const second = manager.saveArticle(article({ title: "2" }));
      await expect(first).rejects.toThrow("x");
      await expect(second).resolves.toBeUndefined();
    });
  });

  describe("deleteArticle", () => {
    it("ファイルとインデックスから削除する", async () => {
      await manager.saveArticle(article());
      await manager.deleteArticle("a1");
      expect(drive.read("article_a1.json")).toBeUndefined();
      expect(index.getArticles()).toEqual([]);
    });

    it("ファイルが既に無くてもインデックスから削除する", async () => {
      await index.addArticle({ id: "ghost", title: "t", date: "d" });
      await manager.deleteArticle("ghost");
      expect(index.getArticles()).toEqual([]);
    });

    it("NotFound 以外のエラーは再スロー", async () => {
      await manager.saveArticle(article());
      drive.failNext("deleteFile", new Error("boom"));
      await expect(manager.deleteArticle("a1")).rejects.toThrow("boom");
      expect(index.getArticles()).toHaveLength(1);
    });
  });

  describe("listAllArticles", () => {
    it("article_ ファイルのみを日付の新しい順に返す", async () => {
      drive.seed("article_1.json", article({ id: "1", date: "2026-01-01" }));
      drive.seed("article_2.json", article({ id: "2", date: "2026-03-01" }));
      drive.seed("session_x.json", { id: "x" });
      drive.seed("articleX.json", { id: "bad" });
      const list = await manager.listAllArticles();
      expect(list.map((a) => a.id)).toEqual(["2", "1"]);
    });

    it("読み込みに失敗した記事はスキップする", async () => {
      drive.seed("article_1.json", article({ id: "1" }));
      drive.seed("article_2.json", article({ id: "2" }));
      drive.failNext("getFileContent", new Error("broken"));
      expect(await manager.listAllArticles()).toHaveLength(1);
    });
  });
});

describe("createEmptyArticle", () => {
  it("空の記事を生成し、日付は今日（YYYY-MM-DD）になる", () => {
    const a = createEmptyArticle();
    expect(a).toMatchObject({ title: "", blocks: [], publishTargets: [] });
    expect(a.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(a.id.length).toBeGreaterThan(0);
  });

  it("呼び出すたびに異なる ID になる", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createEmptyArticle().id));
    expect(ids.size).toBe(50);
  });
});

describe("ブロックキー", () => {
  it("paragraphKey / photoKey は決まった形式", () => {
    expect(paragraphKey("s1", "p1")).toBe("paragraph:s1:p1");
    expect(photoKey("ph")).toBe("photo:ph");
  });

  it("blockKey はブロック種別で振り分ける", () => {
    expect(blockKey({ type: "paragraph", sessionId: "s", paragraphId: "p" })).toBe(paragraphKey("s", "p"));
    expect(blockKey({ type: "photo", photoId: "x" })).toBe(photoKey("x"));
  });
});

describe("段落の解決ヘルパー", () => {
  const rect = { x: 0, y: 0, width: 1, height: 1 };
  const sessions: ScanSession[] = [
    {
      id: "s1",
      createdAt: "2026-01-01T00:00:00Z",
      pages: [
        { id: "pg1", capturedAt: "t", originalFileId: "f1" }, // 段落分割なし
        {
          id: "pg2",
          capturedAt: "t",
          originalFileId: "f2",
          split: {
            splitAt: "t",
            paragraphs: [
              { id: "para1", order: 0, cropRect: rect },
              { id: "para2", order: 1, cropRect: rect },
            ],
          },
        },
      ],
    },
    { id: "s2", createdAt: "2026-02-01T00:00:00Z", pages: [] },
  ];

  it("listAvailableParagraphs は段落分割済みページの段落のみ列挙する", () => {
    const list = listAvailableParagraphs(sessions);
    expect(list.map((p) => p.paragraph.id)).toEqual(["para1", "para2"]);
    expect(list[0]).toMatchObject({ sessionId: "s1", sessionCreatedAt: "2026-01-01T00:00:00Z" });
    expect(list[0].page.id).toBe("pg2");
  });

  it("findParagraph は所属ページ付きで段落を返す", () => {
    const found = findParagraph(sessions, "s1", "para2");
    expect(found?.paragraph.id).toBe("para2");
    expect(found?.page.id).toBe("pg2");
  });

  it("セッションまたは段落が無ければ null", () => {
    expect(findParagraph(sessions, "nope", "para1")).toBeNull();
    expect(findParagraph(sessions, "s1", "nope")).toBeNull();
    expect(findParagraph(sessions, "s2", "para1")).toBeNull();
  });
});
