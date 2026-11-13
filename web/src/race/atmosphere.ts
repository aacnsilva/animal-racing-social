import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export type Look = {
  elevation: number;
  azimuth: number;
  turbidity: number;
  rayleigh: number;
  mie: number;
  mieG: number;
  clouds: number;
  cloudDensity: number;
  cloudElevation: number;
  sunColor: string;
  sunIntensity: number;
  ambient: number;
  skyGain: number;
  exposure: number;
  haze: number;
};

const BASE: Look = {
  elevation: 38,
  azimuth: 140,
  turbidity: 3,
  rayleigh: 1.3,
  mie: 0.004,
  mieG: 0.82,
  clouds: 0.38,
  cloudDensity: 0.5,
  cloudElevation: 0.45,
  sunColor: '#fff0da',
  sunIntensity: 3.9,
  ambient: 0.62,
  skyGain: 1,
  exposure: 1,
  haze: 1,
};

const LOOKS: Record<string, Partial<Look>> = {
  GRASS: {},
  SAND: {
    elevation: 19,
    azimuth: 205,
    turbidity: 7,
    rayleigh: 2.4,
    mie: 0.008,
    clouds: 0.16,
    sunColor: '#ffd3a0',
    sunIntensity: 4.1,
    haze: 0.85,
  },
  DIRT: {
    elevation: 46,
    azimuth: 120,
    turbidity: 4.5,
    rayleigh: 1,
    clouds: 0.26,
    sunColor: '#ffe9c8',
    sunIntensity: 4.2,
  },
  MUD: {
    elevation: 52,
    azimuth: 160,
    turbidity: 8,
    rayleigh: 1.3,
    mie: 0.008,
    clouds: 0.86,
    cloudDensity: 0.85,
    sunColor: '#e6ecee',
    sunIntensity: 1.7,
    ambient: 0.95,
    haze: 1.25,
    exposure: 0.95,
  },
  ICE: {
    elevation: 15,
    azimuth: 215,
    turbidity: 2,
    rayleigh: 1.7,
    clouds: 0.22,
    cloudElevation: 0.6,
    sunColor: '#ffe6cc',
    sunIntensity: 3.3,
    ambient: 0.6,
    haze: 1.1,
    exposure: 0.82,
  },
  POOL: { elevation: 58, azimuth: 150, turbidity: 2.5, clouds: 0.25, sunIntensity: 3.4, ambient: 1 },
  AQUARIUM: { elevation: 60, azimuth: 150, clouds: 0.3, sunIntensity: 1.6, ambient: 0.55, skyGain: 0.35 },
  OPEN_SEA: { elevation: 55, azimuth: 150, turbidity: 3, clouds: 0.3, sunIntensity: 3, ambient: 1 },
};

export const lookFor = (surface: string): Look => ({ ...BASE, ...LOOKS[surface] });

export type Atmosphere = {
  look: Look;
  sunDirection: THREE.Vector3;
  background: THREE.Texture;
  environment: THREE.Texture;
  horizon: THREE.Color;
  zenith: THREE.Color;
  gain: number;
  haze: THREE.Color;
  dispose: () => void;
};

function readTexel(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLCubeRenderTarget,
  face: number,
  x: number,
  y: number,
) {
  const buffer = new Uint16Array(4);
  renderer.readRenderTargetPixels(target, x, y, 1, 1, buffer, face);
  return new THREE.Color(
    THREE.DataUtils.fromHalfFloat(buffer[0]),
    THREE.DataUtils.fromHalfFloat(buffer[1]),
    THREE.DataUtils.fromHalfFloat(buffer[2]),
  );
}

