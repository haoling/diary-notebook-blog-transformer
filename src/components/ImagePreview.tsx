"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { applyCorrections } from "@/lib/image-processing";
import type { CorrectionResult } from "@/types/scan";

type ImagePreviewProps = {
  /** 画像の URL（Blob URL / data URL / 通常 URL）。 */
  src: string;
  /** 適用する補正パラメータ。undefined の場合は元画像をそのまま表示する。 */
  correction?: CorrectionResult;
  /** Canvas に適用する CSS クラス。 */
  className?: string;
  /** 補正後の Canvas サイズの上限幅（px）。 undefined なら制限なし。 */
  maxWidth?: number;
};

/**
 * 元画像に補正パラメータを適用して Canvas に描画するプレビューコンポーネント。
 *
 * 画像のロード → 補正適用（必要なら OpenCV.js を遅延ロード）→ Canvas 描画の
 * ライフサイクルを管理する。補正パラメータが変更されるたびに再描画する。
 */
export function ImagePreview({
  src,
  correction,
  className,
  maxWidth,
}: ImagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pendingCorrection = useRef<CorrectionResult | undefined>(correction);
  const renderQueued = useRef(false);
  const renderIdRef = useRef(0);

  /** 画像を読み込み、補正を適用して Canvas に描画する。 */
  const renderToCanvas = useCallback(
    async (img: HTMLImageElement, corr?: CorrectionResult, renderId?: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      setStatus("loading");
      setErrorMsg(null);

      try {
        let resultCanvas: HTMLCanvasElement;

        if (corr) {
          resultCanvas = await applyCorrections(img, corr);
        } else {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          resultCanvas = c;
        }

        // 古いリクエストの結果は破棄
        if (renderId !== undefined && renderId !== renderIdRef.current) return;

        let drawW = resultCanvas.width;
        let drawH = resultCanvas.height;

        if (maxWidth && drawW > maxWidth) {
          const scale = maxWidth / drawW;
          drawW = maxWidth;
          drawH = Math.round(drawH * scale);
        }

        canvas.width = drawW;
        canvas.height = drawH;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(resultCanvas, 0, 0, drawW, drawH);

        setStatus("ready");
      } catch (err) {
        if (renderId !== undefined && renderId !== renderIdRef.current) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "画像の描画に失敗しました。");
      }
    },
    [maxWidth],
  );

  /** 画像のロード。 */
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.addEventListener("load", () => {
      if (cancelled) return;
      imageRef.current = img;
      pendingCorrection.current = correction;
      const renderId = ++renderIdRef.current;
      renderToCanvas(img, correction, renderId);
    });

    img.addEventListener("error", () => {
      if (cancelled) return;
      setStatus("error");
      setErrorMsg("画像の読み込みに失敗しました。");
    });

    img.src = src;

    return () => {
      cancelled = true;
      imageRef.current = null;
      renderIdRef.current = -1;
    };
    // src の変更時のみ画像を再ロード。correction の変更は別の effect で処理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  /** 補正パラメータの変更時に再描画する。 */
  useEffect(() => {
    const img = imageRef.current;
    if (!img) return;

    pendingCorrection.current = correction;
    if (renderQueued.current) return;

    renderQueued.current = true;
    const renderId = ++renderIdRef.current;
    queueMicrotask(() => {
      renderQueued.current = false;
      if (imageRef.current) {
        renderToCanvas(imageRef.current, pendingCorrection.current, renderId);
      }
    });
  }, [correction, renderToCanvas]);

  return (
    <div className={`relative ${className ?? ""}`}>
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 rounded-lg z-10">
          <div className="text-slate-400 text-sm">処理中...</div>
        </div>
      )}
      {status === "error" && errorMsg && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-50 rounded-lg z-10">
          <div className="text-red-600 text-sm text-center px-4">{errorMsg}</div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="max-w-full h-auto rounded-lg"
      />
    </div>
  );
}
