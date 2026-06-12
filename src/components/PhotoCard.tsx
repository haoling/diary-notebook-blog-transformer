"use client";

import { useState, useRef, useCallback } from "react";
import type { PhotoObject, NormalizedCropRect } from "@/types/photo";

export type PhotoCardProps = {
  photo: PhotoObject;
  /** サムネイル画像の URL。Drive の場合は認証付き fetch が必要なため外部から渡す。 */
  thumbnailUrl?: string;
  onDelete?: (id: string) => void;
  onCropChange?: (id: string, cropRect: NormalizedCropRect) => void;
};

type CropState = {
  active: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

/** React.MouseEvent を使わずに必要なフィールドだけ定義した最小型。 */
type MouseEventLike = {
  clientX: number;
  clientY: number;
  currentTarget: Element;
};

const INITIAL_CROP: CropState = {
  active: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
};

const MIN_CROP_SIZE = 0.01;

export function PhotoCard({ photo, thumbnailUrl, onDelete, onCropChange }: PhotoCardProps) {
  const [showCropUI, setShowCropUI] = useState(false);
  const [cropState, setCropState] = useState<CropState>(INITIAL_CROP);
  const [pendingCrop, setPendingCrop] = useState<NormalizedCropRect | null>(
    photo.cropRect ?? null,
  );
  const imgRef = useRef<HTMLImageElement | null>(null);

  const sourceLabel =
    photo.sourceType === "google_photos" ? "Google Photos" : "Google Drive";

  const formattedDate = photo.takenAt
    ? new Date(photo.takenAt).toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  // ------------------------------------------------------------------
  // crop UI helpers
  // ------------------------------------------------------------------

  /**
   * コンテナ上のマウス座標を実画像の正規化座標（0..1）に変換する。
   * object-cover によるスケール/オフセットを考慮する。
   * 画像が未ロード（naturalWidth=0）の場合はコンテナ相対座標にフォールバック。
   */
  const getImageNormalizedCoords = useCallback(
    (e: MouseEventLike): { x: number; y: number } => {
      const container = e.currentTarget as HTMLElement;
      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const cw = rect.width;
      const ch = rect.height;

      const img = imgRef.current;
      const nw = img?.naturalWidth ?? 0;
      const nh = img?.naturalHeight ?? 0;

      if (!img || nw === 0 || nh === 0) {
        // 画像未ロード時はコンテナ相対座標
        return {
          x: Math.min(1, Math.max(0, cx / cw)),
          y: Math.min(1, Math.max(0, cy / ch)),
        };
      }

      // object-cover のスケール（コンテナを完全に埋める最小スケール）
      const scale = Math.max(cw / nw, ch / nh);
      const renderedW = nw * scale;
      const renderedH = nh * scale;
      const offsetX = (cw - renderedW) / 2;
      const offsetY = (ch - renderedH) / 2;

      // コンテナ座標 → 画像ピクセル座標 → 正規化
      const ix = (cx - offsetX) / scale;
      const iy = (cy - offsetY) / scale;

      return {
        x: Math.min(1, Math.max(0, ix / nw)),
        y: Math.min(1, Math.max(0, iy / nh)),
      };
    },
    [],
  );

  // Pointer Events + setPointerCapture でコンテナ外へのドラッグも確実に捕捉する
  const onPointerDown = useCallback(
    (e: MouseEventLike & { pointerId?: number; currentTarget: Element }) => {
      if (!showCropUI) return;
      // ポインタキャプチャでコンテナ外の move/up も受け取る
      if (typeof (e.currentTarget as HTMLElement).setPointerCapture === "function" && e.pointerId != null) {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
      const { x, y } = getImageNormalizedCoords(e);
      setCropState({ active: true, startX: x, startY: y, currentX: x, currentY: y });
    },
    [showCropUI, getImageNormalizedCoords],
  );

  const onPointerMove = useCallback(
    (e: MouseEventLike) => {
      if (!cropState.active) return;
      const { x, y } = getImageNormalizedCoords(e);
      setCropState((s: CropState) => ({ ...s, currentX: x, currentY: y }));
    },
    [cropState.active, getImageNormalizedCoords],
  );

  const onPointerUp = useCallback(
    (e: MouseEventLike) => {
      if (!cropState.active) return;
      const { x, y } = getImageNormalizedCoords(e);
      const x1 = Math.min(cropState.startX, x);
      const y1 = Math.min(cropState.startY, y);
      const x2 = Math.max(cropState.startX, x);
      const y2 = Math.max(cropState.startY, y);
      const w = x2 - x1;
      const h = y2 - y1;
      // クリックのみ（極小）の選択は無効
      if (w < MIN_CROP_SIZE || h < MIN_CROP_SIZE) {
        setPendingCrop(null);
      } else {
        setPendingCrop({ x: x1, y: y1, width: w, height: h });
      }
      setCropState(INITIAL_CROP);
    },
    [cropState, getImageNormalizedCoords],
  );

  const onPointerCancel = useCallback(() => {
    if (cropState.active) {
      setCropState(INITIAL_CROP);
    }
  }, [cropState.active]);

  const openCropUI = () => {
    // 開き直すたびに最新の photo.cropRect を pendingCrop に同期
    setPendingCrop(photo.cropRect ?? null);
    setShowCropUI(true);
  };

  const applyCrop = () => {
    if (pendingCrop) {
      onCropChange?.(photo.id, pendingCrop);
    }
    setShowCropUI(false);
  };

  const cancelCrop = () => {
    setPendingCrop(photo.cropRect ?? null);
    setShowCropUI(false);
    setCropState(INITIAL_CROP);
  };

  /**
   * オーバーレイ表示用の crop rect。
   * ドラッグ中は cropState から計算、確定後は pendingCrop を使う。
   * 座標は object-cover のコンテナ相対（0..1）に逆変換して表示する。
   */
  const toContainerRect = useCallback(
    (r: NormalizedCropRect) => {
      const img = imgRef.current;
      const nw = img?.naturalWidth ?? 0;
      const nh = img?.naturalHeight ?? 0;
      const containerEl = img?.parentElement;

      if (!img || nw === 0 || nh === 0 || !containerEl) {
        return r;
      }

      const cw = containerEl.getBoundingClientRect().width;
      const ch = containerEl.getBoundingClientRect().height;
      const scale = Math.max(cw / nw, ch / nh);
      const renderedW = nw * scale;
      const renderedH = nh * scale;
      const offsetX = (cw - renderedW) / 2;
      const offsetY = (ch - renderedH) / 2;

      return {
        x: (r.x * nw * scale + offsetX) / cw,
        y: (r.y * nh * scale + offsetY) / ch,
        width: (r.width * nw * scale) / cw,
        height: (r.height * nh * scale) / ch,
      };
    },
    [],
  );

  // cropState も pendingCrop も実画像正規化座標（0..1）なので、
  // ドラッグ中・確定後を問わず常に toContainerRect() でコンテナ相対に変換して描画する
  const rawDisplayCrop: NormalizedCropRect | null = cropState.active
    ? {
        x: Math.min(cropState.startX, cropState.currentX),
        y: Math.min(cropState.startY, cropState.currentY),
        width: Math.abs(cropState.currentX - cropState.startX),
        height: Math.abs(cropState.currentY - cropState.startY),
      }
    : pendingCrop;

  const displayCrop = rawDisplayCrop ? toContainerRect(rawDisplayCrop) : null;

  return (
    <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden flex flex-col">
      {/* サムネイル */}
      <div
        className={`relative bg-gray-100 aspect-square overflow-hidden ${showCropUI ? "cursor-crosshair select-none touch-none" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {thumbnailUrl ? (
          <img
            ref={imgRef}
            src={thumbnailUrl}
            alt={photo.title ?? "photo"}
            className="w-full h-full object-cover pointer-events-none"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
            No image
          </div>
        )}

        {/* クロップ選択オーバーレイ */}
        {showCropUI && displayCrop && displayCrop.width > MIN_CROP_SIZE && displayCrop.height > MIN_CROP_SIZE && (
          <div
            className="absolute border-2 border-blue-400 bg-blue-400/20 pointer-events-none"
            style={{
              left: `${displayCrop.x * 100}%`,
              top: `${displayCrop.y * 100}%`,
              width: `${displayCrop.width * 100}%`,
              height: `${displayCrop.height * 100}%`,
            }}
          />
        )}

        {/* ソースバッジ */}
        <span className="absolute top-1 left-1 text-xs bg-black/50 text-white px-1.5 py-0.5 rounded">
          {sourceLabel}
        </span>
      </div>

      {/* メタデータ */}
      <div className="p-3 flex flex-col gap-1 flex-1">
        <p className="text-sm font-medium text-gray-800 truncate" title={photo.title}>
          {photo.title ?? "(無題)"}
        </p>
        {formattedDate && (
          <p className="text-xs text-gray-500">{formattedDate}</p>
        )}
        {photo.cropRect && !showCropUI && (
          <p className="text-xs text-blue-500">切り抜き済み</p>
        )}
      </div>

      {/* アクション */}
      <div className="px-3 pb-3 flex gap-2">
        {onCropChange && !showCropUI && (
          <button
            onClick={openCropUI}
            className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
          >
            切り抜き
          </button>
        )}
        {showCropUI && (
          <>
            <button
              onClick={applyCrop}
              disabled={!pendingCrop}
              className="text-xs px-2 py-1 rounded bg-blue-500 hover:bg-blue-600 text-white transition-colors disabled:opacity-50"
            >
              適用
            </button>
            <button
              onClick={cancelCrop}
              className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
            >
              キャンセル
            </button>
          </>
        )}
        {onDelete && !showCropUI && (
          <button
            onClick={() => onDelete(photo.id)}
            className="text-xs px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600 transition-colors ml-auto"
          >
            削除
          </button>
        )}
      </div>
    </div>
  );
}
