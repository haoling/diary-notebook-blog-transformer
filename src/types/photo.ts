import type { CropRect } from './scan'

export type PhotoObject = {
  id: string
  importedAt: string
  sourceType: 'google_photos' | 'google_drive'
  sourceRef: string
  title?: string
  takenAt?: string
  cropRect?: CropRect
}
