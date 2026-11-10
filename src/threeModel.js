import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { classifyModelMesh } from './threeProcess.js';

// One shared, immutable mesh template across screens. A short grace period avoids
// parsing the meshopt-compressed engineering model again when navigating or in
// React StrictMode.
let cache = null;
const pause = () => Promise.resolve();

export function disposeObject(root, includeMaterials = true) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of [].concat(object.material || [])) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  if (includeMaterials) {
    textures.forEach((texture) => { texture.dispose(); texture.source?.data?.close?.(); });
    materials.forEach((material) => material.dispose());
  }
}

export function createModelInstance(template) {
  const root = template.clone(true), materials = new Map();
  root.traverse((object) => {
    if (!object.isMesh) return;
    const cloneMaterial = (source) => {
      const key = `${source.uuid}:${object.userData.part}`;
      if (!materials.has(key)) materials.set(key, source.clone());
      return materials.get(key);
    };
    object.material = Array.isArray(object.material) ? object.material.map(cloneMaterial) : cloneMaterial(object.material);
  });
  // Geometry and source textures belong to the immutable cache. Only the cloned
  // materials are view-owned, so one scene's transparency cannot leak to another.
  return { root, dispose() { materials.forEach((material) => material.dispose()); } };
}

function reverseWinding(geometry) {
  const index = geometry.index;
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const second = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, second);
    }
  } else {
    for (const attribute of Object.values(geometry.attributes)) {
      const array = attribute.array, size = attribute.itemSize;
      for (let i = 0; i < attribute.count; i += 3) for (let j = 0; j < size; j++) {
        const a = (i + 1) * size + j, b = (i + 2) * size + j, value = array[a]; array[a] = array[b]; array[b] = value;
      }
    }
  }
}

// Packed (interleaved) buffers decode to InterleavedBufferAttribute, which
// mergeGeometries rejects — copy them out to standalone float attributes.
// meshopt/KHR_mesh_quantization 还会给出 normalized 整型属性：真实量纲只在
// GPU 归一化后才存在。CPU 侧（applyMatrix4 烘节点缩放、包围盒、合并）必须
// 先显式反量化成浮点，否则 ±32767 的原始值会被节点缩放放大成 ±5×10⁵，
// 轧机包围盒炸掉后相机会被推到两百公里外。
const NORMALIZED_SCALE = new Map([
  [Int8Array, 1 / 127], [Uint8Array, 1 / 255],
  [Int16Array, 1 / 32767], [Uint16Array, 1 / 65535],
  [Int32Array, 1 / 2147483647], [Uint32Array, 1 / 4294967295],
]);

const dequant = (value, scale) => (scale === 1 ? value : Math.max(-1, Math.min(1, value * scale)));

export function flattenInterleaved(geometry) {
  let packed = false;
  for (const attribute of Object.values(geometry.attributes)) {
    if (attribute.isInterleavedBufferAttribute) { packed = true; break; }
    if (attribute.normalized && NORMALIZED_SCALE.has(attribute.array.constructor)) { packed = true; break; }
  }
  if (!packed) return geometry;
  const flat = new THREE.BufferGeometry();
  flat.setIndex(geometry.index);
  flat.morphAttributes = geometry.morphAttributes;
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const quantScale = attribute.normalized ? (NORMALIZED_SCALE.get(attribute.array.constructor) ?? null) : null;
    if (!attribute.isInterleavedBufferAttribute && quantScale === null) { flat.setAttribute(name, attribute); continue; }
    const size = attribute.itemSize;
    const output = new Float32Array(attribute.count * size);
    if (attribute.isInterleavedBufferAttribute) {
      const { array, stride } = attribute.data, offset = attribute.offset;
      const scale = attribute.normalized ? (NORMALIZED_SCALE.get(array.constructor) ?? 1) : 1;
      for (let i = 0; i < attribute.count; i++) {
        for (let j = 0; j < size; j++) output[i * size + j] = dequant(array[i * stride + offset + j], scale);
      }
    } else {
      const { array } = attribute;
      for (let i = 0; i < array.length; i++) output[i] = dequant(array[i], quantScale ?? 1);
    }
    flat.setAttribute(name, new THREE.BufferAttribute(output, size));
  }
  return flat;
}

