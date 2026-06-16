import type { PoseFrame, Point, ThrowResult, ThrowSegment } from './types';
import { angleAt, dist, resample } from './utils';

const RESAMPLE_N = 24; // リサンプル点数

/** 区間内のフレームを抽出。 */
function framesIn(frames: PoseFrame[], seg: ThrowSegment): PoseFrame[] {
  return frames.filter(
    (f) => f.timestampMs >= seg.startMs && f.timestampMs <= seg.endMs,
  );
}

/** 区間内で手首速度が最大のフレーム＝リリースフレーム。 */
function releaseFrame(sub: PoseFrame[]): PoseFrame | null {
  const w = sub.filter((f) => f.wrist);
  if (w.length === 0) return null;
  if (w.length === 1) return w[0];
  let best = w[1];
  let bestV = -1;
  for (let i = 1; i < w.length; i++) {
    const dt = (w[i].timestampMs - w[i - 1].timestampMs) / 1000;
    if (dt <= 0) continue;
    const v = dist(w[i].wrist!, w[i - 1].wrist!) / dt;
    if (v > bestV) {
      bestV = v;
      best = w[i];
    }
  }
  return best;
}

/** 区間内の連続手首点の距離の総和。 */
function wristPathLength(wristPoints: Point[]): number {
  let total = 0;
  for (let i = 1; i < wristPoints.length; i++) {
    total += dist(wristPoints[i - 1], wristPoints[i]);
  }
  return total;
}

/** deviation を除いた1投ぶんのメトリクスを計算。 */
function computeOne(frames: PoseFrame[], seg: ThrowSegment, index: number): ThrowResult {
  const sub = framesIn(frames, seg);
  const wristPoints = sub.filter((f) => f.wrist).map((f) => f.wrist!);
  const release = releaseFrame(sub);

  let elbowAngle: number | null = null;
  if (release && release.shoulder && release.elbow && release.wrist) {
    elbowAngle = angleAt(release.shoulder, release.elbow, release.wrist);
  }

  return {
    index,
    segment: seg,
    releaseMs: release ? release.timestampMs : (seg.startMs + seg.endMs) / 2,
    elbowAngle,
    wristPathLength: wristPathLength(wristPoints),
    releaseHeight: release && release.wrist ? release.wrist.y : null,
    rawWrist: wristPoints,
    trajectory: resample(wristPoints, RESAMPLE_N),
    deviation: 0,
  };
}

/** 正解(ref)と対象(target)の手首軌跡ずれ＝各24点のユークリッド距離の平均。 */
function deviation(ref: ThrowResult, target: ThrowResult): number {
  const n = Math.min(ref.trajectory.length, target.trajectory.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += dist(ref.trajectory[i], target.trajectory[i]);
  return sum / n;
}

/**
 * 全3投のメトリクスを計算し、refIndex を基準に deviation を埋める。
 */
export function analyzeThrows(
  frames: PoseFrame[],
  segments: ThrowSegment[],
  refIndex: number,
): ThrowResult[] {
  const results = segments.map((seg, i) => computeOne(frames, seg, i));
  const ref = results[refIndex];
  for (const r of results) {
    r.deviation = r.index === refIndex ? 0 : deviation(ref, r);
  }
  return results;
}
