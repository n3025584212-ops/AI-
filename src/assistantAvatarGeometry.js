export const AVATAR_SIZE = Object.freeze({ width: 112, height: 140 });
export const AVATAR_STORAGE = 'qcdkr.assistant-avatar.v1';
export function clampAvatar(point, viewport, size = AVATAR_SIZE) {
  const maxX = Math.max(0, viewport.width - size.width), maxY = Math.max(0, viewport.height - size.height);
  return { x: Math.min(maxX, Math.max(0, Number.isFinite(point?.x) ? point.x : 0)),
    y: Math.min(maxY, Math.max(0, Number.isFinite(point?.y) ? point.y : maxY - 12)) };
}
export function defaultAvatarPosition(viewport) { return clampAvatar({ x: 0, y: viewport.height - AVATAR_SIZE.height - 14 }, viewport); }
export function restoreAvatar(raw, viewport) {
  try { const value = JSON.parse(raw); return { ...clampAvatar(value?.position || defaultAvatarPosition(viewport), viewport), model: 'whale' }; }
  catch { return { ...defaultAvatarPosition(viewport), model: 'engineer' }; }
}
export function moveAvatar(start, delta, viewport) { return clampAvatar({ x: start.x + delta.x, y: start.y + delta.y }, viewport); }
export function dockAvatar(point, viewport) {
  const next = clampAvatar(point, viewport), edge = Math.max(0, viewport.width - AVATAR_SIZE.width);
  if (next.x < 24) next.x = 0;
  else if (edge - next.x < 24) next.x = edge;
  return next;
}
export function isAvatarDrag(delta) { return Math.hypot(delta.x, delta.y) >= 7; }
