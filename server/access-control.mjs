import { randomUUID, timingSafeEqual } from 'node:crypto';

export class AccessControlError extends Error {
  constructor(status, message) { super(message); this.name = 'AccessControlError'; this.status = status; }
}

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
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
export function createAccessControl({ mode = 'development', authToken, allowedOrigins = [] } = {}) {
  if (!['desktop', 'development'].includes(mode)) throw new TypeError('Unknown local service access mode.');
  if (mode === 'desktop' && (typeof authToken !== 'string' || !/^[a-f0-9]{64}$/i.test(authToken))) {
    throw new TypeError('Desktop mode requires a 256-bit hexadecimal startup token.');
  }
  if (!Array.isArray(allowedOrigins) || allowedOrigins.some(origin => !exactOrigin(origin))) {
    throw new TypeError('Development origins must be exact loopback HTTP origins.');
  }
  if (mode === 'desktop' && allowedOrigins.length) throw new TypeError('Desktop mode does not allow development origins.');
  const origins = new Set(allowedOrigins);
  const expected = mode === 'desktop' ? Buffer.from(`Bearer ${authToken}`, 'utf8') : null;
  const sessionId = randomUUID();

  function check(req, { port = req.socket?.localPort, pathname } = {}) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AccessControlError(503, '本地服务尚未就绪。');
    const host = req.headers.host;
    const allowedHosts = mode === 'desktop' ? [`127.0.0.1:${port}`]
      : [...LOOPBACK_HOSTS].map(name => `${name}:${port}`);
    if (typeof host !== 'string' || !allowedHosts.includes(host.toLowerCase())) {
      throw new AccessControlError(403, '仅允许通过当前本机服务地址访问。');
    }
    const origin = req.headers.origin;
    const sameOrigin = `http://${host.toLowerCase()}`;
    if (origin !== undefined && (!exactOrigin(origin) || (origin !== sameOrigin && !origins.has(origin)))) {
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
