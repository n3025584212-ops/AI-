import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flattenInterleaved } from './threeModel.js';

// 厂区布置：主线后方再放两条**完整产线**（五机架 + 入口/出口工艺链），
// 三条线同 X 对齐、同尺寸地台、同一套地坪，末端用后墙收口，避免露空场。
//
// 真实冷连轧厂是多条产线并排的（用户 2026-11-04/05 重申）：单条孤线不真实。
// 只主线接实时数据，背景线为复制副本，不接数据（用户 11-01 已定）。
//
// 尺寸全部对齐 Blender 厂房里已有的那两块板，保证三条线看过去是同一个厂：
//   · 厂房地坪 Cube：x ±36，z -18…28，顶面 y=-0.14，颜色 #303c43
//   · 厂房轧线地台 Cube_1：x ±21，z -8.78…4.78，顶面 y=-0.08，颜色 #39474e
const MAIN_LINE_Z = -2.1;
const LINE_OFFSETS = [
  { dz: -20, dx: 0 },
  { dz: -40, dx: 0 },
];

const HALL_FLOOR = { width: 72, front: -18, top: -0.14, color: '#303c43', roughness: 0.82, metalness: 0.02 };
// back=-52：盖住两条背景线（线2中心 z≈MAIN_LINE_Z-40≈-42，轧机纵深 ±5m），不让背景线踩到外场暗色地面上。
const FLOOR = { top: -0.145, front: -17.6, back: -52, thickness: 0.14 };
const PAD_WIDTH = 42; // 线间黄线长度：与原来厂房那块台面同宽，三条线一致
const WALL_Z = FLOOR.back + 0.35;
const WALL_HEIGHT = 9.6;

const COLORS = {
  floor: HALL_FLOOR.color,
  floorBay: '#39474e',
  paint: '#a8862c',
  wall: '#26343c',
  wallTrim: '#3d505c',
  window: '#41616e',
  cabinet: '#3f4f59',
  coil: '#8b959b',
  saddle: '#2a353c',
};

// 工艺链资产：上卷/开卷/剪切对焊/圆盘剪/卷取/打捆 —— 主线有，背景线也要有，
// 否则三条线看起来长短不一。厂房/主电室/磨辊间不属于单条产线，不复制。
const CHAIN_ASSET = /^Asset_(coil|uncoiler|shear|tension_reel|bundler)/;

