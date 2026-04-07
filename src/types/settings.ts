/** アプリのユーザー設定。appDataFolder に保存される。 */
export type Settings = {
  visionApiKey?: string;
  notebookImageFolderId?: string;
  notebookImageFolderName?: string;
  /** 永続化ごとにインクリメントされるバージョン番号。 */
  version?: number;
};

/** index.json 内のセッションエントリ。 */
export type IndexSessionEntry = {
  id: string;
  createdAt: string;
};

/** 写真データの取得元種別。 */
export type PhotoSourceType = "google_photos" | "google_drive";

/** index.json 内の写真エントリ。 */
export type IndexPhotoEntry = {
  id: string;
  importedAt: string;
  sourceType: PhotoSourceType;
};

/** index.json 内の記事エントリ。 */
export type IndexArticleEntry = {
  id: string;
  title: string;
  date: string;
};

/** index.json の全体構造。 */
export type AppIndex = {
  sessions: IndexSessionEntry[];
  photos: IndexPhotoEntry[];
  articles: IndexArticleEntry[];
  /** 永続化ごとにインクリメントされるバージョン番号。 */
  version?: number;
};
