/**
 * 画像補正モジュール。
 *
 * OpenCV.js (WASM) を動的ロードし、台形補正・回転・明るさ/コントラスト/シャープネス調整を
 * ブラウザ内で実行する。補正結果は画像ファイルとして生成せずパラメータのみを保持し、
 * 表示時に Canvas API で適用する方針に従う。
 */

import type { CorrectionResult, PerspectiveParams } from "@/types/scan";

// ---------------------------------------------------------------------------
// OpenCV.js 型定義（必要な部分のみ）
// ---------------------------------------------------------------------------

/** OpenCV.js のブラウザグローバルオブジェクトの型。 */
export type OpenCV = {
  Mat: new () => OpenCV.Mat;
  Size: new (width: number, height: number) => { width: number; height: number };
  Scalar: new (...vals: number[]) => number[];
  CV_32FC2: number;
  INTER_LINEAR: number;
  BORDER_CONSTANT: number;
  matFromArray(rows: number, cols: number, type: number, array: number[]): OpenCV.Mat;
  imread(imageSource: HTMLCanvasElement | HTMLImageElement): OpenCV.Mat;
  imshow(canvasSource: HTMLCanvasElement | string, mat: OpenCV.Mat): void;
  getPerspectiveTransform(src: OpenCV.Mat, dst: OpenCV.Mat): OpenCV.Mat;
  warpPerspective(
    src: OpenCV.Mat,
    dst: OpenCV.Mat,
    M: OpenCV.Mat,
    dsize: { width: number; height: number },
    flags?: number,
    borderMode?: number,
    borderValue?: number[],
  ): void;
  getRotationMatrix2D(
    center: { x: number; y: number },
    angle: number,
    scale: number,
  ): OpenCV.Mat;
  warpAffine(
    src: OpenCV.Mat,
    dst: OpenCV.Mat,
    M: OpenCV.Mat,
    dsize: { width: number; height: number },
    flags?: number,
  ): void;
  GaussianBlur(
    src: OpenCV.Mat,
    dst: OpenCV.Mat,
    ksize: { width: number; height: number },
    sigmaX: number,
  ): void;
  addWeighted(
    src1: OpenCV.Mat,
    alpha: number,
    src2: OpenCV.Mat,
    beta: number,
    gamma: number,
    dst: OpenCV.Mat,
  ): void;
};

export namespace OpenCV {
  export type Mat = {
    rows: number;
    cols: number;
    data: Uint8Array;
    type(): number;
    delete(): void;
  };
}

// ---------------------------------------------------------------------------
// OpenCV.js ローダー
// ---------------------------------------------------------------------------

let cvPromise: Promise<OpenCV> | null = null;
let cvInstance: OpenCV | null = null;

/**
 * OpenCV.js (WASM) を動的にロードして初期化する。
 * public/opencv.js を script タグで読み込み、WASM の初期化完了を待つ。
 * 一度ロードされたらキャッシュされ、以降の呼び出しは即座に解決される。
 */
