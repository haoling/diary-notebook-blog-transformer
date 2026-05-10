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
 * 輪郭の MatVector から最大面積の4点凸多角形近似を返す共通ロジック。
 * epsilon を複数試して最初に4点近似が得られたものを採用する。
 * @param {cv.MatVector} contours
 * @param {number} srcWidth
 * @param {number} srcHeight
 * @returns {{topLeft, topRight, bottomRight, bottomLeft} | null}
 */
function findLargestQuad(contours, srcWidth, srcHeight) {
  const imageArea = srcWidth * srcHeight;
  // 5%: 画像面積の5%未満の輪郭はノイズとして除外。10%では小さな手帳が漏れるため低めに設定。
  const minArea = imageArea * 0.05;
  const epsilonFactors = [0.02, 0.04, 0.06, 0.08, 0.10, 0.15];

  let bestParams = null;
  let bestArea = 0;

  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const area = cv.contourArea(contour);
    if (area < minArea) {
      contour.delete();
      continue;
    }

    const hull = new cv.Mat();
    cv.convexHull(contour, hull, false, true);
    const hullPeri = cv.arcLength(hull, true);

    for (const factor of epsilonFactors) {
      const approx = new cv.Mat();
      cv.approxPolyDP(hull, approx, factor * hullPeri, true);

      if (approx.rows === 4 && area > bestArea) {
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
        break;
      }
      approx.delete();
    }
    hull.delete();
    contour.delete();
  }

  return bestParams;
}

/**
 * OpenCV.js を使用してドキュメント（紙・手帳）の4隅座標を自動検出する。
 *
 * パス1: 標準ブラー(5x5) → Canny エッジ検出 → 膨張 → 輪郭抽出 → 最大四角形近似
 * パス2: 大きなブラー(min(W,H)/15px) → Canny(低閾値) → 大膨張(5x5) → 輪郭抽出 → 最大四角形近似
 *
 * パス1で検出できない場合（複雑な背景・テキストが多い画像）に
 * パス2を試みる。パス2は強いガウシアンブラーでキーボードキーや
 * 文字などの細かい特徴量を消し、手帳のページ・表紙の大きな
 * 境界線のみを検出するため、背景が複雑な場合に効果的。
 *
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} imageData
 * @returns {{ topLeft, topRight, bottomRight, bottomLeft } | null}
 */
function detectDocumentCorners(imageData) {
  const { data, width: srcWidth, height: srcHeight } = imageData;

  const srcMat = cv.matFromImageData({
    data,
    width: srcWidth,
    height: srcHeight,
  });

  let grayMat = null;
  let blurMat = null;
  // パス1 用
  let edgeMat = null;
  let dilatedMat = null;
  let edgeContours = null;
  let edgeHierarchy = null;
  let edgeKernel = null;
  // パス2 用
  let bigBlurMat = null;
  let bigEdgeMat = null;
  let bigDilatedMat = null;
  let bigContours = null;
  let bigHierarchy = null;
  let bigKernel = null;

  try {
    // 共通前処理: グレースケール + ガウシアンブラー
    grayMat = new cv.Mat();
    cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);

    blurMat = new cv.Mat();
    cv.GaussianBlur(grayMat, blurMat, new cv.Size(5, 5), 0);

    // === パス1: Canny エッジ検出 ===
    edgeMat = new cv.Mat();
    cv.Canny(blurMat, edgeMat, 50, 150);

    dilatedMat = new cv.Mat();
    edgeKernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edgeMat, dilatedMat, edgeKernel);

    edgeContours = new cv.MatVector();
    edgeHierarchy = new cv.Mat();
    cv.findContours(dilatedMat, edgeContours, edgeHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let result = findLargestQuad(edgeContours, srcWidth, srcHeight);

    // === パス2: 大きなブラー + Canny（文字・小物を除去して大きなエッジのみ検出） ===
    // 強いガウシアンブラーでキーボードキーや文字など小さな特徴量を消し、
    // 手帳のページ・表紙の大きな境界線だけを Canny で検出する。
    if (!result) {
      let kBlur = Math.round(Math.min(srcWidth, srcHeight) / 15);
      kBlur = Math.min(75, Math.max(15, kBlur));
      if (kBlur % 2 === 0) kBlur += 1;

      bigBlurMat = new cv.Mat();
      cv.GaussianBlur(grayMat, bigBlurMat, new cv.Size(kBlur, kBlur), 0);

      bigEdgeMat = new cv.Mat();
      cv.Canny(bigBlurMat, bigEdgeMat, 20, 60);

      bigDilatedMat = new cv.Mat();
      bigKernel = cv.Mat.ones(5, 5, cv.CV_8U);
      cv.dilate(bigEdgeMat, bigDilatedMat, bigKernel);

      bigContours = new cv.MatVector();
      bigHierarchy = new cv.Mat();
      cv.findContours(bigDilatedMat, bigContours, bigHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      result = findLargestQuad(bigContours, srcWidth, srcHeight);
    }

    return result;

  } finally {
    bigKernel?.delete();
    bigHierarchy?.delete();
    bigContours?.delete();
    bigDilatedMat?.delete();
    bigEdgeMat?.delete();
    bigBlurMat?.delete();
    edgeKernel?.delete();
    dilatedMat?.delete();
    edgeHierarchy?.delete();
    edgeContours?.delete();
    edgeMat?.delete();
    blurMat?.delete();
    grayMat?.delete();
    srcMat.delete();
  }
}