const luma = (c: THREE.Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

export function bakeAtmosphere(
  renderer: THREE.WebGLRenderer,
  surface: string,
  seed: number,
  facing: number | null,
): Atmosphere {
  const look = lookFor(surface);
  const elevation = THREE.MathUtils.degToRad(look.elevation);
  const azimuth = facing ?? THREE.MathUtils.degToRad(look.azimuth);
  const sunDirection = new THREE.Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  );
  const sky = new Sky();
  sky.scale.setScalar(1000);
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = look.turbidity;
  uniforms.rayleigh.value = look.rayleigh;
  uniforms.mieCoefficient.value = look.mie;
  uniforms.mieDirectionalG.value = look.mieG;
  uniforms.sunPosition.value.copy(sunDirection);
  uniforms.cloudCoverage.value = look.clouds;
  uniforms.cloudDensity.value = look.cloudDensity;
  uniforms.cloudElevation.value = look.cloudElevation;
  uniforms.time.value = 40 + seed * 13;
  const stage = new THREE.Scene();
  stage.add(sky);

  const cap = { value: 1e6 };
  sky.material.uniforms.uCap = cap;
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('uniform float showSunDisc;', 'uniform float showSunDisc;\nuniform float uCap;')
    .replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      'float peak = max( texColor.r, max( texColor.g, texColor.b ) );\ntexColor *= min( 1.0, uCap * ( 1.0 - exp( - peak / uCap ) ) / max( peak, 0.0001 ) );\ngl_FragColor = vec4( texColor, 1.0 );',
    );
  uniforms.showSunDisc.value = 0;

  const size = 1024;
  const options = { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter };
  const backdrop = new THREE.WebGLCubeRenderTarget(size, options);
  const ambient = new THREE.WebGLCubeRenderTarget(256, options);
  const toneMapping = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  new THREE.CubeCamera(1, 3000, ambient).update(renderer, stage);

  const rows: number[] = [];
  for (const face of [0, 1, 4, 5]) {
    for (const x of [40, 128, 216]) {
      const low = readTexel(renderer, ambient, face, x, 118);
      const high = readTexel(renderer, ambient, face, x, 138);
      rows.push(Math.max(luma(low), luma(high)));
    }
  }
  rows.sort((a, b) => a - b);
  const typical = rows[Math.floor(rows.length / 2)];
  const zenith = readTexel(renderer, ambient, 2, 128, 128);
  const gain = 1.3 / Math.max(0.2, typical, luma(zenith));
  cap.value = 2.6 / gain;
  new THREE.CubeCamera(1, 3000, ambient).update(renderer, stage);
  new THREE.CubeCamera(1, 3000, backdrop).update(renderer, stage);
  renderer.toneMapping = toneMapping;

  const horizon = new THREE.Color(0, 0, 0);
  let counted = 0;
  for (const face of [0, 1, 4, 5]) {
    for (const x of [40, 128, 216]) {
      const low = readTexel(renderer, ambient, face, x, 118);
      const high = readTexel(renderer, ambient, face, x, 138);
      horizon.add(luma(low) > luma(high) ? low : high);
      counted += 1;
    }
  }
  horizon.multiplyScalar(1 / counted);
  const haze = horizon
    .clone()
    .lerp(zenith, 0.3)
    .multiplyScalar(gain * look.skyGain * 0.5);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromCubemap(ambient.texture);
  pmrem.dispose();
  ambient.dispose();
  sky.geometry.dispose();
  sky.material.dispose();
  renderer.setRenderTarget(null);

  return {
    look,
    sunDirection,
    background: backdrop.texture,
    environment: environment.texture,
    horizon,
    zenith,
    gain,
    haze,
    dispose: () => {
      backdrop.dispose();
      environment.dispose();
    },
  };
}

export function sunSprite(atmosphere: Atmosphere): THREE.Sprite {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.07, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.12, 'rgba(255,255,255,0.3)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.04)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const map = new THREE.CanvasTexture(canvas);
  const clear = 1 - atmosphere.look.clouds * 0.75;
  const material = new THREE.SpriteMaterial({
    map,
    color: new THREE.Color(atmosphere.look.sunColor).multiplyScalar(4.5 * clear),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(170);
  sprite.renderOrder = -1;
  return sprite;
}
