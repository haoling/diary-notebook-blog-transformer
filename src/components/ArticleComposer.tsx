"use client";

import { useState, useEffect, useCallback, useMemo, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAuth } from "@/lib/auth-context";
import { useInitializeApp } from "@/lib/use-initialize-app";
import { createDriveClient } from "@/lib/drive-client";
import {
  ArticleManager,
  createEmptyArticle,
  findParagraph,
  blockKey,
  paragraphKey,
  photoKey,
  useCorrectedPageImages,
  usePhotoThumbnails,
  type AvailableParagraph,
} from "@/lib/article-manager";
import { PhotoImporter } from "@/lib/photo-importer";
import { ObjectCard, type ObjectCardPreview } from "@/components/ObjectCard";
import { BlockPalette } from "@/components/BlockPalette";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FolderPickerDialog } from "@/components/folder-picker-dialog";
import type { Article, ArticleBlock } from "@/types/article";
import type { ScanSession, ScanPage } from "@/types/scan";
import type { PhotoObject } from "@/types/photo";

const COMPOSED_DROPPABLE_ID = "__composed_area__";

const PUBLISH_TARGET_OPTIONS: Array<{ id: Article["publishTargets"][number]; label: string }> = [
  { id: "private", label: "非公開" },
  { id: "wordpress", label: "WordPress" },
  { id: "zenn", label: "Zenn" },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// 合成済みブロックカード（並び替え可能）
// ---------------------------------------------------------------------------

function ComposedParagraphCard({
  block,
  index,
  resolved,
  imageUrl,
  imageLoading,
  onDelete,
}: {
  block: Extract<ArticleBlock, { type: "paragraph" }>;
  index: number;
  resolved: AvailableParagraph | null;
  imageUrl: string | null;
  imageLoading: boolean;
  onDelete: () => void;
}) {
  const key = paragraphKey(block.sessionId, block.paragraphId);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: key,
    data: { source: "composed", block },
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
  };

  if (!resolved) {
    return (
      <ObjectCard
        preview={{ kind: "text", text: "" }}
        label="⚠️ 段落が見つかりません"
        subLabel="削除されたか、参照が壊れています"
        index={index}
        onDelete={onDelete}
        dragHandleProps={{ attributes, listeners }}
        setNodeRef={setNodeRef}
        style={style}
        isDragging={isDragging}
      />
    );
  }

  const ocr = resolved.paragraph.ocr;
  const ocrText = ocr && !ocr.skipped ? (ocr.editedText ?? ocr.text) : null;
  const preview: ObjectCardPreview =
    ocrText !== null
      ? { kind: "text", text: ocrText }
      : { kind: "paragraph-image", imageUrl, cropRect: resolved.paragraph.cropRect, loading: imageLoading };

  return (
    <ObjectCard
      preview={preview}
      label={ocrText !== null ? "📝 テキスト段落" : "🖼️ 画像段落"}
      subLabel={formatDate(resolved.sessionCreatedAt)}
      index={index}
      onDelete={onDelete}
      dragHandleProps={{ attributes, listeners }}
      setNodeRef={setNodeRef}
      style={style}
      isDragging={isDragging}
    />
  );
}

function ComposedPhotoCard({
  block,
  index,
  photo,
  imageUrl,
  imageLoading,
  onDelete,
}: {
  block: Extract<ArticleBlock, { type: "photo" }>;
  index: number;
  photo: PhotoObject | null;
  imageUrl: string | null;
  imageLoading: boolean;
  onDelete: () => void;
}) {
  const key = photoKey(block.photoId);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: key,
    data: { source: "composed", block },
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
  };

  return (
    <ObjectCard
      preview={{ kind: "photo", imageUrl, loading: imageLoading }}
      label={photo ? `📷 ${photo.title ?? "写真"}` : "⚠️ 写真が見つかりません"}
      subLabel={photo ? (photo.sourceType === "google_photos" ? "Google Photos" : "Google Drive") : undefined}
      index={index}
      onDelete={onDelete}
      dragHandleProps={{ attributes, listeners }}
      setNodeRef={setNodeRef}
      style={style}
      isDragging={isDragging}
    />
  );
}

// ---------------------------------------------------------------------------
// 合成エリア（ドロップ可能なコンテナ）
// ---------------------------------------------------------------------------

