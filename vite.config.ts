import { defineConfig } from 'vite';

// base: './' で相対パス配信にし、GitHub Pages / Netlify / Vercel いずれの
// 静的ホスティングでもサブパス配下でそのまま動くようにする。
export default defineConfig({
  base: './',
  server: {
    headers: {
      // MediaPipe の WASM スレッド実行に備えた COOP/COEP（任意・あれば高速化）
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
