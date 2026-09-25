/**
 * 手帳キャリブレーションモジュール。
 *
 * 罫線グリッド検出・空白行除去・地色記憶による自動色補正など、
 * 手帳プロファイル・キャリブレーションを利用した新方式の各種アルゴリズムを提供する。
 */

import type { ParagraphObject, SplitResult } from "@/types/scan";

/**
 * ParagraphObject[] から SplitResult を生成する。
 */
export function createSplitResult(paragraphs: ParagraphObject[]): SplitResult {
  return {
    splitAt: new Date().toISOString(),
    paragraphs,
  };
}
