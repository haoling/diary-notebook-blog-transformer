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
 *     { type: 'detectDocument', id: string, imageData: { data: Uint8ClampedArray, width: number, height: number } }
 *   Worker → Main:
 *     { type: 'ready' }
 *     { type: 'loading' }
 *     { type: 'result', id: string, imageData: { data: Uint8ClampedArray, width: number, height: number } }
 *     { type: 'result', id: string, perspectiveParams: PerspectiveParams | null }
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
// ドキュメント輪郭検出（Document Corner Detection）
// ---------------------------------------------------------------------------

/**
 * 4隅の座標を左上・右上・右下・左下の順に整列する。
 * @param {Array<{x: number, y: number}>} pts - 4点の配列
 * @returns {{topLeft, topRight, bottomRight, bottomLeft}}
 */
function sortQuadPoints(pts) {
  // (x+y) の昇順 → 最小が左上、最大が右下
  const bySum = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  // (y-x) の昇順 → 最小が右上（xが大きくyが小さい）、最大が左下
  const byDiff = [...pts].sort((a, b) => (a.y - a.x) - (b.y - b.x));
  return {
    topLeft: bySum[0],
    bottomRight: bySum[3],
    topRight: byDiff[0],
    bottomLeft: byDiff[3],
  };
}

/**
 * OpenCV.js を使用してドキュメント（紙・手帳）の4隅座標を自動検出する。
 * Canny エッジ検出 → 凸包 → 複数の epsilon で多角形近似を試みる。
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} imageData
 * @returns {{ topLeft, topRight, bottomRight, bottomLeft } | null}
 */
function detectDocumentCorners(imageData) {
  const { data, width: srcWidth, height: srcHeight } = imageData;

  const srcMat = cv.matFromImageData({
    data: new Uint8ClampedArray(data),
    width: srcWidth,
    height: srcHeight,
  });

  let grayMat = null;
  let blurMat = null;
  let edgeMat = null;
  let dilatedMat = null;
  let contours = null;
  let hierarchy = null;
  let kernel = null;

  try {
    // 1. グレースケール変換
    grayMat = new cv.Mat();
    cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);

    // 2. ガウシアンブラーでノイズ除去
    blurMat = new cv.Mat();
    cv.GaussianBlur(grayMat, blurMat, new cv.Size(5, 5), 0);

    // 3. Canny エッジ検出（閾値を低めにして検出感度を上げる）
    edgeMat = new cv.Mat();
    cv.Canny(blurMat, edgeMat, 50, 150);

    // 4. 膨張処理でエッジの隙間を埋める
    dilatedMat = new cv.Mat();
    kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edgeMat, dilatedMat, kernel);

    // 5. 外部輪郭の抽出
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(dilatedMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const imageArea = srcWidth * srcHeight;
    const minArea = imageArea * 0.05; // 画像面積の5%以上（検出感度を上げる）

    let bestParams = null;
    let bestArea = 0;

    // 複数の epsilon を試して4点の多角形近似を探す（小さい値から試みる）
    const epsilonFactors = [0.02, 0.04, 0.06, 0.08, 0.10];

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);

      if (area < minArea) continue;

      // 凸包を使ってきれいな輪郭を取得（凹み・ノイズを排除）
      const hull = new cv.Mat();
      cv.convexHull(contour, hull, false, true);
      const hullPeri = cv.arcLength(hull, true);

      for (const factor of epsilonFactors) {
        const approx = new cv.Mat();
        cv.approxPolyDP(hull, approx, factor * hullPeri, true);

        if (approx.rows === 4 && area > bestArea) {
          // 4隅の座標を取得（画像範囲内にクランプ）
          const pts = [];
          for (let j = 0; j < 4; j++) {
            pts.push({
              x: Math.max(0, Math.min(srcWidth - 1, approx.data32S[j * 2])),
              y: Math.max(0, Math.min(srcHeight - 1, approx.data32S[j * 2 + 1])),
            });
          }
          bestArea = area;
          bestParams = sortQuadPoints(pts);
          approx.delete();
          break; // このコンターで4点が見つかったので次のepsilonは不要
        }
        approx.delete();
      }
      hull.delete();
    }

    return bestParams;

  } finally {
    kernel?.delete();
    dilatedMat?.delete();
    edgeMat?.delete();
    blurMat?.delete();
    grayMat?.delete();
    contours?.delete();
    hierarchy?.delete();
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
      case "detectDocument": {
        await initOpenCV();
        const perspectiveParams = detectDocumentCorners(e.data.imageData);
        self.postMessage({ type: "result", id, perspectiveParams });
        break;
      }
      default:
        self.postMessage({ type: "error", id, error: `未知のメッセージタイプ: ${type}` });
    }
  } catch (err) {
    self.postMessage({ type: "error", id, error: err.message || "OpenCV.js 処理エラー" });
  }
};
