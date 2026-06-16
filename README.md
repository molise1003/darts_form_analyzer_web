# ダーツフォーム分析 Web版

1本のダーツ投球動画をブラウザ内だけで分析するツール。3投の手首軌道を比較し、
正解フォームとの差を日本語のアドバイスとして表示します。
**動画はサーバーに送信されません（完全クライアントサイド処理）。**

## 機能
- 動画アップロード（ドラッグ&ドロップ / ファイル選択、ローカル読み込みのみ）
- MediaPipe Pose Landmarker による姿勢推定（100ms間隔サンプリング、GPU優先）
- 手首速度のピークから3投を自動検出 → タイムラインのハンドルで手動調整（動画連動シーク）
- 正解フォーム（基準）の選択
- 手首軌道のゴースト重ね表示＋メトリクス表＋調整アドバイス
- 単一投の再生オーバーレイ（手首軌跡＋肩肘手首スケルトン）

## 開発

```bash
npm install
npm run dev      # 開発サーバー
npm run build    # 本番ビルド（dist/）
npm run preview  # ビルド成果物のプレビュー
```

## デプロイ
`npm run build` で生成される `dist/` を GitHub Pages / Netlify / Vercel などの
静的ホスティングに置くだけで動きます（バックエンド不要）。

## モデル / WASM のホスティング
既定では MediaPipe の WASM とモデル（`pose_landmarker_lite`）を CDN から取得します
（`src/pose.ts` の `WASM_PATH` / `MODEL_URL`）。

完全オフライン・外部CDN非依存にしたい場合は、これらのファイルを `public/` 配下に
同梱し、`WASM_PATH` / `MODEL_URL` をローカルパスに差し替えてください。さらに
Service Worker で `.task` / WASM を Cache Storage にキャッシュすると、2回目以降は
即ロードかつオフライン動作が可能になります（PWA化）。

## 構成
- `src/types.ts` — データ型（PoseFrame / ThrowSegment / ThrowResult）
- `src/pose.ts` — Pose Landmarker 初期化・フレーム抽出・正規化
- `src/segmenter.ts` — 3投の自動セグメンテーション
- `src/metrics.ts` — メトリクス（肘角度・軌道長・リリース高さ・ずれ）
- `src/advisor.ts` — 正解との差から日本語アドバイス生成
- `src/overlay.ts` — 軌跡・スケルトンの Canvas 描画
- `src/main.ts` — UI とフロー全体
