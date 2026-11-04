import * as THREE from 'three';
import type { TrackPath } from '../lib/track';
import { stripGeometry } from './geometry';

export type WaterTheme = 'POOL' | 'AQUARIUM' | 'OPEN_SEA';

const THEMES: readonly WaterTheme[] = ['POOL', 'AQUARIUM', 'OPEN_SEA'];

export function waterTheme(surface: string): WaterTheme | null {
  return THEMES.find((theme) => theme === surface) ?? null;
}

export type WaterVenue = {
  group: THREE.Group;
  textures: THREE.Texture[];
  level: number;
  animate: (time: number) => void;
};

type Colors = { track: string; ground: string; infield: string; accent: string; sky: string; fog: string };

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

type Placement = { x: number; y: number; z: number; scale: number; rot: number };

type Part = {
  geometry: THREE.BufferGeometry;
  color: string;
  y: number;
  sx?: number;
  sy?: number;
  sz?: number;
  tilt?: number;
};

type School = { fish: number; colors: string[]; minY: number; maxY: number; size: number };

const POOL_DEPTH = 8.5;
const TANK_HEIGHT = 13;

function canvasTexture(px: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function tileTexture(base: string, grout: string): THREE.CanvasTexture {
  return canvasTexture(64, (ctx) => {
    ctx.fillStyle = grout;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = base;
    for (let x = 0; x < 4; x += 1) for (let y = 0; y < 4; y += 1) ctx.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
  });
}

function causticTexture(random: () => number): THREE.CanvasTexture {
  const px = 256;
  return canvasTexture(px, (ctx) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < 34; i += 1) {
      const x = random() * px;
      const y = random() * px;
      const c = Array.from({ length: 6 }, () => (random() - 0.5) * 90);
      for (const dx of [-px, 0, px]) {
        for (const dy of [-px, 0, px]) {
          ctx.beginPath();
          ctx.moveTo(x + dx, y + dy);
          ctx.bezierCurveTo(x + dx + c[0], y + dy + c[1], x + dx + c[2], y + dy + c[3], x + dx + c[4], y + dy + c[5]);
          ctx.stroke();
        }
      }
    }
  });
}

