import { expect, request } from '@playwright/test';
import { adminSession, BASE_URL, call, scheduleRace } from './support.ts';

export default async function globalSetup(): Promise<void> {
  const api = await request.newContext({ baseURL: BASE_URL });
  await expect.poll(async () => (await api.get('/v1/seasons/current').catch(() => null))?.status(), { timeout: 180_000, intervals: [2000] }).toBe(200);
  await expect.poll(async () => {
    const animals = await (await api.get('/v1/animals?species=HORSE&status=ACTIVE&limit=20')).json().catch(() => ({ items: [] }));
    return animals.items.length;
  }, { timeout: 120_000, intervals: [2000] }).toBe(20);
  const admin = await adminSession();
  await expect.poll(async () => (await call<unknown[]>(admin.api, admin.token, 'GET', '/v1/admin/engine/versions')).body?.length ?? 0, { timeout: 180_000, intervals: [2000] }).toBeGreaterThan(0);
  await admin.api.dispose();
  await api.dispose();
  const [horse, giraffe, cancel] = await Promise.all([
    scheduleRace({ species: 'HORSE', raceClass: 'SPRINT', startInSeconds: 25 * 60 }),
    scheduleRace({ species: 'GIRAFFE', raceClass: 'SPRINT', startInSeconds: 25 * 60 }),
    scheduleRace({ species: 'GIRAFFE', raceClass: 'STANDARD', startInSeconds: 30 * 60 }),
  ]);
  process.env.E2E_RACE_HORSE = horse;
  process.env.E2E_RACE_GIRAFFE = giraffe;
  process.env.E2E_RACE_CANCEL = cancel;
}
