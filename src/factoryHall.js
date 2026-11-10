import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Blender 厂房壳体：地坪/后墙/侧墙/端墙/屋盖/桁架/天车/管廊/服务灯。
// 端墙与屋盖在数据视图隐藏，避免挡住从操作侧上方看轧机的机位；
// 进入巡视模式后再显示，形成完整封闭车间。
const OVERVIEW_HIDDEN = ['Hall_FrontWall', 'Hall_RoofDeck', 'Hall_RearWall', 'Hall_SideWalls'];
// 非巡视模式下做剖视处理的外墙：不隐藏，但降到半透明，避免相机转到室外时被幕墙挡死。
const GHOST_WALLS = [];

// 模块级缓存：厂房 GLB 只下载解析一次，clone 复用几何与材质。
// 切页往返不再重复 1.7MB 下载+解析（此前是切页最大未缓存串行项）。
let hallProtoPromise = null;

async function loadHallProto() {
  if (!hallProtoPromise) {
    hallProtoPromise = (async () => {
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/assets/factory_hall_mo.glb');
      const proto = gltf.scene;
      proto.traverse(object => {
        if (!object.isMesh) return;
        // 厂房是背景：接收阴影，但不遮挡轧机主光。
        object.castShadow = false;
        object.receiveShadow = true;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          // 墙体/屋面板是薄壳，单面材质从外侧看会被背面剔除直接看穿内部，
          // 所以厂房整体双面渲染。
          if (material) { material.envMapIntensity = 0.55; material.side = THREE.DoubleSide; material.needsUpdate = true; }
        }
      });
      return proto;
    })().catch(error => { hallProtoPromise = null; throw error; });
  }
  return hallProtoPromise;
}

export async function loadFactoryHall(scene) {
  const proto = await loadHallProto();
  // clone 共享几何与材质；每实例的可见性/透明度由 setMode 在副本上调整。
  const root = proto.clone(true);
  root.name = 'Factory_Hall_Blender';
  root.traverse(object => {
    if (!object.isMesh) return;
    // 厂房是背景：接收阴影，但不遮挡轧机主光。
    object.castShadow = false;
    object.receiveShadow = true;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      // 墙体/屋面板是薄壳，单面材质从外侧看会被背面剔除直接看穿内部，
      // 所以厂房整体双面渲染。
      if (material) { material.envMapIntensity = 0.55; material.side = THREE.DoubleSide; material.needsUpdate = true; }
    }
  });
  const nodes = {};
  root.traverse(object => { if (object.name) nodes[object.name] = object; });
  // 2026-11-01 用户要求顶部全清（顶也删）：屋面板/桁架/管廊/天车整体隐藏，厂房只留墙与地坪。
  // 回滚：删除本段即可恢复。
  for (const key of ['Hall_RoofDeck', 'Hall_RoofStructure', 'Hall_Pipes', 'Hall_Crane']) {
    if (nodes[key]) nodes[key].visible = false;
  }
  // Hall_Details 里两根 y≈11-12m 的顶部横梁（Cube973_2/3）同属“顶”，一并隐藏；回滚：删除本段
  nodes.Hall_Details?.traverse(object => {
    if (object.isMesh && /^Cube973_[23]$/.test(object.name)) object.visible = false;
  });
  // 天车里有一块 HALL_Crane_Dark 构件，包围盒 Y[-5.36, 12.15]、X 仅 2.8m 宽，
  // 也就是一根从地下 5 米直穿到屋顶的深色大板，横在 S3 附近——这就是穿模本体。
  // 几何在 Blender 源里就是错的，隐藏该材质对应的 mesh。
  nodes.Hall_Crane?.traverse(object => {
    if (!object.isMesh) return;
    const materials = [].concat(object.material || []);
    const box = new THREE.Box3().setFromObject(object);
    const buried = !box.isEmpty() && box.min.y < -1;
    if (buried || materials.some(material => material?.name === 'HALL_Crane_Dark')) object.visible = false;
  });
  // 后墙在 Blender 源里只到 y≈11.85，比屋架下缘(≈12.48)和屋面板(≈13.29)都低，
  // 从后方或俯视会看到墙顶与屋顶之间裂开一条 1.4m 的穿帮缝。
  // 沿 Y 拉高到屋面板底部：墙底接近地面，缩放不会影响接地。
  const rearWall = nodes.Hall_RearWall;
  if (rearWall) {
    const box = new THREE.Box3().setFromObject(rearWall);
    if (box.max.y > 1) rearWall.scale.y = 13.62 / box.max.y;
  }
  // 巡视时补一点环境光，让屋架/墙面在逆光下仍然可读。
  const ambient = new THREE.AmbientLight('#9fc4d3', 0.35);
  root.add(ambient);
  scene.add(root);

  function setMode(mode) {
    const walk = mode === 'walk';
    for (const name of OVERVIEW_HIDDEN) if (nodes[name]) nodes[name].visible = walk;
    // 巡视以外的视角可以把相机转到厂房外侧，实心外墙会把内部整个挡死
    // （数据牌还会浮在墙面上）。外墙在非巡视模式降到半透明，相当于建筑剖视。
    for (const name of GHOST_WALLS) {
      const node = nodes[name];
      if (!node) continue;
      node.traverse(object => {
        if (!object.isMesh) return;
        for (const material of [].concat(object.material || [])) {
          if (!material) continue;
          material.transparent = !walk;
          material.opacity = walk ? 1 : 0.26;
          material.depthWrite = walk;
          material.needsUpdate = true;
        }
      });
    }
    ambient.visible = walk;
  }
  setMode('overview');

  return {
    root,
    nodes,
    setMode,
    dispose() {
      // 几何与材质归模块级缓存所有，切页只脱离场景，不释放。
      scene.remove(root);
    },
  };
}
