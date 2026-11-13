export const ARCADE_SPECIES = ['HORSE', 'GIRAFFE', 'SHARK', 'OCTOPUS'] as const;
export type ArcadeSpecies = (typeof ARCADE_SPECIES)[number];

export const ARCADE_TRACKS = ['meadow', 'dunes', 'reef', 'aurora'] as const;
export type ArcadeTrack = (typeof ARCADE_TRACKS)[number];

export const ARCADE_DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export type ArcadeDifficulty = (typeof ARCADE_DIFFICULTIES)[number];

export const MAX_RACERS = 10;
export const COUNTDOWN_MS = 4000;
export const LOAD_LIMIT_MS = 25_000;
export const FINISH_GRACE_MS = 45_000;
export const RACE_LIMIT_MS = 8 * 60_000;
export const RESULTS_LINGER_MS = 10 * 60_000;
export const EMPTY_ROOM_TTL_MS = 30_000;
export const MIN_LAP_MS = 12_000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

export type Phase = 'LOBBY' | 'LOADING' | 'COUNTDOWN' | 'RACING' | 'RESULTS';

export type RoomConfig = { trackId: ArcadeTrack; laps: number; bots: number; difficulty: ArcadeDifficulty };

export type Sample = [number, number, number, number, number, number];

export type Player = {
  id: string;
  name: string;
  slot: number;
  species: ArcadeSpecies;
  connected: boolean;
  racing: boolean;
  loaded: boolean;
  finishMs: number | null;
  sample: Sample | null;
  sampleAt: number;
  sampleFresh: boolean;
};

export type RoomView = {
  code: string;
  hostId: string;
  phase: Phase;
  config: RoomConfig;
  raceNo: number;
  seed: number;
  startAt: number;
  players: {
    id: string;
    name: string;
    slot: number;
    species: ArcadeSpecies;
    connected: boolean;
    racing: boolean;
    loaded: boolean;
    finishMs: number | null;
  }[];
};

export type ArcadeError = { code: string; message: string };

export function isSpecies(value: unknown): value is ArcadeSpecies {
  return ARCADE_SPECIES.some((entry) => entry === value);
}

function isTrack(value: unknown): value is ArcadeTrack {
  return ARCADE_TRACKS.some((entry) => entry === value);
}

function isDifficulty(value: unknown): value is ArcadeDifficulty {
  return ARCADE_DIFFICULTIES.some((entry) => entry === value);
}

export function normalizeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (code.length !== CODE_LENGTH) return null;
  for (const char of code) if (!CODE_ALPHABET.includes(char)) return null;
  return code;
}

export function randomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function parseSample(value: unknown): Sample | null {
  if (!Array.isArray(value) || value.length !== 6) return null;
  const numbers: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || Math.abs(entry) > 1e6) return null;
    numbers.push(Math.round(entry * 100) / 100);
  }
  return [numbers[0], numbers[1], numbers[2], numbers[3], numbers[4], numbers[5]];
}

export class Room {
  code: string;
  hostId: string;
  phase: Phase = 'LOBBY';
  config: RoomConfig = { trackId: 'meadow', laps: 3, bots: 4, difficulty: 'MEDIUM' };
  players = new Map<string, Player>();
  raceNo = 0;
  seed = 0;
  startAt = 0;
  firstFinishAt = 0;
  phaseAt: number;
  emptySince: number | null = null;

  constructor(code: string, hostId: string, now: number) {
    this.code = code;
    this.hostId = hostId;
    this.phaseAt = now;
  }

