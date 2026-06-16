// 正規化座標 (0.0〜1.0)。x = px/width, y = px/height。
export interface Point {
  x: number;
  y: number;
}

export type Arm = 'right' | 'left';

// 1フレームの姿勢。信頼度 < 0.5 の関節は null。
export interface PoseFrame {
  timestampMs: number;
  shoulder: Point | null;
  elbow: Point | null;
  wrist: Point | null;
}

// 3投の区切り（ミリ秒）。
export interface ThrowSegment {
  startMs: number;
  endMs: number;
}

// 1投ぶんの分析結果。
export interface ThrowResult {
  index: number; // 0,1,2
  segment: ThrowSegment;
  releaseMs: number; // リリースフレームの時刻
  elbowAngle: number | null; // 肘角度(度)
  wristPathLength: number; // 手首軌道長（正規化座標）
  releaseHeight: number | null; // リリース時の手首 y（小さいほど高い）
  rawWrist: Point[]; // 区間内の手首点（描画用）
  trajectory: Point[]; // 24点リサンプル（deviation計算用）
  deviation: number; // 正解とのずれ。正解自身は0。
}
