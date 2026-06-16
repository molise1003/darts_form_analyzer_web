import './style.css';
import type { Arm, PoseFrame, ThrowResult, ThrowSegment } from './types';
import { createLandmarker, extractPoseFrames } from './pose';
import { segmentThrows } from './segmenter';
import { analyzeThrows } from './metrics';
import { advise } from './advisor';
import {
  CORRECT_COLOR,
  THROW_COLORS,
  drawComparison,
  drawPoseAtTime,
} from './overlay';
import { clamp } from './utils';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';

// ---------------------------------------------------------------------------
// 状態
// ---------------------------------------------------------------------------
let objectUrl: string | null = null;
let landmarker: PoseLandmarker | null = null;
let poseFrames: PoseFrame[] = [];
let segments: ThrowSegment[] = [];
let refIndex = 0;
let results: ThrowResult[] | null = null;
let arm: Arm = 'right';
let durationMs = 0;
let overlayMode: 'live' | 'comparison' = 'live';

const MIN_SEG_MS = 100;

// ---------------------------------------------------------------------------
// DOM 構築
// ---------------------------------------------------------------------------
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <h1>ダーツフォーム分析</h1>
  <p class="subtitle">動画はブラウザ内だけで処理され、サーバーには送信されません。</p>

  <div id="upload" class="card">
    <label class="drop-zone" id="drop">
      <div class="big">動画をドラッグ&ドロップ、またはクリックして選択</div>
      <div class="muted">手元のダーツ投球動画（3投ぶん）を読み込みます</div>
      <input id="file" type="file" accept="video/*" />
    </label>
    <div class="row" style="margin-top:14px">
      <span class="muted">利き腕:</span>
      <div class="pill-group" id="arm-pick">
        <button class="toggle active" data-arm="right">右</button>
        <button class="toggle" data-arm="left">左</button>
      </div>
    </div>
  </div>

  <div id="analyzer" class="hidden">
    <div class="card">
      <div class="stage">
        <video id="video" playsinline></video>
        <canvas id="overlay"></canvas>
      </div>

      <div class="row controls">
        <button id="play">▶︎ 再生</button>
        <div class="pill-group" id="speed">
          <button class="toggle" data-rate="0.25">0.25x</button>
          <button class="toggle" data-rate="0.5">0.5x</button>
          <button class="toggle active" data-rate="1">1.0x</button>
        </div>
        <div class="spacer"></div>
        <div class="time" id="time">0.0 / 0.0 s</div>
      </div>

      <div id="pose-status" class="muted" style="margin-top:10px">姿勢を推定しています…</div>
      <div class="progress"><div id="pose-bar"></div></div>
    </div>

    <div class="card" id="segment-card">
      <h2>3投の区切り（ハンドルをドラッグして調整）</h2>
      <div class="timeline" id="timeline"></div>
      <div class="row" style="margin-top:12px">
        <span class="muted">正解フォーム:</span>
        <div class="pill-group" id="ref-pick"></div>
        <div class="spacer"></div>
        <button id="analyze" class="primary">分析</button>
      </div>
    </div>

    <div id="results" class="hidden">
      <div class="card">
        <h2>メトリクス</h2>
        <table id="metrics-table"></table>
      </div>
      <div class="card">
        <div class="row" style="margin-bottom:12px">
          <h2 style="margin:0">調整アドバイス</h2>
          <div class="spacer"></div>
          <button id="toggle-overlay" class="toggle">上の動画に重ね軌跡を表示</button>
        </div>
        <div id="advice-list"></div>
      </div>
    </div>
  </div>
