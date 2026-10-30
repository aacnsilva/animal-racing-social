import { useEffect, useState } from 'react';
import { api } from './api';
import type { Race } from './types';

const cache = new Map<string, Promise<Race | null>>();

export function loadRaceInfo(raceId: string): Promise<Race | null> {
  let entry = cache.get(raceId);
  if (!entry) {
    entry = api<Race>(`/v1/races/${raceId}`).catch(() => {
      cache.delete(raceId);
      return null;
    });
    cache.set(raceId, entry);
  }
  return entry;
}

export function useRaceInfos(raceIds: string[]): Record<string, Race> {
  const [races, setRaces] = useState<Record<string, Race>>({});
  const key = [...new Set(raceIds)].sort().join(',');
  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(',') : [];
    void Promise.all(ids.map((id) => loadRaceInfo(id))).then((list) => {
      if (cancelled) return;
      const next: Record<string, Race> = {};
      list.forEach((race) => {
        if (race) next[race.id] = race;
      });
      setRaces(next);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return races;
}
