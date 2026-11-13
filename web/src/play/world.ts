import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry } from './roster';
import { ROAD_HALF, WALL_AT, type Pose, type Theme, type Track } from './tracks';

export type Quality = 'high' | 'medium' | 'low';

export type PadSpot = { s: number; lat: number; x: number; z: number };
export type TreatSpot = { s: number; lat: number; x: number; z: number; mesh: THREE.Group; readyAt: number };

export type World = {
  sun: THREE.DirectionalLight;
  pads: PadSpot[];
  treats: TreatSpot[];
  update: (time: number, camera: THREE.Camera) => void;
  dispose: () => void;
};

const TAU = Math.PI * 2;
const pose: Pose = { x: 0, z: 0, heading: 0, tx: 0, tz: 0, nx: 0, nz: 0 };
const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const scaleV = new THREE.Vector3();
const posV = new THREE.Vector3();
const euler = new THREE.Euler();

function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  repeat = true,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function speckle(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  color: string,
  count: number,
  size: number,
  alpha: number,
) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alpha * (0.4 + random() * 0.6);
    const r = size * (0.4 + random());
    ctx.beginPath();
    ctx.ellipse(
      random() * ctx.canvas.width,
      random() * ctx.canvas.height,
      r,
      r * (0.5 + random() * 0.6),
      random() * 3,
      0,
      TAU,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function ribbon(track: Track, latA: number, latB: number, y: number, vScale: number): THREE.BufferGeometry {
  const n = track.n;
  const positions = new Float32Array((n + 1) * 6);
  const uvs = new Float32Array((n + 1) * 4);
  const indices: number[] = [];
  for (let i = 0; i <= n; i++) {
    const j = i % n;
    const nx = track.tz[j];
    const nz = -track.tx[j];
    positions.set(
      [track.px[j] + nx * latA, y, track.pz[j] + nz * latA, track.px[j] + nx * latB, y, track.pz[j] + nz * latB],
      i * 6,
    );
    const v = (i * track.spacing) / vScale;
    uvs.set([0, v, 1, v], i * 4);
    if (i < n) {
      const base = i * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function wall(track: Track, lat: number, height: number, vScale: number): THREE.BufferGeometry {
  const n = track.n;
  const positions = new Float32Array((n + 1) * 6);
  const uvs = new Float32Array((n + 1) * 4);
  const indices: number[] = [];
  for (let i = 0; i <= n; i++) {
    const j = i % n;
    const x = track.px[j] + track.tz[j] * lat;
    const z = track.pz[j] - track.tx[j] * lat;
    positions.set([x, 0, z, x, height, z], i * 6);
    const u = (i * track.spacing) / vScale;
    uvs.set([u, 0, u, 1], i * 4);
    if (i < n) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function tinted(geometry: THREE.BufferGeometry, color: string, topColor?: string): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = flat.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const base = new THREE.Color(color);
  const top = new THREE.Color(topColor ?? color);
  flat.computeBoundingBox();
  const minY = flat.boundingBox!.min.y;
  const span = Math.max(1e-3, flat.boundingBox!.max.y - minY);
  const mixed = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = (position.getY(i) - minY) / span;
    mixed.copy(base).lerp(top, t > 0.55 ? 1 : 0);
    colors.set([mixed.r, mixed.g, mixed.b], i * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  flat.deleteAttribute('uv');
  return flat;
}

function moved(geometry: THREE.BufferGeometry, x: number, y: number, z: number, rz = 0, rx = 0): THREE.BufferGeometry {
  if (rz) geometry.rotateZ(rz);
  if (rx) geometry.rotateX(rx);
  geometry.translate(x, y, z);
  return geometry;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  geometry.computeVertexNormals();
  return geometry;
}

type Placement = { x: number; z: number; scale: number; rot: number; tint: number; sy?: number; y?: number };

const PROPS: Record<string, () => THREE.BufferGeometry> = {
  tree: () =>
    merged([
      tinted(moved(new THREE.CylinderGeometry(0.35, 0.5, 3, 6), 0, 1.5, 0), '#7a5230'),
      tinted(moved(new THREE.IcosahedronGeometry(2.3, 0), 0, 4.4, 0), '#3f9a3c', '#58b94a'),
      tinted(moved(new THREE.IcosahedronGeometry(1.6, 0), 0.9, 6, 0.3), '#4aa844', '#6cc85a'),
    ]),
  pine: () =>
    merged([
      tinted(moved(new THREE.CylinderGeometry(0.3, 0.42, 2, 6), 0, 1, 0), '#5d4028'),
      tinted(moved(new THREE.ConeGeometry(2.2, 3.4, 7), 0, 3.4, 0), '#2f7d46', '#3f9a57'),
      tinted(moved(new THREE.ConeGeometry(1.6, 2.8, 7), 0, 5.4, 0), '#368a4d', '#4cab64'),
      tinted(moved(new THREE.ConeGeometry(1.0, 2.2, 7), 0, 7.1, 0), '#3f9a57', '#5cbc74'),
    ]),
  snowpine: () =>
    merged([
      tinted(moved(new THREE.CylinderGeometry(0.3, 0.42, 2, 6), 0, 1, 0), '#3a3046'),
      tinted(moved(new THREE.ConeGeometry(2.2, 3.4, 7), 0, 3.4, 0), '#1f4a5a', '#e8f2ff'),
      tinted(moved(new THREE.ConeGeometry(1.6, 2.8, 7), 0, 5.4, 0), '#24566a', '#e8f2ff'),
      tinted(moved(new THREE.ConeGeometry(1.0, 2.2, 7), 0, 7.1, 0), '#2a6278', '#ffffff'),
    ]),
  bush: () =>
    merged([
      tinted(moved(new THREE.IcosahedronGeometry(1, 0), 0, 0.7, 0), '#3d9440', '#5cb850'),
      tinted(moved(new THREE.IcosahedronGeometry(0.7, 0), 0.8, 0.5, 0.2), '#4aa848', '#6cc85a'),
    ]),
  flower: () =>
    merged([
      tinted(moved(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 4), 0, 0.25, 0), '#3c8a3a'),
      tinted(moved(new THREE.IcosahedronGeometry(0.2, 0), 0, 0.58, 0), '#ffffff'),
    ]),
  hay: () => tinted(moved(new THREE.CylinderGeometry(1, 1, 1.5, 10), 0, 1, 0, Math.PI / 2), '#e2c25c', '#f0d67a'),
  rock: () => tinted(moved(new THREE.DodecahedronGeometry(1, 0), 0, 0.55, 0), '#8d8478', '#a59c8e'),
  cactus: () =>
    merged([
      tinted(moved(new THREE.CapsuleGeometry(0.45, 3.2, 2, 7), 0, 2.05, 0), '#3f8f4d', '#58a862'),
      tinted(moved(new THREE.CapsuleGeometry(0.28, 0.9, 2, 6), 0.95, 2.1, 0, Math.PI / 2), '#3f8f4d'),
      tinted(moved(new THREE.CapsuleGeometry(0.28, 1.1, 2, 6), 1.4, 2.8, 0), '#4a9a58', '#58a862'),
      tinted(moved(new THREE.CapsuleGeometry(0.26, 0.8, 2, 6), -0.85, 1.6, 0, Math.PI / 2), '#3f8f4d'),
      tinted(moved(new THREE.CapsuleGeometry(0.26, 0.9, 2, 6), -1.25, 2.2, 0), '#4a9a58', '#58a862'),
    ]),
  tumble: () => tinted(moved(new THREE.IcosahedronGeometry(0.8, 1), 0, 0.7, 0), '#a8804a', '#c49a5c'),
  mesa: () =>
    merged([
      tinted(moved(new THREE.CylinderGeometry(0.8, 1.1, 1, 9), 0, 0.5, 0), '#b5603a', '#d8824e'),
      tinted(moved(new THREE.CylinderGeometry(0.55, 0.75, 0.35, 9), 0, 1.17, 0), '#c56f42', '#e39258'),
    ]),
  coral: () =>
    merged([
      tinted(moved(new THREE.ConeGeometry(0.35, 2.4, 5), 0, 1.2, 0), '#ffffff'),
      tinted(moved(new THREE.ConeGeometry(0.28, 1.8, 5), 0.6, 0.9, 0.1, -0.5), '#ffffff'),
      tinted(moved(new THREE.ConeGeometry(0.28, 1.9, 5), -0.55, 0.95, -0.1, 0.5), '#ffffff'),
      tinted(moved(new THREE.ConeGeometry(0.22, 1.4, 5), 0.1, 0.7, 0.6, 0, 0.55), '#ffffff'),
      tinted(moved(new THREE.ConeGeometry(0.22, 1.5, 5), -0.1, 0.75, -0.6, 0, -0.55), '#ffffff'),
    ]),
  brain: () => {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    geometry.scale(1.3, 0.75, 1.3);
    return tinted(moved(geometry, 0, 0.45, 0), '#ffffff');
  },
  kelp: () => {
    const geometry = new THREE.CylinderGeometry(0.05, 0.3, 7, 4, 6);
    geometry.scale(1, 1, 0.3);
    return tinted(moved(geometry, 0, 3.5, 0), '#1f8a5c', '#48c98a');
  },
  shell: () => {
    const geometry = new THREE.SphereGeometry(1, 8, 5, 0, TAU, 0, Math.PI / 2);
    geometry.scale(1, 0.6, 0.8);
    return tinted(geometry, '#ffd9e6', '#ffffff');
  },
  crystal: () => {
    const geometry = new THREE.OctahedronGeometry(1, 0);
    geometry.scale(0.6, 1.8, 0.6);
    return tinted(moved(geometry, 0, 1.3, 0), '#ffffff');
  },
  peak: () => tinted(moved(new THREE.ConeGeometry(1, 1, 7), 0, 0.5, 0), '#ffffff'),
  hill: () => {
    const geometry = new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2);
    return tinted(geometry, '#ffffff');
  },
  post: () =>
    merged([
      tinted(moved(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 5), 0, 2.7, 0), '#2a3158'),
      tinted(moved(new THREE.BoxGeometry(1.5, 0.12, 0.2), 0.7, 5.4, 0), '#2a3158'),
    ]),
};

export function buildWorld(scene: THREE.Scene, track: Track, quality: Quality, seed: number): World {
  const theme: Theme = track.def.theme;
  const id = track.def.id;
  const random = mulberry(seed);
  const density = quality === 'high' ? 1 : quality === 'medium' ? 0.7 : 0.42;
  const disposables: { dispose: () => void }[] = [];
  const animated: ((time: number, camera: THREE.Camera) => void)[] = [];
  const keep = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };
  const lambert = (params: THREE.MeshLambertMaterialParameters) => keep(new THREE.MeshLambertMaterial(params));
  const basic = (params: THREE.MeshBasicMaterialParameters) => keep(new THREE.MeshBasicMaterial(params));
  const add = <T extends THREE.Object3D>(object: T): T => {
    scene.add(object);
    return object;
  };
  const cx = (track.minX + track.maxX) / 2;
  const cz = (track.minZ + track.maxZ) / 2;
  const extent = Math.max(track.maxX - track.minX, track.maxZ - track.minZ);

  scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar);
  scene.background = new THREE.Color(theme.fog);
  add(new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiIntensity));
  const sun = add(new THREE.DirectionalLight(theme.sun, theme.sunIntensity));
  const sunDir = new THREE.Vector3(...theme.sunDir).normalize();
  sun.position.copy(sunDir).multiplyScalar(120);
  add(sun.target);
  if (quality !== 'low') {
    sun.castShadow = true;
    const size = quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(size, size);
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -46;
    cam.right = cam.top = 46;
    cam.near = 10;
    cam.far = 260;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.05;
  }

  const sky = add(
    new THREE.Mesh(
      keep(new THREE.SphereGeometry(1500, 24, 14)),
      keep(
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          depthWrite: false,
          fog: false,
          toneMapped: false,
          uniforms: {
            top: { value: new THREE.Color(theme.skyTop) },
            horizon: { value: new THREE.Color(theme.skyHorizon) },
            bottom: { value: new THREE.Color(theme.skyBottom) },
            sunColor: { value: new THREE.Color(theme.sun) },
            sunDir: { value: sunDir },
            glow: { value: id === 'reef' ? 0.5 : id === 'aurora' ? 0.35 : 1 },
          },
          vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; }`,
          fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunColor; uniform vec3 sunDir; uniform float glow; varying vec3 vDir;
            void main() {
              vec3 dir = normalize(vDir);
              vec3 col = dir.y > 0.0 ? mix(horizon, top, pow(dir.y, 0.5)) : mix(horizon, bottom, pow(-dir.y, 0.4));
              float d = max(dot(dir, sunDir), 0.0);
              col += sunColor * (pow(d, 600.0) * 1.6 + pow(d, 24.0) * 0.28 + pow(d, 4.0) * 0.1) * glow;
              gl_FragColor = vec4(col, 1.0);
              #include <colorspace_fragment>
            }`,
        }),
      ),
    ),
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  animated.push((_time, camera) => sky.position.copy(camera.position));

  const groundTexture = keep(
    canvasTexture(256, 256, (ctx) => {
      ctx.fillStyle = theme.ground;
      ctx.fillRect(0, 0, 256, 256);
      speckle(ctx, random, theme.groundAlt, 90, 16, 0.55);
      speckle(ctx, random, '#ffffff', 60, 2.2, 0.12);
      speckle(ctx, random, '#000000', 60, 2.4, 0.08);
    }),
  );
  groundTexture.repeat.set(90, 90);
  const ground = add(
    new THREE.Mesh(keep(new THREE.PlaneGeometry(extent + 2600, extent + 2600)), lambert({ map: groundTexture })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, 0, cz);
  ground.receiveShadow = true;

  const shoulderTexture = keep(
    canvasTexture(64, 256, (ctx) => {
      ctx.fillStyle = theme.shoulder;
      ctx.fillRect(0, 0, 64, 256);
      speckle(ctx, random, theme.groundAlt, 40, 7, 0.5);
      speckle(ctx, random, '#000000', 30, 1.6, 0.1);
    }),
  );
  const shoulder = add(
    new THREE.Mesh(keep(ribbon(track, -WALL_AT, WALL_AT, 0.03, 14)), lambert({ map: shoulderTexture })),
  );
  shoulder.receiveShadow = true;

  const roadTexture = keep(
    canvasTexture(256, 512, (ctx) => {
      ctx.fillStyle = theme.road;
      ctx.fillRect(0, 0, 256, 512);
      speckle(ctx, random, theme.roadAlt, 160, 9, 0.6);
      speckle(ctx, random, '#000000', 240, 1.3, 0.14);
      speckle(ctx, random, '#ffffff', 200, 1.1, 0.1);
      ctx.fillStyle = theme.line;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(10, 0, 5, 512);
      ctx.fillRect(241, 0, 5, 512);
      ctx.globalAlpha = 0.6;
      ctx.fillRect(126, 40, 4, 180);
      ctx.fillRect(126, 296, 4, 180);
      ctx.globalAlpha = 1;
    }),
  );
  roadTexture.anisotropy = 8;
  const road = add(
    new THREE.Mesh(
      keep(ribbon(track, -ROAD_HALF, ROAD_HALF, 0.06, 24)),
      lambert(
        id === 'aurora'
          ? { map: roadTexture, emissive: '#ffffff', emissiveMap: roadTexture, emissiveIntensity: 0.22 }
          : { map: roadTexture },
      ),
    ),
  );
  road.receiveShadow = true;

  const kerbTexture = keep(
    canvasTexture(8, 64, (ctx) => {
      ctx.fillStyle = theme.kerbA;
      ctx.fillRect(0, 0, 8, 32);
      ctx.fillStyle = theme.kerbB;
      ctx.fillRect(0, 32, 8, 32);
    }),
  );
  kerbTexture.magFilter = THREE.NearestFilter;
  const kerbMaterial = lambert(
    id === 'aurora' || id === 'reef'
      ? {
          map: kerbTexture,
          emissive: '#ffffff',
          emissiveMap: kerbTexture,
          emissiveIntensity: id === 'aurora' ? 0.9 : 0.3,
        }
      : { map: kerbTexture },
  );
  for (const side of [-1, 1]) {
    const kerb = add(
      new THREE.Mesh(
        keep(ribbon(track, side > 0 ? ROAD_HALF : -ROAD_HALF - 1.1, side > 0 ? ROAD_HALF + 1.1 : -ROAD_HALF, 0.09, 5)),
        kerbMaterial,
      ),
    );
    kerb.receiveShadow = true;
  }

  const wallTexture = keep(
    canvasTexture(128, 32, (ctx) => {
      ctx.fillStyle = theme.wall;
      ctx.fillRect(0, 0, 128, 32);
      ctx.fillStyle = theme.wallAlt;
      ctx.fillRect(0, 22, 128, 5);
      ctx.fillRect(0, 0, 64, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, 2, 32);
      ctx.fillRect(64, 0, 2, 32);
    }),
  );
  const wallMaterial = lambert(
    id === 'aurora'
      ? {
          map: wallTexture,
          side: THREE.DoubleSide,
          emissive: '#ffffff',
          emissiveMap: wallTexture,
          emissiveIntensity: 0.5,
        }
      : { map: wallTexture, side: THREE.DoubleSide },
  );
  for (const side of [-1, 1]) add(new THREE.Mesh(keep(wall(track, side * WALL_AT, 1.15, 6)), wallMaterial));

  const checker = keep(
    canvasTexture(
      64,
      16,
      (ctx) => {
        for (let x = 0; x < 16; x++)
          for (let y = 0; y < 4; y++) {
            ctx.fillStyle = (x + y) % 2 ? '#15151a' : '#fafafa';
            ctx.fillRect(x * 4, y * 4, 4, 4);
          }
      },
      false,
    ),
  );
  checker.magFilter = THREE.NearestFilter;
  track.pose(0, 0, pose);
  const startHeading = pose.heading;
  const line = add(
    new THREE.Mesh(keep(new THREE.PlaneGeometry(ROAD_HALF * 2, 2.2)), basic({ map: checker, fog: true })),
  );
  line.rotation.set(-Math.PI / 2, startHeading, 0, 'YXZ');
  line.position.set(pose.x, 0.08, pose.z);

  const gantry = add(new THREE.Group());
  gantry.position.set(pose.x, 0, pose.z);
  gantry.rotation.y = startHeading;
  const steel = lambert({ color: '#2b2f3a' });
  const postGeometry = keep(new THREE.BoxGeometry(0.7, 9, 0.7));
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeometry, steel);
    post.position.set(side * (ROAD_HALF + 2.2), 4.5, 0);
    post.castShadow = true;
    gantry.add(post);
  }
  const bannerTexture = keep(
    canvasTexture(
      1024,
      128,
      (ctx) => {
        const gradient = ctx.createLinearGradient(0, 0, 1024, 0);
        gradient.addColorStop(0, '#16181f');
        gradient.addColorStop(0.5, '#262a36');
        gradient.addColorStop(1, '#16181f');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 1024, 128);
        for (let x = 0; x < 8; x++)
          for (let y = 0; y < 8; y++) {
            ctx.fillStyle = (x + y) % 2 ? '#15151a' : '#fafafa';
            ctx.fillRect(x * 16, y * 16, 16, 16);
            ctx.fillRect(896 + x * 16, y * 16, 16, 16);
          }
        ctx.fillStyle = theme.accent;
        ctx.font = '900 76px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('ANIMAL GRAND PRIX', 512, 68);
      },
      false,
    ),
  );
  const banner = new THREE.Mesh(
    keep(new THREE.BoxGeometry(ROAD_HALF * 2 + 5.4, 2.4, 0.5)),
    basic({ map: bannerTexture, fog: true }),
  );
  banner.position.y = 8.2;
  gantry.add(banner);

  const standGroup = add(new THREE.Group());
  const concrete = lambert({ color: id === 'aurora' ? '#39446e' : id === 'reef' ? '#b89f72' : '#c9c4b8' });
  const stepGeometry = keep(new THREE.BoxGeometry(1, 1, 1));
  const crowdSpots: Placement[] = [];
  for (const side of [-1, 1]) {
    for (let block = 0; block < 2; block++) {
      const s = block === 0 ? 34 : -44;
      track.pose(s, side * (WALL_AT + 5), pose);
      const stand = new THREE.Group();
      stand.position.set(pose.x, 0, pose.z);
      stand.rotation.y = pose.heading + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
      for (let row = 0; row < 5; row++) {
        const step = new THREE.Mesh(stepGeometry, concrete);
        step.scale.set(36, 1.1 * (row + 1), 2);
        step.position.set(0, 0.55 * (row + 1), row * 2);
        stand.add(step);
        for (let seat = 0; seat < 34 * density; seat++) {
          const local = new THREE.Vector3((random() - 0.5) * 34, 1.1 * (row + 1) + 0.45, row * 2 + (random() - 0.5));
          local.applyAxisAngle(new THREE.Vector3(0, 1, 0), stand.rotation.y).add(stand.position);
          crowdSpots.push({ x: local.x, z: local.z, y: local.y, scale: 1, rot: 0, tint: random() });
        }
      }
      const roof = new THREE.Mesh(stepGeometry, lambert({ color: theme.wallAlt }));
      roof.scale.set(37, 0.3, 11);
      roof.position.set(0, 10.5, 5);
      stand.add(roof);
      for (const px of [-17.5, 17.5]) {
        const pillar = new THREE.Mesh(stepGeometry, steel);
        pillar.scale.set(0.5, 10.5, 0.5);
        pillar.position.set(px, 5.25, 9.5);
        stand.add(pillar);
      }
      standGroup.add(stand);
    }
  }
  const crowdColors = ['#ff5d6c', '#ffd23f', '#3d9bff', '#3ddc97', '#ffffff', '#ff8a3d', '#b47bff', '#f2a3c8'];
  const crowdGeometry = keep(new THREE.BoxGeometry(0.55, 0.9, 0.45));
  const crowd = add(
    new THREE.InstancedMesh(crowdGeometry, lambert({ color: '#ffffff' }), Math.max(1, crowdSpots.length)),
  );
  const crowdBase = crowdSpots.map((spot) => spot.y ?? 0);
  const crowdPhase = crowdSpots.map(() => random() * TAU);
  const tintColor = new THREE.Color();
  crowdSpots.forEach((spot, index) => {
    matrix.makeTranslation(spot.x, spot.y ?? 0, spot.z);
    crowd.setMatrixAt(index, matrix);
    crowd.setColorAt(index, tintColor.set(crowdColors[Math.floor(spot.tint * crowdColors.length)]));
  });
  crowd.count = crowdSpots.length;
  let crowdFrame = 0;
  animated.push((time) => {
    crowdFrame += 1;
    if (crowdFrame % 3 !== 0) return;
    for (let i = 0; i < crowdSpots.length; i++) {
      const hop = Math.max(0, Math.sin(time * 5 + crowdPhase[i])) * 0.28;
      matrix.makeTranslation(crowdSpots[i].x, crowdBase[i] + hop, crowdSpots[i].z);
      crowd.setMatrixAt(i, matrix);
    }
    crowd.instanceMatrix.needsUpdate = true;
  });

  const vertexMaterial = lambert({ vertexColors: true, flatShading: true });
  const place = (kind: string, spots: Placement[], options: { shadow?: boolean; material?: THREE.Material } = {}) => {
    if (spots.length === 0) return null;
    const mesh = new THREE.InstancedMesh(keep(PROPS[kind]()), options.material ?? vertexMaterial, spots.length);
    spots.forEach((spot, index) => {
      quat.setFromEuler(euler.set(0, spot.rot, 0));
      matrix.compose(
        posV.set(spot.x, spot.y ?? 0, spot.z),
        quat,
        scaleV.set(spot.scale, spot.scale * (spot.sy ?? 1), spot.scale),
      );
      mesh.setMatrixAt(index, matrix);
    });
    mesh.castShadow = Boolean(options.shadow) && quality !== 'low';
    mesh.receiveShadow = false;
    return add(mesh);
  };
  const colorize = (mesh: THREE.InstancedMesh | null, spots: Placement[], palette: string[], jitter = 0.12) => {
    if (!mesh) return;
    spots.forEach((spot, index) => {
      tintColor.set(palette[Math.floor(spot.tint * palette.length) % palette.length]);
      tintColor.offsetHSL(0, 0, (((spot.tint * 97) % 1) - 0.5) * jitter);
      mesh.setColorAt(index, tintColor);
    });
  };
  const standClear = (x: number, z: number) => {
    for (const s of [34, -44]) {
      track.pose(s, 0, pose);
      if (Math.hypot(x - pose.x, z - pose.z) < 48) return false;
    }
    return true;
  };
  const along = (count: number, near: number, far: number, minScale: number, maxScale: number): Placement[] => {
    const spots: Placement[] = [];
    const wanted = Math.round(count * density);
    for (let tries = 0; spots.length < wanted && tries < wanted * 6; tries++) {
      const i = Math.floor(random() * track.n);
      const side = random() < 0.5 ? -1 : 1;
      const d = near + (far - near) * random() ** 1.6;
      const x = track.px[i] + track.tz[i] * side * d;
      const z = track.pz[i] - track.tx[i] * side * d;
      if (track.distance(x, z) < Math.min(d, near) - 1.5 || !standClear(x, z)) continue;
      spots.push({ x, z, scale: minScale + (maxScale - minScale) * random(), rot: random() * TAU, tint: random() });
    }
    return spots;
  };
  const ring = (
    count: number,
    inner: number,
    outer: number,
    minScale: number,
    maxScale: number,
    sy: [number, number],
  ): Placement[] => {
    const spots: Placement[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * TAU + random() * 0.3;
      const radius = extent / 2 + inner + random() * (outer - inner);
      spots.push({
        x: cx + Math.cos(angle) * radius,
        z: cz + Math.sin(angle) * radius,
        scale: minScale + (maxScale - minScale) * random(),
        rot: random() * TAU,
        tint: random(),
        sy: sy[0] + (sy[1] - sy[0]) * random(),
      });
    }
    return spots;
  };

  if (id === 'meadow') {
    place('tree', along(150, WALL_AT + 5, 150, 0.8, 1.6), { shadow: true });
    place('pine', along(70, WALL_AT + 6, 170, 0.8, 1.5), { shadow: true });
    place('bush', along(120, WALL_AT + 2, 60, 0.6, 1.4));
    place('hay', along(26, WALL_AT + 2.5, 10, 0.9, 1.1), { shadow: true });
    const flowers = along(420, WALL_AT + 1.5, 45, 0.8, 1.6);
    colorize(place('flower', flowers), flowers, ['#ffffff', '#ffd23f', '#ff8fb8', '#b9a0ff', '#ff6b5e'], 0);
    const hills = ring(16, 160, 420, 90, 220, [0.25, 0.5]);
    colorize(place('hill', hills), hills, ['#5aa84a', '#69b658', '#4f9a44'], 0.05);
  } else if (id === 'dunes') {
    place('cactus', along(110, WALL_AT + 4, 130, 0.8, 1.7), { shadow: true });
    place('rock', along(120, WALL_AT + 2, 110, 0.7, 3.2), { shadow: true });
    place('tumble', along(80, WALL_AT + 2, 50, 0.6, 1.2));
    const mesas = ring(18, 150, 420, 50, 110, [0.6, 1.5]);
    place('mesa', mesas);
    const dunes = ring(14, 60, 300, 110, 240, [0.12, 0.22]);
    colorize(place('hill', dunes), dunes, ['#dba55c', '#e3b068', '#d49a52'], 0.04);
  } else if (id === 'reef') {
    const corals = along(260, WALL_AT + 2, 90, 0.8, 2.6);
    colorize(
      place('coral', corals, { shadow: true }),
      corals,
      ['#ff5d8f', '#ff9a3d', '#ffd23f', '#b47bff', '#3de0c8', '#ff6b5e'],
      0.2,
    );
    const brains = along(110, WALL_AT + 2, 80, 0.8, 2.8);
    colorize(place('brain', brains, { shadow: true }), brains, ['#ff8fb8', '#ffb86b', '#9ad0ff', '#c9a0ff'], 0.15);
    const shells = along(60, WALL_AT + 1.5, 40, 0.5, 1.3);
    colorize(place('shell', shells), shells, ['#ffe9f0', '#fff3d6', '#d9f5ff'], 0.05);
    place('rock', along(90, WALL_AT + 3, 140, 1, 5), { shadow: true });
    const kelpMaterial = keep(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    const sway = { value: 0 };
    kelpMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uSway = sway;
      shader.vertexShader = `uniform float uSway;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float kelpPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
        transformed.x += sin(uSway * 1.3 + kelpPhase + position.y * 0.5) * position.y * 0.09;
        transformed.z += cos(uSway * 1.1 + kelpPhase) * position.y * 0.05;`,
      );
    };
    place('kelp', along(260, WALL_AT + 2, 120, 0.7, 2.2), { material: kelpMaterial });
    animated.push((time) => {
      sway.value = time;
    });
    const mounds = ring(14, 80, 300, 80, 180, [0.3, 0.6]);
    colorize(place('hill', mounds), mounds, ['#2f7f8a', '#3a8f96', '#286f7c'], 0.05);

    const causticTexture = keep(
      canvasTexture(256, 256, (ctx) => {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 256, 256);
        ctx.strokeStyle = '#ffffff';
        ctx.lineCap = 'round';
        for (let i = 0; i < 70; i++) {
          ctx.globalAlpha = 0.25 + random() * 0.5;
          ctx.lineWidth = 1 + random() * 2.5;
          ctx.beginPath();
          const x = random() * 256;
          const y = random() * 256;
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(
            x + (random() - 0.5) * 90,
            y + (random() - 0.5) * 90,
            x + (random() - 0.5) * 110,
            y + (random() - 0.5) * 110,
          );
          ctx.stroke();
        }
      }),
    );
    causticTexture.repeat.set(70, 70);
    const caustics = add(
      new THREE.Mesh(
        keep(new THREE.PlaneGeometry(extent + 900, extent + 900)),
        basic({
          map: causticTexture,
          transparent: true,
          opacity: 0.22,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          color: '#aef7ff',
        }),
      ),
    );
    caustics.rotation.x = -Math.PI / 2;
    caustics.position.set(cx, 0.12, cz);
    animated.push((time) => causticTexture.offset.set(time * 0.012, Math.sin(time * 0.3) * 0.02 + time * 0.007));

    const fishCount = Math.round(70 * density);
    const fishGeometry = keep(new THREE.ConeGeometry(0.35, 1.5, 4));
    fishGeometry.rotateX(Math.PI / 2);
    fishGeometry.scale(0.5, 1, 1);
    const fish = add(new THREE.InstancedMesh(fishGeometry, lambert({ color: '#ffffff' }), fishCount));
    const schools = Array.from({ length: fishCount }, (_, index) => {
      const i = Math.floor(random() * track.n);
      const palette = ['#ffb347', '#ff6f91', '#7de0ff', '#fff27a', '#b9a0ff'];
      fish.setColorAt(index, tintColor.set(palette[index % palette.length]));
      return {
        x: track.px[i],
        z: track.pz[i],
        radius: 6 + random() * 16,
        height: 5 + random() * 12,
        speed: (0.25 + random() * 0.4) * (random() < 0.5 ? -1 : 1),
        phase: random() * TAU,
      };
    });
    animated.push((time) => {
      schools.forEach((entry, index) => {
        const angle = entry.phase + time * entry.speed;
        quat.setFromEuler(euler.set(0, -angle + (entry.speed > 0 ? 0 : Math.PI), 0));
        matrix.compose(
          posV.set(
            entry.x + Math.cos(angle) * entry.radius,
            entry.height + Math.sin(time * 0.8 + entry.phase) * 0.8,
            entry.z + Math.sin(angle) * entry.radius,
          ),
          quat,
          scaleV.set(1, 1, 1),
        );
        fish.setMatrixAt(index, matrix);
      });
      fish.instanceMatrix.needsUpdate = true;
    });

    const rayGeometry = keep(new THREE.CylinderGeometry(1.5, 9, 90, 8, 1, true));
    const rayMaterial = basic({
      color: '#bffcff',
      transparent: true,
      opacity: 0.055,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    for (let i = 0; i < Math.round(22 * density); i++) {
      const j = Math.floor(random() * track.n);
      const ray = add(new THREE.Mesh(rayGeometry, rayMaterial));
      ray.position.set(track.px[j] + (random() - 0.5) * 70, 44, track.pz[j] + (random() - 0.5) * 70);
      ray.rotation.set((random() - 0.5) * 0.3, 0, (random() - 0.5) * 0.3);
    }
  } else {
    place('snowpine', along(210, WALL_AT + 5, 170, 0.8, 1.8), { shadow: true });
    const stones = along(90, WALL_AT + 2, 110, 0.7, 2.8);
    colorize(place('rock', stones, { shadow: true }), stones, ['#dfe9ff', '#c8d6f5', '#aebde6'], 0.05);
    const crystalMaterial = basic({ color: '#ffffff', transparent: true, opacity: 0.92 });
    const crystals = along(120, WALL_AT + 1.5, 60, 0.5, 1.8);
    colorize(
      place('crystal', crystals, { material: crystalMaterial }),
      crystals,
      ['#5ff2ff', '#ff4fd8', '#7dffb0', '#a98bff'],
      0.1,
    );
    const peaks = ring(22, 140, 420, 90, 200, [0.9, 1.9]);
    colorize(place('peak', peaks), peaks, ['#c6d4ff', '#aebfee', '#dfe8ff'], 0.05);
    const lampSpots: Placement[] = [];
    const bulbs: number[] = [];
    for (let i = 0; i < track.n; i += 22) {
      const side = (i / 22) % 2 === 0 ? -1 : 1;
      const x = track.px[i] + track.tz[i] * side * (WALL_AT + 0.8);
      const z = track.pz[i] - track.tx[i] * side * (WALL_AT + 0.8);
      const rot = Math.atan2(track.tx[i], track.tz[i]) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
      lampSpots.push({ x, z, scale: 1, rot, tint: 0 });
      bulbs.push(x - Math.cos(rot) * 1.3, 5.25, z + Math.sin(rot) * 1.3);
    }
    place('post', lampSpots);
    const bulbGeometry = keep(new THREE.BufferGeometry());
    bulbGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bulbs, 3));
    const glowTexture = keep(
      canvasTexture(
        64,
        64,
        (ctx) => {
          const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
          gradient.addColorStop(0, 'rgba(255,255,255,1)');
          gradient.addColorStop(0.25, 'rgba(160,240,255,0.7)');
          gradient.addColorStop(1, 'rgba(90,200,255,0)');
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, 64, 64);
        },
        false,
      ),
    );
    add(
      new THREE.Points(
        bulbGeometry,
        keep(
          new THREE.PointsMaterial({
            map: glowTexture,
            size: 5.5,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            fog: false,
          }),
        ),
      ),
    );

    const starPositions: number[] = [];
    for (let i = 0; i < 700; i++) {
      const theta = random() * TAU;
      const phi = Math.acos(random() * 0.95);
      starPositions.push(
        Math.sin(phi) * Math.cos(theta) * 1300,
        Math.cos(phi) * 1300 + 30,
        Math.sin(phi) * Math.sin(theta) * 1300,
      );
    }
    const starGeometry = keep(new THREE.BufferGeometry());
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    const stars = add(
      new THREE.Points(
        starGeometry,
        keep(new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false })),
      ),
    );
    stars.frustumCulled = false;
    animated.push((_time, camera) => stars.position.copy(camera.position));

    const auroraUniforms = { uTime: { value: 0 } };
    const auroraMaterial = keep(
      new THREE.ShaderMaterial({
        uniforms: auroraUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
        vertexShader: `uniform float uTime; varying vec2 vUv; void main() { vUv = uv; vec3 p = position; p.z += sin(p.x * 0.012 + uTime * 0.25) * 60.0; p.y += sin(p.x * 0.02 + uTime * 0.4) * 14.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
        fragmentShader: `uniform float uTime; varying vec2 vUv;
          void main() {
            float bands = 0.55 + 0.45 * sin(vUv.x * 46.0 + uTime * 0.7 + sin(vUv.x * 9.0 - uTime * 0.3) * 3.0);
            float fade = smoothstep(0.0, 0.18, vUv.y) * pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
            vec3 col = mix(vec3(0.15, 1.0, 0.55), vec3(0.65, 0.3, 1.0), vUv.y * 1.1);
            gl_FragColor = vec4(col * bands * fade * 0.75, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    for (let i = 0; i < 3; i++) {
      const curtain = add(new THREE.Mesh(keep(new THREE.PlaneGeometry(1500, 300, 60, 1)), auroraMaterial));
      curtain.position.set(cx + (i - 1) * 260, 330 + i * 40, cz - 620 + i * 420);
      curtain.rotation.y = (i - 1) * 0.5;
      curtain.frustumCulled = false;
    }
    animated.push((time) => {
      auroraUniforms.uTime.value = time;
    });
  }

  if (id === 'meadow' || id === 'dunes') {
    const cloudGeometry = keep(new THREE.IcosahedronGeometry(1, 1));
    const cloudSpots: Placement[] = [];
    for (let i = 0; i < 26; i++) {
      const angle = random() * TAU;
      const radius = 150 + random() * 650;
      const baseScale = 16 + random() * 26;
      const x = cx + Math.cos(angle) * radius;
      const z = cz + Math.sin(angle) * radius;
      const y = 130 + random() * 110;
      for (let puff = 0; puff < 4; puff++)
        cloudSpots.push({
          x: x + (puff - 1.5) * baseScale * 0.8,
          z: z + (random() - 0.5) * baseScale * 0.6,
          y: y + (random() - 0.5) * 6,
          scale: baseScale * (0.7 + random() * 0.5),
          rot: random() * TAU,
          tint: 0,
          sy: 0.5,
        });
    }
    const clouds = add(
      new THREE.InstancedMesh(
        cloudGeometry,
        basic({ color: id === 'dunes' ? '#ffd9b0' : '#ffffff', fog: false, transparent: true, opacity: 0.92 }),
        cloudSpots.length,
      ),
    );
    cloudSpots.forEach((spot, index) => {
      matrix.compose(
        posV.set(spot.x, spot.y ?? 0, spot.z),
        quat.identity(),
        scaleV.set(spot.scale, spot.scale * 0.5, spot.scale * 0.8),
      );
      clouds.setMatrixAt(index, matrix);
    });

    const balloons = add(new THREE.Group());
    const balloonGeometry = keep(new THREE.SphereGeometry(1, 12, 9));
    const basketGeometry = keep(new THREE.BoxGeometry(0.5, 0.4, 0.5));
    const basketMaterial = lambert({ color: '#7a5230' });
    const balloonColors = ['#ff5d6c', '#ffd23f', '#3d9bff', '#b47bff', '#3ddc97'];
    const floats: { group: THREE.Group; base: number; phase: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const group = new THREE.Group();
      const envelope = new THREE.Mesh(balloonGeometry, lambert({ color: balloonColors[i], flatShading: true }));
      envelope.scale.set(9, 11, 9);
      const basket = new THREE.Mesh(basketGeometry, basketMaterial);
      basket.scale.setScalar(5);
      basket.position.y = -14;
      group.add(envelope, basket);
      const angle = random() * TAU;
      const radius = extent * 0.2 + random() * extent * 0.6;
      const base = 60 + random() * 70;
      group.position.set(cx + Math.cos(angle) * radius, base, cz + Math.sin(angle) * radius);
      balloons.add(group);
      floats.push({ group, base, phase: random() * TAU });
    }
    animated.push((time) => {
      for (const entry of floats) entry.group.position.y = entry.base + Math.sin(time * 0.3 + entry.phase) * 5;
    });
  }

  const arrowTexture = keep(
    canvasTexture(
      64,
      64,
      (ctx) => {
        ctx.fillStyle = theme.kerbA;
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = theme.kerbB;
        ctx.beginPath();
        ctx.moveTo(10, 8);
        ctx.lineTo(34, 8);
        ctx.lineTo(56, 32);
        ctx.lineTo(34, 56);
        ctx.lineTo(10, 56);
        ctx.lineTo(32, 32);
        ctx.closePath();
        ctx.fill();
      },
      false,
    ),
  );
  const boards: { x: number; z: number; rot: number; flip: number }[] = [];
  for (let i = 0; i < track.n; i += 5) {
    const k = track.k[i];
    if (Math.abs(k) < 0.016) continue;
    const side = k > 0 ? 1 : -1;
    boards.push({
      x: track.px[i] + track.tz[i] * side * (WALL_AT + 0.25),
      z: track.pz[i] - track.tx[i] * side * (WALL_AT + 0.25),
      rot: Math.atan2(track.tx[i], track.tz[i]) + (side > 0 ? -Math.PI / 2 : Math.PI / 2),
      flip: side,
    });
  }
  if (boards.length > 0) {
    const boardMesh = add(
      new THREE.InstancedMesh(
        keep(new THREE.PlaneGeometry(2.6, 2.6)),
        basic({ map: arrowTexture, side: THREE.DoubleSide, fog: true }),
        boards.length,
      ),
    );
    boards.forEach((board, index) => {
      quat.setFromEuler(euler.set(0, board.rot, 0));
      matrix.compose(posV.set(board.x, 2.6, board.z), quat, scaleV.set(board.flip, 1, 1));
      boardMesh.setMatrixAt(index, matrix);
    });
  }

  const chevron = keep(
    canvasTexture(64, 64, (ctx) => {
      ctx.clearRect(0, 0, 64, 64);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 9;
      ctx.lineJoin = 'miter';
      for (const y of [30, 62]) {
        ctx.beginPath();
        ctx.moveTo(6, y);
        ctx.lineTo(32, y - 24);
        ctx.lineTo(58, y);
        ctx.stroke();
      }
    }),
  );
  chevron.repeat.set(1, 2);
  const padMaterial = basic({
    map: chevron,
    color: theme.accent,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const padBase = basic({ color: theme.accent, transparent: true, opacity: 0.28, depthWrite: false });
  const padGeometry = keep(new THREE.PlaneGeometry(5, 9));
  const pads: PadSpot[] = track.def.pads.map(([at, lat]) => {
    const s = at * track.length;
    track.pose(s, lat, pose);
    for (const material of [padBase, padMaterial]) {
      const mesh = add(new THREE.Mesh(padGeometry, material));
      mesh.rotation.set(-Math.PI / 2, pose.heading + Math.PI, 0, 'YXZ');
      mesh.position.set(pose.x, material === padBase ? 0.1 : 0.13, pose.z);
    }
    return { s, lat, x: pose.x, z: pose.z };
  });
  animated.push((time) => {
    chevron.offset.y = (time * 1.6) % 1;
    padBase.opacity = 0.22 + Math.sin(time * 6) * 0.08;
  });

  const treatGeometry = keep(new THREE.IcosahedronGeometry(0.85, 0));
  const treatMaterial = keep(
    new THREE.MeshStandardMaterial({
      color: '#ffd23f',
      emissive: '#ff9a1f',
      emissiveIntensity: 0.9,
      flatShading: true,
      roughness: 0.3,
      metalness: 0.4,
    }),
  );
  const haloGeometry = keep(new THREE.TorusGeometry(1.35, 0.09, 6, 20));
  const haloMaterial = basic({ color: '#fff3b0', transparent: true, opacity: 0.8, fog: false });
  const treats: TreatSpot[] = track.def.treats.map(([at, lat]) => {
    const s = at * track.length;
    track.pose(s, lat, pose);
    const mesh = add(new THREE.Group());
    mesh.position.set(pose.x, 1.7, pose.z);
    mesh.add(new THREE.Mesh(treatGeometry, treatMaterial), new THREE.Mesh(haloGeometry, haloMaterial));
    return { s, lat, x: pose.x, z: pose.z, mesh, readyAt: 0 };
  });
  animated.push((time) => {
    treats.forEach((treat, index) => {
      treat.mesh.rotation.y = time * 2 + index;
      treat.mesh.children[1].rotation.x = time * 1.5 + index;
      treat.mesh.position.y = 1.7 + Math.sin(time * 3 + index) * 0.25;
    });
  });

  if (id === 'reef' || id === 'aurora') {
    const count = Math.round((id === 'reef' ? 500 : 900) * density);
    const positions = new Float32Array(count * 3);
    const box = id === 'reef' ? [120, 40, 120] : [90, 45, 90];
    for (let i = 0; i < count; i++) positions.set([random() * box[0], random() * box[1], random() * box[2]], i * 3);
    const geometry = keep(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const uniforms = {
      uTime: { value: 0 },
      uCamera: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(box[0], box[1], box[2]) },
      uDrift: { value: id === 'reef' ? new THREE.Vector3(0.4, 2.6, 0.2) : new THREE.Vector3(1.5, -6, 0.8) },
      uSize: { value: id === 'reef' ? 150 : 110 },
      uColor: { value: new THREE.Color(id === 'reef' ? '#d8fbff' : '#ffffff') },
    };
    const drift = add(
      new THREE.Points(
        geometry,
        keep(
          new THREE.ShaderMaterial({
            uniforms,
            transparent: true,
            depthWrite: false,
            vertexShader: `uniform float uTime; uniform vec3 uCamera; uniform vec3 uBox; uniform vec3 uDrift; uniform float uSize; varying float vFade;
              void main() {
                vec3 p = position + uDrift * uTime;
                p.x += sin(uTime * 0.9 + position.y) * 0.6;
                p = mod(p - uCamera + uBox * 0.5, uBox) - uBox * 0.5 + uCamera;
                p.y = mod(position.y + uDrift.y * uTime, uBox.y);
                vec4 mv = viewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_PointSize = uSize * (0.5 + fract(position.x * 7.31) * 0.8) / max(1.0, -mv.z);
                vFade = smoothstep(uBox.x * 0.5, uBox.x * 0.25, length(p.xz - uCamera.xz));
              }`,
            fragmentShader: `uniform vec3 uColor; varying float vFade;
              void main() {
                float d = length(gl_PointCoord - 0.5);
                float a = smoothstep(0.5, 0.2, d) * vFade;
                gl_FragColor = vec4(uColor, a * 0.75);
                #include <colorspace_fragment>
              }`,
          }),
        ),
      ),
    );
    drift.frustumCulled = false;
    animated.push((time, camera) => {
      uniforms.uTime.value = time;
      uniforms.uCamera.value.copy(camera.position);
    });
  }

  return {
    sun,
    pads,
    treats,
    update: (time, camera) => {
      for (const fn of animated) fn(time, camera);
    },
    dispose: () => {
      for (const item of disposables) item.dispose();
    },
  };
}
