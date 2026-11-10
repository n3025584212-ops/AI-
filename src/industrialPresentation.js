// Shared scene lighting and framing. Never derive prediction inputs here.
export const INDUSTRIAL_LIGHTING = Object.freeze({
  workshop: Object.freeze({ exposure: 1.10, environment: 0.64, key: 3.4, fill: 1.8, hemisphere: 0.44 }),
  inspection: Object.freeze({ exposure: 1.18, environment: 0.74, key: 3.7, fill: 2.4, hemisphere: 0.68 }),
});

export function industrialLighting(mode) {
  return INDUSTRIAL_LIGHTING[mode] || INDUSTRIAL_LIGHTING.workshop;
}

export function industrialCameraDirection(view = 'perspective', scope = 'line') {
  if (view === 'hall') return scope === 's5' ? [0.78, 0.46, 1.5] : [1.05, 0.95, 2.5];
  if (view === 'front') return [0, 0.12, 1.6];
  if (view === 'top') return [0, 1.8, 0.001];
  if (view === 'drive') return [-0.65, 0.55, -1.3];
  // 整线视角抬到约 18° 俯角：既要看清五机架，也要让后方两条背景产线进画面，
  // 否则默认机位下"多线厂区"完全被主线自身挡住，看起来仍是一条线。
  // 默认整线视角改成正面俯视（x=0）：相机不再偏 15°，地坪在画面上是端端正正的一块。
  return scope === 'line' ? [0, 1.35, 2.25] : [0.78, 0.46, 1.5];
}
