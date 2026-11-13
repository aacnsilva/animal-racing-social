import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { laneColor, laneText, surfaceColors, TrackPath } from '../lib/track';
import type { Segment, Species } from '../lib/types';
import { buildAnimal, type AnimalRig } from './animals';
import { bakeAtmosphere, sunSprite, type Atmosphere } from './atmosphere';
import { rng } from './geometry';
import { Particles, PARTICLE_STYLES } from './particles';
import type { Frame, FrameEntrant, FrameSource } from './playback';
import { Pipeline, softwareRendered } from './post';
import { buildLandVenue, type LandVenue } from './terrain';
import { buildWaterVenue, waterTheme } from './water';

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
  lean: number;
  pitch: number;
  emit: number;
  jitter: number;
};

const UP = new THREE.Vector3(0, 1, 0);
const AHEAD = { x: 0, y: 0, z: 0, tx: 1, tz: 0, nx: 0, nz: 1 };

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

function bannerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#10161a';
  ctx.fillRect(0, 0, 1024, 64);
  for (const start of [0, 832]) {
    for (let x = 0; x < 12; x += 1) {
      for (let y = 0; y < 4; y += 1) {
        ctx.fillStyle = (x + y) % 2 ? '#10161a' : '#f6f4ec';
        ctx.fillRect(start + x * 16, y * 16, 16, 16);
      }
    }
  }
  ctx.fillStyle = '#f6f4ec';
  ctx.font = '800 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('F I N I S H', 512, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
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
  private focusId: string | null = null;
  private raf = 0;
  private pending: THREE.Object3D[] = [];
  private batch = 1;
  private previous = 0;
  private rested = 0;
  private timer = 0;
  private lastTime = 0;
  private elapsed = 0;
  private resizeObserver: ResizeObserver;
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private snapCamera = true;
  private sun: THREE.DirectionalLight;
  private sunOffset = new THREE.Vector3(60, 110, 40);
  private atmosphere: Atmosphere;
  private pipeline: Pipeline;
  private land: LandVenue | null = null;
  private sunDisc: THREE.Sprite | null = null;
  private particles: Particles;
  private aquatic: boolean;
  private species: Species;
  private disposables: { dispose: () => void }[] = [];
  private animateWater: ((time: number) => void) | null = null;
  private patchWater: (<T extends THREE.Material>(material: T, caustics?: number) => T) | null = null;
  onFrame: ((frame: Frame | null) => void) | null = null;

  constructor(container: HTMLElement, options: SceneOptions) {
    this.container = container;
    this.species = options.species;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
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
    this.renderer.domElement.style.touchAction = 'pan-y';

    this.aquatic = waterTheme(options.surface) !== null;
    let facing: number | null = null;
    if (!this.aquatic) {
      const straights = this.track.ranges.filter((range) => range.type !== 'CURVE');
      const longest = straights.toSorted((x, y) => y.end - y.start - (x.end - x.start))[0];
      if (longest) {
        const f = this.track.frame((longest.start + longest.end) / 2);
        facing = Math.atan2(-f.nx, -f.nz) + 0.7;
      }
    }
    const software = softwareRendered(this.renderer);
    this.atmosphere = bakeAtmosphere(this.renderer, options.surface, options.venueId.length, facing, software);
    const look = this.atmosphere.look;
    this.renderer.toneMappingExposure = look.exposure;
    this.sun = new THREE.DirectionalLight(look.sunColor, look.sunIntensity);
    this.sunOffset.copy(this.atmosphere.sunDirection).multiplyScalar(170);
    this.particles = new Particles(PARTICLE_STYLES[this.aquatic ? 'WATER' : options.surface] ?? PARTICLE_STYLES.GRASS);
    if (!this.aquatic) {
      this.particles.setLight(
        new THREE.Color(look.sunColor).multiplyScalar(look.sunIntensity / Math.PI + 0.3 * look.ambient),
      );
    }
    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, software);
    this.buildEnvironment(options);
    this.buildRunners(options);
    this.scene.add(this.particles.points);
    this.pipeline.onTier = () => this.applyTier();
    this.applyTier();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.scene.traverse((object) => {
      if (
        object.visible &&
        (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite)
      ) {
        object.visible = false;
        this.pending.push(object);
      }
    });
    this.pending.reverse();
    this.lastTime = performance.now();
    this.previous = this.lastTime;
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
    this.renderer.domElement.style.touchAction = mode === 'overview' ? 'none' : 'pan-y';
    if (mode === 'overview') {
      const size = this.track.size;
      this.camera.fov = 50;
      this.camera.position.set(this.track.centerX + size * 0.05, size * 0.5, this.track.centerZ + size * 0.62);
      this.controls.target.set(this.track.centerX, 0, this.track.centerZ);
      this.camera.updateProjectionMatrix();
      this.controls.update();
    }
  }

  setFocus(id: string | null): void {
    const next = id && this.runners.has(id) ? id : null;
    if (next === this.focusId) return;
    this.runners.get(this.focusId ?? '')?.label.classList.remove('focused');
    this.focusId = next;
    if (next) this.runners.get(next)?.label.classList.add('focused');
  }

  resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.pipeline.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.timer);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.traverse((object) => {
      if ('geometry' in object && object.geometry instanceof THREE.BufferGeometry) object.geometry.dispose();
      const material: unknown = 'material' in object ? object.material : undefined;
      if (Array.isArray(material)) {
        for (const m of material) if (m instanceof THREE.Material) m.dispose();
      } else if (material instanceof THREE.Material) material.dispose();
    });
    for (const item of this.disposables) item.dispose();
    this.pipeline.dispose();
    this.atmosphere.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }

  private applyTier(): void {
    const tier = this.pipeline.tier;
    this.land?.setDetail(tier.detail);
    this.sun.castShadow = tier.shadow > 0;
    this.renderer.shadowMap.enabled = tier.shadow > 0;
    if (tier.shadow > 0 && this.sun.shadow.mapSize.x !== tier.shadow) {
      this.sun.shadow.mapSize.set(tier.shadow, tier.shadow);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  private soak(object: THREE.Object3D): void {
    const patch = this.patchWater;
    if (!patch) return;
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const material: unknown = child.material;
      for (const item of Array.isArray(material) ? material : [material]) {
        if (item instanceof THREE.MeshStandardMaterial) patch(item);
      }
    });
  }

  private add<T extends THREE.Object3D>(object: T): T {
    this.scene.add(object);
    return object;
  }

  private buildEnvironment(options: SceneOptions): void {
    const colors = surfaceColors(options.surface);
    const track = this.track;
    const size = track.size;
    const random = rng(options.venueId);

    const theme = waterTheme(options.surface);
    const look = this.atmosphere.look;
    this.scene.background = this.atmosphere.background;
    this.scene.backgroundIntensity = look.skyGain * this.atmosphere.gain;
    this.scene.environment = this.atmosphere.environment;
    this.scene.environmentIntensity = look.ambient * this.atmosphere.gain;

    this.add(new THREE.HemisphereLight(colors.sky, colors.ground, 0.18));
    this.sun.castShadow = true;
    const shadowCam = this.sun.shadow.camera;
    shadowCam.left = -34;
    shadowCam.right = 34;
    shadowCam.top = 34;
    shadowCam.bottom = -34;
    shadowCam.near = 1;
    shadowCam.far = 380;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.radius = 2.5;
    this.add(this.sun);
    this.add(this.sun.target);

    if (theme) {
      const water = buildWaterVenue(theme, track, random, colors);
      this.add(water.group);
      this.disposables.push(...water.textures);
      this.animateWater = water.animate;
      this.patchWater = water.patchMaterial;
      water.setSun(this.atmosphere.sunDirection);
      const air = water.fog.air;
      this.scene.fog = new THREE.Fog(air.color, air.near, air.far);
      if (water.indoor) {
        this.scene.background = new THREE.Color(water.background.air ?? '#05080b');
        this.scene.backgroundIntensity = 1;
      }
    } else {
      this.scene.fog = new THREE.FogExp2(this.atmosphere.haze, (0.42 * look.haze) / (size * 2.6));
      this.land = buildLandVenue(track, options.surface, random, options.venueId);
      this.add(this.land.group);
      this.sunDisc = this.add(sunSprite(this.atmosphere));
      const map = this.sunDisc.material.map;
      if (map) this.disposables.push(map);
    }

    const checker = checkerTexture();
    const banner = bannerTexture();
    this.disposables.push(checker, banner);
    const finishGeometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    const steps = 12;
    for (let i = 0; i <= steps; i += 1) {
      const lateral = track.innerOffset() + ((track.outerOffset() - track.innerOffset()) * i) / steps;
      const back = track.point(-0.7, lateral);
      positions.push(back.x, back.y + 0.075, back.z);
      const front = track.point(0.7, lateral);
      positions.push(front.x, front.y + 0.075, front.z);
      uvs.push(i / steps, 0, i / steps, 1);
      if (i > 0) {
        const base = (i - 1) * 2;
        index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
    finishGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    finishGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    finishGeometry.setIndex(index);
    finishGeometry.computeVertexNormals();
    const finish = new THREE.Mesh(
      finishGeometry,
      new THREE.MeshStandardMaterial({
        map: checker,
        roughness: 0.85,
        side: THREE.DoubleSide,
        transparent: theme !== null,
        opacity: theme ? 0.85 : 1,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    finish.receiveShadow = true;
    this.add(finish);

    const steel = new THREE.MeshStandardMaterial({ color: '#d9dde0', roughness: 0.35, metalness: 0.85 });
    const inner = track.point(0, track.innerOffset() - 1.3);
    const outer = track.point(0, track.outerOffset() + 1.3);
    const top = Math.max(inner.y, outer.y) + 7.4;
    for (const p of [inner, outer]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, top - p.y + 0.6, 12), steel);
      post.position.set(p.x, (top + p.y + 0.6) / 2 - 0.3, p.z);
      post.castShadow = true;
      this.add(post);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.3, 14), steel);
      foot.position.set(p.x, p.y + 0.15, p.z);
      this.add(foot);
    }
    const span = Math.hypot(outer.x - inner.x, outer.z - inner.z);
    const yaw = Math.atan2(-(outer.z - inner.z), outer.x - inner.x);
    const middle = new THREE.Vector3((inner.x + outer.x) / 2, top, (inner.z + outer.z) / 2);
    for (const offset of [0.55, -0.55]) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, span + 0.6, 8), steel);
      beam.position.copy(middle).setY(top + offset);
      beam.rotation.set(0, yaw, Math.PI / 2);
      beam.castShadow = true;
      this.add(beam);
    }
    const face = new THREE.MeshStandardMaterial({
      map: banner,
      roughness: 0.6,
      emissive: '#ffffff',
      emissiveMap: banner,
      emissiveIntensity: theme ? 0.5 : 0.12,
    });
    const dark = new THREE.MeshStandardMaterial({ color: '#12181c', roughness: 0.6 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(span - 0.4, 0.95, 0.14), [dark, dark, dark, dark, face, face]);
    board.position.copy(middle);
    board.rotation.y = yaw;
    board.castShadow = true;
    this.add(board);
    for (const item of [steel, dark, face]) this.patchWater?.(item);
  }

  private buildRunners(options: SceneOptions): void {
    for (const entrant of options.entrants) {
      const rig = buildAnimal(options.species, laneColor(entrant.lane));
      rig.root.rotation.order = 'YXZ';
      this.soak(rig.root);
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
      this.runners.set(entrant.id, {
        id: entrant.id,
        lane: entrant.lane,
        rig,
        label,
        tag,
        tagText: '',
        world: new THREE.Vector3(),
        lean: 0,
        pitch: 0,
        emit: 0,
        jitter: (entrant.lane * 0.618) % 1,
      });
    }
  }

  private updateRunner(runner: Runner, entrant: FrameEntrant, dt: number): void {
    const s = entrant.dist + coast(entrant.finishedForMs, entrant.finishSpeed);
    const lateral = this.track.laneOffset(entrant.lane);
    const f = this.track.frame(s);
    const x = f.x + f.nx * lateral;
    const z = f.z + f.nz * lateral;
    const span = 1.6;
    const ahead = this.track.frame(s + span, AHEAD);
    const heading = Math.atan2(f.tx, f.tz);
    let turn = Math.atan2(ahead.tx, ahead.tz) - heading;
    if (turn > Math.PI) turn -= Math.PI * 2;
    if (turn < -Math.PI) turn += Math.PI * 2;
    const speed =
      entrant.state === 'FINISHED'
        ? Math.max(0, entrant.finishSpeed * (1 - Math.min(1, (entrant.finishedForMs ?? 0) / 6000))) + 2
        : entrant.speed;
    const moving = entrant.state === 'DNF' ? 0 : speed;
    const leanTarget = Math.max(
      -0.3,
      Math.min(0.3, ((-turn / span) * moving * moving * (this.aquatic ? 0.9 : 0.42)) / 9.81),
    );
    const pitchTarget = -Math.atan2(ahead.y - f.y, span);
    const ease = 1 - Math.exp(-dt * 5);
    runner.lean += (leanTarget - runner.lean) * ease;
    runner.pitch += (pitchTarget - runner.pitch) * ease;
    runner.rig.root.position.set(x, f.y + 0.04, z);
    runner.rig.root.rotation.set(runner.pitch, heading, runner.lean);
    runner.world.set(x, f.y, z);
    runner.rig.update(entrant.state, speed, dt, this.elapsed);
    const style = this.particles.style;
    if (moving > 3 && dt > 0) {
      runner.emit += dt * moving * style.rate * (entrant.state === 'SPRINTING' ? 1.5 : 1);
      while (runner.emit >= 1) {
        runner.emit -= 1;
        runner.jitter = (runner.jitter * 7.13 + 0.31) % 1;
        const a = runner.jitter;
        const b = (a * 5.7 + 0.13) % 1;
        const c = (b * 3.9 + 0.57) % 1;
        const back = 0.2 + a * 1.3;
        const sideways = (b - 0.5) * 0.7;
        const drift = -moving * (this.aquatic ? 0.02 : 0.12) * c;
        this.particles.emit(
          x - f.tx * back + f.nx * sideways,
          f.y + (this.aquatic ? 0.7 + c * 0.9 : 0.06),
          z - f.tz * back + f.nz * sideways,
          f.tx * drift + f.nx * (b - 0.5) * style.spread,
          style.lift * (0.4 + a * 0.8),
          f.tz * drift + f.nz * (b - 0.5) * style.spread,
          this.elapsed,
          0.6 + c * 0.8,
        );
      }
    }
    const tag =
      entrant.state === 'SPRINTING'
        ? 'SPRINT'
        : entrant.state === 'TIRED'
          ? 'TIRED'
          : entrant.state === 'STUMBLED'
            ? 'STUMBLE'
            : entrant.state === 'DNF'
              ? 'DNF'
              : entrant.state === 'FINISHED'
                ? `#${entrant.pos}`
                : '';
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
    const focused = this.focusId ? frame.entrants.find((e) => e.id === this.focusId) : undefined;
    const sorted = active.toSorted((a, b) => a.pos - b.pos);
    const leader = focused ?? sorted.find((e) => e.state !== 'FINISHED') ?? sorted[0];
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
    const tall = this.species === 'GIRAFFE' ? 1.6 : this.species === 'OCTOPUS' ? 1.15 : 1;
    if (this.mode === 'follow') {
      desiredPos
        .copy(focus)
        .addScaledVector(tangent, -13.5 * tall)
        .addScaledVector(normal, 6)
        .addScaledVector(UP, 5.8 * tall);
      desiredTarget
        .copy(focus)
        .addScaledVector(tangent, 9)
        .addScaledVector(UP, 1.5 * tall);
      this.camera.fov = 55;
    } else {
      desiredPos
        .copy(focus)
        .addScaledVector(normal, -26)
        .addScaledVector(UP, 7 * tall)
        .addScaledVector(tangent, 4);
      desiredTarget
        .copy(focus)
        .addScaledVector(normal, 2)
        .addScaledVector(UP, 1.4 * tall)
        .addScaledVector(tangent, 2);
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
    this.aimSun(focus);
  }

  private aimSun(focus: THREE.Vector3): void {
    const snap = 0.5;
    const x = Math.round(focus.x / snap) * snap;
    const z = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(x, focus.y, z);
    this.sun.position.set(x, focus.y, z).add(this.sunOffset);
  }

  private updateLabels(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const v = new THREE.Vector3();
    for (const runner of this.runners.values()) {
      v.copy(runner.world);
      v.y += runner.rig.height + 0.3;
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
    const began = performance.now();
    if (this.pending.length) {
      for (let i = 0; i < this.batch && this.pending.length; i += 1) {
        const next = this.pending.pop();
        if (next) next.visible = true;
      }
    }
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.elapsed += dt;
    this.animateWater?.(this.elapsed);
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
      this.aimSun(focus);
    }
    this.updateCamera(frame, dt);
    this.land?.update(this.elapsed);
    this.sunDisc?.position.copy(this.camera.position).addScaledVector(this.atmosphere.sunDirection, 1500);
    this.particles.setViewport(this.renderer.domElement.height, this.camera.fov);
    this.particles.update(this.elapsed);
    this.pipeline.render(dt);
    this.updateLabels();
    this.onFrame?.(frame);
    const wall = began - this.previous - this.rested;
    this.previous = began;
    const cost = Math.max(performance.now() - began, Math.min(2000, wall) - 17);
    this.batch = cost < 16 ? Math.min(64, this.batch * 2) : Math.max(1, this.batch >> 1);
    if (cost > 34) {
      this.rested = Math.min(500, cost * 1.5);
      this.timer = window.setTimeout(() => {
        this.raf = requestAnimationFrame(this.loop);
      }, this.rested);
    } else {
      this.rested = 0;
      this.raf = requestAnimationFrame(this.loop);
    }
  };
}
