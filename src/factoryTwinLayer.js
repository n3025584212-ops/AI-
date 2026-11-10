import * as THREE from 'three';

// A separate presentation/monitoring layer. Live values come from processData;
// the explicitly labelled inspection event never writes to prediction inputs.
export const TWIN_STANDS = ['S1', 'S2', 'S3', 'S4', 'S5'];
const STAND_X = [-10.4, -5.2, 0, 5.2, 10.4];

export function twinSensorData(stand, processData) {
  const item = processData?.stands?.find(entry => entry.id === stand) || {};
  const value = (number, digits = 1) => Number.isFinite(Number(number)) ? Number(number).toFixed(digits) : '—';
  return [
    { key: 'force', short: 'F', name: '轧制力', value: value(item.force), unit: 't', measurement: 'force' },
    { key: 'speed', short: 'V', name: '轧制速度', value: value(item.speed, 0), unit: 'm/min', measurement: 'speed' },
    { key: 'tension', short: 'T', name: '后张力', value: value(item.tension), unit: 't', measurement: 'tension' },
    { key: 'bendingForce', short: 'B', name: '弯辊力', value: value(item.bendingForce), unit: 'kN', measurement: 'bendingForce' },
  ];
}

export function createFactoryTwinLayer(scene, { environment } = {}) {
  const root = new THREE.Group();
  root.name = 'Factory_Digital_Twin_Layer';
  root.userData.presentationOnly = true;
  const architecture = new THREE.Group();
  architecture.name = 'Factory_Environment_Pass';
  const telemetry = new THREE.Group();
  telemetry.name = 'Factory_Spatial_Telemetry';
  root.add(architecture, telemetry);
  const materials = new Set();
  const geometries = new Set();
  const textures = new Set();
  const batches = new Map();
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function mat(color, { roughness = 0.55, metalness = 0.2, emissive = '#000000', intensity = 0, ...extra } = {}) {
    const result = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity: intensity, envMap: environment || null, envMapIntensity: 0.65, ...extra });
    materials.add(result);
    return result;
  }
  function glow(color, opacity = 1) {
    const result = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false, toneMapped: false });
    materials.add(result);
    return result;
  }
  function instance(geo, material, p, s, q = quaternion.identity()) {
    const key = `${geo.uuid}/${material.uuid}`;
    if (!batches.has(key)) batches.set(key, { geo, material, entries: [] });
    batches.get(key).entries.push({ p, s, q: q.clone() });
  }
  const cube = new THREE.BoxGeometry(1, 1, 1); geometries.add(cube);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 16); geometries.add(cylinder);
  const box = (material, p, s) => instance(cube, material, p, s);
  const beam = (material, a, b, radius = 0.04) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const delta = end.clone().sub(start);
    const q = new THREE.Quaternion().setFromUnitVectors(up, delta.clone().normalize());
    instance(cylinder, material, start.add(end).multiplyScalar(0.5).toArray(), [radius, delta.length(), radius], q);
  };
  const graphite = mat('#24373e', { roughness: 0.62, metalness: 0.52 });
  const steel = mat('#799296', { roughness: 0.32, metalness: 0.82 });
  const enamel = mat('#316b77', { roughness: 0.32, metalness: 0.26 });
  const glass = mat('#407d89', { roughness: 0.16, metalness: 0.34, emissive: '#225e69', intensity: 0.65 });
  const concrete = mat('#4e5c5f', { roughness: 0.89, metalness: 0.04 });
  const warm = glow('#ffd7a0');
  const cyan = glow('#55f5e1');
  const softCyan = glow('#3bbfc4', 0.34);
  const rubber = mat('#101c22', { roughness: 0.91, metalness: 0.05 });

  // Continuous roads and service aisles, not separate product pedestals.
  const lineMat = mat('#748578', { roughness: 0.9, metalness: 0 });
  // 道路面：给每条车道铺 12 m 宽沥青带（横向 74 m、纵向 64 m），标线全部落在带内。
  const asphalt = mat('#2b3a42', { roughness: 0.95, metalness: 0.02 });
  for (const z of [9.0, -12.6, -32.6, -52.6]) box(asphalt, [0, -0.109, z], [74, 0.004, 12]);
  for (const x of [-31, 31]) box(asphalt, [x, -0.109, -25], [12, 0.004, 64]);
  const floorCyan = mat('#256b70', { roughness: 0.62, metalness: 0.1, emissive: '#39c9bf', intensity: 0.6 });
  for (const z of [9.0, -12.6, -32.6, -52.6]) {
    for (const dz of [-1.7, 1.7]) box(lineMat, [0, -0.105, z + dz], [64, 0.009, 0.07]);
    for (let x = -31; x < 31; x += 3.4) box(floorCyan, [x, -0.094, z], [1.35, 0.011, 0.028]);
  }
  for (const x of [-31, 31]) {
    for (const z of [-1.6, 1.6]) box(lineMat, [x + z, -0.105, -25], [0.07, 0.009, 64]);
  }

  // Utility cabinets and glazed control room create legible industrial context.
  for (const [x, z] of [[-28, 10.8], [-24, 10.8], [-20, 10.8]]) {
    box(graphite, [x, 0.15, z], [2.2, 0.3, 1.4]);
    box(enamel, [x, 1.35, z], [1.9, 2.2, 1.1]);
    box(steel, [x, 2.51, z], [2.1, 0.12, 1.3]);
    for (const dx of [-0.46, 0.46]) {
      box(graphite, [x + dx, 1.42, z + 0.565], [0.80, 1.9, 0.04]);
      box(glass, [x + dx, 1.78, z + 0.60], [0.59, 0.50, 0.018]);
      box(steel, [x + dx, 0.94, z + 0.61], [0.035, 0.2, 0.04]);
      box(cyan, [x + dx, 2.22, z + 0.61], [0.045, 0.028, 0.02]);
    }
  }
  box(concrete, [22.5, 0.12, 14.0], [13.0, 0.3, 6.4]);
  box(graphite, [22.5, 3.5, 14.0], [13.2, 0.3, 6.6]);
  box(glass, [22.5, 1.92, 17.1], [12.5, 2.6, 0.08]);
  for (let x = 16.4; x <= 28.6; x += 1.75) box(steel, [x, 1.88, 17.17], [0.07, 2.85, 0.08]);
  for (const x of [16.1, 28.9]) box(graphite, [x, 1.8, 14], [0.18, 3.35, 6.3]);
  for (const x of [18, 22, 26]) box(warm, [x, 3.33, 14.0], [2.6, 0.035, 0.18]);

  for (const { geo, material, entries } of batches.values()) {
    const mesh = new THREE.InstancedMesh(geo, material, entries.length);
    mesh.name = 'Twin_Environment_Instances';
    entries.forEach((entry, index) => {
      position.fromArray(entry.p); scale.fromArray(entry.s);
      matrix.compose(position, entry.q, scale); mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = material !== warm && material !== cyan;
    architecture.add(mesh);
  }

  // A physically attached strip-flow trace, driven by the live process speed.
  const flowTime = { value: 0 }, flowSpeed = { value: 1 };
  const flowCurve = new THREE.LineCurve3(new THREE.Vector3(-21.2, 3.13, 0), new THREE.Vector3(21.0, 3.13, 0));
  const flowGeometry = new THREE.TubeGeometry(flowCurve, 120, 0.035, 6, false); geometries.add(flowGeometry);
  const flowMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: flowTime, uSpeed: flowSpeed, uColor: { value: new THREE.Color('#57f5e0') } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `uniform float uTime; uniform float uSpeed; uniform vec3 uColor; varying vec2 vUv;
      void main(){float p=fract(vUv.x*13.0-uTime*0.62*uSpeed);float pulse=smoothstep(0.0,0.14,p)*(1.0-smoothstep(0.14,0.58,p));gl_FragColor=vec4(uColor*(0.65+pulse*2.0),0.32+pulse*0.65);}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  materials.add(flowMaterial);
  const flow = new THREE.Mesh(flowGeometry, flowMaterial); flow.name = 'Twin_Strip_Energy_Flow'; telemetry.add(flow);
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(-0.32, -0.12); arrowShape.lineTo(0.18, 0); arrowShape.lineTo(-0.32, 0.12); arrowShape.closePath();
  const arrowGeo = new THREE.ShapeGeometry(arrowShape); arrowGeo.rotateX(-Math.PI / 2); geometries.add(arrowGeo);
  const arrowCount = 17;
  const arrows = new THREE.InstancedMesh(arrowGeo, cyan, arrowCount);
  arrows.name = 'Twin_Material_Flow_Direction'; telemetry.add(arrows);

  // Spatial scan wave: a visual inspection state, not a claimed sensor reading.
  const scanTime = { value: 0 }, scanActive = { value: 0.75 }, scanColor = { value: new THREE.Color('#55e8d4') };
  const scanGeo = new THREE.PlaneGeometry(30, 22); scanGeo.rotateX(-Math.PI / 2); geometries.add(scanGeo);
  const scanMat = new THREE.ShaderMaterial({
    uniforms: { uTime: scanTime, uActive: scanActive, uColor: scanColor },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `uniform float uTime; uniform float uActive; uniform vec3 uColor; varying vec2 vUv;
      void main(){vec2 p=(vUv-.5)*2.;float r=length(p);float progress=fract(uTime*.115);float ring=exp(-pow((r-progress)*70.,2.));
      float edge=exp(-pow((r-.92)*95.,2.));float spokes=pow(max(0.,cos(atan(p.y,p.x)*20.)),28.);
      float alpha=(ring*.35+edge*.20+spokes*(1.-r)*.07)*smoothstep(1.,.8,r)*uActive;
      gl_FragColor=vec4(uColor*1.6,alpha);}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
  materials.add(scanMat);
  const scan = new THREE.Mesh(scanGeo, scanMat); scan.name = 'Twin_Spatial_Scan_Wave'; scan.position.set(0, 0.025, -2.1); telemetry.add(scan);
  const selectionGeo = new THREE.RingGeometry(1.4, 1.45, 64); selectionGeo.rotateX(-Math.PI / 2); geometries.add(selectionGeo);
  const selectionMat = glow('#58f4dc', 0.68);
  const selection = new THREE.Mesh(selectionGeo, selectionMat); selection.position.set(10.4, 0.05, -2.1); telemetry.add(selection);

  // Rail-mounted robot: carriage, sensor gimbal, lens, inspection beam.
  const robot = new THREE.Group(); robot.name = 'Twin_Rail_Inspection_Robot';
  const robotPart = (geo, material, p, s) => {
    const mesh = new THREE.Mesh(geo, material); mesh.position.fromArray(p); mesh.scale.fromArray(s); robot.add(mesh); return mesh;
  };
  robotPart(cube, enamel, [0, 0, 0], [1.25, 0.45, 0.82]);
  robotPart(cube, steel, [0, 0.27, 0], [1.48, 0.10, 0.9]);
  robotPart(cube, rubber, [0, -0.32, 0], [0.66, 0.30, 0.54]);
  for (const x of [-0.46, 0.46]) for (const z of [-0.38, 0.38]) robotPart(cylinder, rubber, [x, 0.4, z], [0.17, 0.12, 0.17]);
  robotPart(cylinder, steel, [0, -0.60, 0], [0.07, 0.35, 0.07]);
  robotPart(cube, enamel, [0, -0.83, -0.06], [0.56, 0.30, 0.50]);
  robotPart(cylinder, rubber, [0, -0.82, -0.36], [0.16, 0.12, 0.16]).rotation.x = Math.PI / 2;
  robotPart(cylinder, cyan, [0, -0.82, -0.43], [0.105, 0.015, 0.105]).rotation.x = Math.PI / 2;
  robotPart(cube, cyan, [0, -0.02, -0.43], [0.92, 0.032, 0.025]);
  robotPart(cylinder, warm, [0.45, 0.37, 0], [0.045, 0.22, 0.045]);
  robot.position.set(14.5, 6.65, 3.65); telemetry.add(robot);
  const rail = new THREE.Group(); rail.name = 'Twin_Inspection_Rail'; telemetry.add(rail);
  for (const z of [3.38, 3.92]) {
    const railMesh = new THREE.Mesh(cube, steel); railMesh.position.set(0, 7.15, z); railMesh.scale.set(32, 0.12, 0.09); rail.add(railMesh);
  }
  for (const x of STAND_X) {
    const support = new THREE.Mesh(cube, graphite); support.position.set(x, 6.65, 2.85); support.scale.set(0.12, 1.1, 0.14); rail.add(support);
    const bracket = new THREE.Mesh(cube, graphite); bracket.position.set(x, 7.15, 3.35); bracket.scale.set(0.18, 0.13, 1.2); rail.add(bracket);
  }
  const beamGeometry = new THREE.BufferGeometry();
  beamGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3)); geometries.add(beamGeometry);
  const beamMaterial = new THREE.LineBasicMaterial({ color: '#60f5dc', transparent: true, opacity: 0.66, depthTest: true, toneMapped: false }); materials.add(beamMaterial);
  const inspectionBeam = new THREE.Line(beamGeometry, beamMaterial); inspectionBeam.name = 'Twin_Robot_Inspection_Beam'; inspectionBeam.visible = false; telemetry.add(inspectionBeam);

  // 天空穹顶已按用户要求删除（2026-11-05「删掉，天空就天空搞什么穹顶」）：
  // 背景直接用 ThreeViewer 设置的 scene.background 纯色，不再画渐变天球。

  // A vertical scan halo makes the selected machine’s monitoring state legible
  // from the plant overview. It is an interface effect, not a sensor source.
  const scanHaloMaterial = new THREE.MeshBasicMaterial({ color: '#73f5d8', transparent: true, opacity: 0.42, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  materials.add(scanHaloMaterial);
  const scanHalos = new THREE.Group(); scanHalos.name = 'Twin_Selected_Scan_Halo'; telemetry.add(scanHalos);
  for (let index = 0; index < 3; index++) {
    const geometry = new THREE.TorusGeometry(index === 0 ? 2.35 : 2.8, index === 0 ? 0.045 : 0.025, 8, 64);
    geometry.rotateX(Math.PI / 2); geometries.add(geometry);
    const haloMaterial = scanHaloMaterial.clone(); materials.add(haloMaterial);
    const halo = new THREE.Mesh(geometry, haloMaterial); halo.userData.phase = index / 3; scanHalos.add(halo);
  }
  const scanColumnGeometry = null;
  const scanColumnMaterial = null;
  
  scene.add(root);
  // 真实厂区模式：不叠加扫描波、线框、能量光带或巡检轨道；这些会破坏设备判读。
  flow.visible = false;
  arrows.visible = false;
  scan.visible = false;
  selection.visible = false;
  scanHalos.visible = false;
  robot.visible = false;
  rail.visible = false;
  inspectionBeam.visible = false;
  let robotTargetX = 14.5, inspectionStand = null, selected = 'S5', speed = 0;
  let onArrive = null, scanEnabled = true;
  const targetWorld = new THREE.Vector3();
  return {
    root, robot,
    toggleScan() {
      scanEnabled = !scanEnabled;
      scanActive.value = scanEnabled ? (inspectionStand ? 1.25 : 0.75) : 0;
      return scanEnabled;
    },
    setSelected(stand) {
      selected = TWIN_STANDS.includes(stand) ? stand : 'S5';
      selection.position.x = STAND_X[TWIN_STANDS.indexOf(selected)];
      scanHalos.position.set(selection.position.x, 0, -2.1);
    },
    setProcess(data, currentSpeed) {
      speed = Number(currentSpeed) || 0;
      flowSpeed.value = speed > 0 ? 1 : 0;
    },
    inspect(stand, callback) {
      if (!TWIN_STANDS.includes(stand)) return false;
      inspectionStand = stand;
      robotTargetX = STAND_X[TWIN_STANDS.indexOf(stand)];
      targetWorld.set(robotTargetX, 3.5, -0.1);
      scanColor.value.set('#ffc56e'); scanActive.value = scanEnabled ? 1.25 : 0;
      scan.position.set(robotTargetX, 0.04, -2.1);
      onArrive = callback || null;
      inspectionBeam.visible = true;
      return true;
    },
    clearInspection() {
      inspectionStand = null; inspectionBeam.visible = false; onArrive = null;
      scan.position.set(0, 0.025, -2.1); scanColor.value.set('#55e8d4'); scanActive.value = scanEnabled ? 0.75 : 0;
    },
    update(dt, elapsed) {
      scanTime.value = elapsed;
      flowTime.value = elapsed;
      selectionMat.opacity = 0.44 + Math.sin(elapsed * 2.0) * 0.18;
      for (const [index, halo] of scanHalos.children.entries()) {
        if (!halo.isMesh) continue;
        const phase = (elapsed * 0.24 + index / 3) % 1;
        halo.position.y = 0.24 + phase * 7.2;
        halo.scale.setScalar(0.72 + phase * 0.5);
        halo.material.opacity = (1 - phase) * 0.24 + 0.06;
      }
      scanColumnMaterial && (scanColumnMaterial.uniforms.uTime.value = elapsed);
      for (let index = 0; index < arrowCount; index++) {
        const phase = (index / arrowCount + elapsed * (speed > 0 ? 0.023 : 0)) % 1;
        position.set(-21 + phase * 42, 3.19, 0);
        matrix.compose(position, quaternion.identity(), scale.setScalar(0.7)); arrows.setMatrixAt(index, matrix);
      }
      arrows.instanceMatrix.needsUpdate = true;
      const difference = robotTargetX - robot.position.x;
      if (Math.abs(difference) > 0.05) robot.position.x += difference * Math.min(1, dt * 0.95);
      else if (inspectionStand && onArrive) { const callback = onArrive; onArrive = null; callback(inspectionStand); }
      robot.rotation.y = THREE.MathUtils.lerp(robot.rotation.y, inspectionStand ? 0 : -0.1, Math.min(1, dt * 2));
      if (inspectionBeam.visible) {
        const attr = beamGeometry.attributes.position;
        attr.setXYZ(0, robot.position.x, 5.80, 3.22);
        attr.setXYZ(1, robotTargetX, 3.5, -0.1);
        attr.setXYZ(2, robot.position.x, 5.80, 3.22); attr.needsUpdate = true;
        beamGeometry.computeBoundingSphere();
        beamMaterial.opacity = 0.44 + Math.sin(elapsed * 5) * 0.20;
      }
    },
    get state() { return { stand: inspectionStand, robotX: robot.position.x, scanning: Boolean(inspectionStand) }; },
    dispose() {
      scene.remove(root);
      geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); textures.forEach(item => item.dispose());
    },
  };
}
