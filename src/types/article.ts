/** 記事内の段落ブロック。スキャンセッションの特定段落を参照。 */
export type ParagraphBlock = {
  type: "paragraph";
  sessionId: string;
  paragraphId: string;
};

/** 記事内の写真ブロック。写真オブジェクトを参照。 */
export type PhotoBlock = {
  type: "photo";
  photoId: string;
};

/** 記事ブロックのユニオン型。 */
export type ArticleBlock = ParagraphBlock | PhotoBlock;

/** ブログ記事。段落と写真のブロックで構成される。 */
export type Article = {
  id: string;
  title: string;
  date: string;
  blocks: ArticleBlock[];
  publishTargets: Array<"wordpress" | "zenn" | "private">;
};
