import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { laneColor, laneText, surfaceColors, TrackPath } from '../lib/track';
import type { Segment, Species } from '../lib/types';
import { animateRig, buildAnimal, type AnimalRig } from './animals';
import type { Frame, FrameEntrant, FrameSource } from './playback';

export type CameraMode = 'follow' | 'tv' | 'overview';

export type SceneOptions = {
  venueId: string;
  segments: Segment[];
  lapLength: number;
  lanes: number;
  surface: string;
  species: Species;
  entrants: { id: string; lane: number }[];
};

type Runner = {
  id: string;
  lane: number;
  rig: AnimalRig;
  label: HTMLDivElement;
  tag: HTMLSpanElement;
  tagText: string;
  world: THREE.Vector3;
};

const UP = new THREE.Vector3(0, 1, 0);

function rng(seedText: string): () => number {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) seed = Math.imul(seed ^ seedText.charCodeAt(i), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stripGeometry(track: TrackPath, a: number, b: number, yA: number, yB: number, step: number, sideways = true): THREE.BufferGeometry {
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
      // Wind the faces so they point up whichever way the track turns; otherwise they are back-face culled.
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

function wallGeometry(track: TrackPath, lateral: number, bottom: number, top: number, step: number, relativeBottom: boolean): THREE.BufferGeometry {
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

function checkerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  for (let x = 0; x < 16; x += 1) {
    for (let y = 0; y < 4; y += 1) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#fafafa';
      ctx.fillRect(x * 4, y * 4, 4, 4);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function coast(finishedForMs: number | null, speed: number): number {
  if (finishedForMs === null) return 0;
  const T = 6;
  const t = Math.min(T, finishedForMs / 1000);
  return speed * (t - (t * t) / (2 * T));
}

export class RaceScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly track: TrackPath;
  private controls: OrbitControls;
  private container: HTMLElement;
  private labelLayer: HTMLDivElement;
  private runners = new Map<string, Runner>();
  private source: FrameSource | null = null;
  private mode: CameraMode = 'follow';
  private raf = 0;
  private lastTime = 0;
  private elapsed = 0;
  private resizeObserver: ResizeObserver;
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private snapCamera = true;
  private sun: THREE.DirectionalLight;
  private species: Species;
  private disposables: { dispose: () => void }[] = [];
  onFrame: ((frame: Frame | null) => void) | null = null;

  constructor(container: HTMLElement, options: SceneOptions) {
    this.container = container;
    this.species = options.species;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'viewer-canvas';
    container.appendChild(this.renderer.domElement);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'viewer-labels';
    container.appendChild(this.labelLayer);

    this.track = new TrackPath(options.segments, options.lapLength, options.lanes);
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, Math.max(2000, this.track.size * 8));
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 15;
    this.controls.maxDistance = this.track.size * 3;
    this.controls.enabled = false;

    this.sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    this.buildEnvironment(options);
    this.buildRunners(options);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  setSource(source: FrameSource | null): void {
    this.source = source;
  }

  setCameraMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.snapCamera = true;
    this.controls.enabled = mode === 'overview';
    if (mode === 'overview') {
      const size = this.track.size;
      this.camera.fov = 50;
      this.camera.position.set(this.track.centerX + size * 0.05, size * 0.5, this.track.centerZ + size * 0.62);
      this.controls.target.set(this.track.centerX, 0, this.track.centerZ);
      this.camera.updateProjectionMatrix();
      this.controls.update();
    }
  }

  resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    for (const item of this.disposables) item.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }

  private add<T extends THREE.Object3D>(object: T): T {
    this.scene.add(object);
    return object;
  }

  private buildEnvironment(options: SceneOptions): void {
    const colors = surfaceColors(options.surface);
    const track = this.track;
    const size = track.size;
    const cx = track.centerX;
    const cz = track.centerZ;
    const random = rng(options.venueId);

    this.scene.background = new THREE.Color(colors.sky);
    this.scene.fog = new THREE.Fog(colors.fog, size * 2.2, size * 6.5);

    this.add(new THREE.HemisphereLight(colors.sky, colors.ground, 1.1));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const shadowCam = this.sun.shadow.camera;
    shadowCam.left = -45;
    shadowCam.right = 45;
    shadowCam.top = 45;
    shadowCam.bottom = -45;
    shadowCam.near = 1;
    shadowCam.far = 400;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.06;
    this.add(this.sun);
    this.add(this.sun.target);

    const groundMat = new THREE.MeshStandardMaterial({ color: colors.ground, roughness: 1, flatShading: true });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(size * 5, 64), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.05, cz);
    ground.receiveShadow = true;
    this.add(ground);

    const infieldPoints = track.samples(2).map((s) => {
      const p = track.point(s, track.innerOffset() - 0.8);
      return new THREE.Vector2(p.x, -p.z);
    });
    const infield = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(infieldPoints)), new THREE.MeshStandardMaterial({ color: colors.infield, roughness: 1, side: THREE.DoubleSide }));
    infield.rotation.x = -Math.PI / 2;
    infield.position.y = 0.0;
    infield.receiveShadow = true;
    this.add(infield);

    const trackMat = new THREE.MeshStandardMaterial({ color: colors.track, roughness: options.surface === 'ICE' ? 0.25 : 0.95, metalness: options.surface === 'ICE' ? 0.15 : 0 });
    const ribbon = new THREE.Mesh(stripGeometry(track, track.innerOffset(), track.outerOffset(), 0.04, 0.04, 1), trackMat);
    ribbon.receiveShadow = true;
    this.add(ribbon);

    const lineMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false });
    for (let lane = 1; lane < track.lanes; lane += 1) {
      const offset = track.laneOffset(lane) + 0.7;
      this.add(new THREE.Mesh(stripGeometry(track, offset - 0.04, offset + 0.04, 0.06, 0.06, 1), lineMat));
    }

    const railMat = new THREE.MeshStandardMaterial({ color: '#f7f7f2', roughness: 0.6, side: THREE.DoubleSide });
    for (const lateral of [track.innerOffset() - 0.3, track.outerOffset() + 0.3]) {
      this.add(new THREE.Mesh(wallGeometry(track, lateral, 0.92, 1.06, 1, true), railMat));
      const posts = track.samples(6);
      const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1.05, 0.08), railMat, posts.length);
      const m = new THREE.Matrix4();
      const p = { x: 0, y: 0, z: 0 };
      posts.forEach((s, i) => {
        track.point(s, lateral, p);
        m.makeTranslation(p.x, p.y + 0.52, p.z);
        postMesh.setMatrixAt(i, m);
      });
      postMesh.castShadow = true;
      this.add(postMesh);
    }

    if (track.maxY > 0.05) {
      const skirtMat = new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 1, side: THREE.DoubleSide, flatShading: true });
      for (const lateral of [track.innerOffset() - 0.6, track.outerOffset() + 0.6]) {
        this.add(new THREE.Mesh(wallGeometry(track, lateral, -0.05, 0.04, 1, false), skirtMat));
      }
      this.add(new THREE.Mesh(stripGeometry(track, track.innerOffset() - 0.6, track.innerOffset(), 0.04, 0.04, 1), skirtMat));
      this.add(new THREE.Mesh(stripGeometry(track, track.outerOffset(), track.outerOffset() + 0.6, 0.04, 0.04, 1), skirtMat));
    }

    const checker = checkerTexture();
    this.disposables.push(checker);
    const finishMat = new THREE.MeshBasicMaterial({ map: checker });
    const finishGeometry = new THREE.BufferGeometry();
    const a = track.point(-0.7, track.innerOffset());
    const b = track.point(-0.7, track.outerOffset());
    const c = track.point(0.7, track.innerOffset());
    const d = track.point(0.7, track.outerOffset());
    finishGeometry.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y + 0.07, a.z, b.x, b.y + 0.07, b.z, c.x, c.y + 0.07, c.z, d.x, d.y + 0.07, d.z], 3));
    finishGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    finishGeometry.setIndex([0, 2, 1, 1, 2, 3]);
    finishGeometry.computeVertexNormals();
    const finish = new THREE.Mesh(finishGeometry, finishMat);
    finish.material.side = THREE.DoubleSide;
    this.add(finish);

    const gantryMat = new THREE.MeshStandardMaterial({ color: '#20302a', roughness: 0.5 });
    const inner = track.point(0, track.innerOffset() - 1.2);
    const outer = track.point(0, track.outerOffset() + 1.2);
    for (const p of [inner, outer]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 7, 8), gantryMat);
      post.position.set(p.x, p.y + 3.5, p.z);
      post.castShadow = true;
      this.add(post);
    }
    const span = Math.hypot(outer.x - inner.x, outer.z - inner.z);
    const banner = new THREE.Mesh(new THREE.BoxGeometry(span, 1.1, 0.25), [gantryMat, gantryMat, gantryMat, gantryMat, new THREE.MeshBasicMaterial({ map: checker }), new THREE.MeshBasicMaterial({ map: checker })]);
    banner.position.set((inner.x + outer.x) / 2, Math.max(inner.y, outer.y) + 6.6, (inner.z + outer.z) / 2);
    banner.rotation.y = Math.atan2(-(outer.z - inner.z), outer.x - inner.x);
    banner.castShadow = true;
    this.add(banner);

    this.buildGrandstand(random);
    this.buildDecor(options.surface, random, colors);
  }

  private buildGrandstand(random: () => number): void {
    const track = this.track;
    const straights = track.ranges.filter((range) => range.type !== 'CURVE');
    const longest = straights.sort((x, y) => y.end - y.start - (x.end - x.start))[0] ?? track.ranges[0];
    if (!longest) return;
    const length = Math.min(90, (longest.end - longest.start) * 0.8);
    const mid = (longest.start + longest.end) / 2;
    const frame = track.frame(mid);
    const group = new THREE.Group();
    group.position.set(frame.x, frame.y, frame.z);
    group.rotation.y = Math.atan2(frame.tx, frame.tz);
    const side = track.winding;
    const base = track.outerOffset() + 6;
    const standMat = new THREE.MeshStandardMaterial({ color: '#d9dcd6', roughness: 0.85, flatShading: true });
    const seatMat = new THREE.MeshStandardMaterial({ color: '#2f6f5e', roughness: 0.8, flatShading: true });
    const tiers = 6;
    for (let i = 0; i < tiers; i += 1) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7 * (i + 1), length), i % 2 ? seatMat : standMat);
      tier.position.set(side * (base + i * 2.2), 0.35 * (i + 1), 0);
      tier.castShadow = true;
      tier.receiveShadow = true;
      group.add(tier);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(tiers * 2.2 + 2, 0.3, length + 2), new THREE.MeshStandardMaterial({ color: '#b8452f', roughness: 0.6 }));
    roof.position.set(side * (base + (tiers - 1) * 1.1), 0.7 * tiers + 3.2, 0);
    roof.rotation.z = side * -0.08;
    roof.castShadow = true;
    group.add(roof);
    const postGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.7 * tiers + 3.2, 6);
    for (const z of [-length / 2, 0, length / 2]) {
      const post = new THREE.Mesh(postGeometry, standMat);
      post.position.set(side * (base + (tiers - 1) * 2.2 + 1), (0.7 * tiers + 3.2) / 2, z);
      group.add(post);
    }
    const crowdColors = ['#e63946', '#f1faee', '#457b9d', '#ffb703', '#2a9d8f', '#e76f51', '#8338ec', '#fb8500'];
    const perTier = Math.floor(length / 1.1);
    const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.7, 0.45), new THREE.MeshStandardMaterial({ roughness: 0.8 }), tiers * perTier);
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    let index = 0;
    for (let i = 0; i < tiers; i += 1) {
      for (let j = 0; j < perTier; j += 1) {
        if (random() < 0.25) continue;
        m.makeTranslation(side * (base + i * 2.2 + (random() - 0.5) * 0.6), 0.7 * (i + 1) + 0.35, -length / 2 + j * 1.1 + 0.5);
        crowd.setMatrixAt(index, m);
        crowd.setColorAt(index, color.set(crowdColors[Math.floor(random() * crowdColors.length)]!));
        index += 1;
      }
    }
    crowd.count = index;
    group.add(crowd);
    this.add(group);
  }

  private buildDecor(surface: string, random: () => number, colors: ReturnType<typeof surfaceColors>): void {
    const track = this.track;
    const size = track.size;
    const cx = track.centerX;
    const cz = track.centerZ;
    const reference = track.samples(3).map((s) => ({ s, f: track.frame(s) }));
    const placements: { x: number; z: number; y: number; scale: number; rot: number }[] = [];
    const target = Math.round(Math.min(260, Math.max(90, size * 0.9)));
    let guard = 0;
    while (placements.length < target && guard < target * 30) {
      guard += 1;
      const x = cx + (random() - 0.5) * size * 2.4;
      const z = cz + (random() - 0.5) * size * 2.4;
      let best = Infinity;
      let side = 0;
      let nearY = 0;
      for (const { f } of reference) {
        const dx = x - f.x;
        const dz = z - f.z;
        const dist = dx * dx + dz * dz;
        if (dist < best) {
          best = dist;
          side = dx * f.nx + dz * f.nz;
          nearY = f.y;
        }
      }
      const distance = Math.sqrt(best);
      const clearance = side > 0 ? track.outerOffset() + 7 : -track.innerOffset() + 5;
      if (distance < clearance) continue;
      if (side > 0 && distance < track.outerOffset() + 26 && random() < 0.7) continue;
      placements.push({ x, z, y: distance < clearance + 6 ? nearY * 0.3 : 0, scale: 0.7 + random() * 0.8, rot: random() * Math.PI * 2 });
    }

    type Part = { geometry: THREE.BufferGeometry; color: string; y: number; sx?: number; sy?: number; sz?: number; tilt?: number };
    const kinds: Part[][] = [];
    const trunk = '#6b4a2f';
    switch (surface) {
      case 'SAND':
        kinds.push(
          [
            { geometry: new THREE.CylinderGeometry(0.18, 0.28, 6, 5), color: '#8a6a43', y: 3, tilt: 0.12 },
            { geometry: new THREE.ConeGeometry(2.4, 1.2, 6), color: '#3f8a3a', y: 6.2 },
          ],
          [{ geometry: new THREE.SphereGeometry(4, 7, 4), color: colors.accent, y: 0, sy: 0.35 }],
          [
            { geometry: new THREE.CylinderGeometry(0.35, 0.4, 3, 6), color: '#4f8a43', y: 1.5 },
            { geometry: new THREE.CylinderGeometry(0.2, 0.22, 1.4, 6), color: '#4f8a43', y: 1.9, tilt: 1.2 },
          ],
        );
        break;
      case 'ICE':
        kinds.push(
          [
            { geometry: new THREE.CylinderGeometry(0.2, 0.25, 1.4, 5), color: '#5a4636', y: 0.7 },
            { geometry: new THREE.ConeGeometry(1.8, 4.5, 6), color: '#2f5d4a', y: 3.3 },
            { geometry: new THREE.ConeGeometry(1.0, 1.8, 6), color: '#f4fbff', y: 5.1 },
          ],
          [{ geometry: new THREE.DodecahedronGeometry(1.4, 0), color: '#bfe3f2', y: 0.6, sy: 0.8 }],
        );
        break;
      case 'DIRT':
        kinds.push(
          [{ geometry: new THREE.DodecahedronGeometry(1.6, 0), color: '#8c7a63', y: 0.8, sy: 0.7 }],
          [
            { geometry: new THREE.CylinderGeometry(0.2, 0.3, 2, 5), color: trunk, y: 1 },
            { geometry: new THREE.ConeGeometry(1.6, 4, 6), color: '#46663a', y: 3.6 },
          ],
          [{ geometry: new THREE.IcosahedronGeometry(0.9, 0), color: '#8f8a4a', y: 0.5, sy: 0.7 }],
        );
        break;
      case 'MUD':
        kinds.push(
          [
            { geometry: new THREE.CylinderGeometry(0.25, 0.35, 3, 5), color: '#4e3a28', y: 1.5 },
            { geometry: new THREE.IcosahedronGeometry(2.4, 0), color: '#2f5a2a', y: 4.2 },
          ],
          [{ geometry: new THREE.CylinderGeometry(2.2, 2.2, 0.05, 10), color: '#3d3122', y: 0.02 }],
          [{ geometry: new THREE.ConeGeometry(0.5, 1.6, 5), color: '#5f7a3a', y: 0.8 }],
        );
        break;
      default:
        kinds.push(
          [
            { geometry: new THREE.CylinderGeometry(0.22, 0.3, 2.4, 5), color: trunk, y: 1.2 },
            { geometry: new THREE.IcosahedronGeometry(2.1, 0), color: '#3d7f35', y: 3.8 },
          ],
          [
            { geometry: new THREE.CylinderGeometry(0.2, 0.28, 2, 5), color: trunk, y: 1 },
            { geometry: new THREE.ConeGeometry(1.7, 4.2, 7), color: '#2f6b33', y: 3.8 },
          ],
          [{ geometry: new THREE.IcosahedronGeometry(1.0, 0), color: '#4f9440', y: 0.5, sy: 0.75 }],
        );
    }

    const assigned: typeof placements[] = kinds.map(() => []);
    placements.forEach((placement, i) => assigned[i % kinds.length]!.push(placement));
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    kinds.forEach((parts, kindIndex) => {
      const list = assigned[kindIndex]!;
      if (!list.length) return;
      for (const part of parts) {
        const instanced = new THREE.InstancedMesh(part.geometry, new THREE.MeshStandardMaterial({ color: part.color, flatShading: true, roughness: 0.9 }), list.length);
        list.forEach((placement, i) => {
          euler.set(part.tilt ?? 0, placement.rot, 0);
          quaternion.setFromEuler(euler);
          position.set(placement.x, placement.y + part.y * placement.scale, placement.z);
          scale.set((part.sx ?? 1) * placement.scale, (part.sy ?? 1) * placement.scale, (part.sz ?? 1) * placement.scale);
          matrix.compose(position, quaternion, scale);
          instanced.setMatrixAt(i, matrix);
        });
        instanced.castShadow = part.y > 1;
        instanced.receiveShadow = true;
        this.add(instanced);
      }
    });

    const hills = 18;
    const hillMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5), new THREE.MeshStandardMaterial({ color: surface === 'ICE' ? '#dfeef5' : colors.accent, flatShading: true, roughness: 1 }), hills);
    for (let i = 0; i < hills; i += 1) {
      const angle = (i / hills) * Math.PI * 2 + random() * 0.3;
      const radius = size * (2.2 + random() * 0.8);
      const h = size * (0.12 + random() * 0.18);
      const w = size * (0.35 + random() * 0.3);
      euler.set(0, random() * Math.PI, 0);
      quaternion.setFromEuler(euler);
      position.set(cx + Math.cos(angle) * radius, h / 2 - 0.1, cz + Math.sin(angle) * radius);
      scale.set(w, h, w);
      matrix.compose(position, quaternion, scale);
      hillMesh.setMatrixAt(i, matrix);
    }
    this.add(hillMesh);
  }

  private buildRunners(options: SceneOptions): void {
    for (const entrant of options.entrants) {
      const rig = buildAnimal(options.species, laneColor(entrant.lane));
      rig.root.traverse((object) => {
        object.castShadow = true;
      });
      this.add(rig.root);
      const label = document.createElement('div');
      label.className = 'vlabel';
      const num = document.createElement('span');
      num.className = 'vlabel-num';
      num.textContent = String(entrant.lane);
      num.style.background = laneColor(entrant.lane);
      num.style.color = laneText(entrant.lane);
      const tag = document.createElement('span');
      tag.className = 'vlabel-tag';
      tag.style.display = 'none';
      label.append(num, tag);
      this.labelLayer.appendChild(label);
      this.runners.set(entrant.id, { id: entrant.id, lane: entrant.lane, rig, label, tag, tagText: '', world: new THREE.Vector3() });
    }
  }

  private updateRunner(runner: Runner, entrant: FrameEntrant, dt: number): void {
    const s = entrant.dist + coast(entrant.finishedForMs, entrant.finishSpeed);
    const lateral = this.track.laneOffset(entrant.lane);
    const f = this.track.frame(s);
    const x = f.x + f.nx * lateral;
    const z = f.z + f.nz * lateral;
    runner.rig.root.position.set(x, f.y + 0.04, z);
    runner.rig.root.rotation.y = Math.atan2(f.tx, f.tz);
    runner.world.set(x, f.y, z);
    const speed = entrant.state === 'FINISHED' ? Math.max(0, entrant.finishSpeed * (1 - Math.min(1, (entrant.finishedForMs ?? 0) / 6000))) + 2 : entrant.speed;
    animateRig(runner.rig, entrant.state, speed, dt, this.elapsed);
    const tag =
      entrant.state === 'SPRINTING' ? 'SPRINT' : entrant.state === 'TIRED' ? 'TIRED' : entrant.state === 'STUMBLED' ? 'STUMBLE' : entrant.state === 'DNF' ? 'DNF' : entrant.state === 'FINISHED' ? `#${entrant.pos}` : '';
    if (tag !== runner.tagText) {
      runner.tagText = tag;
      runner.tag.textContent = tag;
      runner.tag.dataset.state = entrant.state;
      runner.tag.style.display = tag ? '' : 'none';
    }
  }

  private focusPoint(frame: Frame | null, out: THREE.Vector3): { tx: number; tz: number; nx: number; nz: number } {
    const active = frame?.entrants.filter((e) => e.state !== 'DNF') ?? [];
    const moving = active.some((e) => e.speed > 0.5 || e.dist > 1);
    if (!frame || !active.length || !moving) {
      const midLane = (this.track.lanes + 1) / 2;
      const f = this.track.frame(4);
      out.set(f.x + f.nx * this.track.laneOffset(midLane), f.y, f.z + f.nz * this.track.laneOffset(midLane));
      return f;
    }
    const sorted = [...active].sort((a, b) => a.pos - b.pos);
    const leader = sorted.find((e) => e.state !== 'FINISHED') ?? sorted[0]!;
    const runner = this.runners.get(leader.id);
    const s = leader.dist + coast(leader.finishedForMs, leader.finishSpeed);
    const f = this.track.frame(s);
    if (runner) out.copy(runner.world);
    else out.set(f.x, f.y, f.z);
    return f;
  }

  private updateCamera(frame: Frame | null, dt: number): void {
    if (this.mode === 'overview') {
      this.controls.update();
      return;
    }
    const focus = new THREE.Vector3();
    const f = this.focusPoint(frame, focus);
    const tangent = new THREE.Vector3(f.tx, 0, f.tz);
    const normal = new THREE.Vector3(f.nx, 0, f.nz);
    const desiredPos = new THREE.Vector3();
    const desiredTarget = new THREE.Vector3();
    const tall = this.species === 'GIRAFFE' ? 1.6 : 1;
    if (this.mode === 'follow') {
      desiredPos.copy(focus).addScaledVector(tangent, -15 * tall).addScaledVector(normal, 6).addScaledVector(UP, 6.5 * tall);
      desiredTarget.copy(focus).addScaledVector(tangent, 9).addScaledVector(UP, 1.5 * tall);
      this.camera.fov = 55;
    } else {
      desiredPos.copy(focus).addScaledVector(normal, -26).addScaledVector(UP, 7 * tall).addScaledVector(tangent, 4);
      desiredTarget.copy(focus).addScaledVector(normal, 2).addScaledVector(UP, 1.4 * tall).addScaledVector(tangent, 2);
      this.camera.fov = 38;
    }
    if (this.snapCamera) {
      this.camPos.copy(desiredPos);
      this.camTarget.copy(desiredTarget);
      this.snapCamera = false;
    } else {
      this.camPos.lerp(desiredPos, 1 - Math.exp(-dt * 2.8));
      this.camTarget.lerp(desiredTarget, 1 - Math.exp(-dt * 4));
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.camera.updateProjectionMatrix();
    this.sun.position.copy(focus).add(new THREE.Vector3(60, 110, 40));
    this.sun.target.position.copy(focus);
  }

  private updateLabels(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const v = new THREE.Vector3();
    for (const runner of this.runners.values()) {
      v.copy(runner.world);
      v.y += runner.rig.height + 0.5;
      v.project(this.camera);
      if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) {
        runner.label.style.display = 'none';
        continue;
      }
      runner.label.style.display = '';
      const x = ((v.x + 1) / 2) * width;
      const y = ((1 - v.y) / 2) * height;
      runner.label.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      runner.label.style.zIndex = String(Math.round((1 - v.z) * 10000));
    }
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.elapsed += dt;
    const frame = this.source?.frame(now) ?? null;
    if (frame) {
      for (const entrant of frame.entrants) {
        const runner = this.runners.get(entrant.id);
        if (runner) this.updateRunner(runner, entrant, dt);
      }
    }
    if (this.mode === 'overview') {
      const focus = new THREE.Vector3();
      this.focusPoint(frame, focus);
      this.sun.position.copy(focus).add(new THREE.Vector3(60, 110, 40));
      this.sun.target.position.copy(focus);
    }
    this.updateCamera(frame, dt);
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.onFrame?.(frame);
  };
}
