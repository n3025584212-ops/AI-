// 渲染超采样倍率：按显示器像素密度自适应，上限 1.5x。
// 旧版固定 2.5x、与 devicePixelRatio 无关：DPR=1 的 1280×720 窗口按
// 3040×1675 渲染（5.1MP），1707×1067 窗口按 4268×2668 渲染（11.4MP），
// 再叠加 4x MSAA、SSAO 与泛光，机械件多的场景在独显上也会掉帧。
// 1.5x 足以压掉机械轮廓的 1px 细边（MSAA 已覆盖大部分锯齿），又不会
// 把采样预算花在显示器根本显示不出来的像素上。
export const MAX_INDUSTRIAL_PIXEL_RATIO = 1.5;

export function industrialPixelRatio() {
  const dpr = Number(globalThis.devicePixelRatio) || 1;
  return Math.max(1, Math.min(dpr, MAX_INDUSTRIAL_PIXEL_RATIO));
}

export const INDUSTRIAL_PIXEL_RATIO = industrialPixelRatio();
