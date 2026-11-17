export const ASSISTANT_WINDOW_STORAGE = 'dkqkar-ai-floating-window-v2';
export const MIN_WINDOW = Object.freeze({ width: 320, height: 420 });
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
  const height = clamp(finite(rect.height) ? rect.height : 600, Math.min(MIN_WINDOW.height, bounds.height), bounds.height);
  return { x: clamp(finite(rect.x) ? rect.x : bounds.right - width - 20, bounds.left, bounds.right - width),
    y: clamp(finite(rect.y) ? rect.y : bounds.bottom - height - 64, bounds.top, bounds.bottom - height),
    width, height };
}

export function defaultWindowRect(viewport) {
  // 默认靠右上，避开右下角“当前关键参数”和左下角预测曲线（2026-11-16 演示观感修正）。
  const bounds = viewportBounds(viewport);
  const width = Math.min(400, bounds.width);
  const height = Math.min(600, Math.max(MIN_WINDOW.height, Math.round(bounds.height * 0.55)));
  return clampWindowRect({
    x: bounds.right - width - 20,
    y: bounds.top + Math.round(bounds.height * 0.08),
    width,
    height,
  }, viewport);
}

export function maximizedWindowRect(viewport) {
  const bounds = viewportBounds(viewport);
  return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
}

// 桌宠气泡：对话框挂在桌宠周围，四个方向找空间——上 → 下 → 右 → 左。
// 尺寸固定（不再为了塞进空隙压高度），四个方向都放不下时选溢出最小的那个，
// 并允许压住桌宠的一部分。tailX / tailY 是气泡指向桌宠的箭头位置。
export const PET_ANCHOR_GAP = 10;
export function petAnchoredWindowRect(pet, size, viewport) {
  const bounds = viewportBounds(viewport);
  const petWidth = finite(pet?.width) ? pet.width : 112;
  const petHeight = finite(pet?.height) ? pet.height : 140;
  const petX = finite(pet?.x) ? pet.x : bounds.left;
  const petY = finite(pet?.y) ? pet.y : bounds.bottom - petHeight;
  const width = clamp(finite(size?.width) ? size.width : 400, Math.min(MIN_WINDOW.width, bounds.width), bounds.width);
  const wantHeight = finite(size?.height) ? size.height : Math.min(600, Math.round(viewport?.height * 0.55) || 480);
  const height = clamp(wantHeight, Math.min(MIN_WINDOW.height, bounds.height), bounds.height);
  const centerX = petX + petWidth / 2;
  const centerY = petY + petHeight / 2;
  const clampX = value => clamp(value, bounds.left, bounds.right - width);
  const clampY = value => clamp(value, bounds.top, bounds.bottom - height);
  const spots = [
    { side: 'above', x: clampX(centerX - width / 2), y: petY - PET_ANCHOR_GAP - height,
      overflow: Math.max(0, bounds.top - (petY - PET_ANCHOR_GAP - height)) },
    { side: 'below', x: clampX(centerX - width / 2), y: petY + petHeight + PET_ANCHOR_GAP,
      overflow: Math.max(0, petY + petHeight + PET_ANCHOR_GAP + height - bounds.bottom) },
    { side: 'right', x: petX + petWidth + PET_ANCHOR_GAP, y: clampY(centerY - height / 2),
      overflow: Math.max(0, petX + petWidth + PET_ANCHOR_GAP + width - bounds.right) },
    { side: 'left', x: petX - PET_ANCHOR_GAP - width, y: clampY(centerY - height / 2),
      overflow: Math.max(0, bounds.left - (petX - PET_ANCHOR_GAP - width)) },
  ];
  const spot = spots.find(item => item.overflow === 0) || spots.reduce((best, item) => item.overflow < best.overflow ? item : best, spots[0]);
  const x = clampX(spot.x), y = clampY(spot.y);
  const vertical = spot.side === 'above' || spot.side === 'below';
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), side: spot.side,
    tailX: Math.round(clamp(centerX - x, 24, width - 24)), tailY: Math.round(clamp(centerY - y, 24, height - 24)) };
}

export function petAnchoredMinimizedRect(pet, viewport) {
  const bounds = viewportBounds(viewport);
  const width = Math.min(280, bounds.width), height = Math.min(44, bounds.height);
  const petWidth = finite(pet?.width) ? pet.width : 112;
  const petHeight = finite(pet?.height) ? pet.height : 140;
  const petX = finite(pet?.x) ? pet.x : bounds.left;
  const petY = finite(pet?.y) ? pet.y : bounds.bottom - petHeight;
  const above = petY - PET_ANCHOR_GAP - height >= bounds.top;
  const x = clamp(petX + petWidth / 2 - width / 2, bounds.left, bounds.right - width);
  return { x: Math.round(x), y: Math.round(above ? petY - PET_ANCHOR_GAP - height : petY + petHeight + PET_ANCHOR_GAP),
    width, height, side: above ? 'above' : 'below', tailX: Math.round(clamp(petX + petWidth / 2 - x, 24, width - 24)) };
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