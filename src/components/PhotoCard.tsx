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

const INITIAL_CROP: CropState = {
  active: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
};

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

  const getRelativeCoords = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): { x: number; y: number } => {
      const rect = e.currentTarget.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
      };
    },
    [],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!showCropUI) return;
      const { x, y } = getRelativeCoords(e);
      setCropState({ active: true, startX: x, startY: y, currentX: x, currentY: y });
    },
    [showCropUI, getRelativeCoords],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!cropState.active) return;
      const { x, y } = getRelativeCoords(e);
      setCropState((s: CropState) => ({ ...s, currentX: x, currentY: y }));
    },
    [cropState.active, getRelativeCoords],
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!cropState.active) return;
      const { x, y } = getRelativeCoords(e);
      const x1 = Math.min(cropState.startX, x);
      const y1 = Math.min(cropState.startY, y);
      const x2 = Math.max(cropState.startX, x);
      const y2 = Math.max(cropState.startY, y);
      const crop: NormalizedCropRect = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
      setPendingCrop(crop);
      setCropState(INITIAL_CROP);
    },
    [cropState, getRelativeCoords],
  );

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

  // Normalize crop rect for display (handle reversed drag directions)
  const displayCrop = cropState.active
    ? {
        x: Math.min(cropState.startX, cropState.currentX),
        y: Math.min(cropState.startY, cropState.currentY),
        width: Math.abs(cropState.currentX - cropState.startX),
        height: Math.abs(cropState.currentY - cropState.startY),
      }
    : pendingCrop;

  return (
    <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden flex flex-col">
      {/* サムネイル */}
      <div
        className={`relative bg-gray-100 aspect-square overflow-hidden ${showCropUI ? "cursor-crosshair select-none" : ""}`}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
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
        {showCropUI && displayCrop && displayCrop.width > 0.01 && displayCrop.height > 0.01 && (
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
            onClick={() => setShowCropUI(true)}
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
