import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Architectural/set-dressing assets only. The source mill, rolls, strip,
// coordinates, model inputs and device bindings are not touched.
export function createIndustrialFactoryDetails(scene) {
  const root = new THREE.Group();
  root.name = 'Factory_Architectural_Details';
  root.userData = { presentationOnly: true, equipmentBinding: false };
  const overhead = new THREE.Group(); overhead.name = 'Factory_Crane_And_Roof_Trusses';
  // 2026-11-01 用户要求移除厂房立柱/屋架/天车（顶）；回滚：恢复下一行 root.add
  // root.add(overhead);
  const services = new THREE.Group(); services.name = 'Factory_Service_Pipes_And_Cable_Tray';
  // 顶部管廊/桥架随顶一起移除（悬空无依托）；回滚：恢复下一行 root.add
  // root.add(services);
  const props = new THREE.Group(); props.name = 'Factory_Storage_And_Maintenance'; root.add(props);
  const signs = new THREE.Group(); signs.name = 'Factory_Wayfinding'; root.add(signs);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const rounded = new RoundedBoxGeometry(1, 1, 1, 2, 0.045);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 24);
  const torus = new THREE.TorusGeometry(1, 0.055, 8, 32);
  const geometries = new Set([geometry, rounded, cylinder, torus]);
  const materials = new Set(), textures = new Set(), batches = new Map();
  const identity = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  function material(name, color, roughness = 0.5, metalness = 0.3, extras = {}) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness, envMap: scene.environment, envMapIntensity: 0.65, ...extras });
    mat.name = name; materials.add(mat); return mat;
  }
  const structure = material('Factory_Structural_Graphite', '#344550', 0.48, 0.62);
  const yellow = material('Factory_Crane_Ochre_Enamel', '#b98824', 0.32, 0.18);
  const dark = material('Factory_Black_Equipment', '#18242c', 0.48, 0.55);
  const zinc = material('Factory_Galvanized_Steel', '#8e9ba1', 0.29, 0.90);
  const pipeBlue = material('Factory_Blue_Utility_Pipe', '#245e7a', 0.30, 0.24);
  const pipeGrey = material('Factory_Light_Utility_Pipe', '#8b999e', 0.38, 0.65);
  const cabinet = material('Factory_Cabinet_Enamel', '#70858e', 0.37, 0.12);
  const cabinetDoor = material('Factory_Cabinet_Doors', '#92a0a3', 0.32, 0.10);
  const rubber = material('Factory_Rubber', '#151d21', 0.84, 0);
  const copper = material('Factory_Cable_Amber', '#805c31', 0.53, 0.12);
  const green = material('Factory_Indicator_Lens', '#266b58', 0.26, 0.10, { emissive: '#36a477', emissiveIntensity: 0.6 });
  const orange = material('Factory_Safety_Orange', '#b85a26', 0.42, 0.08);
  const white = material('Factory_Off_White_Paint', '#c0c7c7', 0.72, 0.02);

  function instance(geo, mat, p, size, group = props, quaternion = identity) {
    const key = `${group.uuid}/${geo.uuid}/${mat.uuid}`;
    if (!batches.has(key)) batches.set(key, { geo, mat, group, entries: [] });
    batches.get(key).entries.push({ p, size, quaternion: quaternion.clone() });
  }
  const box = (mat, p, size, group = props, bevel = false) => instance(bevel ? rounded : geometry, mat, p, size, group);
  function beam(mat, from, to, width, depth = width, group = overhead, round = false) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(yAxis, delta.clone().normalize());
    instance(round ? cylinder : geometry, mat, a.add(b).multiplyScalar(0.5).toArray(), [width, delta.length(), depth], group, quaternion);
  }
  function ring(mat, p, radius, axis = [0, 0, 1], group = services) {
    instance(torus, mat, p, [radius, radius, radius], group,
      new THREE.Quaternion().setFromUnitVectors(zAxis, new THREE.Vector3(...axis).normalize()));
  }

  function sign(name, text, p, width, height, { floor = false, muted = false } = {}) {
    const mat = material(name + '_Ink', muted ? '#9aaeb7' : '#d4c08b', 0.78, 0,
      { side: THREE.DoubleSide, transparent: floor, depthWrite: !floor, polygonOffset: true, polygonOffsetFactor: -1 });
    // Node-side geometry regression tests do not require a DOM or rasterizer.
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 256;
      const context = canvas.getContext('2d');
      if (!floor) { context.fillStyle = '#182a35'; context.fillRect(0, 0, canvas.width, canvas.height); }
      context.fillStyle = floor ? '#bdad7b' : '#e4e3d9';
      context.font = '600 100px "Microsoft YaHei", "Segoe UI", sans-serif';
      context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(text, 768, 132, 1430);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8; textures.add(texture); mat.map = texture; mat.color.set('#ffffff');
    }
    const geo = new THREE.PlaneGeometry(width, height); geometries.add(geo);
    const mesh = new THREE.Mesh(geo, mat); mesh.name = name; mesh.userData.label = text;
    mesh.position.fromArray(p); if (floor) mesh.rotation.x = -Math.PI / 2;
    signs.add(mesh); return mesh;
  }

  // The aisle stays unobstructed. End columns frame the bay, not the mill faces.
  for (const x of [-23, 23]) for (const z of [-11.6, 8.4]) {
    box(structure, [x, 5.5, z], [0.42, 11.1, 0.56], overhead);
    box(zinc, [x, 0.06, z], [0.9, 0.12, 0.95], overhead);
    box(yellow, [x, 0.56, z], [0.46, 0.95, 0.60], overhead);
    for (const dx of [-0.3, 0.3]) for (const dz of [-0.3, 0.3])
      box(dark, [x + dx, 0.16, z + dz], [0.07, 0.08, 0.07], overhead);
  }
  for (const z of [-11.6, 8.4]) {
    box(structure, [0, 10.75, z], [47, 0.62, 0.30], overhead);
    box(zinc, [0, 11.12, z], [47, 0.12, 0.16], overhead);
  }
  for (const x of [-22, -11, 0, 11, 22]) {
    beam(structure, [x, 12.35, -11.6], [x, 12.35, 8.4], 0.15, 0.18);
    beam(structure, [x, 11.40, -11.6], [x, 11.40, 8.4], 0.11, 0.13);
    for (let z = -11.6, index = 0; z < 8.3; z += 4, index++)
      beam(structure, [x, index % 2 ? 12.35 : 11.4, z], [x, index % 2 ? 11.4 : 12.35, z + 4], 0.07, 0.08);
  }

  // A parked bridge crane is a scene fixture, not a claimed live control device.
  for (const x of [-3.4, -1.6]) {
    box(yellow, [x, 11.45, -1.6], [0.60, 0.88, 20.5], overhead);
    box(yellow, [x, 11.93, -1.6], [0.88, 0.12, 20.5], overhead);
    for (const z of [-11.6, 8.4]) box(dark, [x, 11.4, z], [1.1, 0.42, 0.7], overhead, true);
  }
  box(dark, [-2.5, 11.94, -5.1], [2.75, 0.42, 2.3], overhead, true);
  box(yellow, [-2.5, 11.58, -5.1], [1.5, 0.5, 1.2], overhead, true);
  beam(zinc, [-3.0, 11.3, -5.1], [-3.0, 8.62, -5.1], 0.018, 0.018, overhead, true);
  beam(zinc, [-2.0, 11.3, -5.1], [-2.0, 8.62, -5.1], 0.018, 0.018, overhead, true);
  box(yellow, [-2.5, 8.55, -5.1], [1.24, 0.45, 0.45], overhead, true);
  const hookGeometry = new THREE.TorusGeometry(0.22, 0.045, 10, 28, Math.PI * 1.55); geometries.add(hookGeometry);
  const hook = new THREE.Mesh(hookGeometry, dark); hook.position.set(-2.5, 8.13, -5.1); overhead.add(hook);

  // Readable crane structure: runway end trucks, bridge walkway/railing,
  // trolley frame and a hazard-striped hook block so the trolley cannot look detached.
  for (const x of [-3.4, -1.6]) {
    for (const z of [-11.6, 8.4]) {
      box(dark, [x, 11.22, z], [1.0, 0.14, 0.64], overhead);
      beam(zinc, [x - 0.42, 11.14, z], [x + 0.42, 11.14, z], 0.17, 0.17, overhead, true);
    }
    box(zinc, [x - 0.56, 12.02, -1.6], [0.32, 0.05, 18.8], overhead);
    for (let z = -10.8; z <= 7.9; z += 3.1) box(yellow, [x - 0.56, 12.27, z], [0.05, 0.46, 0.05], overhead);
    box(yellow, [x - 0.56, 12.50, -1.6], [0.05, 0.05, 18.8], overhead);
  }
  beam(structure, [-3.4, 11.30, -5.1], [-1.6, 11.30, -5.1], 0.36, 0.36);
  box(dark, [-2.5, 11.38, -5.1], [1.9, 0.18, 1.58], overhead, true);
  beam(yellow, [-3.4, 11.42, -5.1], [-1.6, 11.42, -5.1], 0.20, 0.20, overhead, true);
  beam(zinc, [-3.12, 11.63, -5.1], [-1.88, 11.63, -5.1], 0.20, 0.20, overhead, true);
  for (const dx of [-0.34, 0, 0.34]) box(dark, [-2.5 + dx, 8.62, -4.865], [0.16, 0.18, 0.02], overhead);
  box(dark, [-2.5, 8.55, -4.88], [0.56, 0.18, 0.02], overhead);
  sign('Crane_Hook_Load_Label', '10 t', [-2.5, 8.55, -4.855], 0.46, 0.13, { muted: true });

  // Shared pipe headers, hangers, five service drops and shutoff hand wheels.
  for (const [height, z, radius, mat] of [[7.45, -9.1, 0.12, pipeBlue], [7.95, -9.5, 0.085, pipeGrey]]) {
    beam(mat, [-23, height, z], [23, height, z], radius, radius, services, true);
    for (const x of [-20, -10.4, -5.2, 0, 5.2, 10.4, 20]) {
      ring(zinc, [x, height, z], radius * 1.4, [1, 0, 0]);
      beam(structure, [x, height + 0.17, z], [x, 9.08, z], 0.035, 0.035, services);
    }
  }

  // Pipe rack support: columns, longitudinal beam, cross ties and braces.
  // Without this the hangers ended in mid-air above the service headers.
  for (const x of [-20, -10, 0, 10, 20]) {
    box(structure, [x, 4.55, -8.6], [0.24, 9.10, 0.24], services);
    box(yellow, [x, 0.36, -8.6], [0.54, 0.72, 0.54], services);
    box(zinc, [x, 0.04, -8.6], [0.76, 0.08, 0.76], services);
    beam(structure, [x, 9.08, -8.6], [x, 9.08, -9.3], 0.16, 0.16, services);
  }
  beam(structure, [-23, 9.08, -9.3], [23, 9.08, -9.3], 0.26, 0.22, services);
  for (const x of [-20, -10.4, -5.2, 0, 5.2, 10.4, 20]) {
    beam(structure, [x, 9.06, -9.5], [x, 9.06, -9.1], 0.11, 0.11, services);
  }
  for (let i = 0; i < 4; i++) {
    const x = -20 + i * 10;
    beam(structure, [x, 4.8, -8.6], [x + 10, 7.4, -8.6], 0.07, 0.07, services);
  }
  // Cable-tray supports: the slotted tray was also floating without吊点.
  for (const x of [-16, -8, 0, 8, 16]) {
    beam(structure, [x, 9.08, -9.3], [x, 7.9, -7.35], 0.07, 0.07, services);
    beam(structure, [x, 7.9, -9.3], [x, 7.9, -7.35], 0.10, 0.10, services);
  }
  for (const x of [-10.4, -5.2, 0, 5.2, 10.4]) {
    beam(pipeBlue, [x + 1.4, 7.45, -9.1], [x + 1.4, 2.3, -9.1], 0.07, 0.07, services, true);
    ring(zinc, [x + 1.4, 3.25, -9.1], 0.13, [0, 1, 0]);
    ring(pipeBlue, [x + 1.4, 3.7, -8.88], 0.18, [0, 0, 1]);
    beam(zinc, [x + 1.4, 3.7, -9.1], [x + 1.4, 3.7, -8.88], 0.035, 0.035, services, true);
    for (const delta of [-0.13, 0.13]) beam(pipeBlue, [x + 1.4 + delta, 3.7, -8.88], [x + 1.4 - delta, 3.7, -8.88], 0.018, 0.018, services);
  }
  for (const z of [-7.7, -7.0]) box(zinc, [0, 7.90, z], [34, 0.14, 0.05], services);
  for (let x = -17; x <= 17; x += 0.7) box(zinc, [x, 7.87, -7.35], [0.045, 0.055, 0.70], services);
  for (const [z, mat] of [[-7.18, rubber], [-7.33, copper], [-7.48, rubber]])
    beam(mat, [-17, 7.97, z], [17, 7.97, z], 0.035, 0.035, services, true);

  // Control cabinets behind the drive side; no made-up process readouts.
  for (const [index, x] of [-10.4, -5.2, 0, 5.2, 10.4].entries()) {
    box(dark, [x, 0.15, -10.5], [1.75, 0.3, 0.95], props, true);
    box(cabinet, [x, 1.4, -10.5], [1.65, 2.3, 0.85], props, true);
    for (const dx of [-0.405, 0.405]) {
      box(cabinetDoor, [x + dx, 1.44, -10.055], [0.79, 2.12, 0.035], props, true);
      box(dark, [x + dx + (dx < 0 ? 0.25 : -0.25), 1.32, -10.00], [0.045, 0.24, 0.06], props, true);
      for (let y = 0.55; y <= 0.95; y += 0.08) box(dark, [x + dx, y, -10.025], [0.48, 0.015, 0.014], props);
    }
    box(dark, [x, 2.03, -10.01], [0.45, 0.30, 0.035], props, true);
    box(green, [x + 0.58, 2.27, -9.99], [0.045, 0.045, 0.035], props, true);
    sign(`Cabinet_S${index + 1}_Nameplate`, `S${index + 1}  电气柜`, [x, 2.39, -10.025], 0.67, 0.12);
  }

  // Spare rolls on a workshop trolley, outside both strip travel and walkway.
  box(dark, [18.5, 0.43, -6.5], [2.8, 0.18, 2.5], props, true);
  for (const dx of [-1.05, 1.05]) for (const dz of [-0.9, 0.9])
    beam(rubber, [18.5 + dx - 0.12, 0.18, -6.5 + dz], [18.5 + dx + 0.12, 0.18, -6.5 + dz], 0.18, 0.18, props, true);
  for (const dx of [-0.85, 0, 0.85]) {
    beam(zinc, [18.5 + dx, 0.87, -7.55], [18.5 + dx, 0.87, -5.45], 0.22, 0.22, props, true);
    for (const z of [-7.70, -5.30]) beam(zinc, [18.5 + dx, 0.87, z - 0.15], [18.5 + dx, 0.87, z + 0.15], 0.11, 0.11, props, true);
  }
  box(orange, [21.0, 0.69, -8.4], [1.45, 1.25, 0.70], props, true);
  box(dark, [21.0, 1.36, -8.4], [1.55, 0.10, 0.75], props, true);
  for (const y of [0.45, 0.75, 1.05]) box(zinc, [21.0, y, -8.035], [0.6, 0.035, 0.035], props);

  // Two stored coils on saddles: architectural stock, never part of the live strip.
  const coilShape = new THREE.Shape(); coilShape.absarc(0, 0, 1.10, 0, Math.PI * 2, false);
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.35, 0, Math.PI * 2, true); coilShape.holes.push(hole);
  const coilGeometry = new THREE.ExtrudeGeometry(coilShape, { depth: 1.25, steps: 1, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.025, bevelThickness: 0.025, curveSegments: 48 });
  coilGeometry.translate(0, 0, -0.625); geometries.add(coilGeometry);
  for (const z of [-5.0, -8.2]) {
    box(dark, [-20.1, 0.16, z], [2.7, 0.27, 1.8], props, true);
    const coil = new THREE.Mesh(coilGeometry, zinc); coil.name = 'Stored_Coil_Presentation';
    coil.position.set(-20.1, 1.34, z); coil.castShadow = true; coil.receiveShadow = true; props.add(coil);
    for (let radius = 0.43; radius <= 1.05; radius += 0.075) ring(pipeGrey, [-20.1, 1.34, z + 0.66], radius, [0, 0, 1], props);
  }

  // Physical protective bollards, sparse barriers and pedestrian crossings.
  for (const x of [-20.5, -17.6, 17.6, 20.5]) for (const z of [4.7, 7.5]) {
    beam(yellow, [x, 0, z], [x, 0.93, z], 0.07, 0.07, props, true);
    for (const y of [0.3, 0.6]) beam(dark, [x, y, z], [x, y + 0.12, z], 0.073, 0.073, props, true);
    box(structure, [x, -0.015, z], [0.26, 0.04, 0.26], props);
  }
  for (const x of [-19.05, 19.05]) {
    beam(yellow, [x - 1.45, 0.66, 7.5], [x + 1.45, 0.66, 7.5], 0.04, 0.04, props, true);
    for (const dx of [-1.45, 1.45]) beam(zinc, [x + dx, 0.58, 7.5], [x + dx, 0.74, 7.5], 0.055, 0.055, props, true);
  }
  for (const x of [-19.5, 19.5]) for (let z = 5.2; z <= 7.1; z += 0.32)
    box(white, [x, -0.041, z], [1.0, 0.008, 0.13], props);
  for (const x of [-20.1, 18.5]) {
    for (const z of [-3.3, -9.6]) box(yellow, [x, -0.039, z], [3.7, 0.008, 0.035], props);
    for (const dx of [-1.85, 1.85]) box(yellow, [x + dx, -0.039, -6.45], [0.035, 0.008, 6.3], props);
  }
  // 用户要求删除：QCDKR 五机架冷轧车间实体招牌
  // sign('Cold_Rolling_Hall_Sign', 'QCDKR   五机架冷轧车间', [-1.0, 7.28, -12.52], 12.5, 0.88);
  for (const [index, x] of [-20, -10, 0, 10, 20].entries())
    sign(`Factory_Bay_${index + 1}`, `BAY 0${index + 1}`, [x, 10.88, -12.51], 2.0, 0.38, { muted: true });
  sign('Stored_Coil_Zone_Label', '备料区', [-20.1, -0.025, -2.65], 2.8, 0.52, { floor: true });
  sign('Maintenance_Zone_Label', '检修区', [18.5, -0.025, -2.65], 2.8, 0.52, { floor: true });
  sign('Operator_Aisle_Label', '人行通道  /  保持畅通', [0, -0.025, 6.15], 5.3, 0.48, { floor: true });

  const matrix = new THREE.Matrix4();
  for (const { geo, mat, group, entries } of batches.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, entries.length); mesh.name = mat.name + '_Instances';
    entries.forEach((item, index) => { matrix.compose(new THREE.Vector3(...item.p), item.quaternion, new THREE.Vector3(...item.size)); mesh.setMatrixAt(index, matrix); });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    mesh.castShadow = group === props; mesh.receiveShadow = group === props;
    group.add(mesh);
  }
  // 2026-11-01 用户要求顶部全清：吊钩载重牌(10 t)与跨间牌 BAY 01-05 一并隐藏；回滚：删除本段
  signs.traverse(object => { if (object.isMesh && /^(Crane_Hook_Load_Label|Factory_Bay_\d)$/.test(object.name)) object.visible = false; });
  root.userData.batchCount = batches.size;
  let scope = 'line';
  scene.add(root);
  return {
    root,
    setScope(value) { scope = value; },
    updateCamera(camera) { overhead.visible = scope !== 's5' && camera.position.y < 26; },
    dispose() { scene.remove(root); for (const item of geometries) item.dispose(); for (const item of materials) item.dispose(); for (const item of textures) item.dispose(); },
  };
}
