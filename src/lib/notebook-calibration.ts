/**
 * 手帳キャリブレーションモジュール。
 *
 * 罫線グリッド検出・空白行除去・地色記憶による自動色補正など、
 * 手帳プロファイル・キャリブレーションを利用した新方式の各種アルゴリズムを提供する。
 */

import type { ParagraphObject, SplitResult } from "@/types/scan";
import type { NotebookProfile, RgbColor } from "@/types/settings";

/**
 * ParagraphObject[] から SplitResult を生成する。
 */
export function createSplitResult(paragraphs: ParagraphObject[]): SplitResult {
  return {
    splitAt: new Date().toISOString(),
    paragraphs,
  };
}

/**
 * 手帳プロファイルから、画像上で罫線が何 px 間隔で並ぶか（期待ピッチ）を算出する。
 */
export function computeExpectedPitchPx(
  imageHeightPx: number,
  profile: NotebookProfile,
): number {
  return (imageHeightPx * profile.lineHeightMm) / profile.pageHeightMm;
}

/**
 * 罫線の y 座標（px）の配列を、画像高さに対する比率（0..1）の配列に変換する。
 * 結果は昇順にソートされる。
 */
export function pixelYsToLineYRatios(
  lineYs: number[],
  imageHeightPx: number,
): number[] {
  return [...lineYs].sort((a, b) => a - b).map((y) => y / imageHeightPx);
}

/**
 * 罫線の y 座標の比率（0..1）の配列を、画像高さに応じた px 座標の配列に変換する。
 */
export function lineYRatiosToPixelYs(
  lineYRatios: number[],
  imageHeightPx: number,
): number[] {
  return lineYRatios.map((ratio) => ratio * imageHeightPx);
}

// ---------------------------------------------------------------------------
// 罫線検出（detectRuledLines）
// ---------------------------------------------------------------------------

/** detectRuledLines が受け付ける画像ソース。 */
export type RuledLineSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/** detectRuledLines のオプション。 */
export type DetectRuledLinesOptions = {
  /** 期待される罫線ピッチ（px）。computeExpectedPitchPx で算出する */
  expectedPitchPx: number;
  /** 期待ピッチからの許容ずれ比率（既定 0.15 = ±15%） */
  toleranceRatio?: number;
};

/** 左右の除外マージン比率（綴じ穴・ページ端の影を避ける） */
const HORIZONTAL_MARGIN_RATIO = 0.05;
/** 行プロファイル作成時のサンプリング幅の上限（px） */
const PROFILE_SAMPLE_WIDTH = 480;
/** ベースライン移動平均の窓幅（期待ピッチの倍数） */
const BASELINE_WINDOW_PITCHES = 3;
/** ピーク判定閾値の MAD 倍率 */
const PEAK_THRESHOLD_MAD = 3;
/** ピーク判定閾値の下限（暗さ 0..255 スケール） */
const PEAK_THRESHOLD_FLOOR = 0.5;
/** 上下端の候補を残す最小強度（採用候補の強度中央値に対する比率） */
const EDGE_MIN_STRENGTH_RATIO = 0.35;
/** 上下端の候補を孤立とみなす、隣の候補とのグリッド間隔（本数） */
const EDGE_MAX_GAP_LINES = 2;

/**
 * 画像から水平罫線の y 座標（px, 昇順）を検出する。
 *
 * OpenCV Worker を使わない Canvas/JS 実装。
 * 行ごとの暗さプロファイルから罫線の鋭いピークを抽出し、
 * 期待ピッチに整合するグリッドを軸に検出漏れの補間・ノイズ除去を行う。
 */
export async function detectRuledLines(
  source: RuledLineSource,
  options: DetectRuledLinesOptions,
): Promise<number[]> {
  const profile = buildRowDarknessProfile(source);
  return detectRuledLinesFromProfile(profile, options);
}

/** 画像ソースの幅・高さを取得する。 */
function getSourceSize(source: RuledLineSource): { width: number; height: number } {
  if ("naturalWidth" in source) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

/**
 * 1. グレースケール行ごとの暗さ（255 - 輝度）の平均プロファイルを作成する。
 * 左右 5% を除外し、横方向は縮小描画でサブサンプリングする（縦方向は等倍）。
 */
function buildRowDarknessProfile(source: RuledLineSource): Float64Array {
  const { width, height } = getSourceSize(source);
  if (width <= 0 || height <= 0) return new Float64Array(0);

  const cropX = Math.floor(width * HORIZONTAL_MARGIN_RATIO);
  const cropW = Math.max(1, width - cropX * 2);
  const sampleW = Math.min(cropW, PROFILE_SAMPLE_WIDTH);

  const canvas = document.createElement("canvas");
  canvas.width = sampleW;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D コンテキストを取得できませんでした");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, cropX, 0, cropW, height, 0, 0, sampleW, height);

  const { data } = ctx.getImageData(0, 0, sampleW, height);
  const profile = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    const rowOffset = y * sampleW * 4;
    for (let x = 0; x < sampleW; x++) {
      const i = rowOffset + x * 4;
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    profile[y] = 255 - sum / sampleW;
  }
  return profile;
}

/** 中央値を返す（入力は変更しない）。 */
function median(values: ArrayLike<number>): number {
  if (values.length === 0) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** 中心化移動平均（端は窓を縮めて平均）。 */
function movingAverage(values: Float64Array, window: number): Float64Array {
  const n = values.length;
  const half = Math.max(1, Math.floor(window / 2));
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i];
  const result = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    result[i] = (prefix[hi] - prefix[lo]) / (hi - lo);
  }
  return result;
}

