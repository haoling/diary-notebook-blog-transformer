"use client";

import { useState, useEffect, useRef } from "react";
import { DriveClient } from "./drive-client";
import { DriveNotFoundError } from "./drive-errors";
import { IndexManager } from "./index-manager";
import { applyCorrections } from "./image-processing";
import { PhotoImporter } from "./photo-importer";
import { getCachedPhotoThumbnail, setCachedPhotoThumbnail } from "./photo-cache";
import type { Article, ArticleBlock } from "@/types/article";
import type { ScanPage, ScanSession, ParagraphObject } from "@/types/scan";
import type { PhotoObject } from "@/types/photo";

const ARTICLE_FILE_PREFIX = "article_";

/** appDataFolder 内の記事ファイル名を生成する。 */
function articleFileName(id: string): string {
  return `${ARTICLE_FILE_PREFIX}${id}.json`;
}

/** ファイル名から記事 ID を抽出する。 */
function parseArticleFileName(name: string): string | null {
  if (!name.startsWith(ARTICLE_FILE_PREFIX) || !name.endsWith(".json")) {
    return null;
  }
  return name.slice(ARTICLE_FILE_PREFIX.length, -".json".length);
}

/** 新しい ID を生成する。 */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 空の記事オブジェクトを生成する（未保存の新規作成用）。 */
export function createEmptyArticle(): Article {
  return {
    id: generateId(),
    title: "",
    date: new Date().toISOString().slice(0, 10),
    blocks: [],
    publishTargets: [],
  };
}

/**
 * appDataFolder 上の記事（Article）を管理するクラス。
 *
 * - 記事の読み込み・保存（upsert）・削除
 * - 保存のたびに IndexManager の記事エントリを同期して更新
 * - 同一記事 ID に対するミューテーションを直列化する
 */
export class ArticleManager {
  private readonly client: DriveClient;
  private readonly indexManager: IndexManager;
  private readonly mutationChains = new Map<string, Promise<void>>();

  constructor(client: DriveClient, indexManager: IndexManager) {
    this.client = client;
    this.indexManager = indexManager;
  }

  /** 記事ID単位でミューテーションを直列化する。 */
  private async runSerialized(articleId: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.mutationChains.get(articleId) ?? Promise.resolve();
    const next = prev.then(() => fn(), () => fn());
    this.mutationChains.set(articleId, next);
    try {
      await next;
    } finally {
      if (this.mutationChains.get(articleId) === next) {
        this.mutationChains.delete(articleId);
      }
    }
  }

  /** 記事の appDataFolder ファイル ID を取得する。 */
  private async getArticleFileId(id: string): Promise<string> {
    const file = await this.client.findAppDataFileByName(articleFileName(id));
    return file.id;
  }

  /** 記事を読み込む。 */
  async loadArticle(id: string): Promise<Article> {
    const result = await this.client.getAppDataFileByName<Article>(articleFileName(id));
    const { _fileId: _, _file: __, ...article } = result;
    return article as Article;
  }

  /** 記事を appDataFolder に保存する（新規作成・更新の両方に対応する upsert）。 */
  async saveArticle(article: Article): Promise<void> {
    await this.runSerialized(article.id, async () => {
      const fileName = articleFileName(article.id);
      let createdFileId: string | null = null;
      try {
        const fileId = await this.getArticleFileId(article.id);
        await this.client.updateFileContent(fileId, article);
      } catch (err) {
        if (err instanceof DriveNotFoundError) {
          const created = await this.client.createAppDataFile(fileName, article);
          createdFileId = created.id;
        } else {
          throw err;
        }
      }

      try {
        await this.indexManager.addArticle({
          id: article.id,
          title: article.title,
          date: article.date,
        });
      } catch (indexErr) {
        // 新規作成時のみロールバック対象。既存ファイルの更新失敗はデータ喪失になるため削除しない
        if (createdFileId) {
          try {
            await this.client.deleteFile(createdFileId);
          } catch (rollbackErr) {
            console.warn(
              `インデックス更新失敗後の記事ファイルロールバックに失敗しました (fileId: ${createdFileId}):`,
              rollbackErr,
            );
          }
        }
        throw indexErr;
      }
    });
  }

  /** 記事を削除する（appDataFolder のファイルと index から）。 */
  async deleteArticle(id: string): Promise<void> {
    await this.runSerialized(id, async () => {
      try {
        const fileId = await this.getArticleFileId(id);
        await this.client.deleteFile(fileId);
      } catch (err) {
        if (!(err instanceof DriveNotFoundError)) throw err;
      }
      await this.indexManager.removeArticle(id);
    });
  }

  /** appDataFolder 内の全記事を一覧する（index.json とは独立に実ファイルから読み込む）。 */
  async listAllArticles(): Promise<Article[]> {
    const files = await this.client.listAppDataFiles();
    const articleFiles = files.filter((f) => parseArticleFileName(f.name) !== null);

    const articles: Article[] = [];
    for (const file of articleFiles) {
      try {
        const article = await this.client.getFileContent<Article>(file.id);
        articles.push(article);
      } catch (err) {
        console.warn(`記事の読み込みに失敗しました (${file.name}):`, err);
      }
    }

    articles.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return articles;
  }
}