function ComposedArea({ children, isEmpty }: { children: React.ReactNode; isEmpty: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: COMPOSED_DROPPABLE_ID });
  return (
    <div
      ref={setNodeRef}
      className={`space-y-3 min-h-[140px] rounded-lg border-2 border-dashed p-3 transition-colors ${
        isOver ? "border-blue-400 bg-blue-50" : "border-slate-200"
      }`}
    >
      {isEmpty ? (
        <p className="text-sm text-slate-400 text-center py-10">
          下のパレットから段落・写真をドラッグ&ドロップ、または「+追加」ボタンで記事に追加してください。
        </p>
      ) : (
        children
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// メインコンポーネント
// ---------------------------------------------------------------------------

export type ArticleComposerProps = {
  /** 既存記事を編集する場合の記事 ID。未指定の場合は新規作成。 */
  articleId?: string;
};

/**
 * 記事エディタ本体。段落オブジェクト・写真オブジェクトをドラッグ&ドロップで
 * 配置して記事を構成し、タイトル・日付とともに appDataFolder へ保存する。
 */
export function ArticleComposer({ articleId }: ArticleComposerProps) {
  const router = useRouter();
  const { accessToken } = useAuth();
  const { status, indexManager, sessionManager, error: initError, handleFolderSelected } = useInitializeApp();

  const [article, setArticle] = useState<Article | null>(null);
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [photos, setPhotos] = useState<PhotoObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // アクセストークン単位でマネージャ類をメモ化
  const managers = useMemo(() => {
    if (!accessToken || !indexManager) return null;
    const client = createDriveClient(accessToken);
    return {
      client,
      articleManager: new ArticleManager(client, indexManager),
      photoImporter: new PhotoImporter(client, indexManager, accessToken),
    };
  }, [accessToken, indexManager]);

  // ---- 初期データ読み込み ----

  useEffect(() => {
    if (status !== "ready" || !managers || !sessionManager) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    async function load() {
      try {
        const [loadedSessions, loadedPhotos, loadedArticle] = await Promise.all([
          sessionManager!.listAllSessions(),
          managers!.photoImporter.listAllPhotos(),
          articleId ? managers!.articleManager.loadArticle(articleId) : Promise.resolve(createEmptyArticle()),
        ]);
        if (cancelled) return;
        setSessions(loadedSessions);
        setPhotos(loadedPhotos);
        setArticle(loadedArticle);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "記事の読み込みに失敗しました。");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [status, articleId, sessionManager, managers]);

  // ---- 合成済みブロックの解決 ----

  const composedParagraphResolved = useMemo(() => {
    const map = new Map<string, AvailableParagraph | null>();
    if (!article) return map;
    for (const block of article.blocks) {
      if (block.type !== "paragraph") continue;
      map.set(blockKey(block), findParagraph(sessions, block.sessionId, block.paragraphId));
    }
    return map;
  }, [article, sessions]);

  const composedImagePages = useMemo(() => {
    const pages = new Map<string, ScanPage>();
    for (const resolved of composedParagraphResolved.values()) {
      if (!resolved) continue;
      const ocr = resolved.paragraph.ocr;
      const hasText = ocr && !ocr.skipped && (ocr.editedText ?? ocr.text);
      if (!hasText && !pages.has(resolved.page.id)) pages.set(resolved.page.id, resolved.page);
    }
    return [...pages.values()];
  }, [composedParagraphResolved]);

  const composedPhotos = useMemo(() => {
    const map = new Map<string, PhotoObject>();
    if (!article) return map;
    for (const block of article.blocks) {
      if (block.type !== "photo") continue;
      const photo = photos.find((p) => p.id === block.photoId);
      if (photo) map.set(photo.id, photo);
    }
    return map;
  }, [article, photos]);

  const composedPhotoList = useMemo(() => [...composedPhotos.values()], [composedPhotos]);

  const composedPageImages = useCorrectedPageImages(managers?.client ?? null, composedImagePages);
  const composedPhotoThumbs = usePhotoThumbnails(
    managers?.client ?? null,
    managers?.photoImporter ?? null,
    composedPhotoList,
  );

  const usedKeys = useMemo(
    () => new Set(article ? article.blocks.map(blockKey) : []),
    [article],
  );

  // ---- ブロック操作 ----

  const handleAddBlock = useCallback((block: ArticleBlock) => {
    setArticle((prev) => {
      if (!prev) return prev;
      const key = blockKey(block);
      if (prev.blocks.some((b) => blockKey(b) === key)) return prev;
      return { ...prev, blocks: [...prev.blocks, block] };
    });
  }, []);

  const handleDeleteBlock = useCallback((key: string) => {
    setArticle((prev) => (prev ? { ...prev, blocks: prev.blocks.filter((b) => blockKey(b) !== key) } : prev));
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as
      | { source: "palette" | "composed"; block: ArticleBlock }
      | undefined;
    if (!activeData) return;

    const overId = String(over.id);

    if (activeData.source === "palette") {
      const key = blockKey(activeData.block);
      setArticle((prev) => {
        if (!prev) return prev;
        if (prev.blocks.some((b) => blockKey(b) === key)) return prev;
        const blocks = [...prev.blocks];
        const overIndex = blocks.findIndex((b) => blockKey(b) === overId);
        if (overIndex === -1) {
          blocks.push(activeData.block);
        } else {
          blocks.splice(overIndex, 0, activeData.block);
        }
        return { ...prev, blocks };
      });
      return;
    }

    if (overId === String(active.id) || overId === COMPOSED_DROPPABLE_ID) return;
    setArticle((prev) => {
      if (!prev) return prev;
      const oldIndex = prev.blocks.findIndex((b) => blockKey(b) === String(active.id));
      const newIndex = prev.blocks.findIndex((b) => blockKey(b) === overId);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return { ...prev, blocks: arrayMove(prev.blocks, oldIndex, newIndex) };
    });
  }, []);

  // ---- 保存・削除 ----

  const handleSave = useCallback(async () => {
    if (!article || !managers) return;
    setSaving(true);
    setSaveError(null);
    try {
      await managers.articleManager.saveArticle(article);
      setSavedAt(Date.now());
      if (!articleId) {
        router.replace(`/articles/${article.id}`);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "記事の保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }, [article, managers, articleId, router]);

  const handleDelete = useCallback(async () => {
    if (!article || !managers) return;
    setDeleting(true);
    try {
      await managers.articleManager.deleteArticle(article.id);
      setDeleteConfirmOpen(false);
      router.push("/articles");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "記事の削除に失敗しました。");
    } finally {
      setDeleting(false);
    }
  }, [article, managers, router]);

  // ---- レンダリング ----

  if (status === "loading" || (status === "ready" && loading)) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-400">読み込み中...</div>
      </div>
    );
  }

  if (status === "needsFolderSelection") {
    return (
      <div>
        <div className="text-center py-12">
          <div className="text-3xl mb-4">📁</div>
          <p className="text-slate-600 mb-6">
            手帳スキャン画像の保存先フォルダを選択してください。
          </p>
        </div>
        <FolderPickerDialog
          accessToken={accessToken ?? ""}
          onSelect={handleFolderSelected}
          onCancel={() => router.push("/settings")}
        />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="text-center py-12">
        <div className="text-3xl mb-4">⚠️</div>
        <p className="text-red-600 mb-2">初期化に失敗しました</p>
        {initError && <p className="text-sm text-slate-500">{initError.message}</p>}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="text-center py-12">
        <div className="text-3xl mb-4">⚠️</div>
        <p className="text-red-600">{loadError}</p>
      </div>
    );
  }

  if (!article) return null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="space-y-8">
        {/* タイトル・日付・公開先 */}
        <div className="space-y-3">
          <input
            type="text"
            value={article.title}
            onChange={(e) => setArticle((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
            placeholder="記事タイトル"
            className="w-full text-xl font-bold text-slate-800 border-b border-slate-200 focus:border-blue-400 outline-none px-1 py-2"
          />
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              日付
              <input
                type="date"
                value={article.date}
                onChange={(e) => setArticle((prev) => (prev ? { ...prev, date: e.target.value } : prev))}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600">公開先</span>
              {PUBLISH_TARGET_OPTIONS.map((opt) => (
                <label key={opt.id} className="inline-flex items-center gap-1 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={article.publishTargets.includes(opt.id)}
                    onChange={(e) =>
                      setArticle((prev) => {
                        if (!prev) return prev;
                        const targets = e.target.checked
                          ? [...prev.publishTargets, opt.id]
                          : prev.publishTargets.filter((t) => t !== opt.id);
                        return { ...prev, publishTargets: targets };
                      })
                    }
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {saveError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {saveError}
          </div>
        )}

        {/* 記事の構成 */}
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">
            記事の構成（{article.blocks.length} ブロック）
          </h2>
          <SortableContext items={article.blocks.map(blockKey)} strategy={verticalListSortingStrategy}>
            <ComposedArea isEmpty={article.blocks.length === 0}>
              {article.blocks.map((block, index) => {
                if (block.type === "paragraph") {
                  const key = blockKey(block);
                  const resolved = composedParagraphResolved.get(key) ?? null;
                  const pageImage = resolved ? composedPageImages[resolved.page.id] : undefined;
                  return (
                    <ComposedParagraphCard
                      key={key}
                      block={block}
                      index={index}
                      resolved={resolved}
                      imageUrl={pageImage?.url ?? null}
                      imageLoading={pageImage?.status !== "ready" && pageImage?.status !== "error"}
                      onDelete={() => handleDeleteBlock(key)}
                    />
                  );
                }
                const key = blockKey(block);
                const photo = composedPhotos.get(block.photoId) ?? null;
                const thumb = composedPhotoThumbs[block.photoId];
                return (
                  <ComposedPhotoCard
                    key={key}
                    block={block}
                    index={index}
                    photo={photo}
                    imageUrl={thumb?.url ?? null}
                    imageLoading={thumb?.status !== "ready" && thumb?.status !== "error"}
                    onDelete={() => handleDeleteBlock(key)}
                  />
                );
              })}
            </ComposedArea>
          </SortableContext>
        </div>

        {/* 保存・削除 操作 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !managers}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? "保存中..." : "💾 保存"}
            </button>
            {savedAt && !saving && <span className="text-xs text-slate-400">保存しました</span>}
          </div>
          {articleId && (
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(true)}
              className="text-sm text-red-500 hover:text-red-700"
            >
              🗑️ 記事を削除
            </button>
          )}
        </div>

        {/* ブロックパレット */}
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">追加できるブロック</h2>
          {managers ? (
            <BlockPalette
              sessions={sessions}
              photos={photos}
              usedKeys={usedKeys}
              client={managers.client}
              photoImporter={managers.photoImporter}
              onAdd={handleAddBlock}
            />
          ) : (
            <p className="text-sm text-slate-400">読み込み中...</p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="記事の削除"
        message="この記事を削除しますか？この操作は取り消せません。"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </DndContext>
  );
}
