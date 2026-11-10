import * as THREE from 'three';
const COATED_PARTS = new Set(['Blue_Enamel', 'Blue_Cast', 'Frame_Cast', 'Frame_Cast_AuxiliarySatin']);

function installCoatedFinish(material) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = `varying vec3 vCoatingPosition;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoatingPosition = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = `varying vec3 vCoatingPosition;
      float coatHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float coatNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(coatHash(i), coatHash(i+vec3(1,0,0)), f.x), mix(coatHash(i+vec3(0,1,0)), coatHash(i+vec3(1,1,0)), f.x), f.y),
          mix(mix(coatHash(i+vec3(0,0,1)), coatHash(i+vec3(1,0,1)), f.x), mix(coatHash(i+vec3(0,1,1)), coatHash(i+vec3(1,1,1)), f.x), f.y), f.z);
      }
      vec3 coatBump(vec3 position, vec3 surfaceNormal, float height, float facing) {
        vec3 dx = dFdx(position), dy = dFdy(position);
        vec3 r1 = cross(dy, surfaceNormal), r2 = cross(surfaceNormal, dx);
        float determinant = dot(dx, r1) * facing;
        vec3 gradient = sign(determinant) * (dFdx(height) * r1 + dFdy(height) * r2);
        return normalize(abs(determinant) * surfaceNormal - gradient);
      }
      ${shader.fragmentShader}`
      .replace('#include <color_fragment>', `#include <color_fragment>
        float castVariation = coatNoise(vCoatingPosition * 3.2);
        float coatingGrain = coatNoise(vCoatingPosition * 38.0);
        float grainVisibility = 1.0 - smoothstep(0.45, 1.4, length(fwidth(vCoatingPosition * 38.0)));
        diffuseColor.rgb *= 0.94 + castVariation * 0.10;
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (castVariation - 0.5) * 0.07 + (coatingGrain - 0.5) * 0.025 * grainVisibility, 0.22, 0.42);
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // 铸造/喷涂面的微起伏：没有法线贴图时，靠屏幕导数重建的凹凸维持近距细节。
        normal = coatBump(-vViewPosition, normal, coatingGrain * 0.0011 * grainVisibility, faceDirection);
      `);
  };
  material.customProgramCacheKey = () => 'industrial-enamel-cast-finish-v4';
}

// View-owned finishes: grazing highlights come from physical studio lights,
// not emissive edge shaders or CAD contours. Source meshes/GLB are unchanged.
export function refineIndustrialMaterial(material, part = {}, environment = null) {
  if (!material?.isMeshStandardMaterial) return;
  if (environment) material.envMap = environment;
  if (part.part === 'strip') { material.envMapIntensity = 0.82; return; }
  const name = material.name || '';
  material.envMapIntensity = 0.65; material.emissive?.set('#000000'); material.emissiveIntensity = 0;
  if (name === 'Blue_Enamel' || name === 'Blue_Cast' || (/Frame_Cast/.test(name) && part.part === 'housing')) {
    material.color.set(name === 'Blue_Enamel' ? '#0c5180' : name === 'Blue_Cast' ? '#1b4a65' : '#235c7b');
    material.metalnessMap = null; material.roughnessMap = null;
    // The outer finish is pigmented dielectric enamel, not exposed blue metal.
    // Restrained specular layers keep the broad panels blue under the same
    // reflection cards that give bare shafts and fasteners their highlights.
    material.metalness = 0.025; material.roughness = name === 'Blue_Enamel' ? 0.27 : 0.34; material.envMapIntensity = 0.82;
    if (material.isMeshPhysicalMaterial) {
      material.clearcoat = 0.22; material.clearcoatRoughness = 0.20; material.ior = 1.46;
      material.specularIntensity = 0.32; material.polygonOffset = false;
    }
    installCoatedFinish(material);
  } else if (part.rollName) {
    material.color.set('#aebbc2'); material.metalness = 1; material.roughness = 0.20; material.envMapIntensity = 1.12;
  } else if (/Chrome_Rod/.test(name)) {
    material.color.set('#b3c1c7'); material.metalness = 1; material.roughness = 0.21; material.envMapIntensity = 0.8;
  } else if (/Machined_Steel|Ground_Roll/.test(name)) {
    material.color.set('#798d99'); material.metalness = 0.96; material.roughnessMap = null; material.roughness = 0.27; material.envMapIntensity = 0.92;
  } else if (/Chock_Cast|Frame_Cast/.test(name)) {
    material.color.set('#687985'); material.metalnessMap = null; material.metalness = 0.85; material.roughnessMap = null; material.roughness = 0.32; material.envMapIntensity = 0.95;
  } else if (/Bolt_Zinc/.test(name)) {
    // Existing source bolts and washers catch the operator-side softbox;
    // presentation finishes do not add outlines or change their geometry.
    material.color.set('#b4b9ba'); material.metalness = 0.94; material.roughness = 0.28; material.envMapIntensity = 1.05;
  } else if (/Pipe_Steel/.test(name)) {
    material.color.set('#64717a'); material.metalness = 0.88; material.roughness = 0.34; material.envMapIntensity = 0.85;
  } else if (/Brass/.test(name)) {
    material.color.set('#ad8642'); material.metalness = 0.82; material.roughness = 0.32; material.envMapIntensity = 0.82;
  } else if (/Black_Oxide/.test(name)) {
    material.color.set('#202c33'); material.metalness = 0.8; material.roughness = 0.4; material.envMapIntensity = 0.52;
  } else if (name === 'Safety_Yellow') {
    material.color.set('#e3aa27'); material.metalness = 0.12; material.roughness = 0.35; material.envMapIntensity = 0.45;
  } else if (name === 'Rubber') {
    material.color.set('#0d1316'); material.metalness = 0; material.roughness = 0.9; material.envMapIntensity = 0.2;
  } else if (name === 'Cabinet_Grey') {
    material.color.set('#71848e'); material.metalness = 0.15; material.roughness = 0.48; material.envMapIntensity = 0.44;
  } else if (name === 'Motor_Grey') {
    material.color.set('#344e60'); material.roughnessMap = null; material.roughness = 0.47; material.envMapIntensity = 0.54;
  } else if (/Grating|Deck_Steel/.test(name)) {
    material.color.set('#354650'); material.metalness = 0.76; material.roughness = 0.47; material.envMapIntensity = 0.54;
  }
  material.needsUpdate = true;
}

export function prepareIndustrialMaterials(root, environment) {
  const replacements = new Map(), visited = new Set();
  root.traverse(object => {
    if (!object.isMesh) return;
    const finish = source => {
      let material = source;
      if (source?.isMeshStandardMaterial && !source.isMeshPhysicalMaterial && COATED_PARTS.has(source.name)
        && (!/^Frame_Cast/.test(source.name) || object.userData.part === 'housing')) {
        if (!replacements.has(source)) {
          const coated = new THREE.MeshPhysicalMaterial(); THREE.MeshStandardMaterial.prototype.copy.call(coated, source);
          coated.defines = { STANDARD: '', PHYSICAL: '' }; replacements.set(source, coated);
        }
        material = replacements.get(source);
      }
      if (!visited.has(material)) { visited.add(material); refineIndustrialMaterial(material, object.userData, environment); }
      return material;
    };
    object.material = Array.isArray(object.material) ? object.material.map(finish) : finish(object.material);
  });
  let disposed = false;
  return {
    physicalMaterialCount: replacements.size, frameAccentCount: 0,
    dispose() { if (disposed) return; disposed = true; for (const material of replacements.values()) material.dispose(); },
  };
}