function gravelTexture(random: () => number): THREE.CanvasTexture {
  const palette = ['#e2d3b0', '#b49a6c', '#8c8577', '#d9c9a3', '#a88f63', '#efe6cf', '#7d7466'];
  return canvasTexture(128, (ctx) => {
    ctx.fillStyle = '#c6b088';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 700; i += 1) {
      ctx.fillStyle = palette[Math.floor(random() * palette.length)];
      ctx.beginPath();
      ctx.arc(random() * 128, random() * 128, 1.2 + random() * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

class WaterBuilder {
  readonly group = new THREE.Group();
  readonly textures: THREE.Texture[] = [];
  readonly animators: ((time: number) => void)[] = [];
  level = 0;
  readonly track: TrackPath;
  readonly random: () => number;
  readonly colors: Colors;
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();

  constructor(track: TrackPath, random: () => number, colors: Colors) {
    this.track = track;
    this.random = random;
    this.colors = colors;
  }

  add<T extends THREE.Object3D>(object: T): T {
    this.group.add(object);
    return object;
  }

  texture<T extends THREE.Texture>(texture: T): T {
    this.textures.push(texture);
    return texture;
  }

  rect(margin: number): Rect {
    const track = this.track;
    return {
      minX: track.minX - margin,
      maxX: track.maxX + margin,
      minZ: track.minZ - margin,
      maxZ: track.maxZ + margin,
    };
  }

  box(w: number, h: number, d: number, color: string, x: number, y: number, z: number, rotY = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true }),
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return this.add(mesh);
  }

  plane(rect: Rect, y: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(rect.maxX - rect.minX, rect.maxZ - rect.minZ), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((rect.minX + rect.maxX) / 2, y, (rect.minZ + rect.maxZ) / 2);
    mesh.receiveShadow = true;
    return this.add(mesh);
  }

  caustics(rect: Rect, y: number, opacity: number): void {
    const width = rect.maxX - rect.minX;
    const depth = rect.maxZ - rect.minZ;
    const layers = [0.012, -0.009].map((speed, i) => {
      const texture = this.texture(causticTexture(this.random));
      texture.repeat.set(width / (14 + i * 5), depth / (14 + i * 5));
      this.plane(
        rect,
        y + i * 0.01,
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      return { texture, speed };
    });
    this.animators.push((time) => {
      for (const { texture, speed } of layers) texture.offset.set(time * speed, time * speed * 0.7);
    });
  }

  waterSurface(rect: Rect, y: number, color: string, opacity: number, amplitude: number): void {
    this.level = y;
    const width = rect.maxX - rect.minX;
    const depth = rect.maxZ - rect.minZ;
    const segments = Math.min(64, Math.max(12, Math.round(Math.max(width, depth) / 6)));
    const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate((rect.minX + rect.maxX) / 2, y, (rect.minZ + rect.maxZ) / 2);
    const positions = geometry.getAttribute('position');
    const base = Float32Array.from({ length: positions.count * 2 }, (_, i) =>
      i % 2 ? positions.getZ(i >> 1) : positions.getX(i >> 1),
    );
    const sparkle = this.texture(causticTexture(this.random));
    sparkle.repeat.set(width / 18, depth / 18);
    this.add(
      new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color,
          transparent: true,
          opacity,
          roughness: 0.15,
          metalness: 0.1,
          flatShading: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    );
    this.add(
      new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          map: sparkle,
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    );
    this.animators.push((time) => {
      for (let i = 0; i < positions.count; i += 1) {
        const x = base[i * 2];
        const z = base[i * 2 + 1];
        positions.setY(
          i,
          y + (Math.sin(x * 0.07 + time * 0.9) * 0.6 + Math.cos(z * 0.08 + time * 0.7) * 0.4) * amplitude,
        );
      }
      positions.needsUpdate = true;
      sparkle.offset.set(time * 0.006, -time * 0.004);
    });
  }

  particles(rect: Rect, top: number, count: number): void {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = rect.minX + this.random() * (rect.maxX - rect.minX);
      positions[i * 3 + 1] = 0.3 + this.random() * (top - 0.6);
      positions[i * 3 + 2] = rect.minZ + this.random() * (rect.maxZ - rect.minZ);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: '#e8fbff', size: 0.14, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.add(points);
    this.animators.push((time) => {
      points.position.set(Math.sin(time * 0.15) * 1.2, Math.sin(time * 0.3) * 0.4, Math.cos(time * 0.12) * 1.2);
    });
  }

  courseRibbon(opacity: number): void {
    const track = this.track;
    this.add(
      new THREE.Mesh(
        stripGeometry(track, track.innerOffset(), track.outerOffset(), 0.04, 0.04, 1),
        new THREE.MeshStandardMaterial({
          color: this.colors.track,
          transparent: true,
          opacity,
          roughness: 0.4,
          depthWrite: false,
        }),
      ),
    );
    const lineMat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: opacity * 0.9,
      depthWrite: false,
    });
    for (let lane = 1; lane < track.lanes; lane += 1) {
      const offset = track.laneOffset(lane) + 0.7;
      this.add(new THREE.Mesh(stripGeometry(track, offset - 0.04, offset + 0.04, 0.06, 0.06, 1), lineMat));
    }
  }

  floatLine(
    lateral: number,
    spacing: number,
    radius: number,
    height: number,
    palette: string[],
    run: number,
    stretch: number,
    emissive?: string,
  ): number[] {
    const track = this.track;
    const samples = track.samples(spacing);
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(radius, 10, 8),
      new THREE.MeshStandardMaterial({
        roughness: 0.45,
        emissive: emissive ?? '#000000',
        emissiveIntensity: emissive ? 0.7 : 0,
      }),
      samples.length,
    );
    const p = { x: 0, y: 0, z: 0 };
    samples.forEach((s, i) => {
      const f = track.frame(s);
      track.point(s, lateral, p);
      this.euler.set(0, Math.atan2(f.tx, f.tz), 0);
      this.quaternion.setFromEuler(this.euler);
      this.position.set(p.x, p.y + height, p.z);
      this.scale.set(1, 1, stretch);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      mesh.setMatrixAt(i, this.matrix);
      mesh.setColorAt(i, this.color.set(palette[Math.floor(i / run) % palette.length]));
    });
    mesh.castShadow = true;
    this.add(mesh);
    return samples;
  }

  scatter(count: number, area: Rect, outerClearance: number, innerClearance: number): Placement[] {
    const track = this.track;
    const reference = track.samples(3).map((s) => track.frame(s));
    const placements: Placement[] = [];
    let guard = 0;
    while (placements.length < count && guard < count * 40) {
      guard += 1;
      const x = area.minX + this.random() * (area.maxX - area.minX);
      const z = area.minZ + this.random() * (area.maxZ - area.minZ);
      let best = Infinity;
      let side = 0;
      for (const f of reference) {
        const dx = x - f.x;
        const dz = z - f.z;
        const dist = dx * dx + dz * dz;
        if (dist < best) {
          best = dist;
          side = dx * f.nx + dz * f.nz;
        }
      }
      const clearance = side > 0 ? track.outerOffset() + outerClearance : -track.innerOffset() + innerClearance;
      if (Math.sqrt(best) < clearance) continue;
      placements.push({ x, y: 0, z, scale: 0.7 + this.random() * 0.8, rot: this.random() * Math.PI * 2 });
    }
    return placements;
  }

  instances(kinds: Part[][], placements: Placement[]): void {
    const assigned: Placement[][] = kinds.map(() => []);
    placements.forEach((placement, i) => assigned[i % kinds.length].push(placement));
    kinds.forEach((parts, kindIndex) => {
      const list = assigned[kindIndex];
      if (!list.length) return;
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(
          part.geometry,
          new THREE.MeshStandardMaterial({ color: part.color, flatShading: true, roughness: 0.9 }),
          list.length,
        );
        list.forEach((placement, i) => {
          this.euler.set(part.tilt ?? 0, placement.rot, 0);
          this.quaternion.setFromEuler(this.euler);
          this.position.set(placement.x, placement.y + part.y * placement.scale, placement.z);
          this.scale.set(
            (part.sx ?? 1) * placement.scale,
            (part.sy ?? 1) * placement.scale,
            (part.sz ?? 1) * placement.scale,
          );
          this.matrix.compose(this.position, this.quaternion, this.scale);
          mesh.setMatrixAt(i, this.matrix);
        });
        mesh.castShadow = part.y > 1;
        mesh.receiveShadow = true;
        this.add(mesh);
      }
    });
  }

  bubbles(sources: Placement[], top: number): void {
    const perColumn = 16;
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshStandardMaterial({ color: '#e8fbff', transparent: true, opacity: 0.6, roughness: 0.1 }),
      sources.length * perColumn,
    );
    const phases = sources.map(() => this.random() * top);
    this.add(mesh);
    this.animators.push((time) => {
      sources.forEach((source, c) => {
        for (let k = 0; k < perColumn; k += 1) {
          const y = (time * 1.8 + phases[c] + (k * top) / perColumn) % top;
          const size = 0.6 + (y / top) * 0.9;
          this.matrix.makeScale(size, size, size);
          this.matrix.setPosition(
            source.x + Math.sin(time * 3 + k * 1.7) * 0.25,
            y,
            source.z + Math.cos(time * 2.4 + k * 1.3) * 0.25,
          );
          mesh.setMatrixAt(c * perColumn + k, this.matrix);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  schools(centres: Placement[], spec: School): void {
    const geometry = new THREE.ConeGeometry(0.22 * spec.size, 0.9 * spec.size, 5);
    geometry.rotateX(Math.PI / 2);
    const total = centres.length * spec.fish;
    const mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2, flatShading: true }),
      total,
    );
    const fish = centres.flatMap((centre, c) => {
      const radius = 5 + this.random() * 9;
      const y = spec.minY + this.random() * (spec.maxY - spec.minY);
      const speed = (0.18 + this.random() * 0.2) * (c % 2 ? 1 : -1);
      const color = spec.colors[c % spec.colors.length];
      return Array.from({ length: spec.fish }, () => ({
        centre,
        radius: radius + (this.random() - 0.5) * 2.5,
        y: y + (this.random() - 0.5) * 2,
        speed,
        offset: this.random() * 0.9,
        bob: this.random() * Math.PI * 2,
        color,
      }));
    });
    fish.forEach((f, i) => mesh.setColorAt(i, this.color.set(f.color)));
    this.add(mesh);
    this.animators.push((time) => {
      fish.forEach((f, i) => {
        const angle = time * f.speed + f.offset;
        const direction = Math.sign(f.speed);
        this.euler.set(0, Math.atan2(-Math.sin(angle) * direction, Math.cos(angle) * direction), 0);
        this.quaternion.setFromEuler(this.euler);
        this.position.set(
          f.centre.x + Math.cos(angle) * f.radius,
          f.y + Math.sin(time * 1.3 + f.bob) * 0.3,
          f.centre.z + Math.sin(angle) * f.radius,
        );
        this.scale.set(1, 1, 1);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        mesh.setMatrixAt(i, this.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  finish(): WaterVenue {
    const animators = this.animators;
    return {
      group: this.group,
      textures: this.textures,
      level: this.level,
      animate: (time) => {
        for (const animate of animators) animate(time);
      },
    };
  }
}

function buildPool(b: WaterBuilder): void {
  const rect = b.rect(3);
  const width = rect.maxX - rect.minX;
  const depth = rect.maxZ - rect.minZ;
  const cx = (rect.minX + rect.maxX) / 2;
  const cz = (rect.minZ + rect.maxZ) / 2;
  const track = b.track;

  const floorTiles = b.texture(tileTexture('#eef8fb', '#b6d9e4'));
  floorTiles.repeat.set(width / 2, depth / 2);
  b.plane(rect, 0, new THREE.MeshStandardMaterial({ map: floorTiles, roughness: 0.6 }));
  b.caustics(rect, 0.02, 0.32);

  const stripeMat = new THREE.MeshBasicMaterial({ color: '#1d3f8a' });
  for (let lane = 1; lane <= track.lanes; lane += 1) {
    const offset = track.laneOffset(lane);
    b.add(new THREE.Mesh(stripGeometry(track, offset - 0.14, offset + 0.14, 0.05, 0.05, 1), stripeMat));
  }
  b.floatLine(track.innerOffset() - 0.3, 0.32, 0.17, 0.75, ['#d62828', '#f4f4f0', '#1d4ed8', '#f4f4f0'], 5, 1.6);
  b.floatLine(track.outerOffset() + 0.3, 0.32, 0.17, 0.75, ['#d62828', '#f4f4f0', '#1d4ed8', '#f4f4f0'], 5, 1.6);

  const wallTiles = b.texture(tileTexture('#e3f3f8', '#a9d1de'));
  wallTiles.repeat.set(width / 2, POOL_DEPTH / 2);
  const sideTiles = b.texture(tileTexture('#e3f3f8', '#a9d1de'));
  sideTiles.repeat.set(depth / 2, POOL_DEPTH / 2);
  const walls: [number, number, number, number, THREE.Texture][] = [
    [width, cx, rect.minZ, 0, wallTiles],
    [width, cx, rect.maxZ, 0, wallTiles],
    [depth, rect.minX, cz, Math.PI / 2, sideTiles],
    [depth, rect.maxX, cz, Math.PI / 2, sideTiles],
  ];
  for (const [length, x, z, rotY, map] of walls) {
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(length, POOL_DEPTH),
      new THREE.MeshStandardMaterial({ map, roughness: 0.5, side: THREE.DoubleSide }),
    );
    wall.position.set(x, POOL_DEPTH / 2, z);
    wall.rotation.y = rotY;
    wall.receiveShadow = true;
    b.add(wall);
    const band = b.box(length, 0.5, 0.06, '#1f5f9e', x, POOL_DEPTH - 1.1, z, rotY);
    band.castShadow = false;
  }

  const deck = 14;
  const coping = '#f2efe6';
  const stone = '#ddd5c4';
  b.box(width + deck * 2, 0.6, deck, stone, cx, POOL_DEPTH - 0.3, rect.minZ - deck / 2);
  b.box(width + deck * 2, 0.6, deck, stone, cx, POOL_DEPTH - 0.3, rect.maxZ + deck / 2);
  b.box(deck, 0.6, depth, stone, rect.minX - deck / 2, POOL_DEPTH - 0.3, cz);
  b.box(deck, 0.6, depth, stone, rect.maxX + deck / 2, POOL_DEPTH - 0.3, cz);
  b.box(width + 1.2, 0.25, 0.6, coping, cx, POOL_DEPTH + 0.1, rect.minZ - 0.3);
  b.box(width + 1.2, 0.25, 0.6, coping, cx, POOL_DEPTH + 0.1, rect.maxZ + 0.3);
  b.box(0.6, 0.25, depth, coping, rect.minX - 0.3, POOL_DEPTH + 0.1, cz);
  b.box(0.6, 0.25, depth, coping, rect.maxX + 0.3, POOL_DEPTH + 0.1, cz);

  const far = Math.max(width, depth) * 4;
  const lawn = new THREE.MeshStandardMaterial({ color: '#7fb069', roughness: 1 });
  const inner = { minX: rect.minX - deck, maxX: rect.maxX + deck, minZ: rect.minZ - deck, maxZ: rect.maxZ + deck };
  for (const area of [
    { minX: cx - far, maxX: cx + far, minZ: inner.maxZ, maxZ: cz + far },
    { minX: cx - far, maxX: cx + far, minZ: cz - far, maxZ: inner.minZ },
    { minX: cx - far, maxX: inner.minX, minZ: inner.minZ, maxZ: inner.maxZ },
    { minX: inner.maxX, maxX: cx + far, minZ: inner.minZ, maxZ: inner.maxZ },
  ]) {
    b.plane(area, POOL_DEPTH - 0.03, lawn);
  }

  b.waterSurface(rect, POOL_DEPTH - 0.5, '#3fb8e0', 0.5, 0.15);
  b.particles(rect, POOL_DEPTH - 0.5, Math.round(Math.min(5000, width * depth * 0.12)));

  const umbrellaColors = ['#e63946', '#ffb703', '#2a9d8f', '#f1faee', '#457b9d'];
  for (const z of [rect.minZ - deck * 0.55, rect.maxZ + deck * 0.55]) {
    for (let x = rect.minX + 6; x < rect.maxX - 4; x += 7) {
      const lounger = b.box(0.8, 0.35, 2, '#ffffff', x, POOL_DEPTH + 0.2, z);
      lounger.castShadow = true;
      if (Math.round(x) % 2 === 0) {
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6),
          new THREE.MeshStandardMaterial({ color: '#ececec' }),
        );
        pole.position.set(x + 1.2, POOL_DEPTH + 1.3, z);
        b.add(pole);
        const canopy = new THREE.Mesh(
          new THREE.ConeGeometry(1.6, 0.7, 8),
          new THREE.MeshStandardMaterial({
            color: umbrellaColors[Math.floor(b.random() * umbrellaColors.length)],
            flatShading: true,
          }),
        );
        canopy.position.set(x + 1.2, POOL_DEPTH + 2.6, z);
        canopy.castShadow = true;
        b.add(canopy);
      }
    }
  }

  const chairX = cx;
  const chairZ = rect.minZ - 2;
  const metal = '#f4f4f0';
  for (const [dx, dz] of [
    [-0.5, -0.5],
    [0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5],
  ]) {
    const leg = b.box(0.12, 2.6, 0.12, metal, chairX + dx, POOL_DEPTH + 1.3, chairZ + dz);
    leg.castShadow = true;
  }
  b.box(1.3, 0.2, 1.3, '#d62828', chairX, POOL_DEPTH + 2.6, chairZ);
  b.box(1.3, 1.1, 0.15, '#d62828', chairX, POOL_DEPTH + 3.2, chairZ - 0.6);

  const flagColors = ['#d62828', '#f4f4f0', '#1d4ed8'];
  const flagGeometry = new THREE.ConeGeometry(0.24, 0.5, 3);
  flagGeometry.rotateX(Math.PI);
  const flagLines = width >= depth ? [rect.minX + 5, rect.maxX - 5] : [rect.minZ + 5, rect.maxZ - 5];
  for (const at of flagLines) {
    const span = width >= depth ? depth : width;
    const count = Math.floor(span / 0.7);
    const flags = new THREE.InstancedMesh(flagGeometry, new THREE.MeshStandardMaterial({ flatShading: true }), count);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < count; i += 1) {
      const along = (width >= depth ? rect.minZ : rect.minX) + (i + 0.5) * 0.7;
      matrix.makeTranslation(width >= depth ? at : along, POOL_DEPTH + 1.9, width >= depth ? along : at);
      flags.setMatrixAt(i, matrix);
      flags.setColorAt(i, color.set(flagColors[i % flagColors.length]));
    }
    b.add(flags);
    for (const end of [-0.5, 0.5]) {
      const along = (width >= depth ? cz : cx) + end * (span + 1.5);
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6),
        new THREE.MeshStandardMaterial({ color: metal }),
      );
      pole.position.set(width >= depth ? at : along, POOL_DEPTH + 1.2, width >= depth ? along : at);
      b.add(pole);
    }
  }

  const ladderMat = new THREE.MeshStandardMaterial({ color: '#d7dde2', metalness: 0.8, roughness: 0.25 });
  for (const t of [0.2, 0.5, 0.8]) {
    for (const z of [rect.minZ + 0.25, rect.maxZ - 0.25]) {
      for (const side of [-0.4, 0.4]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6), ladderMat);
        rail.position.set(rect.minX + width * t + side, POOL_DEPTH - 1, z);
        b.add(rail);
      }
    }
  }
}

