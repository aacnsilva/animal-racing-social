import type { AnimalStats } from './roster';
import { ROAD_HALF, WALL_AT, type Track } from './tracks';

export type Controls = { steer: number; throttle: number; brake: number; boost: boolean };

export type Body = {
  x: number;
  z: number;
  heading: number;
  travel: number;
  speed: number;
  stamina: number;
  boosting: boolean;
  padTime: number;
  draft: number;
  index: number;
  lat: number;
  progress: number;
  offroad: boolean;
  slide: number;
  bump: number;
  wrongWay: number;
};

export const PAD_TIME = 1.7;
export const PAD_MULT = 1.32;
export const STEP = 1 / 120;

export function createBody(track: Track, s: number, lat: number): Body {
  const pose = track.pose(s, lat, { x: 0, z: 0, heading: 0, tx: 0, tz: 0, nx: 0, nz: 0 });
  const index = track.wrap(Math.round(s / track.spacing));
  return {
    x: pose.x,
    z: pose.z,
    heading: pose.heading,
    travel: pose.heading,
    speed: 0,
    stamina: 1,
    boosting: false,
    padTime: 0,
    draft: 0,
    index,
    lat,
    progress: s,
    offroad: false,
    slide: 0,
    bump: 0,
    wrongWay: 0,
  };
}

function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function topSpeed(body: Body, stats: AnimalStats): number {
  let top = stats.top;
  if (body.offroad) top *= stats.offroad;
  if (body.boosting) top *= stats.boost;
  if (body.padTime > 0) top *= 1 + (PAD_MULT - 1) * Math.min(1, body.padTime / 0.5);
  top *= 1 + 0.07 * body.draft;
  return top;
}

export function stepBody(body: Body, controls: Controls, stats: AnimalStats, track: Track, dt: number): void {
  const wantsBoost =
    controls.boost && controls.throttle > 0 && (body.boosting ? body.stamina > 0 : body.stamina > 0.12);
  body.boosting = wantsBoost;
  if (wantsBoost) body.stamina = Math.max(0, body.stamina - stats.drain * dt);
  else body.stamina = Math.min(1, body.stamina + stats.regen * dt);
  body.padTime = Math.max(0, body.padTime - dt);

  const top = topSpeed(body, stats);
  if (controls.brake > 0) body.speed = Math.max(0, body.speed - 34 * controls.brake * dt);
  else if (controls.throttle > 0) {
    if (body.speed < top) {
      const push = stats.accel * (body.boosting || body.padTime > 0 ? 1.9 : 1) * (1.12 - body.speed / top);
      body.speed = Math.min(top, body.speed + push * controls.throttle * dt);
    } else body.speed = Math.max(top, body.speed - (body.offroad ? 26 : 9) * dt);
  } else body.speed = Math.max(0, body.speed - 7 * dt);
  if (controls.throttle <= 0 && body.speed > top) body.speed = Math.max(top, body.speed - 20 * dt);

  const ratio = Math.min(1.3, body.speed / stats.top);
  const turn = stats.handling * (1.28 - 0.56 * ratio) * Math.min(1, body.speed / 6) * (body.offroad ? 0.85 : 1);
  body.heading += controls.steer * turn * dt;
  const grip = body.offroad ? 4.5 : 9;
  const diff = angleDelta(body.heading, body.travel);
  body.travel += diff * Math.min(1, grip * dt);
  body.slide = diff;
  body.speed = Math.max(0, body.speed - Math.abs(diff) * body.speed * 0.9 * dt);

  body.x += Math.sin(body.travel) * body.speed * dt;
  body.z += Math.cos(body.travel) * body.speed * dt;

  const index = track.nearest(body.x, body.z, body.index, 14);
  body.index = index;
  body.lat = track.lateral(body.x, body.z, index);
  const local = index * track.spacing + track.along(body.x, body.z, index);
  body.progress = Math.round((body.progress - local) / track.length) * track.length + local;

  const side = Math.abs(body.lat);
  body.offroad = side > ROAD_HALF + 0.6;
  body.bump = Math.max(0, body.bump - dt * 3);
  if (side > WALL_AT - 1) {
    const sign = Math.sign(body.lat);
    const over = side - (WALL_AT - 1);
    const nx = track.tz[index];
    const nz = -track.tx[index];
    body.x -= nx * over * sign;
    body.z -= nz * over * sign;
    body.lat = sign * (WALL_AT - 1);
    const tangent = Math.atan2(track.tx[index], track.tz[index]);
    const along = Math.cos(angleDelta(body.travel, tangent));
    const facing = along >= 0 ? tangent : tangent + Math.PI;
    const impact = Math.abs(Math.sin(angleDelta(body.travel, tangent)));
    body.speed *= 1 - Math.min(0.5, impact * 0.9) * Math.min(1, dt * 30);
    body.travel += angleDelta(facing, body.travel) * Math.min(1, dt * 10);
    body.heading += angleDelta(facing, body.heading) * Math.min(1, dt * 6);
    if (impact > 0.2) body.bump = 1;
  }

  const forward = Math.sin(body.heading) * track.tx[index] + Math.cos(body.heading) * track.tz[index];
  if (forward < -0.35 && body.speed > 3) body.wrongWay += dt;
  else body.wrongWay = 0;
}
