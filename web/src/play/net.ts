import { api, ApiError } from '../lib/api';
import { createStore } from '../lib/hooks';
import type { Species } from '../lib/types';
import type { ClientMessage, RoomView, ServerMessage, WorldSample } from './protocol';

export type NetStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
export type NetState = {
  status: NetStatus;
  room: RoomView | null;
  you: string | null;
  error: { code: string; message: string } | null;
};

const IDLE: NetState = { status: 'idle', room: null, you: null, error: null };
const FATAL = new Set(['ROOM_NOT_FOUND', 'ROOM_FULL', 'UNAUTHORIZED', 'BANNED', 'UNAVAILABLE']);

function isServerMessage(value: unknown): value is ServerMessage {
  return typeof value === 'object' && value !== null && 't' in value && typeof value.t === 'string';
}

export class ArcadeClient {
  readonly store = createStore<NetState>(IDLE);
  private onWorld: ((serverTime: number, list: WorldSample[]) => void) | null = null;
  private ws: WebSocket | null = null;
  private offset = 0;
  private bestRtt = Infinity;
  private pings = 0;
  private pingTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private species: Species = 'HORSE';
  private wanted = false;
  private generation = 0;

  serverNow = (): number => Date.now() + this.offset;

  async connect(code: string | null, species: Species): Promise<void> {
    this.wanted = true;
    this.species = species;
    this.retries = 0;
    this.store.set({ status: 'connecting', room: null, you: null, error: null });
    await this.open(code);
  }

  private async open(code: string | null): Promise<void> {
    const generation = ++this.generation;
    clearTimeout(this.retryTimer);
    let ticket: string;
    try {
      ticket = (await api<{ ticket: string }>('/v1/arcade/ticket', { method: 'POST' })).ticket;
    } catch (error) {
      if (generation !== this.generation) return;
      const authError = error instanceof ApiError && (error.status === 401 || error.status === 403);
      if (authError || !this.store.get().room) {
        this.fail(
          error instanceof ApiError ? error.code : 'NETWORK_ERROR',
          authError ? 'Sign in to play with friends' : 'Could not reach the race server',
        );
      } else this.retry();
      return;
    }
    if (generation !== this.generation || !this.wanted) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/v1/arcade/ws`);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.bestRtt = Infinity;
      this.pings = 0;
      this.send({ t: 'hello', ticket, species: this.species, ...(code ? { code } : {}) });
      this.ping();
    });
    ws.addEventListener('message', (event) => {
      if (ws !== this.ws || typeof event.data !== 'string') return;
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (isServerMessage(message)) this.receive(message);
    });
    ws.addEventListener('close', (event) => {
      if (ws !== this.ws) return;
      this.ws = null;
      clearTimeout(this.pingTimer);
      if (!this.wanted) return;
      if (event.code === 4001) this.fail('REPLACED', 'This room was opened in another tab');
      else if (this.store.get().room) this.retry();
      else if (!this.store.get().error) this.fail('NETWORK_ERROR', 'Could not reach the race server');
    });
  }

  private retry(): void {
    const room = this.store.get().room;
    if (!room || this.retries >= 6) {
      this.fail('NETWORK_ERROR', 'Lost the connection to the room');
      return;
    }
    this.retries += 1;
    this.store.set((state) => ({ ...state, status: 'reconnecting' }));
    this.retryTimer = setTimeout(() => void this.open(room.code), Math.min(8000, 500 * 2 ** this.retries));
  }

  private fail(code: string, message: string): void {
    this.wanted = false;
    this.ws?.close();
    this.ws = null;
    this.store.set({ status: 'closed', room: null, you: null, error: { code, message } });
  }

  private ping(): void {
    clearTimeout(this.pingTimer);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.send({ t: 'ping', c: Date.now() });
    this.pings += 1;
    this.pingTimer = setTimeout(() => this.ping(), this.pings < 6 ? 350 : 4000);
  }

  private receive(message: ServerMessage): void {
    switch (message.t) {
      case 'w':
        this.onWorld?.(message.s, message.l);
        return;
      case 'pong': {
        const now = Date.now();
        const rtt = now - message.c;
        if (rtt <= this.bestRtt + 15) {
          this.bestRtt = Math.min(this.bestRtt, rtt);
          this.offset = message.s + rtt / 2 - now;
        }
        return;
      }
      case 'joined':
        this.retries = 0;
        this.store.set((state) => ({ ...state, status: 'open', you: message.you, error: null }));
        return;
      case 'room':
        if (this.bestRtt === Infinity) this.offset = message.now - Date.now();
        this.store.set((state) => ({ ...state, status: 'open', room: message.room }));
        return;
      case 'error':
        if (FATAL.has(message.code)) this.fail(message.code, message.message);
        else this.store.set((state) => ({ ...state, error: { code: message.code, message: message.message } }));
        return;
    }
  }

  setWorldHandler(handler: ((serverTime: number, list: WorldSample[]) => void) | null): void {
    this.onWorld = handler;
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  clearError(): void {
    this.store.set((state) => (state.error ? { ...state, error: null } : state));
  }

  close(): void {
    this.wanted = false;
    this.generation += 1;
    clearTimeout(this.pingTimer);
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
    this.onWorld = null;
    this.store.set(IDLE);
  }
}
