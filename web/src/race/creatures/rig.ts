import * as THREE from 'three';
import { LANE_COLORS, LANE_TEXT } from '../../lib/track';
import type { EntrantState } from '../../lib/types';

export type AnimalRig = {
  root: THREE.Group;
  height: number;
  update: (state: EntrantState, speed: number, dt: number, time: number) => void;
};

export const laneIndex = (laneHex: string) => Math.max(0, LANE_COLORS.indexOf(laneHex));

export function laneHash(laneHex: string): number {
  let hash = 0;
  for (const char of laneHex) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return hash;
}

const ATLAS_GRID = 4;
let atlas: THREE.CanvasTexture | null = null;

export function gearAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const size = 1024;
  const cell = size / ATLAS_GRID;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  LANE_COLORS.forEach((color, i) => {
    const x = (i % ATLAS_GRID) * cell;
    const y = Math.floor(i / ATLAS_GRID) * cell;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, cell, cell);
    ctx.strokeStyle = LANE_TEXT[i];
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 6;
    ctx.strokeRect(x + 9, y + 9, cell - 18, cell - 18);
    ctx.globalAlpha = 1;
    ctx.fillStyle = LANE_TEXT[i];
    ctx.font = `800 ${Math.round(cell * 0.34)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [centre, angle] of [
      [0.2, Math.PI / 2],
      [0.8, -Math.PI / 2],
    ]) {
      ctx.save();
      ctx.translate(x + cell * centre, y + cell * 0.5);
      ctx.rotate(angle);
      ctx.fillText(String(i + 1), 0, 0);
      ctx.restore();
    }
  });
  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  return atlas;
}

export function atlasCell(index: number): [number, number, number, number] {
  const col = index % ATLAS_GRID;
  const row = Math.floor(index / ATLAS_GRID);
  const inset = 0.004;
  return [
    col / ATLAS_GRID + inset,
    1 - (row + 1) / ATLAS_GRID + inset,
    (col + 1) / ATLAS_GRID - inset,
    1 - row / ATLAS_GRID - inset,
  ];
}

export const BLANK_UV: [number, number, number, number] = [0.9, 0.1, 0.9, 0.1];

const cache = new Map<string, THREE.BufferGeometry>();

function speedLineGeometry(length: number, width: number): THREE.BufferGeometry {
  const key = `speedline:${length}:${width}`;
  let geometry = cache.get(key);
  if (geometry) return geometry;
  geometry = new THREE.PlaneGeometry(1, length, 1, 10);
  const position = geometry.getAttribute('position');
  const alpha = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i += 1) {
    const along = 0.5 - position.getY(i) / length;
    position.setX(i, Math.sign(position.getX(i)) * width * (1 - along * 0.8) * 0.5);
    position.setY(i, position.getY(i) - length / 2);
    alpha.set([1, 1, 1, (1 - along) ** 2], i * 4);
  }
  position.needsUpdate = true;
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(alpha, 4));
  geometry.rotateX(Math.PI / 2);
  geometry.rotateZ(Math.PI / 2);
  cache.set(key, geometry);
  return geometry;
}

export type Effects = {
  update: (state: EntrantState, dt: number, time: number) => void;
};

export function addEffects(
  root: THREE.Group,
  anchor: THREE.Object3D,
  lane: THREE.Color,
  length: number,
  ringRadius = 1,
): Effects {
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd34d,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  let ringGeometry = cache.get('ring');
  if (!ringGeometry) {
    ringGeometry = new THREE.RingGeometry(0.9, 1.2, 40);
    cache.set('ring', ringGeometry);
  }
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.visible = false;
  root.add(ring);
  const trailMaterial = new THREE.MeshBasicMaterial({
    color: lane.clone().lerp(new THREE.Color('#ffffff'), 0.7),
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const trail = new THREE.Group();
  const lines: [number, number, number, number][] = [
    [0.34, 0.3, 1.0, 0.05],
    [-0.34, 0.05, 1.4, 0.06],
    [0.34, -0.2, 0.8, 0.045],
    [-0.34, 0.36, 0.7, 0.04],
  ];
  for (const [side, y, scale, width] of lines) {
    const line = new THREE.Mesh(speedLineGeometry(length * scale, width), trailMaterial);
    line.position.set(side, y, -length * 0.42);
    trail.add(line);
  }
  trail.visible = false;
  anchor.add(trail);
  return {
    update(state, dt, time) {
      const ringTarget = state === 'FINISHED' ? 0.8 : state === 'STUMBLED' ? 0.9 : 0;
      ringMaterial.color.set(state === 'STUMBLED' ? '#ff4d4d' : '#ffd34d');
      ringMaterial.opacity += (ringTarget - ringMaterial.opacity) * Math.min(1, dt * 6);
      ring.visible = ringMaterial.opacity > 0.01;
      ring.scale.setScalar(ringRadius * (state === 'STUMBLED' ? 1 + Math.sin(time * 10) * 0.15 : 1));
      const trailTarget = state === 'SPRINTING' ? 0.5 : 0;
      trailMaterial.opacity += (trailTarget - trailMaterial.opacity) * Math.min(1, dt * 5);
      trail.visible = trailMaterial.opacity > 0.01;
    },
  };
}

const GREY = new THREE.Color('#8b8f8c');
const WHITE = new THREE.Color('#ffffff');
const WEARY = new THREE.Color('#b9b3ad');

export function stateTint(materials: THREE.MeshStandardMaterial[]): (state: EntrantState, dt: number) => void {
  const target = new THREE.Color();
  return (state, dt) => {
    target.copy(state === 'DNF' ? GREY : state === 'TIRED' ? WEARY : WHITE);
    const k = Math.min(1, dt * 4);
    for (const material of materials) material.color.lerp(target, k);
  };
}

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export const frac = (x: number) => x - Math.floor(x);
