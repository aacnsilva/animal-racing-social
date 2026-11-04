import * as THREE from 'three';
import type { TrackPath } from '../lib/track';

export function rng(seedText: string): () => number {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) seed = Math.imul(seed ^ seedText.charCodeAt(i), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stripGeometry(
  track: TrackPath,
  a: number,
  b: number,
  yA: number,
  yB: number,
  step: number,
  sideways = true,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const samples = track.samples(step);
  const p = { x: 0, y: 0, z: 0 };
  samples.forEach((s, i) => {
    track.point(s, a, p);
    positions.push(p.x, p.y + yA, p.z);
    track.point(s, b, p);
    positions.push(p.x, (sideways ? p.y : p.y) + yB, p.z);
    uvs.push(0, s / 4, 1, s / 4);
    if (i > 0) {
      const base = (i - 1) * 2;
      if (track.winding > 0) indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      else indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function wallGeometry(
  track: TrackPath,
  lateral: number,
  bottom: number,
  top: number,
  step: number,
  relativeBottom: boolean,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const samples = track.samples(step);
  const p = { x: 0, y: 0, z: 0 };
  samples.forEach((s, i) => {
    track.point(s, lateral, p);
    positions.push(p.x, relativeBottom ? p.y + bottom : bottom, p.z);
    positions.push(p.x, p.y + top, p.z);
    if (i > 0) {
      const base = (i - 1) * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
