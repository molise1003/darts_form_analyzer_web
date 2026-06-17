import type { PoseFrame, Point, ThrowResult, ThrowSegment } from './types';

// 軌跡・スコアの色（SPEC 7 / 8b）
export const CORRECT_COLOR = '#FFB74D'; // 正解=アンバー
export const THROW_COLORS = ['#64B5F6', '#81C784', '#BA68C8']; // 1投目=青,2投目=緑,3投目=紫

// 単一投スケルトンの色
const SHOULDER_COLOR = '#FF9800';
const ELBOW_COLOR = '#AED581';
const WRIST_COLOR = '#4DD0E1';
const BONE_COLOR = '#FFB74D';

function hexAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** 描画前にキャンバスのバッキング解像度を表示サイズに合わせる。 */
export function fitCanvas(canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

/**
 * 3投の手首軌跡を同一正規化座標に重ねて描画（比較ビュー）。
 * 正解=実線アンバー、他=半透明ゴースト。末尾に点マーカー。
 */
export function drawComparison(
  canvas: HTMLCanvasElement,
  results: ThrowResult[],
  refIndex: number,
): void {
  fitCanvas(canvas);
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  results.forEach((r) => {
    if (r.rawWrist.length === 0) return;
    const isRef = r.index === refIndex;
    // 各投の色は固定（正解でも色は変えない）。正解は太さ＋アンバーのリングで示す。
    const color = THROW_COLORS[r.index] ?? '#FFFFFF';

    ctx.strokeStyle = isRef ? color : hexAlpha(color, 0.45);
    ctx.lineWidth = isRef ? 4 : 2.5;
    ctx.beginPath();
    r.rawWrist.forEach((p, j) => {
      const x = p.x * w;
      const y = p.y * h;
      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 末尾（リリース付近）のマーカー
    const last = r.rawWrist[r.rawWrist.length - 1];
    const lx = last.x * w;
    const ly = last.y * h;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lx, ly, isRef ? 6 : 4.5, 0, Math.PI * 2);
    ctx.fill();

    // 正解フォームはアンバーのリングで強調（色は変えない）
    if (isRef) {
      ctx.strokeStyle = CORRECT_COLOR;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(lx, ly, 11, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

/** 時刻 ms が属する投げの区間インデックス。どこにも属さなければ -1。 */
function segmentOf(ms: number, segments: ThrowSegment[]): number {
  for (let i = 0; i < segments.length; i++) {
    if (ms >= segments[i].startMs && ms <= segments[i].endMs) return i;
  }
  return -1;
}

/** 区間インデックスに対応する軌道色（各投で固定 / 区間外=淡い白）。 */
function trailColorFor(segIdx: number): string {
  if (segIdx < 0) return hexAlpha('#FFFFFF', 0.3);
  return THROW_COLORS[segIdx] ?? WRIST_COLOR;
}

/**
 * 単一投の再生オーバーレイ。現在時刻までの手首軌跡＋肩肘手首スケルトンを描く。
 * 手首軌跡は、各点が属する投げの区間ごとに色分けする。
 */
export function drawPoseAtTime(
  canvas: HTMLCanvasElement,
  frames: PoseFrame[],
  currentMs: number,
  segments: ThrowSegment[] = [],
  refIndex = -1,
): void {
  fitCanvas(canvas);
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const px = (p: Point) => ({ x: p.x * w, y: p.y * h });

  // 現在時刻までの手首軌跡を、区間ごとの固定色で線分描画（正解は太線で強調）
  const trail = frames.filter((f) => f.timestampMs <= currentMs && f.wrist);
  for (let i = 1; i < trail.length; i++) {
    const a = px(trail[i - 1].wrist!);
    const b = px(trail[i].wrist!);
    const segIdx = segmentOf(trail[i].timestampMs, segments);
    ctx.strokeStyle = hexAlpha(trailColorFor(segIdx), 0.9);
    ctx.lineWidth = segIdx === refIndex ? 4.5 : 3;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // 現在フレームのスケルトン（直近のフレーム）
  let cur: PoseFrame | null = null;
  for (const f of frames) {
    if (f.timestampMs <= currentMs) cur = f;
    else break;
  }
  if (!cur) return;

  if (cur.shoulder && cur.elbow) drawBone(ctx, px(cur.shoulder), px(cur.elbow));
  if (cur.elbow && cur.wrist) drawBone(ctx, px(cur.elbow), px(cur.wrist));
  if (cur.shoulder) drawJoint(ctx, px(cur.shoulder), SHOULDER_COLOR);
  if (cur.elbow) drawJoint(ctx, px(cur.elbow), ELBOW_COLOR);
  if (cur.wrist) drawJoint(ctx, px(cur.wrist), WRIST_COLOR);
}

function drawBone(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
  ctx.strokeStyle = BONE_COLOR;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawJoint(ctx: CanvasRenderingContext2D, p: Point, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
  ctx.fill();
}
