/**
 * 画像補正モジュール。
 *
 * OpenCV.js (WASM) のロード・初期化・台形補正を Web Worker で実行し、
 * メインスレッドのフリーズを防止する。回転・明るさ/コントラスト/シャープネスは
 * 引き続きメインスレッドで Canvas API を使用。
 *
 * 補正結果は画像ファイルとして生成せずパラメータのみを保持し、
 * 表示時に Canvas API で適用する方針に従う。
 */

import type { CorrectionResult, PerspectiveParams } from "@/types/scan";

// ---------------------------------------------------------------------------
// OpenCV Web Worker 通信
// ---------------------------------------------------------------------------

type WorkerImageData = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

type WorkerStatus = "idle" | "loading" | "ready" | "error";

let worker: Worker | null = null;
let workerStatus: WorkerStatus = "idle";
let workerInitPromise: Promise<void> | null = null;
const statusListeners = new Set<(status: WorkerStatus) => void>();

function getBasePath(): string {
  return process.env.NEXT_PUBLIC_BASE_PATH || "";
}

function ensureWorker(): Worker {
  if (!worker) {
    const basePath = getBasePath();
    worker = new Worker(`${basePath}/opencv-worker.js`);
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "loading") {
        updateStatus("loading");
      } else if (msg.type === "ready") {
        updateStatus("ready");
      } else if (msg.type === "error") {
        if (msg.id) {
          // 個別タスクのエラーは initOpenCV の reject で処理
        }
        updateStatus("error");
      }
    };
    worker.onerror = () => {
      updateStatus("error");
    };
  }
  return worker;
}

function updateStatus(status: WorkerStatus) {
  workerStatus = status;
  statusListeners.forEach((listener) => listener(status));
}

/**
 * OpenCV.js を Web Worker で初期化する。
 * 一度初期化されたらキャッシュされ、以降の呼び出しは即座に解決される。
 */
export async function initOpenCV(): Promise<void> {
  if (workerStatus === "ready") return;
  if (workerInitPromise) return workerInitPromise;

  workerInitPromise = new Promise<void>((resolve, reject) => {
    const w = ensureWorker();

    const timeout = setTimeout(() => {
      workerInitPromise = null;
      reject(new Error("OpenCV.js の読み込みがタイムアウトしました。ネットワーク接続を確認してください。"));
    }, 120_000);

    const originalOnMessage = w.onmessage;
    w.onmessage = (e) => {
      // ステータス更新メッセージは元のハンドラに委譲
      originalOnMessage?.call(w, e);
      if (e.data.type === "ready") {
        clearTimeout(timeout);
        resolve();
      } else if (e.data.type === "error" && !e.data.id) {
        clearTimeout(timeout);
        workerInitPromise = null;
        reject(new Error(e.data.error));
      }
    };

    updateStatus("loading");
    w.postMessage({ type: "init" });
  });

  return workerInitPromise;
}

/**
 * OpenCV.js のステータス変更をリッスンする。
 * リスナーを削除する関数を返す。
 */
export function onOpenCVStatusChange(listener: (status: WorkerStatus) => void): () => void {
  statusListeners.add(listener);
  // 現在のステータスを即座に通知
  listener(workerStatus);
  return () => {
    statusListeners.delete(listener);
  };
}

/** OpenCV.js がすでにロード・初期化済みかどうかを返す。 */
export function isOpencvLoaded(): boolean {
  return workerStatus === "ready";
}

/** 下位互換用: loadOpenCV は initOpenCV のエイリアス */
export const loadOpenCV = initOpenCV;

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
// 台形補正（Perspective Correction）— Worker 経由
// ---------------------------------------------------------------------------

let taskIdCounter = 0;
const pendingTasks = new Map<
  string,
  {
    resolve: (data: WorkerImageData) => void;
    reject: (err: Error) => void;
  }
>();

/**
 * Web Worker 経由で台形補正を適用する。
 * メインスレッドではフリーズせず、Worker 上で OpenCV.js が処理を行う。
 */
function workerApplyPerspectiveCorrection(
  imageData: WorkerImageData,
  params: PerspectiveParams,
): Promise<WorkerImageData> {
  return new Promise((resolve, reject) => {
    const w = ensureWorker();
    const id = `task-${++taskIdCounter}`;

    pendingTasks.set(id, { resolve, reject });

    // 一時的なメッセージハンドラを設定（結果の受け取り用）
    const handler = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", handler);

      const task = pendingTasks.get(id);
      pendingTasks.delete(id);

      if (!task) return;

      if (e.data.type === "result") {
        task.resolve(e.data.imageData);
      } else if (e.data.type === "error") {
        task.reject(new Error(e.data.error));
      }
    };
    w.addEventListener("message", handler);

    // ImageData のバッファを Transferable として送信（ゼロコピー）
    const copy = {
      data: new Uint8ClampedArray(imageData.data),
      width: imageData.width,
      height: imageData.height,
    };
    w.postMessage(
      { type: "perspective", id, imageData: copy, params },
      [copy.data.buffer],
    );
  });
}

/**
 * Web Worker 上の OpenCV.js を使用して台形補正を適用する。
 * 4隅の座標で定義された四角形領域を矩形に変換する。
 */
