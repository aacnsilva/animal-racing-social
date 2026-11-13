import * as THREE from 'three';
import { normalTexture, pixelTexture, tileFbm } from './kit';

const TAU = Math.PI * 2;

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  const s = c.getHexString();
  return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255];
}

export function causticTexture(size = 512): THREE.DataTexture {
  let seed = 12345;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gx = new Float32Array(size * size);
  const gy = new Float32Array(size * size);
  const cx = new Float32Array(size);
  const sx = new Float32Array(size);
  const cy = new Float32Array(size);
  const sy = new Float32Array(size);
  for (let w = 0; w < 22; w += 1) {
    let kx = 0;
    let ky = 0;
    while (kx === 0 && ky === 0) {
      const angle = rnd() * TAU;
      const m = 3 + rnd() * 7;
      kx = Math.round(Math.cos(angle) * m);
      ky = Math.round(Math.sin(angle) * m);
    }
    const amp = 1 / Math.hypot(kx, ky) ** 1.5;
    const phase = rnd() * TAU;
    for (let i = 0; i < size; i += 1) {
      cx[i] = Math.cos((TAU * kx * i) / size + phase);
      sx[i] = Math.sin((TAU * kx * i) / size + phase);
      cy[i] = Math.cos((TAU * ky * i) / size);
      sy[i] = Math.sin((TAU * ky * i) / size);
    }
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const c = (cx[x] * cy[y] - sx[x] * sy[y]) * amp;
        gx[y * size + x] += c * kx;
        gy[y * size + x] += c * ky;
      }
    }
  }
  const acc = new Float32Array(size * size);
  const rays = size * 2;
  const strength = (15 * size) / 512;
  for (let j = 0; j < rays; j += 1) {
    for (let i = 0; i < rays; i += 1) {
      const u = (i + rnd()) / 2;
      const v = (j + rnd()) / 2;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const fx = u - x0;
      const fy = v - y0;
      const x1 = (x0 + 1) % size;
      const y1 = (y0 + 1) % size;
      const a = y0 * size + x0;
      const b = y0 * size + x1;
      const c = y1 * size + x0;
      const d = y1 * size + x1;
      const dx = (gx[a] * (1 - fx) + gx[b] * fx) * (1 - fy) + (gx[c] * (1 - fx) + gx[d] * fx) * fy;
      const dy = (gy[a] * (1 - fx) + gy[b] * fx) * (1 - fy) + (gy[c] * (1 - fx) + gy[d] * fx) * fy;
      const lx = (((u + dx * strength) % size) + size) % size;
      const ly = (((v + dy * strength) % size) + size) % size;
      const px = Math.floor(lx) % size;
      const py = Math.floor(ly) % size;
      const wx = lx - Math.floor(lx);
      const wy = ly - Math.floor(ly);
      const qx = (px + 1) % size;
      const qy = (py + 1) % size;
      acc[py * size + px] += (1 - wx) * (1 - wy);
      acc[py * size + qx] += wx * (1 - wy);
      acc[qy * size + px] += (1 - wx) * wy;
      acc[qy * size + qx] += wx * wy;
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const byte = Math.round(Math.min(1, (acc[i] / 4) * 0.28) * 255);
    data[i * 4] = byte;
    data[i * 4 + 1] = byte;
    data[i * 4 + 2] = byte;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function detailTexture(): THREE.CanvasTexture {
  const a = tileFbm(256, 6, 5, 31, 0.55);
  const b = tileFbm(256, 24, 3, 77, 0.5);
  return pixelTexture(
    256,
    (_x, _y, i) => {
      const v = Math.max(0, Math.min(1, (a[i] - 0.5) * 1.8 + 0.5 + (b[i] - 0.5) * 0.5));
      return [v, v, v];
    },
    false,
  );
}

export function waterNormalTexture(): THREE.CanvasTexture {
  const height = tileFbm(256, 5, 5, 911, 0.55);
  return normalTexture(height, 256, 5);
}

export type TileSet = { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture };

export function tileTextures(base: string, grout: string, seed: number, tiles = 8, size = 512): TileSet {
  const [br, bg, bb] = rgb(base);
  const [gr, gg, gb] = rgb(grout);
  const cell = size / tiles;
  const stain = tileFbm(size, 3, 4, seed, 0.5);
  const height = new Float32Array(size * size);
  const map = pixelTexture(size, (x, y, i) => {
    const tx = Math.floor(x / cell);
    const ty = Math.floor(y / cell);
    const fx = (x % cell) / cell;
    const fy = (y % cell) / cell;
    const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
    const groutMix = edge < 0.035 ? 1 : edge < 0.06 ? (0.06 - edge) / 0.025 : 0;
    const jitter = (hash(tx, ty, seed) - 0.5) * 0.07;
    const hue = (hash(tx, ty, seed + 5) - 0.5) * 0.03;
    const shade = 1 + jitter + (stain[i] - 0.5) * 0.08;
    height[i] = (1 - groutMix) * (0.8 + Math.min(1, edge * 9) * 0.2) + hash(tx, ty, seed + 9) * 0.06;
    return [
      (br * shade - hue) * (1 - groutMix) + gr * groutMix,
      bg * shade * (1 - groutMix) + gg * groutMix,
      (bb * shade + hue) * (1 - groutMix) + gb * groutMix,
    ];
  });
  return { map, normalMap: normalTexture(height, size, 2.2) };
}

export function paverTextures(seed: number): TileSet {
  const size = 512;
  const grain = tileFbm(size, 48, 3, seed, 0.6);
  const blotch = tileFbm(size, 4, 4, seed + 3, 0.5);
  const height = new Float32Array(size * size);
  const cols = 4;
  const rows = 4;
  const map = pixelTexture(size, (x, y, i) => {
    const row = Math.floor((y / size) * rows);
    const u = (x / size) * cols + (row % 2) * 0.5;
    const col = Math.floor(u) % cols;
    const fx = u - Math.floor(u);
    const fy = (y / size) * rows - row;
    const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
    const joint = edge < 0.02 ? 1 : edge < 0.04 ? (0.04 - edge) / 0.02 : 0;
    const tone = 0.86 + (hash(col, row, seed) - 0.5) * 0.14 + (grain[i] - 0.5) * 0.16 + (blotch[i] - 0.5) * 0.14;
    height[i] = (1 - joint) * (0.7 + grain[i] * 0.3);
    const k = tone * (1 - joint * 0.3);
    return [0.86 * k, 0.8 * k, 0.69 * k];
  });
  return { map, normalMap: normalTexture(height, size, 2.5) };
}

export function grassTexture(seed: number): THREE.CanvasTexture {
  const size = 256;
  const fine = tileFbm(size, 40, 3, seed, 0.6);
  const patch = tileFbm(size, 4, 4, seed + 11, 0.5);
  return pixelTexture(size, (_x, _y, i) => {
    const v = 0.8 + (fine[i] - 0.5) * 0.5 + (patch[i] - 0.5) * 0.08;
    const dry = Math.max(0, fine[i] - 0.6) * 0.5;
    return [(0.3 + dry * 0.3) * v, (0.52 + dry * 0.08) * v, 0.2 * v];
  });
}

export function gravelTextures(seed: number): TileSet {
  const size = 512;
  const cells = 36;
  const palette = ['#e6d8b8', '#bfa67a', '#9a9284', '#dccba6', '#b09a70', '#f0e8d4', '#857c6e', '#c9b48c'].map(rgb);
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      px[j * cells + i] = i + hash(i, j, seed);
      py[j * cells + i] = j + hash(i, j, seed + 1);
    }
  }
  const height = new Float32Array(size * size);
  const grain = tileFbm(size, 64, 2, seed + 4, 0.5);
  const map = pixelTexture(size, (x, y, i) => {
    const u = (x / size) * cells;
    const v = (y / size) * cells;
    const cu = Math.floor(u);
    const cv = Math.floor(v);
    let best = 9;
    let second = 9;
    let id = 0;
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let di = -1; di <= 1; di += 1) {
        const ci = (cu + di + cells) % cells;
        const cj = (cv + dj + cells) % cells;
        const k = cj * cells + ci;
        const dx = px[k] - ci + (cu + di) - u;
        const dy = py[k] - cj + (cv + dj) - v;
        const d = dx * dx + dy * dy;
        if (d < best) {
          second = best;
          best = d;
          id = k;
        } else if (d < second) second = d;
      }
    }
    const rim = Math.min(1, (Math.sqrt(second) - Math.sqrt(best)) * 2.2);
    height[i] = Math.sqrt(rim) * (0.6 + hash(id, 3, seed) * 0.4);
    const c = palette[Math.floor(hash(id, 7, seed) * palette.length)];
    const shade = (0.72 + rim * 0.36) * (0.92 + (grain[i] - 0.5) * 0.25);
    return [c[0] * shade, c[1] * shade, c[2] * shade];
  });
  return { map, normalMap: normalTexture(height, size, 3.2) };
}

