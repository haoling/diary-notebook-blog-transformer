import { describe, expect, it } from "vitest";
import {
  computeColorMatchAdjustments,
  computeColorMatchAdjustmentsFromPixels,
  computeExpectedPitchPx,
  detectPageRectFromPixels,
  detectRuledLinesFromProfile,
  lineYRatiosToPixelYs,
  pixelYsToLineYRatios,
  sampleBackgroundColorFromPixels,
} from "./notebook-calibration";
import type { NotebookProfile, RgbColor } from "@/types/settings";

/** 単色の RGBA 画素配列を作る。 */
function solidPixels(count: number, { r, g, b }: RgbColor, a = 255): Uint8ClampedArray {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) data.set([r, g, b, a], i * 4);
  return data;
}

describe("computeExpectedPitchPx / 罫線座標の変換", () => {
  const profile: NotebookProfile = {
    sizePreset: "a5",
    pageWidthMm: 148,
    pageHeightMm: 210,
    lineHeightPreset: "7mm",
    lineHeightMm: 7,
  };

  it("画像高さ × 行高 / ページ高さ でピッチを算出する", () => {
    expect(computeExpectedPitchPx(2100, profile)).toBeCloseTo(70);
  });

  it("pixelYsToLineYRatios は昇順ソートして比率にする（入力は変更しない）", () => {
    const ys = [300, 100, 200];
    expect(pixelYsToLineYRatios(ys, 400)).toEqual([0.25, 0.5, 0.75]);
    expect(ys).toEqual([300, 100, 200]);
  });

  it("lineYRatiosToPixelYs で往復変換できる", () => {
    const ratios = pixelYsToLineYRatios([100, 200, 300], 1000);
    expect(lineYRatiosToPixelYs(ratios, 1000)).toEqual([100, 200, 300]);
  });
});

describe("detectRuledLinesFromProfile", () => {
  /** 一定ピッチの細い罫線を持つ行暗さプロファイルを作る。 */
  function ruledProfile(height: number, pitch: number, offset: number, skip: number[] = []): number[] {
    const profile = new Array<number>(height).fill(10);
    for (let k = 0; offset + k * pitch < height; k++) {
      if (skip.includes(k)) continue;
      profile[Math.round(offset + k * pitch)] = 60;
    }
    return profile;
  }

  it("等間隔の罫線を検出する", () => {
    const lines = detectRuledLinesFromProfile(ruledProfile(1000, 50, 25), { expectedPitchPx: 50 });
    expect(lines.length).toBeGreaterThanOrEqual(18);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i] - lines[i - 1]).toBeCloseTo(50, 0);
    }
    expect(lines[0]).toBeCloseTo(25, 0);
  });

  it("結果は昇順になる", () => {
    const lines = detectRuledLinesFromProfile(ruledProfile(600, 40, 20), { expectedPitchPx: 40 });
    expect([...lines].sort((a, b) => a - b)).toEqual(lines);
  });

  it("かすれて検出できなかった罫線を補間する", () => {
    const lines = detectRuledLinesFromProfile(ruledProfile(1000, 50, 25, [8, 9]), {
      expectedPitchPx: 50,
    });
    // 欠番（8, 9 番目）があっても補間で本数が復元され、50px 間隔で連続している
    expect(lines.length).toBeGreaterThanOrEqual(18);
    expect(lines.some((y) => Math.abs(y - (25 + 8 * 50)) < 3)).toBe(true);
    expect(lines.some((y) => Math.abs(y - (25 + 9 * 50)) < 3)).toBe(true);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i] - lines[i - 1]).toBeCloseTo(50, 0);
    }
  });

  it("罫線のない一様なプロファイルは空配列", () => {
    expect(detectRuledLinesFromProfile(new Array(500).fill(20), { expectedPitchPx: 40 })).toEqual([]);
  });

  it("画像が短すぎる・ピッチが不正な場合は空配列", () => {
    expect(detectRuledLinesFromProfile([1, 2, 3], { expectedPitchPx: 40 })).toEqual([]);
    expect(detectRuledLinesFromProfile(ruledProfile(500, 40, 20), { expectedPitchPx: 1 })).toEqual([]);
    expect(detectRuledLinesFromProfile(ruledProfile(500, 40, 20), { expectedPitchPx: NaN })).toEqual([]);
  });

  it.each([0, 1, -0.1, NaN, Infinity])("toleranceRatio=%s は RangeError", (toleranceRatio) => {
    expect(() =>
      detectRuledLinesFromProfile(ruledProfile(500, 40, 20), { expectedPitchPx: 40, toleranceRatio }),
    ).toThrow(RangeError);
  });
});

