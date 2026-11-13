import type { Species } from '../lib/types';
import type { Difficulty } from './roster';
import type { TrackId } from './tracks';

export type Phase = 'LOBBY' | 'COUNTDOWN' | 'RACING' | 'RESULTS';

export type RoomConfig = { trackId: TrackId; laps: number; bots: number; difficulty: Difficulty };

export type RoomPlayer = {
  id: string;
  name: string;
  slot: number;
  species: Species;
  connected: boolean;
  racing: boolean;
  finishMs: number | null;
};

export type RoomView = {
  code: string;
  hostId: string;
  phase: Phase;
  config: RoomConfig;
  raceNo: number;
  seed: number;
  startAt: number;
  players: RoomPlayer[];
};

export type WorldSample = [number, number, number, number, number, number, number];

export type ServerMessage =
  | { t: 'joined'; you: string; code: string }
  | { t: 'room'; room: RoomView; now: number }
  | { t: 'w'; s: number; l: WorldSample[] }
  | { t: 'pong'; c: number; s: number }
  | { t: 'error'; code: string; message: string };

export type ClientMessage =
  | { t: 'hello'; ticket: string; code?: string; species: Species }
  | { t: 'pick'; species: Species }
  | ({ t: 'config' } & Partial<RoomConfig>)
  | { t: 'start' }
  | { t: 's'; d: [number, number, number, number, number, number] }
  | { t: 'finish'; ms: number }
  | { t: 'lobby' }
  | { t: 'ping'; c: number };