type LineCandidate = {
  /** 重心 y（px） */
  y: number;
  /** ピーク強度（ベースライン差分の総和） */
  strength: number;
};

/**
 * 行ごとの暗さプロファイルから罫線の y 座標（px, 昇順）を検出する。
 * detectRuledLines の画像非依存部分。
 */
export function detectRuledLinesFromProfile(
  profile: ArrayLike<number>,
  options: DetectRuledLinesOptions,
): number[] {
  const height = profile.length;
  const pitch = options.expectedPitchPx;
  const tolerance = options.toleranceRatio ?? 0.15;
  // 探索範囲に負・無限のピッチが入らないよう、許容比率は 0 < toleranceRatio < 1 に限定する
  if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance >= 1) {
    throw new RangeError(`toleranceRatio は 0 より大きく 1 未満の有限値で指定してください: ${tolerance}`);
  }
  if (!(pitch > 1) || height < pitch * 2) return [];

  const darkness = Float64Array.from(profile);

  // 2. 期待ピッチの数倍幅の移動平均をベースラインとして差し引く
  const baseline = movingAverage(darkness, Math.round(pitch * BASELINE_WINDOW_PITCHES));
  const residual = new Float64Array(height);
  for (let y = 0; y < height; y++) residual[y] = darkness[y] - baseline[y];

  // 罫線は細く鋭いピーク、手書き文字の行は幅の広い山になるため、
  // 少し離れた上下の値との差（リッジ応答）で細いピークのみを強調する
  const ridgeOffset = Math.max(2, Math.round(pitch * 0.1));
  const ridge = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    const above = residual[Math.max(0, y - ridgeOffset)];
    const below = residual[Math.min(height - 1, y + ridgeOffset)];
    ridge[y] = residual[y] - (above + below) / 2;
  }

  // 3. 統計的閾値でピーク候補をクラスタ化し、重心 Y を算出
  // 画像の上下端ぎりぎりのピーク（ページ端・影）はグリッド推定前に除外する
  const edgeMargin = Math.max(pitch * 0.3, height * 0.005);
  const candidates = findPeakCandidates(ridge, pitch).filter(
    (c) => c.y >= edgeMargin && c.y <= height - 1 - edgeMargin,
  );
  if (candidates.length === 0) return [];

  // 4, 5. 期待ピッチに整合するグリッドを当てはめ、補間・ノイズ除去・上下端の誤検出除去
  return fitGridAndInterpolate(candidates, pitch, tolerance);
}

/**
 * リッジ応答から、統計的閾値（中央値 + k × MAD）を超えるピークを抽出する。
 * 近接するピークは非極大抑制でまとめ、ピーク周辺の半値幅内の重心を y とする。
 */
function findPeakCandidates(residual: Float64Array, pitch: number): LineCandidate[] {
  const n = residual.length;
  const med = median(residual);
  const deviations = new Float64Array(n);
  for (let i = 0; i < n; i++) deviations[i] = Math.abs(residual[i] - med);
  const mad = median(deviations) * 1.4826;
  const threshold = med + Math.max(PEAK_THRESHOLD_MAD * mad, PEAK_THRESHOLD_FLOOR);

  // 閾値超えの局所極大をピーク候補とする
  const peaks: number[] = [];
  for (let y = 1; y < n - 1; y++) {
    const v = residual[y];
    if (v > threshold && v >= residual[y - 1] && v > residual[y + 1]) peaks.push(y);
  }

  // 非極大抑制: 強いピークから順に採用し、近傍 (pitch × 0.3) のピークを除外
  const suppressRadius = Math.max(1, pitch * 0.3);
  const byStrength = [...peaks].sort((a, b) => residual[b] - residual[a]);
  const taken: number[] = [];
  for (const y of byStrength) {
    if (taken.every((t) => Math.abs(t - y) > suppressRadius)) taken.push(y);
  }

  // 重心算出: ピーク値の半分 (かつ閾値) 以上が続く範囲の重み付き平均
  const maxHalfWidth = Math.max(1, Math.floor(pitch * 0.25));
  return taken
    .map((peakY) => {
      const floor = Math.max(threshold, residual[peakY] * 0.5);
      let lo = peakY;
      while (lo > 0 && peakY - lo < maxHalfWidth && residual[lo - 1] >= floor) lo--;
      let hi = peakY;
      while (hi < n - 1 && hi - peakY < maxHalfWidth && residual[hi + 1] >= floor) hi++;
      let weightSum = 0;
      let ySum = 0;
      for (let y = lo; y <= hi; y++) {
        const w = residual[y] - med;
        weightSum += w;
        ySum += w * y;
      }
      return { y: weightSum > 0 ? ySum / weightSum : peakY, strength: weightSum };
    })
    .sort((a, b) => a.y - b.y);
}