function buildAquarium(b: WaterBuilder): void {
  const rect = b.rect(7);
  const width = rect.maxX - rect.minX;
  const depth = rect.maxZ - rect.minZ;
  const cx = (rect.minX + rect.maxX) / 2;
  const cz = (rect.minZ + rect.maxZ) / 2;
  const track = b.track;

  const room = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(width, depth) * 4, 48),
    new THREE.MeshStandardMaterial({ color: '#1b222b', roughness: 0.9 }),
  );
  room.rotation.x = -Math.PI / 2;
  room.position.set(cx, -0.08, cz);
  b.add(room);

  const gravel = b.texture(gravelTexture(b.random));
  gravel.repeat.set(width / 6, depth / 6);
  b.plane(rect, 0, new THREE.MeshStandardMaterial({ map: gravel, roughness: 1 }));
  b.caustics(rect, 0.03, 0.22);
  b.courseRibbon(0.28);
  b.floatLine(track.innerOffset() - 0.4, 0.9, 0.2, 0.18, ['#7fe3ff', '#ffffff'], 1, 1, '#2aa9c9');
  b.floatLine(track.outerOffset() + 0.4, 0.9, 0.2, 0.18, ['#7fe3ff', '#ffffff'], 1, 1, '#2aa9c9');

  const glass = new THREE.MeshStandardMaterial({
    color: '#bfe9f2',
    transparent: true,
    opacity: 0.16,
    roughness: 0.05,
    metalness: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const panes: [number, number, number, number][] = [
    [width, cx, rect.minZ, 0],
    [width, cx, rect.maxZ, 0],
    [depth, rect.minX, cz, Math.PI / 2],
    [depth, rect.maxX, cz, Math.PI / 2],
  ];
  const frame = '#1d2a33';
  for (const [length, x, z, rotY] of panes) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(length, TANK_HEIGHT), glass);
    pane.position.set(x, TANK_HEIGHT / 2, z);
    pane.rotation.y = rotY;
    b.add(pane);
    b.box(length + 0.8, 0.5, 0.8, frame, x, TANK_HEIGHT, z, rotY);
    b.box(length + 0.8, 1.4, 0.9, frame, x, 0.7, z, rotY);
    const mullions = Math.max(1, Math.round(length / 24));
    for (let i = 0; i <= mullions; i += 1) {
      const t = -length / 2 + (i * length) / mullions;
      const mx = x + Math.cos(rotY) * t;
      const mz = z - Math.sin(rotY) * t;
      b.box(0.5, TANK_HEIGHT, 0.5, frame, mx, TANK_HEIGHT / 2, mz, rotY);
    }
  }
  b.waterSurface(rect, TANK_HEIGHT - 0.8, '#3fb0c8', 0.5, 0.1);
  b.particles(rect, TANK_HEIGHT - 0.8, Math.round(Math.min(5000, width * depth * 0.15)));
  const longX = width >= depth;
  for (const offset of [-0.25, 0, 0.25]) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(longX ? width * 0.9 : 0.6, 0.25, longX ? 0.6 : depth * 0.9),
      new THREE.MeshBasicMaterial({ color: '#e6fbff' }),
    );
    lamp.position.set(cx + (longX ? 0 : offset * width), TANK_HEIGHT + 0.6, cz + (longX ? offset * depth : 0));
    b.add(lamp);
  }

  const crowdColors = ['#e63946', '#f1faee', '#457b9d', '#ffb703', '#2a9d8f', '#e76f51', '#8338ec', '#fb8500'];
  const viewers: { x: number; z: number; h: number; color: string }[] = [];
  const backdropMap = b.texture(
    canvasTexture(64, (ctx) => {
      const gradient = ctx.createLinearGradient(0, 0, 0, 64);
      gradient.addColorStop(0, '#0d3b66');
      gradient.addColorStop(0.6, '#1b6f8f');
      gradient.addColorStop(1, '#3fa7b5');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
    }),
  );
  const backdropMat = new THREE.MeshBasicMaterial({ map: backdropMap, side: THREE.DoubleSide });
  const viewingPane = longX ? 1 : 3;
  panes.forEach(([length, x, z, rotY], index) => {
    if (index === viewingPane) return;
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(length, TANK_HEIGHT), backdropMat);
    const outward = index % 2 ? 0.5 : -0.5;
    backdrop.position.set(x + (rotY ? outward : 0), TANK_HEIGHT / 2, z + (rotY ? 0 : outward));
    backdrop.rotation.y = rotY;
    b.add(backdrop);
  });

  const sides: [number, number, boolean][] = longX ? [[rect.maxZ + 2.5, 1, true]] : [[rect.maxX + 2.5, 1, false]];
  for (const [line, outward, alongX] of sides) {
    const from = alongX ? rect.minX : rect.minZ;
    const to = alongX ? rect.maxX : rect.maxZ;
    for (let t = from + 1; t < to - 1; t += 1.1) {
      if (b.random() < 0.3) continue;
      const back = outward * b.random() * 4;
      viewers.push({
        x: alongX ? t : line + back,
        z: alongX ? line + back : t,
        h: 1.1 + b.random() * 0.8,
        color: crowdColors[Math.floor(b.random() * crowdColors.length)],
      });
    }
  }
  const bodies = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.5, 1, 0.35),
    new THREE.MeshStandardMaterial({ roughness: 0.8 }),
    viewers.length,
  );
  const heads = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.2, 8, 6),
    new THREE.MeshStandardMaterial({ color: '#d8b48f', roughness: 0.8 }),
    viewers.length,
  );
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  viewers.forEach((viewer, i) => {
    matrix.makeScale(1, viewer.h, 1);
    matrix.setPosition(viewer.x, viewer.h / 2, viewer.z);
    bodies.setMatrixAt(i, matrix);
    bodies.setColorAt(i, color.set(viewer.color));
    matrix.makeTranslation(viewer.x, viewer.h + 0.22, viewer.z);
    heads.setMatrixAt(i, matrix);
  });
  b.add(bodies);
  b.add(heads);

  const inside = b.rect(5.5);
  const decor = b.scatter(Math.round(Math.min(150, Math.max(60, b.track.size * 0.6))), inside, 3, 4);
  for (const placement of decor) placement.scale *= 1.9;
  b.instances(
    [
      [{ geometry: new THREE.DodecahedronGeometry(1.6, 0), color: '#7f8c8d', y: 0.6, sy: 0.7 }],
      [
        { geometry: new THREE.CylinderGeometry(0.25, 0.4, 1.6, 5), color: '#e07a6a', y: 0.8 },
        { geometry: new THREE.CylinderGeometry(0.15, 0.2, 1.2, 5), color: '#e07a6a', y: 1.4, tilt: 0.7 },
      ],
      [{ geometry: new THREE.IcosahedronGeometry(1.1, 0), color: '#c98fd6', y: 0.5, sy: 0.6 }],
      [
        { geometry: new THREE.CylinderGeometry(0.08, 0.12, 5, 4), color: '#4f7a2e', y: 2.5, tilt: 0.08 },
        { geometry: new THREE.BoxGeometry(0.7, 2.2, 0.05), color: '#6b8f35', y: 3.6 },
        { geometry: new THREE.BoxGeometry(0.6, 1.8, 0.05), color: '#5f8a2f', y: 1.8 },
      ],
      [{ geometry: new THREE.ConeGeometry(1.4, 2.2, 6), color: '#f2c14e', y: 1.1, sx: 1, sz: 0.2 }],
      [{ geometry: new THREE.DodecahedronGeometry(1.0, 0), color: '#8a7a68', y: 0.4, sy: 0.6 }],
    ],
    decor,
  );

  const stone = '#a8a29a';
  const roof = '#c0392b';
  const castle = new THREE.Group();
  const keep = new THREE.Mesh(
    new THREE.BoxGeometry(4, 4, 4),
    new THREE.MeshStandardMaterial({ color: stone, flatShading: true }),
  );
  keep.position.y = 2;
  castle.add(keep);
  for (const [dx, dz] of [
    [-2, -2],
    [2, -2],
    [-2, 2],
    [2, 2],
  ]) {
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1, 6, 8),
      new THREE.MeshStandardMaterial({ color: stone, flatShading: true }),
    );
    tower.position.set(dx, 3, dz);
    castle.add(tower);
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(1.2, 2, 8),
      new THREE.MeshStandardMaterial({ color: roof, flatShading: true }),
    );
    cap.position.set(dx, 7, dz);
    castle.add(cap);
  }
  const gate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2, 0.2), new THREE.MeshStandardMaterial({ color: '#2b2118' }));
  gate.position.set(0, 1, 2.05);
  castle.add(gate);
  castle.traverse((object) => {
    object.castShadow = true;
  });
  castle.position.set(b.track.centerX, 0, b.track.centerZ);
  castle.rotation.y = b.random() * Math.PI;
  b.add(castle);

  const chest = new THREE.Group();
  const chestBody = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.9, 1),
    new THREE.MeshStandardMaterial({ color: '#7a4a24', flatShading: true }),
  );
  chestBody.position.y = 0.45;
  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 1.6, 8, 1, false, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: '#8a5a2b', flatShading: true }),
  );
  lid.rotation.z = Math.PI / 2;
  lid.position.y = 0.9;
  const gold = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.15, 0.8),
    new THREE.MeshStandardMaterial({ color: '#f2c14e', metalness: 0.7, roughness: 0.3 }),
  );
  gold.position.y = 0.95;
  chest.add(chestBody, lid, gold);
  chest.position.set(b.track.centerX + 5.5, 0, b.track.centerZ + 1.5);
  chest.rotation.y = 0.5;
  b.add(chest);

  b.bubbles(decor.slice(0, 7), TANK_HEIGHT - 0.8);
  b.schools(b.scatter(5, inside, 0, 0), {
    fish: 12,
    colors: ['#ff8c42', '#ffd166', '#4cc9f0', '#f72585', '#80ed99'],
    minY: 5,
    maxY: TANK_HEIGHT - 2.5,
    size: 1.8,
  });
}

