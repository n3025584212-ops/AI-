import * as THREE from 'three';

// 对标数字孪生大片的氛围层：渐变天穹 + 高空云带 + 昼夜三档。
// three.js 近似实现——不做 GIS 地形与真实云层穿越，只给"室外厂区"
// 的光环境、纵深与开场运镜的穿云观感。参照：黄山景区数字孪生片。

const DAYPARTS = {
  day: {
    skyTop: 0x2c5d86, skyHorizon: 0xaac8d8, groundHaze: 0x51636e,
    glow: 0xfff2d8, sunDir: [0.35, 0.42, -0.55],
    fog: 0x9db6c6, fogNear: 70, fogFar: 300,
    cloudTint: 0xffffff, cloudOpacity: 1.0, stars: 0.0,
    exposureScale: 1.0,
  },
  dusk: {
    skyTop: 0x1c2c50, skyHorizon: 0xe0894e, groundHaze: 0x4a3a38,
    glow: 0xffb066, sunDir: [-0.72, 0.10, -0.35],
    fog: 0x8f7a72, fogNear: 60, fogFar: 280,
    cloudTint: 0xffc9a1, cloudOpacity: 1.0, stars: 0.3,
    exposureScale: 1.12,
  },
  night: {
    skyTop: 0x040914, skyHorizon: 0x12283e, groundHaze: 0x0a1219,
    glow: 0x9db8e8, sunDir: [-0.4, 0.3, -0.6],
    fog: 0x0a1622, fogNear: 55, fogFar: 240,
    cloudTint: 0x8fa8c8, cloudOpacity: 0.72, stars: 1.0,
    exposureScale: 0.9,
  },
};
export const ATMOSPHERE_DAYPARTS = Object.keys(DAYPARTS);

function makeCloudTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  // 多个柔和径向渐变叠出蓬松团块；外缘完全透明供 Sprite 混合。
  const puffs = 14;
  for (let i = 0; i < puffs; i++) {
    const x = size * (0.22 + Math.random() * 0.56);
    const y = size * (0.32 + Math.random() * 0.36);
    const r = size * (0.08 + Math.random() * 0.16);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.16 + Math.random() * 0.2;
    grad.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const SKY_VERT = `
  varying vec3 vWorldDir;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(world.xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uHaze;
  uniform vec3 uGlow;
  uniform vec3 uSunDir;
  uniform float uStars;
  varying vec3 vWorldDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float h = dir.y;
    vec3 sky = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
    // 地平线以下压成暗霾，避免露出穹壳接缝。
    vec3 below = mix(uHorizon, uHaze, clamp(-h * 3.0, 0.0, 1.0));
    vec3 color = h >= 0.0 ? sky : below;
    // 太阳/月光晕：核心 + 宽环。
    float s = max(dot(dir, normalize(uSunDir)), 0.0);
    color += uGlow * (pow(s, 24.0) * 0.9 + pow(s, 4.0) * 0.18);
    // 夜间星点：方向哈希阈值，只在高度较高处出现。
    if (uStars > 0.001 && h > 0.05) {
      vec3 cell = floor(dir * 220.0);
      float star = step(0.9985, hash(cell));
      color += vec3(0.9, 0.95, 1.0) * star * uStars * smoothstep(0.05, 0.3, h);
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;

export function createAtmosphere(scene, { radius = 172, cloudBand = [52, 96] } = {}) {
  const group = new THREE.Group();
  group.name = 'Scene_Atmosphere';

  const skyUniforms = {
    uTop: { value: new THREE.Color(DAYPARTS.day.skyTop) },
    uHorizon: { value: new THREE.Color(DAYPARTS.day.skyHorizon) },
    uHaze: { value: new THREE.Color(DAYPARTS.day.groundHaze) },
    uGlow: { value: new THREE.Color(DAYPARTS.day.glow) },
    uSunDir: { value: new THREE.Vector3(...DAYPARTS.day.sunDir) },
    uStars: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 40, 24),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  dome.name = 'Sky_Dome';
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);

  const cloudTexture = makeCloudTexture();
  const clouds = [];
  const [bandLow, bandHigh] = cloudBand;
  for (let i = 0; i < 12; i++) {
    const material = new THREE.SpriteMaterial({
      map: cloudTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.22 + Math.random() * 0.26,
      rotation: Math.random() * Math.PI * 2,
      color: new THREE.Color(DAYPARTS.day.cloudTint),
    });
    const sprite = new THREE.Sprite(material);
    const scale = 46 + Math.random() * 52;
    sprite.scale.set(scale, scale * (0.42 + Math.random() * 0.2), 1);
    sprite.position.set(
      -150 + Math.random() * 300,
      bandLow + Math.random() * (bandHigh - bandLow),
      -150 + Math.random() * 300,
    );
    sprite.userData.drift = 1.1 + Math.random() * 1.6;
    sprite.renderOrder = -5;
    clouds.push(sprite);
    group.add(sprite);
  }

  const first = DAYPARTS.day;
  const current = {
    skyTop: new THREE.Color(first.skyTop), skyHorizon: new THREE.Color(first.skyHorizon),
    haze: new THREE.Color(first.groundHaze), glow: new THREE.Color(first.glow),
    sunDir: new THREE.Vector3(...first.sunDir), fog: new THREE.Color(first.fog),
    fogNear: first.fogNear, fogFar: first.fogFar,
    cloudTint: new THREE.Color(first.cloudTint), cloudOpacity: first.cloudOpacity,
    stars: first.stars, exposureScale: first.exposureScale, background: new THREE.Color(first.skyTop),
  };
  let target = { ...first, skyTop: new THREE.Color(first.skyTop), skyHorizon: new THREE.Color(first.skyHorizon), groundHaze: new THREE.Color(first.groundHaze), glow: new THREE.Color(first.glow), sunDir: new THREE.Vector3(...first.sunDir), fog: new THREE.Color(first.fog), cloudTint: new THREE.Color(first.cloudTint) };
  let active = 'day';

  function writeFog() {
    if (!scene.fog) return;
    scene.fog.color.copy(current.fog);
    if (scene.fog.isFog) { scene.fog.near = current.fogNear; scene.fog.far = current.fogFar; }
    if (scene.background instanceof THREE.Color) scene.background.copy(current.background);
  }

  // 供宿主读取的曝光系数（studio.setDaypart 同步使用）。
  let exposureScale = first.exposureScale;

  function setDaypart(name = 'day') {
    const part = DAYPARTS[name];
    if (!part) return;
    active = name;
    target = {
      ...part,
      skyTop: new THREE.Color(part.skyTop), skyHorizon: new THREE.Color(part.skyHorizon),
      groundHaze: new THREE.Color(part.groundHaze), glow: new THREE.Color(part.glow),
      sunDir: new THREE.Vector3(...part.sunDir), fog: new THREE.Color(part.fog),
      cloudTint: new THREE.Color(part.cloudTint),
    };
  }

  function update(dt) {
    if (!target) return;
    const k = 1 - Math.exp(-Math.min(3.2, dt * 2.4));
    current.skyTop.lerp(target.skyTop, k);
    current.skyHorizon.lerp(target.skyHorizon, k);
    current.haze.lerp(target.groundHaze, k);
    current.glow.lerp(target.glow, k);
    current.sunDir.lerp(target.sunDir, k);
    current.fog.lerp(target.fog, k);
    current.cloudTint.lerp(target.cloudTint, k);
    current.background.lerp(target.skyTop, k);
    current.fogNear += (target.fogNear - current.fogNear) * k;
    current.fogFar += (target.fogFar - current.fogFar) * k;
    current.cloudOpacity += (target.cloudOpacity - current.cloudOpacity) * k;
    current.stars += (target.stars - current.stars) * k;
    current.exposureScale += (target.exposureScale - current.exposureScale) * k;
    exposureScale = current.exposureScale;

    skyUniforms.uTop.value.copy(current.skyTop);
    skyUniforms.uHorizon.value.copy(current.skyHorizon);
    skyUniforms.uHaze.value.copy(current.haze);
    skyUniforms.uGlow.value.copy(current.glow);
    skyUniforms.uSunDir.value.copy(current.sunDir);
    skyUniforms.uStars.value = current.stars;
    writeFog();
    for (const sprite of clouds) {
      sprite.material.color.copy(current.cloudTint);
      sprite.material.opacity = sprite.material.opacity * 0 + (sprite.userData.baseOpacity ?? (sprite.userData.baseOpacity = sprite.material.opacity)) * current.cloudOpacity;
      sprite.position.x += sprite.userData.drift * dt;
      if (sprite.position.x > 165) sprite.position.x = -165;
    }
  }

  function dispose() {
    dome.geometry.dispose();
    dome.material.dispose();
    cloudTexture.dispose();
    for (const sprite of clouds) { sprite.material.dispose(); }
    group.removeFromParent();
  }

  return {
    group, setDaypart, update, dispose,
    get daypart() { return active; },
    get exposureScale() { return exposureScale; },
    // 供 studio 在 setMode 后重放当前档位。
    DAYPARTS,
  };
}