describe("sampleBackgroundColorFromPixels", () => {
  it("単色画像ではその色を返す", () => {
    expect(sampleBackgroundColorFromPixels(solidPixels(100, { r: 250, g: 240, b: 220 }))).toEqual({
      r: 250,
      g: 240,
      b: 220,
    });
  });

  it("暗いインク画素が少数混在しても紙の色を返す", () => {
    const data = solidPixels(100, { r: 240, g: 230, b: 200 });
    for (let i = 0; i < 10; i++) data.set([20, 20, 20, 255], i * 4);
    expect(sampleBackgroundColorFromPixels(data)).toEqual({ r: 240, g: 230, b: 200 });
  });

  it("完全に透明な画素は無視する", () => {
    const data = solidPixels(10, { r: 200, g: 200, b: 200 });
    data.set([0, 0, 0, 0], 0);
    expect(sampleBackgroundColorFromPixels(data)).toEqual({ r: 200, g: 200, b: 200 });
  });

  it("不透明画素がなければ RangeError", () => {
    expect(() => sampleBackgroundColorFromPixels(solidPixels(4, { r: 1, g: 2, b: 3 }, 0))).toThrow(
      RangeError,
    );
    expect(() => sampleBackgroundColorFromPixels(new Uint8ClampedArray(0))).toThrow(RangeError);
  });

  it.each([-0.1, 1.1, NaN])("percentile=%s は RangeError", (p) => {
    expect(() => sampleBackgroundColorFromPixels(solidPixels(4, { r: 1, g: 2, b: 3 }), p)).toThrow(
      RangeError,
    );
  });
});

describe("computeColorMatchAdjustments", () => {
  const white: RgbColor = { r: 255, g: 255, b: 255 };

  it("地色が参照色と一致し、インクも十分暗ければ補正なし", () => {
    expect(computeColorMatchAdjustments(white, 10, white)).toEqual({
      brightness: 0,
      contrast: 0,
      saturation: 0,
    });
  });

  it("地色が暗ければ明るさを上げる", () => {
    const result = computeColorMatchAdjustments({ r: 160, g: 160, b: 160 }, 20, white);
    expect(result.brightness).toBeGreaterThan(0);
    expect(result.saturation).toBe(0); // 無彩色は彩度補正しない
  });

  it("地色が明るすぎれば明るさを下げる", () => {
    const result = computeColorMatchAdjustments(white, 10, { r: 200, g: 200, b: 200 });
    expect(result.brightness).toBeLessThan(0);
  });

  it("インクが写っていなければコントラストを増強しない", () => {
    const bg = { r: 150, g: 150, b: 150 };
    expect(computeColorMatchAdjustments(bg, 145, white).contrast).toBe(0);
  });

  it("結果は -100..100 の整数に収まる", () => {
    const result = computeColorMatchAdjustments({ r: 20, g: 10, b: 5 }, 0, white);
    for (const v of Object.values(result)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-100);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("画素配列版は地色サンプリング結果を用いる", () => {
    const data = solidPixels(100, { r: 160, g: 160, b: 160 });
    const result = computeColorMatchAdjustmentsFromPixels(data, white);
    expect(result.brightness).toBeGreaterThan(0);
  });
});

describe("detectPageRectFromPixels", () => {
  const page: RgbColor = { r: 250, g: 245, b: 230 };
  const bg: RgbColor = { r: 30, g: 30, b: 30 };

  /** 背景色の画像に、ページ色の矩形を描く。 */
  function scene(width: number, height: number, rect: { x: number; y: number; w: number; h: number }) {
    const data = solidPixels(width * height, bg);
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) data.set([page.r, page.g, page.b, 255], (y * width + x) * 4);
    }
    return data;
  }

  it("背景に囲まれたページ矩形を検出する", () => {
    const data = scene(200, 200, { x: 40, y: 30, w: 120, h: 150 });
    const rect = detectPageRectFromPixels(data, 200, 200, page, 120 / 150, { maxSamples: 200 });
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeCloseTo(40, -1);
    expect(rect!.y).toBeCloseTo(30, -1);
    expect(rect!.width).toBeCloseTo(120, -1);
    expect(rect!.height).toBeCloseTo(150, -1);
  });

  it("ページ色の画素が少なすぎる場合は null", () => {
    expect(detectPageRectFromPixels(solidPixels(100 * 100, bg), 100, 100, page, 0.8)).toBeNull();
  });

  it("全面がページ色（境界が見つからない）場合は null", () => {
    expect(detectPageRectFromPixels(solidPixels(100 * 100, page), 100, 100, page, 0.8)).toBeNull();
  });

  it("幅高さ比が期待値から大きく外れる場合は null", () => {
    const data = scene(200, 200, { x: 40, y: 30, w: 120, h: 150 });
    expect(detectPageRectFromPixels(data, 200, 200, page, 3, { maxSamples: 200 })).toBeNull();
  });

  it("サイズ 0 や画素配列不足は null", () => {
    expect(detectPageRectFromPixels(new Uint8ClampedArray(0), 0, 0, page, 1)).toBeNull();
    expect(detectPageRectFromPixels(new Uint8ClampedArray(4), 10, 10, page, 1)).toBeNull();
  });

  it("不正なオプションは RangeError", () => {
    const data = solidPixels(4, bg);
    expect(() => detectPageRectFromPixels(data, 2, 2, page, 0)).toThrow(RangeError);
    expect(() => detectPageRectFromPixels(data, 2, 2, page, 1, { maxSamples: 0 })).toThrow(RangeError);
    expect(() => detectPageRectFromPixels(data, 2, 2, page, 1, { profileRatioThreshold: 0 })).toThrow(
      RangeError,
    );
    expect(() => detectPageRectFromPixels(data, 2, 2, page, 1, { minPageAreaRatio: 2 })).toThrow(RangeError);
  });
});
