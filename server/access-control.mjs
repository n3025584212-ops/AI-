import { randomUUID, timingSafeEqual } from 'node:crypto';

export class AccessControlError extends Error {
  constructor(status, message) { super(message); this.name = 'AccessControlError'; this.status = status; }
}

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval' 'sha256-QI5yOVqtDbJpz4D/lC8W27spkC5aeAbIz0rWM2Qbk9Y=' 'sha256-jp7tVBDNbbsZQdqrduswbqrZBqAXsO6YqjeVliZ9MpM=' 'sha256-eIghd/v0vNOgpobioofEeX+pLRM3mj/gqiuuenv0uFg='", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self' blob:",
  "media-src 'self' blob:", "worker-src 'self' blob:", "object-src 'none'",
  "frame-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function exactOrigin(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' && !url.username && !url.password && raw === url.origin
      && LOOPBACK_HOSTS.has(url.hostname) ? url.origin : null;
  } catch { return null; }
}

/** A desktop token is supplied by the trusted owner, never returned to HTTP clients. */
export function createAccessControl({ mode = 'development', authToken, allowedOrigins = [], shareHosts = [], shareOrigins = [] } = {}) {
  if (!['desktop', 'development'].includes(mode)) throw new TypeError('Unknown local service access mode.');
  if (mode === 'desktop' && (typeof authToken !== 'string' || !/^[a-f0-9]{64}$/i.test(authToken))) {
    throw new TypeError('Desktop mode requires a 256-bit hexadecimal startup token.');
  }
  if (!Array.isArray(allowedOrigins) || allowedOrigins.some(origin => !exactOrigin(origin))) {
    throw new TypeError('Development origins must be exact loopback HTTP origins.');
  }
  if (mode === 'desktop' && allowedOrigins.length) throw new TypeError('Desktop mode does not allow development origins.');
  const validShareHost = value => typeof value === 'string' && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(value);
  const validShareOrigin = value => { try { const u = new URL(value); return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && value === u.origin; } catch { return false; } };
  if (!Array.isArray(shareHosts) || shareHosts.some(value => !validShareHost(value))) throw new TypeError('Share hosts must be plain host names.');
  if (!Array.isArray(shareOrigins) || shareOrigins.some(value => !validShareOrigin(value))) throw new TypeError('Share origins must be exact origins.');
  const origins = new Set(allowedOrigins);
  const sharedHosts = new Set(shareHosts.map(value => value.toLowerCase()));
  const sharedOrigins = new Set(shareOrigins);
  const expected = mode === 'desktop' ? Buffer.from(`Bearer ${authToken}`, 'utf8') : null;
  const sessionId = randomUUID();

  function check(req, { port = req.socket?.localPort, pathname } = {}) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AccessControlError(503, '本地服务尚未就绪。');
    const host = req.headers.host;
    const allowedHosts = mode === 'desktop' ? [`127.0.0.1:${port}`]
      : [...LOOPBACK_HOSTS].map(name => `${name}:${port}`).concat([...sharedHosts]);
    if (typeof host !== 'string' || !allowedHosts.includes(host.toLowerCase())) {
      throw new AccessControlError(403, '仅允许通过当前本机服务地址访问。');
    }
    const origin = req.headers.origin;
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
    const sameOrigin = `${forwardedProto === 'https' ? 'https' : 'http'}://${host.toLowerCase()}`;
    const originAllowed = value => exactOrigin(value) || sharedOrigins.has(value);
    if (origin !== undefined && (!originAllowed(origin) || (origin !== sameOrigin && !origins.has(origin)))) {
      throw new AccessControlError(403, '仅允许当前应用页面访问此服务。');
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new AccessControlError(403, '不接受跨站页面请求。');
    const route = pathname ?? new URL(req.url || '/', sameOrigin).pathname;
    const isApi = route.startsWith('/api/');
    const isHealth = route === '/api/health' && req.method === 'GET';
    if (req.method === 'OPTIONS') {
      const requested = String(req.headers['access-control-request-headers'] || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
      if (requested.some(header => !['content-type', 'authorization'].includes(header))) {
        throw new AccessControlError(403, '请求头不受支持。');
      }
    } else if (mode === 'desktop' && isApi && !isHealth) {
      const raw = req.headers.authorization;
      const supplied = typeof raw === 'string' && raw.length <= 128 ? Buffer.from(raw, 'utf8') : Buffer.alloc(0);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        throw new AccessControlError(401, '当前应用会话认证无效，请重新打开应用。');
      }
    }
    return { origin: origin || null, sameOrigin, authenticated: mode === 'desktop' && isApi && !isHealth && req.method !== 'OPTIONS' };
  }

  function applyHeaders(res) {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  }
  return Object.freeze({ check, applyHeaders, sessionId, mode });
}
