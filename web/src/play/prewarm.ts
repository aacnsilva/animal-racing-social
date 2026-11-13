import { surfaceTextures } from '../race/textures';
import { loadTrack, trackDef, type Surface } from './tracks';

const KINDS: Record<Surface, string[]> = {
  GRASS: ['GRASS', 'TURF', 'PLAIN', 'SAND'],
  SAND: ['SAND', 'PLAIN'],
  ICE: ['SNOW', 'ICE', 'PLAIN'],
  OPEN_SEA: [],
};

const done = new Set<string>();
let queue: (() => void)[] = [];
let scheduled = false;

function pump(): void {
  scheduled = false;
  const job = queue.shift();
  if (!job) return;
  job();
  schedule();
}

function schedule(): void {
  if (scheduled || queue.length === 0) return;
  scheduled = true;
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(pump, { timeout: 1500 });
  else window.setTimeout(pump, 120);
}

export function prewarmTrack(trackId: string): void {
  const def = trackDef(trackId);
  if (done.has(def.id)) return;
  done.add(def.id);
  queue = [
    () => {
      loadTrack(def.id);
    },
    ...KINDS[def.surface].map((kind) => () => {
      surfaceTextures(kind);
    }),
    ...queue,
  ];
  schedule();
}
