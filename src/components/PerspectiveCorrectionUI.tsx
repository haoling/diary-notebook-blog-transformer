"use client";

import type React from "react";
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import {
  applyCorrections,
  createDefaultPerspectiveParams,
  isOpencvLoaded,
  initOpenCV,
  detectDocumentPerspective,
  analyzeImageAutoAdjustments,
} from "@/lib/image-processing";
import type {
  CorrectionResult,
  PerspectiveParams,
  Point,
} from "@/types/scan";

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

type CornerKey = "topLeft" | "topRight" | "bottomRight" | "bottomLeft";

export type PerspectiveCorrectionUIProps = {
  /** 画像の URL（Blob URL / data URL / 通常 URL）。 */
  imageUrl: string;
  /** 既存の補正結果（再編集時）。 */
  existingCorrection?: CorrectionResult;
  /** 補正結果を保存したときのコールバック。 */
  onSave: (correction: CorrectionResult) => void;
  /** キャンセル時のコールバック。 */
  onCancel: () => void;
};

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const CORNER_LABELS: Record<CornerKey, string> = {
  topLeft: "左上",
  topRight: "右上",
  bottomRight: "右下",
  bottomLeft: "左下",
};

const CORNER_KEYS: CornerKey[] = ["topLeft", "topRight", "bottomRight", "bottomLeft"];

/** スライダーのデフォルト値 */
const DEFAULT_ROTATION = 0;
const DEFAULT_BRIGHTNESS = 0;
const DEFAULT_CONTRAST = 0;
const DEFAULT_SHARPNESS = 0;

// ---------------------------------------------------------------------------
// ヘルパー関数
// ---------------------------------------------------------------------------

/** 画像の自然サイズを読み込む。 */
function loadImageNaturalSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.addEventListener("load", () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    });
    img.addEventListener("error", () => {
      reject(new Error("画像の読み込みに失敗しました。"));
    });
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// コーナーハンドルコンポーネント
// ---------------------------------------------------------------------------

type CornerHandleProps = {
  label: string;
  /** 表示位置（パーセント 0〜1）。 */
  xPct: number;
  yPct: number;
  /** 表示サイズ（px）。 */
  size: number;
  onPointerDown: (e: React.PointerEvent) => void;
};

