import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COUNTDOWN_MS,
  FINISH_GRACE_MS,
  LOAD_LIMIT_MS,
  MIN_LAP_MS,
  normalizeCode,
  parseSample,
  Room,
} from '../src/domain/arcade.ts';
import { signJwt } from '../src/lib/crypto.ts';
import { Hub, type Socket } from '../src/services/arcade/hub.ts';

type Sent = Record<string, unknown> & { t: string };

function client() {
  const sent: Sent[] = [];
  const closed: number[] = [];
  const socket: Socket = {
    send: (text) => {
      sent.push(JSON.parse(text));
    },
    close: (code) => {
      closed.push(code);
    },
  };
  const last = (type: string) => sent.findLast((message) => message.t === type);
  return { socket, sent, closed, last };
}

const ticket = (sub: string, name = `Racer ${sub}`, aud = 'arcade') => signJwt({ sub, name, aud }, 'secret', 60);

function roomOf(message: Sent | undefined): {
  code: string;
  hostId: string;
  phase: string;
  startAt: number;
  config: { bots: number; laps: number; trackId: string };
  players: { id: string; slot: number; species: string; finishMs: number | null; connected: boolean }[];
} {
  assert.ok(message);
  return JSON.parse(JSON.stringify(message.room));
}

void describe('arcade room', () => {
  void it('validates codes and samples', () => {
    assert.equal(normalizeCode(' abcde '), 'ABCDE');
    assert.equal(normalizeCode('ABCD'), null);
    assert.equal(normalizeCode('ABCD0'), null);
    assert.equal(normalizeCode(12345), null);
    assert.deepEqual(parseSample([1.004, 2, 3, 4, 5, 6]), [1, 2, 3, 4, 5, 6]);
    assert.equal(parseSample([1, 2, 3, 4, 5]), null);
    assert.equal(parseSample([1, 2, 3, 4, 5, Number.NaN]), null);
    assert.equal(parseSample('x'), null);
  });

  void it('fills ten slots, then refuses', () => {
    const room = new Room('ABCDE', '0', 0);
    for (let i = 0; i < 10; i++) assert.equal(room.join(String(i), `P${i}`, 'HORSE'), null);
    assert.equal(room.join('10', 'P10', 'HORSE')?.code, 'ROOM_FULL');
    assert.equal(room.config.bots, 0);
    assert.deepEqual(
      room.view().players.map((p) => p.slot),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
  });

  void it('only lets the host configure and start', () => {
    const room = new Room('ABCDE', 'a', 0);
    room.join('a', 'A', 'HORSE');
    room.join('b', 'B', 'SHARK');
    assert.equal(room.configure('b', { laps: 2 })?.code, 'FORBIDDEN');
    assert.equal(room.configure('a', { laps: 9 })?.code, 'VALIDATION_FAILED');
    assert.equal(room.configure('a', { trackId: 'moon' })?.code, 'VALIDATION_FAILED');
    assert.equal(room.configure('a', { laps: 2, trackId: 'reef', bots: 9, difficulty: 'HARD' }), null);
    assert.deepEqual(room.config, { trackId: 'reef', laps: 2, bots: 8, difficulty: 'HARD' });
    assert.equal(room.start('b', 1000)?.code, 'FORBIDDEN');
    assert.equal(
      room.start('a', 1000, () => 0.5),
      null,
    );
    assert.equal(room.phase, 'LOADING');
    assert.equal(room.startAt, 0);
    assert.equal(room.ready('a'), true);
    assert.equal(room.ready('a'), false);
    assert.equal(room.tick(1500), false);
    room.ready('b');
    assert.equal(room.tick(2000), true);
    assert.equal(room.phase, 'COUNTDOWN');
    assert.equal(room.startAt, 2000 + COUNTDOWN_MS);
    assert.equal(room.configure('a', { laps: 3 })?.code, 'RACE_IN_PROGRESS');
  });

  void it('runs a race to results and back to the lobby', () => {
    const room = new Room('ABCDE', 'a', 0);
    room.join('a', 'A', 'HORSE');
    room.join('b', 'B', 'SHARK');
    room.configure('a', { laps: 1 });
    room.start('a', 0);
    room.ready('a');
    room.ready('b');
    room.tick(0);
    assert.equal(room.tick(COUNTDOWN_MS - 1), false);
    assert.equal(room.tick(COUNTDOWN_MS), true);
    assert.equal(room.phase, 'RACING');
    room.sample('a', [1, 2, 3, 4, 5, 0], COUNTDOWN_MS + 10);
    assert.deepEqual(room.world(), [[0, 1, 2, 3, 4, 5, 0]]);
    assert.deepEqual(room.world(), []);
    assert.equal(room.finish('a', 5000, COUNTDOWN_MS + 5000), false);
    const done = COUNTDOWN_MS + MIN_LAP_MS + 20_000;
    assert.equal(room.finish('a', MIN_LAP_MS + 19_900, done), true);
    assert.equal(room.players.get('a')?.finishMs, MIN_LAP_MS + 19_900);
    assert.equal(room.finish('a', 1, done), false);
    assert.equal(room.tick(done + 1000), false);
    room.join('c', 'C', 'OCTOPUS');
    assert.equal(room.players.get('c')?.racing, false);
    assert.equal(room.tick(done + FINISH_GRACE_MS), true);
    assert.equal(room.phase, 'RESULTS');
    assert.equal(room.players.get('b')?.finishMs, null);
    assert.equal(room.backToLobby('b', done)?.code, 'FORBIDDEN');
    assert.equal(room.backToLobby('a', done), null);
    assert.equal(room.phase, 'LOBBY');
  });

  void it('clamps reported finish times to the server clock', () => {
    const room = new Room('ABCDE', 'a', 0);
    room.join('a', 'A', 'HORSE');
    room.configure('a', { laps: 1 });
    room.start('a', 0);
    room.ready('a');
    room.tick(0);
    room.tick(COUNTDOWN_MS);
    assert.equal(room.finish('a', 1, COUNTDOWN_MS + 60_000), true);
    assert.equal(room.players.get('a')?.finishMs, 57_000);
    assert.equal(room.tick(COUNTDOWN_MS + 60_001), true);
    assert.equal(room.phase, 'RESULTS');
  });

  void it('waits for slow loaders only up to the limit and never for racers who left', () => {
    const room = new Room('ABCDE', 'a', 0);
    room.join('a', 'A', 'HORSE');
    room.join('b', 'B', 'SHARK');
    room.join('c', 'C', 'GIRAFFE');
    room.start('a', 0);
    room.ready('a');
    assert.equal(room.tick(LOAD_LIMIT_MS - 1), false);
    room.leave('c', LOAD_LIMIT_MS - 1);
    assert.equal(room.tick(LOAD_LIMIT_MS - 1), false);
    assert.equal(room.tick(LOAD_LIMIT_MS), true);
    assert.equal(room.phase, 'COUNTDOWN');
    assert.equal(room.startAt, LOAD_LIMIT_MS + COUNTDOWN_MS);

    const quick = new Room('FGHJK', 'a', 0);
    quick.join('a', 'A', 'HORSE');
    quick.join('b', 'B', 'SHARK');
    quick.start('a', 0);
    quick.ready('a');
    quick.leave('b', 500);
    assert.equal(quick.tick(600), true);
    assert.equal(quick.startAt, 600 + COUNTDOWN_MS);
  });

  void it('keeps racers who drop mid-race and passes the host on', () => {
    const room = new Room('ABCDE', 'a', 0);
    room.join('a', 'A', 'HORSE');
    room.join('b', 'B', 'SHARK');
    room.start('a', 0);
    room.leave('a', 100);
    assert.equal(room.hostId, 'b');
    assert.equal(room.players.get('a')?.connected, false);
    room.leave('b', 200);
    assert.equal(room.expired(200), false);
    assert.equal(room.expired(200 + 30_000), true);
    room.join('b', 'B', 'SHARK');
    assert.equal(room.expired(200 + 30_000), false);
  });
});

void describe('arcade hub', () => {
  void it('rejects bad tickets', () => {
    const hub = new Hub('secret');
    for (const bad of [ticket('1', 'A', 'other'), signJwt({ sub: '1', name: 'A', aud: 'arcade' }, 'wrong', 60), 7]) {
      const c = client();
      hub.open(c.socket, 0);
      hub.handle(c.socket, JSON.stringify({ t: 'hello', ticket: bad }), 0);
      assert.equal(c.last('error')?.code, 'UNAUTHORIZED');
      assert.deepEqual(c.closed, [4401]);
    }
    assert.equal(hub.rooms.size, 0);
  });

  void it('creates a room, lets a friend join by code and relays the race', () => {
    const hub = new Hub('secret', () => 0.25);
    const host = client();
    const guest = client();
    hub.open(host.socket, 0);
    hub.open(guest.socket, 0);
    hub.handle(host.socket, JSON.stringify({ t: 'hello', ticket: ticket('1'), species: 'GIRAFFE' }), 0);
    const code = String(host.last('joined')?.code);
    assert.equal(normalizeCode(code), code);
    hub.handle(guest.socket, JSON.stringify({ t: 'hello', ticket: ticket('2'), code: 'ZZZZZ' }), 0);
    assert.equal(guest.last('error')?.code, 'ROOM_NOT_FOUND');
    hub.handle(guest.socket, JSON.stringify({ t: 'hello', ticket: ticket('2'), code: code.toLowerCase() }), 0);
    assert.equal(guest.last('joined')?.you, '2');
    assert.deepEqual(
      roomOf(host.last('room')).players.map((p) => [p.id, p.slot, p.species]),
      [
        ['1', 0, 'GIRAFFE'],
        ['2', 1, 'HORSE'],
      ],
    );
    hub.handle(guest.socket, JSON.stringify({ t: 'pick', species: 'OCTOPUS' }), 0);
    assert.equal(roomOf(host.last('room')).players[1].species, 'OCTOPUS');
    hub.handle(guest.socket, JSON.stringify({ t: 'start' }), 0);
    assert.equal(guest.last('error')?.code, 'FORBIDDEN');
    hub.handle(host.socket, JSON.stringify({ t: 'config', laps: 1, bots: 3 }), 0);
    hub.handle(host.socket, JSON.stringify({ t: 'start' }), 1000);
    assert.equal(roomOf(guest.last('room')).phase, 'LOADING');
    hub.handle(host.socket, JSON.stringify({ t: 'ready' }), 1000);
    assert.equal(roomOf(guest.last('room')).phase, 'LOADING');
    hub.handle(guest.socket, JSON.stringify({ t: 'ready' }), 1000);
    assert.equal(roomOf(guest.last('room')).phase, 'COUNTDOWN');
    assert.equal(roomOf(guest.last('room')).startAt, 1000 + COUNTDOWN_MS);
    hub.handle(guest.socket, JSON.stringify({ t: 's', d: [5, 6, 0.5, 20, 12, 1] }), 1100);
    hub.tick(1150);
    assert.deepEqual(host.last('w')?.l, [[1, 5, 6, 0.5, 20, 12, 1]]);
    hub.tick(1000 + COUNTDOWN_MS);
    assert.equal(roomOf(host.last('room')).phase, 'RACING');
    const end = 1000 + COUNTDOWN_MS + 40_000;
    hub.handle(host.socket, JSON.stringify({ t: 'finish', ms: 39_950 }), end);
    assert.equal(roomOf(guest.last('room')).players[0].finishMs, 39_950);
    hub.handle(guest.socket, JSON.stringify({ t: 'finish', ms: 41_000 }), end + 1000);
    assert.equal(roomOf(guest.last('room')).phase, 'RESULTS');
    hub.handle(host.socket, JSON.stringify({ t: 'ping', c: 9 }), end + 2000);
    assert.deepEqual(host.last('pong'), { t: 'pong', c: 9, s: end + 2000 });
  });

  void it('replaces an older connection of the same user and cleans up empty rooms', () => {
    const hub = new Hub('secret');
    const first = client();
    const second = client();
    hub.open(first.socket, 0);
    hub.handle(first.socket, JSON.stringify({ t: 'hello', ticket: ticket('1') }), 0);
    const code = String(first.last('joined')?.code);
    hub.open(second.socket, 10);
    hub.handle(second.socket, JSON.stringify({ t: 'hello', ticket: ticket('1'), code }), 10);
    assert.deepEqual(first.closed, [4001]);
    hub.drop(first.socket, 20);
    assert.equal(roomOf(second.last('room')).players.length, 1);
    hub.drop(second.socket, 30);
    hub.tick(40);
    assert.equal(hub.rooms.size, 1);
    hub.tick(30 + 30_000);
    assert.equal(hub.rooms.size, 0);
  });

  void it('closes flooding connections', () => {
    const hub = new Hub('secret');
    const c = client();
    hub.open(c.socket, 0);
    for (let i = 0; i < 61; i++) hub.handle(c.socket, JSON.stringify({ t: 'ping', c: i }), 5);
    assert.deepEqual(c.closed, [4429]);
  });
});
