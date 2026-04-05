import type { CropRect } from "./scan";
import type { PhotoSourceType } from "./settings";

/** Google Photos または Google Drive から取り込んだ写真オブジェクト。 */
export type PhotoObject = {
  id: string;
  importedAt: string;
  sourceType: PhotoSourceType;
  sourceRef: string;
  title?: string;
  takenAt?: string;
  cropRect?: CropRect;
};