function CornerHandle({ label, xPct, yPct, size, onPointerDown }: CornerHandleProps) {
  const valNow = Math.round(xPct * 100);
  return (
    <div
      className="absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing touch-none"
      style={{
        left: `${xPct * 100}%`,
        top: `${yPct * 100}%`,
        width: size,
        height: size,
      }}
      onPointerDown={onPointerDown}
      role="slider"
      aria-label={`${label}コーナー`}
      aria-valuenow={valNow}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
    >
      <div className="w-full h-full rounded-full bg-blue-500 border-2 border-white shadow-lg" />
      <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-white bg-blue-500/80 rounded px-1 whitespace-nowrap pointer-events-none">
        {label}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// スライダーコンポーネント
// ---------------------------------------------------------------------------

type SliderControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  onReset: () => void;
};

function SliderControl({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
  onReset,
}: SliderControlProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-medium text-slate-600 w-16 shrink-0">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
      />
      <span className="text-xs text-slate-500 w-12 text-right tabular-nums">
        {value}{unit}
      </span>
      <button
        type="button"
        onClick={onReset}
        disabled={value === 0}
        className="text-xs text-slate-400 hover:text-slate-600 disabled:opacity-30"
        aria-label={`${label}をリセット`}
      >
        ↺
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// メインコンポーネント
// ---------------------------------------------------------------------------

/**
 * 画像補正 UI コンポーネント。
 *
 * - 元画像に4隅のコーナーハンドルをドラッグして台形補正領域を指定
 * - 回転角度・明るさ・コントラスト・シャープネス調整スライダー
 * - リアルタイムプレビュー（Canvas に補正を適用して描画）
 * - 「補正不要（スキップ）」ボタン
 * - 「保存」ボタン → CorrectionResult をコールバックに渡す
 */
export function PerspectiveCorrectionUI({
  imageUrl,
  existingCorrection,
  onSave,
  onCancel,
}: PerspectiveCorrectionUIProps) {
  // ---- 状態管理 ----

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [opencvStatus, setOpencvStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [usePerspective, setUsePerspective] = useState(() => !!existingCorrection?.perspective);
  const [perspective, setPerspective] = useState<PerspectiveParams | undefined>(() =>
    existingCorrection?.perspective,
  );
  const [rotation, setRotation] = useState(existingCorrection?.rotation ?? DEFAULT_ROTATION);
  const [brightness, setBrightness] = useState(
    existingCorrection?.adjustments?.brightness ?? DEFAULT_BRIGHTNESS,
  );
  const [contrast, setContrast] = useState(
    existingCorrection?.adjustments?.contrast ?? DEFAULT_CONTRAST,
  );
  const [sharpness, setSharpness] = useState(
    existingCorrection?.adjustments?.sharpness ?? DEFAULT_SHARPNESS,
  );
  const [backgroundRemoval, setBackgroundRemoval] = useState(
    existingCorrection?.adjustments?.backgroundRemoval ?? false,
  );
  const [autoCorrectLoading, setAutoCorrectLoading] = useState(false);
  const [autoCorrectMessage, setAutoCorrectMessage] = useState<{ type: "success" | "warn"; text: string } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ドラッグ状態
  const [draggingCorner, setDraggingCorner] = useState<CornerKey | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // ---- 画像のロード ----

  useEffect(() => {
    let cancelled = false;
    loadImageNaturalSize(imageUrl).then(
      (size) => {
        if (cancelled) return;
        setImageSize(size);
        // 既存の補正がない場合、デフォルトの台形補正パラメータを生成
        if (!existingCorrection?.perspective) {
          setPerspective(createDefaultPerspectiveParams(size.width, size.height));
        }
        setLoading(false);
      },
      (err) => {
        if (!cancelled) {
          console.error(err);
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [imageUrl, existingCorrection]);

  // ---- OpenCV.js の事前ロード ----

  useEffect(() => {
    if (!usePerspective) return;
    if (isOpencvLoaded()) {
      setOpencvStatus("ready");
      return;
    }
    setOpencvStatus("loading");
    initOpenCV()
      .then(() => setOpencvStatus("ready"))
      .catch(() => setOpencvStatus("error"));
  }, [usePerspective]);

  // ---- コーナー座標のパーセント計算 ----

  const cornerPercents = useMemo(() => {
    if (!imageSize || !perspective) return null;
    return {
      topLeft: {
        xPct: perspective.topLeft.x / imageSize.width,
        yPct: perspective.topLeft.y / imageSize.height,
      },
      topRight: {
        xPct: perspective.topRight.x / imageSize.width,
        yPct: perspective.topRight.y / imageSize.height,
      },
      bottomRight: {
        xPct: perspective.bottomRight.x / imageSize.width,
        yPct: perspective.bottomRight.y / imageSize.height,
      },
      bottomLeft: {
        xPct: perspective.bottomLeft.x / imageSize.width,
        yPct: perspective.bottomLeft.y / imageSize.height,
      },
    };
  }, [imageSize, perspective]);

  // ---- ドラッグハンドラ ----

  const updateCornerFromPointer = useCallback(
    (clientX: number, clientY: number, corner: CornerKey) => {
      const img = imageRef.current;
      if (!img || !imageSize) return;

      const rect = img.getBoundingClientRect();
      const x = Math.round(
        Math.max(0, Math.min(imageSize.width - 1, ((clientX - rect.left) / rect.width) * imageSize.width)),
      );
      const y = Math.round(
        Math.max(0, Math.min(imageSize.height - 1, ((clientY - rect.top) / rect.height) * imageSize.height)),
      );

      setPerspective((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [corner]: { x, y } as Point,
        };
      });
    },
    [imageSize],
  );

  const capturedElementRef = useRef<HTMLElement | null>(null);

  const handlePointerDown = useCallback(
    (corner: CornerKey) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      capturedElementRef.current = e.currentTarget as HTMLElement;
      setDraggingCorner(corner);
      updateCornerFromPointer(e.clientX, e.clientY, corner);
    },
    [updateCornerFromPointer],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingCorner) return;
      updateCornerFromPointer(e.clientX, e.clientY, draggingCorner);
    },
    [draggingCorner, updateCornerFromPointer],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (capturedElementRef.current) {
      capturedElementRef.current.releasePointerCapture(e.pointerId);
      capturedElementRef.current = null;
    }
    setDraggingCorner(null);
  }, []);

  // ---- プレビューのデバウンス更新 ----

  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRequestIdRef = useRef(0);

  useEffect(() => {
    if (!imageUrl || !imageSize) return;

    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
    }

    // 前回のプレビュー URL を破棄
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    setPreviewLoading(true);
    const requestId = ++previewRequestIdRef.current;
    previewTimerRef.current = setTimeout(async () => {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          img.addEventListener("load", () => resolve());
          img.addEventListener("error", () => reject(new Error("画像の読み込みに失敗しました。")));
          img.src = imageUrl;
        });

        const correction: CorrectionResult = {
          correctedAt: new Date().toISOString(),
          skipped: false,
          ...(usePerspective && perspective ? { perspective } : {}),
          ...(rotation !== 0 ? { rotation } : {}),
          ...((brightness !== 0 || contrast !== 0 || sharpness > 0 || backgroundRemoval)
            ? {
                adjustments: {
                  ...(brightness !== 0 ? { brightness } : {}),
                  ...(contrast !== 0 ? { contrast } : {}),
                  ...(sharpness > 0 ? { sharpness } : {}),
                  ...(backgroundRemoval ? { backgroundRemoval: true } : {}),
                },
              }
            : {}),
        };

        const resultCanvas = await applyCorrections(img, correction);

        // 古いリクエストの結果は破棄
        if (requestId !== previewRequestIdRef.current) return;

        const blob = await new Promise<Blob>((resolve, reject) => {
          resultCanvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("プレビュー画像の生成に失敗しました。"))),
            "image/png",
          );
        });

        if (requestId !== previewRequestIdRef.current) return;

        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      } catch (err) {
        if (requestId === previewRequestIdRef.current) {
          console.error("プレビューの生成に失敗しました:", err);
        }
      } finally {
        if (requestId === previewRequestIdRef.current) {
          setPreviewLoading(false);
        }
      }
    }, 300);

    return () => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
      }
      previewRequestIdRef.current = -1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, imageSize, usePerspective, perspective, rotation, brightness, contrast, sharpness, backgroundRemoval]);

  // ---- プレビュー URL のクリーンアップ ----

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // ---- 保存 ----

  const handleSave = useCallback(() => {
    const correction: CorrectionResult = {
      correctedAt: new Date().toISOString(),
      skipped: false,
      ...(usePerspective && perspective ? { perspective } : {}),
      ...(rotation !== 0 ? { rotation } : {}),
      ...((brightness !== 0 || contrast !== 0 || sharpness > 0 || backgroundRemoval)
        ? {
            adjustments: {
              ...(brightness !== 0 ? { brightness } : {}),
              ...(contrast !== 0 ? { contrast } : {}),
              ...(sharpness > 0 ? { sharpness } : {}),
              ...(backgroundRemoval ? { backgroundRemoval: true } : {}),
            },
          }
        : {}),
    };
    onSave(correction);
  }, [usePerspective, perspective, rotation, brightness, contrast, sharpness, backgroundRemoval, onSave]);

  const handleSkip = useCallback(() => {
    onSave({
      correctedAt: new Date().toISOString(),
      skipped: true,
    });
  }, [onSave]);

  const handleReset = useCallback(() => {
    if (imageSize) {
      setPerspective(createDefaultPerspectiveParams(imageSize.width, imageSize.height));
    }
    setRotation(DEFAULT_ROTATION);
    setBrightness(DEFAULT_BRIGHTNESS);
    setContrast(DEFAULT_CONTRAST);
    setSharpness(DEFAULT_SHARPNESS);
    setBackgroundRemoval(false);
    setAutoCorrectMessage(null);
  }, [imageSize]);

  // ---- 自動補正 ----

  const handleAutoCorrect = useCallback(async () => {
    if (!imageSize) return;
    setAutoCorrectLoading(true);
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => reject(new Error("画像の読み込みに失敗しました。")), { once: true });
        img.src = imageUrl;
      });

      const [perspParams, autoAdj] = await Promise.all([
        detectDocumentPerspective(img),
        analyzeImageAutoAdjustments(img),
      ]);

      if (!mountedRef.current) return;
      if (perspParams) {
        setPerspective(perspParams);
        setUsePerspective(true);
        setAutoCorrectMessage({ type: "success", text: "台形補正の輪郭を検出しました" });
      } else {
        setAutoCorrectMessage({ type: "warn", text: "輪郭を検出できませんでした。手動で調整してください。" });
      }
      setBrightness(autoAdj.brightness);
      setContrast(autoAdj.contrast);
      setBackgroundRemoval(true);
    } catch (err) {
      if (!mountedRef.current) return;
      console.error("自動補正に失敗しました:", err);
      setAutoCorrectMessage({ type: "warn", text: "自動補正に失敗しました。手動で調整してください。" });
    } finally {
      if (mountedRef.current) setAutoCorrectLoading(false);
    }
  }, [imageUrl, imageSize]);

  // ---- 有効な補正があるか ----

  const hasAdjustments = rotation !== 0 || brightness !== 0 || contrast !== 0 || sharpness > 0;
  const canSave = usePerspective || hasAdjustments || backgroundRemoval;

  // ---- レンダリング ----

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-slate-400">画像を読み込み中...</div>
      </div>
    );
  }

  if (!imageSize) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-red-600">画像の読み込みに失敗しました。</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-800">🖼️ 画像補正</h2>
          {autoCorrectMessage && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                autoCorrectMessage.type === "success"
                  ? "bg-green-100 text-green-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              <span role="status" aria-live="polite">{autoCorrectMessage.text}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAutoCorrect}
            disabled={autoCorrectLoading || loading}
            className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50 px-2 py-1 rounded border border-blue-200 hover:border-blue-300"
          >
            {autoCorrectLoading ? "検出中..." : "🪄 自動補正"}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded border border-slate-200 hover:border-slate-300"
          >
            リセット
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

      {/* 画像表示エリア */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 元画像 + コーナーハンドル */}
        <div>
          <div className="text-xs font-medium text-slate-500 mb-2">元画像</div>
          <div
            ref={containerRef}
            className="relative select-none"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imageRef}
              src={imageUrl}
              alt="元画像"
              className="w-full h-auto rounded-lg border border-slate-200"
              draggable={false}
            />

            {/* 台形補正の枠線 */}
            {usePerspective && cornerPercents && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none z-10"
                viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                preserveAspectRatio="none"
              >
                <polygon
                  points={[
                    `${perspective!.topLeft.x},${perspective!.topLeft.y}`,
                    `${perspective!.topRight.x},${perspective!.topRight.y}`,
                    `${perspective!.bottomRight.x},${perspective!.bottomRight.y}`,
                    `${perspective!.bottomLeft.x},${perspective!.bottomLeft.y}`,
                  ].join(" ")}
                  fill="rgba(59, 130, 246, 0.08)"
                  stroke="rgba(59, 130, 246, 0.6)"
                  strokeWidth={Math.max(2, Math.round(imageSize.width / 300))}
                />
              </svg>
            )}

            {/* コーナーハンドル */}
            {usePerspective && cornerPercents &&
              CORNER_KEYS.map((key) => (
                <CornerHandle
                  key={key}
                  label={CORNER_LABELS[key]}
                  xPct={cornerPercents[key].xPct}
                  yPct={cornerPercents[key].yPct}
                  size={24}
                  onPointerDown={handlePointerDown(key)}
                />
              ))}
          </div>
        </div>

        {/* プレビュー */}
        <div>
          <div className="text-xs font-medium text-slate-500 mb-2">
            プレビュー
            {previewLoading && (
              <span className="ml-2 text-blue-500">更新中...</span>
            )}
          </div>
          <div className="bg-slate-100 rounded-lg overflow-hidden min-h-[200px] flex items-center justify-center">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="補正プレビュー"
                className="max-w-full h-auto"
              />
            ) : previewLoading ? (
              <div className="text-slate-400 text-sm">処理中...</div>
            ) : (
              <div className="text-slate-400 text-sm">
                パラメータを変更するとプレビューが表示されます
              </div>
            )}
          </div>
        </div>
      </div>

      {/* コントロールパネル */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        {/* 台形補正トグル */}
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={usePerspective}
              onChange={(e) => setUsePerspective(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-slate-700">台形補正</span>
          </label>
          {usePerspective && (
            <span className="text-xs text-slate-400">
              {opencvStatus === "loading"
                ? "OpenCV.js 読み込み中..."
                : opencvStatus === "error"
                  ? "OpenCV.js 読み込み失敗"
                  : opencvStatus === "ready"
                    ? "OpenCV.js 準備完了"
                    : ""}
            </span>
          )}
        </div>

        {/* スライダー群 */}
        <div className="space-y-3 pl-1">
          <SliderControl
            label="回転"
            value={rotation}
            min={-45}
            max={45}
            step={0.5}
            unit="°"
            onChange={setRotation}
            onReset={() => setRotation(DEFAULT_ROTATION)}
          />
          <SliderControl
            label="明るさ"
            value={brightness}
            min={-100}
            max={100}
            unit=""
            onChange={setBrightness}
            onReset={() => setBrightness(DEFAULT_BRIGHTNESS)}
          />
          <SliderControl
            label="コントラスト"
            value={contrast}
            min={-100}
            max={100}
            unit=""
            onChange={setContrast}
            onReset={() => setContrast(DEFAULT_CONTRAST)}
          />
          <SliderControl
            label="シャープ"
            value={sharpness}
            min={0}
            max={100}
            unit=""
            onChange={setSharpness}
            onReset={() => setSharpness(DEFAULT_SHARPNESS)}
          />
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="backgroundRemoval"
              checked={backgroundRemoval}
              onChange={(e) => setBackgroundRemoval(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label
              htmlFor="backgroundRemoval"
              className="text-sm font-medium text-slate-700 cursor-pointer"
            >
              地色除去（背景を白に）
            </label>
          </div>
        </div>
      </div>

      {/* アクションボタン */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleSkip}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          ⏭️ 補正不要（スキップ）
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
            disabled={!canSave || (usePerspective && opencvStatus !== "ready")}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
