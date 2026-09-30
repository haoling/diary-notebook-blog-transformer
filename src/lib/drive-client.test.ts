import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDriveClient, DriveClient } from "./drive-client";
import {
  DriveAuthError,
  DriveNotFoundError,
  DrivePermissionError,
  DriveQuotaExceededError,
} from "./drive-errors";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("DriveClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: DriveClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    client = createDriveClient("tok");
  });
  afterEach(() => vi.unstubAllGlobals());

  /** 直近の fetch 呼び出しの URL とオプションを取得する。 */
  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls.at(-1)! as [string, RequestInit];
    return { url, init, headers: new Headers(init.headers) };
  };

  describe("認証ヘッダとエラー変換", () => {
    it("Bearer トークンを付与してリクエストする", async () => {
      fetchMock.mockResolvedValue(json({ id: "f", name: "n", kind: "k" }));
      await client.getFileInfo("f");
      expect(lastCall().headers.get("Authorization")).toBe("Bearer tok");
    });

    it.each([
      [401, DriveAuthError],
      [403, DrivePermissionError],
      [404, DriveNotFoundError],
      [429, DriveQuotaExceededError],
    ])("HTTP %i を対応する DriveError に変換する", async (status, ErrorClass) => {
      fetchMock.mockResolvedValue(json({ error: { message: "m" } }, status));
      await expect(client.getFileInfo("f")).rejects.toBeInstanceOf(ErrorClass);
    });

    it("エラーボディが JSON でなくても DriveError になる", async () => {
      fetchMock.mockResolvedValue(new Response("<html>", { status: 500 }));
      await expect(client.getFileInfo("f")).rejects.toMatchObject({ statusCode: 500 });
    });
  });

  describe("appDataFolder", () => {
    it("findAppDataFileByName は 'を含む名前をエスケープして検索する", async () => {
      fetchMock.mockResolvedValue(json({ files: [{ id: "1", name: "a", kind: "k" }] }));
      await client.findAppDataFileByName("it's\\x.json");
      const q = decodeURIComponent(new URL(lastCall().url).searchParams.get("q")!);
      expect(q).toContain("name = 'it\\'s\\\\x.json'");
      expect(q).toContain("'appDataFolder' in parents");
    });

    it("ファイルが無ければ DriveNotFoundError", async () => {
      fetchMock.mockResolvedValue(json({ files: [] }));
      await expect(client.findAppDataFileByName("x")).rejects.toBeInstanceOf(DriveNotFoundError);
      fetchMock.mockResolvedValue(json({}));
      await expect(client.findAppDataFileByName("x")).rejects.toBeInstanceOf(DriveNotFoundError);
    });

    it("getAppDataFileByName は内容に _fileId / _file を付与して返す", async () => {
      fetchMock
        .mockResolvedValueOnce(json({ files: [{ id: "fid", name: "s.json", kind: "k" }] }))
        .mockResolvedValueOnce(json({ a: 1 }));
      const result = await client.getAppDataFileByName<{ a: number }>("s.json");
      expect(result).toMatchObject({ a: 1, _fileId: "fid", _file: { id: "fid" } });
      expect(lastCall().url).toContain("/files/fid?alt=media");
    });

    it("createAppDataFile は appDataFolder を親にした multipart で POST する", async () => {
      fetchMock.mockResolvedValue(json({ id: "new", name: "n", kind: "k" }));
      const file = await client.createAppDataFile("n.json", { hello: "世界" });
      const { url, init, headers } = lastCall();
      expect(file.id).toBe("new");
      expect(init.method).toBe("POST");
      expect(url).toContain("uploadType=multipart");
      expect(headers.get("Content-Type")).toMatch(/^multipart\/related; boundary=/);
      expect(init.body).toContain('"parents":["appDataFolder"]');
      expect(init.body).toContain('"name":"n.json"');
      expect(init.body).toContain('{"hello":"世界"}');
    });

    it("updateFileContent は PATCH でファイル ID を指定する", async () => {
      fetchMock.mockResolvedValue(json({ id: "f1", name: "n", kind: "k" }));
      await client.updateFileContent("f1", { a: 1 });
      const { url, init } = lastCall();
      expect(init.method).toBe("PATCH");
      expect(url).toContain("/upload/drive/v3/files/f1");
    });

    it("listAppDataFiles はページネーションをたどって全件取得する", async () => {
      fetchMock
        .mockResolvedValueOnce(json({ files: [{ id: "1", name: "a", kind: "k" }], nextPageToken: "T1" }))
        .mockResolvedValueOnce(json({ files: [{ id: "2", name: "b", kind: "k" }] }));
      const files = await client.listAppDataFiles();
      expect(files.map((f) => f.id)).toEqual(["1", "2"]);
      expect(fetchMock.mock.calls[1][0]).toContain("pageToken=T1");
    });
  });

  describe("汎用操作", () => {
    it("deleteFile は 204 を正常終了として扱う", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      await expect(client.deleteFile("f")).resolves.toBeUndefined();
      expect(lastCall().init.method).toBe("DELETE");
    });

    it("fileExists は存在で true、NotFound で false、その他エラーは再スロー", async () => {
      fetchMock.mockResolvedValueOnce(json({ id: "f", name: "n", kind: "k" }));
      expect(await client.fileExists("f")).toBe(true);
      fetchMock.mockResolvedValueOnce(json({}, 404));
      expect(await client.fileExists("f")).toBe(false);
      fetchMock.mockResolvedValueOnce(json({}, 401));
      await expect(client.fileExists("f")).rejects.toBeInstanceOf(DriveAuthError);
    });

    it("getFileBlob はバイナリを Blob で返す", async () => {
      fetchMock.mockResolvedValue(new Response("bin", { status: 200 }));
      const blob = await client.getFileBlob("f");
      expect(await blob.text()).toBe("bin");
    });

    it("updateFileMetadata は名前と親フォルダ変更をクエリ・ボディに反映する", async () => {
      fetchMock.mockResolvedValue(json({ id: "f", name: "new", kind: "k" }));
      await client.updateFileMetadata("f", { name: "new", addParents: "A", removeParents: "B" });
      const { url, init } = lastCall();
      expect(url).toContain("addParents=A");
      expect(url).toContain("removeParents=B");
      expect(init.body).toBe('{"name":"new"}');
    });

    it("getDownloadUrl は webContentLink が無ければ null", async () => {
      fetchMock.mockResolvedValueOnce(json({ webContentLink: "https://x" }));
      expect(await client.getDownloadUrl("f")).toBe("https://x");
      fetchMock.mockResolvedValueOnce(json({}));
      expect(await client.getDownloadUrl("f")).toBeNull();
    });
  });

  describe("画像アップロード", () => {
    it("指定フォルダを親にして multipart で画像をアップロードする", async () => {
      fetchMock.mockResolvedValue(json({ id: "img", name: "a.png", kind: "k" }));
      const file = await client.uploadImage("folder", "a.png", new Blob(["PNG"], { type: "image/png" }));
      const { init } = lastCall();
      expect(file.id).toBe("img");
      expect(init.method).toBe("POST");
      const body = await (init.body as Blob).text();
      expect(body).toContain('"parents":["folder"]');
      expect(body).toContain("Content-Type: image/png");
      expect(body).toContain("PNG");
    });
  });

  describe("フォルダ管理", () => {
    it("findFolderByName は無ければ null、あれば先頭を返す", async () => {
      fetchMock.mockResolvedValueOnce(json({ files: [] }));
      expect(await client.findFolderByName("手帳")).toBeNull();
      fetchMock.mockResolvedValueOnce(json({ files: [{ id: "1", name: "手帳", kind: "k" }] }));
      expect((await client.findFolderByName("手帳"))?.id).toBe("1");
    });

    it("findOrCreateFolder は既存があれば作成しない", async () => {
      fetchMock.mockResolvedValueOnce(json({ files: [{ id: "1", name: "x", kind: "k" }] }));
      await client.findOrCreateFolder("x");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("findOrCreateFolder は無ければフォルダ MIME タイプで作成する", async () => {
      fetchMock
        .mockResolvedValueOnce(json({ files: [] }))
        .mockResolvedValueOnce(json({ id: "2", name: "x", kind: "k" }));
      const folder = await client.findOrCreateFolder("x");
      expect(folder.id).toBe("2");
      expect(lastCall().init.body).toContain("application/vnd.google-apps.folder");
    });

    it("listFilesInFolder はページネーションをたどる", async () => {
      fetchMock
        .mockResolvedValueOnce(json({ files: [{ id: "1", name: "a", kind: "k" }], nextPageToken: "N" }))
        .mockResolvedValueOnce(json({ files: [{ id: "2", name: "b", kind: "k" }] }));
      expect((await client.listFilesInFolder("F")).map((f) => f.id)).toEqual(["1", "2"]);
      expect(fetchMock.mock.calls[0][0]).not.toContain("pageToken");
      expect(fetchMock.mock.calls[1][0]).toContain("pageToken=N");
    });
  });
});
