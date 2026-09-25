/**
 * 手帳キャリブレーションモジュール。
 *
 * 罫線グリッド検出・空白行除去・地色記憶による自動色補正など、
 * 手帳プロファイル・キャリブレーションを利用した新方式の各種アルゴリズムを提供する。
 */

import type { ParagraphObject, SplitResult } from "@/types/scan";
import type { NotebookProfile } from "@/types/settings";

/**
 * ParagraphObject[] から SplitResult を生成する。
 */
export function createSplitResult(paragraphs: ParagraphObject[]): SplitResult {
  return {
    splitAt: new Date().toISOString(),
    paragraphs,
  };
}

/**
 * 手帳プロファイルから、画像上で罫線が何 px 間隔で並ぶか（期待ピッチ）を算出する。
 */
export function computeExpectedPitchPx(
  imageHeightPx: number,
  profile: NotebookProfile,
): number {
  return (imageHeightPx * profile.lineHeightMm) / profile.pageHeightMm;
}

/**
 * 罫線の y 座標（px）の配列を、画像高さに対する比率（0..1）の配列に変換する。
 * 結果は昇順にソートされる。
 */
export function pixelYsToLineYRatios(
  lineYs: number[],
  imageHeightPx: number,
): number[] {
  return [...lineYs].sort((a, b) => a - b).map((y) => y / imageHeightPx);
}

/**
 * 罫線の y 座標の比率（0..1）の配列を、画像高さに応じた px 座標の配列に変換する。
 */
export function lineYRatiosToPixelYs(
  lineYRatios: number[],
  imageHeightPx: number,
): number[] {
  return lineYRatios.map((ratio) => ratio * imageHeightPx);
}
