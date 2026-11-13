import * as THREE from 'three';
import type { Species } from '../lib/types';
import { buildAnimal, type AnimalRig } from '../race/animals';
import { bakeAtmosphere, type Atmosphere } from '../race/atmosphere';
import { PARTICLE_STYLES, Particles as Dust } from '../race/particles';
import { Pipeline } from '../race/post';
import { Sound } from './audio';
import { botAt, planBot, type BotPlan, type BotState } from './bots';
import { Particles } from './fx';
import { Input, isTouchDevice } from './input';
import { createBody, PAD_TIME, STEP, stepBody, type Body, type Controls } from './physics';
import type { WorldSample } from './protocol';
import { ANIMALS, fmtRaceTime, gridPosition, ordinal, SLOT_COLORS, type GridEntry } from './roster';
import { loadTrack, type Pose, type Track } from './tracks';
import { buildWorld, type World } from './world';

export type RaceSetup = {
  trackId: string;
  laps: number;
  seed: number;
  grid: GridEntry[];
  meSlot: number;
  countdownMs: number;
  startAt: number | null;
  serverNow: (() => number) | null;
  sendSample: ((sample: [number, number, number, number, number, number]) => void) | null;
};

export type ResultRow = {
  slot: number;
  name: string;
  species: Species;
  bot: boolean;
  me: boolean;
  finishMs: number | null;
  place: number;
};

export type FinishSummary = { place: number; timeMs: number; bestLapMs: number | null; total: number };

export type GameEvents = {
  onFinish: (summary: FinishSummary) => void;
};

type Net = {
  has: number;
  t0: number;
  x0: number;
  z0: number;
  h0: number;
  p0: number;
  t1: number;
  x1: number;
  z1: number;
  h1: number;
  v1: number;
  p1: number;
  flags: number;
};

type Racer = {
  entry: GridEntry;
  kind: 'me' | 'bot' | 'remote';
  rig: AnimalRig;
  color: string;
  x: number;
  z: number;
  heading: number;
  speed: number;
  progress: number;
  boosting: boolean;
  finishMs: number | null;
  plan: BotPlan | null;
  net: Net | null;
  label: THREE.Sprite | null;
  emit: number;
  dustAt: number;
  place: number;
};

const INTERP_DELAY_MS = 150;
const SEND_MS = 80;
const pose: Pose = { x: 0, z: 0, heading: 0, tx: 0, tz: 0, nx: 0, nz: 0 };
const botState: BotState = { s: 0, lat: 0, speed: 0, boosting: false };

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function labelSprite(name: string, color: string): { sprite: THREE.Sprite; dispose: () => void } {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '700 30px system-ui, sans-serif';
  const text = name.length > 14 ? `${name.slice(0, 13)}…` : name;
  const width = Math.min(248, ctx.measureText(text).width + 44);
  const left = (256 - width) / 2;
  ctx.fillStyle = 'rgba(8, 14, 12, 0.72)';
  ctx.beginPath();
  ctx.roundRect(left, 8, width, 48, 24);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(left + 22, 32, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + 36, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.4, 0.85, 1);
  sprite.renderOrder = 6;
  return {
    sprite,
    dispose: () => {
      texture.dispose();
      material.dispose();
    },
  };
}

