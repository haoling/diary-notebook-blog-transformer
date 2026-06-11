import type { PhotoSourceType } from "./settings";

/**
 * 写真の切り抜き矩形。PhotoObject 専用の正規化座標（0..1）。
 * scan.ts の CropRect（ピクセル単位）とは別の型。
 */
export type NormalizedCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Google Photos または Google Drive から取り込んだ写真オブジェクト。 */
export type PhotoObject = {
  id: string;
  importedAt: string;
  sourceType: PhotoSourceType;
  sourceRef: string;
  title?: string;
  takenAt?: string;
  /** 切り抜き矩形（正規化座標 0..1）。 */
  cropRect?: NormalizedCropRect;
};
