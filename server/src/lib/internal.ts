import { env } from './config.ts';
import { ApiError } from './http.ts';

export type EntrantInput = {
  entrantId: string;
  animalId: string;
  lane: number;
  temperament: string;
  stats: { velocity: number; stamina: number; acceleration: number; consistency: number };
};

async function call<T>(base: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
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