export class Game {
  readonly sound = new Sound();
  private root: HTMLElement;
  private setup: RaceSetup;
  private events: GameEvents;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.3, 3200);
  private track: Track;
  private world: World;
  private particles = new Particles();
  private input: Input;
  private racers: Racer[] = [];
  private me: Racer;
  private body: Body;
  private stats;
  private distance: number;
  private raf = 0;
  private last = 0;
  private elapsed = 0;
  private localClock: number;
  private accumulator = 0;
  private paused = false;
  private disposed = false;
  private atmosphere: Atmosphere;
  private pipeline: Pipeline;
  private dust: Dust;
  private focus = new THREE.Vector3();
  private camHeading = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camReady = false;
  private fovKick = 0;
  private shake = 0;
  private lap = 1;
  private lapStart = 0;
  private bestLap: number | null = null;
  private finishedAt: number | null = null;
  private countShown = '';
  private presses: number[] = [];
  private launched = false;
  private messageUntil = 0;
  private lastSend = 0;
  private lastStride = 0;
  private gait = 0;
  private wasBoosting = false;
  private bumpCooldown = 0;
  private hudFrame = 0;
  private hud: Record<string, HTMLElement | null> = {};
  private rows: HTMLElement[] = [];
  private minimap: {
    canvas: HTMLCanvasElement;
    path: HTMLCanvasElement;
    scale: number;
    ox: number;
    oz: number;
  } | null = null;
  private resizeObserver: ResizeObserver;
  private disposables: (() => void)[] = [];
  private aquatic: boolean;

  constructor(root: HTMLElement, setup: RaceSetup, events: GameEvents) {
    this.root = root;
    this.setup = setup;
    this.events = events;
    this.track = loadTrack(setup.trackId);
    this.distance = setup.laps * this.track.length;
    this.aquatic = this.track.def.habitat === 'AQUATIC';
    this.localClock = -setup.countdownMs;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.domElement.className = 'gp-canvas';
    (root.querySelector<HTMLElement>('[data-hud="stage"]') ?? root).append(this.renderer.domElement);
    this.camera.far = Math.max(2000, this.track.path.size * 8);

    const path = this.track.path;
    let facing: number | null = null;
    if (!this.aquatic) {
      const straights = path.ranges.filter((range) => range.type !== 'CURVE');
      const longest = straights.toSorted((a, b) => b.end - b.start - (a.end - a.start))[0];
      if (longest) {
        const frame = path.frame((longest.start + longest.end) / 2);
        facing = Math.atan2(-frame.nx, -frame.nz) + 0.7;
      }
    }
    this.atmosphere = bakeAtmosphere(this.renderer, this.track.def.surface, this.track.def.id.length, facing);
    const look = this.atmosphere.look;
    this.renderer.toneMappingExposure = look.exposure;
    this.dust = new Dust(PARTICLE_STYLES[this.aquatic ? 'WATER' : this.track.def.surface] ?? PARTICLE_STYLES.GRASS);
    if (!this.aquatic)
      this.dust.setLight(
        new THREE.Color(look.sunColor).multiplyScalar(look.sunIntensity / Math.PI + 0.3 * look.ambient),
      );
    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera);
    this.world = buildWorld(this.scene, this.track, this.atmosphere);
    this.scene.add(this.dust.points, this.particles.points);
    this.pipeline.onTier = (tier) => this.world.setDetail(tier.detail, tier.shadow);
    this.world.setDetail(this.pipeline.tier.detail, this.pipeline.tier.shadow);

    for (const entry of setup.grid) this.racers.push(this.spawn(entry));
    this.me = this.racers.find((racer) => racer.kind === 'me') ?? this.racers[0];
    this.stats = ANIMALS[this.me.entry.species];
    const grid = gridPosition(this.me.entry.slot);
    this.body = createBody(this.track, grid.s, grid.lat);
    this.camHeading = this.body.heading;

    this.input = new Input(root, isTouchDevice());
    for (const name of [
      'pos',
      'total',
      'lap',
      'time',
      'speed',
      'stamina',
      'message',
      'wrong',
      'streaks',
      'draft',
      'board',
    ])
      this.hud[name] = root.querySelector<HTMLElement>(`[data-hud="${name}"]`);
    this.buildBoard();
    this.buildMinimap();
    if (this.hud.total) this.hud.total.textContent = `/${this.racers.length}`;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(root);
    this.resize();
    if (import.meta.env.DEV) Object.assign(window, { __gp: this });
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private spawn(entry: GridEntry): Racer {
    const color = SLOT_COLORS[entry.slot % SLOT_COLORS.length];
    const rig = buildAnimal(entry.species, color);
    const kind = entry.slot === this.setup.meSlot ? 'me' : entry.id === null ? 'bot' : 'remote';
    const grid = gridPosition(entry.slot);
    this.track.pose(grid.s, grid.lat, pose);
    rig.root.rotation.order = 'YXZ';
    rig.root.position.set(pose.x, 0.04, pose.z);
    rig.root.rotation.y = pose.heading;
    if (ANIMALS[entry.species].habitat === 'AQUATIC') this.world.soak(rig.root);
    this.scene.add(rig.root);

    const native = ANIMALS[entry.species].habitat === this.track.def.habitat;
    if (!native) {
      const material = new THREE.MeshPhysicalMaterial({
        color: '#eafaff',
        transparent: true,
        opacity: 0.1,
        roughness: 0.02,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        envMapIntensity: 1.6,
        depthWrite: false,
      });

      const geometry = new THREE.SphereGeometry(1, 32, 20);
      const bubble = new THREE.Mesh(geometry, material);
      const tall = Math.max(1.5, rig.height * 0.62);
      bubble.scale.set(1.25, tall, tall > 2.4 ? 1.7 : 2.1);
      bubble.position.y = tall * 0.92;
      rig.root.add(bubble);
      this.disposables.push(() => {
        geometry.dispose();
        material.dispose();
      });
    }

    let label: THREE.Sprite | null = null;
    if (kind !== 'me') {
      const made = labelSprite(entry.name, color);
      label = made.sprite;
      label.position.y = rig.height + 0.7;
      rig.root.add(label);
      this.disposables.push(made.dispose);
    }
    return {
      entry,
      kind,
      rig,
      color,
      x: pose.x,
      z: pose.z,
      heading: pose.heading,
      speed: 0,
      progress: grid.s,
      boosting: false,
      finishMs: null,
      plan: kind === 'bot' ? planBot(this.track, this.setup.laps, this.setup.seed, entry) : null,
      net:
        kind === 'remote'
          ? { has: 0, t0: 0, x0: 0, z0: 0, h0: 0, p0: 0, t1: 0, x1: 0, z1: 0, h1: 0, v1: 0, p1: 0, flags: 0 }
          : null,
      label,
      emit: 0,
      dustAt: 0,
      place: entry.slot + 1,
    };
  }

  private buildBoard(): void {
    const board = this.hud.board;
    if (!board) return;
    board.textContent = '';
    for (let i = 0; i < this.racers.length; i++) {
      const row = document.createElement('div');
      row.className = 'gp-board-row';
      const place = document.createElement('b');
      const dot = document.createElement('i');
      const name = document.createElement('span');
      row.append(place, dot, name);
      board.append(row);
      this.rows.push(row);
    }
  }

  private buildMinimap(): void {
    const canvas = this.root.querySelector<HTMLCanvasElement>('canvas[data-hud="minimap"]');
    if (!canvas) return;
    const size = 220;
    canvas.width = canvas.height = size;
    const track = this.track;
    const w = track.maxX - track.minX;
    const h = track.maxZ - track.minZ;
    const scale = (size - 28) / Math.max(w, h);
    const ox = (size - w * scale) / 2 - track.minX * scale;
    const oz = (size - h * scale) / 2 - track.minZ * scale;
    const path = document.createElement('canvas');
    path.width = path.height = size;
    const ctx = path.getContext('2d')!;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const trace = () => {
      ctx.beginPath();
      for (let i = 0; i <= track.n; i += 3) {
        const j = i % track.n;
        const x = ox + track.px[j] * scale;
        const y = size - (oz + track.pz[j] * scale);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    trace();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 13;
    ctx.stroke();
    trace();
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.fillStyle = this.track.def.card.accent;
    ctx.fillRect(ox + track.px[0] * scale - 2, size - (oz + track.pz[0] * scale) - 8, 4, 16);
    this.minimap = { canvas, path, scale, ox, oz };
  }

  private resize(): void {
    const width = Math.max(1, this.root.clientWidth);
    const height = Math.max(1, this.root.clientHeight);
    this.pipeline.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  clock(): number {
    const { startAt, serverNow } = this.setup;
    if (startAt !== null && serverNow) return serverNow() - startAt;
    return this.localClock;
  }

  setPaused(paused: boolean): void {
    if (this.setup.startAt !== null) return;
    this.paused = paused;
  }

  applyWorld(serverTime: number, list: WorldSample[]): void {
    for (const sample of list) {
      const racer = this.racers.find((entry) => entry.entry.slot === sample[0]);
      const net = racer?.net;
      if (!net) continue;
      net.t0 = net.t1;
      net.x0 = net.x1;
      net.z0 = net.z1;
      net.h0 = net.h1;
      net.p0 = net.p1;
      net.t1 = serverTime;
      net.x1 = sample[1];
      net.z1 = sample[2];
      net.h1 = sample[3];
      net.v1 = sample[4];
      net.p1 = sample[5];
      net.flags = sample[6];
      net.has = Math.min(2, net.has + 1);
    }
  }

  setRemoteFinish(slot: number, finishMs: number | null): void {
    const racer = this.racers.find((entry) => entry.entry.slot === slot);
    if (racer && racer.kind === 'remote' && finishMs !== null) racer.finishMs = finishMs;
  }

  standings(final = false): ResultRow[] {
    const clock = this.clock();
    const rows = this.racers.map((racer) => {
      let finishMs = racer.finishMs;
      if (
        finishMs === null &&
        racer.plan &&
        (final || racer.plan.finishMs <= clock) &&
        Number.isFinite(racer.plan.finishMs)
      )
        finishMs = racer.plan.finishMs;
      return { racer, finishMs };
    });
    rows.sort((a, b) => {
      if (a.finishMs !== null && b.finishMs !== null) return a.finishMs - b.finishMs;
      if (a.finishMs !== null) return -1;
      if (b.finishMs !== null) return 1;
      return b.racer.progress - a.racer.progress;
    });
    return rows.map(({ racer, finishMs }, index) => ({
      slot: racer.entry.slot,
      name: racer.entry.name,
      species: racer.entry.species,
      bot: racer.kind === 'bot',
      me: racer.kind === 'me',
      finishMs,
      place: index + 1,
    }));
  }

  private say(text: string, seconds: number, tone = ''): void {
    const element = this.hud.message;
    if (!element) return;
    element.textContent = text;
    element.dataset.tone = tone;
    element.classList.remove('show');
    void element.offsetWidth;
    element.classList.add('show');
    this.messageUntil = this.elapsed + seconds;
  }

  private autopilot(controls: Controls): void {
    const body = this.body;
    this.track.pose(body.progress + 12 + body.speed * 0.5, 0, pose);
    let diff = Math.atan2(pose.x - body.x, pose.z - body.z) - body.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    controls.steer = Math.max(-1, Math.min(1, diff * 3));
    controls.throttle = body.speed < this.stats.top * 0.5 ? 1 : 0;
    controls.brake = 0;
    controls.boost = false;
  }

  private interact(clock: number): void {
    const body = this.body;
    const fx = Math.sin(body.heading);
    const fz = Math.cos(body.heading);
    let drafting = false;
    for (const other of this.racers) {
      if (other === this.me) continue;
      const dx = other.x - body.x;
      const dz = other.z - body.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 2.1 && dist > 0.001 && clock > 0) {
        const push = (2.1 - dist) * 0.6;
        body.x -= (dx / dist) * push;
        body.z -= (dz / dist) * push;
        body.speed *= 0.992;
        if (this.bumpCooldown <= 0) {
          this.bumpCooldown = 0.5;
          this.shake = Math.max(this.shake, 0.35);
          this.sound.bump();
          if (navigator.vibrate) navigator.vibrate(30);
        }
      }
      const ahead = dx * fx + dz * fz;
      const aside = Math.abs(dx * fz - dz * fx);
      if (ahead > 2.5 && ahead < 17 && aside < 1.9 && other.speed > 8) drafting = true;
    }
    body.draft = drafting ? Math.min(1, body.draft + STEP * 1.1) : Math.max(0, body.draft - STEP * 2);

    for (const pad of this.world.pads) {
      const dx = body.x - pad.x;
      const dz = body.z - pad.z;
      if (dx * dx + dz * dz < 22 && body.padTime < PAD_TIME - 0.5) {
        body.padTime = PAD_TIME;
        this.sound.pad();
        this.say('BOOST PAD!', 0.9, 'gold');
        this.fovKick = 1;
      }
    }
    for (const treat of this.world.treats) {
      if (this.elapsed < treat.readyAt) continue;
      const dx = body.x - treat.x;
      const dz = body.z - treat.z;
      if (dx * dx + dz * dz < 7.5) {
        treat.readyAt = this.elapsed + 6;
        treat.mesh.visible = false;
        body.stamina = Math.min(1, body.stamina + 0.4);
        this.sound.treat();
        for (let i = 0; i < 14; i++)
          this.particles.emit(
            treat.x,
            1.6,
            treat.z,
            (Math.random() - 0.5) * 8,
            Math.random() * 7,
            (Math.random() - 0.5) * 8,
            '#ffd23f',
            0.5,
            0.7,
            12,
          );
      }
    }
  }

  private simulate(dt: number, clock: number): void {
    const body = this.body;
    const controls = this.input.update(dt);
    if (this.input.boostEdge) {
      this.input.boostEdge = false;
      if (clock < 0) this.presses.push(clock);
      this.sound.unlock();
    }
    if (clock < 0) return;
    if (!this.launched) {
      this.launched = true;
      this.lapStart = 0;
      const recent = this.presses.filter((at) => at > -1500);
      if (recent.length === 1 && recent[0] > -380) {
        body.padTime = 1.5;
        body.speed = this.stats.top * 0.45;
        this.say('PERFECT START!', 1.4, 'gold');
        this.sound.pad();
        this.fovKick = 1;
      }
    }
    if (this.finishedAt !== null) this.autopilot(controls);
    this.accumulator += dt;
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      const before = body.progress;
      stepBody(body, controls, this.stats, this.track, STEP);
      this.interact(clock);
      if (this.finishedAt === null && body.progress >= this.distance) {
        const into = (body.progress - this.distance) / Math.max(0.01, body.progress - before);
        this.finish(Math.max(0, clock - this.accumulator * 1000 - into * STEP * 1000));
      }
    }
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
    if (body.bump > 0.9 && this.bumpCooldown <= 0) {
      this.bumpCooldown = 0.4;
      this.shake = Math.max(this.shake, 0.5);
      this.sound.bump();
      if (navigator.vibrate) navigator.vibrate(40);
    }
    if (body.boosting && !this.wasBoosting) {
      this.sound.boost();
      this.fovKick = Math.max(this.fovKick, 0.7);
    }
    this.wasBoosting = body.boosting;

    const lap = Math.min(this.setup.laps, Math.floor(Math.max(0, body.progress) / this.track.length) + 1);
    if (lap > this.lap && this.finishedAt === null) {
      const lapTime = clock - this.lapStart;
      if (this.bestLap === null || lapTime < this.bestLap) this.bestLap = lapTime;
      this.lapStart = clock;
      this.lap = lap;
      this.sound.lap();
      this.say(
        lap === this.setup.laps ? 'FINAL LAP!' : `LAP ${lap}/${this.setup.laps}`,
        1.6,
        lap === this.setup.laps ? 'hot' : '',
      );
    }
  }

  private finish(timeMs: number): void {
    this.finishedAt = timeMs;
    this.me.finishMs = Math.round(timeMs);
    const lapTime = timeMs - this.lapStart;
    if (this.bestLap === null || lapTime < this.bestLap) this.bestLap = lapTime;
    const rows = this.standings();
    const place = rows.find((row) => row.me)?.place ?? rows.length;
    this.sound.finish(place === 1);
    this.say(place === 1 ? 'YOU WIN!' : `${ordinal(place)} PLACE`, 4, place <= 3 ? 'gold' : '');
    const accent = this.track.def.card.accent;
    for (let i = 0; i < 90; i++)
      this.particles.emit(
        this.body.x + (Math.random() - 0.5) * 10,
        3 + Math.random() * 5,
        this.body.z + (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 9,
        4 + Math.random() * 8,
        (Math.random() - 0.5) * 9,
        [accent, '#ff5d6c', '#3d9bff', '#ffffff', '#3ddc97'][i % 5],
        0.55,
        2.2 + Math.random(),
        9,
      );
    this.events.onFinish({ place, timeMs: Math.round(timeMs), bestLapMs: this.bestLap, total: rows.length });
  }

  private updateOthers(clock: number, dt: number): void {
    const renderTime = this.setup.serverNow ? this.setup.serverNow() - INTERP_DELAY_MS : 0;
    for (const racer of this.racers) {
      if (racer.kind === 'me') {
        racer.x = this.body.x;
        racer.z = this.body.z;
        racer.heading = this.body.heading;
        racer.speed = this.body.speed;
        racer.progress = this.body.progress;
        racer.boosting = this.body.boosting || this.body.padTime > 0;
      } else if (racer.plan) {
        botAt(racer.plan, this.track, Math.max(0, clock) / 1000, botState);
        this.track.pose(botState.s, botState.lat, pose);
        racer.heading = lerpAngle(
          racer.heading,
          Math.atan2(pose.x - racer.x, pose.z - racer.z),
          botState.speed > 1 ? Math.min(1, dt * 8) : 0,
        );
        racer.x = pose.x;
        racer.z = pose.z;
        racer.speed = botState.speed;
        racer.progress = botState.s;
        racer.boosting = botState.boosting;
        if (racer.finishMs === null && clock >= racer.plan.finishMs) racer.finishMs = racer.plan.finishMs;
      } else if (racer.net && racer.net.has > 0) {
        const net = racer.net;
        if (net.has < 2) {
          racer.x = net.x1;
          racer.z = net.z1;
          racer.heading = net.h1;
          racer.progress = net.p1;
        } else {
          const span = Math.max(1, net.t1 - net.t0);
          const t = Math.max(0, Math.min(1.6, (renderTime - net.t0) / span));
          racer.x = net.x0 + (net.x1 - net.x0) * t;
          racer.z = net.z0 + (net.z1 - net.z0) * t;
          racer.heading = lerpAngle(net.h0, net.h1, Math.min(1, t));
          racer.progress = net.p0 + (net.p1 - net.p0) * t;
        }
        racer.speed = renderTime - net.t1 > 1500 ? 0 : net.v1;
        racer.boosting = (net.flags & 1) === 1;
      }
      racer.rig.root.position.set(racer.x, 0.04, racer.z);
      racer.rig.root.rotation.y = racer.heading;
      if (racer.kind === 'me')
        racer.rig.root.rotation.z = -this.input.controls.steer * 0.1 * Math.min(1, racer.speed / 20);
      const done = racer.finishMs !== null && racer.speed < 2;
      racer.rig.update(done ? 'FINISHED' : racer.boosting ? 'SPRINTING' : 'RUNNING', racer.speed, dt, this.elapsed);

      const dx = racer.x - this.camera.position.x;
      const dz = racer.z - this.camera.position.z;
      const near = dx * dx + dz * dz < 80 * 80;
      if (racer.label) {
        racer.label.visible = near;
        const shrink = Math.max(0.3, Math.min(1, Math.sqrt(dx * dx + dz * dz) / 26));
        racer.label.scale.set(3.4 * shrink, 0.85 * shrink, 1);
      }
      const style = this.dust.style;
      if (near && racer.speed > 3) {
        racer.emit += dt * racer.speed * style.rate * (racer.boosting ? 1.6 : 1);
        const fx = Math.sin(racer.heading);
        const fz = Math.cos(racer.heading);
        while (racer.emit >= 1) {
          racer.emit -= 1;
          const a = Math.random();
          const b = Math.random();
          const c = Math.random();
          const back = 0.2 + a * 1.3;
          const sideways = (b - 0.5) * 0.7;
          const drift = -racer.speed * (this.aquatic ? 0.02 : 0.12) * c;
          this.dust.emit(
            racer.x - fx * back + fz * sideways,
            this.aquatic ? 0.7 + c * 0.9 : 0.06,
            racer.z - fz * back - fx * sideways,
            fx * drift + fz * (b - 0.5) * style.spread,
            style.lift * (0.4 + a * 0.8),
            fz * drift - fx * (b - 0.5) * style.spread,
            this.elapsed,
            0.6 + c * 0.8,
          );
        }
      }
      if (near && racer.boosting && this.elapsed >= racer.dustAt) {
        racer.dustAt = this.elapsed + 0.04;
        const bx = racer.x - Math.sin(racer.heading) * 1.2 + (Math.random() - 0.5) * 0.8;
        const bz = racer.z - Math.cos(racer.heading) * 1.2 + (Math.random() - 0.5) * 0.8;
        this.particles.emit(
          bx,
          0.9 + Math.random() * 0.8,
          bz,
          (Math.random() - 0.5) * 3,
          Math.random() * 2,
          (Math.random() - 0.5) * 3,
          Math.random() < 0.5 ? racer.color : '#fff3b0',
          0.22,
          0.4,
          0,
        );
      }
    }
  }

  private updateCamera(clock: number, dt: number): void {
    const body = this.body;
    const ratio = Math.min(1.4, body.speed / this.stats.top);
    const portrait = this.camera.aspect < 1;
    this.camHeading = lerpAngle(this.camHeading, body.travel, Math.min(1, dt * 5.5));
    let angle = this.camHeading;
    let distance = (portrait ? 10 : 7.2) + ratio * 1.5 + this.me.rig.height * 0.4;
    let height = 2.5 + this.me.rig.height * 0.5;
    const countdown = this.setup.countdownMs;
    if (clock < -900) {
      const t = Math.min(1, (-clock - 900) / Math.max(1, countdown - 900));
      angle += Math.PI * 0.95 * t * t * (3 - 2 * t) * (this.me.entry.slot % 2 ? 1 : -1);
      distance += 5 * t;
      height += 2 * t;
    } else if (this.finishedAt !== null) {
      const since = (clock - this.finishedAt) / 1000;
      angle += Math.min(since, 60) * 0.35 + Math.PI * Math.min(1, since / 2.5) * 0.6;
      distance += 2.5;
    }
    const tx = body.x - Math.sin(angle) * distance;
    const tz = body.z - Math.cos(angle) * distance;
    const lookAhead = this.finishedAt !== null || clock < -900 ? 0 : 5 + ratio * 4;
    const lx = body.x + Math.sin(this.camHeading) * lookAhead;
    const lz = body.z + Math.cos(this.camHeading) * lookAhead;
    if (!this.camReady) {
      this.camReady = true;
      this.camPos.set(tx, height, tz);
      this.camLook.set(lx, 2, lz);
    }
    const follow = Math.min(1, dt * 9);
    this.camPos.x += (tx - this.camPos.x) * follow;
    this.camPos.z += (tz - this.camPos.z) * follow;
    this.camPos.y += (height - this.camPos.y) * Math.min(1, dt * 4);
    this.camLook.x += (lx - this.camLook.x) * follow;
    this.camLook.z += (lz - this.camLook.z) * follow;
    this.camLook.y = 1.6 + this.me.rig.height * 0.3;

    this.fovKick = Math.max(0, this.fovKick - dt * 0.9);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const fast = body.boosting || body.padTime > 0 ? 1 : 0;
    const wanted = (portrait ? 78 : 60) + ratio * 7 + Math.max(fast * 9, this.fovKick * 12);
    this.camera.fov += (wanted - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();
    const rumble = this.shake * 0.35 + (body.offroad && body.speed > 6 ? 0.06 : 0) + fast * 0.03;
    this.camera.position.set(
      this.camPos.x + (Math.random() - 0.5) * rumble,
      this.camPos.y + (Math.random() - 0.5) * rumble,
      this.camPos.z + (Math.random() - 0.5) * rumble,
    );
    this.camera.lookAt(this.camLook);
  }

  private updateHud(clock: number): void {
    const body = this.body;
    const hud = this.hud;
    let count = '';
    if (clock < 0) count = clock > -3000 ? String(Math.ceil(-clock / 1000)) : 'READY';
    else if (clock < 1000) count = 'GO!';
    if (count !== this.countShown) {
      this.countShown = count;
      if (count === 'GO!') {
        this.say('GO!', 1, 'go');
        this.sound.beep(true);
      } else if (count === 'READY') this.say('GET READY', 60, '');
      else if (count) {
        this.say(count, 1, 'count');
        this.sound.beep(false);
      }
    }
    if (hud.message && this.elapsed > this.messageUntil) hud.message.classList.remove('show');
    if (hud.streaks) {
      const fast = body.boosting || body.padTime > 0 ? 1 : body.draft * 0.5;
      hud.streaks.style.opacity = String(Math.min(1, fast * Math.min(1, body.speed / 20)));
    }
    this.hudFrame += 1;
    if (this.hudFrame % 2 === 0) this.drawMinimap();
    if (this.hudFrame % 6 !== 0) return;
    const rows = this.standings();
    const mine = rows.find((row) => row.me);
    this.me.place = mine?.place ?? 1;
    if (hud.pos) hud.pos.textContent = ordinal(this.me.place);
    if (hud.lap) hud.lap.textContent = `${this.lap}/${this.setup.laps}`;
    if (hud.time) hud.time.textContent = fmtRaceTime(this.finishedAt ?? Math.max(0, clock)).slice(0, -1);
    if (hud.speed) hud.speed.textContent = String(Math.round(body.speed * 3.6));
    if (hud.stamina) {
      hud.stamina.style.transform = `scaleX(${body.stamina.toFixed(3)})`;
      hud.stamina.dataset.state = body.boosting ? 'burn' : body.stamina < 0.12 ? 'empty' : '';
    }
    if (hud.wrong) hud.wrong.hidden = body.wrongWay < 0.8 || this.finishedAt !== null;
    if (hud.draft) hud.draft.hidden = body.draft < 0.5;
    rows.forEach((row, index) => {
      const element = this.rows[index];
      if (!element) return;
      element.classList.toggle('me', row.me);
      element.classList.toggle('done', row.finishMs !== null);
      element.children[0].textContent = String(row.place);
      const dot = element.children[1];
      if (dot instanceof HTMLElement) dot.style.background = SLOT_COLORS[row.slot % SLOT_COLORS.length];
      element.children[2].textContent = row.name;
    });
  }

  private drawMinimap(): void {
    const map = this.minimap;
    if (!map) return;
    const ctx = map.canvas.getContext('2d');
    if (!ctx) return;
    const size = map.canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(map.path, 0, 0);
    const dot = (racer: Racer, radius: number) => {
      ctx.beginPath();
      ctx.arc(map.ox + racer.x * map.scale, size - (map.oz + racer.z * map.scale), radius, 0, Math.PI * 2);
      ctx.fillStyle = racer.color;
      ctx.fill();
      ctx.lineWidth = racer === this.me ? 3 : 1.5;
      ctx.strokeStyle = racer === this.me ? '#ffffff' : 'rgba(0,0,0,0.7)';
      ctx.stroke();
    };
    for (const racer of this.racers) if (racer !== this.me) dot(racer, 5.5);
    dot(this.me, 8);
  }

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const frameMs = now - this.last;
    this.last = now;
    const dt = Math.min(0.05, frameMs / 1000);
    if (!this.paused) {
      this.elapsed += dt;
      if (this.setup.startAt === null) this.localClock += dt * 1000;
    }
    const clock = this.clock();
    if (!this.paused) {
      this.simulate(dt, clock);
      this.updateOthers(clock, dt);
      this.particles.update(dt);
      for (const treat of this.world.treats)
        if (!treat.mesh.visible && this.elapsed >= treat.readyAt) treat.mesh.visible = true;
      this.gait += (dt * this.body.speed) / 3.2;
      const stride = Math.floor(this.gait);
      if (stride !== this.lastStride && this.body.speed > 4 && !this.aquatic && this.stats.habitat === 'TERRAIN')
        this.sound.step(Math.min(1, this.body.speed / 30));
      this.lastStride = stride;
      this.sound.setWind(Math.min(1.2, this.body.speed / 32));
      if (this.setup.sendSample && now - this.lastSend >= SEND_MS) {
        this.lastSend = now;
        const body = this.body;
        this.setup.sendSample([
          body.x,
          body.z,
          body.heading,
          body.speed,
          body.progress,
          body.boosting || body.padTime > 0 ? 1 : 0,
        ]);
      }
    }
    this.updateCamera(clock, dt);
    this.world.update(this.elapsed, this.camera, this.focus.set(this.body.x, 0, this.body.z));
    const scale = this.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.dust.setViewport(this.renderer.domElement.height, this.camera.fov);
    this.dust.update(this.elapsed);
    this.particles.setViewport(scale);
    this.updateHud(clock);
    this.pipeline.render(dt);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.sound.dispose();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite)) return;
      object.geometry.dispose();
      const material: THREE.Material | THREE.Material[] = object.material;
      for (const entry of Array.isArray(material) ? material : [material]) entry.dispose();
    });
    this.world.dispose();
    this.particles.dispose();
    for (const fn of this.disposables) fn();
    this.pipeline.dispose();
    this.atmosphere.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