export async function loadOpenCV(): Promise<OpenCV> {
  if (cvInstance) return cvInstance;
  if (cvPromise) return cvPromise;

  cvPromise = new Promise<OpenCV>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("OpenCV.js はブラウザ環境でのみ使用できます。"));
      return;
    }

    const g = globalThis as Record<string, unknown>;
    let cvAlreadyExists = false;
    if (g.cv && typeof (g.cv as OpenCV).Mat === "function") {
      cvAlreadyExists = true;
      const cv = g.cv as OpenCV;
      try {
        const testMat = new cv.Mat();
        testMat.delete();
        cvInstance = cv;
        resolve(cvInstance);
        return;
      } catch {
        // WASM 初期化未完了：ポーリングで待機
      }
    }

    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

    let isPolling = false;
    let pollFrameId: number | null = null;
    const stopPolling = () => {
      isPolling = false;
      if (pollFrameId !== null) {
        cancelAnimationFrame(pollFrameId);
        pollFrameId = null;
      }
    };

    const timeout = setTimeout(() => {
      stopPolling();
      cvPromise = null;
      reject(new Error("OpenCV.js の読み込みがタイムアウトしました。ネットワーク接続を確認してください。"));
    }, 120_000);

    if (cvAlreadyExists) {
      // script は既に読み込み済み。ポーリングのみ開始
      isPolling = true;
      const poll = () => {
        if (!isPolling) return;
        const cv = (globalThis as Record<string, unknown>).cv as OpenCV | undefined;
        if (cv?.Mat) {
          try {
            const testMat = new cv.Mat();
            testMat.delete();
          } catch {
            pollFrameId = requestAnimationFrame(poll);
            return;
          }
          stopPolling();
          clearTimeout(timeout);
          cvInstance = cv;
          resolve(cv);
          return;
        }
        pollFrameId = requestAnimationFrame(poll);
      };
      poll();
      return;
    }

    const script = document.createElement("script");
    script.src = `${basePath}/opencv.js`;
    script.async = true;

    script.addEventListener("load", () => {
      isPolling = true;

      const poll = () => {
        if (!isPolling) return;

        const cv = (globalThis as Record<string, unknown>).cv as OpenCV | undefined;
        if (cv?.Mat) {
          // WASM ランタイムの初期化完了を確認するため Mat 生成を試みる
          try {
            const testMat = new cv.Mat();
            testMat.delete();
          } catch {
            // 初期化未完了：ポーリングを継続
            pollFrameId = requestAnimationFrame(poll);
            return;
          }
          stopPolling();
          clearTimeout(timeout);
          cvInstance = cv;
          resolve(cv);
          return;
        }

        pollFrameId = requestAnimationFrame(poll);
      };

      poll();
    });

    script.addEventListener("error", () => {
      stopPolling();
      clearTimeout(timeout);
      cvPromise = null;
      reject(new Error("OpenCV.js の読み込みに失敗しました。"));
    });

    document.head.appendChild(script);
  });

  return cvPromise;
}

/** OpenCV.js がすでにロード・初期化済みかどうかを返す。 */
export function isOpencvLoaded(): boolean {
  return cvInstance !== null;
}

// ---------------------------------------------------------------------------
// 画像ソースのユーティリティ
// ---------------------------------------------------------------------------

type ImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/** 画像ソースから幅を取得する。 */
function getSourceWidth(src: ImageSource): number {
  return "naturalWidth" in src ? src.naturalWidth : src.width;
}

/** 画像ソースから高さを取得する。 */
function getSourceHeight(src: ImageSource): number {
  return "naturalHeight" in src ? src.naturalHeight : src.height;
}

/** 画像ソースを Canvas に描画して返す。 */
export function imageToCanvas(source: ImageSource): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = getSourceWidth(source);
  canvas.height = getSourceHeight(source);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------
// 台形補正（Perspective Correction）
// ---------------------------------------------------------------------------

/**
 * OpenCV.js を使用して台形補正を適用する。
 * 4隅の座標で定義された四角形領域を矩形に変換する。
 */
export async function applyPerspectiveCorrection(
  source: ImageSource,
  params: PerspectiveParams,
): Promise<HTMLCanvasElement> {
  const cv = await loadOpenCV();

  const srcCanvas = imageToCanvas(source);
  let src: OpenCV.Mat | null = null;
  let dst: OpenCV.Mat | null = null;
  let srcPts: OpenCV.Mat | null = null;
  let dstPts: OpenCV.Mat | null = null;
  let M: OpenCV.Mat | null = null;

  try {
    src = cv.imread(srcCanvas);
    dst = new cv.Mat();

    srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      params.topLeft.x, params.topLeft.y,
      params.topRight.x, params.topRight.y,
      params.bottomRight.x, params.bottomRight.y,
      params.bottomLeft.x, params.bottomLeft.y,
    ]);

    const topWidth = Math.hypot(
      params.topRight.x - params.topLeft.x,
      params.topRight.y - params.topLeft.y,
    );
    const bottomWidth = Math.hypot(
      params.bottomRight.x - params.bottomLeft.x,
      params.bottomRight.y - params.bottomLeft.y,
    );
    const maxWidth = Math.max(1, Math.round(Math.max(topWidth, bottomWidth)));

    const leftHeight = Math.hypot(
      params.bottomLeft.x - params.topLeft.x,
      params.bottomLeft.y - params.topLeft.y,
    );
    const rightHeight = Math.hypot(
      params.bottomRight.x - params.topRight.x,
      params.bottomRight.y - params.topRight.y,
    );
    const maxHeight = Math.max(1, Math.round(Math.max(leftHeight, rightHeight)));

    dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      maxWidth, 0,
      maxWidth, maxHeight,
      0, maxHeight,
    ]);

    M = cv.getPerspectiveTransform(srcPts, dstPts);
    const dsize = new cv.Size(maxWidth, maxHeight);
    cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));

    const resultCanvas = document.createElement("canvas");
    resultCanvas.width = maxWidth;
    resultCanvas.height = maxHeight;
    cv.imshow(resultCanvas, dst);

    return resultCanvas;
  } finally {
    M?.delete();
    dstPts?.delete();
    srcPts?.delete();
    dst?.delete();
    src?.delete();
  }
}

