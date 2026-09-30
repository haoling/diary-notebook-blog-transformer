import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSplitResult, splitYsToParagraphs } from "./paragraph-detection";

describe("splitYsToParagraphs", () => {
  it("分割点がなければ画像全体で 1 段落になる", () => {
    const result = splitYsToParagraphs([], 800, 1000);
    expect(result).toHaveLength(1);
    expect(result[0].cropRect).toEqual({ x: 0, y: 0, width: 800, height: 1000 });
    expect(result[0].order).toBe(0);
  });

  it("分割点で隣接する段落に分割され、高さの合計が画像高さに一致する", () => {
    const result = splitYsToParagraphs([300, 700], 800, 1000);
    expect(result.map((p) => p.cropRect.y)).toEqual([0, 300, 700]);
    expect(result.map((p) => p.cropRect.height)).toEqual([300, 400, 300]);
    expect(result.map((p) => p.order)).toEqual([0, 1, 2]);
    expect(result.every((p) => p.cropRect.width === 800 && p.cropRect.x === 0)).toBe(true);
  });

  it("未ソート・重複・範囲外の分割点を正規化する", () => {
    const result = splitYsToParagraphs([700, 300, 300, 0, -5, 1000, 1200], 800, 1000);
    expect(result.map((p) => p.cropRect.y)).toEqual([0, 300, 700]);
  });

  it("入力配列を変更しない", () => {
    const ys = [700, 300];
    splitYsToParagraphs(ys, 800, 1000);
    expect(ys).toEqual([700, 300]);
  });

  it("段落 ID は一意で、OCR 結果は未設定（未実施）", () => {
    const result = splitYsToParagraphs([100, 200, 300], 10, 400);
    expect(new Set(result.map((p) => p.id)).size).toBe(result.length);
    expect(result.every((p) => p.ocr === undefined)).toBe(true);
  });
});

describe("createSplitResult", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("分割日時と段落をまとめる", () => {
    const paragraphs = splitYsToParagraphs([50], 100, 100);
    expect(createSplitResult(paragraphs)).toEqual({
      splitAt: "2026-01-02T03:04:05.000Z",
      paragraphs,
    });
  });
});
