import * as THREE from 'three';

export type WaterLook = {
  level: number;
  boxMin: THREE.Vector3;
  boxMax: THREE.Vector3;
  scatter: string;
  deep: string;
  shallow: string;
  extinction: [number, number, number];
  sun: THREE.Vector3;
  causticScale: number;
  causticStrength: number;
  skyZenith: string;
  skyHorizon: string;
  sunColor: string;
  sunPower: number;
  ceiling: [number, number, number, number];
};

export type WaterUniforms = {
  uTime: { value: number };
  uLevel: { value: number };
  uBoxMin: { value: THREE.Vector3 };
  uBoxMax: { value: THREE.Vector3 };
  uExtinction: { value: THREE.Vector3 };
  uScatter: { value: THREE.Color };
  uDeep: { value: THREE.Color };
  uShallow: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uCausticMap: { value: THREE.Texture };
  uCausticScale: { value: number };
  uCausticStrength: { value: number };
  uDetailMap: { value: THREE.Texture };
  uSkyZenith: { value: THREE.Color };
  uSkyHorizon: { value: THREE.Color };
  uSunColor: { value: THREE.Color };
  uCeiling: { value: THREE.Vector4 };
  uViewport: { value: number };
};

export function waterUniforms(look: WaterLook, caustic: THREE.Texture, detail: THREE.Texture): WaterUniforms {
  return {
    uTime: { value: 0 },
    uLevel: { value: look.level },
    uBoxMin: { value: look.boxMin.clone() },
    uBoxMax: { value: look.boxMax.clone() },
    uExtinction: { value: new THREE.Vector3(...look.extinction) },
    uScatter: { value: new THREE.Color(look.scatter) },
    uDeep: { value: new THREE.Color(look.deep) },
    uShallow: { value: new THREE.Color(look.shallow) },
    uSunDir: { value: look.sun.clone().normalize() },
    uCausticMap: { value: caustic },
    uCausticScale: { value: look.causticScale },
    uCausticStrength: { value: look.causticStrength },
    uDetailMap: { value: detail },
    uSkyZenith: { value: new THREE.Color(look.skyZenith) },
    uSkyHorizon: { value: new THREE.Color(look.skyHorizon) },
    uSunColor: { value: new THREE.Color(look.sunColor).multiplyScalar(look.sunPower) },
    uCeiling: { value: new THREE.Vector4(...look.ceiling) },
    uViewport: { value: 720 },
  };
}

const WATER_COMMON = `
uniform float uTime;
uniform float uLevel;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uExtinction;
uniform vec3 uScatter;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSunDir;
uniform sampler2D uCausticMap;
uniform float uCausticScale;
uniform float uCausticStrength;
uniform sampler2D uDetailMap;

float waterSpan(vec3 a, vec3 b) {
  vec3 d = b - a;
  float len = length(d);
  vec3 safe = mix(d, vec3(1e-4), lessThan(abs(d), vec3(1e-4)));
  vec3 t0 = (uBoxMin - a) / safe;
  vec3 t1 = (uBoxMax - a) / safe;
  vec3 lo = min(t0, t1);
  vec3 hi = max(t0, t1);
  float enter = clamp(max(max(lo.x, lo.y), lo.z), 0.0, 1.0);
  float leave = clamp(min(min(hi.x, hi.y), hi.z), 0.0, 1.0);
  return max(0.0, leave - enter) * len;
}

float waterInside(vec3 p) {
  vec3 s = step(uBoxMin - 0.05, p) * step(p, uBoxMax + 0.05);
  return s.x * s.y * s.z;
}

vec3 waterScatter(vec3 dir) {
  vec3 c = mix(uScatter, uShallow, smoothstep(0.0, 0.85, dir.y));
  return mix(c, uDeep, smoothstep(0.0, -0.75, dir.y));
}

vec3 waterFog(vec3 color, vec3 pos) {
  vec3 d = pos - cameraPosition;
  float span = waterSpan(cameraPosition, pos);
  vec3 trans = exp(-uExtinction * span);
  return color * trans + waterScatter(normalize(d)) * (1.0 - trans);
}

vec2 causticWarp(vec2 uv) {
  return vec2(
    texture2D(uDetailMap, uv * 0.19 + uTime * vec2(0.013, 0.008)).r,
    texture2D(uDetailMap, uv * 0.19 + vec2(0.43, 0.17) - uTime * vec2(0.009, 0.012)).r
  ) - 0.5;
}

float causticLayer(vec2 uv) {
  vec2 warp = causticWarp(uv);
  float a = texture2D(uCausticMap, uv + warp * 0.12 + uTime * vec2(0.014, 0.006)).r;
  float b = texture2D(uCausticMap, uv * 0.71 - warp * 0.1 + vec2(0.37, 0.61) - uTime * vec2(0.008, 0.012)).r;
  return a + b * 0.75;
}

vec3 waterCaustics(vec3 pos) {
  float depth = max(0.0, uLevel - pos.y);
  vec2 uv = (pos.xz + uSunDir.xz / max(uSunDir.y, 0.2) * depth) * uCausticScale;
  vec2 warp = causticWarp(uv);
  vec2 ua = uv + warp * 0.12 + uTime * vec2(0.014, 0.006);
  float b = texture2D(uCausticMap, uv * 0.71 - warp * 0.1 + vec2(0.37, 0.61) - uTime * vec2(0.008, 0.012)).r * 0.75;
  float g = texture2D(uCausticMap, ua).r + b;
  float r = texture2D(uCausticMap, ua + vec2(0.0018, 0.0013)).r + b;
  return vec3(r, g, mix(g, r, 0.5) * 1.04);
}
`;

