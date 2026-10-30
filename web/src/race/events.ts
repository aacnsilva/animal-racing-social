import { ordinal } from '../lib/format';
import type { Entrant, TickEvent } from '../lib/types';

export type Tone = 'info' | 'warn' | 'good' | 'move';

export function nameLookup(entrants: Entrant[] | undefined): (id: string | undefined) => string {
  const map = new Map((entrants ?? []).map((e) => [e.entrantId, `${e.animal.name} (${e.lane})`]));
  return (id) => (id ? map.get(id) ?? id : '?');
}

export function eventText(event: TickEvent, name: (id: string | undefined) => string): { text: string; tone: Tone } {
  switch (event.type) {
    case 'OVERTAKE':
      return { text: `${name(event.a)} passes ${name(event.b)}`, tone: 'move' };
    case 'STUMBLE':
      return { text: `${name(event.id)} stumbles!`, tone: 'warn' };
    case 'SPRINT':
      return { text: `${name(event.id)} kicks into a sprint`, tone: 'move' };
    case 'LAP':
      return { text: `Lap ${event.lap ?? ''} done · ${name(event.id)} leads`, tone: 'info' };
    case 'FINISH':
      return { text: `${name(event.id)} finishes ${event.pos ? ordinal(event.pos) : ''}`, tone: 'good' };
    case 'FALSE_START':
      return { text: `False start by ${name(event.id)}`, tone: 'warn' };
    case 'REFUSED_TO_RUN':
      return { text: `${name(event.id)} refuses to run`, tone: 'warn' };
    case 'PULLED_UP':
      return { text: `${name(event.id)} is pulled up`, tone: 'warn' };
    case 'PHOTO_FINISH':
      return { text: `Photo finish: ${name(event.a)} vs ${name(event.b)}`, tone: 'good' };
    default:
      return { text: event.type.replace(/_/g, ' ').toLowerCase(), tone: 'info' };
  }
}

export const INCIDENT_TYPES = new Set(['STUMBLE', 'FALSE_START', 'REFUSED_TO_RUN', 'PULLED_UP', 'PHOTO_FINISH', 'DISQUALIFIED']);
