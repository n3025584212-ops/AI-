// 浏览器设备指纹：仅用于账号首次登录后的“同一浏览器”绑定，不是密码学身份认证。
// 云端是裸 IP HTTP（非安全上下文），crypto.subtle 不可用，因此统一走纯 JS SHA-256。
import { sha256HexSync } from './sha256.js';

function canvasSignature() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-canvas';
    ctx.textBaseline = 'top';
    ctx.font = '14px "Arial"';
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 240, 60);
    ctx.fillStyle = '#069';
    ctx.fillText('QCDKR·冷轧·fingerprint', 4, 8);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('QCDKR·冷轧·fingerprint', 6, 22);
    return canvas.toDataURL().slice(-160);
  } catch {
    return 'canvas-error';
  }
}

function webglSignature() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return 'no-webgl';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return [
      gl.getParameter(gl.VENDOR),
      gl.getParameter(gl.RENDERER),
      debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : '',
      debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : '',
    ].map(value => String(value ?? '')).join('~');
  } catch {
    return 'webgl-error';
  }
}

export function browserFingerprint() {
  const nav = globalThis.navigator || {};
  const screenInfo = globalThis.screen || {};
  let timezone = '';
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
  // 只取在同一浏览器/同一设备上稳定的信号；不写入时间戳或随机数。
  const signals = [
    nav.userAgent, nav.language, (nav.languages || []).join(','), nav.platform,
    nav.hardwareConcurrency, nav.deviceMemory,
    screenInfo.width, screenInfo.height, screenInfo.colorDepth, screenInfo.pixelDepth,
    timezone, canvasSignature(), webglSignature(),
  ];
  return sha256HexSync(signals.map(value => String(value ?? '')).join('|'));
}
