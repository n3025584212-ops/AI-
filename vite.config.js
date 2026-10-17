import { defineConfig } from 'vite';
import { randomUUID } from 'node:crypto';

export function predictionProxyErrorJson(proxy) {
  // Vite's default transport error response is an empty 500. This listener
  // runs before it and keeps the prediction error contract at the proxy edge.
  proxy.on('error', (error, req, res) => {
    if ((req.url || '').split('?')[0] !== '/api/predict' || res.destroyed || res.headersSent || res.writableEnded || !res.writeHead) return;
    const supplied = req.headers['x-dkqkar-request-id'];
    const request_id = typeof supplied === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(supplied) ? supplied : randomUUID();
    const bytes = JSON.stringify({ ok: false, error_code: 'PREDICT_PROXY_TRANSPORT_ERROR', message: '正式预测服务连接失败，请确认服务已启动后重试。', request_id });
    console.error('[prediction proxy]', JSON.stringify({ request_id, code: error.code || 'PROXY_ERROR', message: error.message }));
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-DKQKAR-Request-Id': request_id });
    res.end(bytes);
  });
}

export default defineConfig({ esbuild: { jsx: 'automatic' }, server: { port: Number(process.env.QCDKR_FRONTEND_PORT || 5190), proxy: { '/api': { target: `http://127.0.0.1:${process.env.QCDKR_PORT || 5189}`, changeOrigin: true, configure: predictionProxyErrorJson } } }, build: { emptyOutDir: false, chunkSizeWarningLimit: 1100, rollupOptions: { output: { manualChunks: { three: ['three'], react: ['react','react-dom'] } } } } });