/**
 * ピーク候補に等間隔グリッドを当てはめ、グリッドに整合する候補のみ残す（ノイズ除外）。
 * 隣接する採用候補の間でグリッド番号が飛んでいる箇所は線形補間で埋める（かすれ対策）。
 */
function fitGridAndInterpolate(
  candidates: LineCandidate[],
  expectedPitch: number,
  tolerance: number,
): number[] {
  if (candidates.length === 1) return [candidates[0].y];

  // 極端に強い候補（ページ端・影など）が支配しないよう重みを頭打ちにする
  const medianStrength = median(candidates.map((c) => c.strength));
  const weights = candidates.map((c) => Math.min(c.strength, medianStrength * 3));

  // ピッチ探索: 許容範囲内で位相の揃い具合（周期ベクトル和の大きさ）が最大のピッチを選ぶ
  const minPitch = expectedPitch * (1 - tolerance);
  const maxPitch = expectedPitch * (1 + tolerance);
  const step = Math.max(0.02, expectedPitch * 0.001);
  let bestPitch = expectedPitch;
  let bestOffset = 0;
  let bestScore = -1;
  for (let p = minPitch; p <= maxPitch; p += step) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < candidates.length; i++) {
      const theta = (2 * Math.PI * candidates[i].y) / p;
      re += weights[i] * Math.cos(theta);
      im += weights[i] * Math.sin(theta);
    }
    const score = Math.hypot(re, im);
    if (score > bestScore) {
      bestScore = score;
      bestPitch = p;
      const phase = Math.atan2(im, re);
      bestOffset = ((phase / (2 * Math.PI)) * p + p) % p;
    }
  }

  // グリッド y = offset + k × pitch に対し、インライアで最小二乗の再推定を繰り返す
  let offset = bestOffset;
  let pitch = bestPitch;
  let inliers = new Map<number, { y: number; residual: number; strength: number }>();
  for (const inlierRatio of [0.3, 0.25, 0.2]) {
    const nextInliers = new Map<number, { y: number; residual: number; strength: number }>();
    for (const c of candidates) {
      const k = Math.round((c.y - offset) / pitch);
      const r = Math.abs(c.y - (offset + k * pitch));
      if (r > pitch * inlierRatio) continue;
      const existing = nextInliers.get(k);
      if (!existing || r < existing.residual) {
        nextInliers.set(k, { y: c.y, residual: r, strength: c.strength });
      }
    }
    // 閾値を狭めて 2 点未満になった場合は、直前の有効なインライアを保持して打ち切る
    if (nextInliers.size < 2) {
      if (inliers.size === 0) inliers = nextInliers;
      break;
    }
    inliers = nextInliers;

    let sw = 0, sk = 0, sy = 0, skk = 0, sky = 0;
    for (const [k, { y }] of inliers) {
      sw += 1;
      sk += k;
      sy += y;
      skk += k * k;
      sky += k * y;
    }
    const denom = sw * skk - sk * sk;
    if (denom === 0) break;
    const fittedPitch = (sw * sky - sk * sy) / denom;
    // 再推定ピッチが許容範囲を外れた場合は採用しない
    if (fittedPitch < minPitch || fittedPitch > maxPitch) break;
    pitch = fittedPitch;
    offset = (sy - pitch * sk) / sw;
  }

  const accepted = [...inliers.entries()].sort((a, b) => a[0] - b[0]);
  if (accepted.length === 0) return [];

  // 上下端の誤検出除去: 端にあり、他の罫線より極端に弱い、
  // または隣の罫線から大きく離れて孤立している候補（余白のノイズ・ページ端等）を削る
  const acceptedMedianStrength = median(accepted.map(([, v]) => v.strength));
  const minEdgeStrength = acceptedMedianStrength * EDGE_MIN_STRENGTH_RATIO;
  while (
    accepted.length > 2 &&
    (accepted[0][1].strength < minEdgeStrength ||
      accepted[1][0] - accepted[0][0] > EDGE_MAX_GAP_LINES)
  ) {
    accepted.shift();
  }
  while (
    accepted.length > 2 &&
    (accepted[accepted.length - 1][1].strength < minEdgeStrength ||
      accepted[accepted.length - 1][0] - accepted[accepted.length - 2][0] > EDGE_MAX_GAP_LINES)
  ) {
    accepted.pop();
  }

  // 検出漏れの補間: 隣接インライア間のグリッド番号の欠番を線形補間で埋める
  const lines: number[] = [];
  for (let i = 0; i < accepted.length; i++) {
    const [k, { y }] = accepted[i];
    lines.push(y);
    const next = accepted[i + 1];
    if (!next) break;
    const [nextK, { y: nextY }] = next;
    const gap = nextK - k;
    if (gap <= 1) continue;
    // 局所ピッチが許容範囲内のときのみ補間する
    const localPitch = (nextY - y) / gap;
    if (localPitch < minPitch || localPitch > maxPitch) continue;
    for (let j = 1; j < gap; j++) lines.push(y + localPitch * j);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 地色サンプリング（sampleBackgroundColor）
// ---------------------------------------------------------------------------

/** 地色として採用するパーセンタイル（罫線・文字のインク画素を除外できる程度の中〜高位） */
const BACKGROUND_PERCENTILE = 0.8;
/** 地色サンプリング時に読み取る最大画素数（大きな画像は縮小してから読み取る） */
const BACKGROUND_MAX_SAMPLES = 1_000_000;

/**
 * 画像から「紙の地色」を代表する RGB 値を抽出する。
 *
 * チャンネルごとのヒストグラムを作成し、80 パーセンタイルの値を採用する。
 * 罫線・文字などのインク画素は紙より暗いため低位側に集まり、結果への影響が小さい。
 * 画素数が上限を超える画像は、読み取り時のメモリ使用量を抑えるため縮小キャンバスに描画してから集計する。
 */
export function sampleBackgroundColor(canvas: HTMLCanvasElement): RgbColor {
  return sampleBackgroundColorFromPixels(readSampledPixels(canvas));
}

/**
 * 画像ソースの RGBA 画素配列を読み取る。
 * 画素数が上限を超える画像は、スムージングを無効にした縮小キャンバスに描画して間引く。
 */
function readSampledPixels(source: RuledLineSource): Uint8ClampedArray {
  const { width, height } = getSourceSize(source);
  if (width <= 0 || height <= 0) {
    throw new RangeError("地色をサンプリングする画像のサイズが 0 です");
  }

  const scale = Math.sqrt(BACKGROUND_MAX_SAMPLES / (width * height));
  let target: HTMLCanvasElement;
  if (source instanceof HTMLCanvasElement && scale >= 1) {
    target = source;
  } else {
    // 画素値を平均化せず 2 次元的に間引くため、スムージングを無効にして描画する
    target = document.createElement("canvas");
    target.width = Math.max(1, Math.floor(width * Math.min(1, scale)));
    target.height = Math.max(1, Math.floor(height * Math.min(1, scale)));
    const drawCtx = target.getContext("2d");
    if (!drawCtx) throw new Error("Canvas 2D コンテキストを取得できませんでした");
    drawCtx.imageSmoothingEnabled = false;
    drawCtx.drawImage(source, 0, 0, target.width, target.height);
  }

  const ctx = target.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D コンテキストを取得できませんでした");
  return ctx.getImageData(0, 0, target.width, target.height).data;
}

/**
 * RGBA 画素配列から紙の地色を抽出する（全画素を集計する）。
 * sampleBackgroundColor の Canvas 非依存部分。
 */
export function sampleBackgroundColorFromPixels(
  data: ArrayLike<number>,
  percentile: number = BACKGROUND_PERCENTILE,
): RgbColor {
  if (!Number.isFinite(percentile) || percentile < 0 || percentile > 1) {
    throw new RangeError(`percentile は 0 以上 1 以下で指定してください: ${percentile}`);
  }
  const pixelCount = Math.floor(data.length / 4);

  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);
  let total = 0;
  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    // 完全に透明な画素（画像外の余白など）は地色の候補から除外する
    if (data[i + 3] === 0) continue;
    histR[data[i]]++;
    histG[data[i + 1]]++;
    histB[data[i + 2]]++;
    total++;
  }
  if (total === 0) {
    throw new RangeError("地色をサンプリングできる不透明な画素がありません");
  }

  return {
    r: histogramPercentile(histR, total, percentile),
    g: histogramPercentile(histG, total, percentile),
    b: histogramPercentile(histB, total, percentile),
  };
}

