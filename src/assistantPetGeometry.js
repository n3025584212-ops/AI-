export const PET_SIZE = Object.freeze({ width: 88, height: 134 });
export const PET_STORAGE = 'qcdkr.assistant-pet.v1';
export function clampPet(point, viewport, size = PET_SIZE) {
  const maxX = Math.max(0, viewport.width - size.width), maxY = Math.max(0, viewport.height - size.height);
  return { x: Math.min(maxX, Math.max(0, Number.isFinite(point?.x) ? point.x : 0)),
    y: Math.min(maxY, Math.max(0, Number.isFinite(point?.y) ? point.y : maxY - 12)) };
}
export function defaultPetPosition(viewport) { return clampPet({ x: 0, y: viewport.height - PET_SIZE.height - 14 }, viewport); }
export function restorePet(raw, viewport) {
  try { const value = JSON.parse(raw); return { ...clampPet(value?.position || defaultPetPosition(viewport), viewport), model: value?.model === 'worker' ? 'worker' : 'engineer' }; }
  catch { return { ...defaultPetPosition(viewport), model: 'engineer' }; }
}
export function movePet(start, delta, viewport) { return clampPet({ x: start.x + delta.x, y: start.y + delta.y }, viewport); }
export function dockPet(point, viewport) {
  const next = clampPet(point, viewport), edge = Math.max(0, viewport.width - PET_SIZE.width);
  if (next.x < 24) next.x = 0;
  else if (edge - next.x < 24) next.x = edge;
  return next;
}
export function isPetDrag(delta) { return Math.hypot(delta.x, delta.y) >= 7; }
