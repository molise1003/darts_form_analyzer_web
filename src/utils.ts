import type { Point } from './types';

export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/** 半径 r の移動平均で平滑化（端は範囲をクランプ）。 */
export function movingAverage(values: number[], r: number): number[] {
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = i - r; k <= i + r; k++) {
      if (k >= 0 && k < values.length) {
        sum += values[k];
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  });
}

/**
 * 点列をインデックス正規化で N 点にリサンプル（線形補間 lerp）。
 * 例: i番目の位置 = i/(N-1) * (len-1)。
 */
export function resample(points: Point[], n: number): Point[] {
  if (points.length === 0) return [];
  if (points.length === 1) return Array.from({ length: n }, () => ({ ...points[0] }));
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (points.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(lo + 1, points.length - 1);
    const f = t - lo;
    out.push({
      x: lerp(points[lo].x, points[hi].x, f),
      y: lerp(points[lo].y, points[hi].y, f),
    });
  }
  return out;
}

/** 肩-肘-手首の3点で肘の角度(度)。a=肩-肘, b=手首-肘。 */
export function angleAt(shoulder: Point, elbow: Point, wrist: Point): number {
  const ax = shoulder.x - elbow.x;
  const ay = shoulder.y - elbow.y;
  const bx = wrist.x - elbow.x;
  const by = wrist.y - elbow.y;
  const dot = ax * bx + ay * by;
  const magA = Math.hypot(ax, ay);
  const magB = Math.hypot(bx, by);
  if (magA === 0 || magB === 0) return 0;
  const cos = clamp(dot / (magA * magB), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}