/** ヒストグラムから指定パーセンタイル（0..1）の値を返す。 */
function histogramPercentile(hist: Uint32Array, total: number, percentile: number): number {
  // 下から数えて rank 番目（1 始まり）の値を返す
  const rank = Math.max(1, Math.ceil(total * percentile));
  let cumulative = 0;
  for (let v = 0; v < hist.length; v++) {
    cumulative += hist[v];
    if (cumulative >= rank) return v;
  }
  return hist.length - 1;
}

// ---------------------------------------------------------------------------
// 地色合わせの色補正値算出（analyzeColorMatchAdjustments）
// ---------------------------------------------------------------------------

/** 地色合わせの補正値（applyBrightnessContrast / CSS filter と同じ -100..100 スケール、0 = 変更なし）。 */
export type ColorMatchAdjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
};

/** インクの暗部を代表する輝度パーセンタイル（インクの少ないページでも紙の画素を拾わない程度に低くする） */
const INK_PERCENTILE = 0.005;
/** 暗部と地色の輝度差がこれ未満なら、インクが写っていないとみなしてコントラストを増強しない */
const MIN_INK_RANGE = 16;
/** 補正後に確保したい暗部の輝度（地色との差がダイナミックレンジの目標になる） */
const TARGET_INK_LUMINANCE = 40;
/** これ未満の彩度（RGB 最大最小差）は無彩色のノイズとみなし、彩度補正を行わない */
const MIN_CHROMA = 4;
/** 補正倍率の上限（-100..100 スケールの 100 に相当） */
const MAX_FACTOR = 2;

