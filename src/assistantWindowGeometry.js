export const ASSISTANT_WINDOW_STORAGE = 'dkqkar-ai-floating-window-v2';
export const MIN_WINDOW = Object.freeze({ width: 320, height: 340 });
export const WINDOW_MODES = Object.freeze(['normal', 'minimized', 'maximized']);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));

export function viewportBounds(viewport = {}) {
  const width = finite(viewport.width) && viewport.width > 0 ? viewport.width : 1280;
  const height = finite(viewport.height) && viewport.height > 0 ? viewport.height : 800;
  const x = finite(viewport.left) ? viewport.left : 0;
  const y = finite(viewport.top) ? viewport.top : 0;
  const margin = Math.min(12, width / 20, height / 20);
  return { left: x + margin, top: y + margin, right: x + width - margin,
    bottom: y + height - margin, width: width - 2 * margin, height: height - 2 * margin };
}

export function clampWindowRect(rect = {}, viewport = {}) {
  const bounds = viewportBounds(viewport);
  const width = clamp(finite(rect.width) ? rect.width : 400, Math.min(MIN_WINDOW.width, bounds.width), bounds.width);
  const height = clamp(finite(rect.height) ? rect.height : 420, Math.min(MIN_WINDOW.height, bounds.height), bounds.height);
  return { x: clamp(finite(rect.x) ? rect.x : bounds.right - width - 20, bounds.left, bounds.right - width),
    y: clamp(finite(rect.y) ? rect.y : bounds.bottom - height - 64, bounds.top, bounds.bottom - height),
    width, height };
}

export function defaultWindowRect(viewport) {
  return clampWindowRect({ width: 400, height: 420 }, viewport);
}

export function maximizedWindowRect(viewport) {
  const bounds = viewportBounds(viewport);
  return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
}

export function minimizedWindowRect(position = {}, viewport) {
  const bounds = viewportBounds(viewport);
  const width = Math.min(280, bounds.width), height = Math.min(44, bounds.height);
  return { x: clamp(finite(position.x) ? position.x : bounds.right - width - 72, bounds.left, bounds.right - width),
    y: clamp(finite(position.y) ? position.y : bounds.bottom - height - 4, bounds.top, bounds.bottom - height),
    width, height };
}

export function moveWindowRect(rect, dx, dy, viewport, compact = false) {
  const base = compact ? minimizedWindowRect(rect, viewport) : clampWindowRect(rect, viewport);
  const next = { ...base, x: base.x + (finite(dx) ? dx : 0), y: base.y + (finite(dy) ? dy : 0) };
  return compact ? minimizedWindowRect(next, viewport) : clampWindowRect(next, viewport);
}

export function resizeWindowRect(rect, direction, dx, dy, viewport) {
  const base = clampWindowRect(rect, viewport), bounds = viewportBounds(viewport);
  if (!['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].includes(direction)) return base;
  const deltaX = finite(dx) ? dx : 0, deltaY = finite(dy) ? dy : 0;
  const minWidth = Math.min(MIN_WINDOW.width, bounds.width), minHeight = Math.min(MIN_WINDOW.height, bounds.height);
  let left = base.x, top = base.y, right = base.x + base.width, bottom = base.y + base.height;
  if (direction.includes('w')) left = clamp(left + deltaX, bounds.left, right - minWidth);
  if (direction.includes('e')) right = clamp(right + deltaX, left + minWidth, bounds.right);
  if (direction.includes('n')) top = clamp(top + deltaY, bounds.top, bottom - minHeight);
  if (direction.includes('s')) bottom = clamp(bottom + deltaY, top + minHeight, bounds.bottom);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function keyboardWindowDelta(key, shift = false) {
  const step = shift ? 40 : 10;
  return ({ ArrowLeft: { dx: -step, dy: 0 }, ArrowRight: { dx: step, dy: 0 },
    ArrowUp: { dx: 0, dy: -step }, ArrowDown: { dx: 0, dy: step } })[key] || null;
}

export function defaultWindowState(viewport, sessionId = null) {
  return { sessionId, rect: defaultWindowRect(viewport), minimizedPosition: minimizedWindowRect({}, viewport),
    mode: 'normal', open: false };
}

export function restoreWindowState(serialized, sessionId, viewport) {
  const fallback = defaultWindowState(viewport, sessionId);
  if (!sessionId || typeof serialized !== 'string') return fallback;
  try {
    const stored = JSON.parse(serialized);
    if (!stored || stored.app_session_id !== sessionId || !stored.rect || typeof stored.rect !== 'object') return fallback;
    return { sessionId, rect: clampWindowRect(stored.rect, viewport),
      minimizedPosition: minimizedWindowRect(stored.minimizedPosition || {}, viewport),
      mode: WINDOW_MODES.includes(stored.mode) ? stored.mode : 'normal', open: stored.open === true };
  } catch { return fallback; }
}