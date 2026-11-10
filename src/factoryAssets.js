import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const AISLE_Z = 6.9;

// Blender 产线设备套件 → Web 实例化。
// 坐标与 fixtures.js 的原始站位一致；钢卷原点在卷心，其余资产原点在地面中心。
const NAMES = [
  'coil', 'coil_car', 'uncoiler', 'shear_welder', 'disc_shear', 'tension_reel',
  'bundler', 'control_room', 'emulsion_station', 'roll_cart', 'tool_cabinet',
  'main_drive_room', 'roll_shop'
];

// 模块级缓存：页面来回切换时只解析一次 GLB，实例仍按站位克隆。

const META = {
  coil: { label: '钢卷', page: 'data', desc: '入口备料与出口钢卷库' },
  coil_car: { label: '钢卷鞍座', page: 'data', desc: '钢卷存放鞍座 / 导向' },
  uncoiler: { label: '开卷机', page: 'data', desc: '入口上卷 / 开卷' },
  shear_welder: { label: '剪切对焊机', page: 'data', desc: '入口剪切与焊接' },
  disc_shear: { label: '圆盘剪', page: 'data', desc: '出口切边' },
  tension_reel: { label: '张力卷取机', page: 'data', desc: '出口卷取与张力控制' },
  bundler: { label: '打捆机', page: 'data', desc: '出口钢卷打捆' },
  // 工控机 / 维护类设备都是固定入口：点击直接打开对应页面，不再走信息卡。
  control_room: { label: '中控室 · 工控机', page: 'data', desc: '产线集中控制与监视 · 点击进入数据接入', direct: true },
  emulsion_station: { label: '乳化液站', page: 'maintenance', desc: '工艺润滑与乳化液系统 · 点击进入系统状态', direct: true },
  roll_cart: { label: '换辊小车', page: 'maintenance', desc: '工作辊 / 支承辊换辊 · 点击进入系统状态', direct: true },
  tool_cabinet: { label: '检修工具柜', page: 'maintenance', desc: '现场检修工具与备件 · 点击进入系统状态', direct: true },
  main_drive_room: { label: '主电室 · 设备连接', page: 'communication', desc: '主传动与电气控制 · 点击进入工业设备连接', direct: true },
  roll_shop: { label: '磨辊间', page: 'maintenance', desc: '轧辊磨削与装配 · 点击进入系统状态', direct: true },
};

const protoCache = new Map();

// 运行日志终端：运行日志此前只有「点开机架信息卡再点按钮」的两步入口，
// 这里补一个场景内直达设备，与其他设备一样点一下进页面。
function createLogKiosk() {
  const group = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x14303e, metalness: 0.55, roughness: 0.42 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.12, 0.82), shell);
  base.position.y = 0.06;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.45, 14), shell);
  pole.position.y = 0.86;
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.96, 1.0, 0.12), shell);
  body.position.set(0, 2.06, 0);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.06, 0.12), new THREE.MeshStandardMaterial({ color: 0x2f7fa0, emissive: 0x1d6f8f, emissiveIntensity: 0.8, metalness: 0.4, roughness: 0.4 }));
  cap.position.set(0, 2.59, 0);

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, 360);
  bg.addColorStop(0, '#061622');
  bg.addColorStop(1, '#0a2534');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 640, 360);
  ctx.strokeStyle = '#2f7fa0';
  ctx.lineWidth = 5;
  ctx.strokeRect(2, 2, 636, 356);
  ctx.fillStyle = '#7fe3ff';
  ctx.font = 'bold 42px "Microsoft YaHei", sans-serif';
  ctx.fillText('运行日志', 32, 66);
  ctx.fillStyle = '#6f93a6';
  ctx.font = '22px "Microsoft YaHei", sans-serif';
  ctx.fillText('RUN LOG · 248 条', 32, 100);
  ctx.strokeStyle = '#1e4a60';
  ctx.beginPath();
  ctx.moveTo(32, 120);
  ctx.lineTo(608, 120);
  ctx.stroke();
  const rows = [
    ['09:28:47', 'S5 轧制力预测', '正常'],
    ['09:28:45', 'S5 轧制力预测', '正常'],
    ['09:21:03', '换辊事件', '完成'],
    ['09:14:22', '温度超限预警', '告警'],
  ];
  ctx.font = '22px "Microsoft YaHei", sans-serif';
  rows.forEach(([time, item, state], index) => {
    const y = 160 + index * 42;
    ctx.fillStyle = '#9fc3d4';
    ctx.fillText(time, 32, y);
    ctx.fillStyle = '#d6ecf7';
    ctx.fillText(item, 160, y);
    ctx.fillStyle = state === '告警' ? '#ffb454' : state === '完成' ? '#7fe3c0' : '#63b8e0';
    ctx.fillText(state, 500, y);
  });
  ctx.fillStyle = '#5fa8c4';
  ctx.font = '20px "Microsoft YaHei", sans-serif';
  ctx.fillText('点击进入运行日志', 32, 338);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.78, 1.0),
    new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.05, roughness: 0.35, metalness: 0 }),
  );
  screen.position.set(0, 2.06, 0.066);

  group.add(base, pole, body, cap, screen);
  group.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return group;
}

