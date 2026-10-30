import { randomUUID } from 'node:crypto';
import { expect, request, type APIRequestContext, type Locator, type Page } from '@playwright/test';

export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';
export const ADMIN_SUBJECT = process.env.E2E_ADMIN_SUBJECT ?? 'admin1';

export type Species = 'HORSE' | 'GIRAFFE';
export type RaceClass = 'SPRINT' | 'STANDARD' | 'ENDURANCE';

export function uniqueSubject(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export async function signIn(page: Page, options: { provider?: 'google' | 'github'; subject?: string; name?: string; from?: string } = {}) {
  const provider = options.provider ?? 'google';
  const subject = options.subject ?? uniqueSubject('racer');
  const name = options.name ?? `Racer ${subject.slice(-8)}`;
  await page.goto(options.from ?? '/');
  await page.getByTestId(`login-${provider}`).click();
  await page.waitForURL(/:9000\//);
  await page.getByLabel('Account ID').fill(subject);
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('user-menu')).toContainText(name);
  return { subject, name };
}

export async function apiSession(subject: string, name = subject): Promise<{ api: APIRequestContext; token: string; userId: string }> {
  const api = await request.newContext({ baseURL: BASE_URL });
  const start = await api.get('/v1/auth/google/start?redirect=/', { maxRedirects: 0 });
  const authorize = new URL(start.headers().location!);
  const approve = await api.post(`${authorize.origin}/google/approve`, {
    maxRedirects: 0,
    form: {
      client_id: authorize.searchParams.get('client_id')!,
      redirect_uri: authorize.searchParams.get('redirect_uri')!,
      state: authorize.searchParams.get('state')!,
      code_challenge: authorize.searchParams.get('code_challenge')!,
      subject,
      name,
      email: `${subject}@example.test`,
      decision: 'allow',
    },
  });
  await api.get(approve.headers().location!, { maxRedirects: 0 });
  const refreshed = await api.post('/v1/auth/refresh');
  expect(refreshed.ok()).toBeTruthy();
  const body = await refreshed.json();
  return { api, token: body.accessToken, userId: body.user.userId };
}

export async function adminSession() {
  return apiSession(ADMIN_SUBJECT, 'Admin');
}

export async function call<T = any>(api: APIRequestContext, token: string, method: string, path: string, data?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> {
  const response = await api.fetch(path, { method, data, headers: { authorization: `Bearer ${token}`, ...headers } });
  const text = await response.text();
  return { status: response.status(), body: (text ? JSON.parse(text) : undefined) as T };
}

export async function scheduleRace(options: { species?: Species; raceClass?: RaceClass; startInSeconds: number; fieldSize?: number }): Promise<string> {
  const admin = await adminSession();
  try {
    const result = await call<{ raceId: string }>(admin.api, admin.token, 'POST', '/v1/admin/races', {
      startAt: new Date(Date.now() + options.startInSeconds * 1000).toISOString(),
      species: options.species ?? 'HORSE',
      class: options.raceClass ?? 'SPRINT',
      fieldSize: options.fieldSize ?? 6,
    });
    expect(result.status).toBe(202);
    await waitForRace(admin.api, result.body.raceId, ['OPEN'], 60_000);
    await expect.poll(async () => {
      const markets = await (await admin.api.get(`/v1/races/${result.body.raceId}/markets`)).json();
      return markets.filter((market: { status: string }) => market.status === 'OPEN').length;
    }, { timeout: 60_000 }).toBeGreaterThan(0);
    return result.body.raceId;
  } finally {
    await admin.api.dispose();
  }
}

export async function waitForRace(api: APIRequestContext, raceId: string, statuses: string[], timeout: number): Promise<any> {
  let race: any;
  await expect.poll(async () => {
    const response = await api.get(`/v1/races/${raceId}`);
    race = response.ok() ? await response.json() : null;
    return race?.status;
  }, { timeout, intervals: [1000] }).toMatch(new RegExp(`^(${statuses.join('|')})$`));
  return race;
}

export async function headerBalance(page: Page): Promise<number> {
  const text = (await page.getByTestId('balance').textContent()) ?? '';
  return Number(text.replace(/[^\d]/g, ''));
}

export function market(page: Page, type: string, params: Record<string, number> = {}): Locator {
  return page.locator(`[data-testid="market"][data-market-type="${type}"][data-market-params='${JSON.stringify(params)}']`);
}

export async function placeSingle(page: Page, marketLocator: Locator, stake: number, entrantIndex = 0): Promise<string> {
  await marketLocator.getByTestId('price-button').nth(entrantIndex).click();
  const slip = page.getByTestId('bet-slip');
  await expect(slip).toBeVisible();
  await slip.getByTestId('stake-input').fill(String(stake));
  await slip.getByTestId('place-bet').click();
  const bet = page.getByTestId('my-bet').first();
  await expect(bet).toHaveAttribute('data-bet-status', /PENDING|ACCEPTED/);
  return (await bet.getAttribute('data-bet-id'))!;
}
