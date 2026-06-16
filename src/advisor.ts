import type { ThrowResult } from './types';

// しきい値（SPEC 6）
const ELBOW_TH = 8; // 度
const HEIGHT_TH = 0.05;
const PATH_ABS_TH = 0.1;
const PATH_REL_TH = 0.2;
const DEVIATION_TH = 0.06;

/**
 * 正解(ref)と対象(target)のメトリクス差から日本語の調整アドバイスを生成。
 */
export function advise(ref: ThrowResult, target: ThrowResult): string[] {
  const msgs: string[] = [];

  // 肘角度
  if (ref.elbowAngle != null && target.elbowAngle != null) {
    const d = target.elbowAngle - ref.elbowAngle;
    if (Math.abs(d) >= ELBOW_TH) {
      const deg = Math.round(Math.abs(d));
      if (d > 0) {
        msgs.push(
          `肘が正解より${deg}°開いています（伸びすぎ）。もう少し肘を畳んで投げましょう。`,
        );
      } else {
        msgs.push(
          `肘が正解より${deg}°畳まれています。もう少し肘を伸ばして投げましょう。`,
        );
      }
    }
  }

  // リリース高さ（y が大きい＝低い位置）
  if (ref.releaseHeight != null && target.releaseHeight != null) {
    const d = target.releaseHeight - ref.releaseHeight;
    if (Math.abs(d) >= HEIGHT_TH) {
      if (d > 0) {
        msgs.push('リリースが正解より低い位置です。もう少し高い位置で離しましょう。');
      } else {
        msgs.push('リリースが正解より高い位置です。もう少し低い位置で離しましょう。');
      }
    }
  }

  // 手首軌道長
  {
    const d = target.wristPathLength - ref.wristPathLength;
    if (
      Math.abs(d) >= PATH_ABS_TH &&
      ref.wristPathLength > 0 &&
      Math.abs(d) / ref.wristPathLength >= PATH_REL_TH
    ) {
      if (d > 0) {
        msgs.push('手首の振りが正解より大きめです。よりコンパクトに振りましょう。');
      } else {
        msgs.push('手首の振りが正解より小さめです。もう少し大きく振りましょう。');
      }
    }
  }

  // 軌跡ずれ
  if (target.deviation >= DEVIATION_TH) {
    msgs.push(
      `軌道全体が正解から離れています（ずれ ${target.deviation.toFixed(3)}）。テイクバックからリリースまでの軌道を正解に近づけましょう。`,
    );
  }

  if (msgs.length === 0) {
    msgs.push('正解フォームにかなり近い動きです。この感覚を再現しましょう。');
  }
  return msgs;
}