export type PatchOptions = {
  caustics?: number;
  sway?: number;
  swim?: boolean;
  detail?: number;
  detailScale?: number;
  wiggle?: number;
};

export function waterPatch<T extends THREE.Material>(
  material: T,
  uniforms: WaterUniforms,
  options: PatchOptions = {},
): T {
  const caustics = options.caustics ?? 1;
  const sway = options.sway ?? 0;
  const detail = options.detail ?? 0;
  const detailScale = options.detailScale ?? 0.35;
  const swim = options.swim ?? false;
  const wiggle = options.wiggle ?? 0.16;
  const inherited = material.onBeforeCompile.bind(material);
  const inheritedKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    inherited(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    const lit = shader.fragmentShader.includes('#include <lights_fragment_end>');
    const vertexHead = [
      '#include <common>',
      'uniform float uTime;',
      'varying vec3 vWaterPos;',
      'varying vec3 vWaterNormal;',
      swim ? 'attribute vec4 aOrbit;\nattribute vec4 aSwim;' : '',
      swim
        ? [
            'vec3 swimFrame(vec3 local, out vec3 forward, out vec3 side) {',
            '  float angle = aSwim.y + uTime * aSwim.x;',
            '  vec2 radial = vec2(cos(angle), sin(angle));',
            '  float heading = sign(aSwim.x);',
            '  forward = vec3(-radial.y * heading, 0.0, radial.x * heading);',
            '  side = vec3(forward.z, 0.0, -forward.x);',
            '  float bob = sin(uTime * 0.6 + aSwim.w) * 0.35;',
            '  return vec3(aOrbit.x + radial.x * aOrbit.w, aOrbit.y + bob, aOrbit.z + radial.y * aOrbit.w);',
            '}',
          ].join('\n')
        : '',
    ].join('\n');
    const normalBody = swim
      ? [
          '#include <beginnormal_vertex>',
          'vec3 swimForward;',
          'vec3 swimSide;',
          'vec3 swimCentre = swimFrame(position, swimForward, swimSide);',
          'objectNormal = swimSide * objectNormal.x + vec3(0.0, objectNormal.y, 0.0) + swimForward * objectNormal.z;',
          'vWaterNormal = normalize(mat3(modelMatrix) * objectNormal);',
        ].join('\n')
      : [
          '#include <beginnormal_vertex>',
          '#ifdef USE_INSTANCING',
          'vWaterNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);',
          '#else',
          'vWaterNormal = normalize(mat3(modelMatrix) * objectNormal);',
          '#endif',
        ].join('\n');
    const beginBody = swim
      ? [
          '#include <begin_vertex>',
          'vec3 swimLocal = position * aSwim.z;',
          'float swimTail = smoothstep(0.35, -0.5, position.z);',
          `swimLocal.x += sin(uTime * (5.0 + abs(aSwim.x) * 14.0) + aSwim.w * 7.0 + position.z * 4.0) * ${wiggle.toFixed(3)} * aSwim.z * swimTail;`,
          'transformed = swimCentre + swimSide * swimLocal.x + vec3(0.0, swimLocal.y, 0.0) + swimForward * swimLocal.z;',
        ].join('\n')
      : sway > 0
        ? [
            '#include <begin_vertex>',
            '#ifdef USE_INSTANCING',
            'float swayPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.29;',
            '#else',
            'float swayPhase = 0.0;',
            '#endif',
            `float swayAmount = ${sway.toFixed(3)} * position.y * position.y;`,
            'transformed.x += sin(uTime * 0.9 + swayPhase + position.y * 0.35) * swayAmount;',
            'transformed.z += cos(uTime * 0.7 + swayPhase * 1.3 + position.y * 0.28) * swayAmount * 0.7;',
          ].join('\n')
        : '#include <begin_vertex>';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', vertexHead)
      .replace('#include <beginnormal_vertex>', normalBody)
      .replace('#include <begin_vertex>', beginBody)
      .replace(
        '#include <project_vertex>',
        [
          '#include <project_vertex>',
          'vec4 waterWorld = vec4(transformed, 1.0);',
          '#ifdef USE_INSTANCING',
          'waterWorld = instanceMatrix * waterWorld;',
          '#endif',
          'vWaterPos = (modelMatrix * waterWorld).xyz;',
        ].join('\n'),
      );
    const lightBody = [
      '#include <lights_fragment_end>',
      'float waterDepth = uLevel - vWaterPos.y;',
      'if (waterDepth > 0.0 && waterInside(vWaterPos) > 0.5) {',
      '  vec3 waterNormal = normalize(vWaterNormal);',
      '  float waterFacing = clamp(dot(waterNormal, uSunDir) * 0.8 + 0.45, 0.0, 1.0);',
      '  vec3 waterAtten = exp(-uExtinction * waterDepth * 0.42);',
      `  float waterK = uCausticStrength * ${caustics.toFixed(3)} * exp(-waterDepth * 0.02) * smoothstep(0.0, 0.6, waterDepth);`,
      '  vec3 waterC = waterCaustics(vWaterPos);',
      '  reflectedLight.directDiffuse *= waterAtten * mix(vec3(1.0), 0.42 + waterC * 1.3, waterK);',
      '  reflectedLight.directSpecular *= waterAtten * 0.6;',
      '  reflectedLight.indirectDiffuse *= waterAtten * mix(vec3(1.0), 0.6 + waterC * 0.9, waterK * waterFacing);',
      '  reflectedLight.indirectSpecular *= waterAtten * 0.35;',
      '}',
    ].join('\n');
    const detailBody = [
      '#include <color_fragment>',
      'vec3 triWeight = pow(abs(normalize(vWaterNormal)), vec3(4.0));',
      'triWeight /= triWeight.x + triWeight.y + triWeight.z;',
      `vec3 triPos = vWaterPos * ${detailScale.toFixed(4)};`,
      'float triValue = texture2D(uDetailMap, triPos.zy).r * triWeight.x + texture2D(uDetailMap, triPos.xz).r * triWeight.y + texture2D(uDetailMap, triPos.xy).r * triWeight.z;',
      `diffuseColor.rgb *= mix(1.0, 0.35 + triValue * 1.3, ${detail.toFixed(3)});`,
    ].join('\n');
    const fogBody = [
      '#include <opaque_fragment>',
      'gl_FragColor.rgb = waterFog(gl_FragColor.rgb, vWaterPos);',
      '#ifdef USE_FOG',
      'if (cameraPosition.y > uLevel) {',
      '  float dry = max(0.0, distance(cameraPosition, vWaterPos) - waterSpan(cameraPosition, vWaterPos));',
      '  #ifdef FOG_EXP2',
      '  float dryFog = 1.0 - exp(-fogDensity * fogDensity * dry * dry);',
      '  #else',
      '  float dryFog = smoothstep(fogNear, fogFar, dry);',
      '  #endif',
      '  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, dryFog);',
      '}',
      '#endif',
    ].join('\n');
    let fragment = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${WATER_COMMON}\nvarying vec3 vWaterPos;\nvarying vec3 vWaterNormal;`,
      )
      .replace('#include <opaque_fragment>', fogBody)
      .replace('#include <fog_fragment>', '');
    if (lit && caustics >= 0) fragment = fragment.replace('#include <lights_fragment_end>', lightBody);
    if (detail > 0) fragment = fragment.replace('#include <color_fragment>', detailBody);
    shader.fragmentShader = fragment;
  };
  material.customProgramCacheKey = () =>
    `${inheritedKey()}|water:${caustics}:${sway}:${detail}:${detailScale}:${swim ? 1 : 0}:${wiggle}`;
  return material;
}

const SKY = `
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSunColor;
uniform vec4 uCeiling;

vec3 skyColor(vec3 dir, vec3 origin) {
  float up = max(dir.y, 0.0);
  if (uCeiling.w > 0.5) {
    vec2 hit = origin.xz + dir.xz / max(dir.y, 0.05) * uCeiling.x;
    float axis = mix(hit.x, hit.y, uCeiling.z);
    float cross = mix(hit.y, hit.x, uCeiling.z);
    float bar = 1.0 - smoothstep(0.035, 0.07, abs(fract(axis / uCeiling.y + 0.5) - 0.5));
    float gap = smoothstep(0.02, 0.06, abs(fract(cross / 11.0) - 0.5));
    float fall = 1.0 / (1.0 + dot(dir.xz, dir.xz) / max(up * up, 0.01) * 0.35);
    return uSkyHorizon + uSkyZenith * fall * 0.6 + uSunColor * bar * gap * fall;
  }
  vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(up, 0.55));
  float s = max(dot(dir, uSunDir), 0.0);
  return sky + uSunColor * (pow(s, 350.0) * 6.0 + pow(s, 60.0) * 0.4 + pow(s, 8.0) * 0.07);
}
`;

export type SurfaceOptions = {
  normalMap: THREE.Texture;
  floorMap: THREE.Texture;
  floorScale: number;
  floorTint: string;
  floorY: number;
  swell: number;
  chop: number;
  ripple: [number, number];
  body: number;
  bodyRange: number;
};

export function surfaceMaterial(uniforms: WaterUniforms, options: SurfaceOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...uniforms,
      uNormalMap: { value: options.normalMap },
      uFloorMap: { value: options.floorMap },
      uFloorScale: { value: options.floorScale },
      uFloorTint: { value: new THREE.Color(options.floorTint) },
      uFloorY: { value: options.floorY },
      uSwell: { value: options.swell },
      uChop: { value: options.chop },
      uRipple: { value: new THREE.Vector2(...options.ripple) },
      uBody: { value: new THREE.Vector2(options.body, options.bodyRange) },
    },
    vertexShader: `
uniform float uTime;
uniform float uSwell;
varying vec3 vPos;
#include <fog_pars_vertex>
float swell(vec2 p) {
  return (sin(p.x * 0.071 + uTime * 0.83) * 0.5 + sin(p.y * 0.093 - uTime * 0.71 + 1.3) * 0.32 + sin((p.x + p.y) * 0.047 + uTime * 0.52) * 0.4) * uSwell;
}
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  world.y += swell(world.xz);
  vPos = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`,
    fragmentShader: `
#include <common>
#include <fog_pars_fragment>
${WATER_COMMON}
${SKY}
uniform sampler2D uNormalMap;
uniform sampler2D uFloorMap;
uniform float uFloorScale;
uniform vec3 uFloorTint;
uniform float uFloorY;
uniform float uSwell;
uniform float uChop;
uniform vec2 uRipple;
uniform vec2 uBody;
varying vec3 vPos;

vec3 surfaceNormal(vec2 p, float dist) {
  vec2 g = vec2(
    cos(p.x * 0.071 + uTime * 0.83) * 0.5 * 0.071 + cos((p.x + p.y) * 0.047 + uTime * 0.52) * 0.4 * 0.047,
    cos(p.y * 0.093 - uTime * 0.71 + 1.3) * 0.32 * 0.093 + cos((p.x + p.y) * 0.047 + uTime * 0.52) * 0.4 * 0.047
  ) * uSwell;
  vec3 n1 = texture2D(uNormalMap, p * uRipple.x + uTime * vec2(0.031, 0.019)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uNormalMap, p * uRipple.y - uTime * vec2(0.022, 0.027)).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(uNormalMap, p * uRipple.x * 0.23 + uTime * vec2(-0.008, 0.011)).xyz * 2.0 - 1.0;
  float calm = 1.0 / (1.0 + dist * 0.004);
  g += (n1.xy + n2.xy) * uChop * calm + n3.xy * uChop * 1.4;
  return normalize(vec3(-g.x, 1.0, -g.y));
}

void main() {
  vec3 toFrag = vPos - cameraPosition;
  float dist = length(toFrag);
  vec3 V = toFrag / dist;
  vec3 n = surfaceNormal(vPos.xz, dist);
  vec3 color;
  float alpha = 1.0;
  if (cameraPosition.y < uLevel) {
    vec3 nd = -n;
    float cosI = clamp(dot(-V, nd), 0.0, 1.0);
    float sin2T = 1.7689 * (1.0 - cosI * cosI);
    float R = 1.0;
    vec3 T = vec3(V.x, abs(V.y), V.z);
    if (sin2T < 1.0) {
      float cosT = sqrt(1.0 - sin2T);
      R = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
      T = refract(V, nd, 1.33);
    }
    vec3 sky = skyColor(normalize(T), vPos);
    vec3 r = reflect(V, nd);
    r.y = -abs(r.y);
    float t = min((vPos.y - uFloorY) / max(-r.y, 0.03), 400.0);
    vec3 hit = vPos + r * t;
    vec3 floorColor = texture2D(uFloorMap, hit.xz * uFloorScale).rgb * uFloorTint;
    floorColor *= 0.7 + causticLayer(hit.xz * uCausticScale) * uCausticStrength * 0.7;
    vec3 trans = exp(-uExtinction * t);
    vec3 mirror = floorColor * trans + waterScatter(r) * (1.0 - trans);
    color = mix(sky, mirror, R);
    color = waterFog(color, vPos);
  } else {
    float cosI = clamp(dot(-V, n), 0.0, 1.0);
    float R = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
    vec3 r = reflect(V, n);
    r.y = abs(r.y);
    vec3 sky = skyColor(normalize(r), vPos) * (1.0 - 0.8 * uCeiling.w);
    float body = clamp(uBody.x * pow(1.0 - cosI, 1.5) + smoothstep(uBody.y, uBody.y * 3.0, dist), 0.0, 1.0);
    float facet = dot(n.xz, normalize(uSunDir.xz + 1e-4)) / max(uChop * 1.6 + uSwell * 0.05, 1e-3);
    float lit = smoothstep(0.05, 1.0, facet);
    float shade = smoothstep(-0.05, -1.0, facet);
    float lower = (1.0 - R) * body;
    float rest = 1.0 - R - lower;
    float veil = 0.2 + lit * 0.3 + shade * 0.14;
    vec3 veilColor = mix(uScatter * 0.75, mix(uShallow, vec3(1.0), 0.6) * 1.5, lit / max(lit + shade * 0.6 + 0.25, 1e-3));
    alpha = R + lower + rest * veil;
    color = (sky * R + uDeep * 0.8 * lower + veilColor * rest * veil) / max(alpha, 1e-3);
    #ifdef USE_FOG
    #ifdef FOG_EXP2
    float airFog = 1.0 - exp(-fogDensity * fogDensity * dist * dist);
    #else
    float airFog = smoothstep(fogNear, fogFar, dist);
    #endif
    color = mix(color, fogColor, airFog);
    #endif
  }
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,
    transparent: true,
    side: THREE.DoubleSide,
    fog: true,
  });
}