function buildOpenSea(b: WaterBuilder): void {
  const track = b.track;
  const size = track.size;
  const cx = track.centerX;
  const cz = track.centerZ;
  const core = b.rect(4);
  const surfaceY = Math.max(26, size * 0.28);

  const seabed = new THREE.PlaneGeometry(size * 6, size * 6, 96, 96);
  seabed.rotateX(-Math.PI / 2);
  seabed.translate(cx, 0, cz);
  const positions = seabed.getAttribute('position');
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const away = Math.hypot(Math.max(0, core.minX - x, x - core.maxX), Math.max(0, core.minZ - z, z - core.maxZ));
    const ripple = 0.12 * (1 + Math.sin(x * 0.4 + Math.sin(z * 0.12) * 2)) * 0.5;
    const dune = Math.min(1, away / 50) * (2.6 * Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.027) + 1.4);
    positions.setY(i, -0.08 - ripple + dune);
  }
  seabed.computeVertexNormals();
  const bed = new THREE.Mesh(
    seabed,
    new THREE.MeshStandardMaterial({ color: b.colors.ground, roughness: 1, flatShading: true }),
  );
  bed.receiveShadow = true;
  b.add(bed);
  b.caustics(b.rect(size * 0.6), 0.05, 0.14);
  b.courseRibbon(0.2);

  for (const lateral of [track.innerOffset() - 0.6, track.outerOffset() + 0.6]) {
    const buoyHeight = 1.7;
    const samples = b.floatLine(lateral, 9, 0.5, buoyHeight, ['#f77f00', '#fcbf49'], 1, 1);
    const tethers = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.03, 0.03, buoyHeight, 4),
      new THREE.MeshStandardMaterial({ color: '#2b2b2b' }),
      samples.length,
    );
    const p = { x: 0, y: 0, z: 0 };
    const matrix = new THREE.Matrix4();
    samples.forEach((s, i) => {
      track.point(s, lateral, p);
      matrix.makeTranslation(p.x, p.y + buoyHeight / 2, p.z);
      tethers.setMatrixAt(i, matrix);
    });
    b.add(tethers);
    b.add(
      new THREE.Mesh(
        stripGeometry(track, lateral - 0.04, lateral + 0.04, buoyHeight, buoyHeight, 1),
        new THREE.MeshBasicMaterial({ color: '#f4e9d2', side: THREE.DoubleSide }),
      ),
    );
  }

  const area = b.rect(size * 0.7);
  b.instances(
    [
      [{ geometry: new THREE.DodecahedronGeometry(1.8, 0), color: '#6f7f86', y: 0.6, sy: 0.6 }],
      [
        { geometry: new THREE.CylinderGeometry(0.08, 0.12, 8, 4), color: '#4f7a2e', y: 4, tilt: 0.08 },
        { geometry: new THREE.BoxGeometry(0.7, 2.2, 0.05), color: '#6b8f35', y: 6 },
        { geometry: new THREE.BoxGeometry(0.6, 1.8, 0.05), color: '#5f8a2f', y: 3 },
      ],
      [{ geometry: new THREE.ConeGeometry(0.5, 1.6, 5), color: '#5a8530', y: 0.8 }],
      [{ geometry: new THREE.ConeGeometry(1.2, 2.4, 6), color: '#8a6aa8', y: 1.2, sx: 1, sz: 0.15 }],
      [{ geometry: new THREE.TorusGeometry(0.9, 0.08, 5, 12), color: '#efe6cf', y: 0.1, tilt: Math.PI / 2 }],
    ],
    b.scatter(Math.round(Math.min(240, Math.max(90, size * 0.9))), area, 7, 5),
  );

  const wreckSpot = b.scatter(1, b.rect(size * 0.45), size * 0.25, size * 0.1)[0];
  if (wreckSpot) {
    const wreck = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(18, 4, 5),
      new THREE.MeshStandardMaterial({ color: '#5b4636', flatShading: true }),
    );
    hull.position.y = 1.2;
    hull.rotation.z = 0.18;
    const bow = new THREE.Mesh(
      new THREE.ConeGeometry(2.6, 5, 4),
      new THREE.MeshStandardMaterial({ color: '#5b4636', flatShading: true }),
    );
    bow.rotation.z = -Math.PI / 2;
    bow.position.set(11, 2.8, 0);
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.3, 12, 6),
      new THREE.MeshStandardMaterial({ color: '#4a3a2c' }),
    );
    mast.position.set(-1, 7, 0);
    mast.rotation.z = 0.5;
    wreck.add(hull, bow, mast);
    wreck.traverse((object) => {
      object.castShadow = true;
    });
    wreck.position.set(wreckSpot.x, 0, wreckSpot.z);
    wreck.rotation.y = wreckSpot.rot;
    b.add(wreck);
  }

  const ridges = 18;
  const ridgeMesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1, 1, 5),
    new THREE.MeshStandardMaterial({ color: '#2d5a6e', flatShading: true, roughness: 1 }),
    ridges,
  );
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  for (let i = 0; i < ridges; i += 1) {
    const angle = (i / ridges) * Math.PI * 2 + b.random() * 0.3;
    const radius = size * (2.1 + b.random() * 0.7);
    const h = size * (0.12 + b.random() * 0.18);
    const w = size * (0.35 + b.random() * 0.3);
    quaternion.setFromEuler(new THREE.Euler(0, b.random() * Math.PI, 0));
    position.set(cx + Math.cos(angle) * radius, h / 2 - 0.1, cz + Math.sin(angle) * radius);
    scale.set(w, h, w);
    matrix.compose(position, quaternion, scale);
    ridgeMesh.setMatrixAt(i, matrix);
  }
  b.add(ridgeMesh);

  const sea = b.rect(size * 2.5);
  b.waterSurface(sea, surfaceY, '#4fb3dc', 0.6, 1.4);
  b.particles(b.rect(size * 0.4), surfaceY, Math.round(Math.min(6000, size * size * 0.12)));

  const rays = Array.from({ length: 12 }, (_, i) => {
    const material = new THREE.MeshBasicMaterial({
      color: '#e6f7ff',
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ray = new THREE.Mesh(new THREE.ConeGeometry(4 + b.random() * 5, surfaceY, 14, 1, true), material);
    ray.position.set(
      core.minX + b.random() * (core.maxX - core.minX),
      surfaceY / 2,
      core.minZ + b.random() * (core.maxZ - core.minZ),
    );
    ray.rotation.z = 0.12 + b.random() * 0.1;
    b.add(ray);
    return { material, phase: i * 1.7 };
  });

  b.schools(b.scatter(6, b.rect(size * 0.3), 0, 0), {
    fish: 16,
    colors: ['#c9d6df', '#aebfcc', '#dfe7ec'],
    minY: 6,
    maxY: Math.min(surfaceY - 4, 18),
    size: 1.1,
  });

  b.animators.push((time) => {
    for (const ray of rays) ray.material.opacity = 0.04 + 0.025 * Math.sin(time * 0.5 + ray.phase);
  });
}

export function buildWaterVenue(theme: WaterTheme, track: TrackPath, random: () => number, colors: Colors): WaterVenue {
  const builder = new WaterBuilder(track, random, colors);
  if (theme === 'POOL') buildPool(builder);
  else if (theme === 'AQUARIUM') buildAquarium(builder);
  else buildOpenSea(builder);
  return builder.finish();
}
