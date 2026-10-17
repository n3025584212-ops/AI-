import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { installStripFlow } from './industrialMotion.js';

// Upper external tangent followed by a short wrap on a supported guide roll.
// Radii describe the strip mid-surface, so its underside touches each barrel.
export function createCoilStripRoute({ jointX, stripY, centerZ = 0, side, thickness = 0.004,
  coilRadius = 1.16, coilY = 1.44, coilOffset = 2.65, guideRadius = 0.26, guideOffset = 0.65 }) {
  const coil = new THREE.Vector2(jointX + side * coilOffset, coilY);
  const guide = new THREE.Vector2(jointX + side * guideOffset, stripY - guideRadius - thickness / 2);
  const rc = coilRadius + thickness / 2, rg = guideRadius + thickness / 2;
  const delta = guide.clone().sub(coil), distance = delta.length();
  if (distance <= Math.abs(rc - rg)) throw new RangeError('Coil and guide have no external tangent');
  const u = delta.clone().divideScalar(distance), k = (rc - rg) / distance;
  const perpendicular = new THREE.Vector2(-u.y, u.x).multiplyScalar(Math.sqrt(1 - k * k));
  const normals = [u.clone().multiplyScalar(k).add(perpendicular), u.clone().multiplyScalar(k).sub(perpendicular)];
  const normal = normals[0].y > normals[1].y ? normals[0] : normals[1];
  const coilContact = coil.clone().addScaledVector(normal, rc);
  const guideContact = guide.clone().addScaledVector(normal, rg);
  const guideAngle = Math.atan2(normal.y, normal.x), samples = [];
  const sample = (point, n) => ({ point: new THREE.Vector3(point.x, point.y, centerZ), normal: new THREE.Vector3(n.x, n.y, 0) });
  samples.push(sample(coilContact, normal), sample(guideContact, normal));
  for (let i = 1; i <= 12; i++) {
    const angle = THREE.MathUtils.lerp(guideAngle, Math.PI / 2, i / 12), n = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
    samples.push(sample(guide.clone().addScaledVector(n, rg), n));
  }
  samples.push(sample(new THREE.Vector2(jointX, stripY), new THREE.Vector2(0, 1)));
  if (side > 0) samples.reverse();
  return { samples, coil, guide, coilContact, guideContact, normal, guideAngle, coilRadius, guideRadius,
    sourceEnd: [jointX, stripY, centerZ], coilTop: [coil.x, coilY + coilRadius, centerZ] };
}

