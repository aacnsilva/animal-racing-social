import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Page } from './types';

export type Store<T> = {
  get: () => T;
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next) => {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(state) : next;
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

export type AsyncState<T> = { data: T | null; error: unknown; loading: boolean; reload: () => void; setData: (data: T | null) => void };

export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    loadRef.current(controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setLoading(false);
      },
      (err) => {
        if (controller.signal.aborted) return;
        setError(err);
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [...deps, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload, setData };
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
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => ref.current(), ms);
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

export function usePaged<T>(fetchPage: (cursor: string | null) => Promise<Page<T>>, deps: unknown[]): Paged<T> {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const generation = useRef(0);

  useEffect(() => {
    const gen = ++generation.current;
    setLoading(true);
    setError(null);
    setItems([]);
    fetchRef.current(null).then(
      (page) => {
        if (gen !== generation.current) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setHasMore(Boolean(page.nextCursor));
        setLoading(false);
      },
      (err) => {
        if (gen !== generation.current) return;
        setError(err);
        setLoading(false);
      },
    );
  }, [...deps, version]);

  const loadMore = useCallback(() => {
    if (!cursor || loading) return;
    const gen = generation.current;
    setLoading(true);
    fetchRef.current(cursor).then(
      (page) => {
        if (gen !== generation.current) return;
        setItems((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
        setHasMore(Boolean(page.nextCursor));
        setLoading(false);
      },
      (err) => {
        if (gen !== generation.current) return;
        setError(err);
        setLoading(false);
      },
    );
  }, [cursor, loading]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { items, loading, error, hasMore, loadMore, reload };
}

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
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
  const subscribe = useCallback((listener: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener('change', listener);
    return () => list.removeEventListener('change', listener);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