/** ITU-R BT.601 輝度 */
function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** RGB の最大最小差（彩度の指標） */
function chroma({ r, g, b }: RgbColor): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** 0..255 にクリップする */
function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, value));
}

/** RGB の各チャンネルに関数を適用する */
function mapRgb({ r, g, b }: RgbColor, fn: (value: number) => number): RgbColor {
  return { r: fn(r), g: fn(g), b: fn(b) };
}

/** 倍率（1 = 変更なし）を -100..100 スケールの整数に変換する */
function factorToAdjustment(factor: number): number {
  const value = Math.round((factor - 1) * 100);
  // -0 を 0 に正規化する
  return Math.max(-100, Math.min(100, value)) || 0;
}

/**
 * 画像自身の地色を検出し、地色を referenceColor に近づけるための補正値を算出する。
 *
 * 補正は CSS filter の brightness → contrast → saturate の順で適用される前提で算出する。
 * - 明るさ: 地色の輝度が参照色の輝度になるよう倍率を決める
 * - コントラスト: インク暗部（輝度 0.5 パーセンタイル）から地色までのダイナミックレンジが
 *   目標に満たない場合のみ増強する（減弱はしない。インクが写っていない場合は増強しない）
 * - 彩度: saturate のクリップを含めて、補正後の地色が参照色に最も近づく（RGB 距離が最小になる）倍率を決める。
 *   地色と参照色の色相が異なる場合は彩度を上げると色ずれが強調されるため、自然に彩度を下げる方向になる
 */
export function analyzeColorMatchAdjustments(
  source: RuledLineSource,
  referenceColor: RgbColor,
): ColorMatchAdjustments {
  return computeColorMatchAdjustmentsFromPixels(readSampledPixels(source), referenceColor);
}

/**
 * RGBA 画素配列から地色合わせの補正値を算出する。
 * analyzeColorMatchAdjustments の Canvas 非依存部分。
 */
export function computeColorMatchAdjustmentsFromPixels(
  data: ArrayLike<number>,
  referenceColor: RgbColor,
): ColorMatchAdjustments {
  const background = sampleBackgroundColorFromPixels(data);
  const inkLuminance = luminancePercentile(data, INK_PERCENTILE);
  return computeColorMatchAdjustments(background, inkLuminance, referenceColor);
}

/**
 * 地色・インク暗部の輝度・参照色から補正値を算出する（画素非依存の計算部分）。
 *
 * CSS filter の brightness(m) は v → m·v、contrast(k) は v → (v − 128)·k + 128 と近似できるため、
 * 地色輝度 Lb は (m·Lb − 128)·k + 128、ダイナミックレンジ Lb − Ld は m·k 倍になる。
 */
