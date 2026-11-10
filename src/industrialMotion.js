// View-owned finish cues. These alter only material response; the transport
// distance and each body's radius-driven rotation remain the process controls.
export function installStripFlow(material, distance, { pathAttribute = false } = {}) {
  // 0.98 金属度 + 0.34 粗糙度 = 镜面反射整片 HDR 环境，钢带在 bloom 里变成灯管。
  // 降金属度、提粗糙度，让它读作拉丝钢而不是自发光条。
  material.color.set('#aebcc4'); material.metalness = 0.80; material.roughness = 0.46;
  material.onBeforeCompile = shader => {
    shader.uniforms.uTransportDistance = distance;
    shader.vertexShader = `${pathAttribute ? 'attribute float stripDistance;\n' : ''}varying vec3 vProcessPosition; varying float vStripDistance;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vProcessPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        vStripDistance = ${pathAttribute ? 'stripDistance' : 'vProcessPosition.x'};`);
    shader.fragmentShader = `uniform float uTransportDistance; varying vec3 vProcessPosition; varying float vStripDistance;
      float stripHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float stripNoise(vec2 p) {
        vec2 cell = floor(p), blend = fract(p); blend = blend * blend * (3.0 - 2.0 * blend);
        return mix(mix(stripHash(cell), stripHash(cell + vec2(1.0, 0.0)), blend.x),
          mix(stripHash(cell + vec2(0.0, 1.0)), stripHash(cell + vec2(1.0)), blend.x), blend.y);
      }
      ${shader.fragmentShader}`
      .replace('#include <color_fragment>', `#include <color_fragment>
        float materialX = vStripDistance - uTransportDistance;
        // Aperiodic rolling/oil marks cross the fixed nips. Broad finish changes
        // survive the whole-line scale; fine lengthwise brushing fades with LOD.
        float millPatch = smoothstep(0.20, 0.79, stripNoise(vec2(materialX * 1.1, vProcessPosition.z * 5.8)));
        float brushing = stripNoise(vec2(materialX * 0.75, vProcessPosition.z * 64.0));
        float brushVisibility = 1.0 - smoothstep(0.45, 1.2, fwidth(vProcessPosition.z * 64.0));
        float scuff = smoothstep(0.43, 0.76, stripNoise(vec2(materialX * 3.1 + vProcessPosition.z * 0.35, vProcessPosition.z * 7.0)));
        float steelShade = 0.74 + millPatch * 0.17 - scuff * 0.06 + (brushing - 0.5) * 0.035 * brushVisibility;
        // 原来是 0.80/0.86/0.90 + metalness 0.98，钢铁在 HDR 管线下直接顶到 1.0，
        // 五条机架之间连成一条白炽灯带。压到 0.60 一档，保留金属亮部但不刺眼。
        diffuseColor.rgb = vec3(0.60, 0.65, 0.69) * steelShade;
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(0.34 + millPatch * 0.14 + scuff * 0.045, 0.34, 0.52);`);
  };
  material.customProgramCacheKey = () => `continuous-steel-advection-v4-${pathAttribute ? 'path' : 'world'}`;
}

export function installRollSurface(material, { radius = 1, phase = 0 } = {}) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uRollRadius = { value: Math.max(radius, 0.001) };
    shader.uniforms.uRollFinishPhase = { value: phase };
    shader.vertexShader = `varying vec3 vRollPosition; varying vec3 vRollLocalNormal;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRollPosition = position; vRollLocalNormal = normal;');
    shader.fragmentShader = `uniform float uRollRadius; uniform float uRollFinishPhase;
      varying vec3 vRollPosition; varying vec3 vRollLocalNormal;\n${shader.fragmentShader}`
      .replace('#include <color_fragment>', `#include <color_fragment>
        float angle = atan(vRollPosition.y, vRollPosition.x) + uRollFinishPhase;
        float broadWear = pow(0.5 + 0.5 * cos(angle - 0.35 + sin(vRollPosition.z * 1.9) * 0.12), 6.0);
        float fineWear = pow(0.5 + 0.5 * cos(angle + 1.82), 24.0);
        float axialWear = 0.72 + 0.28 * sin(vRollPosition.z * 4.7 + sin(angle) * 1.4);
        float wear = broadWear * axialWear;
        float cap = smoothstep(0.72, 0.94, abs(normalize(vRollLocalNormal).z));
        float radial = length(vRollPosition.xy) / uRollRadius;
        float tickAngle = abs(atan(sin(angle - 0.54), cos(angle - 0.54)));
        // Small end-face inspection witness: one short dark paint dash. It is
        // intentionally on the end face, never an arrow over the rolling face.
        float endMark = cap * (1.0 - smoothstep(0.10, 0.16, tickAngle))
          * smoothstep(0.34, 0.42, radial) * (1.0 - smoothstep(0.77, 0.85, radial));
        diffuseColor.rgb *= 0.98 - wear * 0.17 - fineWear * 0.065;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.028, 0.038, 0.045), endMark * 0.92);
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // Metallic brightness is mostly specular. Rotating roughness variation
        // is needed as well as albedo, or a symmetric shiny cylinder looks still.
        roughnessFactor = mix(clamp(0.19 + wear * 0.23 + fineWear * 0.065, 0.19, 0.46), 0.67, endMark);`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.10, endMark);');
  };
  material.customProgramCacheKey = () => 'rolling-steel-finish-and-inspection-witness-v4';
}
