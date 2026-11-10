import * as THREE from 'three';
import { prepareIndustrialMaterials } from './industrialMaterials.js';
const AISLE_Z = 6.9;
const FLOOR_Y = 0;

// 产线延伸与厂房设施（调研依据：SMS group 冷连轧机组组成）：
//   入口区：步进梁/鞍座上卷、开卷机、剪切对焊机
//   出口段：圆盘剪、张力卷取机、打捆机、步进梁钢卷库
//   辅助：主电室（传动侧）、磨辊间、乳化液站、操作台、中控室
// 材质全部按正式版材质库名称命名，再统一走 prepareIndustrialMaterials 精修。
export function buildFixtures(scene, standAnchors, environment) {
  const root = new THREE.Group();
  root.name = 'Line_Extensions_And_Facilities';
  root.userData.presentationOnly = true;
  scene.add(root);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 28);
  const materials = [];
  const mat = (name, color, roughness = .5, metalness = .3, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, envMap: environment, envMapIntensity: .55, ...extra });
    m.name = name; materials.push(m); return m;
  };
  const structure = mat('Frame_Cast', '#344550', .48, .62);
  const dark = mat('Black_Oxide', '#18242c', .48, .55);
  const enamel = mat('Blue_Cast', '#1b4a65', .34, .025);
  const zinc = mat('Bolt_Zinc', '#8e9ba1', .29, .90);
  const pipe = mat('Pipe_Steel', '#64717a', .34, .88);
  const yellow = mat('Safety_Yellow', '#e3aa27', .35, .12);
  const rubber = mat('Rubber', '#0d1316', .9, 0);
  const cabinet = mat('Cabinet_Grey', '#71848e', .48, .15);
  const motor = mat('Motor_Grey', '#344e60', .47, .3);
  const concrete = mat('Concrete', '#4a5560', .92, .02);
  const screen = (() => {
    // HMI pattern: a dark panel with a cyan header and bars, so the pulpit screens read as live HMIs.
    let hmiTex = null;
    if (typeof document !== 'undefined') {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#06141c'; ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = '#176a86'; ctx.fillRect(0, 0, 256, 18);
      ctx.fillStyle = '#dff6ff'; ctx.font = '600 12px "Microsoft YaHei", sans-serif';
      ctx.fillText('QCDKR · OPERATOR HMI', 8, 13);
      ctx.strokeStyle = '#2ea6d8'; ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const y = 36 + i * 20;
        ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(28 + (i % 3) * 18, y); ctx.stroke();
      }
      ctx.fillStyle = '#2ea6d8';
      for (let i = 0; i < 5; i++) ctx.fillRect(144 + i * 18, 100 - i * 12, 12, 8 + i * 12);
      ctx.fillStyle = '#ffc857'; ctx.beginPath(); ctx.arc(238, 28, 4, 0, Math.PI * 2); ctx.fill();
      hmiTex = new THREE.CanvasTexture(cv); hmiTex.colorSpace = THREE.SRGBColorSpace;
    }
    return mat('Cabinet_Screen', '#06141c', .4, .1, hmiTex
      ? { emissive: '#ffffff', emissiveIntensity: 1.05, emissiveMap: hmiTex }
      : { emissive: '#2ea6d8', emissiveIntensity: 0.9 });
  })();
  const green = mat('Lamp_Green', '#266b58', .26, .1, { emissive: '#36a477', emissiveIntensity: .6 });

  function box(mat2, p, s, cast = true) {
    const m = new THREE.Mesh(boxGeo, mat2);
    m.position.set(...p); m.scale.set(...s);
    m.castShadow = cast; m.receiveShadow = true;
    root.add(m); return m;
  }
  function cyl(mat2, p, r, h, axis = 'y', cast = true) {
    const m = new THREE.Mesh(cylGeo, mat2);
    m.position.set(...p);
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    m.scale.set(r, h, r);
    m.castShadow = cast; m.receiveShadow = true;
    root.add(m); return m;
  }
  function sign(name, text, p, width, height, { floor = false, wall = false } = {}) {
    const m = new THREE.MeshStandardMaterial({
      color: '#d4c08b', roughness: .78, metalness: 0, side: THREE.DoubleSide,
      transparent: floor, depthWrite: !floor, polygonOffset: true, polygonOffsetFactor: -1
    });
    m.name = name + '_Ink';
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 192;
    const ctx = canvas.getContext('2d');
    if (!floor && !wall) { ctx.fillStyle = '#182a35'; ctx.fillRect(0, 0, 1024, 192); }
    ctx.fillStyle = floor ? '#bdad7b' : (wall ? '#8fa8b5' : '#e4e3d9');
    ctx.font = '600 96px "Microsoft YaHei", "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, 100, 950);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    m.map = tex; m.color.set('#ffffff'); materials.push(m);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), m);
    mesh.name = name; mesh.userData.label = text;
    mesh.position.set(...p);
    if (floor) { mesh.rotation.x = -Math.PI / 2; }
    root.add(mesh); return mesh;
  }
  // ============ 入口区（x < -15）============
  const entryZ = 3.0; // 产线中心线（轧机辊线高度所在 z）
  // 钢卷步进梁运输 + 鞍座上卷（3 卷备料）
  for (const x of [-29, -26.4, -23.8]) {
    // 鞍座由 Blender coil_car.glb 提供，程序化部分只保留步进梁滚轮。
    cyl(zinc, [x - .8, .48, entryZ - 1.9], .07, 2.0, 'x');
    cyl(zinc, [x + .8, .48, entryZ + 1.9], .07, 2.0, 'x');
  }
  box(structure, [-26.4, .06, entryZ - 4.6], [16, .1, .5]); // 步进梁固定梁
  box(structure, [-26.4, .3, entryZ - 4.2], [15.2, .16, .34]);
  // 开卷机 / 剪切对焊机由 Blender 资产套件提供（assetFixtures.js）
  sign('Entry_Section_Sign', '入口段', [-24, 5.1, entryZ - 2.6], 3.6, .72);
  // Sign gantry: the entry/exit plates were previously floating in mid-air.
  for (const x of [-26.2, -21.8]) {
    cyl(pipe, [x, 2.9, entryZ - 2.72], .08, 5.8, 'y');
    box(dark, [x, .06, entryZ - 2.72], [.56, .12, .56]);
  }
  box(dark, [-24, 5.1, entryZ - 2.57], [3.78, .86, .04]);
  box(pipe, [-24, 5.72, entryZ - 2.72], [4.8, .09, .09]);

  // ============ 出口段（x > 15）============
  // 圆盘剪 / 张力卷取机 / 打捆机由 Blender 资产套件提供（assetFixtures.js）
  // 出口钢卷库的鞍座由 Blender coil_car.glb 提供。
  box(structure, [28.8, .08, entryZ - 3.8], [9, .1, .5]);
  sign('Exit_Section_Sign', '出口段', [24, 5.1, entryZ - 2.6], 3.6, .72);
  for (const x of [21.8, 26.2]) {
    cyl(pipe, [x, 2.9, entryZ - 2.72], .08, 5.8, 'y');
    box(dark, [x, .06, entryZ - 2.72], [.56, .12, .56]);
  }
  box(dark, [24, 5.1, entryZ - 2.57], [3.78, .86, .04]);
  box(pipe, [24, 5.72, entryZ - 2.72], [4.8, .09, .09]);

  // ============ 主电室 / 磨辊间建筑由 Blender 资产套件提供（assetFixtures.js）============
  const roomZ = -13.4;
  const grX = 28.5;
  // 备辊鞍座（门口待换辊）
  for (const dx of [-1.6, 1.6]) {
    box(dark, [grX + dx, .35, roomZ + 8.2], [2.4, .3, 1.6]);
    cyl(zinc, [grX + dx, 1.0, roomZ + 8.2], .38, 2.0, 'x');
  }

  // ============ 乳化液站由 Blender 资产套件提供（assetFixtures.js）============

  // ============ 操作台（程序化 fallback，Web 默认加载 Blender 资产）============
  // 每台操作台按“底座 + 柜体 + 斜控台 + 前窗 + 后检修门 + 顶部警示灯”搭建，
  // 从人行通道看得到检修门、铭牌、散热格栅和 HMI，而不是一个纯蓝方块。
  const pulpitGlass = mat('Pulpit_Glass', '#7fc4e8', .12, .05, { transparent: true, opacity: .28 });
  const emergencyRed = mat('Emergency_Red', '#8e1f1f', .42, .12, { emissive: '#b32626', emissiveIntensity: .55 });
  const pulpits = {};
  const pulpitLabel = (text) => {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0d1c25'; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#3fd8ff'; ctx.lineWidth = 4; ctx.strokeRect(4, 4, 504, 120);
    ctx.fillStyle = '#dfeaf2'; ctx.font = '600 62px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 68);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(
      new THREE.PlaneGeometry(.62, .15),
      new THREE.MeshStandardMaterial({ map: tex, roughness: .6, metalness: .05 })
    );
  };

  for (const [stand, a] of Object.entries(standAnchors)) {
    const p = new THREE.Group();
    p.name = `Pulpit_${stand}`;
    p.userData = { presentationOnly: true, stand };

    const add = (mat2, pos, size, rot = null) => {
      const m = new THREE.Mesh(boxGeo, mat2);
      m.position.set(...pos); m.scale.set(...size);
      if (rot) m.rotation.set(...rot);
      m.castShadow = true; m.receiveShadow = true;
      p.add(m); return m;
    };
    const tube = (mat2, pos, r, h, axis = 'y') => {
      const m = new THREE.Mesh(cylGeo, mat2);
      m.position.set(...pos);
      if (axis === 'z') m.rotation.x = Math.PI / 2;
      if (axis === 'x') m.rotation.z = Math.PI / 2;
      m.scale.set(r, h, r); m.castShadow = true; m.receiveShadow = true;
      p.add(m); return m;
    };

    // 底座、踢脚与地脚
    add(dark, [0, .30, 0], [2.22, .60, 1.92]);
    add(yellow, [0, .055, 0], [2.28, .11, 1.98]);
    for (const [x, z] of [[-.95, -.78], [.95, -.78], [-.95, .78], [.95, .78]]) {
      add(zinc, [x, .06, z], [.20, .08, .20]);
    }

    // 柜体 + 顶部檐口
    add(enamel, [0, 1.34, 0], [1.80, 1.68, 1.58]);
    add(cabinet, [0, 2.19, 0], [1.92, .12, 1.70]);
    add(dark, [0, 2.26, 0], [1.90, .035, 1.68]);
    for (const [x, z, sx, sz] of [[0, -.86, 1.96, .06], [0, .86, 1.96, .06], [-.98, 0, .06, 1.74], [.98, 0, .06, 1.74]])
      add(yellow, [x, 2.27, z], [sx, .04, sz]);
    add(dark, [0, 2.10, -.83], [1.86, .10, .12]); // 前檐遮光

    // 前窗 + 斜控台 + 双屏（面向轧机，-Z）
    add(dark, [0, 1.74, -.805], [1.60, .64, .05]);
    add(pulpitGlass, [0, 1.74, -.832], [1.50, .54, .02]);
    add(zinc, [0, 1.74, -.838], [.025, .54, .02]);
    add(dark, [0, 1.04, -.70], [1.66, .12, .56], [.30, 0, 0]);
    add(cabinet, [0, .86, -.62], [1.62, .36, .44], [.30, 0, 0]);
    for (const dx of [-.38, .38]) {
      add(dark, [dx, 1.17, -.79], [.58, .34, .05], [.30, 0, 0]);
      add(screen, [dx, 1.17, -.815], [.50, .27, .008], [.30, 0, 0]);
    }
    add(dark, [.58, 1.12, -.63], [.24, .05, .20], [.30, 0, 0]); // 操作键盘
    for (let i = 0; i < 4; i++) {
      add(i === 0 ? emergencyRed : i === 1 ? green : zinc,
        [.60 - i * .07, 1.16, -.52], [.045, .018, .045]);
    }
    add(dark, [.72, 1.13, -.68], [.05, .12, .05], [.30, 0, 0]); // 手柄

    // 后侧（人行通道可见）：检修门、门缝、把手、铰链、散热格栅、HMI、铭牌
    add(cabinet, [0, 1.27, .802], [.80, 1.52, .025]);
    add(dark, [0, 1.27, .818], [.015, 1.44, .006]);
    for (const y of [.60, 1.94]) add(dark, [0, y, .818], [.78, .015, .006]);
    add(zinc, [.29, 1.30, .835], [.045, .20, .035]);
    for (const y of [.85, 1.72]) add(zinc, [-.37, y, .828], [.06, .09, .02]);
    add(dark, [.46, 1.52, .822], [.20, .28, .012]);
    for (let y = 1.41; y <= 1.63; y += .045) add(zinc, [.46, y, .830], [.16, .012, .008]);
    add(dark, [0, 1.66, .822], [.66, .46, .04]);
    add(screen, [0, 1.65, .848], [.58, .38, .008]);
    add(emergencyRed, [-.52, 1.86, .835], [.09, .09, .04]);
    const name = pulpitLabel(`${stand} · 操作台`);
    name.position.set(0, 2.02, .820);
    p.add(name);

    // 侧面格栅 + 线缆桥架
    add(dark, [.907, 1.02, .16], [.012, .36, .46]);
    for (let z = -.02; z <= .34; z += .045) add(zinc, [.916, 1.02, z], [.008, .018, .40]);
    add(dark, [.82, .32, .64], [.10, .64, .10]);
    add(zinc, [.82, .02, .64], [.24, .04, .24]);

    // 顶部黄色警示灯
    add(dark, [.68, 2.20, .38], [.08, .06, .08]);
    add(green, [.68, 2.27, .38], [.055, .08, .055]);

    p.position.set(a.x, 0, AISLE_Z + 2.6);
    // 2026-11-01 用户要求移除操作台柱子（含顶部警示灯）；回滚：恢复下面两行
    // root.add(p);
    // pulpits[stand] = p;
  }
  // 中控室 / 换辊小车 / 工具柜由 Blender 资产套件提供（assetFixtures.js）

  // ============ 检修区完善（呼应 glb 自带 FLOW 地贴与检修区框线）============
  // 带钢流向地贴箭头：从 glb 自带 FLOW 标识（x=±14.8）延续，指向出口
  const chev = (x, z, rotY) => {
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(boxGeo, yellow);
      m.position.set(x + s * .12, FLOOR_Y + .005, z);
      m.scale.set(.5, .008, .09);
      m.rotation.y = rotY + s * .5;
      root.add(m);
    }
  };
  for (let i = 0; i < 4; i++) chev(15.6 + i * .9, .55, 0);
  sign('Strip_Flow_Label', '带钢流向', [17.6, FLOOR_Y - .015, .95], 2.0, .34, { floor: true });

  // 地面通道文字
  sign('Operator_Aisle_Prototype_Label', '人行通道  /  保持畅通', [0, FLOOR_Y - .02, AISLE_Z], 6.5, .5, { floor: true });

  prepareIndustrialMaterials(root, environment);
  return { group: root, pulpits };
}
