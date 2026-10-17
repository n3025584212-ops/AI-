// Visual transport scale, deliberately separate from physical process units.
// The source dataset's speed values are retained without assigning an RPM/unit.
export const VISUAL_SPEED_REFERENCE = 785;
export const VISUAL_METRES_PER_SECOND = 1.45;

export function visualTransportStep(elapsedSeconds, processSpeed, playing = true) {
  const speed = Number(processSpeed);
  if (!playing || !Number.isFinite(speed) || speed <= 0) return 0;
  return Math.min(Math.max(Number(elapsedSeconds) || 0, 0), 0.1)
    * speed / VISUAL_SPEED_REFERENCE * VISUAL_METRES_PER_SECOND;
}

export function rollRotationStep(distance, radius, name) {
  // Work and backup rolls turn together; the contacting intermediate reverses.
  // At each work-roll nip, both surfaces travel along +X with the strip.
  const side = /_Top/.test(name) ? 1 : -1;
  const tier = /IntermediateRoll/.test(name) ? -1 : 1;
  return distance / Math.max(radius, 0.001) * side * tier;
}

// The work-roll bodies keep their original GLB names and axis positions. A
// process annotation belongs at their physical nip, independent of camera angle
// and of the rotation of the cylindrically symmetric bodies.
export function workRollNipPosition(top, bottom, stripEdgeZ = Infinity) {
  return [
    (top.position[0] + bottom.position[0]) / 2,
    (top.position[1] - top.radius + bottom.position[1] + bottom.radius) / 2,
    Math.min(top.frontZ, bottom.frontZ, stripEdgeZ),
  ];
}

export function normalizedScreenPoint({ x, y, z }, visible = true) {
  return { x: (x + 1) / 2, y: (1 - y) / 2,
    visible: visible && [x, y, z].every(Number.isFinite) && z >= -1 && z <= 1 && Math.abs(x) <= 1 && Math.abs(y) <= 1 };
}

export function annotationViewport(width, height, insets = {}) {
  const sizeX = Math.max(1, width), sizeY = Math.max(1, height);
  const pixels = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  let left = pixels(insets.left), right = pixels(insets.right), top = pixels(insets.top), bottom = pixels(insets.bottom);
  // A transient tiny layout must still yield a finite projection matrix.
  const scaleX = Math.min(1, (sizeX - 1) / Math.max(1, left + right));
  const scaleY = Math.min(1, (sizeY - 1) / Math.max(1, top + bottom));
  left *= scaleX; right *= scaleX; top *= scaleY; bottom *= scaleY;
  return { left, right, top, bottom, width: sizeX - left - right, height: sizeY - top - bottom,
    fractionX: (sizeX - left - right) / sizeX, fractionY: (sizeY - top - bottom) / sizeY,
    offsetX: (right - left) / 2, offsetY: (bottom - top) / 2 };
}

export function classifyModelMesh(mesh) {
  let object = mesh, stand = null, rollName = null;
  while (object) {
    stand ||= object.name?.match(/\b(S[1-5])_/i)?.[1]?.toUpperCase();
    // A bearing, chock or keeper named after a roll is stationary. Only the
    // exact body (or a primitive below that named body) gets an animated pivot.
    if (/^S[1-5]_(?:WorkRoll|IntermediateRoll|BackupRoll)_(?:Top|Bottom)$/i.test(object.name || '')) rollName = object.name;
    object = object.parent;
  }
  const name = mesh.name || '';
  const part = /Steel_Strip/i.test(name) ? 'strip'
    : rollName ? (/_Top/.test(rollName) ? 'rollsTop' : 'rollsBottom')
      : /Motor|Gearbox|DriveShaft|Spindle|Coupling|DriveBed/i.test(name) ? 'drive'
        : /Frame|Cover|Hood|Enclosure|Column|Crown|Panel|Foundation/i.test(name) ? 'housing'
          : /^S[1-5]_(?:StandID|TypePlate)$/i.test(name) ? 'housing'
            : /DetailTag|FlowLabel|StandID|TypePlate/i.test(name) ? 'label' : 'fixed';
  return { stand: stand || 'line', part, rollName };
}

export function isRollingCore(part) {
  return part === 'strip' || part === 'rollsTop' || part === 'rollsBottom';
}

export function isProcessGroupVisible({ stand, part }, { focusMode, shellMode, showStrip }) {
  if (part === 'label') return false;
  if (part === 'strip') return Boolean(showStrip);
  if (focusMode === 's5' && stand !== 'S5') return false;
  return shellMode !== 'hidden' || isRollingCore(part);
}

// Coordinates are projected onto camera right/up/backward axes. Fit all parts
// within the available central viewport, then center their perspective bounds.
export function fitProjectedBounds(points, slopeX, slopeY, near = 0.2) {
  let left = -Infinity, right = Infinity, bottom = -Infinity, top = Infinity;
  let nearest = -Infinity, farthest = Infinity;
  for (const [x, y, z] of points) {
    left = Math.max(left, x + slopeX * z); right = Math.min(right, x - slopeX * z);
    bottom = Math.max(bottom, y + slopeY * z); top = Math.min(top, y - slopeY * z);
    nearest = Math.max(nearest, z); farthest = Math.min(farthest, z);
  }
  const depth = Math.max((left - right) / (2 * slopeX), (bottom - top) / (2 * slopeY), nearest + near + 1);
  const centerAxis = (axis) => {
    let low = Math.min(...points.map((point) => point[axis])), high = Math.max(...points.map((point) => point[axis]));
    for (let iteration = 0; iteration < 36; iteration++) {
      const value = (low + high) / 2;
      let projectedLow = Infinity, projectedHigh = -Infinity;
      for (const point of points) {
        const coordinate = (point[axis] - value) / (depth - point[2]);
        projectedLow = Math.min(projectedLow, coordinate); projectedHigh = Math.max(projectedHigh, coordinate);
      }
      if (projectedLow + projectedHigh > 0) low = value; else high = value;
    }
    return (low + high) / 2;
  };
  return { x: centerAxis(0), y: centerAxis(1), z: (nearest + farthest) / 2, depth };
}
