import { describe, expect, it } from "vitest";
import { LINE_HEIGHT_PRESETS, NOTEBOOK_SIZE_PRESETS } from "./notebook-presets";

describe("notebook-presets", () => {
  it("サイズプリセットは正の mm 値と日本語ラベルを持つ", () => {
    for (const preset of Object.values(NOTEBOOK_SIZE_PRESETS)) {
      expect(preset.widthMm).toBeGreaterThan(0);
      expect(preset.heightMm).toBeGreaterThan(preset.widthMm);
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });

  it("代表的なサイズの値が正しい", () => {
    expect(NOTEBOOK_SIZE_PRESETS.a5).toMatchObject({ widthMm: 148, heightMm: 210 });
    expect(NOTEBOOK_SIZE_PRESETS.bible).toMatchObject({ widthMm: 95, heightMm: 171 });
  });

  it("行高プリセットのキー名と mm 値が一致する", () => {
    for (const [key, mm] of Object.entries(LINE_HEIGHT_PRESETS)) {
      expect(key).toBe(`${mm}mm`);
    }
  });

  it("custom はプリセットに含まれない", () => {
    expect(NOTEBOOK_SIZE_PRESETS).not.toHaveProperty("custom");
    expect(LINE_HEIGHT_PRESETS).not.toHaveProperty("custom");
  });
});
