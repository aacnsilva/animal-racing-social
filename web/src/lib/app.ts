import { api, sessionStore } from './api';
import { createStore } from './hooks';
import type { Bet, DailyReward, Notification, Page, Season, Wallet } from './types';

export const walletStore = createStore<Wallet | null>(null);
export const unreadStore = createStore<number>(0);
export const seasonStore = createStore<Season | null>(null);
export const dailyStore = createStore<DailyReward | null>(null);

export type Toast = { id: number; message: string; kind: 'info' | 'success' | 'error' };
export const toastStore = createStore<Toast[]>([]);
let toastId = 0;

export function toast(message: string, kind: Toast['kind'] = 'info', ms = 4500): void {
  const id = ++toastId;
  toastStore.set((list) => [...list.slice(-3), { id, message, kind }]);
  setTimeout(() => toastStore.set((list) => list.filter((item) => item.id !== id)), ms);
}

const authed = () => sessionStore.get().status === 'authed';

let walletTimer: ReturnType<typeof setTimeout> | undefined;

export function refreshWallet(delay = 150): void {
  clearTimeout(walletTimer);
  walletTimer = setTimeout(async () => {
    if (!authed()) return;
    try {
      walletStore.set(await api<Wallet>('/v1/me/wallet'));
    } catch {
      return;
    }
  }, delay);
}

export async function refreshUnread(): Promise<void> {
  if (!authed()) return;
  try {
    const page = await api<Page<Notification> & { unreadCount: number }>('/v1/me/notifications?unread=true&limit=1');
    unreadStore.set(page.unreadCount);
  } catch {
    return;
  }
}

export async function refreshDaily(): Promise<void> {
  if (!authed()) return;
  try {
    dailyStore.set(await api<DailyReward>('/v1/me/rewards/daily'));
  } catch {
    return;
  }
}

export async function loadSeason(): Promise<void> {
  try {
    seasonStore.set(await api<Season>('/v1/seasons/current'));
  } catch {
    seasonStore.set(null);
  }
}

export function resetUserStores(): void {
  walletStore.set(null);
  unreadStore.set(0);
  dailyStore.set(null);
}

const betListeners = new Set<(bet: Bet) => void>();

export function publishBet(bet: Bet): void {
  for (const listener of betListeners) listener(bet);
  if (bet.status !== 'PENDING') refreshWallet(300);
}

export function onBet(listener: (bet: Bet) => void): () => void {
  betListeners.add(listener);
  return () => betListeners.delete(listener);
}

export function watchBet(betId: string, done: (bet: Bet) => boolean, timeoutMs = 90_000): () => void {
  let stopped = false;
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    unsubscribe();
  };
  const unsubscribe = onBet((bet) => {
    if (bet.id === betId && done(bet)) stop();
  });
  const poll = async () => {
    if (stopped) return;
    try {
      const bet = await api<Bet>(`/v1/bets/${betId}`);
      if (stopped) return;
      publishBet(bet);
      if (stopped) return;
    } catch {
      if (stopped) return;
    }
    if (Date.now() - started > timeoutMs) {
      stop();
      return;
    }
    const elapsed = Date.now() - started;
    timer = setTimeout(poll, elapsed < 10_000 ? 1200 : 3000);
  };
  timer = setTimeout(poll, 1500);
  return stop;
}

const cashoutRejectListeners = new Set<(betId: string, reason: string) => void>();

export function publishCashoutRejected(betId: string, reason: string): void {
  for (const listener of cashoutRejectListeners) listener(betId, reason);
}

export function onCashoutRejected(listener: (betId: string, reason: string) => void): () => void {
  cashoutRejectListeners.add(listener);
  return () => cashoutRejectListeners.delete(listener);
}
