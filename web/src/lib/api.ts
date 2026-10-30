import { useSyncExternalStore } from 'react';
import type { ProviderId, Session, User } from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type SessionState = { status: 'loading' | 'anon' | 'authed'; user: User | null; error: string | null };

let state: SessionState = { status: 'loading', user: null, error: null };
let token: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function emit(next: SessionState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const sessionStore = { get: () => state, subscribe };

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, sessionStore.get);
}

function scheduleRefresh(seconds: number): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refreshSession(), Math.max(5, seconds) * 1000);
}

export function refreshSession(): Promise<boolean> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/v1/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json' } });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { code?: string } | null;
        token = null;
        clearTimeout(refreshTimer);
        emit({ status: 'anon', user: null, error: body?.code === 'BANNED' ? 'BANNED' : state.error });
        return false;
      }
      const session = await res.json() as Session;
      token = session.accessToken;
      scheduleRefresh(session.expiresIn - 60);
      emit({ status: 'authed', user: session.user, error: null });
      return true;
    } catch {
      if (state.status === 'loading') emit({ status: 'anon', user: null, error: null });
      else scheduleRefresh(10);
      return false;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function setSessionUser(user: User): void {
  emit({ ...state, user });
}

export function setSessionError(error: string | null): void {
  emit({ ...state, error });
}

export function login(provider: ProviderId, redirect?: string): void {
  const target = redirect ?? `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/v1/auth/${provider}/start?redirect=${encodeURIComponent(target)}`);
}

export async function logout(): Promise<void> {
  try {
    await fetch('/v1/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    return;
  } finally {
    token = null;
    clearTimeout(refreshTimer);
    emit({ status: 'anon', user: null, error: null });
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    return await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'The server could not be reached');
  }
}

async function failure(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => '');
  let data: { code?: string; message?: string; details?: unknown } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return new ApiError(res.status, data?.code ?? `HTTP_${res.status}`, data?.message ?? (res.statusText || 'Request failed'), data?.details);
}

async function withRetry(path: string, options: RequestOptions): Promise<Response> {
  const hadToken = token !== null;
  const res = await send(path, options);
  if (res.status === 401 && (hadToken || state.status === 'authed')) {
    if (await refreshSession()) return send(path, options);
  }
  return res;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await withRetry(path, options);
  if (!res.ok) throw await failure(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function apiBytes(path: string): Promise<ArrayBuffer> {
  const res = await withRetry(path, { headers: { accept: '*/*' } });
  if (!res.ok) throw await failure(res);
  return res.arrayBuffer();
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
}