export function glassMaterial(uniforms: WaterUniforms, panel: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uPanel: { value: panel } },
    vertexShader: `
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPos = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`,
    fragmentShader: `
#include <common>
${WATER_COMMON}
uniform float uPanel;
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vec3 toFrag = vPos - cameraPosition;
  vec3 V = normalize(toFrag);
  vec3 n = normalize(vNormal);
  float facing = dot(-V, n);
  n *= sign(facing);
  float cosI = abs(facing);
  float wet = waterInside(cameraPosition);
  float seam = 1.0 - smoothstep(0.0, 0.07, abs(fract(vUv.x / uPanel + 0.5) - 0.5) * uPanel);
  vec3 color;
  float alpha;
  if (wet > 0.5 && vPos.y < uLevel) {
    float sin2T = 1.7689 * (1.0 - cosI * cosI);
    float R = 1.0;
    if (sin2T < 1.0) {
      float cosT = sqrt(1.0 - sin2T);
      R = 0.03 + 0.97 * pow(1.0 - cosT, 4.0);
    }
    vec3 r = reflect(V, n);
    vec3 mirror = mix(waterScatter(r) * (0.6 + 0.25 * r.y), uShallow * vec3(0.55, 0.5, 0.4), smoothstep(0.05, 0.7, -r.y) * 0.5);
    float glint = causticLayer(vPos.xy * uCausticScale * 0.6 + vPos.z * 0.05) * 0.045;
    color = mirror + glint;
    alpha = clamp(R * 0.92 + 0.07, 0.0, 1.0);
    color = mix(color, vec3(0.02, 0.09, 0.08), seam * 0.8);
    alpha = max(alpha, seam * 0.75);
    color = waterFog(color, vPos);
  } else {
    float R = 0.04 + 0.96 * pow(1.0 - cosI, 5.0);
    color = mix(vec3(0.05, 0.16, 0.17), vec3(0.25, 0.42, 0.46), R);
    alpha = clamp(R * 0.8 + 0.1, 0.0, 1.0);
    color = mix(color, vec3(0.02, 0.09, 0.08), seam * 0.8);
    alpha = max(alpha, seam * 0.75);
  }
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export type ShaftOptions = {
  count: number;
  wrap: number;
  length: number;
  width: number;
  color: string;
  strength: number;
};

export function lightShafts(
  uniforms: WaterUniforms,
  random: () => number,
  options: ShaftOptions,
): { mesh: THREE.Mesh; direction: { value: THREE.Vector3 } } {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  const base = new Float32Array(options.count * 4);
  for (let i = 0; i < options.count; i += 1) {
    base[i * 4] = random() * options.wrap;
    base[i * 4 + 1] = random() * options.wrap;
    base[i * 4 + 2] = options.width * (0.5 + random() * 1.1);
    base[i * 4 + 3] = random() * 40;
  }
  geometry.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 4));
  geometry.instanceCount = options.count;
  const direction = { value: new THREE.Vector3(0, -1, 0) };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uWrap: { value: options.wrap },
      uShaftDir: direction,
      uShaftLength: { value: options.length },
      uShaftColor: { value: new THREE.Color(options.color).multiplyScalar(options.strength) },
    },
    vertexShader: `
