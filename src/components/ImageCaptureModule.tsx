"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type ImageCaptureModuleProps = {
  onCapture: (blob: Blob, fileName: string) => Promise<void>;
  disabled?: boolean;
};

/**
 * カメラ撮影で画像を取り込むコンポーネント。
 *
 * navigator.mediaDevices.getUserMedia を使用してカメラにアクセスし、
 * 撮影した画像を Blob としてコールバックに渡す。
 */
export const ImageCaptureModule = ({
  onCapture,
  disabled = false,
}: ImageCaptureModuleProps) => {
  const [streaming, setStreaming] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment",
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreaming(false);
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreaming(true);
    } catch (err) {
      stopCamera();
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("カメラへのアクセスが拒否されました。ブラウザの設定を確認してください。");
      } else if (err instanceof DOMException && err.name === "NotFoundError") {
        setError("カメラが見つかりません。");
      } else {
        setError("カメラの起動に失敗しました。");
      }
    }
  }, [facingMode, stopCamera]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const capture = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setCapturing(true);
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas コンテキストの取得に失敗しました。");
      ctx.drawImage(video, 0, 0);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("画像の生成に失敗しました。"))),
          "image/jpeg",
          0.92,
        );
      });

      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, "0");
      const fileName = `scan_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.jpg`;

      await onCapture(blob, fileName);
      stopCamera();
    } catch (err) {
      setError(err instanceof Error ? err.message : "撮影に失敗しました。");
    } finally {
      setCapturing(false);
    }
  }, [onCapture, stopCamera]);

  const toggleCamera = useCallback(() => {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  }, []);

  useEffect(() => {
    if (streaming) {
      stopCamera();
      startCamera();
    }
  }, [facingMode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (streaming) {
    return (
      <div className="relative w-full rounded-lg overflow-hidden bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-auto"
        />
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-3">
          <button
            type="button"
            onClick={toggleCamera}
            disabled={capturing || disabled}
            className="rounded-full bg-white/80 p-3 text-slate-700 hover:bg-white transition-colors"
            aria-label="カメラを切り替え"
          >
            🔄
          </button>
          <button
            type="button"
            onClick={capture}
            disabled={capturing || disabled}
            className="rounded-full bg-white p-3 text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50"
            aria-label="撮影"
          >
            <div className="w-12 h-12 rounded-full border-4 border-slate-700" />
          </button>
          <button
            type="button"
            onClick={stopCamera}
            disabled={capturing}
            className="rounded-full bg-white/80 p-3 text-slate-700 hover:bg-white transition-colors"
            aria-label="カメラを閉じる"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={startCamera}
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
      >
        📷 カメラで撮影
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
};
