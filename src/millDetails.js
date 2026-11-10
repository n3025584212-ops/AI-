import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 主线轧机（DKQKAR_5Stand_Web）的细节补充层：机架顶部检修平台与栏杆、
// 压下/弯辊液压缸、机架前侧液压管路与电缆桥架。
// 全部按材质合并，只增加 4~5 个 draw call；坐标系与 mill 一致：
// X = 带钢方向，+Z = 操作侧，机架中心 x=-10.4..10.4、顶面 y=6.2。
const STAND_X = [-10.4, -5.2, 0, 5.2, 10.4];
const TOP_Y = 6.2;

export function buildMillDetails(scene, { environment } = {}) {
  const root = new THREE.Group();
  root.name = 'Mill_Detail_Pass';
  root.userData.presentationOnly = true;

  const materials = new Map();
  const material = (name, color, { roughness = 0.5, metalness = 0.6 } = {}) => {
    if (!materials.has(name)) {
      const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness, envMap: environment || null, envMapIntensity: 0.5 });
      mat.name = name;
      materials.set(name, mat);
    }
    return materials.get(name);
  };
  const steel = material('Mill_Detail_Platform', '#3a4a54', { roughness: 0.62, metalness: 0.45 });
  const rail = material('Mill_Detail_Rail', '#c9a53a', { roughness: 0.42, metalness: 0.3 });
  const dark = material('Mill_Detail_Dark', '#16232b', { roughness: 0.55, metalness: 0.5 });
  const chrome = material('Mill_Detail_Chrome', '#b9c4c9', { roughness: 0.22, metalness: 0.9 });
  const pipe = material('Mill_Detail_Pipe', '#24404f', { roughness: 0.46, metalness: 0.5 });
  const tray = material('Mill_Detail_Tray', '#6b7a82', { roughness: 0.55, metalness: 0.5 });

  const buckets = new Map();
  const add = (mat, geometry) => {
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geometry);
  };
  const box = (mat, { x, y, z, w, h, d }) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.translate(x, y, z);
    add(mat, geometry);
  };
  const cyl = (mat, { x, y, z, r, h, axis = 'y', segments = 12 }) => {
    const geometry = new THREE.CylinderGeometry(r, r, h, segments, 1, false);
    if (axis === 'x') geometry.rotateZ(Math.PI / 2);
    else if (axis === 'z') geometry.rotateX(Math.PI / 2);
    geometry.translate(x, y, z);
    add(mat, geometry);
  };

  const X0 = STAND_X[0] - 2.6, X1 = STAND_X[STAND_X.length - 1] + 2.6;
  // 顶部悬空平台/栏杆已删除：没有真实支撑结构，看起来就是一圈浮空护栏。

  // ---- 每个机架：两台压下液压缸 + 弯辊缸 + 顶部阀台 ----
  for (const x of STAND_X) {
    cyl(dark, { x: x - 1.1, y: TOP_Y + 0.55, z: -2.6, r: 0.3, h: 0.9 });
    cyl(chrome, { x: x - 1.1, y: TOP_Y + 1.12, z: -2.6, r: 0.14, h: 0.42 });
    cyl(dark, { x: x + 1.1, y: TOP_Y + 0.55, z: -2.6, r: 0.3, h: 0.9 });
    cyl(chrome, { x: x + 1.1, y: TOP_Y + 1.12, z: -2.6, r: 0.14, h: 0.42 });
    box(dark, { x, y: TOP_Y + 0.42, z: 0.5, w: 1.1, h: 0.55, d: 0.9 });
  }

  // ---- 操作侧液压管路：贴地布置（y≈1.4），不要横穿机架立面 ----
  for (const y of [1.32, 1.74]) {
    cyl(pipe, { x: (X0 + X1) / 2, y, z: 2.45, r: 0.085, h: X1 - X0, axis: 'x', segments: 10 });
  }
  for (const x of STAND_X) {
    // 支管从主管向上接到机架下部
    cyl(pipe, { x, y: 2.35, z: 2.45, r: 0.055, h: 1.4, segments: 8 });
    cyl(pipe, { x: x + 1.7, y: 2.1, z: 2.45, r: 0.045, h: 1.0, segments: 8 });
  }
  // 管架立柱与托臂：把主管落到地面
  for (let x = X0 + 1.3; x <= X1 - 1; x += 2.6) {
    box(steel, { x, y: 0.95, z: 2.55, w: 0.09, h: 1.9, d: 0.09 });
    box(steel, { x, y: 1.53, z: 2.5, w: 0.06, h: 0.05, d: 0.38 });
  }
  // 两端下弯进液压泵站
  for (const x of [X0 - 0.3, X1 + 0.3]) {
    cyl(pipe, { x, y: 0.95, z: 2.45, r: 0.085, h: 1.6, segments: 10 });
    box(dark, { x, y: 0.32, z: 2.45, w: 1.0, h: 0.64, d: 1.0 });
  }
  // ---- 操作侧电缆桥架（贴机架立面，短托臂连接）----
  box(tray, { x: (X0 + X1) / 2, y: 3.25, z: 2.5, w: X1 - X0, h: 0.12, d: 0.4 });
  for (let x = X0 + 1; x <= X1 - 0.5; x += 2.6) {
    box(tray, { x, y: 3.22, z: 2.28, w: 0.06, h: 0.06, d: 0.5 });
  }

  // ---- 机架之间的连接段：机列基础 + 辊道 + 侧导 ----
  // 原模型五个机架是五块独立断面，中间只有带钢悬空通过。补上连续基础和
  // 机架间辊道/侧导，让五机架读成一条轧线，而不是五个孤立的盒子。
  const concrete = material('Mill_Detail_Concrete', '#2c353b', { roughness: 0.88, metalness: 0.06 });
  box(concrete, { x: 1.0, y: 0.05, z: 0, w: 48, h: 0.1, d: 6.4 });
  const STRIP_Y = 3.0;
  for (const gx of [-7.8, -2.6, 2.6, 7.8]) {
    // 机架之间的机身：把 1.4m 的空档从地面填到带钢高度，外立面与牌坊齐平
    // （z ±1.8），否则从操作侧看还是五个独立的盒子。
    box(dark, { x: gx, y: 1.15, z: 0, w: 1.35, h: 2.3, d: 3.55 });
    box(steel, { x: gx, y: 2.5, z: 0, w: 1.35, h: 0.3, d: 3.6 });
    for (const z of [-1.8, 1.8]) {
      box(steel, { x: gx, y: 1.45, z, w: 1.35, h: 2.9, d: 0.12 });
      box(steel, { x: gx, y: STRIP_Y - 0.22, z, w: 1.35, h: 0.16, d: 0.18 });
    }
    for (const dx of [-0.34, 0.34]) {
      cyl(chrome, { x: gx + dx, y: STRIP_Y - 0.22, z: 0, r: 0.14, h: 2.7, axis: 'z', segments: 14 });
    }
    for (const z of [-0.95, 0.95]) {
      box(rail, { x: gx, y: STRIP_Y, z, w: 1.35, h: 0.2, d: 0.08 });
    }
    // 相邻机架顶部之间的联系梁：把五机架在顶部也连成一列
    box(steel, { x: gx, y: 5.82, z: 0, w: 1.35, h: 0.5, d: 1.9 });
  }

  // ---- 带钢引出段：把机架里的带钢连到入口开卷/出口卷取，别在机架边悬空断掉 ----
  box(chrome, { x: -18.02, y: STRIP_Y, z: 0, w: 5.0, h: 0.035, d: 1.5 });
  box(chrome, { x: 18.06, y: STRIP_Y, z: 0, w: 5.0, h: 0.035, d: 1.5 });

  for (const [mat, geometries] of buckets) {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = `MillDetail_${mat.name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  scene.add(root);

  return {
    root,
    dispose() {
      scene.remove(root);
      root.traverse((object) => { if (object.isMesh) object.geometry.dispose(); });
      materials.forEach((mat) => mat.dispose());
    },
  };
}