uniform float uTime;
uniform float uLevel;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uWrap;
uniform vec3 uShaftDir;
uniform float uShaftLength;
attribute vec4 aBase;
varying vec2 vUv;
varying float vFade;
varying float vPhase;
varying vec3 vPos;
void main() {
  vec2 drift = vec2(sin(uTime * 0.05 + aBase.w), cos(uTime * 0.04 + aBase.w * 1.7)) * 3.0;
  vec2 rel = mod(aBase.xy + drift - cameraPosition.xz + 0.5 * uWrap, uWrap) - 0.5 * uWrap;
  vec3 top = vec3(cameraPosition.x + rel.x, uLevel, cameraPosition.z + rel.y);
  float len = min(uShaftLength * (0.65 + 0.35 * fract(aBase.w * 3.7)), (uLevel - uBoxMin.y) / max(-uShaftDir.y, 0.2));
  vec3 mid = top + uShaftDir * len * 0.5;
  vec3 side = normalize(cross(uShaftDir, cameraPosition - mid));
  float width = aBase.z * (0.7 + position.y * 0.9);
  vec3 world = top + uShaftDir * len * position.y + side * position.x * width;
  vec2 inside = step(uBoxMin.xz, top.xz) * step(top.xz, uBoxMax.xz);
  float edge = 1.0 - smoothstep(0.32, 0.5, length(rel) / uWrap);
  float pulse = 0.55 + 0.45 * sin(uTime * 0.35 + aBase.w * 2.3);
  vFade = inside.x * inside.y * edge * pulse * step(cameraPosition.y, uLevel);
  vUv = vec2(position.x + 0.5, position.y);
  vPhase = aBase.w;
  vPos = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`,
    fragmentShader: `
#include <common>
uniform float uTime;
uniform vec3 uExtinction;
uniform vec3 uShaftColor;
varying vec2 vUv;
varying float vFade;
varying float vPhase;
varying vec3 vPos;
void main() {
  float x = vUv.x * 2.0 - 1.0;
  float bell = pow(max(0.0, 1.0 - x * x), 2.0);
  float streak = 0.55 + 0.45 * sin(x * 9.0 + vPhase * 5.0 + uTime * 0.4) * sin(x * 23.0 - vPhase * 3.0 - uTime * 0.27);
  float along = smoothstep(0.0, 0.06, vUv.y) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.3);
  float dist = distance(cameraPosition, vPos);
  float near = smoothstep(1.5, 9.0, dist);
  vec3 trans = exp(-uExtinction * dist * 0.8);
  gl_FragColor = vec4(uShaftColor * trans * bell * streak * along * near * vFade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return { mesh, direction };
}

function viewportHook(object: THREE.Object3D, uniforms: WaterUniforms): void {
  const size = new THREE.Vector2();
  object.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(size);
    uniforms.uViewport.value = size.y;
  };
}

