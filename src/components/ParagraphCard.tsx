"use client";

import { useState, useEffect, useRef } from "react";
import type { ParagraphObject, CropRect } from "@/types/scan";

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export type ParagraphCardProps = {
  /** 段落オブジェクト。 */
  paragraph: ParagraphObject;
  /** 切り抜き元の画像 URL。 */
  imageUrl: string;
  /** 段落の表示順。 */
  index: number;
  /** 段落の削除コールバック。 */
  onDelete: (id: string) => void;
  /** 段落の順序入れ替えコールバック。 */
  onMoveUp?: (id: string) => void;
  /** 段落の順序入れ替えコールバック。 */
  onMoveDown?: (id: string) => void;
  /** 最大表示幅（px）。 */
  maxWidth?: number;
};

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

/** Canvas で指定領域を切り抜きプレビューする。 */
function CropPreview({
  imageUrl,
  cropRect,
  maxWidth = 400,
}: {
  imageUrl: string;
  cropRect: CropRect;
  maxWidth?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const renderIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const renderId = ++renderIdRef.current;

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.addEventListener("load", () => {
      if (cancelled || renderId !== renderIdRef.current) return;
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const { x, y, width, height } = cropRect;
        const srcW = Math.max(1, Math.min(width, img.naturalWidth - x));
        const srcH = Math.max(1, Math.min(height, img.naturalHeight - y));

        if (srcW < 1 || srcH < 1) {
          setStatus("error");
          return;
        }

        let drawW = srcW;
        let drawH = srcH;
        if (maxWidth && drawW > maxWidth) {
          const scale = maxWidth / drawW;
          drawW = maxWidth;
          drawH = Math.round(drawH * scale);
        }

        canvas.width = drawW;
        canvas.height = drawH;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, x, y, srcW, srcH, 0, 0, drawW, drawH);

        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    });

    img.addEventListener("error", () => {
      if (!cancelled && renderId === renderIdRef.current) {
        setStatus("error");
      }
    });

    img.src = imageUrl;

    return () => {
      cancelled = true;
      renderIdRef.current = -1;
    };
  }, [imageUrl, cropRect, maxWidth]);

  return (
    <div className="relative bg-slate-50 rounded border border-slate-200 overflow-hidden">
      {status === "loading" && (
        <div className="flex items-center justify-center py-8">
          <div className="text-slate-400 text-xs">読み込み中...</div>
        </div>
      )}
      {status === "error" && (
        <div className="flex items-center justify-center py-8">
          <div className="text-red-400 text-xs">表示できません</div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`max-w-full h-auto ${status !== "ready" ? "hidden" : ""}`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// メインコンポーネント
// ---------------------------------------------------------------------------

/**
 * 段落カードコンポーネント。
 *
 * 段落ごとの切り抜きプレビュー（Canvas crop）を表示し、
 * 上下の移動・削除操作を提供する。
 */
export function ParagraphCard({
  paragraph,
  imageUrl,
  index,
  onDelete,
  onMoveUp,
  onMoveDown,
  maxWidth,
}: ParagraphCardProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
            {index + 1}
          </span>
          <span className="text-xs text-slate-500">
            Y:{paragraph.cropRect.y}〜{paragraph.cropRect.y + paragraph.cropRect.height}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMoveUp?.(paragraph.id)}
            disabled={!onMoveUp}
            className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="上に移動"
            title="上に移動"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={() => onMoveDown?.(paragraph.id)}
            disabled={!onMoveDown}
            className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="下に移動"
            title="下に移動"
          >
            ▼
          </button>
          <button
            type="button"
            onClick={() => onDelete(paragraph.id)}
            className="p-1 text-slate-400 hover:text-red-500"
            aria-label="段落を削除"
            title="段落を削除"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="p-2">
        <CropPreview
          imageUrl={imageUrl}
          cropRect={paragraph.cropRect}
          maxWidth={maxWidth}
        />
      </div>
    </div>
  );
}