export function computeColorMatchAdjustments(
  background: RgbColor,
  inkLuminance: number,
  referenceColor: RgbColor,
): ColorMatchAdjustments {
  const bgLum = Math.max(1, luminance(background.r, background.g, background.b));
  const refLum = luminance(referenceColor.r, referenceColor.g, referenceColor.b);
  const inkLum = Math.min(inkLuminance, bgLum);

  // 明るさのみで地色輝度を合わせた場合（明るさの上限を反映）のダイナミックレンジが目標に届くか判定する
  let contrastFactor = 1;
  const targetRange = refLum - Math.min(TARGET_INK_LUMINANCE, refLum);
  const currentRange = bgLum - inkLum;
  const brightnessOnlyFactor = Math.min(MAX_FACTOR, refLum / bgLum);
  if (currentRange >= MIN_INK_RANGE && brightnessOnlyFactor * currentRange < targetRange) {
    // 地色 → refLum、暗部 → 目標暗部 の 2 点を満たす m·k と k を解く
    const rangeRatio = targetRange / currentRange;
    contrastFactor = (rangeRatio * bgLum - refLum + 128) / 128;
  }
  contrastFactor = Math.max(1, Math.min(MAX_FACTOR, contrastFactor));

  // コントラスト倍率を確定させたうえで、各段のクリップを含めた地色輝度が refLum になる明るさ倍率を求める
  // （輝度は明るさ倍率に対して単調非減少なので二分探索で解く）
  let brightnessFactor: number;
  if (adjustedLuminance(background, MAX_FACTOR, contrastFactor) >= refLum) {
    let lo = 0;
    let hi = MAX_FACTOR;
    for (let i = 0; i < FACTOR_SEARCH_ITERATIONS; i++) {
      const mid = (lo + hi) / 2;
      if (adjustedLuminance(background, mid, contrastFactor) < refLum) lo = mid;
      else hi = mid;
    }
    brightnessFactor = (lo + hi) / 2;
  } else {
    // 明るさを上限にしても届かない場合は、コントラストで残りの輝度差を補う。
    // コントラストは中間輝度 128 を軸に伸ばすため暗いチャンネルは暗くなる。
    // クリップを含めた輝度が参照輝度に最も近くなる倍率を選ぶ（同程度なら小さい倍率を優先）
    brightnessFactor = MAX_FACTOR;
    let bestError = Infinity;
    for (let step = 0; step <= CONTRAST_SEARCH_STEPS; step++) {
      const k = 1 + ((MAX_FACTOR - 1) * step) / CONTRAST_SEARCH_STEPS;
      const error = Math.abs(adjustedLuminance(background, MAX_FACTOR, k) - refLum);
      if (error < bestError - 1e-6) {
        bestError = error;
        contrastFactor = k;
      }
    }
  }

  // 無彩色の地色は saturate で色を付けられない（インクの色だけが強調される）ため、
  // 補正前の地色の彩度で判定し、補正しない
  let saturationFactor = 1;
  if (chroma(background) >= MIN_CHROMA) {
    // CSS filter は段ごとに 0..255 へクリップされるため、各段のクリップを再現した補正後の地色で彩度を求める
    const adjusted = applyBrightnessContrastToColor(background, brightnessFactor, contrastFactor);
    if (chroma(adjusted) > 0) {
      saturationFactor = solveSaturationFactor(adjusted, referenceColor);
    }
  }

  return {
    brightness: factorToAdjustment(brightnessFactor),
    contrast: factorToAdjustment(contrastFactor),
    saturation: factorToAdjustment(saturationFactor),
  };
}

/** 倍率の二分探索の反復回数（0..MAX_FACTOR の範囲を 1e-4 程度まで絞り込む） */
const FACTOR_SEARCH_ITERATIONS = 16;
/** 明るさ上限到達時にコントラスト倍率を探索する分割数（1..MAX_FACTOR を 0.01 刻み） */
const CONTRAST_SEARCH_STEPS = 100;

/** brightness(m) → contrast(k) を段ごとの 0..255 クリップ込みで RGB 色に適用する。 */
function applyBrightnessContrastToColor(color: RgbColor, m: number, k: number): RgbColor {
  return mapRgb(color, (v) => clampChannel((clampChannel(v * m) - 128) * k + 128));
}

/** brightness(m) → contrast(k) 適用後（クリップ込み）の輝度 */
function adjustedLuminance(color: RgbColor, m: number, k: number): number {
  const { r, g, b } = applyBrightnessContrastToColor(color, m, k);
  return luminance(r, g, b);
}

/**
 * CSS filter の saturate(s) を、0..255 へのクリップを含めて RGB 色に適用する。
 * Filter Effects 仕様の saturate 行列（Rec.709 輝度を保ったまま色差を s 倍する）に従う。
 */
function applySaturate(color: RgbColor, s: number): RgbColor {
  const lum = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  return mapRgb(color, (v) => clampChannel(lum + (v - lum) * s));
}

/** 彩度倍率を探索する分割数（0..MAX_FACTOR を 0.01 刻み） */
const SATURATION_SEARCH_STEPS = 200;

/** RGB 色の二乗距離 */
function squaredDistance(a: RgbColor, b: RgbColor): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

/**
 * saturate 適用後（クリップ込み）の色が target に最も近くなる倍率を 0..MAX_FACTOR の範囲で求める。
 * 距離が同程度なら 1（変更なし）に近い倍率を優先する。
 */
