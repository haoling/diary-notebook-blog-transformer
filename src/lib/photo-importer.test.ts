import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoImporter, type DriveImageFile, type PickerMediaItem } from "./photo-importer";
import { IndexManager } from "./index-manager";
import { FakeDriveClient } from "@/test/fake-drive-client";

const pickerItem = {
  id: "gp1",
  createTime: "2026-01-01T09:00:00Z",
  type: "PHOTO",
  mediaFile: { baseUrl: "https://b", mimeType: "image/jpeg", filename: "IMG_1.jpg" },
} as unknown as PickerMediaItem;

const driveFile = {
  id: "gd1",
  name: "photo.jpg",
  createdTime: "2026-01-02T09:00:00Z",
} as unknown as DriveImageFile;

describe("PhotoImporter", () => {
  let drive: FakeDriveClient;
  let index: IndexManager;
  let importer: PhotoImporter;

  beforeEach(() => {
    drive = new FakeDriveClient();
    index = new IndexManager(drive.asClient());
    importer = new PhotoImporter(drive.asClient(), index, "tok");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("Google Photos の写真をインポートし、index にも登録する（index は自動ロード）", async () => {
    const photo = await importer.importFromGooglePhotos(pickerItem);
    expect(photo).toMatchObject({
      sourceType: "google_photos",
      sourceRef: "gp1",
      title: "IMG_1.jpg",
      takenAt: "2026-01-01T09:00:00Z",
    });
    expect(drive.read(`photo_${photo.id}.json`)).toEqual(photo);
    expect(index.getPhotos()).toEqual([
      { id: photo.id, importedAt: photo.importedAt, sourceType: "google_photos" },
    ]);
  });

  it("Google Drive の画像をインポートする", async () => {
    const photo = await importer.importFromGoogleDrive(driveFile);
    expect(photo).toMatchObject({ sourceType: "google_drive", sourceRef: "gd1", title: "photo.jpg" });
    expect(photo.cropRect).toBeUndefined();
  });

  it("並行インポートでも index.load() は 1 回だけ", async () => {
    const load = vi.spyOn(index, "load");
    await Promise.all([
      importer.importFromGoogleDrive(driveFile),
      importer.importFromGoogleDrive(driveFile),
      importer.importFromGooglePhotos(pickerItem),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(index.getPhotos()).toHaveLength(3);
  });

  it("index 登録に失敗したら作成したファイルをロールバックする", async () => {
    await index.load();
    vi.spyOn(index, "addPhoto").mockRejectedValueOnce(new Error("index down"));
    await expect(importer.importFromGoogleDrive(driveFile)).rejects.toThrow("index down");
    expect([...drive.files.values()].some((f) => f.name.startsWith("photo_"))).toBe(false);
  });

  it("deletePhoto はファイルと index から削除し、ファイルが無くても index から消す", async () => {
    const photo = await importer.importFromGoogleDrive(driveFile);
    await importer.deletePhoto(photo.id);
    expect(drive.read(`photo_${photo.id}.json`)).toBeUndefined();
    expect(index.getPhotos()).toEqual([]);

    await index.addPhoto({ id: "ghost", importedAt: "t", sourceType: "google_drive" });
    await importer.deletePhoto("ghost");
    expect(index.getPhotos()).toEqual([]);
  });

  it("loadPhoto は内部フィールドなしで写真を返し、updatePhoto で cropRect を保存できる", async () => {
    const photo = await importer.importFromGoogleDrive(driveFile);
    const cropRect = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
    await importer.updatePhoto({ ...photo, cropRect });
    const loaded = await importer.loadPhoto(photo.id);
    expect(loaded).toEqual({ ...photo, cropRect });
    expect(loaded).not.toHaveProperty("_fileId");
  });

  it("listAllPhotos は photo_ ファイルのみをインポート日時の新しい順に返す", async () => {
    drive.seed("photo_a.json", { id: "a", importedAt: "2026-01-01T00:00:00Z" });
    drive.seed("photo_b.json", { id: "b", importedAt: "2026-02-01T00:00:00Z" });
    drive.seed("session_x.json", { id: "x" });
    expect((await importer.listAllPhotos()).map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("getThumbnailUrl はサイズ指定を baseUrl に付与する", () => {
    expect(PhotoImporter.getThumbnailUrl("https://b")).toBe("https://b=w256-h256");
    expect(PhotoImporter.getThumbnailUrl("https://b", 100, 50)).toBe("https://b=w100-h50");
  });

  describe("fetchDriveThumbnailBlob", () => {
    it("Authorization ヘッダ付きで取得する", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response("img"));
      vi.stubGlobal("fetch", fetchMock);
      const blob = await importer.fetchDriveThumbnailBlob("https://thumb");
      expect(await blob.text()).toBe("img");
      expect(fetchMock).toHaveBeenCalledWith("https://thumb", {
        headers: { Authorization: "Bearer tok" },
      });
    });

    it("失敗レスポンスはエラー", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
      await expect(importer.fetchDriveThumbnailBlob("https://thumb")).rejects.toThrow("403");
    });
  });
});
