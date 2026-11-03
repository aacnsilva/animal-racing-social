import { useCallback, useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import type { Page } from './types';

export type Store<T> = {
  get: () => T;
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
};

function isUpdater<T>(next: T | ((prev: T) => T)): next is (prev: T) => T {
  return typeof next === 'function';
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next) => {
      const value = isUpdater(next) ? next(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

export type AsyncState<T> = {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: (data: T | null) => void;
};

type Request = { deps: readonly unknown[] };

type Settled = { request: Request; error: unknown };

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

function useRequest(deps: readonly unknown[]): [Request, () => void] {
  const [request, setRequest] = useState<Request>(() => ({ deps }));
  if (!sameDeps(request.deps, deps)) setRequest({ deps });
  const reload = useCallback(() => setRequest((prev) => ({ deps: prev.deps })), []);
  return [request, reload];
}

export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [request, reload] = useRequest(deps);
  const [data, setData] = useState<T | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);
  const run = useEffectEvent(load);
  useEffect(() => {
    const controller = new AbortController();
    const execute = async () => {
      try {
        const value = await run(controller.signal);
        if (controller.signal.aborted) return;
        setData(value);
        setSettled({ request, error: null });
      } catch (err) {
        if (controller.signal.aborted) return;
        setSettled({ request, error: err });
      }
    };
    void execute();
    return () => controller.abort();
  }, [request]);
  const current = settled?.request === request ? settled : null;
  return { data, error: current ? current.error : null, loading: current === null, reload, setData };
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useInterval(callback: () => void, ms: number | null): void {
  const tick = useEffectEvent(callback);
  useEffect(() => {
    if (ms === null) return undefined;
    const id = setInterval(() => tick(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export type Paged<T> = {
  items: T[];
  loading: boolean;
  error: unknown;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
};

const NO_ITEMS: never[] = [];

type PageState<T> = { request: Request; items: T[]; cursor: string | null; error: unknown };

export function usePaged<T>(fetchPage: (cursor: string | null) => Promise<Page<T>>, deps: unknown[]): Paged<T> {
  const [request, reload] = useRequest(deps);
  const [page, setPage] = useState<PageState<T> | null>(null);
  const [moreFor, setMoreFor] = useState<Request | null>(null);
  const fetchFirst = useEffectEvent(() => fetchPage(null));

  useEffect(() => {
    let active = true;
    const execute = async () => {
      try {
        const first = await fetchFirst();
        if (active) setPage({ request, items: first.items, cursor: first.nextCursor, error: null });
      } catch (err) {
        if (active) setPage({ request, items: [], cursor: null, error: err });
      }
    };
    void execute();
    return () => {
      active = false;
    };
  }, [request]);

  const current = page?.request === request ? page : null;
  const cursor = current ? current.cursor : null;
  const loading = current === null || moreFor === request;

  const loadMore = () => {
    if (!cursor || loading) return;
    const owner = request;
    setMoreFor(owner);
    const execute = async () => {
      try {
        const next = await fetchPage(cursor);
        setPage((prev) =>
          prev?.request === owner ? { ...prev, items: [...prev.items, ...next.items], cursor: next.nextCursor } : prev,
        );
      } catch (err) {
        setPage((prev) => (prev?.request === owner ? { ...prev, error: err } : prev));
      } finally {
        setMoreFor((prev) => (prev === owner ? null : prev));
      }
    };
    void execute();
  };

  return {
    items: current ? current.items : NO_ITEMS,
    loading,
    error: current ? current.error : null,
    hasMore: Boolean(cursor),
    loadMore,
    reload,
  };
}

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