// ---------------------------------------------------------------------------
// 段落オブジェクトの解決ヘルパー
// ---------------------------------------------------------------------------

/** BlockPalette / ArticleComposer で扱う、セッション横断の段落オブジェクト参照。 */
export type AvailableParagraph = {
  sessionId: string;
  sessionCreatedAt: string;
  page: ScanPage;
  paragraph: ParagraphObject;
};

/** 一意なキー（記事ブロックとの照合や dnd-kit の id に使用）。 */
export function paragraphKey(sessionId: string, paragraphId: string): string {
  return `paragraph:${sessionId}:${paragraphId}`;
}

export function photoKey(photoId: string): string {
  return `photo:${photoId}`;
}

/** ArticleBlock から一意なキーを生成する（paragraphKey / photoKey のディスパッチ）。 */
export function blockKey(block: ArticleBlock): string {
  return block.type === "paragraph"
    ? paragraphKey(block.sessionId, block.paragraphId)
    : photoKey(block.photoId);
}

/** 全セッションから、段落分割済みの段落オブジェクトを一覧する。 */
export function listAvailableParagraphs(sessions: ScanSession[]): AvailableParagraph[] {
  const result: AvailableParagraph[] = [];
  for (const session of sessions) {
    for (const page of session.pages) {
      if (!page.split) continue;
      for (const paragraph of page.split.paragraphs) {
        result.push({
          sessionId: session.id,
          sessionCreatedAt: session.createdAt,
          page,
          paragraph,
        });
      }
    }
  }
  return result;
}

/** sessionId + paragraphId から段落オブジェクトとその所属ページを探す。 */
export function findParagraph(
  sessions: ScanSession[],
  sessionId: string,
  paragraphId: string,
): AvailableParagraph | null {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  for (const page of session.pages) {
    const paragraph = page.split?.paragraphs.find((p) => p.id === paragraphId);
    if (paragraph) {
      return { sessionId, sessionCreatedAt: session.createdAt, page, paragraph };
    }
  }
  return null;
}

/**
 * ページの元画像に補正（CorrectionResult）を適用した画像の Blob URL を生成する。
 * 補正が未設定またはスキップされている場合は元画像をそのまま使用する。
 * 呼び出し側は不要になったら URL.revokeObjectURL() を呼ぶこと。
 */
export async function getCorrectedPageImageUrl(
  client: DriveClient,
  page: ScanPage,
): Promise<string> {
  const blob = await client.getFileBlob(page.originalFileId);

  if (!page.correction || page.correction.skipped) {
    return URL.createObjectURL(blob);
  }

  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = await applyCorrections(bitmap, page.correction);
    const outBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("補正済み画像の生成に失敗しました。"));
      }, "image/png");
    });
    return URL.createObjectURL(outBlob);
  } finally {
    bitmap.close();
  }
}

// ---------------------------------------------------------------------------
// 画像解決フック（BlockPalette / ArticleComposer で共用）
// ---------------------------------------------------------------------------

export type ResourceStatus = "loading" | "ready" | "error";
export type ResolvedImage = { status: ResourceStatus; url?: string };

/**
 * ページ ID をキーに、補正適用済み画像の Blob URL を解決するフック。
 * 同一ページへの重複リクエストは抑止し、アンマウント時に生成した URL をすべて解放する。
 */