function solveSaturationFactor(color: RgbColor, target: RgbColor): number {
  let best = 1;
  let bestDistance = squaredDistance(color, target);
  for (let step = 0; step <= SATURATION_SEARCH_STEPS; step++) {
    const s = (MAX_FACTOR * step) / SATURATION_SEARCH_STEPS;
    const distance = squaredDistance(applySaturate(color, s), target);
    if (
      distance < bestDistance - 1e-6 ||
      (Math.abs(distance - bestDistance) <= 1e-6 && Math.abs(s - 1) < Math.abs(best - 1))
    ) {
      best = s;
      bestDistance = distance;
    }
  }
  return best;
}

/** 不透明画素の輝度から指定パーセンタイル（0..1）の値を返す。 */
function luminancePercentile(data: ArrayLike<number>, percentile: number): number {
  const hist = new Uint32Array(256);
  let total = 0;
  const pixelCount = Math.floor(data.length / 4);
  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    if (data[i + 3] === 0) continue;
    hist[Math.round(luminance(data[i], data[i + 1], data[i + 2]))]++;
    total++;
  }
  if (total === 0) return 0;
  return histogramPercentile(hist, total, percentile);
}

// ---------------------------------------------------------------------------
// ページ矩形検出（detectPageRect）
// ---------------------------------------------------------------------------

/** ページ矩形（探索範囲内のローカル座標、px）。 */
export type PageRect = { x: number; y: number; width: number; height: number };

/** detectPageRect のオプション。 */
export type DetectPageRectOptions = {
  /** 「ページ色」と判定する参照色との RGB ユークリッド距離の上限（既定 40） */
  colorDistanceThreshold?: number;
  /** 行・列の「ページ色」画素の割合がこの値以上なら、ページ内の行・列とみなす（既定 0.5） */
  profileRatioThreshold?: number;
  /** 幅高さ比の期待値からの許容ずれ比率（既定 0.25 = ±25%） */
  aspectToleranceRatio?: number;
  /** 「ページ色」画素が探索範囲全体に占める最小割合（既定 0.1） */
  minPageAreaRatio?: number;
  /** 投影プロファイル作成時に走査する画素の縦横それぞれの最大数（既定 400） */
  maxSamples?: number;
};

/** 罫線・文字による分断を橋渡しする、範囲長に対する最大の隙間比率 */
const PAGE_RUN_GAP_RATIO = 0.03;
/** 矩形内の「ページ色」画素の割合の下限（背景の混入した矩形を除外する） */
const PAGE_RECT_MIN_FILL_RATIO = 0.6;
/** 検出矩形が探索範囲をほぼ全体覆っているとみなす比率（境界が見つかっていない） */
const PAGE_RECT_FULL_COVER_RATIO = 0.98;

/**
 * 探索範囲の画像から、参照色（ページの地色）に近い領域としてページの矩形を検出する。
 *
 * 検出できない場合（ページ色の画素が少なすぎる・背景がページ色に近く境界が不明・
 * 幅高さ比が期待値から大きく外れる）は null を返す。呼び出し側でガイド枠クロップにフォールバックする。
 * 成功時は探索範囲内のローカル座標（px）で矩形を返す。
 */
export function detectPageRect(
  searchCanvas: HTMLCanvasElement,
  referenceColor: RgbColor,
  expectedAspectRatio: number,
  options: DetectPageRectOptions = {},
): PageRect | null {
  const { width, height } = searchCanvas;
  if (width <= 0 || height <= 0) return null;
  const ctx = searchCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D コンテキストを取得できませんでした");
  const { data } = ctx.getImageData(0, 0, width, height);
  return detectPageRectFromPixels(data, width, height, referenceColor, expectedAspectRatio, options);
}

/**
 * RGBA 画素配列からページ矩形を検出する。detectPageRect の Canvas 非依存部分。
 */
