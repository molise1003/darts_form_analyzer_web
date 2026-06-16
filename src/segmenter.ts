import type { PoseFrame, ThrowSegment } from './types';
import { clamp, dist, movingAverage } from './utils';

// 定数（SPEC 4）
const THROW_COUNT = 3;
const MIN_GAP = 500; // ピーク間の最小間隔(ms)
const PRE_RELEASE = 450; // ピーク前(ms)
const POST_RELEASE = 350; // ピーク後(ms)
const SMOOTH_RADIUS = 2; // 移動平均の半径
const MIN_VALID = 6; // 有効点がこれ未満ならフォールバック

/** 動画全体を3等分（フォールバック）。 */
function equalSplit(durationMs: number): ThrowSegment[] {
  const step = durationMs / THROW_COUNT;
  return Array.from({ length: THROW_COUNT }, (_, i) => ({
    startMs: i * step,
    endMs: (i + 1) * step,
  }));
}

/**
 * 手首速度のピークから3投を自動検出する。
 * 失敗時は動画全体を3等分してフォールバック。
 */
export function segmentThrows(frames: PoseFrame[], durationMs: number): ThrowSegment[] {
  const valid = frames.filter((f) => f.wrist);
  if (valid.length < MIN_VALID) return equalSplit(durationMs);

  // 手首の速度系列: 連続2点間の距離 ÷ dt(秒)
  const times: number[] = [];
  const rawVel: number[] = [];
  for (let i = 1; i < valid.length; i++) {
    const dt = (valid[i].timestampMs - valid[i - 1].timestampMs) / 1000;
    if (dt <= 0) continue;
    times.push(valid[i].timestampMs);
    rawVel.push(dist(valid[i].wrist!, valid[i - 1].wrist!) / dt);
  }
  if (times.length < MIN_VALID) return equalSplit(durationMs);

  // 移動平均で平滑化
  const vel = movingAverage(rawVel, SMOOTH_RADIUS);
  const series = times.map((ms, i) => ({ ms, v: vel[i] }));

  // 速度の高い順に、最小間隔を空けながらピークを3つ選ぶ
  const order = [...series].sort((a, b) => b.v - a.v);
  const peaks: number[] = [];
  for (const s of order) {
    if (peaks.length >= THROW_COUNT) break;
    if (peaks.every((p) => Math.abs(p - s.ms) >= MIN_GAP)) peaks.push(s.ms);
  }
  if (peaks.length < THROW_COUNT) return equalSplit(durationMs);

  peaks.sort((a, b) => a - b);

  // 各ピークの窓
  const segs: ThrowSegment[] = peaks.map((p) => ({
    startMs: clamp(p - PRE_RELEASE, 0, durationMs),
    endMs: clamp(p + POST_RELEASE, 0, durationMs),
  }));

  // 重なり解消: 隣の区間が重なったら境界を中点で分割
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i].endMs > segs[i + 1].startMs) {
      const mid = (segs[i].endMs + segs[i + 1].startMs) / 2;
      segs[i].endMs = mid;
      segs[i + 1].startMs = mid;
    }
  }

  return segs;
}
