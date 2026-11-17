import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 三维版构建：与 dist-no3d 并存，产物输出到 dist-3d。
// 3D 相关模块由源码里的 lazy import 自然拆成独立 chunk。
export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  base: '/',
  build: {
    outDir: 'dist-3d',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 4096,
    rollupOptions: { input: { app: 'index.html', engineer: 'engineer-preview.html' } },
  },
  server: {
    port: 5194,
  },
});
