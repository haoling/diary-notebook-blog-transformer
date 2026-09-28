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
  const { width, height } = canvas;
  if (width <= 0 || height <= 0) {
    throw new RangeError("地色をサンプリングする画像のサイズが 0 です");
  }

  let target = canvas;
  const scale = Math.sqrt(BACKGROUND_MAX_SAMPLES / (width * height));
  if (scale < 1) {
    // 画素値を平均化せず 2 次元的に間引くため、スムージングを無効にして縮小する
    target = document.createElement("canvas");
    target.width = Math.max(1, Math.floor(width * scale));
    target.height = Math.max(1, Math.floor(height * scale));
    const scaledCtx = target.getContext("2d");
    if (!scaledCtx) throw new Error("Canvas 2D コンテキストを取得できませんでした");
    scaledCtx.imageSmoothingEnabled = false;
    scaledCtx.drawImage(canvas, 0, 0, target.width, target.height);
  }

  const ctx = target.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D コンテキストを取得できませんでした");
  const { data } = ctx.getImageData(0, 0, target.width, target.height);
  return sampleBackgroundColorFromPixels(data);
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