  view(): RoomView {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      config: this.config,
      raceNo: this.raceNo,
      seed: this.seed,
      startAt: this.startAt,
      players: [...this.players.values()]
        .toSorted((a, b) => a.slot - b.slot)
        .map((p) => ({
          id: p.id,
          name: p.name,
          slot: p.slot,
          species: p.species,
          connected: p.connected,
          racing: p.racing,
          loaded: p.loaded,
          finishMs: p.finishMs,
        })),
    };
  }

  private freeSlot(): number {
    const taken = new Set([...this.players.values()].map((p) => p.slot));
    for (let slot = 0; slot < MAX_RACERS; slot++) if (!taken.has(slot)) return slot;
    return -1;
  }

  join(id: string, name: string, species: ArcadeSpecies): ArcadeError | null {
    const existing = this.players.get(id);
    if (existing) {
      existing.connected = true;
      existing.name = name;
      this.emptySince = null;
      return null;
    }
    const slot = this.freeSlot();
    if (slot < 0) return { code: 'ROOM_FULL', message: 'This room already has 10 racers' };
    this.players.set(id, {
      id,
      name,
      slot,
      species,
      connected: true,
      racing: false,
      loaded: false,
      finishMs: null,
      sample: null,
      sampleAt: 0,
      sampleFresh: false,
    });
    this.emptySince = null;
    this.clampBots();
    return null;
  }

  leave(id: string, now: number): void {
    const player = this.players.get(id);
    if (!player) return;
    const midRace =
      (this.phase === 'LOADING' || this.phase === 'COUNTDOWN' || this.phase === 'RACING') && player.racing;
    if (midRace) {
      player.connected = false;
      player.sample = null;
    } else this.players.delete(id);
    const connected = [...this.players.values()].filter((p) => p.connected).toSorted((a, b) => a.slot - b.slot);
    if (connected.length === 0) {
      this.emptySince = now;
      return;
    }
    if (!connected.some((p) => p.id === this.hostId)) this.hostId = connected[0].id;
  }

  private clampBots(): void {
    this.config = { ...this.config, bots: Math.min(this.config.bots, MAX_RACERS - this.players.size) };
  }

  pick(id: string, species: unknown): ArcadeError | null {
    const player = this.players.get(id);
    if (!player) return { code: 'NOT_IN_ROOM', message: 'Join the room first' };
    if (!isSpecies(species)) return { code: 'VALIDATION_FAILED', message: 'Unknown animal' };
    if (player.racing && this.phase !== 'LOBBY' && this.phase !== 'RESULTS')
      return { code: 'RACE_IN_PROGRESS', message: 'Animals are locked during a race' };
    player.species = species;
    return null;
  }

  configure(id: string, input: Record<string, unknown>): ArcadeError | null {
    if (id !== this.hostId) return { code: 'FORBIDDEN', message: 'Only the host can change the race' };
    if (this.phase !== 'LOBBY') return { code: 'RACE_IN_PROGRESS', message: 'The race is already under way' };
    const next = { ...this.config };
    if (input.trackId !== undefined) {
      if (!isTrack(input.trackId)) return { code: 'VALIDATION_FAILED', message: 'Unknown track' };
      next.trackId = input.trackId;
    }
    if (input.laps !== undefined) {
      if (!isInt(input.laps, 1, 5)) return { code: 'VALIDATION_FAILED', message: 'Laps must be 1 to 5' };
      next.laps = input.laps;
    }
    if (input.bots !== undefined) {
      if (!isInt(input.bots, 0, MAX_RACERS - 1)) return { code: 'VALIDATION_FAILED', message: 'Bots must be 0 to 9' };
      next.bots = input.bots;
    }
    if (input.difficulty !== undefined) {
      if (!isDifficulty(input.difficulty)) return { code: 'VALIDATION_FAILED', message: 'Unknown difficulty' };
      next.difficulty = input.difficulty;
    }
    this.config = next;
    this.clampBots();
    return null;
  }

  start(id: string, now: number, random: () => number = Math.random): ArcadeError | null {
    if (id !== this.hostId) return { code: 'FORBIDDEN', message: 'Only the host can start the race' };
    if (this.phase !== 'LOBBY') return { code: 'RACE_IN_PROGRESS', message: 'The race is already under way' };
    this.clampBots();
    this.phase = 'LOADING';
    this.phaseAt = now;
    this.raceNo += 1;
    this.seed = Math.floor(random() * 0x7fffffff);
    this.startAt = 0;
    this.firstFinishAt = 0;
    for (const player of this.players.values()) {
      player.racing = player.connected;
      player.loaded = false;
      player.finishMs = null;
      player.sample = null;
    }
    return null;
  }

  ready(id: string): boolean {
    const player = this.players.get(id);
    if (this.phase !== 'LOADING' || !player?.racing || player.loaded) return false;
    player.loaded = true;
    return true;
  }

  sample(id: string, value: unknown, now: number): void {
    const player = this.players.get(id);
    if (!player?.racing || (this.phase !== 'RACING' && this.phase !== 'COUNTDOWN')) return;
    const sample = parseSample(value);
    if (!sample) return;
    player.sample = sample;
    player.sampleAt = now;
    player.sampleFresh = true;
  }

  finish(id: string, reported: unknown, now: number): boolean {
    const player = this.players.get(id);
    if (this.phase !== 'RACING' || !player?.racing || player.finishMs !== null) return false;
    const elapsed = now - this.startAt;
    if (elapsed < MIN_LAP_MS * this.config.laps) return false;
    const claimed = typeof reported === 'number' && Number.isFinite(reported) ? reported : elapsed;
    player.finishMs = Math.round(Math.min(elapsed, Math.max(elapsed - 3000, claimed)));
    if (!this.firstFinishAt) this.firstFinishAt = now;
    return true;
  }

  backToLobby(id: string, now: number): ArcadeError | null {
    if (id !== this.hostId) return { code: 'FORBIDDEN', message: 'Only the host can reopen the lobby' };
    if (this.phase !== 'RESULTS') return { code: 'RACE_IN_PROGRESS', message: 'The race is still running' };
    this.toLobby(now);
    return null;
  }

  private toLobby(now: number): void {
    this.phase = 'LOBBY';
    this.phaseAt = now;
    for (const [id, player] of this.players) {
      if (!player.connected) this.players.delete(id);
      else {
        player.racing = false;
        player.sample = null;
      }
    }
  }

  tick(now: number): boolean {
    if (this.phase === 'LOADING') {
      const waiting = [...this.players.values()].some((p) => p.racing && p.connected && !p.loaded);
      if (waiting && now - this.phaseAt < LOAD_LIMIT_MS) return false;
      this.phase = 'COUNTDOWN';
      this.phaseAt = now;
      this.startAt = now + COUNTDOWN_MS;
      return true;
    }
    if (this.phase === 'COUNTDOWN' && now >= this.startAt) {
      this.phase = 'RACING';
      this.phaseAt = now;
      return true;
    }
    if (this.phase === 'RACING') {
      const racers = [...this.players.values()].filter((p) => p.racing);
      const pending = racers.filter((p) => p.connected && p.finishMs === null);
      const graceOver = this.firstFinishAt > 0 && now - this.firstFinishAt >= FINISH_GRACE_MS;
      if (pending.length === 0 || graceOver || now - this.startAt >= RACE_LIMIT_MS) {
        this.phase = 'RESULTS';
        this.phaseAt = now;
        return true;
      }
    }
    if (this.phase === 'RESULTS' && now - this.phaseAt >= RESULTS_LINGER_MS) {
      this.toLobby(now);
      return true;
    }
    return false;
  }

  world(): [number, ...Sample][] {
    const list: [number, ...Sample][] = [];
    if (this.phase !== 'RACING' && this.phase !== 'COUNTDOWN') return list;
    for (const player of this.players.values()) {
      if (!player.racing || !player.sample || !player.sampleFresh) continue;
      player.sampleFresh = false;
      list.push([player.slot, ...player.sample]);
    }
    return list;
  }

  expired(now: number): boolean {
    return this.emptySince !== null && now - this.emptySince >= EMPTY_ROOM_TTL_MS;
  }
}