export async function batchModel(source, update = () => {}) {
  source.updateMatrixWorld(true);
  // Preserve a small, read-only provenance map before render batching discards
  // individual frame / hydraulic part names. No geometry or extra draw calls.
  const sourceAnchors = {};
  source.traverse((object) => {
    if (!/^S[1-5]_(?:Frame|WorkRoll_Top_Operator_BendingPiston1)$/.test(object.name)) return;
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return;
    const { stand, part } = classifyModelMesh(object);
    sourceAnchors[object.name] = { objectName: object.name, position: bounds.getCenter(new THREE.Vector3()).toArray(), bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, groupName: `${stand}:${part}` };
  });
  const meshes = [];
  source.traverse((object) => { if (object.isMesh) meshes.push(object); });
  const batches = new Map();
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    const { stand, part, rollName } = classifyModelMesh(mesh);
    const geometry = flattenInterleaved(mesh.geometry).clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    if (mesh.matrixWorld.determinant() < 0) reverseWinding(geometry);
    let pivot = null, radius = null;
    if (rollName) {
      // Keep each physical roll independent, with its source axis preserved.
      let body = mesh;
      while (body.parent && body.name !== rollName) body = body.parent;
      pivot = new THREE.Vector3().setFromMatrixPosition(body.matrixWorld);
      geometry.translate(-pivot.x, -pivot.y, -pivot.z);
      geometry.computeBoundingBox();
      radius = Math.max(Math.abs(geometry.boundingBox.min.x), Math.abs(geometry.boundingBox.max.x));
    }
    const materials = [].concat(mesh.material);
    // The GLB uses single-material primitives. Keep a unique batch for any future
    // multi-material primitive instead of accidentally discarding its groups.
    const signature = Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`).join('|');
    const key = [stand, part, rollName || '', materials.map((m) => m.uuid).join(','), signature, !!geometry.index,
      materials.length > 1 ? i : ''].join('/');
    if (!batches.has(key)) batches.set(key, { stand, part, rollName, pivot, radius, material: mesh.material, geometries: [] });
    batches.get(key).geometries.push(geometry);
    if (i % 100 === 0) { update({ percent: 75 + Math.round(i / meshes.length * 15), message: '优化机架几何…' }); await pause(); }
  }
  const root = new THREE.Group(); root.name = 'DKQKAR_5Stand_Web';
  const groups = new Map();
  let completed = 0;
  for (const batch of batches.values()) {
    const key = `${batch.stand}:${batch.part}`;
    if (!groups.has(key)) {
      const group = new THREE.Group(); group.name = key;
      group.userData = { stand: batch.stand, part: batch.part };
      root.add(group); groups.set(key, group);
    }
    const merged = batch.geometries.length === 1 ? batch.geometries[0] : mergeGeometries(batch.geometries, false);
    const output = merged ? [merged] : batch.geometries;
    if (merged && batch.geometries.length > 1) batch.geometries.forEach((geometry) => geometry.dispose());
    for (const geometry of output) {
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, batch.material);
      mesh.userData = { stand: batch.stand, part: batch.part, rollName: batch.rollName, radius: batch.radius };
      mesh.name = batch.rollName || key;
      if (batch.pivot) mesh.position.copy(batch.pivot);
      groups.get(key).add(mesh);
    }
    if (++completed % 25 === 0) { update({ percent: 90 + Math.round(completed / batches.size * 9), message: '准备材质与场景…' }); await pause(); }
  }
  // The geometries have been baked into world coordinates. Source textures and
  // materials are retained by the template and are disposed only with the cache.
  disposeObject(source, false);
  root.updateMatrixWorld(true);
  root.userData = { originalMeshes: meshes.length, batches: 0, sourceAnchors };
  root.traverse((object) => { if (object.isMesh) root.userData.batches++; });
  return root;
}

export function acquireModel(onProgress) {
  if (!cache) {
    const entry = { refs: 0, listeners: new Set(), timer: null, root: null, progress: { percent: 0, message: '读取设备模型…' } };
    const update = (progress) => { entry.progress = progress; entry.listeners.forEach((listener) => listener(progress)); };
    entry.promise = new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      // 五机架本体用回原 DKQKAR 六辊装配模型（用户 2026-11-01 选定，
      // 取代 Blender 简化重建版 mill_5stand_blender(_mo).glb —— 后者缺中间辊/工作辊）；
      // 保留 meshopt 解码器以兼容旧资产，不影响普通 GLB。
      loader.setMeshoptDecoder(MeshoptDecoder);
      loader.load('/assets/DKQKAR_5Stand.glb', resolve, (event) => {
        update({ percent: Math.min(74, Math.round(event.loaded / (event.total || 12967608) * 74)), message: '读取设备模型…' });
      }, reject);
    }).then((gltf) => batchModel(gltf.scene, update)).then((root) => { entry.root = root; return root; }).catch((error) => {
      if (cache === entry) cache = null;
      throw error;
    });
    cache = entry;
  }
  const entry = cache; entry.refs++; clearTimeout(entry.timer);
  entry.listeners.add(onProgress); onProgress(entry.progress);
  let released = false;
  return {
    promise: entry.promise,
    release() {
      if (released) return;
      released = true; entry.listeners.delete(onProgress); entry.refs--;
      if (entry.refs === 0) entry.timer = setTimeout(() => {
        if (entry.refs !== 0) return;
        entry.promise.then((root) => disposeObject(root)).catch(() => {});
        if (cache === entry) cache = null;
      }, 600000);
    },
  };
}
