"use client";

import { useState, useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ObjectCard, type ObjectCardPreview } from "@/components/ObjectCard";
import {
  listAvailableParagraphs,
  paragraphKey,
  photoKey,
  useCorrectedPageImages,
  usePhotoThumbnails,
  type AvailableParagraph,
} from "@/lib/article-manager";
import { PhotoImporter } from "@/lib/photo-importer";
import { DriveClient } from "@/lib/drive-client";
import type { ArticleBlock } from "@/types/article";
import type { ScanSession } from "@/types/scan";
import type { PhotoObject } from "@/types/photo";

export type BlockPaletteProps = {
  /** 全セッション（段落オブジェクトの供給元）。 */
  sessions: ScanSession[];
  /** 取り込み済みの全写真オブジェクト。 */
  photos: PhotoObject[];
  /** 既に記事に追加済みのブロックキー（paragraphKey / photoKey）。パレットから除外する。 */
  usedKeys: Set<string>;
  client: DriveClient;
  photoImporter: PhotoImporter;
  onAdd: (block: ArticleBlock) => void;
};

type Tab = "paragraph" | "photo";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

function sourceLabel(photo: PhotoObject): string {
  return photo.sourceType === "google_photos" ? "Google Photos" : "Google Drive";
}

// ---------------------------------------------------------------------------
// パレットカード（ドラッグ可能）
// ---------------------------------------------------------------------------

function PaletteParagraphCard({
  item,
  imageUrl,
  imageLoading,
  onAdd,
}: {
  item: AvailableParagraph;
  imageUrl: string | null;
  imageLoading: boolean;
  onAdd: () => void;
}) {
  const key = paragraphKey(item.sessionId, item.paragraph.id);
  const block: ArticleBlock = {
    type: "paragraph",
    sessionId: item.sessionId,
    paragraphId: item.paragraph.id,
  };
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: key,
    data: { source: "palette", block },
  });

  const ocr = item.paragraph.ocr;
  const ocrText = ocr && !ocr.skipped ? (ocr.editedText ?? ocr.text) : null;

  const preview: ObjectCardPreview =
    ocrText !== null
      ? { kind: "text", text: ocrText }
      : { kind: "paragraph-image", imageUrl, cropRect: item.paragraph.cropRect, loading: imageLoading };

  return (
    <ObjectCard
      preview={preview}
      label={ocrText !== null ? "📝 テキスト段落" : "🖼️ 画像段落"}
      subLabel={formatDate(item.sessionCreatedAt)}
      onAdd={onAdd}
      dragHandleProps={{ attributes, listeners }}
      setNodeRef={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      isDragging={isDragging}
    />
  );
}

function PalettePhotoCard({
  photo,
  imageUrl,
  imageLoading,
  onAdd,
}: {
  photo: PhotoObject;
  imageUrl: string | null;
  imageLoading: boolean;
  onAdd: () => void;
}) {
  const key = photoKey(photo.id);
  const block: ArticleBlock = { type: "photo", photoId: photo.id };
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: key,
    data: { source: "palette", block },
  });

  const preview: ObjectCardPreview = { kind: "photo", imageUrl, loading: imageLoading };

  return (
    <ObjectCard
      preview={preview}
      label={`📷 ${photo.title ?? "写真"}`}
      subLabel={sourceLabel(photo)}
      onAdd={onAdd}
      dragHandleProps={{ attributes, listeners }}
      setNodeRef={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      isDragging={isDragging}
    />
  );
}

// ---------------------------------------------------------------------------
// メインコンポーネント
// ---------------------------------------------------------------------------

/**
 * 記事に追加できる段落オブジェクト・写真オブジェクトの一覧パレット。
 * 各カードはドラッグ&ドロップで合成エリアに追加できるほか、「+追加」ボタンでも追加できる。
 * 既に記事に含まれているオブジェクトは一覧から除外される。
 */
export function BlockPalette({
  sessions,
  photos,
  usedKeys,
  client,
  photoImporter,
  onAdd,
}: BlockPaletteProps) {
  const [tab, setTab] = useState<Tab>("paragraph");

  const availableParagraphs = useMemo(
    () =>
      listAvailableParagraphs(sessions)
        .filter((p) => !usedKeys.has(paragraphKey(p.sessionId, p.paragraph.id)))
        .sort(
          (a, b) => new Date(b.sessionCreatedAt).getTime() - new Date(a.sessionCreatedAt).getTime(),
        ),
    [sessions, usedKeys],
  );

  const availablePhotos = useMemo(
    () => photos.filter((p) => !usedKeys.has(photoKey(p.id))),
    [photos, usedKeys],
  );

  // OCR テキストが無い（＝画像プレビューが必要な）段落のページのみ、重複なく画像解決する
  const imageParagraphPages = useMemo(() => {
    const pages = new Map<string, AvailableParagraph["page"]>();
    for (const item of availableParagraphs) {
      const ocr = item.paragraph.ocr;
      const hasOcrText = ocr && !ocr.skipped;
      if (!hasOcrText && !pages.has(item.page.id)) pages.set(item.page.id, item.page);
    }
    return [...pages.values()];
  }, [availableParagraphs]);

  const pageImages = useCorrectedPageImages(client, imageParagraphPages);
  const photoThumbs = usePhotoThumbnails(client, photoImporter, availablePhotos);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex border-b border-slate-200">
        <button
          type="button"
          onClick={() => setTab("paragraph")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === "paragraph"
              ? "border-b-2 border-blue-500 text-blue-600"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          📝 段落（{availableParagraphs.length}）
        </button>
        <button
          type="button"
          onClick={() => setTab("photo")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === "photo"
              ? "border-b-2 border-blue-500 text-blue-600"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          🖼️ 写真（{availablePhotos.length}）
        </button>
      </div>

      {tab === "paragraph" &&
        (availableParagraphs.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">
            追加できる段落がありません。すべて記事に追加済みか、まだ段落分割されたページがありません。
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto pr-1">
            {availableParagraphs.map((item) => {
              const resolved = pageImages[item.page.id];
              return (
                <PaletteParagraphCard
                  key={paragraphKey(item.sessionId, item.paragraph.id)}
                  item={item}
                  imageUrl={resolved?.url ?? null}
                  imageLoading={resolved?.status !== "ready" && resolved?.status !== "error"}
                  onAdd={() =>
                    onAdd({ type: "paragraph", sessionId: item.sessionId, paragraphId: item.paragraph.id })
                  }
                />
              );
            })}
          </div>
        ))}

      {tab === "photo" &&
        (availablePhotos.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">
            追加できる写真がありません。すべて記事に追加済みか、まだ写真が取り込まれていません。
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[70vh] overflow-y-auto pr-1">
            {availablePhotos.map((photo) => {
              const resolved = photoThumbs[photo.id];
              return (
                <PalettePhotoCard
                  key={photoKey(photo.id)}
                  photo={photo}
                  imageUrl={resolved?.url ?? null}
                  imageLoading={resolved?.status !== "ready" && resolved?.status !== "error"}
                  onAdd={() => onAdd({ type: "photo", photoId: photo.id })}
                />
              );
            })}
          </div>
        ))}
    </div>
  );
}