// ---------------------------------------------------------------------------
// 回転（Rotation）
// ---------------------------------------------------------------------------

/**
 * Canvas API を使用して画像を回転する。
 * 回転後の画像サイズは元画像を包含する最小矩形になる。
 */
export function applyRotation(
  source: ImageSource,
  angleDeg: number,
): HTMLCanvasElement {
  if (angleDeg === 0) return imageToCanvas(source);

  const radians = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const srcW = getSourceWidth(source);
  const srcH = getSourceHeight(source);
  const newW = Math.ceil(srcW * cos + srcH * sin);
  const newH = Math.ceil(srcW * sin + srcH * cos);

  const canvas = document.createElement("canvas");
  canvas.width = newW;
  canvas.height = newH;
  const ctx = canvas.getContext("2d")!;

  ctx.translate(newW / 2, newH / 2);
  ctx.rotate(radians);
  ctx.drawImage(source, -srcW / 2, -srcH / 2);

  return canvas;
}

// ---------------------------------------------------------------------------
// 明るさ・コントラスト（Brightness / Contrast）
// ---------------------------------------------------------------------------

/**
 * Canvas API の filter プロパティを使用して明るさとコントラストを調整する。
 * brightness/contrast は -100〜100 の範囲を想定（0 = 変更なし）。
 */
export function applyBrightnessContrast(
  source: ImageSource,
  brightness: number,
  contrast: number,
): HTMLCanvasElement {
  const srcW = getSourceWidth(source);
  const srcH = getSourceHeight(source);

  const canvas = document.createElement("canvas");
  canvas.width = srcW;
  canvas.height = srcH;
  const ctx = canvas.getContext("2d")!;

  const filters: string[] = [];
  if (brightness !== 0) {
    filters.push(`brightness(${1 + brightness / 100})`);
  }
  if (contrast !== 0) {
    filters.push(`contrast(${1 + contrast / 100})`);
  }
  if (filters.length > 0) {
    ctx.filter = filters.join(" ");
  }
  ctx.drawImage(source, 0, 0);

  return canvas;
}

// ---------------------------------------------------------------------------
// シャープネス（Sharpness / Unsharp Mask）
// ---------------------------------------------------------------------------

/**
 * 3x3 シャープニングカーネルによるアンシャープマスク処理。
 * amount は 0〜100 の範囲を想定（0 = 処理なし）。
 */