// ---------------------------------------------------------------------------
// 段落境界検出（Paragraph Split Detection）
// ---------------------------------------------------------------------------

/**
 * OpenCV.js を使用してテキスト領域間の余白から段落境界を検出する。
 *
 * 手帳の罫線は段落区切りとして誤検出されるため、HoughLinesP は使用しない。
 * 代わりに形態素演算（モルフォロジー）でテキスト領域を結合し、
 * 垂直投射密度の大きな谷（テキストが存在しない領域）を段落境界とする。
 *
 * アルゴリズム:
 * 1. グレースケール → 大きめのガウシアンブラー（罫線ノイズ除去）
 * 2. 二値化（Otsu）
 * 3. モルフォロジークロージング（水平方向に長いカーネルで文字を結合）
 *    → テキスト行が横方向に繋がったブロックになる
 * 4. 垂直投射（reduce SUM）で行ごとの白/黒面積比を計算
 * 5. 大きな移動平均で平滑化（罫線間の微小隙間を消す）
 * 6. 閾値以下の連続領域 → 余白候補
 * 7. 余白の最小高さフィルタ（画像高さの3%以上のみ採用）
 *
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} imageData
 * @param {{ minGapRatio?: number, densityThreshold?: number }} options
 * @returns {{ splitYs: number[] }}
 */
