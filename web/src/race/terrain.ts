import * as THREE from 'three';
import type { TrackPath } from '../lib/track';
import { acacia, broadleaf, bush, cactus, conifer, grassTuft, palm, rock, swayMaterial } from './foliage';
import { fbm2, noise2 } from './kit';
import { addMacroVariation, surfaceMaterial, surfaceTextures } from './textures';

export type LandVenue = {
  group: THREE.Group;
  update: (time: number) => void;
  setDetail: (detail: number) => void;
};

type Theme = {
  ground: string;
  track: string;
  trackTint: string;
  groundTint: string;
  farTint: string;
  rockTint: string;
  peakTint: string;
  rolling: number;
  mountains: number;
  ridged: number;
  terrace: number;
  peakLine: number;
  lake: string | null;
  lakeRoughness: number;
  shoreTint: string;
  tufts: number;
  tuftHeight: number;
  tuftLight: string;
  tuftDark: string;
  stripes: number;
  lineOpacity: number;
};

const THEMES: Record<string, Theme> = {
  GRASS: {
    ground: 'GRASS',
    track: 'TURF',
    trackTint: '#ffffff',
    groundTint: '#f2f4ea',
    farTint: '#b9cfa0',
    rockTint: '#b7a892',
    peakTint: '#c9c4b6',
    rolling: 16,
    mountains: 85,
    ridged: 0.25,
    terrace: 0,
    peakLine: 0.82,
    lake: '#3c6f86',
    lakeRoughness: 0.05,
    shoreTint: '#d8cfa0',
    tufts: 22000,
    tuftHeight: 0.2,
    tuftLight: '#5c9238',
    tuftDark: '#234a1b',
    stripes: 0.085,
    lineOpacity: 0.42,
  },
  SAND: {
    ground: 'SAND',
    track: 'SAND',
    trackTint: '#d2c4ae',
    groundTint: '#ffffff',
    farTint: '#f0d9b0',
    rockTint: '#b06a44',
    peakTint: '#a85a3a',
    rolling: 9,
    mountains: 60,
    ridged: 0.1,
    terrace: 0.8,
    peakLine: 0.5,
    lake: '#2f8fa0',
    lakeRoughness: 0.04,
    shoreTint: '#8fae62',
    tufts: 0,
    tuftHeight: 0.3,
    tuftLight: '#b8b46a',
    tuftDark: '#6f7a3a',
    stripes: 0,
    lineOpacity: 0.5,
  },
  DIRT: {
    ground: 'GRASS',
    track: 'DIRT',
    trackTint: '#ffffff',
    groundTint: '#e9cf9a',
    farTint: '#d9b98a',
    rockTint: '#c98a5c',
    peakTint: '#b86f48',
    rolling: 12,
    mountains: 95,
    ridged: 0.3,
    terrace: 1,
    peakLine: 0.45,
    lake: null,
    lakeRoughness: 0.1,
    shoreTint: '#c9a878',
    tufts: 9000,
    tuftHeight: 0.2,
    tuftLight: '#8f9448',
    tuftDark: '#4a5226',
    stripes: 0,
    lineOpacity: 0.5,
  },
  MUD: {
    ground: 'GRASS',
    track: 'MUD',
    trackTint: '#ffffff',
    groundTint: '#b9cfa2',
    farTint: '#8fb08a',
    rockTint: '#6f7a5c',
    peakTint: '#5f7a5a',
    rolling: 10,
    mountains: 55,
    ridged: 0.15,
    terrace: 0,
    peakLine: 0.9,
    lake: '#4f5a3c',
    lakeRoughness: 0.08,
    shoreTint: '#6a5a40',
    tufts: 14000,
    tuftHeight: 0.36,
    tuftLight: '#6f9a40',
    tuftDark: '#2a4a1c',
    stripes: 0,
    lineOpacity: 0.28,
  },
  ICE: {
    ground: 'SNOW',
    track: 'ICE',
    trackTint: '#ffffff',
    groundTint: '#ffffff',
    farTint: '#eef4fa',
    rockTint: '#6f7480',
    peakTint: '#ffffff',
    rolling: 7,
    mountains: 140,
    ridged: 0.75,
    terrace: 0,
    peakLine: 0.3,
    lake: '#9fc6dc',
    lakeRoughness: 0.12,
    shoreTint: '#e6f0f6',
    tufts: 0,
    tuftHeight: 0.3,
    tuftLight: '#ffffff',
    tuftDark: '#ffffff',
    stripes: 0,
    lineOpacity: 0.6,
  },
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function ribbon(
  track: TrackPath,
  offsets: number[],
  lifts: number[],
  step: number,
  tile: number,
  paint?: (out: THREE.Color, s: number, column: number) => void,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const samples = track.samples(step);
  const columns = offsets.length;
  const p = { x: 0, y: 0, z: 0 };
  const color = new THREE.Color();
  samples.forEach((s, i) => {
    offsets.forEach((offset, c) => {
      track.point(s, offset, p);
      positions.push(p.x, p.y + lifts[c], p.z);
      uvs.push(offset / tile, s / tile);
      color.setRGB(1, 1, 1);
      paint?.(color, s, c);
      colors.push(color.r, color.g, color.b);
    });
    if (i === 0) return;
    for (let c = 0; c < columns - 1; c += 1) {
      const p00 = (i - 1) * columns + c;
      const p01 = p00 + 1;
      const p10 = i * columns + c;
      const p11 = p10 + 1;
      if (track.winding > 0) index.push(p00, p10, p01, p01, p10, p11);
      else index.push(p00, p01, p10, p01, p11, p10);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

type Placement = { x: number; y: number; z: number; scale: number; rot: number };

function scatterInstances(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: Placement[],
  random: () => number,
  jitter: number,
  shadow: boolean,
): THREE.InstancedMesh | null {
  if (!placements.length) {
    geometry.dispose();
    return null;
  }
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  placements.forEach((placement, i) => {
    euler.set((random() - 0.5) * 0.08, placement.rot, (random() - 0.5) * 0.08);
    quaternion.setFromEuler(euler);
    position.set(placement.x, placement.y, placement.z);
    scale.set(placement.scale, placement.scale * (0.9 + random() * 0.25), placement.scale);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
    const v = 1 - jitter + random() * jitter * 2;
    mesh.setColorAt(i, color.setRGB(v * (1 + (random() - 0.5) * jitter), v, v * (1 + (random() - 0.5) * jitter)));
  });
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

export function buildLandVenue(track: TrackPath, surface: string, random: () => number, seedText: string): LandVenue {
  const theme = THEMES[surface] ?? THEMES.GRASS;
  const group = new THREE.Group();
  const time = { value: 0 };
  const size = track.size;
  const cx = track.centerX;
  const cz = track.centerZ;
  let seed = 0;
  for (const char of seedText) seed = (seed * 31 + char.charCodeAt(0)) % 100000;
  const elevated = track.maxY > 0.05;
  const bed = elevated ? -0.5 : -0.12;

  const path = track.samples(2).map((s) => {
    const f = track.frame(s);
    return { x: f.x, y: f.y, z: f.z, nx: f.nx, nz: f.nz };
  });
  const inner = track.innerOffset();
  const outer = track.outerOffset();
  const mid = (inner + outer) / 2;
  const half = (outer - inner) / 2;

  const locate = (x: number, z: number) => {
    let best = Infinity;
    let side = 0;
    let y = 0;
    let weight = 0;
    let weighted = 0;
    let crossings = 0;
    for (let i = 0; i < path.length; i += 1) {
      const a = path[i];
      const dx = x - a.x;
      const dz = z - a.z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        side = dx * a.nx + dz * a.nz;
        y = a.y;
      }
      if (elevated) {
        const w = 1 / (d * d + 1);
        weight += w;
        weighted += w * a.y;
      }
      const b = path[(i + 1) % path.length];
      if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) crossings += 1;
    }
    const distance = Math.sqrt(best);
    const lateral = side;
    return {
      distance,
      edge: Math.max(0, Math.abs(lateral - mid) - half),
      lateral,
      inside: crossings % 2 === 1,
      y: elevated ? weighted / weight : y,
    };
  };

  let lake: { x: number; z: number; rx: number; rz: number; rot: number } | null = null;
  if (theme.lake) {
    let best = { x: 0, z: 0, d: 0 };
    for (let i = 0; i < 60; i += 1) {
      const x = track.minX + (track.maxX - track.minX) * (0.2 + 0.6 * random());
      const z = track.minZ + (track.maxZ - track.minZ) * (0.2 + 0.6 * random());
      const info = locate(x, z);
      if (info.inside && info.distance > best.d) best = { x, z, d: info.distance };
    }
    const radius = Math.min(46, best.d - 26);
    if (radius > 12 && !elevated)
      lake = { x: best.x, z: best.z, rx: radius * 1.35, rz: radius * 0.8, rot: random() * Math.PI };
  }
  const lakeDepth = (x: number, z: number) => {
    if (!lake) return 0;
    const c = Math.cos(lake.rot);
    const s = Math.sin(lake.rot);
    const dx = x - lake.x;
    const dz = z - lake.z;
    const u = (dx * c + dz * s) / lake.rx;
    const v = (-dx * s + dz * c) / lake.rz;
    const wobble = 1 + (noise2(x * 0.08, z * 0.08, seed) - 0.5) * 0.35;
    return Math.sqrt(u * u + v * v) / wobble;
  };

  const hills = (x: number, z: number, away: number) => {
    const rolling = (fbm2(x / 210 + seed, z / 210, 4, seed) - 0.35) * theme.rolling * smooth(30, 170, away);
    const r = Math.hypot(x - cx, z - cz);
    const raw = fbm2(x / 520 + 9, z / 520 + seed, 5, seed + 5);
    const ridge = 1 - Math.abs(fbm2(x / 380 + 31, z / 380, 5, seed + 9) * 2 - 1);
    let m = raw * (1 - theme.ridged) + ridge * ridge * theme.ridged;
    if (theme.terrace) {
      const steps = m * 5;
      const whole = Math.floor(steps);
      m = (whole + smooth(0.55, 0.85, steps - whole) * theme.terrace + (steps - whole) * (1 - theme.terrace)) / 5;
    }
    const ring = smooth(size * 0.95, size * 2.3, r) * smooth(60, 260, away);
    return rolling + m * theme.mountains * ring;
  };

  const heightAt = (x: number, z: number) => {
    const info = locate(x, z);
    const away = info.inside ? 0 : info.edge;
    let h = info.y + bed + hills(x, z, away);
    if (info.inside) h += (fbm2(x / 60, z / 60, 3, seed + 77) - 0.5) * 1.6 * smooth(10, 40, info.edge);
    if (lake) h -= smooth(0.86, 0.5, lakeDepth(x, z)) * 2.2;
    return h;
  };

  const groundTint = new THREE.Color(theme.groundTint);
  const farTint = new THREE.Color(theme.farTint);
  const rockTint = new THREE.Color(theme.rockTint);
  const peakTint = new THREE.Color(theme.peakTint);
  const shoreTint = new THREE.Color(theme.shoreTint);
  const groundKind = surfaceTextures(theme.ground);
  const cells = 230;
  const extent = size * 2.7;
  const ground = new THREE.PlaneGeometry(2, 2, cells, cells);
  ground.rotateX(-Math.PI / 2);
  const gp = ground.getAttribute('position');
  const guv = ground.getAttribute('uv');
  const heights = new Float32Array(gp.count);
  for (let i = 0; i < gp.count; i += 1) {
    const u = gp.getX(i);
    const v = gp.getZ(i);
    const x = cx + Math.sign(u) * Math.abs(u) ** 1.6 * extent;
    const z = cz + Math.sign(v) * Math.abs(v) ** 1.6 * extent;
    const h = heightAt(x, z);
    heights[i] = h;
    gp.setXYZ(i, x, h, z);
    guv.setXY(i, x / groundKind.tile, z / groundKind.tile);
  }
  ground.computeVertexNormals();
  const gn = ground.getAttribute('normal');
  const gcolors = new Float32Array(gp.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < gp.count; i += 1) {
    const x = gp.getX(i);
    const z = gp.getZ(i);
    const h = heights[i];
    const steep = 1 - gn.getY(i);
    const r = Math.hypot(x - cx, z - cz);
    color.copy(groundTint).lerp(farTint, smooth(size * 0.6, size * 2, r));
    const patch = fbm2(x / 45, z / 45, 3, seed + 21);
    color.multiplyScalar(0.86 + patch * 0.3);
    const height01 = h / Math.max(1, theme.mountains);
    color.lerp(rockTint, smooth(0.12, 0.34, steep + (patch - 0.5) * 0.1));
    color.lerp(
      peakTint,
      smooth(theme.peakLine, theme.peakLine + 0.25, height01 + (patch - 0.5) * 0.2) *
        (1 - smooth(0.3, 0.55, steep) * 0.6),
    );
    if (lake) color.lerp(shoreTint, smooth(1.45, 1.1, lakeDepth(x, z)) * 0.6);
    gcolors.set([color.r, color.g, color.b], i * 3);
  }
  ground.setAttribute('color', new THREE.BufferAttribute(gcolors, 3));
  const groundMaterial = surfaceMaterial(theme.ground, { vertexColors: true });
  addMacroVariation(groundMaterial);
  const groundMesh = new THREE.Mesh(ground, groundMaterial);
  groundMesh.receiveShadow = true;
  group.add(groundMesh);

  if (lake) {
    const basin = lake;
    const contour = (level: number, y: number) => {
      const points: THREE.Vector3[] = [];
      const c = Math.cos(basin.rot);
      const s = Math.sin(basin.rot);
      for (let i = 0; i < 72; i += 1) {
        const a = (i / 72) * Math.PI * 2;
        let radius = level;
        for (let k = 0; k < 4; k += 1) {
          const u = Math.cos(a) * radius * basin.rx;
          const v = Math.sin(a) * radius * basin.rz;
          const x = basin.x + u * c - v * s;
          const z = basin.z + u * s + v * c;
          radius = level * (1 + (noise2(x * 0.08, z * 0.08, seed) - 0.5) * 0.35);
        }
        const u = Math.cos(a) * radius * basin.rx;
        const v = Math.sin(a) * radius * basin.rz;
        points.push(new THREE.Vector3(basin.x + u * c - v * s, y, basin.z + u * s + v * c));
      }
      return points;
    };
    const fan = (rings: THREE.Vector3[][], fill: boolean) => {
      const positions: number[] = [];
      const index: number[] = [];
      const n = rings[0].length;
      rings.forEach((ring) => ring.forEach((point) => positions.push(point.x, point.y, point.z)));
      for (let r = 0; r < rings.length - 1; r += 1) {
        for (let i = 0; i < n; i += 1) {
          const a = r * n + i;
          const b = r * n + ((i + 1) % n);
          index.push(a, b, a + n, b, b + n, a + n);
        }
      }
      if (fill) {
        const centre = positions.length / 3;
        positions.push(basin.x, rings[rings.length - 1][0].y, basin.z);
        const base = (rings.length - 1) * n;
        for (let i = 0; i < n; i += 1) index.push(base + i, base + ((i + 1) % n), centre);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(index);
      geometry.computeVertexNormals();
      const normal = geometry.getAttribute('normal');
      if (normal.getY(0) < 0) geometry.setIndex(index.map((_, i) => index[i - (i % 3) + [0, 2, 1][i % 3]]));
      geometry.computeVertexNormals();
      const uv = new Float32Array((positions.length / 3) * 2);
      for (let i = 0; i < positions.length / 3; i += 1) uv.set([positions[i * 3] / 4, positions[i * 3 + 2] / 4], i * 2);
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      return geometry;
    };
    const shore = new THREE.Mesh(
      fan([contour(1.16, bed + 0.02), contour(1.02, bed + 0.05), contour(0.9, bed - 0.14)], false),
      surfaceMaterial(surface === 'ICE' ? 'SNOW' : 'SAND', { color: theme.shoreTint }),
    );
    shore.receiveShadow = true;
    group.add(shore);
    const water = new THREE.Mesh(
      fan([contour(0.97, bed - 0.03)], true),
      new THREE.MeshPhysicalMaterial({
        color: theme.lake ?? '#3c6f86',
        roughness: theme.lakeRoughness,
        metalness: 0,
        envMapIntensity: 1.4,
        normalMap: surfaceTextures('PLAIN').normalMap,
        normalScale: new THREE.Vector2(0.12, 0.12),
      }),
    );
    water.receiveShadow = true;
    group.add(water);
  }

  const vergeMaterial = surfaceMaterial(theme.ground, { vertexColors: true });
  addMacroVariation(vergeMaterial);
  const vergePaint = (out: THREE.Color, s: number, column: number) => {
    out.copy(groundTint).multiplyScalar(0.92 + noise2(s / 9, column * 3.1, seed) * 0.16);
  };
  const drop = elevated ? -1 : -0.4;
  const vergeOut = new THREE.Mesh(
    ribbon(track, [outer, outer + 2, outer + 6, outer + 11], [0.035, 0.03, 0, drop], 2, groundKind.tile, vergePaint),
    vergeMaterial,
  );
  const vergeIn = new THREE.Mesh(
    ribbon(track, [inner - 9, inner - 5, inner - 2, inner], [drop, 0, 0.03, 0.035], 2, groundKind.tile, vergePaint),
    vergeMaterial,
  );
  vergeOut.receiveShadow = true;
  vergeIn.receiveShadow = true;
  group.add(vergeOut, vergeIn);

  const trackKind = surfaceTextures(theme.track);
  const trackTint = new THREE.Color(theme.trackTint);
  const columns = 9;
  const offsets = Array.from({ length: columns }, (_, i) => inner + ((outer - inner) * i) / (columns - 1));
  const trackGeometry = ribbon(
    track,
    offsets,
    offsets.map(() => 0.04),
    1,
    trackKind.tile,
    (out, s, column) => {
      out.copy(trackTint);
      if (theme.stripes) out.multiplyScalar(1 + (Math.floor(s / 9) % 2 ? theme.stripes : -theme.stripes));
      const wear = noise2(s / 14, column * 0.9, seed + 3);
      out.multiplyScalar(0.93 + wear * 0.14 - (column < 3 ? 0.04 : 0));
    },
  );
  const trackMaterial = surfaceMaterial(theme.track, {
    vertexColors: true,
    envMapIntensity: surface === 'ICE' ? 1.2 : surface === 'MUD' ? 0.55 : 1,
  });
  addMacroVariation(trackMaterial, 0.05, 0.5);
  const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
  trackMesh.receiveShadow = true;
  group.add(trackMesh);

  const lineMaterial = new THREE.MeshStandardMaterial({
    color: surface === 'ICE' ? '#2f5f9a' : '#f6f4ec',
    roughness: 0.9,
    transparent: true,
    opacity: theme.lineOpacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  for (let lane = 1; lane < track.lanes; lane += 1) {
    const offset = track.laneOffset(lane) + 0.7;
    const line = new THREE.Mesh(ribbon(track, [offset - 0.045, offset + 0.045], [0.05, 0.05], 1.5, 1), lineMaterial);
    line.receiveShadow = true;
    group.add(line);
  }

  const railMaterial = new THREE.MeshStandardMaterial({ color: '#f4f3ee', roughness: 0.35, metalness: 0 });
  const railSamples = track.samples(2.5).slice(0, -1);
  const p = { x: 0, y: 0, z: 0 };
  const up = new THREE.Vector3(0, 1, 0);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const direction = new THREE.Vector3();
  const position = new THREE.Vector3();
  const unit = new THREE.Vector3(1, 1, 1);
  for (const [lateral, away] of [
    [inner - 0.35, -1],
    [outer + 0.35, 1],
  ]) {
    const points = railSamples.map((s) => {
      track.point(s, lateral, p);
      return new THREE.Vector3(p.x, p.y + 1.02, p.z);
    });
    const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
    const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, points.length * 2, 0.05, 6, true), railMaterial);
    rail.castShadow = true;
    group.add(rail);
    const postSamples = track.samples(3.2).slice(0, -1);
    const posts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.028, 0.034, 1.12, 6),
      railMaterial,
      postSamples.length,
    );
    postSamples.forEach((s, i) => {
      const f = track.frame(s);
      const topX = f.x + f.nx * lateral;
      const topZ = f.z + f.nz * lateral;
      const footX = f.x + f.nx * (lateral + away * 0.42);
      const footZ = f.z + f.nz * (lateral + away * 0.42);
      direction.set(topX - footX, 1.0, topZ - footZ).normalize();
      quaternion.setFromUnitVectors(up, direction);
      position.set((topX + footX) / 2, f.y + 0.5, (topZ + footZ) / 2);
      matrix.compose(position, quaternion, unit);
      posts.setMatrixAt(i, matrix);
    });
    posts.castShadow = true;
    group.add(posts);
  }

  const straights = track.ranges.filter((range) => range.type !== 'CURVE');
  const longest = straights.toSorted((a, b) => b.end - b.start - (a.end - a.start))[0] ?? track.ranges[0];
  let stand: { x: number; z: number; radius: number } | null = null;
  let crowd: { bodies: THREE.InstancedMesh; heads: THREE.InstancedMesh; total: number } | null = null;
  if (longest) {
    const length = Math.min(96, (longest.end - longest.start) * 0.8);
    const frame = track.frame((longest.start + longest.end) / 2);
    const base = outer + 9;
    const tiers = 9;
    const tierDepth = 1.25;
    const tierHeight = 0.62;
    const depth = tiers * tierDepth;
    const standGroup = new THREE.Group();
    standGroup.position.set(frame.x, frame.y + bed, frame.z);
    standGroup.rotation.y = Math.atan2(frame.tx, frame.tz);
    standGroup.scale.x = track.winding;
    const centre = base + depth / 2;
    stand = {
      x: frame.x + frame.nx * centre,
      z: frame.z + frame.nz * centre,
      radius: Math.hypot(length / 2, depth) + 8,
    };

    const profile = new THREE.Shape();
    profile.moveTo(base, 0);
    for (let i = 0; i < tiers; i += 1) {
      profile.lineTo(base + i * tierDepth, (i + 1) * tierHeight + 0.6);
      profile.lineTo(base + (i + 1) * tierDepth, (i + 1) * tierHeight + 0.6);
    }
    const top = tiers * tierHeight + 0.6;
    profile.lineTo(base + depth + 3, top);
    profile.lineTo(base + depth + 3, 0);
    profile.closePath();
    const concrete = surfaceMaterial('PLAIN', { color: '#c9c8c2', roughness: 0.85 });
    const terrace = new THREE.Mesh(
      new THREE.ExtrudeGeometry(profile, { depth: length, bevelEnabled: false, steps: 1 }),
      concrete,
    );
    terrace.position.z = -length / 2;
    terrace.castShadow = true;
    terrace.receiveShadow = true;
    standGroup.add(terrace);

    const seatMaterial = new THREE.MeshStandardMaterial({ color: '#1f5a4c', roughness: 0.6 });
    const seats = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.42, length - 1.2), seatMaterial, tiers);
    for (let i = 0; i < tiers; i += 1) {
      matrix.makeTranslation(base + i * tierDepth + 0.85, (i + 1) * tierHeight + 0.8, 0);
      seats.setMatrixAt(i, matrix);
    }
    seats.receiveShadow = true;
    standGroup.add(seats);

    const steel = new THREE.MeshStandardMaterial({ color: '#cfd3d6', roughness: 0.62, metalness: 0.15 });
    const roofHeight = top + 5.2;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(depth + 7, 0.28, length + 4), steel);
    roof.position.set(base + depth / 2 - 0.5, roofHeight + 0.6, 0);
    roof.rotation.z = 0.11;
    roof.castShadow = true;
    roof.receiveShadow = true;
    standGroup.add(roof);
    const fascia = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.9, length + 4),
      new THREE.MeshStandardMaterial({ color: '#b8402c', roughness: 0.5 }),
    );
    fascia.position.set(base - 3.8, roofHeight + 0.1, 0);
    standGroup.add(fascia);
    const columnCount = Math.max(3, Math.round(length / 14));
    const columnsMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.2, 0.24, roofHeight + 1.2, 10),
      steel,
      columnCount * 2,
    );
    for (let i = 0; i < columnCount; i += 1) {
      const z = -length / 2 + (i / (columnCount - 1)) * length;
      matrix.makeTranslation(base + depth + 2.4, (roofHeight + 1.2) / 2, z);
      columnsMesh.setMatrixAt(i * 2, matrix);
      matrix.makeTranslation(base + depth * 0.55, (roofHeight + 0.6) / 2 + top * 0.25, z);
      columnsMesh.setMatrixAt(i * 2 + 1, matrix);
    }
    columnsMesh.castShadow = true;
    standGroup.add(columnsMesh);
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, roofHeight - top, length),
      new THREE.MeshPhysicalMaterial({ color: '#20323f', roughness: 0.06, metalness: 0.2, envMapIntensity: 1.5 }),
    );
    glass.position.set(base + depth + 2.9, top + (roofHeight - top) / 2, 0);
    standGroup.add(glass);

    const perRow = Math.floor((length - 1.6) / 0.62);
    const total = tiers * perRow;
    const bodyGeometry = new THREE.CapsuleGeometry(0.2, 0.42, 2, 7);
    const headGeometry = new THREE.SphereGeometry(0.135, 8, 6);
    const cheer = (material: THREE.MeshStandardMaterial) => {
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = time;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace(
            '#include <begin_vertex>',
            [
              '#include <begin_vertex>',
              'float fan = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);',
              'float hop = max(0.0, sin(uTime * (3.0 + fan * 4.0) + fan * 40.0)) * step(0.55, fan);',
              'transformed.y += hop * 0.16 + sin(uTime * 1.3 + fan * 30.0) * 0.015;',
              'transformed.x += sin(uTime * 0.9 + fan * 17.0) * 0.02;',
            ].join('\n'),
          );
      };
      material.customProgramCacheKey = () => 'cheer';
      return material;
    };
    const bodies = new THREE.InstancedMesh(
      bodyGeometry,
      cheer(new THREE.MeshStandardMaterial({ roughness: 0.85 })),
      total,
    );
    const heads = new THREE.InstancedMesh(
      headGeometry,
      cheer(new THREE.MeshStandardMaterial({ roughness: 0.7 })),
      total,
    );
    const shirts = [
      '#d6453d',
      '#f1ede2',
      '#3f6ea5',
      '#f2b632',
      '#2f8f7f',
      '#e2764c',
      '#6d4bb5',
      '#1f2a37',
      '#c7d2da',
      '#7fa650',
      '#e38fb1',
      '#32373d',
    ];
    const skins = ['#e9c4a1', '#c98f66', '#8d5b3c', '#f3d6bd', '#a87048', '#5f3d28'];
    let count = 0;
    for (let i = 0; i < tiers; i += 1) {
      for (let k = 0; k < perRow; k += 1) {
        if (random() < 0.17) continue;
        const x = base + i * tierDepth + 0.8 + (random() - 0.5) * 0.12;
        const y = (i + 1) * tierHeight + 1.32 + (random() < 0.3 ? 0.3 : 0);
        const z = -length / 2 + 0.8 + k * 0.62 + (random() - 0.5) * 0.1;
        const tall = 0.92 + random() * 0.2;
        matrix.makeScale(tall, tall, tall);
        matrix.setPosition(x, y, z);
        bodies.setMatrixAt(count, matrix);
        bodies.setColorAt(count, color.set(shirts[Math.floor(random() * shirts.length)]));
        matrix.setPosition(x - 0.02, y + 0.5 * tall, z);
        heads.setMatrixAt(count, matrix);
        heads.setColorAt(count, color.set(skins[Math.floor(random() * skins.length)]));
        count += 1;
      }
    }
    bodies.count = count;
    heads.count = count;
    crowd = { bodies, heads, total: count };
    bodies.castShadow = true;
    bodies.frustumCulled = false;
    heads.frustumCulled = false;
    standGroup.add(bodies, heads);

    const flagColors = ['#d6453d', '#f2b632', '#3f6ea5', '#f1ede2', '#2f8f7f'];
    const flagGeometry = new THREE.PlaneGeometry(2.4, 1.3, 10, 4);
    flagGeometry.translate(1.2, 0, 0);
    const poleGeometry = new THREE.CylinderGeometry(0.05, 0.06, 5, 6);
    const flagCount = Math.max(3, Math.round(length / 16));
    for (let i = 0; i < flagCount; i += 1) {
      const z = -length / 2 + (i / (flagCount - 1)) * length;
      const pole = new THREE.Mesh(poleGeometry, steel);
      pole.position.set(base + depth + 2, roofHeight + 3.4, z);
      standGroup.add(pole);
      const flagMaterial = new THREE.MeshStandardMaterial({
        color: flagColors[i % flagColors.length],
        roughness: 0.8,
        side: THREE.DoubleSide,
      });
      flagMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = time;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>\nfloat flap = position.x / 2.4;\ntransformed.z += sin(position.x * 3.2 - uTime * 6.0 + ${i.toFixed(1)}) * 0.22 * flap;\ntransformed.y += sin(position.x * 2.1 - uTime * 4.0) * 0.07 * flap - flap * flap * 0.25;`,
          );
      };
      flagMaterial.customProgramCacheKey = () => `flag:${i}`;
      const flag = new THREE.Mesh(flagGeometry, flagMaterial);
      flag.position.set(base + depth + 2, roofHeight + 5.1, z);
      flag.rotation.y = -0.9;
      standGroup.add(flag);
    }
    group.add(standGroup);

    const boardFrame = track.frame((longest.start + longest.end) / 2);
    const boards = Math.floor(length / 6);
    const boardColors = ['#12355b', '#b8402c', '#f2b632', '#1f5a4c', '#f1ede2'];
    const boardMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(5.6, 0.9, 0.12),
      new THREE.MeshStandardMaterial({ roughness: 0.5 }),
      boards,
    );
    for (let i = 0; i < boards; i += 1) {
      const s = (longest.start + longest.end) / 2 - length / 2 + (i + 0.5) * (length / boards);
      const f = track.frame(s);
      const lateral = outer + 4.4;
      matrix.makeRotationY(Math.atan2(f.tx, f.tz) + Math.PI / 2);
      matrix.setPosition(f.x + f.nx * lateral, f.y + 0.55, f.z + f.nz * lateral);
      boardMesh.setMatrixAt(i, matrix);
      boardMesh.setColorAt(i, color.set(boardColors[i % boardColors.length]));
    }
    boardMesh.castShadow = true;
    boardMesh.receiveShadow = true;
    if (boardFrame) group.add(boardMesh);
  }

  const thinned: { mesh: THREE.InstancedMesh; total: number; floor: number }[] = [];
  const placements: Placement[][] = [[], [], [], []];
  const target = Math.round(Math.min(700, Math.max(280, size * 2)));
  let guard = 0;
  let placed = 0;
  while (placed < target && guard < target * 40) {
    guard += 1;
    const x = cx + (random() - 0.5) * size * 3.2;
    const z = cz + (random() - 0.5) * size * 3.2;
    const info = locate(x, z);
    const clearance = info.inside ? 14 : 16;
    if (info.edge < clearance) continue;
    if (stand && Math.hypot(x - stand.x, z - stand.z) < stand.radius) continue;
    if (lake && lakeDepth(x, z) < 1.3) continue;
    const grove = fbm2(x / 90 + seed, z / 90, 3, seed + 55);
    if (random() > smooth(0.35, 0.62, grove) + (info.inside ? 0.04 : 0.1)) continue;
    const h = heightAt(x, z);
    if (h > theme.mountains * 0.55) continue;
    const kind = random() < 0.16 ? 3 : random() < 0.14 ? 2 : grove > 0.55 ? 0 : 1;
    placements[kind].push({ x, y: h - 0.05, z, scale: 0.85 + random() * 0.8, rot: random() * Math.PI * 2 });
    placed += 1;
  }

  const foliageMaterial = (amount: number, from: number) =>
    swayMaterial(
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
      time,
      amount,
      from,
      'tree',
    );
  const solidMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const treeSeed = seed % 50;
  let kinds: [THREE.BufferGeometry, THREE.Material, boolean, number][];
  switch (surface) {
    case 'SAND':
      kinds = [
        [palm(treeSeed + 1), foliageMaterial(0.02, 2), true, 1],
        [acacia(treeSeed + 2), foliageMaterial(0.012, 2.5), true, 1],
        [cactus(treeSeed + 3), solidMaterial, true, 0.9],
        [rock(treeSeed + 4, '#c9a27a'), solidMaterial, true, 1.6],
      ];
      break;
    case 'ICE':
      kinds = [
        [conifer(treeSeed + 1, '#3f6a4c', '#1c3a2c', 0.85), foliageMaterial(0.008, 2), true, 1],
        [conifer(treeSeed + 2, '#4a7556', '#20402f', 0.6), foliageMaterial(0.008, 2), true, 0.8],
        [rock(treeSeed + 3, '#dfe8ef'), solidMaterial, true, 1.8],
        [rock(treeSeed + 4, '#8d94a0'), solidMaterial, true, 1.4],
      ];
      break;
    case 'DIRT':
      kinds = [
        [acacia(treeSeed + 1), foliageMaterial(0.012, 2.5), true, 1.1],
        [conifer(treeSeed + 2, '#5f7a3c', '#33482a', 0), foliageMaterial(0.008, 2), true, 0.85],
        [bush(treeSeed + 3, '#9a9a4c', '#55602c'), foliageMaterial(0.01, 0.3), true, 1],
        [rock(treeSeed + 4, '#b98a62'), solidMaterial, true, 1.9],
      ];
      break;
    case 'MUD':
      kinds = [
        [broadleaf(treeSeed + 1, '#4f8a35', '#1d3f1a'), foliageMaterial(0.014, 2), true, 1.25],
        [palm(treeSeed + 2), foliageMaterial(0.02, 2), true, 1],
        [bush(treeSeed + 3, '#5f9a3a', '#234a1c'), foliageMaterial(0.012, 0.3), true, 1.3],
        [rock(treeSeed + 4, '#6f7566'), solidMaterial, true, 1.5],
      ];
      break;
    default:
      kinds = [
        [broadleaf(treeSeed + 1, '#5a8f36', '#1b3a17'), foliageMaterial(0.014, 2), true, 1.1],
        [conifer(treeSeed + 2, '#3f6f35', '#16301b', 0), foliageMaterial(0.008, 2), true, 0.9],
        [bush(treeSeed + 3, '#5f9038', '#234a1c'), foliageMaterial(0.012, 0.3), true, 1],
        [rock(treeSeed + 4, '#9c9a92'), solidMaterial, true, 1.3],
      ];
  }
  kinds.forEach(([geometry, material, shadow, scale], i) => {
    for (const placement of placements[i]) placement.scale *= scale;
    const mesh = scatterInstances(group, geometry, material, placements[i], random, 0.14, shadow);
    if (mesh) thinned.push({ mesh, total: mesh.count, floor: 0.3 });
  });

  let tufts: THREE.InstancedMesh | null = null;
  if (theme.tufts > 0) {
    const tuftMaterial = swayMaterial(
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
      time,
      0.09,
      0,
      'grass',
    );
    tufts = new THREE.InstancedMesh(
      grassTuft(theme.tuftHeight, theme.tuftLight, theme.tuftDark),
      tuftMaterial,
      theme.tufts,
    );
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    for (let i = 0; i < theme.tufts; i += 1) {
      const s = random() * track.lapLength;
      const outside = random() < 0.56;
      const depth = random() ** 1.6;
      const lateral = outside ? outer + 0.55 + depth * 9.5 : inner - 0.55 - depth * 8;
      track.point(s, lateral, p);
      const fall = smooth(0.55, 1, depth) * (drop + 0.05);
      euler.set(0, random() * Math.PI * 2, 0);
      quaternion.setFromEuler(euler);
      const k = 0.7 + random() * 0.9;
      scale.set(k, k * (0.7 + random() * 0.7), k);
      position.set(p.x, p.y + 0.02 + fall, p.z);
      matrix.compose(position, quaternion, scale);
      tufts.setMatrixAt(i, matrix);
      const v = 0.8 + random() * 0.4;
      tufts.setColorAt(i, color.setRGB(v, v * (0.95 + random() * 0.1), v * 0.9));
    }
    tufts.receiveShadow = true;
    tufts.frustumCulled = false;
    group.add(tufts);
  }

  return {
    group,
    update: (now) => {
      time.value = now;
    },
    setDetail: (detail) => {
      const d = Math.max(0, Math.min(1, detail));
      const sparse = detail < 0 ? 0.4 : 1;
      for (const item of thinned) {
        item.mesh.count = Math.round(item.total * (item.floor + (1 - item.floor) * d) * sparse);
      }
      if (crowd) {
        const people = Math.round(crowd.total * (0.35 + 0.65 * d) * sparse);
        crowd.bodies.count = people;
        crowd.heads.count = people;
      }
      if (tufts) tufts.count = Math.round(theme.tufts * d);
    },
  };
}
