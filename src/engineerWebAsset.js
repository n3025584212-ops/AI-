import * as THREE from 'three';

export const ENGINEER_MODEL_URL = '/assets/engineer-coldroll-bound-20261031-r3_mo.glb';
export const ENGINEER_MODEL_ID = 'coldroll-bound-20261031';

// Keep the native toon character and the baked workwear in the same visual range.
// The exported GLB also remains usable as standard textured PBR outside this app.
export function prepareEngineerAsset(root) {
  const cache = new Map();
  root.traverse(object => {
    if (!object.isMesh) return;
    object.frustumCulled = false;
    const sewn = object.geometry.getAttribute('_web_sewn_color');
    const hem = object.geometry.getAttribute('_web_hem');
    const convert = original => {
      const cloth = original.userData.web_role === 'cloth' || original.name.startsWith('M_CRTech');
      const key = `${original.uuid}:${Boolean(sewn && hem)}`;
      if (cache.has(key)) return cache.get(key);
      let material;
      if (!cloth) {
        material = new THREE.MeshBasicMaterial({
          name: original.name, map: original.map, color: original.color,
          side: original.side, alphaMap: original.alphaMap,
          alphaTest: original.map ? .3 : 0, transparent: false,
          depthWrite: true, toneMapped: false,
        });
      } else {
        material = original.clone();
        material.vertexColors = false;
        material.roughness = Math.max(.7, material.roughness);
        material.metalness = 0;
        material.aoMapIntensity = .13;
        material.toneMapped = false;
        material.onBeforeCompile = shader => {
          if (sewn && hem && original.name.includes('Baked_Jacket')) {
            shader.vertexShader = `attribute vec3 _web_sewn_color;\nattribute float _web_hem;\nvarying vec3 vSewn;\nvarying float vHem;\n${shader.vertexShader}`
              .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSewn = _web_sewn_color; vHem = _web_hem;');
            shader.fragmentShader = `varying vec3 vSewn;\nvarying float vHem;\n${shader.fragmentShader}`
              .replace('#include <map_fragment>', `#include <map_fragment>
                float refLum = dot(vSewn, vec3(.2126, .7152, .0722));
                float atlasLum = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
                float ratio = atlasLum / (refLum + .0001);
                float repair = (1.0-smoothstep(.25,.60,ratio))*step(.50,refLum)*(1.0-vHem);
                diffuseColor.rgb = mix(diffuseColor.rgb, vSewn, repair);`);
          }
          shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
            vec3 relativeLight = outgoingLight / max(diffuseColor.rgb, vec3(.015));
            float lightLevel = dot(relativeLight, vec3(.2126,.7152,.0722));
            float normalizedLight = lightLevel / (lightLevel + 1.2);
            float toonShade = .69 + .16*smoothstep(.18,.38,normalizedLight)
                                  + .15*smoothstep(.45,.72,normalizedLight);
            outgoingLight = diffuseColor.rgb * toonShade;
            #include <opaque_fragment>`);
        };
        material.customProgramCacheKey = () => `coldroll-v1-${Boolean(sewn && hem)}`;
      }
      material.userData = { ...original.userData, engineerAsset: ENGINEER_MODEL_ID };
      cache.set(key, material);
      return material;
    };
    object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
  });
  root.userData.engineerAsset = ENGINEER_MODEL_ID;
  return root;
}