export function applySharpen(
  source: ImageSource,
  amount: number,
): HTMLCanvasElement {
  if (amount <= 0) return imageToCanvas(source);

  const srcW = getSourceWidth(source);
  const srcH = getSourceHeight(source);

  const srcCanvas = imageToCanvas(source);
  const srcCtx = srcCanvas.getContext("2d")!;
  const imageData = srcCtx.getImageData(0, 0, srcW, srcH);
  const src = imageData.data;

  const output = new Uint8ClampedArray(src.length);
  output.set(src);

  const a = Math.min(amount / 100, 3);
  const center = 1 + 4 * a;
  const edge = -a;
  // 3x3 sharpening kernel: [0, -a, 0, -a, 1+4a, -a, 0, -a, 0]

  for (let y = 1; y < srcH - 1; y++) {
    for (let x = 1; x < srcW - 1; x++) {
      for (let c = 0; c < 3; c++) {
        const idx00 = ((y - 1) * srcW + (x - 1)) * 4 + c;
        const idx01 = ((y - 1) * srcW + x) * 4 + c;
        const idx02 = ((y - 1) * srcW + (x + 1)) * 4 + c;
        const idx10 = (y * srcW + (x - 1)) * 4 + c;
        const idx11 = (y * srcW + x) * 4 + c;
        const idx12 = (y * srcW + (x + 1)) * 4 + c;
        const idx20 = ((y + 1) * srcW + (x - 1)) * 4 + c;
        const idx21 = ((y + 1) * srcW + x) * 4 + c;
        const idx22 = ((y + 1) * srcW + (x + 1)) * 4 + c;

        output[idx11] = Math.min(
          255,
          Math.max(
            0,
            edge * src[idx00] + edge * src[idx01] + edge * src[idx02] +
            edge * src[idx10] + center * src[idx11] + edge * src[idx12] +
            edge * src[idx20] + edge * src[idx21] + edge * src[idx22],
          ),
        );
      }
      // alpha は元の値をそのまま使用
    }
  }

  const resultImageData = new ImageData(output, srcW, srcH);
  const canvas = document.createElement("canvas");
  canvas.width = srcW;
  canvas.height = srcH;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(resultImageData, 0, 0);

  return canvas;
}

// ---------------------------------------------------------------------------
// 補正パラメータの統合適用
// ---------------------------------------------------------------------------

/**
 * CorrectionResult に基づいてすべての補正を元画像に適用し、結果の Canvas を返す。
 * 補正は以下の順序で適用される：
 * 1. 台形補正（OpenCV.js warpPerspective）
 * 2. 回転（Canvas API）
 * 3. 明るさ・コントラスト（Canvas API filter）
 * 4. シャープネス（ピクセル演算）
 *
 * `correction.skipped` が true の場合は補正をスキップし、元画像をそのまま Canvas に描画して返す。
 */
export async function applyCorrections(
  source: ImageSource,
  correction: CorrectionResult,
): Promise<HTMLCanvasElement> {
  if (correction.skipped) {
    return source instanceof HTMLCanvasElement ? source : imageToCanvas(source);
  }

  let current: ImageSource = source;

  // 1. 台形補正
  if (correction.perspective) {
    current = await applyPerspectiveCorrection(current, correction.perspective);
  }

  // 2. 回転
  if (correction.rotation !== undefined && correction.rotation !== 0) {
    current = applyRotation(current, correction.rotation);
  }

  // 3. 明るさ・コントラスト
  const brightness = correction.adjustments?.brightness ?? 0;
  const contrast = correction.adjustments?.contrast ?? 0;
  if (brightness !== 0 || contrast !== 0) {
    current = applyBrightnessContrast(current, brightness, contrast);
  }

  // 4. シャープネス
  const sharpness = correction.adjustments?.sharpness ?? 0;
  if (sharpness > 0) {
    current = applySharpen(current, sharpness);
  }

  return current instanceof HTMLCanvasElement ? current : imageToCanvas(current);
}

// ---------------------------------------------------------------------------
// デフォルトの台形補正パラメータ生成
// ---------------------------------------------------------------------------

/**
 * 画像サイズから、画像全体を囲む台形補正のデフォルト4隅座標を生成する。
 * 余白率（marginRatio）で内側に少しだけ縮めたデフォルト値を返す。
 */
export function createDefaultPerspectiveParams(
  imageWidth: number,
  imageHeight: number,
  marginRatio = 0.05,
): PerspectiveParams {
  const mx = Math.round(imageWidth * marginRatio);
  const my = Math.round(imageHeight * marginRatio);
  const maxX = Math.max(0, imageWidth - 1);
  const maxY = Math.max(0, imageHeight - 1);
  return {
    topLeft: { x: Math.min(Math.max(mx, 0), maxX), y: Math.min(Math.max(my, 0), maxY) },
    topRight: { x: Math.min(Math.max(maxX - mx, 0), maxX), y: Math.min(Math.max(my, 0), maxY) },
    bottomRight: { x: Math.min(Math.max(maxX - mx, 0), maxX), y: Math.min(Math.max(maxY - my, 0), maxY) },
    bottomLeft: { x: Math.min(Math.max(mx, 0), maxX), y: Math.min(Math.max(maxY - my, 0), maxY) },
  };
}