// 把若干来源对象按材质合并成少量网格：反量化 + 应用世界矩阵 + 按材质分桶。
// 分帧执行，避免 300+ 个网格同步合并阻塞首屏。
async function buildMergedCopy(sources, { name = 'Factory_Plant_LineCopy' } = {}) {
  const meshes = [];
  for (const source of sources) {
    if (!source) continue;
    source.updateMatrixWorld(true);
    source.traverse((object) => { if (object.isMesh && object.visible && object.geometry) meshes.push(object); });
  }
  const buckets = new Map();
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (material) {
      const geometry = flattenInterleaved(mesh.geometry).clone();
      geometry.applyMatrix4(mesh.matrixWorld);
      const key = material.uuid;
      if (!buckets.has(key)) buckets.set(key, { material, geometries: [] });
      buckets.get(key).geometries.push(geometry);
    }
    if (i % 150 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const group = new THREE.Group();
  group.name = name;
  for (const { material, geometries } of buckets.values()) {
    const merged = mergeBucket(geometries);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `${name}_${material.name || 'mat'}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.ownGeometry = true;
    group.add(mesh);
  }
  return group;
}

// glTF 里同一材质的网格可能有的带索引、有的不带，属性集合也可能不同；
// mergeGeometries 遇到这种情况会直接返回 null 把整桶丢掉（上一版框架因此
// 少了一批机架）。这里先统一成非索引，并只保留所有几何都有的属性。
function mergeBucket(geometries) {
  const prepared = [];
  for (const geometry of geometries) {
    if (geometry.index) {
      const flat = geometry.toNonIndexed();
      geometry.dispose();
      prepared.push(flat);
    } else {
      prepared.push(geometry);
    }
  }
  if (!prepared.length) return null;
  const common = Object.keys(prepared[0].attributes).filter((key) => prepared.every((item) => item.attributes[key]));
  for (const geometry of prepared) {
    for (const key of Object.keys(geometry.attributes)) {
      if (!common.includes(key)) geometry.deleteAttribute(key);
    }
  }
  if (prepared.length === 1) return prepared[0];
  const merged = mergeGeometries(prepared, false);
  prepared.forEach((geometry) => geometry.dispose());
  return merged || null;
}

export function buildFactoryPlant(scene, { environment, millSource, lineAssets, detailSource } = {}) {
  const root = new THREE.Group();
  root.name = 'Factory_Plant_Extension';
  root.userData.presentationOnly = true;

  const materials = new Map();
  const ownedGeometries = new Set();
  const material = (key, name, { roughness = 0.9, metalness = 0.02, envMapIntensity = 0.55 } = {}) => {
    if (!materials.has(key)) {
      const mat = new THREE.MeshStandardMaterial({ color: COLORS[key], roughness, metalness, envMap: environment || null, envMapIntensity });
      mat.name = name;
      materials.set(key, mat);
    }
    return materials.get(key);
  };
  const floorMat = material('floor', 'Plant_Floor', { roughness: HALL_FLOOR.roughness, metalness: HALL_FLOOR.metalness });
  const bayMat = material('floorBay', 'Plant_Bay', { roughness: 0.8, metalness: 0.03 });
  const paintMat = material('paint', 'Plant_Paint', { roughness: 0.8, metalness: 0.05 });
  const wallMat = material('wall', 'Plant_Wall', { roughness: 0.86, metalness: 0.06 });
  const trimMat = material('wallTrim', 'Plant_Wall_Trim', { roughness: 0.55, metalness: 0.35 });
  const windowMat = material('window', 'Plant_Wall_Window', { roughness: 0.25, metalness: 0.1, envMapIntensity: 0.8 });
  windowMat.emissive = new THREE.Color('#1d3540');
  windowMat.emissiveIntensity = 0.7;

  // ---- 厂区外场地面：铺到镜头能转到的范围之外，任何角度往下看都是地面，不再露虚空 ----
  // 场地与地坪同色：不再出现"浅色方块 + 深色外圈"的怪形状，整片地面是一块
  const yardMaterial = new THREE.MeshStandardMaterial({ color: '#303c43', roughness: 0.96, metalness: 0.02, envMap: environment || null, envMapIntensity: 0.2 });
  yardMaterial.name = 'Plant_Yard';
  const yardGeometry = new THREE.PlaneGeometry(420, 420);
  yardGeometry.rotateX(-Math.PI / 2);
  const yard = new THREE.Mesh(yardGeometry, yardMaterial);
  yard.name = 'Plant_Yard';
  yard.position.set(0, FLOOR.top - 0.16, -20);
  yard.receiveShadow = true;
  root.add(yard);
  materials.set('yard', yardMaterial);
  ownedGeometries.add(yardGeometry);

  // ---- 地坪：与厂房地坪同宽（x ±36）、同顶面、同色，-17.6 接到 -66.5 ----
  const floorDepth = FLOOR.front - FLOOR.back;
  const floorGeometry = new THREE.BoxGeometry(HALL_FLOOR.width, FLOOR.thickness, floorDepth);
  floorGeometry.translate(0, FLOOR.top - FLOOR.thickness / 2, (FLOOR.front + FLOOR.back) / 2);
  const floorMesh = new THREE.Mesh(floorGeometry, floorMat);
  floorMesh.name = 'Plant_Floor';
  floorMesh.receiveShadow = true;
  root.add(floorMesh);

  // ---- 地台：三条线都不再单独铺台面 ----
  // 之前主线踩厂房自带的一块 42×13.56 浅色板、背景线踩 56×13 的新板，远看就是
  // “平台有大有小”。现在统一取消：三条线都落在同一块地坪上，只留黄线分区。
  // 厂房自带的那块浅色板（Cube_1）在加载 hall 后一并隐藏。

  // ---- 线间安全通道：两条背景线之间、主线与第一背景线之间各一条黄线通道 ----
  // （2026-11-04/05 恢复多线：真实冷轧厂多线并排，线间有人行/检修通道。）
  // 通道底板顶面略低于地坪（-0.155 vs -0.145），避免与 Plant_Floor 顶面 z-fighting。
  for (const dz of [LINE_OFFSETS[0].dz / 2, (LINE_OFFSETS[0].dz + LINE_OFFSETS[1].dz) / 2]) {
    const z = MAIN_LINE_Z + dz;
    const laneGeometry = new THREE.BoxGeometry(HALL_FLOOR.width - 4, 0.02, 4.4);
    laneGeometry.translate(0, FLOOR.top - 0.015, z);
    const lane = new THREE.Mesh(laneGeometry, bayMat);
    lane.name = `Plant_Lane_${dz}`;
    lane.receiveShadow = true;
    root.add(lane);
    ownedGeometries.add(laneGeometry);
    for (const d of [-2.5, 2.5]) {
      const lineGeometry = new THREE.BoxGeometry(HALL_FLOOR.width - 4, 0.02, 0.14);
      lineGeometry.translate(0, FLOOR.top - 0.008, z + d);
      const mark = new THREE.Mesh(lineGeometry, paintMat);
      mark.name = `Plant_Lane_Mark_${dz}_${d}`;
      mark.receiveShadow = true;
      root.add(mark);
      ownedGeometries.add(lineGeometry);
    }
  }

  // ---- 设备一律贴产线布置：地面不再撒与工艺无关的柜子/钢卷束 ----
  // 入口备料、开卷、剪切、卷取、打捆都在 factoryAssets.js 里按带钢中心线 z=0 排；
  // 三条背景线再各自复制一套。这里不再额外摆放无关道具（上一版被用户指为“乱发”）。

  // ---- 厂区照明：延伸段不再加额外点光 ----
  // 2026-11-04 试过补 5 盏点光，但场景灯已经很多（3 Spot + 4 RectArea + 3 Point），
  // 再加会让片元着色器开销上去，用户端出现过 WebGL 上下文丢失。照明改用
  // 后墙/钢卷库等实体填充 + 现有环境光，不再增加实时灯。

  // ---- 后墙：把厂区末端封住，别再让镜头后面是一片空场 ----
  const wallGeometries = [];
  const wallAdd = (mat, geometry) => wallGeometries.push([geometry, mat]);
  const panel = new THREE.BoxGeometry(HALL_FLOOR.width, WALL_HEIGHT, 0.5);
  panel.translate(0, FLOOR.top + WALL_HEIGHT / 2, WALL_Z);
  wallAdd(wallMat, panel);
  const skirt = new THREE.BoxGeometry(HALL_FLOOR.width, 1.0, 0.62);
  skirt.translate(0, FLOOR.top + 0.5, WALL_Z + 0.06);
  wallAdd(trimMat, skirt);
  const band = new THREE.BoxGeometry(HALL_FLOOR.width, 0.42, 0.62);
  band.translate(0, FLOOR.top + WALL_HEIGHT - 0.3, WALL_Z + 0.06);
  wallAdd(trimMat, band);
  const windowBand = new THREE.BoxGeometry(HALL_FLOOR.width - 8, 1.3, 0.16);
  windowBand.translate(0, FLOOR.top + 6.6, WALL_Z - 0.2);
  wallAdd(windowMat, windowBand);
  for (let x = -HALL_FLOOR.width / 2 + 2; x <= HALL_FLOOR.width / 2 - 2; x += 6) {
    const column = new THREE.BoxGeometry(0.42, WALL_HEIGHT, 0.66);
    column.translate(x, FLOOR.top + WALL_HEIGHT / 2, WALL_Z - 0.1);
    wallAdd(trimMat, column);
  }
  const wallBuckets = new Map();
  for (const [geometry, mat] of wallGeometries) {
    if (!wallBuckets.has(mat)) wallBuckets.set(mat, []);
    wallBuckets.get(mat).push(geometry);
  }
  for (const [mat, geometries] of wallBuckets) {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = `Plant_RearWall_${mat.name}`;
    mesh.receiveShadow = true;
    // 用户明确不要厂区后墙：只保留厂区地坪与产线，不再加墙/窗带/柱列。
    mesh.visible = false;
    root.add(mesh);
  }

  // ---- 两条完整产线副本：五机架 + 工艺链 + 机架细节，先合并再摆放 ----
  const copies = [];
  const detailClones = [];
  if (millSource) {
    const chainSources = [];
    if (lineAssets) {
      for (const child of lineAssets.children || []) {
        if (CHAIN_ASSET.test(child.name || '')) chainSources.push(child);
      }
    }
    Promise.all([
      buildMergedCopy([millSource], { name: 'Factory_Plant_MillCopy' }),
      chainSources.length ? buildMergedCopy(chainSources, { name: 'Factory_Plant_ChainCopy' }) : Promise.resolve(null),
    ]).then(([millProto, chainProto]) => {
      const protos = [millProto, chainProto].filter(Boolean);
      for (const proto of protos) proto.traverse((object) => { if (object.isMesh) ownedGeometries.add(object.geometry); });
      for (const { dz } of LINE_OFFSETS) {
        const copy = new THREE.Group();
        copy.name = 'Factory_Plant_LineCopy';
        copy.position.set(0, 0, dz);
        // 两条副本共享同一份合并几何：只复制 Mesh，不复制几何。
        for (const proto of protos) {
          for (const mesh of proto.children) {
            const instance = new THREE.Mesh(mesh.geometry, mesh.material);
            instance.name = mesh.name;
            // 背景线不投影：三条线的阴影贴图本来就被主线占满，背景线再投一遍
            // 只是给 GPU 加负担（2026-11-04 用户端出现过 WebGL 上下文丢失）。
            instance.castShadow = false;
            instance.receiveShadow = true;
            copy.add(instance);
          }
        }
        if (detailSource) {
          const detail = detailSource.clone(true);
          detail.name = 'Factory_Plant_DetailCopy';
          copy.add(detail);
          detailClones.push(detail);
        }
        root.add(copy);
        copies.push(copy);
      }
    }).catch((error) => console.warn('[plant] 背景产线合并失败', error));
  }

  scene.add(root);

  // 后侧那道 y 5.7~6.1 的墙带挡视线：背景线在它后面，直接隐藏（巡查模式另有封闭壳）。
  const hall = scene.getObjectByName('Factory_Hall_Blender');
  const rearBand = hall?.getObjectByName('Cube057');
  if (rearBand) rearBand.visible = false;
  // 主线脚下那块 42×13.56 的浅色台面 + 同尺寸的深色垫板：三条线统一踩地坪，
  // 它们也必须隐藏，否则主线看起来仍比背景线多一块“大平台”。
  for (const name of ['Cube_1', 'Cube_4']) {
    const plate = hall?.getObjectByName(name);
    if (plate) plate.visible = false;
  }

  return {
    root,
    dispose() {
      scene.remove(root);
      ownedGeometries.forEach((geometry) => geometry.dispose());
      floorMesh.geometry.dispose();
      materials.forEach((mat) => mat.dispose());
    },
  };
}
