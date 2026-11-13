import * as THREE from 'three';
import { surfaceColors } from '../lib/track';
import { sunSprite, type Atmosphere } from '../race/atmosphere';
import { rng } from '../race/geometry';
import { buildLandVenue, type LandVenue } from '../race/terrain';
import { buildWaterVenue, waterTheme } from '../race/water';
import { ROAD_HALF, type Pose, type Track } from './tracks';

export type PadSpot = { s: number; lat: number; x: number; z: number };
export type TreatSpot = { s: number; lat: number; x: number; z: number; mesh: THREE.Group; readyAt: number };

export type World = {
  sun: THREE.DirectionalLight;
  aquatic: boolean;
  pads: PadSpot[];
  treats: TreatSpot[];
  soak: (object: THREE.Object3D) => void;
  setDetail: (detail: number, shadow: number) => void;
  update: (time: number, camera: THREE.Camera, focus: THREE.Vector3) => void;
  dispose: () => void;
};

const pose: Pose = { x: 0, z: 0, heading: 0, tx: 0, tz: 0, nx: 0, nz: 0 };
const TAU = Math.PI * 2;

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function buildWorld(scene: THREE.Scene, track: Track, atmosphere: Atmosphere): World {
  const surface = track.def.surface;
  const path = track.path;
  const look = atmosphere.look;
  const colors = surfaceColors(surface);
  const theme = waterTheme(surface);
  const random = rng(`grand-prix:${track.def.id}`);
  const disposables: { dispose: () => void }[] = [];
  const animated: ((time: number, camera: THREE.Camera) => void)[] = [];
  const keep = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };
  const add = <T extends THREE.Object3D>(object: T): T => {
    scene.add(object);
    return object;
  };

  scene.background = atmosphere.background;
  scene.backgroundIntensity = look.skyGain * atmosphere.gain;
  scene.environment = atmosphere.environment;
  scene.environmentIntensity = look.ambient * atmosphere.gain;
  add(new THREE.HemisphereLight(colors.sky, colors.ground, 0.18));

  const sun = add(new THREE.DirectionalLight(look.sunColor, look.sunIntensity));
  sun.castShadow = true;
  const shadowCam = sun.shadow.camera;
  shadowCam.left = shadowCam.bottom = -36;
  shadowCam.right = shadowCam.top = 36;
  shadowCam.near = 1;
  shadowCam.far = 380;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 2.5;
  add(sun.target);
  const sunOffset = atmosphere.sunDirection.clone().multiplyScalar(170);

  let land: LandVenue | null = null;
  let patch: (<T extends THREE.Material>(material: T, caustics?: number) => T) | null = null;
  if (theme) {
    const water = buildWaterVenue(theme, path, random, colors);
    add(water.group);
    disposables.push(...water.textures);
    patch = water.patchMaterial;
    water.setSun(atmosphere.sunDirection);
    const air = water.fog.air;
    scene.fog = new THREE.Fog(air.color, air.near, air.far);
    animated.push((time, camera) => water.update(time, camera));
  } else {
    scene.fog = new THREE.FogExp2(atmosphere.haze, (0.42 * look.haze) / (path.size * 2.6));
    const venue = buildLandVenue(path, surface, random, `grand-prix:${track.def.id}`);
    land = venue;
    add(venue.group);
    const sunDisc = add(sunSprite(atmosphere));
    if (sunDisc.material.map) disposables.push(sunDisc.material.map);
    animated.push((time, camera) => {
      venue.update(time);
      sunDisc.position.copy(camera.position).addScaledVector(atmosphere.sunDirection, 1500);
    });
  }
  const standard = (params: THREE.MeshStandardMaterialParameters) => {
    const material = keep(new THREE.MeshStandardMaterial(params));
    patch?.(material);
    return material;
  };

  const checker = keep(
    canvasTexture(256, 32, (ctx) => {
      for (let x = 0; x < 32; x++)
        for (let y = 0; y < 4; y++) {
          ctx.fillStyle = (x + y) % 2 ? '#14161a' : '#f4f4f0';
          ctx.fillRect(x * 8, y * 8, 8, 8);
        }
    }),
  );
  checker.magFilter = THREE.NearestFilter;
  track.pose(0, 0, pose);
  const startHeading = pose.heading;
  const finish = add(
    new THREE.Mesh(
      keep(new THREE.PlaneGeometry(ROAD_HALF * 2, 1.6)),
      standard({
        map: checker,
        roughness: 0.85,
        transparent: theme !== null,
        opacity: theme ? 0.85 : 1,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    ),
  );
  finish.rotation.set(-Math.PI / 2, startHeading, 0, 'YXZ');
  finish.position.set(pose.x, 0.075, pose.z);
  finish.receiveShadow = true;

  const gantry = add(new THREE.Group());
  gantry.position.set(pose.x, 0, pose.z);
  gantry.rotation.y = startHeading;
  const steel = standard({ color: '#d9dde0', roughness: 0.35, metalness: 0.85 });
  const span = ROAD_HALF * 2 + 3.4;
  const top = 7.6;
  const postGeometry = keep(new THREE.CylinderGeometry(0.18, 0.22, top + 0.6, 12));
  const footGeometry = keep(new THREE.CylinderGeometry(0.46, 0.54, 0.3, 14));
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeometry, steel);
    post.position.set((side * span) / 2, (top + 0.6) / 2, 0);
    post.castShadow = true;
    const foot = new THREE.Mesh(footGeometry, steel);
    foot.position.set((side * span) / 2, 0.15, 0);
    gantry.add(post, foot);
  }
  const beamGeometry = keep(new THREE.CylinderGeometry(0.07, 0.07, span + 0.6, 8));
  for (const offset of [0.75, -0.75]) {
    const beam = new THREE.Mesh(beamGeometry, steel);
    beam.position.y = top + offset;
    beam.rotation.z = Math.PI / 2;
    beam.castShadow = true;
    gantry.add(beam);
  }
  const banner = keep(
    canvasTexture(2048, 160, (ctx) => {
      const gradient = ctx.createLinearGradient(0, 0, 0, 160);
      gradient.addColorStop(0, '#11161b');
      gradient.addColorStop(1, '#1d262d');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 2048, 160);
      for (let x = 0; x < 8; x++)
        for (let y = 0; y < 8; y++) {
          ctx.fillStyle = (x + y) % 2 ? '#14161a' : '#f4f4f0';
          ctx.fillRect(x * 20, y * 20, 20, 20);
          ctx.fillRect(1888 + x * 20, y * 20, 20, 20);
        }
      ctx.fillStyle = '#f4b740';
      ctx.font = '900 italic 104px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ANIMAL GRAND PRIX', 1024, 84);
    }),
  );
  const face = standard({
    map: banner,
    roughness: 0.6,
    emissive: '#ffffff',
    emissiveMap: banner,
    emissiveIntensity: theme ? 0.5 : 0.12,
  });
  const dark = standard({ color: '#12181c', roughness: 0.6 });
  const board = new THREE.Mesh(keep(new THREE.BoxGeometry(span - 0.4, 1.35, 0.16)), [
    dark,
    dark,
    dark,
    dark,
    face,
    face,
  ]);
  board.position.y = top;
  board.castShadow = true;
  gantry.add(board);

  const arrow = keep(
    canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = '#c8261d';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#f6f3ea';
      ctx.beginPath();
      ctx.moveTo(20, 16);
      ctx.lineTo(66, 16);
      ctx.lineTo(112, 64);
      ctx.lineTo(66, 112);
      ctx.lineTo(20, 112);
      ctx.lineTo(64, 64);
      ctx.closePath();
      ctx.fill();
    }),
  );
  const boards: { x: number; z: number; rot: number; flip: number }[] = [];
  for (let i = 0; i < track.n; i += 6) {
    const k = track.k[i];
    if (Math.abs(k) < 0.02) continue;
    const side = k > 0 ? 1 : -1;
    boards.push({
      x: track.px[i] + track.tz[i] * side * (ROAD_HALF + 1.5),
      z: track.pz[i] - track.tx[i] * side * (ROAD_HALF + 1.5),
      rot: Math.atan2(track.tx[i], track.tz[i]) + (side > 0 ? -Math.PI / 2 : Math.PI / 2),
      flip: side,
    });
  }
  if (boards.length > 0) {
    const boardMesh = add(
      new THREE.InstancedMesh(
        keep(new THREE.BoxGeometry(2.2, 2.2, 0.08)),
        standard({ map: arrow, roughness: 0.55, metalness: 0.1 }),
        boards.length,
      ),
    );
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    boards.forEach((entry, index) => {
      quat.setFromEuler(euler.set(0, entry.rot, 0));
      matrix.compose(position.set(entry.x, 2.3, entry.z), quat, scale.set(entry.flip, 1, 1));
      boardMesh.setMatrixAt(index, matrix);
    });
    boardMesh.castShadow = true;
  }

  const chevron = keep(
    canvasTexture(128, 128, (ctx) => {
      ctx.clearRect(0, 0, 128, 128);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 18;
      ctx.lineJoin = 'miter';
      for (const y of [60, 124]) {
        ctx.beginPath();
        ctx.moveTo(12, y);
        ctx.lineTo(64, y - 48);
        ctx.lineTo(116, y);
        ctx.stroke();
      }
    }),
  );
  chevron.wrapS = chevron.wrapT = THREE.RepeatWrapping;
  chevron.repeat.set(1, 2);
  const accent = new THREE.Color(track.def.card.accent);
  const padGlow = keep(
    new THREE.MeshBasicMaterial({
      map: chevron,
      color: accent.clone().multiplyScalar(2.6),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  const padBase = keep(
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  const padGeometry = keep(new THREE.PlaneGeometry(5, 9));
  const pads: PadSpot[] = track.def.pads.map(([at, lat]) => {
    const s = at * track.length;
    track.pose(s, lat, pose);
    for (const material of [padBase, padGlow]) {
      const mesh = add(new THREE.Mesh(padGeometry, material));
      mesh.rotation.set(-Math.PI / 2, pose.heading + Math.PI, 0, 'YXZ');
      mesh.position.set(pose.x, material === padBase ? 0.09 : 0.11, pose.z);
      mesh.renderOrder = 2;
    }
    return { s, lat, x: pose.x, z: pose.z };
  });
  animated.push((time) => {
    chevron.offset.y = (time * 1.6) % 1;
    padBase.opacity = 0.18 + Math.sin(time * 6) * 0.07;
  });

  const treatGeometry = keep(new THREE.IcosahedronGeometry(0.7, 1));
  const treatMaterial = keep(
    new THREE.MeshStandardMaterial({
      color: '#ffcf3a',
      emissive: '#ff9a1f',
      emissiveIntensity: 2.2,
      roughness: 0.22,
      metalness: 0.9,
    }),
  );
  const haloGeometry = keep(new THREE.TorusGeometry(1.15, 0.05, 8, 40));
  const haloMaterial = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff0a8').multiplyScalar(2.2) }));
  const treats: TreatSpot[] = track.def.treats.map(([at, lat]) => {
    const s = at * track.length;
    track.pose(s, lat, pose);
    const mesh = add(new THREE.Group());
    mesh.position.set(pose.x, 1.6, pose.z);
    const gem = new THREE.Mesh(treatGeometry, treatMaterial);
    gem.castShadow = true;
    mesh.add(gem, new THREE.Mesh(haloGeometry, haloMaterial));
    return { s, lat, x: pose.x, z: pose.z, mesh, readyAt: 0 };
  });
  animated.push((time) => {
    treats.forEach((treat, index) => {
      treat.mesh.rotation.y = time * 2 + index;
      treat.mesh.children[1].rotation.x = time * 1.5 + index;
      treat.mesh.position.y = 1.6 + Math.sin((time * 3 + index) % TAU) * 0.22;
    });
  });

  return {
    sun,
    aquatic: theme !== null,
    pads,
    treats,
    soak: (object) => {
      if (!patch) return;
      const apply = patch;
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const material: THREE.Material | THREE.Material[] = child.material;
        for (const item of Array.isArray(material) ? material : [material])
          if (item instanceof THREE.MeshStandardMaterial) apply(item);
      });
    },
    setDetail: (detail, shadow) => {
      land?.setDetail(detail);
      if (sun.shadow.mapSize.x !== shadow) {
        sun.shadow.mapSize.set(shadow, shadow);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
    },
    update: (time, camera, focus) => {
      sun.target.position.copy(focus);
      sun.position.copy(focus).add(sunOffset);
      for (const fn of animated) fn(time, camera);
    },
    dispose: () => {
      for (const item of disposables) item.dispose();
    },
  };
}
