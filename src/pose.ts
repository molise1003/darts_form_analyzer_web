import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { Arm, PoseFrame } from './types';

// --- 設定 -----------------------------------------------------------------
// WASM とモデルは既定で CDN を参照する。完全オフライン/自前ホストにするには
// これらを public/ 配下に置いたローカルパス（例: 'models/...'）へ差し替える。
const WASM_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export const INTERVAL_MS = 100; // サンプリング間隔（=10fps相当）
const MIN_VISIBILITY = 0.5; // 信頼度 < 0.5 は無効（null扱い）

// MediaPipe Pose landmark index。
const ARM_INDICES: Record<Arm, { shoulder: number; elbow: number; wrist: number }> = {
  right: { shoulder: 12, elbow: 14, wrist: 16 },
  left: { shoulder: 11, elbow: 13, wrist: 15 },
};

/** Pose Landmarker を生成。GPUデリゲート優先、失敗時はCPUにフォールバック。 */
export async function createLandmarker(): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
  const base = { modelAssetPath: MODEL_URL };
  try {
    return await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { ...base, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
  } catch {
    return await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { ...base, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
  }
}

/** video.currentTime をシークして seeked を待つ。 */
function seek(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = seconds;
  });
}

function pickJoint(
  landmarks: { x: number; y: number; visibility?: number }[],
  i: number,
) {
  const lm = landmarks[i];
  if (!lm || (lm.visibility ?? 0) < MIN_VISIBILITY) return null;
  // MediaPipe の landmark は既に画像サイズで正規化済み (0.0〜1.0)。
  return { x: lm.x, y: lm.y };
}

function toFrame(result: PoseLandmarkerResult, arm: Arm, ms: number): PoseFrame {
  const lms = result.landmarks?.[0];
  if (!lms) return { timestampMs: ms, shoulder: null, elbow: null, wrist: null };
  const idx = ARM_INDICES[arm];
  return {
    timestampMs: ms,
    shoulder: pickJoint(lms, idx.shoulder),
    elbow: pickJoint(lms, idx.elbow),
    wrist: pickJoint(lms, idx.wrist),
  };
}

/**
 * 動画全体を INTERVAL_MS 間隔でサンプリングし、各時刻でフレームを取り出して
 * 姿勢推定 → 正規化 PoseFrame 配列を作る。
 */
export async function extractPoseFrames(
  video: HTMLVideoElement,
  landmarker: PoseLandmarker,
  arm: Arm,
  onProgress?: (ratio: number) => void,
): Promise<PoseFrame[]> {
  const durationMs = video.duration * 1000;
  const frames: PoseFrame[] = [];
  let tsCounter = 1; // detectForVideo は単調増加するタイムスタンプを要求する

  const wasPaused = video.paused;
  video.pause();

  for (let ms = 0; ms <= durationMs; ms += INTERVAL_MS) {
    await seek(video, ms / 1000);
    const result = landmarker.detectForVideo(video, tsCounter++);
    frames.push(toFrame(result, arm, ms));
    onProgress?.(durationMs > 0 ? Math.min(1, ms / durationMs) : 1);
  }

  if (!wasPaused) video.play().catch(() => {});
  return frames;
}
