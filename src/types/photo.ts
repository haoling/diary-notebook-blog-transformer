import type { CropRect } from "./scan";

/** Google Photos または Google Drive から取り込んだ写真オブジェクト。 */
export type PhotoObject = {
  id: string;
  importedAt: string;
  sourceType: "google_photos" | "google_drive";
  sourceRef: string;
  title?: string;
  takenAt?: string;
  cropRect?: CropRect;
};
