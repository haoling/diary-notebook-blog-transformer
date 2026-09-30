import { beforeEach, describe, expect, it } from "vitest";
import { SettingsManager } from "./settings-manager";
import { FakeDriveClient } from "@/test/fake-drive-client";
import type { NotebookCalibration } from "@/types/settings";

const profile = {
  sizePreset: "a5" as const,
  pageWidthMm: 148,
  pageHeightMm: 210,
  lineHeightPreset: "7mm" as const,
  lineHeightMm: 7,
};

const calibration: NotebookCalibration = {
  calibratedAt: "2026-01-01T00:00:00Z",
  lineYRatios: [0.1, 0.2],
  sourceImageHeightPx: 1000,
  referenceColor: { r: 250, g: 250, b: 250 },
};

describe("SettingsManager", () => {
  let drive: FakeDriveClient;
  let manager: SettingsManager;

  beforeEach(async () => {
    drive = new FakeDriveClient();
    manager = new SettingsManager(drive.asClient());
    await manager.load();
  });

  it("settings.json が無ければ空設定で新規作成する", () => {
    expect(manager.getAll()).toEqual({ version: 1, notebookProfile: undefined });
    expect(drive.read("settings.json")).toEqual({ version: 1 });
  });

  it("既存の設定を読み込む", async () => {
    const d = new FakeDriveClient();
    d.seed("settings.json", { visionApiKey: "k", notebookImageFolderId: "fid", version: 7 });
    const m = new SettingsManager(d.asClient());
    await m.load();
    expect(m.getVisionApiKey()).toBe("k");
    expect(m.getNotebookImageFolderId()).toBe("fid");
    expect(m.getAll().version).toBe(7);
  });

  it("load 前の変更・取得はエラー", async () => {
    const m = new SettingsManager(new FakeDriveClient().asClient());
    expect(() => m.getAll()).toThrow("load()");
    await expect(m.setVisionApiKey("x")).rejects.toThrow("load()");
    expect(m.getVisionApiKey()).toBeUndefined();
  });

  it("個別 setter が値を保存し version を進める", async () => {
    await manager.setVisionApiKey("key");
    await manager.setNotebookImageFolderId("folder");
    await manager.setNotebookImageFolderName("手帳");
    expect(manager.getVisionApiKey()).toBe("key");
    expect(manager.getNotebookImageFolderId()).toBe("folder");
    expect(manager.getNotebookImageFolderName()).toBe("手帳");
    const stored = drive.read<Record<string, unknown>>("settings.json")!;
    expect(stored).toMatchObject({ visionApiKey: "key", notebookImageFolderId: "folder", version: 4 });
  });

  it("undefined を設定すると値がクリアされる", async () => {
    await manager.setVisionApiKey("key");
    await manager.setVisionApiKey(undefined);
    expect(manager.getVisionApiKey()).toBeUndefined();
  });

  describe("手帳プロファイル", () => {
    it("プロファイル未設定でキャリブレーションを保存するとエラー", async () => {
      await expect(manager.setNotebookCalibration(calibration)).rejects.toThrow("notebookProfile");
    });

    it("setNotebookProfile は既存の calibration を保持する", async () => {
      await manager.setNotebookProfile(profile);
      await manager.setNotebookCalibration(calibration);
      await manager.setNotebookProfile({ ...profile, lineHeightMm: 8, lineHeightPreset: "8mm" });
      expect(manager.getNotebookProfile()).toMatchObject({ lineHeightMm: 8, calibration });
    });

    it("setNotebookProfile(undefined) でプロファイルを削除する", async () => {
      await manager.setNotebookProfile(profile);
      await manager.setNotebookProfile(undefined);
      expect(manager.getNotebookProfile()).toBeUndefined();
    });

    it("setNotebookCalibration(undefined) で calibration のみ削除する", async () => {
      await manager.setNotebookProfile(profile);
      await manager.setNotebookCalibration(calibration);
      await manager.setNotebookCalibration(undefined);
      expect(manager.getNotebookProfile()).toMatchObject(profile);
      expect(manager.getNotebookProfile()?.calibration).toBeUndefined();
    });

    it("返却値を変更しても内部状態に混入しない（ネストした calibration を含む）", async () => {
      await manager.setNotebookProfile(profile);
      await manager.setNotebookCalibration(calibration);
      const got = manager.getNotebookProfile()!;
      got.lineHeightMm = 999;
      got.calibration!.lineYRatios.push(0.9);
      const all = manager.getAll();
      all.notebookProfile!.calibration!.referenceColor.r = 0;
      expect(manager.getNotebookProfile()).toMatchObject({ lineHeightMm: 7, calibration });
    });

    it("渡した calibration オブジェクトを後から変更しても影響しない", async () => {
      await manager.setNotebookProfile(profile);
      const input = structuredClone(calibration);
      await manager.setNotebookCalibration(input);
      input.lineYRatios.push(0.5);
      expect(manager.getNotebookProfile()?.calibration?.lineYRatios).toEqual([0.1, 0.2]);
    });
  });

  describe("update", () => {
    it("複数項目を一度に更新し、1 回の永続化で version が 1 進む", async () => {
      await manager.update({ visionApiKey: "k", notebookImageFolderId: "f" });
      expect(manager.getAll()).toMatchObject({ visionApiKey: "k", notebookImageFolderId: "f", version: 2 });
    });

    it("notebookProfile を含まない更新では既存のプロファイルを保持する", async () => {
      await manager.setNotebookProfile(profile);
      await manager.update({ visionApiKey: "k" });
      expect(manager.getNotebookProfile()).toMatchObject(profile);
    });

    it("notebookProfile: undefined を明示するとクリアされる", async () => {
      await manager.setNotebookProfile(profile);
      await manager.update({ notebookProfile: undefined });
      expect(manager.getNotebookProfile()).toBeUndefined();
    });
  });

  it("並行する更新はすべて反映される", async () => {
    await Promise.all([manager.setVisionApiKey("a"), manager.setNotebookImageFolderId("b")]);
    expect(drive.read("settings.json")).toMatchObject({
      visionApiKey: "a",
      notebookImageFolderId: "b",
      version: 3,
    });
  });
});
