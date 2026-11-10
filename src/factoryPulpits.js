import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const AISLE_Z = 6.9;
// 厂房地坪（factoryStage 的 Factory_Floor 面）在 -0.14 m；GLB 原点在底面中心，
// 必须落到同一标高，否则操作台会离地悬浮。
const FLOOR_Y = -0.14;

// Blender 导出的高精度操作台 → Web 实例化。
// 约定：GLB 原点在地面中心，-Z 为轧机侧（前窗），+Z 为人行通道侧（检修门）。
// 每台机架一个独立 GLB，铭牌文字不同；与程序化版 Pulpit_{stand} 使用同一站位。
// 模块级缓存：每台操作台 GLB 只解析一次，实例克隆后复用几何与材质。
const protoCache = new Map();

export async function loadPulpits(baseUrl, standAnchors, parent) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const touched = new Set();

  // 与 fixtures 的程序化材质保持一致：环境反射强度 .55（GLTF 默认 1.0 会明显发亮）
  const prepare = root => {
    root.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m && !touched.has(m)) { m.envMapIntensity = 0.55; touched.add(m); }
      }
    });
    return root;
  };

  const stands = Object.keys(standAnchors);
  const loaded = await Promise.all(stands.map(async stand => {
    let proto = protoCache.get(stand);
    if (!proto) {
      const gltf = await loader.loadAsync(`${baseUrl}pulpits_${stand}_mo.glb`);
      proto = prepare(gltf.scene);
      protoCache.set(stand, proto);
    }
    return [stand, proto];
  }));

  const out = {};
  for (const [stand, proto] of loaded) {
    const inst = proto.clone(true);
    inst.name = `PulpitAsset_${stand}`;
    inst.userData = { presentationOnly: true, stand, interaction: { kind: 'pulpit', stand, label: `${stand} 操作台`, page: 'data', desc: '操作台 HMI / 机架运行参数' } };
    inst.position.set(standAnchors[stand].x, FLOOR_Y, AISLE_Z + 2.6);
    parent.add(inst);
    out[stand] = inst;
  }
  return out;
}
