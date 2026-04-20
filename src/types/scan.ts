/** 2D 座標点。 */
export type Point = {
  x: number;
  y: number;
};

/** 切り抜き矩形（ピクセル単位）。ParagraphObject と PhotoObject で共用。 */
export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** 台形補正パラメータ（元画像上の4隅座標）。 */
export type PerspectiveParams = {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
};

/** 画像補正結果オブジェクト。ScanPage.correction が未設定なら補正未実施。 */
export type CorrectionResult = {
  correctedAt: string;
  skipped: boolean;
  perspective?: PerspectiveParams;
  rotation?: number;
  adjustments?: {
    brightness?: number;
    contrast?: number;
    sharpness?: number;
    backgroundRemoval?: boolean; // 地色除去（背景を白に）
  };
};

/** OCR 結果。段落ごとに独立して実行される。 */
export type OcrResult = {
  ocrAt: string;
  engine: "tesseract" | "vision";
  text: string;
  editedText?: string;
  skipped: boolean;
};

/** 段落オブジェクト。補正後の仮想画像上の切り抜き座標を持つ。 */
export type ParagraphObject = {
  id: string;
  order: number;
  cropRect: CropRect;
  ocr?: OcrResult;
};

/** 段落分割結果。 */
export type SplitResult = {
  splitAt: string;
  paragraphs: ParagraphObject[];
};

/** スキャンページ。1枚の取り込み画像に対応。 */
export type ScanPage = {
  id: string;
  capturedAt: string;
  originalFileId: string;
  correction?: CorrectionResult;
  split?: SplitResult;
};

/** スキャンセッション。複数ページをまとめる単位。 */
export type ScanSession = {
  id: string;
  createdAt: string;
  pages: ScanPage[];
};