export async function loadLineAssets(parent, baseUrl = '/assets/') {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const touched = new Set();
  const protos = {};

  await Promise.all(NAMES.map(async name => {
    let root = protoCache.get(name);
    if (!root) {
      const gltf = await loader.loadAsync(`${baseUrl}${name}_mo.glb`);
      root = gltf.scene;
      root.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m) m.envMapIntensity = 0.55;
        }
      });
      protoCache.set(name, root);
    }
    root.traverse(o => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m && !touched.has(m)) { m.envMapIntensity = 0.55; touched.add(m); }
      }
    });
    protos[name] = root;
  }));

  let seq = 0;
  // 钢卷外径由 GLB 实测，鞍座高度变化时不需要再手调一堆固定 y。
  const coilBounds = new THREE.Box3().setFromObject(protos.coil);
  const coilRadius = (coilBounds.max.y - coilBounds.min.y) / 2;
  const place = (name, pos, { scale = 1, rotY = 0, hotspot = null, restOn = null } = {}) => {
    const proto = protos[name];
    if (!proto) { console.warn('[assets] missing', name); return null; }
    const inst = proto.clone(true);
    inst.name = `Asset_${name}_${seq++}`;
    inst.position.set(...pos);
    // restOn：钢卷落到鞍座垫面（垫面局部高度，如 0.30 m），其余资产落到地坪。
    if (name === 'coil' && restOn != null) inst.position.y = restOn + coilRadius * scale;
    // 资产原点在地面中心：按所在区域落到实际地坪（轧机跨 -0.08，其余 -0.14）。
    inst.position.y += (pos[2] > -8.78 && pos[2] < 4.78) ? -0.08 : -0.14;
    inst.scale.setScalar(scale);
    inst.rotation.y = rotY;
    inst.userData = { ...(inst.userData || {}), interaction: { kind: 'asset', key: name, ...(META[name] || { label: name, page: 'overview', desc: '' }) } };
    if (hotspot) inst.userData.hotspot = hotspot;
    parent.add(inst);
    return inst;
  };

  // 钢卷：入口备料 3 + 开卷机 1 + 出口库 4
  // 入口/出口库的钢卷放到 Blender 鞍座垫面上，避免旧方块鞍座把钢卷“咬”进去。
  // 带钢中心线在 z=0（strip z ±0.75）：入口/出口设备必须落在同一条中心线上，
  // 否则会像摆在轧线旁边的散件。
  const PASS_Z = 0;
  for (const x of [-29, -26.4, -23.8]) {
    place('coil_car', [x, 0, PASS_Z]);
    place('coil', [x, 0, PASS_Z], { restOn: 0.30 });
  }
  place('coil', [-20.4, 2.75, PASS_Z]);
  // 出口张力卷取机不再叠放独立的大卷；卷筒保持空载，避免悬空钢卷。
  
  for (const [x, z] of [[27.5, -1.0], [30, -1.0], [27.5, -5.0], [30, -5.0]]) {
    place('coil_car', [x, 0, z]);
    place('coil', [x, 0, z], { restOn: 0.30 });
  }

  // 入口段
  place('uncoiler', [-20.4, 0, PASS_Z]);
  place('shear_welder', [-16.4, 0, PASS_Z]);
  // 出口段
  place('disc_shear', [16.5, 0, PASS_Z]);
  place('tension_reel', [20.6, 0, PASS_Z]);
  place('bundler', [23.6, 0, PASS_Z]);
  // 辅助设施
  place('control_room', [21.5, 0, AISLE_Z + 3.2]);
  place('emulsion_station', [-29.5, 0, -11.4]);
  place('roll_cart', [18.5, 0, -6.5]);
  place('tool_cabinet', [19.7, 0, -4.5], {
    hotspot: { type: 'yard', label: '检修工具柜' }
  });
  // 传动侧建筑（与 fixtures.js 旧程序化站位一致）
  place('main_drive_room', [0, 0, -10.2]);
  place('roll_shop', [28.5, 0, -10.2]);

  // 运行日志终端：立在操作台排前方（S3/S4 之间），不与其他操作台同列，
  // 屏幕朝相机侧，落在底部 HUD 上缘之上，默认机位一眼可见、可直接点。
  const kiosk = createLogKiosk();
  kiosk.name = 'Asset_log_kiosk';
  kiosk.position.set(2.6, -0.14, 10.1);
  kiosk.userData = {
    interaction: {
      kind: 'asset', key: 'log_kiosk', label: '运行日志终端', page: 'logs',
      desc: '产线运行日志 · 点击进入运行日志', direct: true,
    },
  };
  parent.add(kiosk);

  return protos;
}