export function useCorrectedPageImages(
  client: DriveClient | null,
  pages: ScanPage[],
): Record<string, ResolvedImage> {
  const [state, setState] = useState<Record<string, ResolvedImage>>({});
  const [prevClient, setPrevClient] = useState(client);
  const requestedRef = useRef<Set<string>>(new Set());
  // ページ ID → 生成済み Blob URL。対象から外れたページの URL をピンポイントで解放するために使う。
  const urlsByIdRef = useRef<Map<string, string>>(new Map());

  // client（アクセストークン更新等）が切り替わったら、次のレンダー前に state をリセットする。
  // レンダー中に props の変化を検知して state を調整する公式パターン（effect 内での setState は避ける）。
  if (client !== prevClient) {
    setPrevClient(client);
    setState({});
  }

  // client が切り替わったら、旧キャッシュの参照と生成済み URL を解放する。
  // 副作用（URL.revokeObjectURL）のみを扱い、state の更新は行わない。
  useEffect(() => {
    const requested = requestedRef.current;
    const urlsById = urlsByIdRef.current;
    return () => {
      requested.clear();
      urlsById.forEach((url) => URL.revokeObjectURL(url));
      urlsById.clear();
    };
  }, [client]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;

    // pages から外れたページのキャッシュ・Blob URL を解放する
    const currentIds = new Set(pages.map((p) => p.id));
    const staleIds = [...requestedRef.current].filter((id) => !currentIds.has(id));
    if (staleIds.length > 0) {
      for (const id of staleIds) {
        requestedRef.current.delete(id);
        const url = urlsByIdRef.current.get(id);
        if (url) {
          URL.revokeObjectURL(url);
          urlsByIdRef.current.delete(id);
        }
      }
      setState((prev) => {
        const next = { ...prev };
        for (const id of staleIds) delete next[id];
        return next;
      });
    }

    for (const page of pages) {
      if (requestedRef.current.has(page.id)) continue;
      requestedRef.current.add(page.id);

      getCorrectedPageImageUrl(client, page)
        .then((url) => {
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          urlsByIdRef.current.set(page.id, url);
          setState((prev) => ({ ...prev, [page.id]: { status: "ready", url } }));
        })
        .catch((err) => {
          console.warn(`ページ画像の生成に失敗しました (page: ${page.id}):`, err);
          if (!cancelled) {
            setState((prev) => ({ ...prev, [page.id]: { status: "error" } }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [client, pages]);

  return state;
}

/**
 * 写真 ID をキーに、サムネイル画像の Blob URL を解決するフック。
 * Google Drive 由来はファイル内容を直接取得し、Google Photos 由来は
 * mediaItems.get でメディアアイテムを再取得してから baseUrl を認証付き取得する。
 */
export function usePhotoThumbnails(
  client: DriveClient | null,
  photoImporter: PhotoImporter | null,
  photos: PhotoObject[],
): Record<string, ResolvedImage> {
  const [state, setState] = useState<Record<string, ResolvedImage>>({});
  const [prevDeps, setPrevDeps] = useState<{ client: DriveClient | null; photoImporter: PhotoImporter | null }>({
    client,
    photoImporter,
  });
  const requestedRef = useRef<Set<string>>(new Set());
  // 写真 ID → 生成済み Blob URL。対象から外れた写真の URL をピンポイントで解放するために使う。
  const urlsByIdRef = useRef<Map<string, string>>(new Map());

  // client / photoImporter（アクセストークン更新等）が切り替わったら、次のレンダー前に state をリセットする。
  // レンダー中に props の変化を検知して state を調整する公式パターン（effect 内での setState は避ける）。
  if (client !== prevDeps.client || photoImporter !== prevDeps.photoImporter) {
    setPrevDeps({ client, photoImporter });
    setState({});
  }

  // client / photoImporter が切り替わったら、旧キャッシュの参照と生成済み URL を解放する。
  // 副作用（URL.revokeObjectURL）のみを扱い、state の更新は行わない。
  useEffect(() => {
    const requested = requestedRef.current;
    const urlsById = urlsByIdRef.current;
    return () => {
      requested.clear();
      urlsById.forEach((url) => URL.revokeObjectURL(url));
      urlsById.clear();
    };
  }, [client, photoImporter]);

  useEffect(() => {
    if (!client || !photoImporter) return;
    let cancelled = false;

    async function fetchThumbnailBlob(photo: PhotoObject): Promise<Blob> {
      if (photo.sourceType === "google_drive") {
        return client!.getFileBlob(photo.sourceRef);
      }
      const item = await photoImporter!.getMediaItem(photo.sourceRef);
      const url = PhotoImporter.getThumbnailUrl(item.mediaFile.baseUrl, 256, 256);
      return photoImporter!.fetchDriveThumbnailBlob(url);
    }

    // 一度取得したサムネイルは IndexedDB にキャッシュし、
    // Photos の baseUrl 期限切れや API 呼び出し回数を気にせず再利用する。
    async function resolve(photo: PhotoObject): Promise<string> {
      const cached = await getCachedPhotoThumbnail(photo.id);
      if (cached) return URL.createObjectURL(cached);

      const blob = await fetchThumbnailBlob(photo);
      setCachedPhotoThumbnail(photo.id, blob).catch(() => {});
      return URL.createObjectURL(blob);
    }

    // photos から外れた写真のキャッシュ・Blob URL を解放する
    const currentIds = new Set(photos.map((p) => p.id));
    const staleIds = [...requestedRef.current].filter((id) => !currentIds.has(id));
    if (staleIds.length > 0) {
      for (const id of staleIds) {
        requestedRef.current.delete(id);
        const url = urlsByIdRef.current.get(id);
        if (url) {
          URL.revokeObjectURL(url);
          urlsByIdRef.current.delete(id);
        }
      }
      setState((prev) => {
        const next = { ...prev };
        for (const id of staleIds) delete next[id];
        return next;
      });
    }

    for (const photo of photos) {
      if (requestedRef.current.has(photo.id)) continue;
      requestedRef.current.add(photo.id);

      resolve(photo)
        .then((url) => {
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          urlsByIdRef.current.set(photo.id, url);
          setState((prev) => ({ ...prev, [photo.id]: { status: "ready", url } }));
        })
        .catch((err) => {
          console.warn(`写真サムネイルの取得に失敗しました (photo: ${photo.id}):`, err);
          if (!cancelled) {
            setState((prev) => ({ ...prev, [photo.id]: { status: "error" } }));
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [client, photoImporter, photos]);

  return state;
}
