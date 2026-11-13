import { verifyJwt } from '../../lib/crypto.ts';
import { isRecord } from '../../lib/http.ts';
import { isSpecies, normalizeCode, randomCode, Room, type ArcadeError } from '../../domain/arcade.ts';

export type Socket = { send: (text: string) => void; close: (code: number, reason: string) => void };

type Conn = { userId: string | null; name: string; room: Room | null; windowAt: number; messages: number };

export const ARCADE_AUDIENCE = 'arcade';
export const MAX_ROOMS = 300;
const MAX_MESSAGES_PER_SECOND = 60;

export class Hub {
  rooms = new Map<string, Room>();
  conns = new Map<Socket, Conn>();
  byUser = new Map<string, Socket>();
  private secret: string;
  private random: () => number;

  constructor(secret: string, random: () => number = Math.random) {
    this.secret = secret;
    this.random = random;
  }

  open(socket: Socket, now: number): void {
    this.conns.set(socket, { userId: null, name: '', room: null, windowAt: now, messages: 0 });
  }

  authed(socket: Socket): boolean {
    return this.conns.get(socket)?.userId != null;
  }

  private fail(socket: Socket, error: ArcadeError): void {
    socket.send(JSON.stringify({ t: 'error', code: error.code, message: error.message }));
  }

  private members(room: Room): Socket[] {
    const sockets: Socket[] = [];
    for (const player of room.players.values()) {
      const socket = player.connected ? this.byUser.get(player.id) : undefined;
      if (socket && this.conns.get(socket)?.room === room) sockets.push(socket);
    }
    return sockets;
  }

  private publish(room: Room, now: number): void {
    const text = JSON.stringify({ t: 'room', room: room.view(), now });
    for (const socket of this.members(room)) socket.send(text);
  }

  private hello(socket: Socket, conn: Conn, message: Record<string, unknown>, now: number): void {
    const claims = typeof message.ticket === 'string' ? verifyJwt(message.ticket, this.secret) : null;
    if (
      !claims ||
      claims.aud !== ARCADE_AUDIENCE ||
      typeof claims.sub !== 'string' ||
      typeof claims.name !== 'string'
    ) {
      this.fail(socket, { code: 'UNAUTHORIZED', message: 'Sign in to play with friends' });
      socket.close(4401, 'UNAUTHORIZED');
      return;
    }
    const species = isSpecies(message.species) ? message.species : 'HORSE';
    let room: Room | undefined;
    if (message.code === undefined || message.code === null) {
      if (this.rooms.size >= MAX_ROOMS) {
        this.fail(socket, { code: 'UNAVAILABLE', message: 'All rooms are busy, try again in a minute' });
        return;
      }
      let code = randomCode(this.random);
      while (this.rooms.has(code)) code = randomCode(this.random);
      room = new Room(code, claims.sub, now);
    } else {
      const code = normalizeCode(message.code);
      room = code ? this.rooms.get(code) : undefined;
      if (!room) {
        this.fail(socket, { code: 'ROOM_NOT_FOUND', message: 'No room with that code' });
        return;
      }
    }
    const previous = this.byUser.get(claims.sub);
    if (previous && previous !== socket) {
      const old = this.conns.get(previous);
      if (old?.room && old.room !== room) this.detach(claims.sub, old.room, now);
      this.conns.delete(previous);
      previous.close(4001, 'REPLACED');
    }
    const error = room.join(claims.sub, claims.name, species);
    if (error) {
      this.fail(socket, error);
      return;
    }
    this.rooms.set(room.code, room);
    conn.userId = claims.sub;
    conn.name = claims.name;
    conn.room = room;
    this.byUser.set(claims.sub, socket);
    socket.send(JSON.stringify({ t: 'joined', you: claims.sub, code: room.code }));
    this.publish(room, now);
  }

  private detach(userId: string, room: Room, now: number): void {
    room.leave(userId, now);
    this.publish(room, now);
  }

  handle(socket: Socket, raw: string, now: number): void {
    const conn = this.conns.get(socket);
    if (!conn) return;
    if (now - conn.windowAt >= 1000) {
      conn.windowAt = now;
      conn.messages = 0;
    }
    conn.messages += 1;
    if (conn.messages > MAX_MESSAGES_PER_SECOND) {
      socket.close(4429, 'RATE_LIMITED');
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(message) || typeof message.t !== 'string') return;
    if (message.t === 'ping') {
      socket.send(JSON.stringify({ t: 'pong', c: message.c, s: now }));
      return;
    }
    if (message.t === 'hello') {
      if (conn.userId === null) this.hello(socket, conn, message, now);
      return;
    }
    const room = conn.room;
    const userId = conn.userId;
    if (!room || userId === null) {
      this.fail(socket, { code: 'NOT_IN_ROOM', message: 'Join a room first' });
      return;
    }
    let error: ArcadeError | null = null;
    switch (message.t) {
      case 's':
        room.sample(userId, message.d, now);
        return;
      case 'pick':
        error = room.pick(userId, message.species);
        break;
      case 'config':
        error = room.configure(userId, message);
        break;
      case 'start':
        error = room.start(userId, now, this.random);
        break;
      case 'ready':
        if (!room.ready(userId)) return;
        room.tick(now);
        break;
      case 'finish':
        if (!room.finish(userId, message.ms, now)) return;
        room.tick(now);
        break;
      case 'lobby':
        error = room.backToLobby(userId, now);
        break;
      default:
        return;
    }
    if (error) this.fail(socket, error);
    else this.publish(room, now);
  }

  drop(socket: Socket, now: number): void {
    const conn = this.conns.get(socket);
    if (!conn) return;
    this.conns.delete(socket);
    if (conn.userId === null || this.byUser.get(conn.userId) !== socket) return;
    this.byUser.delete(conn.userId);
    if (conn.room) this.detach(conn.userId, conn.room, now);
  }

  tick(now: number): void {
    for (const [code, room] of this.rooms) {
      if (room.expired(now)) {
        this.rooms.delete(code);
        continue;
      }
      if (room.tick(now)) this.publish(room, now);
      const list = room.world();
      if (list.length === 0) continue;
      const text = JSON.stringify({ t: 'w', s: now, l: list });
      for (const socket of this.members(room)) socket.send(text);
    }
  }

  stats(): { rooms: number; connections: number; players: number } {
    return { rooms: this.rooms.size, connections: this.conns.size, players: this.byUser.size };
  }
}