function stripRibbon(samples, width, thickness, jointX, sourceAtEnd) {
  const positions = [], indices = [], flowCoordinates = [], lengths = [0];
  for (let i = 1; i < samples.length; i++) lengths.push(lengths[i - 1] + samples[i].point.distanceTo(samples[i - 1].point));
  const flowOrigin = jointX - (sourceAtEnd ? lengths.at(-1) : 0);
  for (let i = 0; i < samples.length; i++) {
    const { point, normal } = samples[i];
    for (const h of [thickness / 2, -thickness / 2]) for (const z of [-width / 2, width / 2]) {
      positions.push(point.x + normal.x * h, point.y + normal.y * h, point.z + z);
      flowCoordinates.push(flowOrigin + lengths[i]);
    }
    if (i < samples.length - 1) {
      const a = i * 4, b = a + 4;
      indices.push(a,b,a+1,a+1,b,b+1,a+2,a+3,b+2,a+3,b+3,b+2,a,a+2,b,a+2,b+2,b,a+1,b+1,a+3,a+3,b+1,b+3);
    }
  }
  const last = (samples.length - 1) * 4;
  indices.push(0,1,2,1,3,2,last,last+2,last+1,last+1,last+2,last+3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('stripDistance', new THREE.Float32BufferAttribute(flowCoordinates, 1));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

function installCoilLayers(material) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = `varying vec3 vCoilLocal; varying vec3 vCoilRadial;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoilLocal = position; vCoilRadial = normalMatrix * vec3(normalize(position.xy), 0.0);');
    shader.fragmentShader = `varying vec3 vCoilLocal; varying vec3 vCoilRadial;\n${shader.fragmentShader}`
      .replace('#include <color_fragment>', `#include <color_fragment>
        float radius = length(vCoilLocal.xy);
        float ringPhase = radius * 27.0;
        float ringPixel = max(fwidth(ringPhase), 0.001);
        float ringDistance = abs(fract(ringPhase + 0.5) - 0.5);
        float ringSeam = 1.0 - smoothstep(0.045, 0.045 + ringPixel * 0.75, ringDistance);
        ringSeam = mix(0.09, ringSeam, 1.0 - smoothstep(0.55, 1.05, ringPixel));
        float coilBands = sin(radius * 57.0 + 0.22 * sin(radius * 103.0));
        float bandVisibility = 1.0 - smoothstep(0.5, 1.1, fwidth(radius * 9.1));
        diffuseColor.rgb *= 0.99 - ringSeam * 0.115 + coilBands * 0.015 * bandVisibility;
      `).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = 0.32 + ringSeam * 0.035 + coilBands * 0.009 * bandVisibility;
      `).replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_ANISOTROPY
          vec3 coilRadial = normalize(vCoilRadial - normal * dot(normal, vCoilRadial));
          material.anisotropyT = normalize(cross(normal, coilRadial));
          material.anisotropyB = coilRadial;
        #endif
      `);
  };
  material.customProgramCacheKey = () => 'presentation-coil-subtle-cut-end-v7';
}

// Presentation attachments, not source-equipment replicas. The entry reuses
// the existing guide-roll/support pieces as a low strip infeed; the exit keeps
// its supported mandrel and coil. The original GLB stays unchanged.
// https://www.sms-group.com/plants/all-plants/tandem-cold-mills-steel/
// https://www.primetals.com/en/metals-magazine/plug-in-maintenance-advancing-tandem-cold-mills/
// The original GLB and its roll bodies remain unchanged.
export function createIndustrialCoils(scene, stripBounds, environment, sharedTransportDistance = null) {
  const root = new THREE.Group(); root.name = 'Presentation_Uncoiler_And_Recoiler'; root.userData.presentationOnly = true;
  const geometries = new Set(), materials = new Set(), spinning = [];
  const transportDistance = sharedTransportDistance || { value: 0 };
  const center = stripBounds.getCenter(new THREE.Vector3()), width = stripBounds.max.z - stripBounds.min.z;
  const stripY = center.y, thickness = Math.max(0.004, stripBounds.max.y - stripBounds.min.y);
  const radius = 1.16, bore = 0.46, coilY = 1.44, bevel = 0.028;
  const mat = (name, color, metalness, roughness, extra = {}) => {
    const value = new THREE.MeshStandardMaterial({ color, metalness, roughness, envMap: environment, envMapIntensity: 0.8, ...extra });
    value.name = name; materials.add(value); return value;
  };
  const steel = mat('Coil_Outer_Brushed_Steel', '#89979f', 1, 0.28, { envMapIntensity: 0.95 });
  const sideSteel = new THREE.MeshPhysicalMaterial({ color: '#879399', metalness: 1, roughness: 0.33,
    side: THREE.DoubleSide, envMap: environment, envMapIntensity: 0.95, anisotropy: 0.16 });
  sideSteel.name = 'Coil_Layered_Sidewall'; materials.add(sideSteel); installCoilLayers(sideSteel);
  const darkSteel = mat('Coil_Inner_Bore', '#303d45', 0.88, 0.37, { side: THREE.DoubleSide });
  const paint = mat('Coiler_Base_Blue_Paint', '#173f5b', 0.04, 0.38, { envMapIntensity: 0.52 });
  const base = mat('Coiler_Base_Machined_Steel', '#34424a', 0.82, 0.43);
  const chrome = mat('Coiler_Shaft_Steel', '#8597a0', 1, 0.26);
  const bolts = mat('Coiler_Zinc_Fasteners', '#99a4a9', 0.91, 0.3);
  const band = mat('Strip_Coil_Transition', '#abb8c0', 0.98, 0.3, { side: THREE.DoubleSide });
  installStripFlow(band, transportDistance, { pathAttribute: true });
  const mesh = (name, geometry, material, p, parent = root) => {
    geometries.add(geometry); const object = new THREE.Mesh(geometry, material);
    object.name = name; object.userData.presentationOnly = true;
    object.position.fromArray(p); object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
  };
  const box = (name, material, p, size, rounding = 0.035) =>
    mesh(name, new RoundedBoxGeometry(...size, 2, Math.min(rounding, ...size.map(v => v / 4))), material, p);
  const cylinderZ = (name, material, p, r, length, parent = root, segments = 64) => {
    const geometry = new THREE.CylinderGeometry(r, r, length, segments); geometry.rotateX(Math.PI / 2);
    return mesh(name, geometry, material, p, parent);
  };
  const latheZ = (name, material, p, points, parent) => {
    const geometry = new THREE.LatheGeometry(points.map(v => new THREE.Vector2(...v)), 128); geometry.rotateX(Math.PI / 2);
    return mesh(name, geometry, material, p, parent);
  };
  const bearingBolts = (name, p, pitch, parent = root) => {
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      cylinderZ(`${name}_Bolt_${i}`, bolts, [p[0] + Math.cos(a) * pitch, p[1] + Math.sin(a) * pitch, p[2]], 0.041, 0.046, parent, 6);
    }
  };
  const joints = [];
  for (const side of [-1, 1]) {
    const label = side < 0 ? 'Uncoiler' : 'Recoiler';
    const jointX = side < 0 ? stripBounds.min.x : stripBounds.max.x;
    if (side < 0) {
      // Reshape only the former left reel: two metal support rolls at the
      // existing passline, with a thin uninterrupted strip into the source GLB.
      // Reuse the soleplate footprint so whole-line framing does not change.
      const entryX = jointX - 2.65, guideX = jointX - 0.65;
      const guideRadius = 0.26, guideY = stripY - guideRadius - thickness / 2;
      box(`${label}_Foundation`, base, [entryX, 0.10, center.z - 0.42], [2.74, 0.20, width + 2.65]);
      for (const [prefix, x] of [[label, entryX], [`${label}_Guide`, guideX]]) {
        if (x === guideX) box(`${prefix}_Foundation`, base, [x, 0.14, center.z], [0.92, 0.28, width + 1.22]);
        box(`${prefix}_Crossmember`, paint, [x, guideY - 0.64, center.z], [0.36, 0.23, width + 0.65]);
        for (const sign of [-1, 1]) {
          const z = center.z + sign * (width / 2 + 0.30);
          box(`${prefix}_Pedestal_${sign}`, paint, [x, (guideY + 0.25) / 2, z], [0.40, guideY - 0.25, 0.40]);
          box(`${prefix}_Bearing_${sign}`, base, [x, guideY, z], [0.54, 0.54, 0.47], 0.08);
          cylinderZ(`${prefix}_Bearing_Cap_${sign}`, chrome, [x, guideY, z + sign * 0.25], 0.17, 0.045);
        }
        const guide = new THREE.Group(); guide.name = `${prefix}_Rotating_Guide_Roll`;
        guide.position.set(x, guideY, center.z); root.add(guide);
        cylinderZ(`${prefix}_Barrel`, chrome, [0, 0, 0], guideRadius, width + 0.12, guide);
        cylinderZ(`${prefix}_Shaft`, darkSteel, [0, 0, 0], 0.13, width + 1.22, guide);
        spinning.push({ object: guide, radius: guideRadius });
      }
      const startX = entryX - 1.30;
      const samples = [startX, entryX, guideX, jointX].map(x => ({
        point: new THREE.Vector3(x, stripY, center.z), normal: new THREE.Vector3(0, 1, 0),
      }));
      const connection = mesh(`${label}_Tangent_Strip_Connection`, stripRibbon(samples, width, thickness, jointX, true), band, [0, 0, 0]);
      connection.userData.part = 'strip';
      joints.push({ side: label, sourceEnd: [jointX, stripY, center.z], coilTop: [entryX, stripY, center.z],
        coilContact: [entryX, stripY, center.z], guideContact: [guideX, stripY, center.z],
        guideTop: [guideX, stripY, center.z], path: 'horizontal-entry / guide-rolls / horizontal-passline', width, thickness });
      continue;
    }
    const route = createCoilStripRoute({ jointX, stripY, centerZ: center.z, side, thickness, coilRadius: radius, coilY });
    const coilX = route.coil.x, guideX = route.guide.x, guideY = route.guide.y;
    const coil = new THREE.Group(); coil.name = `Presentation_${label}_Rotating_Coil`;
    coil.position.set(coilX, coilY, center.z); root.add(coil); spinning.push({ object: coil, radius });
    // A quarter-round joins the cut end to the outer wrap instead of a sharp
    // cylinder/ring seam. The inner lip has the same small machined transition.
    const outerProfile = [];
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 10;
      outerProfile.push([radius - bevel + bevel * Math.cos(a), -width / 2 + bevel + bevel * Math.sin(a)]);
    }
    for (let i = 0; i <= 5; i++) {
      const a = i * Math.PI / 10;
      outerProfile.push([radius - bevel + bevel * Math.cos(a), width / 2 - bevel + bevel * Math.sin(a)]);
    }
    latheZ(`${label}_Steel_Outer_Wrap`, steel, [0, 0, 0], outerProfile, coil);
    latheZ(`${label}_Open_Inner_Bore`, darkSteel, [0, 0, 0], [
      [bore + bevel, -width / 2], [bore, -width / 2 + bevel], [bore, width / 2 - bevel], [bore + bevel, width / 2],
    ], coil);
    for (const face of [-1, 1]) {
      const disk = mesh(`${label}_${face < 0 ? 'Drive' : 'Operator'}_Layered_Sidewall`,
        new THREE.RingGeometry(bore + bevel, radius - bevel, 128, 1), sideSteel, [0, 0, face * width / 2], coil);
      if (face < 0) disk.rotation.y = Math.PI;
    }
    // The expanded shoes support the bore; only their narrow axial gaps stay
    // dark. A reel in operation does not have a largely empty eye on a pin.
    cylinderZ(`${label}_Mandrel_Core`, darkSteel, [0, 0, -0.08], 0.29, width + 0.66, coil);
    for (let i = 0; i < 4; i++) {
      const shoe = new THREE.CylinderGeometry(bore - 0.007, bore - 0.007, width + 0.12, 24, 1, false,
        i * Math.PI / 2 + 0.018, Math.PI / 2 - 0.036); shoe.rotateX(Math.PI / 2);
      mesh(`${label}_Expanding_Mandrel_Shoe_${i}`, shoe, chrome, [0, 0, 0], coil);
    }
    cylinderZ(`${label}_Mandrel_Nose`, chrome, [0, 0, width / 2 + 0.29], 0.22, 0.68, coil);
    // Low soleplate, a substantial rear bearing/gear casing, and an outboard
    // swing support form a visible load path from mandrel down to the floor.
    box(`${label}_Foundation`, base, [coilX, 0.10, center.z - 0.42], [2.74, 0.20, width + 2.65]);
    const rearZ = center.z - width / 2 - 0.6, frontZ = center.z + width / 2 + 0.5;
    box(`${label}_Rear_Gear_Casing`, paint, [coilX, 1.10, rearZ], [1.22, 1.84, 0.96], 0.085);
    box(`${label}_Rear_Gear_Foot`, base, [coilX, 0.3, rearZ], [1.63, 0.24, 1.18]);
    cylinderZ(`${label}_Rear_Bearing_Boss`, base, [coilX, coilY, rearZ + 0.52], 0.57, 0.16);
    cylinderZ(`${label}_Rear_Bearing_Lid`, chrome, [coilX, coilY, rearZ + 0.61], 0.40, 0.05);
    bearingBolts(`${label}_Rear_Bearing`, [coilX, coilY, rearZ + 0.65], 0.48);
    cylinderZ(`${label}_Drive_Motor`, paint, [coilX, coilY, rearZ - 0.83], 0.38, 0.75);
    for (let i = 0; i < 5; i++) cylinderZ(`${label}_Motor_Cooling_Rib_${i}`, base,
      [coilX, coilY, rearZ - 0.56 - i * 0.12], 0.405, 0.026);
    box(`${label}_Motor_Foot`, paint, [coilX, 0.63, rearZ - 0.79], [0.74, 0.9, 0.70]);
    const arm = new THREE.Shape();
    arm.moveTo(side * 0.60, 0.22); arm.lineTo(side * 0.17, coilY + 0.08);
    arm.lineTo(-side * 0.16, coilY + 0.08); arm.lineTo(-side * 0.04, 0.22); arm.closePath();
    const armGeometry = new THREE.ExtrudeGeometry(arm, { depth: 0.28, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 2, steps: 1 });
    mesh(`${label}_Outboard_Swing_Support`, armGeometry, paint, [coilX, 0, frontZ - 0.14]);
    box(`${label}_Outboard_Support_Foot`, base, [coilX + side * 0.26, 0.25, frontZ], [1.05, 0.18, 0.63]);
    cylinderZ(`${label}_Outboard_Bearing`, base, [coilX, coilY, frontZ], 0.335, 0.34);
    cylinderZ(`${label}_Outboard_Bearing_Cap`, chrome, [coilX, coilY, frontZ + 0.18], 0.24, 0.046);
    bearingBolts(`${label}_Outboard_Bearing`, [coilX, coilY, frontZ + 0.21], 0.278);
    // The guide roll has two bearing pedestals and a crossmember. It turns at
    // the same strip velocity but is not part of the original 30 work rolls.
    box(`${label}_Guide_Foundation`, base, [guideX, 0.14, center.z], [0.92, 0.28, width + 1.22]);
    box(`${label}_Guide_Crossmember`, paint, [guideX, guideY - 0.64, center.z], [0.36, 0.23, width + 0.65]);
    for (const sign of [-1, 1]) {
      const z = center.z + sign * (width / 2 + 0.30);
      box(`${label}_Guide_Pedestal_${sign}`, paint, [guideX, (guideY + 0.25) / 2, z], [0.40, guideY - 0.25, 0.40]);
      box(`${label}_Guide_Bearing_${sign}`, base, [guideX, guideY, z], [0.54, 0.54, 0.47], 0.08);
      cylinderZ(`${label}_Guide_Bearing_Cap_${sign}`, chrome, [guideX, guideY, z + sign * 0.25], 0.17, 0.045);
    }
    const guide = new THREE.Group(); guide.name = `${label}_Rotating_Guide_Roll`; guide.position.set(guideX, guideY, center.z); root.add(guide);
    cylinderZ(`${label}_Guide_Barrel`, chrome, [0, 0, 0], route.guideRadius, width + 0.12, guide);
    cylinderZ(`${label}_Guide_Shaft`, darkSteel, [0, 0, 0], 0.13, width + 1.22, guide);
    spinning.push({ object: guide, radius: route.guideRadius });
    const connection = mesh(`${label}_Tangent_Strip_Connection`, stripRibbon(route.samples, width, thickness, jointX, side < 0), band, [0, 0, 0]);
    connection.userData.part = 'strip';
    joints.push({ side: label, sourceEnd: route.sourceEnd, coilTop: route.coilTop,
      coilContact: [...route.coilContact.toArray(), center.z], guideContact: [...route.guideContact.toArray(), center.z],
      guideTop: [guideX, stripY, center.z], path: 'tangent-line / guide-wrap / horizontal-passline', width, thickness });
  }
  scene.add(root); root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  return {
    root, bounds, joints,
    setScope(scope, showStrip = true) { root.visible = scope === 'line' && showStrip; },
    advance(distance) {
      if (!root.visible) return;
      if (!sharedTransportDistance) transportDistance.value += distance;
      for (const item of spinning) item.object.rotation.z -= distance / item.radius;
    },
    rebindEnvironment(previous, next) { for (const material of materials) if (material.envMap === previous) { material.envMap = next; material.needsUpdate = true; } },
    dispose() { scene.remove(root); for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose(); },
  };
}
