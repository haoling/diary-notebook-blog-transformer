export type Point = {
  x: number
  y: number
}

export type CropRect = {
  x: number
  y: number
  width: number
  height: number
}

export type PerspectiveParams = {
  topLeft: Point
  topRight: Point
  bottomRight: Point
  bottomLeft: Point
}

export type CorrectionResult = {
  correctedAt: string
  skipped: boolean
  perspective?: PerspectiveParams
  rotation?: number
  adjustments?: {
    brightness?: number
    contrast?: number
    sharpness?: number
  }
}

export type OcrResult = {
  ocrAt: string
  engine: 'tesseract' | 'vision'
  text: string
  editedText?: string
  skipped: boolean
}

export type ParagraphObject = {
  id: string
  order: number
  cropRect: CropRect
  ocr?: OcrResult
}

export type SplitResult = {
  splitAt: string
  paragraphs: ParagraphObject[]
}

export type ScanPage = {
  id: string
  capturedAt: string
  originalFileId: string
  correction?: CorrectionResult
  split?: SplitResult
}

export type ScanSession = {
  id: string
  createdAt: string
  pages: ScanPage[]
}
