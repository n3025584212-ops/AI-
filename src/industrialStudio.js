import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

// Narrow bright cards separated by dark space create readable metal reflections.
// The probe is built once. Four scene area lights keep the per-frame cost
// bounded; only the warm overhead key casts a shadow.
export function createIndustrialStudio(renderer, scene) {
  RectAreaLightUniformsLib.init();
  const lights = new THREE.Group();
  lights.name = 'Industrial_Hall_Lighting';
  const probe = new THREE.Scene();
  probe.background = new THREE.Color().setRGB(0.0015, 0.004, 0.009);
  const cards = [
    { name: 'Overhead_Key', p: [-7, 12, 5], target: [-2, 3, 0], size: [25, 1.15], rgb: [0.91, 0.96, 1], light: 5.2, radiance: 14 },
    { name: 'Rear_White_Edge', p: [2, 11, -7], target: [0, 3, 0], size: [31, 0.65], rgb: [0.72, 0.85, 1], light: 2.0, radiance: 11 },
    { name: 'End_Steel_Reflection', p: [19, 8, 5], target: [8, 3, 0], size: [2.5, 6], rgb: [1, 0.86, 0.65], light: 1.3, radiance: 6 },
    { name: 'Operator_Fill', p: [-5, 6, 12], target: [-1, 3, 0], size: [20, 3.2], rgb: [0.82, 0.90, 1], light: 0.65, radiance: 2.1 },
    { name: 'Roll_Face_White_Reflection', p: [-3, 1.3, 12], target: [0, 3, 0], size: [18, 0.55], rgb: [0.90, 0.96, 1], radiance: 9 },
    { name: 'Tall_Blue_Reflection', p: [11, 3.3, 10], target: [0, 3, 0], size: [1.3, 7], rgb: [0.22, 0.51, 0.74], radiance: 3 },
    { name: 'Narrow_Warm_Reflection', p: [-14, 4, -2], target: [0, 3, 0], size: [0.8, 8], rgb: [1, 0.82, 0.61], radiance: 6 },
    { name: 'Ceiling_Secondary_Reflection', p: [4, 15, -1], target: [0, 3, 0], size: [29, 0.42], rgb: [0.64, 0.82, 1], radiance: 9 },
  ];
  for (const item of cards) {
    const color = new THREE.Color().setRGB(...item.rgb);
    if (item.light) {
      const light = new THREE.RectAreaLight(color, item.light, ...item.size);
      light.name = item.name;
      light.position.fromArray(item.p);
      light.lookAt(...item.target);
      lights.add(light);
    }
    const reflector = new THREE.Mesh(
      new THREE.PlaneGeometry(...item.size),
      new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(item.radiance), side: THREE.DoubleSide, toneMapped: false }),
    );
    reflector.position.fromArray(item.p).sub(new THREE.Vector3(0, 3, 0));
    reflector.lookAt(new THREE.Vector3(...item.target).sub(new THREE.Vector3(0, 3, 0)));
    probe.add(reflector);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(probe, 0.008, 0.1, 100);
  pmrem.dispose();
  probe.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
  const previousEnvironment = scene.environment;
  const previousIntensity = scene.environmentIntensity;
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.42;
  lights.add(new THREE.HemisphereLight(0xacc5d5, 0x11100c, 0.12));
  const key = new THREE.DirectionalLight(0xffeed8, 2.8);
  key.position.set(-13, 16, 8);
  key.target.position.set(0, 2.5, -1.5);
  lights.add(key, key.target);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -26, right: 26, top: 16, bottom: -16, near: 1, far: 70 });
  key.shadow.bias = -0.00005;
  key.shadow.normalBias = 0.016;
  key.shadow.radius = 2;
  key.shadow.blurSamples = 12;
  scene.add(lights);
  return {
    environment,
    dispose() {
      key.shadow.dispose();
      if (scene.environment === environment.texture) {
        scene.environment = previousEnvironment;
        scene.environmentIntensity = previousIntensity;
      }
      environment.dispose();
      scene.remove(lights);
    },
  };
}
