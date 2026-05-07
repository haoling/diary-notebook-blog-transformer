"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";
import {
  applyCorrections,
  isOpencvLoaded,
  initOpenCV,
} from "@/lib/image-processing";
import {
  detectParagraphs,
  splitYsToParagraphs,
  createSplitResult,
} from "@/lib/paragraph-detection";
import { ParagraphCard } from "@/components/ParagraphCard";
import type { CorrectionResult, ParagraphObject, SplitResult } from "@/types/scan";

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export type ParagraphSplitUIProps = {
  /** 画像の URL（Blob URL / data URL / 通常 URL）。 */
  imageUrl: string;
  /** 適用する補正結果。undefined の場合は元画像をそのまま使用。 */
  correction?: CorrectionResult;
  /** 既存の分割結果（再編集時）。 */
  existingSplit?: SplitResult;
  /** 分割結果を保存したときのコールバック。 */
  onSave: (split: SplitResult) => void;
  /** キャンセル時のコールバック。 */
  onCancel: () => void;
};

// ---------------------------------------------------------------------------
// ヘルパー関数
// ---------------------------------------------------------------------------

/** 指定したURLからImage要素を生成する。 */
function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", () => reject(new Error("画像の読み込みに失敗しました。")));
    img.src = url;
  });
}

/** CropRect から Y 座標配列を抽出する（各段落の終端Yを分割線とする）。 */
function paragraphsToSplitYs(paragraphs: ParagraphObject[], imageHeight: number): number[] {
  return paragraphs
    .filter((p) => p.cropRect.y > 0 && p.cropRect.y < imageHeight)
    .map((p) => p.cropRect.y)
    .sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// 分割線ハンドルコンポーネント
// ---------------------------------------------------------------------------

type SplitLineHandleProps = {
  yPct: number;
  /** 表示サイズ（px）。 */
  size: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onDelete: () => void;
};

function SplitLineHandle({
  yPct,
  size,
  onPointerDown,
  onDelete,
}: SplitLineHandleProps) {
  return (
    <div
      className="absolute left-0 right-0 z-20 -translate-y-1/2 group pointer-events-none"
      style={{ top: `${yPct * 100}%` }}
    >
      <div
        className="absolute inset-x-0 top-1/2 h-[2px] bg-red-500/70"
      />
      <button
        type="button"
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing touch-none pointer-events-auto"
        style={{ width: size, height: size }}
        onPointerDown={onPointerDown}
        aria-label="分割線をドラッグ"
      >
        <div className="w-full h-full rounded-full bg-red-500 border-2 border-white shadow-lg hover:bg-red-600 transition-colors" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white border border-red-300 text-red-500 text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-50 transition-opacity pointer-events-auto"
        aria-label="分割線を削除"
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// メインコンポーネント
// ---------------------------------------------------------------------------

/**
 * 段落分割 UI コンポーネント。
 *
 * - 補正済み（または元）画像に分割線をオーバーレイ表示
 * - 分割線のドラッグ移動・追加・削除
 * - 各段落の切り抜きプレビュー
 * - 「自動検出」「手動分割のみ」の選択
 * - 「保存」→ SplitResult をコールバックに渡す
 */
export function ParagraphSplitUI({
  imageUrl,
  correction,
  existingSplit,
  onSave,
  onCancel,
}: ParagraphSplitUIProps) {
  // ---- 状態管理 ----

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [opencvStatus, setOpencvStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [splitYs, setSplitYs] = useState<number[]>(() =>
    existingSplit ? paragraphsToSplitYs(existingSplit.paragraphs, 0) : [],
  );
  const [paragraphs, setParagraphs] = useState<ParagraphObject[]>(() =>
    existingSplit?.paragraphs ?? [],
  );
  const [autoDetectLoading, setAutoDetectLoading] = useState(false);
  const [autoDetectMessage, setAutoDetectMessage] = useState<{ type: "success" | "warn"; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [correctedImageUrl, setCorrectedImageUrl] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // ドラッグ状態（ref で即時更新し、state は再レンダー用）
  const draggingIndexRef = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  // ---- 画像のロードと補正 ----

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAndCorrect() {
      setLoading(true);
      setLoadError(null);
      try {
        const img = await loadImageElement(imageUrl);
        if (cancelled) return;

        setImageSize({ width: img.naturalWidth, height: img.naturalHeight });

        // 補正適用
        let resultCanvas: HTMLCanvasElement;
        if (correction) {
          resultCanvas = await applyCorrections(img, correction);
        } else {
          resultCanvas = document.createElement("canvas");
          resultCanvas.width = img.naturalWidth;
          resultCanvas.height = img.naturalHeight;
          const ctx = resultCanvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
        }

        if (cancelled) return;

        // 補正後の画像サイズを imageSize に設定（台形補正等でサイズが変わるため）
        setImageSize({ width: resultCanvas.width, height: resultCanvas.height });

        // 補正済み画像のURLを生成
        const blob = await new Promise<Blob>((resolve, reject) => {
          resultCanvas.toBlob((b) => {
            if (b) {
              resolve(b);
            } else {
              reject(new Error("補正済み画像の Blob 生成に失敗しました。"));
            }
          }, "image/png");
        });
        const url = URL.createObjectURL(blob);

        // ObjectURL 生成後にキャンセルチェック
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }

        setCorrectedImageUrl(url);

        // 既存の分割結果がない場合、Y座標配列を初期化
        if (!existingSplit?.paragraphs?.length) {
          setSplitYs([]);
          setParagraphs([]);
        } else {
          // splitYs はオーバーレイ表示用に再計算するが、paragraphs は
          // existingSplit のものをそのまま使って id/order を保持する
          const ys = paragraphsToSplitYs(existingSplit.paragraphs, resultCanvas.height);
          setSplitYs(ys);
          setParagraphs(existingSplit.paragraphs);
        }

        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setLoadError(err instanceof Error ? err.message : "画像の読み込みまたは補正に失敗しました。");
          setLoading(false);
        }
      }
    }

    loadAndCorrect();

    return () => {
      cancelled = true;
    };
  }, [imageUrl, correction, existingSplit, retryKey]);

  // correctedImageUrl の ObjectURL を cleanup で解放（unmount 時・URL 変更時の両方をカバー）
  useEffect(() => {
    return () => {
      if (correctedImageUrl) URL.revokeObjectURL(correctedImageUrl);
    };
  }, [correctedImageUrl]);

  // ---- OpenCV.js の事前ロード ----

  useEffect(() => {
    if (isOpencvLoaded()) {
      setOpencvStatus("ready");
      return;
    }
    setOpencvStatus("loading");
    initOpenCV()
      .then(() => { if (mountedRef.current) setOpencvStatus("ready"); })
      .catch(() => { if (mountedRef.current) setOpencvStatus("error"); });
  }, []);

  // ---- 段落の再計算 ----

  const recalculateParagraphs = useCallback((ys: number[]) => {
    if (!imageSize) return;
    const sorted = [...ys].sort((a, b) => a - b);
    setSplitYs(sorted);
    setParagraphs(splitYsToParagraphs(sorted, imageSize.width, imageSize.height));
  }, [imageSize]);

  // ---- 自動検出 ----

  const handleAutoDetect = useCallback(async () => {
    if (!correctedImageUrl || !imageSize) return;

    setAutoDetectLoading(true);
    setAutoDetectMessage(null);

    try {
      const img = await loadImageElement(correctedImageUrl);
      const detectedYs = await detectParagraphs(img);

      if (!mountedRef.current) return;

      if (detectedYs.length === 0) {
        setAutoDetectMessage({ type: "warn", text: "段落境界が検出されませんでした。手動で分割線を追加してください。" });
      } else {
        setAutoDetectMessage({ type: "success", text: `${detectedYs.length}箇所の段落境界を検出しました。` });
      }

      recalculateParagraphs(detectedYs);
    } catch (err) {
      if (!mountedRef.current) return;
      setAutoDetectMessage({
        type: "warn",
        text: err instanceof Error ? err.message : "自動検出に失敗しました。",
      });
    } finally {
      if (mountedRef.current) setAutoDetectLoading(false);
    }
  }, [correctedImageUrl, imageSize, recalculateParagraphs]);

  // ---- 手動分割線の追加 ----

  const handleAddSplitLine = useCallback((yPct: number) => {
    if (!imageSize) return;
    const y = Math.round(yPct * imageSize.height);
    if (y <= 0 || y >= imageSize.height - 1) return;

    setSplitYs((prev) => {
      if (prev.some((existingY) => Math.abs(existingY - y) < 3)) return prev;
      const newSorted = [...prev, y].sort((a, b) => a - b);
      setParagraphs(splitYsToParagraphs(newSorted, imageSize.width, imageSize.height));
      return newSorted;
    });
  }, [imageSize]);

  // 画像クリックで分割線を追加
  const handleImageClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (draggingIndex !== null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const yPct = (e.clientY - rect.top) / rect.height;
    handleAddSplitLine(yPct);
  }, [draggingIndex, handleAddSplitLine]);

  // ---- 分割線の削除 ----

  const handleDeleteSplitLine = useCallback((index: number) => {
    setSplitYs((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (imageSize) {
        setParagraphs(splitYsToParagraphs(next, imageSize.width, imageSize.height));
      }
      return next;
    });
  }, [imageSize]);

  // ---- 分割線のドラッグ ----

  const handlePointerDown = useCallback((index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingIndexRef.current = index;
    setDraggingIndex(index);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const currentIndex = draggingIndexRef.current;
    if (currentIndex === null || !containerRef.current || !imageSize) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const yPct = (e.clientY - rect.top) / rect.height;
    const newY = Math.round(yPct * imageSize.height);
    const clampedY = Math.max(1, Math.min(imageSize.height - 2, newY));

    setSplitYs((prev) => {
      const next = [...prev];

      // 重複を回避するスナップ処理
      const occupiedYs = new Set(prev.filter((_, i) => i !== currentIndex));

      let resolvedY = clampedY;
      if (occupiedYs.has(resolvedY)) {
        let found = false;

        for (let offset = 1; offset < imageSize.height; offset += 1) {
          const up = clampedY - offset;
          if (up >= 1 && up <= imageSize.height - 2 && !occupiedYs.has(up)) {
            resolvedY = up;
            found = true;
            break;
          }

          const down = clampedY + offset;
          if (down >= 1 && down <= imageSize.height - 2 && !occupiedYs.has(down)) {
            resolvedY = down;
            found = true;
            break;
          }
        }

        if (!found) {
          return prev;
        }
      }

      next[currentIndex] = resolvedY;
      const sorted = [...next].sort((a, b) => a - b);

      // ドラッグ中の要素のインデックスを ref と state の両方で即時更新
      const newIndex = sorted.findIndex((y) => y === resolvedY);
      draggingIndexRef.current = newIndex;
      setDraggingIndex(newIndex);
      setParagraphs(splitYsToParagraphs(sorted, imageSize.width, imageSize.height));
      return sorted;
    });
  }, [imageSize]);

  const handlePointerUp = useCallback(() => {
    draggingIndexRef.current = null;
    setDraggingIndex(null);
  }, []);

  // ---- 段落操作 ----

  const handleDeleteParagraph = useCallback((id: string) => {
    if (!imageSize) return;
    setParagraphs((prev) => {
      const paragraph = prev.find((p) => p.id === id);
      if (!paragraph || prev.length <= 1) return prev;

      const currentSplitYs = paragraphsToSplitYs(prev, imageSize.height);
      // cropRect.y で split line を特定（idx ではなく Y 座標ベースで探索して
      // handleMoveUp/handleMoveDown による並び替え後も正しい線を削除できるようにする）
      let splitIndexToRemove: number;
      if (paragraph.cropRect.y === 0) {
        // 先頭段落：次段落との境界（最初の splitY）を削除して次段落とマージ
        splitIndexToRemove = 0;
      } else {
        splitIndexToRemove = currentSplitYs.indexOf(paragraph.cropRect.y);
        if (splitIndexToRemove === -1) return prev;
      }

      const nextSplitYs = currentSplitYs.filter((_, i) => i !== splitIndexToRemove);
      setSplitYs(nextSplitYs);
      return splitYsToParagraphs(nextSplitYs, imageSize.width, imageSize.height);
    });
  }, [imageSize]);

  const handleMoveUp = useCallback((id: string) => {
    // display order は paragraphs 配列で管理し、splitYs（空間的な分割位置）は変更しない
    setParagraphs((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next.map((p, i) => ({ ...p, order: i }));
    });
  }, []);

  const handleMoveDown = useCallback((id: string) => {
    setParagraphs((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next.map((p, i) => ({ ...p, order: i }));
    });
  }, []);

  // ---- 全消去 ----

  const handleClearAll = useCallback(() => {
    setSplitYs([]);
    setParagraphs([]);
    setAutoDetectMessage(null);
  }, []);

  // ---- 保存 ----

  const handleSave = useCallback(() => {
    const result = createSplitResult(paragraphs);
    onSave(result);
  }, [paragraphs, onSave]);

  // ---- スキップ（分割なしで保存） ----

  const handleSkip = useCallback(() => {
    const result = createSplitResult([]);
    onSave(result);
  }, [onSave]);

  // ---- 計算プロパティ ----

  const canSave = imageSize !== null;

  const displayImageSrc = correctedImageUrl ?? imageUrl;

  // ---- レンダリング ----

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-400">画像を読み込み中...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <p className="text-sm text-red-600">{loadError}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setLoadError(null); setRetryKey((k) => k + 1); }}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
          >
            再試行
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded bg-slate-200 text-slate-700 hover:bg-slate-300"
          >
            キャンセル
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">📝 段落分割</h3>
          <p className="text-xs text-slate-500">
            画像をクリックして分割線を追加、または自動検出を使用してください。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {autoDetectMessage && (
            <span className={`text-xs ${autoDetectMessage.type === "success" ? "text-green-600" : "text-amber-600"}`}>
              {autoDetectMessage.text}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAutoDetect}
            disabled={autoDetectLoading || opencvStatus !== "ready"}
            className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50 px-2 py-1 rounded border border-blue-200 hover:border-blue-300"
          >
            {autoDetectLoading ? "検出中..." : "🔍 自動検出"}
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded border border-slate-200 hover:border-slate-300"
          >
            全消去
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
          >
            キャンセル
          </button>
        </div>
      </div>

      {/* 画像表示エリア（分割線オーバーレイ） */}
      <div
        ref={containerRef}
        className="relative select-none cursor-crosshair"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={displayImageSrc}
          alt="分割対象画像"
          className="w-full h-auto rounded-lg border border-slate-200"
          draggable={false}
          onClick={handleImageClick}
        />

        {/* 分割線オーバーレイ */}
        {imageSize && (
          <div className="absolute inset-0 pointer-events-none">
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
              preserveAspectRatio="none"
            >
              {splitYs.map((y, i) => (
                <line
                  key={`line-${i}`}
                  x1={0}
                  y1={y}
                  x2={imageSize.width}
                  y2={y}
                  stroke="rgba(239, 68, 68, 0.6)"
                  strokeWidth={Math.max(2, Math.round(imageSize.width / 400))}
                  strokeDasharray="8,4"
                />
              ))}
            </svg>
          </div>
        )}

        {/* 分割線ハンドル */}
        {imageSize &&
          splitYs.map((y, i) => (
            <div key={`handle-${i}`} className="absolute inset-x-0 pointer-events-none">
              <SplitLineHandle
                yPct={y / imageSize.height}
                size={20}
                onPointerDown={handlePointerDown(i)}
                onDelete={() => handleDeleteSplitLine(i)}
              />
            </div>
          ))}
      </div>

      {/* 段落プレビュー */}
      <div>
        <div className="text-xs font-medium text-slate-500 mb-2">
          段落プレビュー ({paragraphs.length}段落)
        </div>
        {paragraphs.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-400">
            分割線がありません。画像をクリックするか「自動検出」を使用してください。
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {paragraphs.map((p, i) => (
              <ParagraphCard
                key={p.id}
                paragraph={p}
                imageUrl={displayImageSrc}
                index={i}
                onDelete={handleDeleteParagraph}
                onMoveUp={i > 0 ? handleMoveUp : undefined}
                onMoveDown={i < paragraphs.length - 1 ? handleMoveDown : undefined}
                maxWidth={400}
              />
            ))}
          </div>
        )}
      </div>

      {/* アクションボタン */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleSkip}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          ⏭️ 分割なしで保存
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
