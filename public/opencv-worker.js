/**
 * OpenCV.js Web Worker
 *
 * OpenCV.js のロード・初期化・画像処理をメインスレッドから切り離し、
 * ブラウザのタブフリーズを防止する。
 *
 * メッセージプロトコル:
 *   Main → Worker:
 *     { type: 'init' }
 *     { type: 'perspective', id: string, imageData: { data: Uint8ClampedArray, width: number, height: number }, params: PerspectiveParams }
 *   Worker → Main:
 *     { type: 'ready' }
 *     { type: 'loading' }
 *     { type: 'result', id: string, imageData: { data: Uint8ClampedArray, width: number, height: number } }
 *     { type: 'error', id?: string, error: string }
 */

/* eslint-disable no-restricted-globals */

let cvReady = false;
let pendingInit = false;
const pendingTasks = [];

/** OpenCV.js の初期化完了を確認するポーリング */
function waitForCv(resolve, reject) {
  try {
    if (typeof cv !== "undefined" && typeof cv.Mat === "function") {
      const testMat = new cv.Mat();
      testMat.delete();
      cvReady = true;
      self.postMessage({ type: "ready" });
      resolve();
      return;
    }
  } catch {
    // 初期化未完了：ポーリング継続
  }
  setTimeout(() => waitForCv(resolve, reject), 100);
}

/** OpenCV.js をロード・初期化する */
function initOpenCV() {
  if (cvReady) return Promise.resolve();
  if (pendingInit) {
    return new Promise((resolve, reject) => {
      pendingTasks.push({ resolve, reject });
    });
  }
  pendingInit = true;
  self.postMessage({ type: "loading" });

  return new Promise((resolve, reject) => {
    const script = self.importScripts
      ? null // importScripts は後で使用
      : null;

    // importScripts を使って opencv.js をロード
    try {
      self.importScripts("./opencv.js");
    } catch (err) {
      pendingInit = false;
      const error = "OpenCV.js の読み込みに失敗しました。";
      self.postMessage({ type: "error", error });
      reject(new Error(error));
      return;
    }

    // WASM 初期化完了を待機（ポーリング）
    waitForCv(
      () => {
        pendingInit = false;
        resolve();
        pendingTasks.forEach((t) => t.resolve());
        pendingTasks.length = 0;
      },
      (err) => {
        pendingInit = false;
        reject(err);
        pendingTasks.forEach((t) => t.reject(err));
        pendingTasks.length = 0;
      },
    );
  });
}

/**
 * 台形補正を適用する。
 * ImageData から Mat を生成し、透视変換を行い、結果を ImageData として返す。
 */
function applyPerspectiveCorrection(imageData, params) {
  const { data, width: srcWidth, height: srcHeight } = imageData;

  // ImageData → Mat
  const srcMat = cv.matFromImageData({
    data: new Uint8ClampedArray(data),
    width: srcWidth,
    height: srcHeight,
  });

  let dstMat = null;
  let srcPts = null;
  let dstPts = null;
  let M = null;

  try {
    dstMat = new cv.Mat();

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
    cv.warpPerspective(srcMat, dstMat, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));

    // Mat → ImageData（CV_8UC4 は RGBA）
    const resultData = new Uint8ClampedArray(dstMat.data);
    return {
      data: resultData,
      width: maxWidth,
      height: maxHeight,
    };
  } finally {
    M?.delete();
    dstPts?.delete();
    srcPts?.delete();
    dstMat?.delete();
    srcMat.delete();
  }
}

// ---------------------------------------------------------------------------
// メッセージハンドラ
// ---------------------------------------------------------------------------

self.onmessage = async (e) => {
  const { type, id } = e.data;

  try {
    switch (type) {
      case "init": {
        await initOpenCV();
        break;
      }
      case "perspective": {
        await initOpenCV();
        const result = applyPerspectiveCorrection(e.data.imageData, e.data.params);
        self.postMessage({ type: "result", id, imageData: result }, [result.data.buffer]);
        break;
      }
      default:
        self.postMessage({ type: "error", id, error: `未知のメッセージタイプ: ${type}` });
    }
  } catch (err) {
    self.postMessage({ type: "error", id, error: err.message || "OpenCV.js 処理エラー" });
  }
};