export function detectPageRectFromPixels(
  data: ArrayLike<number>,
  width: number,
  height: number,
  referenceColor: RgbColor,
  expectedAspectRatio: number,
  options: DetectPageRectOptions = {},
): PageRect | null {
  const {
    colorDistanceThreshold = 40,
    profileRatioThreshold = 0.5,
    aspectToleranceRatio = 0.25,
    minPageAreaRatio = 0.1,
    maxSamples = 400,
  } = options;
  if (!(expectedAspectRatio > 0) || !Number.isFinite(expectedAspectRatio)) {
    throw new RangeError(`expectedAspectRatio は正の有限値で指定してください: ${expectedAspectRatio}`);
  }
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return null;

  // 1. サブサンプリングしながら、参照色との距離で「ページ色」の 2 値マスクを作る
  const step = Math.max(1, Math.ceil(Math.max(width, height) / maxSamples));
  const cols = Math.ceil(width / step);
  const rows = Math.ceil(height / step);
  const mask = new Uint8Array(cols * rows);
  const thresholdSq = colorDistanceThreshold * colorDistanceThreshold;
  let pageCount = 0;
  for (let sy = 0; sy < rows; sy++) {
    for (let sx = 0; sx < cols; sx++) {
      const i = ((sy * step) * width + sx * step) * 4;
      if (data[i + 3] === 0) continue;
      const dr = data[i] - referenceColor.r;
      const dg = data[i + 1] - referenceColor.g;
      const db = data[i + 2] - referenceColor.b;
      if (dr * dr + dg * dg + db * db <= thresholdSq) {
        mask[sy * cols + sx] = 1;
        pageCount++;
      }
    }
  }
  if (pageCount / (cols * rows) < minPageAreaRatio) return null;

  // 2. 行・列の投影プロファイルから連続範囲を求める。
  // まず全体で大まかな範囲を求め、その範囲内で再計算して背景の割合による希釈を減らす
  const rowGap = Math.max(2, Math.round(rows * PAGE_RUN_GAP_RATIO));
  const colGap = Math.max(2, Math.round(cols * PAGE_RUN_GAP_RATIO));
  let rowRun = longestRun(projectRows(mask, cols, rows, 0, cols), profileRatioThreshold, rowGap);
  let colRun = longestRun(projectCols(mask, cols, 0, rows), profileRatioThreshold, colGap);
  if (rowRun && colRun) {
    const refinedRows = longestRun(
      projectRows(mask, cols, rows, colRun.start, colRun.end + 1),
      profileRatioThreshold,
      rowGap,
    );
    const refinedCols = longestRun(
      projectCols(mask, cols, refinedRows?.start ?? rowRun.start, (refinedRows ?? rowRun).end + 1),
      profileRatioThreshold,
      colGap,
    );
    rowRun = refinedRows ?? rowRun;
    colRun = refinedCols ?? colRun;
  }
  if (!rowRun || !colRun) return null;

  const x = colRun.start * step;
  const y = rowRun.start * step;
  const rectW = Math.min(width, (colRun.end + 1) * step) - x;
  const rectH = Math.min(height, (rowRun.end + 1) * step) - y;
  if (rectW <= 0 || rectH <= 0) return null;

  // 3. 背景がページ色に近く境界が見つからない場合（探索範囲のほぼ全体を覆う）は null
  if (rectW / width >= PAGE_RECT_FULL_COVER_RATIO && rectH / height >= PAGE_RECT_FULL_COVER_RATIO) {
    return null;
  }

  // 矩形内に背景が大きく混入している場合は null
  let inside = 0;
  for (let sy = rowRun.start; sy <= rowRun.end; sy++) {
    for (let sx = colRun.start; sx <= colRun.end; sx++) inside += mask[sy * cols + sx];
  }
  const cells = (rowRun.end - rowRun.start + 1) * (colRun.end - colRun.start + 1);
  if (inside / cells < PAGE_RECT_MIN_FILL_RATIO) return null;

  // 4. 幅高さ比が期待値から大きく外れる場合は null
  const aspect = rectW / rectH;
  if (Math.abs(aspect / expectedAspectRatio - 1) > aspectToleranceRatio) return null;

  return { x, y, width: rectW, height: rectH };
}

/** 各行の「ページ色」画素の割合（列 [c0, c1) の範囲）。 */
function projectRows(mask: Uint8Array, cols: number, rows: number, c0: number, c1: number): Float64Array {
  const profile = new Float64Array(rows);
  const span = Math.max(1, c1 - c0);
  for (let y = 0; y < rows; y++) {
    let sum = 0;
    for (let x = c0; x < c1; x++) sum += mask[y * cols + x];
    profile[y] = sum / span;
  }
  return profile;
}

/** 各列の「ページ色」画素の割合（行 [r0, r1) の範囲）。 */
function projectCols(mask: Uint8Array, cols: number, r0: number, r1: number): Float64Array {
  const profile = new Float64Array(cols);
  const span = Math.max(1, r1 - r0);
  for (let y = r0; y < r1; y++) {
    for (let x = 0; x < cols; x++) profile[x] += mask[y * cols + x];
  }
  for (let x = 0; x < cols; x++) profile[x] /= span;
  return profile;
}

/**
 * プロファイルが閾値以上の最長の連続範囲（両端含む）を返す。
 * maxGap 以下の隙間（罫線・文字の行など）は同じ範囲として橋渡しする。
 */
function longestRun(
  profile: ArrayLike<number>,
  threshold: number,
  maxGap: number,
): { start: number; end: number } | null {
  const runs: { start: number; end: number }[] = [];
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] < threshold) continue;
    const last = runs[runs.length - 1];
    if (last && i - last.end - 1 <= maxGap) last.end = i;
    else runs.push({ start: i, end: i });
  }
  let best: { start: number; end: number } | null = null;
  for (const run of runs) {
    if (!best || run.end - run.start > best.end - best.start) best = run;
  }
  return best;
}