function detectParagraphBoundaries(imageData, options = {}) {
  const {
    minGapRatio = 0.03,
    densityThreshold = 0.05,
  } = options;

  const { data, width: srcWidth, height: srcHeight } = imageData;
  const srcMat = cv.matFromImageData({ data, width: srcWidth, height: srcHeight });

  let grayMat = null;
  let blurMat = null;
  let binMat = null;
  let closeKernel = null;
  let closeMat = null;
  let projection = null;

  try {
    // 1. グレースケール
    grayMat = new cv.Mat();
    cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);

    // 2. 大きめのガウシアンブラー（罫線の細い線をぼかして消す）
    blurMat = new cv.Mat();
    const blurK = Math.min(15, Math.max(5, Math.round(Math.min(srcWidth, srcHeight) / 50)));
    const blurKOdd = blurK % 2 === 0 ? blurK + 1 : blurK;
    cv.GaussianBlur(grayMat, blurMat, new cv.Size(blurKOdd, blurKOdd), 0);

    // 3. 二値化（Otsu で自動閾値）
    binMat = new cv.Mat();
    cv.threshold(blurMat, binMat, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

    // 4. モルフォロジークロージング（水平方向に文字を結合してテキストブロックにする）
    closeMat = new cv.Mat();
    const closeW = Math.max(15, Math.round(srcWidth * 0.02));
    const closeH = Math.max(3, Math.round(srcHeight * 0.005));
    closeKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(closeW, closeH));
    cv.morphologyEx(binMat, closeMat, cv.MORPH_CLOSE, closeKernel);

    // 5. 垂直投射（各行の黒ピクセル数を合計）
    projection = new cv.Mat();
    cv.reduce(closeMat, projection, 1, cv.REDUCE_SUM, cv.CV_32S);
    const projData = projection.data32S;

    // 6. 大きな移動平均で平滑化
    //    ウィンドウサイズを画像高さの5%にして罫線間の隙間を完全に消す
    const WINDOW_SIZE = Math.max(15, Math.round(srcHeight * 0.05));
    const smoothed = new Float32Array(srcHeight);
    
    // 累積和を使って O(height) で計算
    const halfW = Math.floor(WINDOW_SIZE / 2);
    const prefixSums = new Float64Array(srcHeight + 1);
    for (let y = 0; y < srcHeight; y++) {
      prefixSums[y + 1] = prefixSums[y] + projData[y];
    }
    for (let y = 0; y < srcHeight; y++) {
      const start = Math.max(0, y - halfW);
      const end = Math.min(srcHeight - 1, y + halfW);
      const sum = prefixSums[end + 1] - prefixSums[start];
      const count = end - start + 1;
      smoothed[y] = sum / count;
    }

    // 7. 最大投射値で正規化
    let maxProj = 0;
    for (let y = 0; y < srcHeight; y++) {
      if (smoothed[y] > maxProj) maxProj = smoothed[y];
    }
    const normalized = maxProj > 0
      ? smoothed.map(function(v) { return v / maxProj; })
      : new Float32Array(srcHeight);

    // 8. 連続する余白（低密度）領域の中心を検出
    //    最小ギャップ高さ = 画像高さの minGapRatio（デフォルト3%）以上
    const minGapHeight = Math.max(5, Math.round(srcHeight * minGapRatio));
    const whitespaceRegions = [];
    var wsStart = -1;
    for (let y = 0; y < srcHeight; y++) {
      if (normalized[y] < densityThreshold) {
        if (wsStart < 0) wsStart = y;
      } else {
        if (wsStart >= 0) {
          const gapHeight = y - wsStart;
          if (gapHeight >= minGapHeight) {
            whitespaceRegions.push({
              start: wsStart,
              end: y - 1,
              center: Math.round((wsStart + y - 1) / 2),
              height: gapHeight,
            });
          }
          wsStart = -1;
        }
      }
    }
    // 画像末尾の余白
    if (wsStart >= 0) {
      const gapHeight = srcHeight - wsStart;
      if (gapHeight >= minGapHeight) {
        whitespaceRegions.push({
          start: wsStart,
          end: srcHeight - 1,
          center: Math.round((wsStart + srcHeight - 1) / 2),
          height: gapHeight,
        });
      }
    }

    // 9. 余白のY座標を境界として採用（先頭/末尾に接する余白は除外）
    const splitYs = whitespaceRegions
      .filter(function(r) { return r.start > 0 && r.end < srcHeight - 1; })
      .map(function(r) { return r.center; })
      .filter(function(y) { return y > 0 && y < srcHeight - 1; })
      .sort(function(a, b) { return a - b; });

    return { splitYs: splitYs };

  } finally {
    projection?.delete();
    closeMat?.delete();
    closeKernel?.delete();
    binMat?.delete();
    blurMat?.delete();
    grayMat?.delete();
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
      case "detectParagraphs": {
        await initOpenCV();
        const options = e.data.options || {};
        const result = detectParagraphBoundaries(e.data.imageData, options);
        self.postMessage({ type: "result", id, paragraphBoundaries: result });
        break;
      }
      default:
        self.postMessage({ type: "error", id, error: `未知のメッセージタイプ: ${type}` });
    }
  } catch (err) {
    self.postMessage({ type: "error", id, error: err.message || "OpenCV.js 処理エラー" });
  }
};
