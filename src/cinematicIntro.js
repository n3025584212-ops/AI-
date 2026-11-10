import * as THREE from 'three';

// 对标景区数字孪生片头的进场运镜：高空俯瞰 → 穿云下降 → 掠过厂房顶
// → 弧线落到整线默认机位。任何指针/滚轮/键盘输入立即中断并交还控制权；
// 结束后由宿主开启缓慢自动漫游。参照：黄山景区数字孪生片开场。

const smoother = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10));

export function playCinematicIntro({
  camera, controls,
  center = new THREE.Vector3(0, 2.5, 0),
  endPosition, endTarget,
  duration = 9500,
  onDone, onInterrupt,
}) {
  // 航路点相对厂区中心：高空远拍 → 云带高度 → 贴厂房屋顶 → 默认机位。
  const start = center.clone().add(new THREE.Vector3(22, 112, 82));
  const throughClouds = center.clone().add(new THREE.Vector3(30, 58, 34));
  const skimRoof = center.clone().add(new THREE.Vector3(20, 15.5, -4));
  const curve = new THREE.CatmullRomCurve3(
    [start, throughClouds, skimRoof, endPosition.clone()],
    false, 'centripetal', 0.6,
  );
  const lookFrom = center.clone();
  const lookTo = endTarget.clone();

  const dom = controls?.domElement || null;
  let t0 = 0, done = false, raf = 0;

  function finish(kind) {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    dom?.removeEventListener('pointerdown', onUser, true);
    dom?.removeEventListener('wheel', onUser, { capture: true });
    window.removeEventListener('keydown', onKey, true);
    if (controls) controls.enabled = true;
    if (kind === 'done') {
      camera.position.copy(endPosition);
      camera.lookAt(endTarget);
      onDone?.();
    } else {
      onInterrupt?.();
    }
  }
  const onUser = () => finish('interrupt');
  const onKey = () => finish('interrupt');

  function tick(now) {
    if (done) return;
    if (!t0) t0 = now;
    const t = Math.min(1, (now - t0) / duration);
    camera.position.copy(curve.getPointAt(smoother(t)));
    // 前半段看厂区中心，最后 45% 平滑转到默认机位的目标点。
    const lookBlend = smoother(Math.min(1, Math.max(0, (t - 0.55) / 0.45)));
    camera.lookAt(lookFrom.clone().lerp(lookTo, lookBlend));
    if (t >= 1) { finish('done'); return; }
    raf = requestAnimationFrame(tick);
  }

  if (controls) controls.enabled = false;
  dom?.addEventListener('pointerdown', onUser, true);
  dom?.addEventListener('wheel', onUser, { capture: true, passive: true });
  window.addEventListener('keydown', onKey, true);
  raf = requestAnimationFrame(tick);

  return { cancel: () => finish('interrupt') };
}