export type ParticleOptions = {
  count: number;
  wrap: [number, number, number];
  size: number;
  color: string;
  alpha: number;
};

export function plankton(uniforms: WaterUniforms, random: () => number, options: ParticleOptions): THREE.Points {
  const seeds = new Float32Array(options.count * 3);
  const traits = new Float32Array(options.count * 2);
  for (let i = 0; i < options.count; i += 1) {
    seeds[i * 3] = random();
    seeds[i * 3 + 1] = random();
    seeds[i * 3 + 2] = random();
    traits[i * 2] = 0.4 + random() * random() * 1.6;
    traits[i * 2 + 1] = random() * 6.283;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(seeds, 3));
  geometry.setAttribute('aTrait', new THREE.Float32BufferAttribute(traits, 2));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uWrap3: { value: new THREE.Vector3(...options.wrap) },
      uSize: { value: options.size },
      uTint: { value: new THREE.Color(options.color) },
      uAlpha: { value: options.alpha },
    },
    vertexShader: `
uniform float uTime;
uniform float uLevel;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uWrap3;
uniform float uSize;
uniform float uViewport;
attribute vec2 aTrait;
varying float vAlpha;
void main() {
  vec3 p = position * uWrap3;
  p += vec3(sin(uTime * 0.11 + aTrait.y), sin(uTime * 0.07 + aTrait.y * 1.9) * 0.5 + uTime * 0.03, cos(uTime * 0.09 + aTrait.y * 1.3)) * 0.9;
  vec3 rel = mod(p - cameraPosition + 0.5 * uWrap3, uWrap3) - 0.5 * uWrap3;
  vec3 world = cameraPosition + rel;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  float dist = -mv.z;
  vec3 inside = step(uBoxMin + 0.2, world) * step(world, uBoxMax - 0.2);
  float edge = 1.0 - smoothstep(0.35, 0.5, max(abs(rel.x) / uWrap3.x, abs(rel.z) / uWrap3.z));
  float twinkle = 0.6 + 0.4 * sin(uTime * 1.3 + aTrait.y * 5.0);
  vAlpha = inside.x * inside.y * inside.z * edge * twinkle * smoothstep(0.6, 3.0, dist) * step(cameraPosition.y, uLevel);
  gl_PointSize = clamp(uSize * aTrait.x * uViewport * projectionMatrix[1][1] * 0.5 / max(dist, 0.1), 1.0, 14.0);
  gl_Position = projectionMatrix * mv;
}
`,
    fragmentShader: `
#include <common>
uniform vec3 uTint;
uniform float uAlpha;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  float a = smoothstep(1.0, 0.1, d) * vAlpha * uAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uTint, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 4;
  viewportHook(points, uniforms);
  return points;
}

export type BubbleSource = { x: number; y: number; z: number };

export function bubbleStreams(
  uniforms: WaterUniforms,
  random: () => number,
  sources: BubbleSource[],
  perSource: number,
): THREE.Points {
  const count = sources.length * perSource;
  const origin = new Float32Array(count * 3);
  const traits = new Float32Array(count * 4);
  sources.forEach((source, s) => {
    const burst = random() * 10;
    for (let k = 0; k < perSource; k += 1) {
      const i = s * perSource + k;
      origin[i * 3] = source.x;
      origin[i * 3 + 1] = source.y;
      origin[i * 3 + 2] = source.z;
      traits[i * 4] = random();
      traits[i * 4 + 1] = 0.9 + random() * 0.9;
      traits[i * 4 + 2] = 0.5 + random() * random() * 1.6;
      traits[i * 4 + 3] = burst + random() * 6.283;
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(origin, 3));
  geometry.setAttribute('aTrait', new THREE.Float32BufferAttribute(traits, 4));
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms },
    vertexShader: `