export async function applyPerspectiveCorrection(
  source: ImageSource,
  params: PerspectiveParams,
): Promise<HTMLCanvasElement> {
  await initOpenCV();

  // 画像ソース → Canvas → ImageData
  const srcCanvas = imageToCanvas(source);
  const ctx = srcCanvas.getContext("2d")!;
  const imgData = ctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);

  const workerImageData: WorkerImageData = {
    data: imgData.data,
    width: imgData.width,
    height: imgData.height,
  };

  // Worker で台形補正を実行
  const result = await workerApplyPerspectiveCorrection(workerImageData, params);

  // 結果を Canvas に描画
  const resultCanvas = document.createElement("canvas");
  resultCanvas.width = result.width;
  resultCanvas.height = result.height;
  const resultCtx = resultCanvas.getContext("2d")!;
  const resultImgData = new ImageData(
    new Uint8ClampedArray(result.data),
    result.width,
    result.height,
  );
  resultCtx.putImageData(resultImgData, 0, 0);

  return resultCanvas;
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

  // 5. 地色除去
  if (correction.adjustments?.backgroundRemoval) {
    current = applyBackgroundRemoval(current);
  }

  return current instanceof HTMLCanvasElement ? current : imageToCanvas(current);
}

// ---------------------------------------------------------------------------
// ドキュメント輪郭自動検出（Worker 経由）
// ---------------------------------------------------------------------------

const pendingDetectionTasks = new Map<
  string,
  {
    resolve: (params: PerspectiveParams | null) => void;
    reject: (err: Error) => void;
  }
>();

/**
 * Web Worker 経由でドキュメントの4隅座標を自動検出する。
 */
function workerDetectDocumentPerspective(
  imageData: WorkerImageData,
): Promise<PerspectiveParams | null> {
  return new Promise((resolve, reject) => {
    const w = ensureWorker();
    const id = `detect-${++taskIdCounter}`;

    pendingDetectionTasks.set(id, { resolve, reject });

    const handler = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", handler);

      const task = pendingDetectionTasks.get(id);
      pendingDetectionTasks.delete(id);

      if (!task) return;

      if (e.data.type === "result") {
        task.resolve(e.data.perspectiveParams ?? null);
      } else if (e.data.type === "error") {
        task.reject(new Error(e.data.error));
      }
    };
    w.addEventListener("message", handler);

    const copy = {
      data: new Uint8ClampedArray(imageData.data),
      width: imageData.width,
      height: imageData.height,
    };
    w.postMessage(
      { type: "detectDocument", id, imageData: copy },
      [copy.data.buffer],
    );
  });
}

/**
 * Web Worker 上の OpenCV.js を使用してドキュメントの4隅座標を自動検出する。
 * Canny エッジ検出と輪郭近似により最大四角形領域を推定する。
 * 検出できない場合は null を返す。
 */
export async function detectDocumentPerspective(
  source: ImageSource,
): Promise<PerspectiveParams | null> {
  await initOpenCV();

  const srcCanvas = imageToCanvas(source);
  const ctx = srcCanvas.getContext("2d")!;
  const imgData = ctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);

  const workerImageData: WorkerImageData = {
    data: imgData.data,
    width: imgData.width,
    height: imgData.height,
  };

  return workerDetectDocumentPerspective(workerImageData);
}

// ---------------------------------------------------------------------------
// 自動明るさ・コントラスト分析
// ---------------------------------------------------------------------------

/**
 * 画像のヒストグラムを分析し、明るさとコントラストの自動補正値を提案する。
 * ITU-R BT.601 輝度値の 2/98 パーセンタイルを基準に算出する。
 */
export function analyzeImageAutoAdjustments(
  source: ImageSource,
): { brightness: number; contrast: number } {
  const canvas = imageToCanvas(source);
  const ctx = canvas.getContext("2d")!;
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;

  // 輝度ヒストグラムを構築（256段階）
  const histogram = new Array<number>(256).fill(0);
  const totalPixels = canvas.width * canvas.height;
  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    histogram[lum]++;
  }

  // 指定パーセンタイルの輝度値を取得する
  const findPercentile = (pct: number): number => {
    const target = totalPixels * pct;
    let count = 0;
    for (let v = 0; v < 256; v++) {
      count += histogram[v];
      if (count >= target) return v;
    }
    return 255;
  };

  const darkPoint = findPercentile(0.02);   // 2パーセンタイル（暗部）
  const whitePoint = findPercentile(0.98);  // 98パーセンタイル（紙の色）

  // 明るさ：紙が白（230以上）になるよう調整
  const brightness = Math.round((230 - whitePoint) * 0.5);

  // コントラスト：ダイナミックレンジが狭い場合に増強
  const dynamicRange = whitePoint - darkPoint;
  const contrast = Math.round((230 - dynamicRange) / 230 * 40);

  return {
    brightness: Math.max(-100, Math.min(100, brightness)),
    contrast: Math.max(0, Math.min(100, contrast)),
  };
}

// ---------------------------------------------------------------------------
// 地色除去（Background Removal）
// ---------------------------------------------------------------------------

/**
 * 指定した閾値以上の明るさを持つピクセルを純白（255,255,255）に置換する。
 * 紙の地色（クリーム・薄黄色など）を除去して背景を白くする。
 * threshold は 0〜255 の範囲（デフォルト: 230）。
 */
export function applyBackgroundRemoval(
  source: ImageSource,
  threshold = 230,
): HTMLCanvasElement {
  const canvas = imageToCanvas(source);
  const ctx = canvas.getContext("2d")!;
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i] >= threshold && data[i + 1] >= threshold && data[i + 2] >= threshold) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      // alpha は変更しない
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
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
