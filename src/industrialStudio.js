import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { industrialLighting } from './industrialPresentation.js';

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
    { name: 'Operator_Fill', p: [-5, 6, 12], target: [-1, 3, 0], size: [24, 5.0], rgb: [0.88, 0.94, 1], light: 1.8, radiance: 3.5 },
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
  scene.environmentIntensity = 0.62;
  const hemisphere = new THREE.HemisphereLight(0xd8e8df, 0x35443d, 0.6);
  lights.add(hemisphere);
  const key = new THREE.DirectionalLight(0xffeed8, 3.6);
  key.position.set(-13, 16, 8);
  key.target.position.set(0, 2.5, -1.5);
  lights.add(key, key.target);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -26, right: 26, top: 16, bottom: -16, near: 1, far: 70 });
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.045;
  key.shadow.radius = 2;
  key.shadow.blurSamples = 12;
  const bayLamps = [];
  for (const x of [-20, -10, 0, 10, 20]) {
    const lamp = new THREE.SpotLight(0xffd3a0, 110, 23, 0.70, 0.78, 2);
    lamp.name = `Factory_Practical_Lamp_${x}`;
    lamp.position.set(x, 9.35, -11.35);
    lamp.target.position.set(x, 0.4, -4.0);
    // Architectural practicals illuminate the bay; the one key owns shadows.
    lamp.castShadow = false; bayLamps.push(lamp); lights.add(lamp, lamp.target);
  }
  scene.add(lights);
  // 昼夜档位（对标景区片的天气/时段切换）：与 workshop/inspection 明亮档位相乘。
  let currentMode = 'workshop', currentDaypart = 'day';
  const DAYPART_LIGHT = {
    day: { keyColor: 0xffeed8, keyScale: 1.0, hemiSky: 0xc0d6e5, hemiGround: 0x35302b, hemiScale: 1.1, exposureScale: 1.0, lampScale: 1.0 },
    dusk: { keyColor: 0xffb066, keyScale: 0.7, hemiSky: 0xd9a37a, hemiGround: 0x2a2230, hemiScale: 1.4, exposureScale: 1.12, lampScale: 1.1 },
    night: { keyColor: 0x9db8e8, keyScale: 0.48, hemiSky: 0x33465e, hemiGround: 0x101820, hemiScale: 1.6, exposureScale: 0.9, lampScale: 1.35 },
  };
  function applyLighting() {
    const profile = industrialLighting(currentMode);
    const part = DAYPART_LIGHT[currentDaypart] || DAYPART_LIGHT.day;
    renderer.toneMappingExposure = profile.exposure * part.exposureScale;
    scene.environmentIntensity = profile.environment * (currentDaypart === 'night' ? 0.7 : 1);
    key.color.set(part.keyColor);
    key.intensity = profile.key * part.keyScale;
    hemisphere.color.set(part.hemiSky);
    hemisphere.groundColor.set(part.hemiGround);
    hemisphere.intensity = profile.hemisphere * part.hemiScale;
    lights.getObjectByName('Operator_Fill').intensity = profile.fill;
    for (const lamp of bayLamps) lamp.intensity = (currentMode === 'inspection' ? 45 : 110) * part.lampScale;
  }
  return {
    environment,
    setMode(mode = 'workshop') { currentMode = mode; applyLighting(); },
    setDaypart(name = 'day') { if (DAYPART_LIGHT[name]) { currentDaypart = name; applyLighting(); } },
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
