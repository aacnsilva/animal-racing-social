import { env } from './config.ts';
import { ApiError } from './http.ts';
import { BUCKETS, histogram, injectHeaders, SpanKind, SpanStatusCode, withSpan } from './telemetry.ts';

export type EntrantInput = {
  entrantId: string;
  animalId: string;
  lane: number;
  temperament: string;
  stats: { velocity: number; stamina: number; acceleration: number; consistency: number };
};

const clientDuration = () => histogram('http.client.request.duration', 's', 'Duration of internal HTTP client requests', BUCKETS.http);

export async function callRaw(base: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<{ status: number; text: string; bytes: Buffer }> {
  const method = body === undefined ? 'GET' : 'POST';
  const peer = new URL(base).hostname;
  return withSpan(`${method} ${path}`, {
    kind: SpanKind.CLIENT,
    attributes: { 'http.request.method': method, 'server.address': peer, 'url.path': path },
  }, async (span) => {
    const started = performance.now();
    let status = 0;
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { ...injectHeaders(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      span.setAttribute('http.response.status_code', status);
      if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      const bytes = Buffer.from(await response.arrayBuffer());
      return { status, text: bytes.toString('utf8'), bytes };
    } finally {
      clientDuration().record((performance.now() - started) / 1000, { 'server.address': peer, 'url.path': path, 'http.response.status_code': status });
    }
  });
}

async function call<T>(base: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
  const response = await callRaw(base, path, body, timeoutMs);
  const parsed = response.text ? JSON.parse(response.text) : undefined;
  if (response.status < 200 || response.status >= 300) {
    throw new ApiError(response.status, parsed?.code ?? 'UPSTREAM_ERROR', parsed?.message ?? `${path} failed with ${response.status}`, parsed?.details);
  }
  return parsed as T;
}

export const raceEngine = {
  base: () => env('RACE_ENGINE_URL', 'http://localhost:7001'),
  plan: (body: { venueId: string; venueVersion: number; species: string; raceClass: string; engineVersion: string; entrants: EntrantInput[] }) =>
    call<{ laps: number; estimatedDurationSec: number }>(raceEngine.base(), '/internal/plan', body, 30_000),
  simulate: (body: Record<string, unknown>) => call<Record<string, unknown>>(raceEngine.base(), '/internal/simulate', body, 60_000),
  versions: () => call<{ engineVersion: string; paramsHash: string }[]>(raceEngine.base(), '/internal/engine-versions'),
};

export type PricedMarket = { type: string; params: Record<string, number>; selections: { entrantId: string; probability: number; price: number }[] };

export const oddsEngine = {
  base: () => env('ODDS_ENGINE_URL', 'http://localhost:7003'),
  price: (body: { venueId: string; venueVersion: number; species: string; laps: number; engineVersion: string; entrants: EntrantInput[]; markets: { type: string; params: Record<string, number> }[]; runs?: number }) =>
    call<{ runs: number; markets: PricedMarket[] }>(oddsEngine.base(), '/internal/price', body, 120_000),
};

export const walletApi = {
  base: () => env('WALLET_URL', 'http://localhost:3002'),
  ensure: (userId: string, seasonId: string) =>
    call<{ seasonId: string; balance: number; inOpenBets: number; rankScore: number }>(walletApi.base(), '/internal/ensure', { userId, seasonId }),
  debit: (userId: string, seasonId: string, betId: string, amount: number) =>
    call<{ balance: number }>(walletApi.base(), '/internal/debit', { userId, seasonId, betId, amount }),
  dailyClaim: (userId: string) => call<{ amount: number; balance: number; streak: number }>(walletApi.base(), '/internal/daily-claim', { userId }),
  adjust: (userId: string, seasonId: string, amount: number, refId: string, reason: string) =>
    call<{ balance: number }>(walletApi.base(), '/internal/adjust', { userId, seasonId, amount, refId, reason }),
};
