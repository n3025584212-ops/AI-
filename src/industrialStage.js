import * as THREE from 'three';
import { createIndustrialFactoryDetails } from './industrialFactoryDetails.js';

// The presentation hall establishes scale around the original equipment asset.
// Equipment coordinates are unchanged: X is strip travel, +Z is the operator side.
export function createIndustrialStage(scene) {
  const root = new THREE.Group();
  root.name = 'Industrial_Presentation_Hall';
  root.userData.presentationOnly = true;
  const backdrop = new THREE.Group();
  backdrop.name = 'Hall_Rear_Backdrop';
  root.add(backdrop);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const planeGeometry = new THREE.PlaneGeometry(1, 1);
  const materials = [];
  const batches = new Map();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();

  function material(name, color, roughness = 0.7, metalness = 0.1, extra = {}) {
    const result = new THREE.MeshStandardMaterial({ color, roughness, metalness, envMap: scene.environment, envMapIntensity: 0.15, ...extra });
    result.name = name;
    materials.push(result);
    return result;
  }
  function box(mat, p, size) {
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat).push({ p, size });
  }
  function surface(name, mat, x, z, width, depth, y = -0.042) {
    const mesh = new THREE.Mesh(planeGeometry, mat);
    mesh.name = name;
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.scale.set(width, depth, 1);
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }

  const floorMat = material('Resin_Concrete_Floor', '#303c43', 0.66, 0.04);
  floorMat.envMapIntensity = 0.40;
  floorMat.onBeforeCompile = shader => {
    shader.vertexShader = `varying vec3 vFloorWorld;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFloorWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = `varying vec3 vFloorWorld;
      float hallHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float hallNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hallHash(i), hallHash(i + vec2(1,0)), f.x), mix(hallHash(i + vec2(0,1)), hallHash(i + vec2(1,1)), f.x), f.y);
      }
      ${shader.fragmentShader}`
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 floorUV = vFloorWorld.xz;
        // Fine aggregate and barely different poured slabs; no broad cloud noise.
        float fine = hallNoise(floorUV * 48.0);
        float grainVisibility = 1.0 - smoothstep(0.45, 1.25, length(fwidth(floorUV * 48.0)));
        float slabTone = hallHash(floor(floorUV / 6.0));
        float wheel = exp(-pow((abs(floorUV.y - 6.15) - 0.56) / 0.105, 2.0));
        diffuseColor.rgb *= 0.985 + (slabTone - 0.5) * 0.018 + (fine - 0.5) * 0.055 * grainVisibility - wheel * 0.025;
      `).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (fine - 0.5) * 0.025 * grainVisibility, 0.58, 0.78);
      `);
  };
  floorMat.customProgramCacheKey = () => 'industrial-resin-floor-v4';
  surface('Factory_Floor', floorMat, 0, -4, 110, 110, -0.14);

  const jointMat = material('Concrete_Expansion_Joints', '#111b20', 0.95, 0);
  for (let x = -42; x <= 42; x += 6) box(jointMat, [x, -0.126, -6], [0.012, 0.004, 72]);
  for (let z = -42; z <= 30; z += 6) box(jointMat, [0, -0.126, z], [84, 0.004, 0.012]);

  const zoneMat = material('Machine_Bay_Concrete', '#39474e', 0.64, 0.05);
  zoneMat.onBeforeCompile = floorMat.onBeforeCompile;
  zoneMat.customProgramCacheKey = floorMat.customProgramCacheKey;
  zoneMat.envMapIntensity = 0.32;
  surface('Mill_Bay_Floor', zoneMat, 0, -2, 42.0, 13.6, -0.08);
  const rimMat = material('Machine_Bay_Perimeter', '#2a3b48', 0.7, 0.12);
  box(rimMat, [0, -0.052, -8.78], [42.0, 0.008, 0.035]);
  box(rimMat, [0, -0.052, 4.78], [42.0, 0.008, 0.035]);
  for (const x of [-20.98, 20.98]) box(rimMat, [x, -0.052, -2], [0.035, 0.008, 13.6]);

  const walkwayMat = material('Operator_Aisle', '#112c34', 0.88, 0.02);
  walkwayMat.onBeforeCompile = floorMat.onBeforeCompile;
  walkwayMat.customProgramCacheKey = floorMat.customProgramCacheKey;
  surface('Operator_Service_Aisle', walkwayMat, 0, 6.15, 37.2, 1.8, -0.067);
  const yellowMat = material('Safety_Ochre_Floor_Paint', '#b98a27', 0.85, 0.02);
  for (const z of [5.22, 7.08]) box(yellowMat, [0, -0.061, z], [37.2, 0.008, 0.045]);
  const markingMat = material('Neutral_Floor_Markings', '#63777b', 0.85, 0.02);
  // Short registration marks keep the aisle readable without a luminous grid.
  for (const x of [-10.4, -5.2, 0, 5.2, 10.4]) {
    box(markingMat, [x, -0.057, 5.56], [0.045, 0.01, 0.42]);
    box(markingMat, [x, -0.057, 6.72], [0.045, 0.01, 0.42]);
  }
  for (const x of [-18.4, 18.4]) {
    for (let i = 0; i < 5; i += 1) box(markingMat, [x, -0.065, 5.5 + i * 0.32], [0.58, 0.012, 0.12]);
  }

  // A scaled rear bay: concrete plinth, sheet cladding, columns and clerestory.
  // No roof or foreground posts cover the mill in overhead inspection views.
  const wallZ = -12.8;
  const wallMat = material('Hall_Cladding', '#303d46', 0.82, 0.08);
  const dadoMat = material('Hall_Concrete_Dado', '#363c40', 0.90, 0.01);
  const steelMat = material('Structural_Steel', '#344b58', 0.58, 0.42);
  const trimMat = material('Cladding_Ribs', '#3d505c', 0.65, 0.22);
  trimMat.envMapIntensity = 0.28;
  box(wallMat, [0, 5.86, wallZ], [64, 11.9, 0.14]);
  box(dadoMat, [0, 0.68, wallZ + 0.12], [64, 1.5, 0.22]);
  for (let x = -31.2; x <= 31.2; x += 1.2) {
    box(trimMat, [x, 4.78, wallZ + 0.10], [0.022, 6.72, 0.036]);
    box(trimMat, [x, 10.82, wallZ + 0.10], [0.022, 1.90, 0.036]);
  }
  for (let x = -30; x <= 30; x += 10) {
    for (const offset of [0.25, 0.65]) box(steelMat, [x, 5.90, wallZ + offset], [0.58, 11.9, 0.10]);
    box(steelMat, [x, 5.90, wallZ + 0.45], [0.10, 11.9, 0.44]);
    box(steelMat, [x, 0.03, wallZ + 0.45], [0.92, 0.16, 0.96]);
  }
  for (const y of [1.43, 8.11, 9.72, 11.65]) box(steelMat, [0, y, wallZ + 0.26], [64, 0.12, 0.18]);

  const glassMat = material('Clerestory_Glass', '#42677d', 0.42, 0.12, { emissive: '#466d88', emissiveIntensity: 0.45 });
  const lampMat = material('Hall_Luminaire_Diffuser', '#e3c69b', 0.40, 0.04,
    { emissive: '#ffdb9a', emissiveIntensity: 3.2, toneMapped: false });
  for (let x = -25; x <= 25; x += 10) {
    box(glassMat, [x, 8.92, wallZ + 0.14], [8.70, 1.45, 0.035]);
    for (const offset of [-2.90, 0, 2.90]) box(trimMat, [x + offset, 8.92, wallZ + 0.20], [0.045, 1.45, 0.06]);
    box(steelMat, [x, 10.37, wallZ + 0.44], [3.7, 0.20, 0.24]);
    box(lampMat, [x, 10.33, wallZ + 0.60], [3.2, 0.06, 0.04]);
    // Real fixtures and structural depth, kept behind the existing machinery.
    box(steelMat, [x, 9.60, wallZ + 0.80], [0.85, 0.12, 1.4]);
    box(lampMat, [x, 9.48, wallZ + 1.40], [0.65, 0.18, 0.38]);
  }

  // A few shut service doors give the rear wall a readable working scale.
  const doorMat = material('Hall_Service_Door', '#17252d', 0.76, 0.30);
  const doorRibMat = material('Hall_Door_Ribs', '#2a3941', 0.72, 0.35);
  for (const x of [-15, 15]) {
    box(doorMat, [x, 2.25, wallZ + 0.30], [4.10, 4.50, 0.12]);
    box(steelMat, [x, 4.56, wallZ + 0.39], [4.50, 0.18, 0.26]);
    for (const side of [-1, 1]) box(steelMat, [x + side * 2.16, 2.25, wallZ + 0.39], [0.13, 4.5, 0.23]);
    for (let y = 0.24; y < 4.4; y += 0.27) box(doorRibMat, [x, y, wallZ + 0.38], [4.04, 0.017, 0.026]);
    box(steelMat, [x, 0.08, wallZ + 0.50], [4.40, 0.13, 0.72]);
  }

  // Subtle floor-mounted inspection lights stop short of the strip entrance
  // and exit. Low output preserves the material colour of the real machine.
  const socketMat = material('Service_Light_Housing', '#1a2b36', 0.46, 0.55);
  const serviceMat = material('Service_Light_Diffuser', '#78949e', 0.45, 0.05,
    { emissive: '#a6bdc7', emissiveIntensity: 0.35 });
  for (const x of [-13, -7.8, -2.6, 2.6, 7.8, 13]) {
    box(socketMat, [x, -0.028, 4.45], [0.9, 0.055, 0.12]);
    box(serviceMat, [x, 0.001, 4.45], [0.62, 0.007, 0.045]);
  }

  // Controlled HDR accents for a high-threshold bloom. These are display
  // lighting fixtures around the bay, not additional machine components.
  const edgeLightMat = material('Bay_Edge_WhiteBlue_Light', '#4d87a2', 0.4, 0.1,
    { emissive: '#a6bdc7', emissiveIntensity: 0.3 });
  const s5LightMat = material('S5_Inspection_Light_Diffuser', '#639cac', 0.38, 0.1,
    { emissive: '#a6bdc7', emissiveIntensity: 0.3 });
  for (const x of [-10.4, -5.2, 0, 5.2, 10.4]) {
    box(socketMat, [x, -0.022, 4.45], [3.0, 0.052, 0.13]);
    box(x === 10.4 ? s5LightMat : edgeLightMat, [x, 0.007, 4.45], [2.82, 0.009, 0.042]);
  }

  const backdropMaterials = new Set([wallMat, dadoMat, steelMat, trimMat, glassMat, lampMat, doorMat, doorRibMat]);
  for (const [mat, entries] of batches) {
    const mesh = new THREE.InstancedMesh(geometry, mat, entries.length);
    mesh.name = `${mat.name}_Instances`;
    entries.forEach((entry, index) => {
      position.fromArray(entry.p);
      scale.fromArray(entry.size);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    // Distant cladding is outside the machine shadow frustum.
    mesh.receiveShadow = ![wallMat, dadoMat, steelMat, trimMat, glassMat, lampMat].includes(mat);
    // Structure is kept behind the mill and does not need another shadow pass.
    mesh.castShadow = false;
    (backdropMaterials.has(mat) ? backdrop : root).add(mesh);
  }

  scene.add(root);
  const details = createIndustrialFactoryDetails(scene);
  return {
    root,
    backdrop,
    // Outside the presentation hall, cut away its rear wall for inspection.
    // Hysteresis keeps a camera hovering near the threshold from toggling the
    // large rear wall on/off and flashing the whole bay brightness.
    updateCamera(camera) {
      details.updateCamera(camera);
      const z = camera.position.z;
      if (z > wallZ + 1.2) backdrop.visible = true;
      else if (z < wallZ + 0.4) backdrop.visible = false;
    },
    setScope(scope) { details.setScope(scope); },
    dispose() {
      details.dispose();
      scene.remove(root);
      geometry.dispose();
      planeGeometry.dispose();
      for (const mat of materials) mat.dispose();
    },
  };
}
