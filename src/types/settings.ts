/** アプリのユーザー設定。appDataFolder に保存される。 */
export type Settings = {
  visionApiKey?: string;
  notebookImageFolderId?: string;
  notebookImageFolderName?: string;
};

/** index.json 内のセッションエントリ。 */
export type IndexSessionEntry = {
  id: string;
  createdAt: string;
};

/** index.json 内の写真エントリ。 */
export type IndexPhotoEntry = {
  id: string;
  importedAt: string;
  sourceType: "google_photos" | "google_drive";
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
};