uniform float uTime;
uniform float uLevel;
uniform float uViewport;
attribute vec4 aTrait;
varying float vAlpha;
void main() {
  float height = max(uLevel - position.y, 1.0);
  float travel = fract(aTrait.x + uTime * aTrait.y * 1.7 / height);
  float rise = travel * height;
  float spread = 0.12 + rise * 0.05;
  vec3 world = position + vec3(sin(uTime * 2.1 + aTrait.w + rise * 0.9) * spread, rise, cos(uTime * 1.7 + aTrait.w * 1.3 + rise * 0.7) * spread);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  float dist = -mv.z;
  float size = 0.02 * aTrait.z * (1.0 + travel * 1.2);
  vAlpha = smoothstep(0.0, 0.04, travel) * smoothstep(1.0, 0.94, travel) * smoothstep(0.5, 2.5, dist) * step(cameraPosition.y, uLevel);
  gl_PointSize = clamp(size * uViewport * projectionMatrix[1][1] / max(dist, 0.1), 1.5, 24.0);
  gl_Position = projectionMatrix * mv;
}
`,
    fragmentShader: `
#include <common>
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float rim = smoothstep(0.35, 1.0, d);
  float spark = smoothstep(0.12, 0.0, distance(c, vec2(-0.35, -0.4)));
  vec3 color = mix(vec3(0.55, 0.8, 0.9), vec3(0.95, 1.0, 1.0), rim) + spark * 1.2;
  gl_FragColor = vec4(color, (0.12 + rim * 0.5 + spark) * vAlpha * 0.8);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 4;
  viewportHook(points, uniforms);
  return points;
}

export function backdropMaterial(uniforms: WaterUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms },
    vertexShader: `
varying vec3 vPos;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`,
    fragmentShader: `
#include <common>
${WATER_COMMON}
varying vec3 vPos;
void main() {
  gl_FragColor = vec4(waterScatter(normalize(vPos - cameraPosition)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,
    side: THREE.BackSide,
  });
}
