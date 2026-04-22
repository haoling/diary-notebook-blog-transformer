/**
 * 段落境界検出モジュール。
 *
 * OpenCV.js (WASM) の Web Worker を使用して補正済み画像から
 * 水平罫線・余白を検出し、段落境界のY座標配列を生成する。
 * 検出結果は ParagraphObject[] / SplitResult に変換される。
 */

import type { ParagraphObject, SplitResult, CropRect } from "@/types/scan";
import {
  initOpenCV,
  imageToCanvas,
} from "@/lib/image-processing";

// ---------------------------------------------------------------------------
// Worker 通信
// ---------------------------------------------------------------------------

type WorkerImageData = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

let taskIdCounter = 0;

function getBasePath(): string {
  return process.env.NEXT_PUBLIC_BASE_PATH || "";
}

function ensureWorker(): Worker {
  // image-processing.ts と同一の Worker を共有する
  const basePath = getBasePath();
  return new Worker(`${basePath}/opencv-worker.js`);
}

type ParagraphBoundariesResult = {
  splitYs: number[];
};

/** Worker に段落境界検出タスクを送信し、結果を取得する。 */
function workerDetectParagraphs(
  imageData: WorkerImageData,
  options?: {
    minGapRatio?: number;
    densityThreshold?: number;
  },
): Promise<ParagraphBoundariesResult> {
  return new Promise((resolve, reject) => {
    const w = ensureWorker();
    const id = `para-${++taskIdCounter}`;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      w.removeEventListener("message", handler);
      w.removeEventListener("error", errorHandler);
      w.removeEventListener("messageerror", errorHandler);
    };

    const handler = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      cleanup();
      if (e.data.type === "result") {
        resolve(e.data.paragraphBoundaries as ParagraphBoundariesResult);
      } else if (e.data.type === "error") {
        reject(new Error(e.data.error));
      }
    };

    const errorHandler = () => {
      cleanup();
      reject(new Error("Worker error during paragraph detection"));
    };

    w.addEventListener("message", handler);
    w.addEventListener("error", errorHandler);
    w.addEventListener("messageerror", errorHandler);

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("段落境界検出がタイムアウトしました。"));
    }, 30_000);

    const copy = {
      data: new Uint8ClampedArray(imageData.data),
      width: imageData.width,
      height: imageData.height,
    };
    w.postMessage({ type: "init" });
    w.postMessage({ type: "detectParagraphs", id, imageData: copy, options }, [copy.data.buffer]);
  });
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/** 段落境界検出のオプション。 */
export type DetectParagraphsOptions = {
  /** 段落間の最小ギャップ高さ（画像高さに対する比率）。デフォルト: 0.03 */
  minGapRatio?: number;
  /** テキスト密度の閾値（0〜1）。これ以下を余白と判定。デフォルト: 0.05 */
  densityThreshold?: number;
};

/**
 * 画像から段落境界のY座標配列を検出する。
 * 形態素演算でテキスト領域を結合し、投射密度の大きな谷を段落境界とする。
 * 手帳の罫線はノイズとして除去される。
 */
export async function detectParagraphs(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  options?: DetectParagraphsOptions,
): Promise<number[]> {
  await initOpenCV();

  const canvas = source instanceof HTMLCanvasElement ? source : imageToCanvas(source);
  const ctx = canvas.getContext("2d")!;
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const workerImageData: WorkerImageData = {
    data: imgData.data,
    width: imgData.width,
    height: imgData.height,
  };

  const result = await workerDetectParagraphs(workerImageData, {
    minGapRatio: options?.minGapRatio,
    densityThreshold: options?.densityThreshold,
  });

  return result.splitYs;
}

/** 一意のIDを生成する。 */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * 分割Y座標配列から ParagraphObject[] を生成する。
 *
 * splitYs は昇順のY座標配列。先頭に0、末尾にimageHeightを補完し、
 * 隣接するY座標間を段落の CropRect とする。
 */
export function splitYsToParagraphs(
  splitYs: number[],
  imageWidth: number,
  imageHeight: number,
): ParagraphObject[] {
  // 0 と imageHeight を含めた境界点を生成
  const boundaries = [0, ...splitYs.filter((y) => y > 0 && y < imageHeight), imageHeight];

  return boundaries.slice(0, -1).map((topY, i) => {
    const bottomY = boundaries[i + 1];
    const height = Math.max(1, bottomY - topY);
    const cropRect: CropRect = {
      x: 0,
      y: topY,
      width: imageWidth,
      height,
    };
    return {
      id: generateId(),
      order: i,
      cropRect,
    };
  });
}

/**
 * 段落境界検出を実行し、ParagraphObject[] を生成する。
 * 自動検出の全工程をまとめたヘルパー。
 */
export async function autoDetectParagraphs(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  options?: DetectParagraphsOptions,
): Promise<ParagraphObject[]> {
  const canvas = source instanceof HTMLCanvasElement ? source : imageToCanvas(source);
  const splitYs = await detectParagraphs(source, options);
  return splitYsToParagraphs(splitYs, canvas.width, canvas.height);
}

/**
 * ParagraphObject[] から SplitResult を生成する。
 */
export function createSplitResult(paragraphs: ParagraphObject[]): SplitResult {
  return {
    splitAt: new Date().toISOString(),
    paragraphs,
  };
}
