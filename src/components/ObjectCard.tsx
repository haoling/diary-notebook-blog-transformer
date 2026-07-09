"use client";

import type { CSSProperties, ReactNode } from "react";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { CropPreview } from "@/components/ParagraphCard";
import type { CropRect } from "@/types/scan";

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/** dnd-kit のドラッグハンドルに渡す属性・リスナー（useDraggable / useSortable の戻り値をそのまま渡す）。 */
export type DragHandleProps = {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
};

export type ObjectCardPreview =
  | { kind: "text"; text: string }
  | { kind: "paragraph-image"; imageUrl: string | null; cropRect: CropRect; loading?: boolean }
  | { kind: "photo"; imageUrl: string | null; loading?: boolean };

export type ObjectCardProps = {
  preview: ObjectCardPreview;
  /** カード上部に表示するラベル（種別など）。 */
  label: string;
  /** サブラベル（日時など）。 */
  subLabel?: string;
  /** 並び順バッジ（合成中の記事ブロック一覧で使用）。 */
  index?: number;
  /** 削除ボタン。指定時のみ表示。 */
  onDelete?: () => void;
  /** 追加ボタン（パレット用）。指定時のみ表示。 */
  onAdd?: () => void;
  /** dnd-kit のドラッグハンドルに渡す属性・リスナー。 */
  dragHandleProps?: DragHandleProps;
  /** dnd-kit の setNodeRef。 */
  setNodeRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  /** ドラッグ中かどうか（見た目を薄くする）。 */
  isDragging?: boolean;
  footer?: ReactNode;
};

// ---------------------------------------------------------------------------
// プレビュー部品
// ---------------------------------------------------------------------------

function PreviewBody({ preview }: { preview: ObjectCardPreview }) {
  if (preview.kind === "text") {
    return (
      <div className="p-3 max-h-32 overflow-hidden text-sm text-slate-700 whitespace-pre-wrap break-words bg-slate-50 rounded border border-slate-200">
        {preview.text || <span className="text-slate-400">（OCR テキストなし）</span>}
      </div>
    );
  }

  if (preview.kind === "paragraph-image") {
    if (preview.loading) {
      return (
        <div className="flex items-center justify-center py-8 bg-slate-50 rounded border border-slate-200">
          <div className="text-slate-400 text-xs">読み込み中...</div>
        </div>
      );
    }
    if (!preview.imageUrl) {
      return (
        <div className="flex items-center justify-center py-8 bg-slate-50 rounded border border-slate-200">
          <div className="text-slate-400 text-xs">表示できません</div>
        </div>
      );
    }
    return (
      <CropPreview imageUrl={preview.imageUrl} cropRect={preview.cropRect} maxWidth={320} />
    );
  }

  // photo
  if (preview.loading) {
    return (
      <div className="flex items-center justify-center aspect-square bg-slate-50 rounded border border-slate-200">
        <div className="text-slate-400 text-xs">読み込み中...</div>
      </div>
    );
  }
  if (!preview.imageUrl) {
    return (
      <div className="flex items-center justify-center aspect-square bg-slate-50 rounded border border-slate-200">
        <div className="text-slate-400 text-xs">No image</div>
      </div>
    );
  }
  return (
    <div className="aspect-square bg-slate-50 rounded border border-slate-200 overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={preview.imageUrl}
        alt=""
        className="w-full h-full object-cover"
        draggable={false}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// メインコンポーネント
// ---------------------------------------------------------------------------

/**
 * 記事ブロック（段落オブジェクト・写真オブジェクト）のプレビューカード。
 * BlockPalette（追加候補一覧）と ArticleComposer（合成済み記事）の両方で使用する汎用カード。
 */
export function ObjectCard({
  preview,
  label,
  subLabel,
  index,
  onDelete,
  onAdd,
  dragHandleProps,
  setNodeRef,
  style,
  isDragging,
  footer,
}: ObjectCardProps) {
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2 min-w-0">
          {dragHandleProps && (
            <button
              type="button"
              className="shrink-0 cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 touch-none"
              aria-label="ドラッグして移動"
              {...dragHandleProps.attributes}
              {...dragHandleProps.listeners}
            >
              ⠿
            </button>
          )}
          {index !== undefined && (
            <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
              {index + 1}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-600 truncate">{label}</p>
            {subLabel && <p className="text-[10px] text-slate-400 truncate">{subLabel}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="text-xs px-2 py-1 rounded bg-blue-500 hover:bg-blue-600 text-white transition-colors"
            >
              + 追加
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="p-1 text-slate-400 hover:text-red-500"
              aria-label="削除"
              title="削除"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="p-2">
        <PreviewBody preview={preview} />
      </div>
      {footer && <div className="px-3 pb-2">{footer}</div>}
    </div>
  );
}