export function sandTextures(seed: number, ripples: number): TileSet {
  const size = 512;
  const warp = tileFbm(size, 3, 4, seed, 0.5);
  const warp2 = tileFbm(size, 7, 3, seed + 21, 0.5);
  const grain = tileFbm(size, 96, 2, seed + 2, 0.6);
  const blotch = tileFbm(size, 5, 4, seed + 8, 0.5);
  const height = new Float32Array(size * size);
  const map = pixelTexture(size, (x, y, i) => {
    const phase = TAU * (ripples * (x / size) + (warp[i] - 0.5) * 3.2 + (y / size) * 2) + (warp2[i] - 0.5) * 2.4;
    const wave = Math.sin(phase);
    const crest = wave > 0 ? wave ** 0.7 : -((-wave) ** 1.4);
    height[i] = crest * 0.5 + 0.5 + (grain[i] - 0.5) * 0.12;
    const tone = 0.84 + crest * 0.07 + (grain[i] - 0.5) * 0.2 + (blotch[i] - 0.5) * 0.16;
    return [0.93 * tone, 0.85 * tone, 0.68 * tone];
  });
  return { map, normalMap: normalTexture(height, size, 2.4) };
}

export function ropeTexture(colors: string[], run: number): THREE.CanvasTexture {
  const disc = 16;
  const width = colors.length * run * disc;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 8;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < colors.length * run; i += 1) {
    ctx.fillStyle = colors[Math.floor(i / run)];
    ctx.fillRect(i * disc, 0, disc, 8);
    const shade = ctx.createLinearGradient(i * disc, 0, (i + 1) * disc, 0);
    shade.addColorStop(0, 'rgba(0,0,0,0.55)');
    shade.addColorStop(0.18, 'rgba(0,0,0,0)');
    shade.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    shade.addColorStop(0.82, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = shade;
    ctx.fillRect(i * disc, 0, disc, 8);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function labelTexture(lines: string[], background: string, ink: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 244, 116);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const sizePx = lines.length > 1 ? 44 : 72;
  ctx.font = `700 ${sizePx}px system-ui, sans-serif`;
  lines.forEach((line, i) => ctx.fillText(line, 128, 64 + (i - (lines.length - 1) / 2) * (sizePx + 6)));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function hallWallTexture(seed: number): THREE.CanvasTexture {
  const size = 256;
  const noise = tileFbm(size, 8, 4, seed, 0.55);
  return pixelTexture(size, (x, y, i) => {
    const u = x / size;
    const v = 1 - y / size;
    const spot = Math.exp(-((u - 0.5) ** 2) / 0.035) * Math.exp(-Math.max(0, 0.95 - v) * 2.2) * (v < 0.97 ? 1 : 0.2);
    const base = 0.035 + (noise[i] - 0.5) * 0.02;
    const panel = Math.abs(u - 0.5) > 0.47 ? 0.6 : 1;
    return [
      Math.sqrt((base + spot * 0.95) * panel),
      Math.sqrt((base * 0.95 + spot * 0.62) * panel),
      Math.sqrt((base * 1.1 + spot * 0.3) * panel),
    ];
  });
}

export function posterTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const themes = [
    ['#0b3954', '#1f8a9e', '#ffd166'],
    ['#3d1e4f', '#b0508a', '#ffe8c2'],
    ['#0d3b2e', '#2f9e77', '#f4f1de'],
    ['#4a1f14', '#d1663a', '#ffe3a3'],
  ];
  themes.forEach(([dark, mid, ink], i) => {
    const x = i * 128;
    const gradient = ctx.createLinearGradient(x, 0, x, 256);
    gradient.addColorStop(0, mid);
    gradient.addColorStop(1, dark);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, 0, 128, 256);
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.ellipse(x + 60, 96, 34, 17 + i * 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 90, 96);
    ctx.lineTo(x + 112, 78);
    ctx.lineTo(x + 112, 114);
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(x + 42, 92, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ink;
    for (let line = 0; line < 4; line += 1) ctx.fillRect(x + 16, 160 + line * 16, 96 - line * 14, 6);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 6, 6, 116, 244);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