`;

// 参照
const $ = <T extends HTMLElement>(sel: string) => app.querySelector<T>(sel)!;
const uploadCard = $('#upload');
const analyzer = $('#analyzer');
const dropZone = $<HTMLLabelElement>('#drop');
const fileInput = $<HTMLInputElement>('#file');
const video = $<HTMLVideoElement>('#video');
const overlay = $<HTMLCanvasElement>('#overlay');
const playBtn = $<HTMLButtonElement>('#play');
const timeEl = $('#time');
const poseStatus = $('#pose-status');
const poseBar = $<HTMLDivElement>('#pose-bar');
const timeline = $<HTMLDivElement>('#timeline');
const refPick = $('#ref-pick');
const analyzeBtn = $<HTMLButtonElement>('#analyze');
const resultsEl = $('#results');
const metricsTable = $<HTMLTableElement>('#metrics-table');
const adviceList = $('#advice-list');
const toggleOverlayBtn = $<HTMLButtonElement>('#toggle-overlay');

// ---------------------------------------------------------------------------
// アップロード
// ---------------------------------------------------------------------------
$('#arm-pick').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-arm]');
  if (!btn) return;
  arm = btn.dataset.arm as Arm;
  $('#arm-pick')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('active', b === btn));
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});

function loadFile(file: File) {
  if (!file.type.startsWith('video/')) {
    alert('動画ファイルを選択してください。');
    return;
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  // fetch/XHR は使わず、ローカル読み込みのみ。
  objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;
  video.load();
  uploadCard.classList.add('hidden');
  analyzer.classList.remove('hidden');
  resultsEl.classList.add('hidden');
  results = null;
  overlayMode = 'live';

  video.addEventListener(
    'loadedmetadata',
    () => {
      durationMs = video.duration * 1000;
      updateTime();
      runPose();
    },
    { once: true },
  );
}

// ---------------------------------------------------------------------------
// 姿勢推定
// ---------------------------------------------------------------------------
async function runPose() {
  analyzeBtn.disabled = true;
  poseStatus.textContent = 'モデルを読み込み中…';
  poseBar.style.width = '0%';
  try {
    if (!landmarker) landmarker = await createLandmarker();
    poseStatus.textContent = '姿勢を推定しています…';
    poseFrames = await extractPoseFrames(video, landmarker, arm, (r) => {
      poseBar.style.width = `${Math.round(r * 100)}%`;
    });
    poseBar.style.width = '100%';
    const valid = poseFrames.filter((f) => f.wrist).length;
    poseStatus.textContent = `推定完了（有効フレーム ${valid} / ${poseFrames.length}）。区切りを確認して「分析」を押してください。`;

    segments = segmentThrows(poseFrames, durationMs);
    refIndex = 0;
    renderTimeline();
    renderRefPick();
    analyzeBtn.disabled = false;
    video.currentTime = 0;
  } catch (err) {
    console.error(err);
    poseStatus.textContent =
      '姿勢推定の初期化に失敗しました。ネットワーク接続（初回のモデル取得）をご確認ください。';
  }
}

// ---------------------------------------------------------------------------
// タイムライン（3投の区切り調整）
// ---------------------------------------------------------------------------
const msToPct = (ms: number) => (durationMs > 0 ? (ms / durationMs) * 100 : 0);

function renderTimeline() {
  timeline.innerHTML = '';
  segments.forEach((seg, i) => {
    const el = document.createElement('div');
    el.className = 'seg' + (i === refIndex ? ' is-ref' : '');
    el.style.left = `${msToPct(seg.startMs)}%`;
    el.style.width = `${msToPct(seg.endMs - seg.startMs)}%`;
    el.style.background = THROW_COLORS[i] ?? '#888';

    const label = document.createElement('span');
    label.className = 'seg-label';
    label.textContent = `${i + 1}`;
    el.appendChild(label);

    const lh = document.createElement('div');
    lh.className = 'handle left';
    lh.addEventListener('pointerdown', (e) => startDrag(e, i, 'start'));
    const rh = document.createElement('div');
    rh.className = 'handle right';
    rh.addEventListener('pointerdown', (e) => startDrag(e, i, 'end'));
    el.appendChild(lh);
    el.appendChild(rh);
    timeline.appendChild(el);
  });

  const ph = document.createElement('div');
  ph.className = 'playhead';
  ph.id = 'playhead';
  timeline.appendChild(ph);
  updatePlayhead();
}

function startDrag(e: PointerEvent, segIndex: number, edge: 'start' | 'end') {
  e.preventDefault();
  e.stopPropagation();
  const rect = timeline.getBoundingClientRect();

  const move = (ev: PointerEvent) => {
    const ratio = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
    let ms = ratio * durationMs;
    const seg = segments[segIndex];
    if (edge === 'start') {
      ms = clamp(ms, 0, seg.endMs - MIN_SEG_MS);
      seg.startMs = ms;
    } else {
      ms = clamp(ms, seg.startMs + MIN_SEG_MS, durationMs);
      seg.endMs = ms;
    }
    // ドラッグ中は動画もその位置にシーク
    seekTo(ms);
    renderTimeline();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function renderRefPick() {
  refPick.innerHTML = '';
  segments.forEach((_, i) => {
    const btn = document.createElement('button');
    btn.className = 'toggle' + (i === refIndex ? ' active' : '');
    btn.textContent = `${i + 1}投目`;
    btn.addEventListener('click', () => {
      refIndex = i;
      renderRefPick();
      renderTimeline();
      if (results) runAnalyze(); // 既に分析済みなら基準を変えて再計算
    });
    refPick.appendChild(btn);
  });
}

// ---------------------------------------------------------------------------
// 分析
// ---------------------------------------------------------------------------
analyzeBtn.addEventListener('click', runAnalyze);

function runAnalyze() {
  if (poseFrames.length === 0) return;
  results = analyzeThrows(poseFrames, segments, refIndex);
  renderMetrics(results);
  renderAdvice(results);
  resultsEl.classList.remove('hidden');
  // 比較オーバーレイを表示（リリースフレームを背景に）
  overlayMode = 'comparison';
  toggleOverlayBtn.classList.add('active');
  video.pause();
  seekTo(results[refIndex].releaseMs);
}

function renderMetrics(res: ThrowResult[]) {
  const fmt = (v: number | null, d = 2) => (v == null ? '—' : v.toFixed(d));
  let html = `<thead><tr>
    <th>投</th><th>肘角度</th><th>軌道長</th><th>リリース高さ</th><th>正解とのずれ</th>
  </tr></thead><tbody>`;
  res.forEach((r) => {
    const isRef = r.index === refIndex;
    const color = isRef ? CORRECT_COLOR : THROW_COLORS[r.index];
    html += `<tr class="${isRef ? 'is-ref' : ''}">
      <td><span class="dot" style="background:${color}"></span>${r.index + 1}投目${isRef ? '（正解）' : ''}</td>
      <td>${fmt(r.elbowAngle, 1)}${r.elbowAngle == null ? '' : '°'}</td>
      <td>${fmt(r.wristPathLength, 3)}</td>
      <td>${fmt(r.releaseHeight, 3)}</td>
      <td>${isRef ? '—' : fmt(r.deviation, 3)}</td>
    </tr>`;
  });
  html += '</tbody>';
  metricsTable.innerHTML = html;
}

function renderAdvice(res: ThrowResult[]) {
  const ref = res[refIndex];
  adviceList.innerHTML = '';
  res
    .filter((r) => r.index !== refIndex)
    .forEach((r) => {
      const msgs = advise(ref, r);
      const card = document.createElement('div');
      card.className = 'advice';
      card.style.borderLeftColor = THROW_COLORS[r.index];
      card.innerHTML = `<h3>${r.index + 1}投目 → 正解（${refIndex + 1}投目）との差</h3>
        <ul>${msgs.map((m) => `<li>${m}</li>`).join('')}</ul>`;
      adviceList.appendChild(card);
    });
}

toggleOverlayBtn.addEventListener('click', () => {
  if (!results) return;
  overlayMode = overlayMode === 'comparison' ? 'live' : 'comparison';
  toggleOverlayBtn.classList.toggle('active', overlayMode === 'comparison');
  if (overlayMode === 'comparison') {
    video.pause();
    seekTo(results[refIndex].releaseMs);
  }
  draw();
});

// ---------------------------------------------------------------------------
// 再生コントロール
// ---------------------------------------------------------------------------
playBtn.addEventListener('click', () => {
  if (video.paused) {
    overlayMode = 'live';
    toggleOverlayBtn.classList.remove('active');
    video.play();
  } else {
    video.pause();
  }
});
video.addEventListener('play', () => (playBtn.textContent = '❚❚ 一時停止'));
video.addEventListener('pause', () => (playBtn.textContent = '▶︎ 再生'));

$('#speed').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-rate]');
  if (!btn) return;
  video.playbackRate = parseFloat(btn.dataset.rate!);
  $('#speed')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('active', b === btn));
});

function seekTo(ms: number) {
  video.currentTime = clamp(ms, 0, durationMs) / 1000;
}

function updateTime() {
  const cur = video.currentTime || 0;
  const total = video.duration || 0;
  timeEl.textContent = `${cur.toFixed(1)} / ${total.toFixed(1)} s`;
}

function updatePlayhead() {
  const ph = timeline.querySelector<HTMLDivElement>('#playhead');
  if (ph) ph.style.left = `${msToPct((video.currentTime || 0) * 1000)}%`;
}

// ---------------------------------------------------------------------------
// 描画（再生中のみ rAF ループ、それ以外はイベント時に1回だけ描く）
// ---------------------------------------------------------------------------
let rafId = 0;

function draw() {
  updateTime();
  updatePlayhead();
  if (overlay.clientWidth > 0) {
    if (overlayMode === 'comparison' && results) {
      drawComparison(overlay, results, refIndex);
    } else if (poseFrames.length > 0) {
      drawPoseAtTime(
        overlay,
        poseFrames,
        (video.currentTime || 0) * 1000,
        segments,
        refIndex,
      );
    }
  }
}

function loop() {
  draw();
  rafId = requestAnimationFrame(loop);
}
function startLoop() {
  if (!rafId) rafId = requestAnimationFrame(loop);
}
function stopLoop() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  draw();
}

video.addEventListener('play', startLoop);
video.addEventListener('pause', stopLoop);
video.addEventListener('ended', stopLoop);
video.addEventListener('seeked', draw);
video.addEventListener('timeupdate', draw);
video.addEventListener('loadeddata', draw);
