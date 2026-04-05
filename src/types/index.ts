/** スキャンセッション関連の型。 */
export type {
  Point,
  CropRect,
  PerspectiveParams,
  CorrectionResult,
  OcrResult,
  ParagraphObject,
  SplitResult,
  ScanPage,
  ScanSession,
} from "./scan";

/** 写真オブジェクト関連の型。 */
export type { PhotoObject } from "./photo";

/** 記事・ブロック関連の型。 */
export type {
  ParagraphBlock,
  PhotoBlock,
  ArticleBlock,
  Article,
} from "./article";

/** ユーザー設定・インデックス関連の型。 */
export type {
  Settings,
  IndexSessionEntry,
  PhotoSourceType,
  IndexPhotoEntry,
  IndexArticleEntry,
  AppIndex,
} from "./settings";
