import type { NotebookSizePreset, LineHeightPreset } from "@/types/settings";

/** サイズプリセットのうち "custom"（手動入力）を除いたキー。 */
type SizePresetKey = Exclude<NotebookSizePreset, "custom">;

/** 行高プリセットのうち "custom"（手動入力）を除いたキー。 */
type LineHeightPresetKey = Exclude<LineHeightPreset, "custom">;

/** 手帳のサイズプリセット定義。 */
export type NotebookSizePresetDefinition = {
  label: string;
  widthMm: number;
  heightMm: number;
};

/**
 * 手帳サイズプリセットの mm 値。
 *
 * 一般的なシステム手帳・ノートサイズを参考にした値であり、実際の手帳との差異は
 * "custom" プリセットで上書きすることを前提とする。
 */
export const NOTEBOOK_SIZE_PRESETS: Record<
  SizePresetKey,
  NotebookSizePresetDefinition
> = {
  mini6ring: { label: "ミニ6穴", widthMm: 80, heightMm: 126 },
  bible: { label: "バイブルサイズ", widthMm: 95, heightMm: 171 },
  a5: { label: "A5", widthMm: 148, heightMm: 210 },
  b6: { label: "B6", widthMm: 128, heightMm: 182 },
};

/**
 * 罫線の行高プリセットの mm 値。
 *
 * 実際の手帳との差異は "custom" プリセットで上書きすることを前提とする。
 */
export const LINE_HEIGHT_PRESETS: Record<LineHeightPresetKey, number> = {
  "6mm": 6,
  "7mm": 7,
  "8mm": 8,
};
