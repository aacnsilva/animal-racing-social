import { useState } from 'react';
import { Lane } from '../components/ui';
import { readLocal, writeLocal } from '../lib/hooks';
import { fmtClock, fmtRaceTime } from '../lib/format';
import type { Entrant, Race, RaceTick } from '../lib/types';
import { eventText, nameLookup } from './events';
import type { FeedItem } from './stream';

type Row = {
  id: string;
  pos: number | null;
  lane: number;
  name: string;
  extra: string;
  stamina: number | null;
  state: string;
};

const STATE_SHORT: Record<string, string> = {
  SPRINTING: 'sprint',
  TIRED: 'tired',
  STUMBLED: 'stumble',
  DNF: 'DNF',
  FINISHED: 'fin',
};
type GapMode = 'leader' | 'interval';
const GAP_MODE_KEY = 'ars.standings.gapMode';

const RESULT_SHORT: Record<string, string> = { DISQUALIFIED: 'DQ', DNF: 'DNF', NON_RUNNER: 'NR' };

function rowsFor(race: Race, tick: RaceTick | null, gapMode: GapMode): Row[] {
  const entrants = race.entrants ?? [];
  const byId = new Map(entrants.map((e) => [e.entrantId, e]));
  if (tick && tick.entrants.length) {
    const sorted = tick.entrants.toSorted((a, b) => a.pos - b.pos);
    const leaderDist = Math.max(...sorted.filter((e) => e.state !== 'DNF').map((e) => e.dist), 0);
    return sorted.map((t, i) => {
      const entrant = byId.get(t.id);
      const ahead = sorted.slice(0, i).findLast((e) => e.state !== 'DNF');
      const gap = gapMode === 'interval' ? (ahead ? ahead.dist - t.dist : 0) : leaderDist - t.dist;
      const isLeader = leaderDist - t.dist < 0.05;
      const result = entrant?.result;
      const finishedText =
        result && (result.resultStatus === 'FINISHED' || result.resultStatus === 'DISQUALIFIED') && result.finishTimeMs
          ? fmtRaceTime(result.finishTimeMs)
          : STATE_SHORT[t.state];
      return {
        id: t.id,
        pos: t.pos,
        lane: entrant?.lane ?? Math.round(t.lane),
        name: entrant?.animal.name ?? t.id,
        extra:
          t.state === 'FINISHED' || t.state === 'DNF'
            ? result && result.resultStatus !== 'FINISHED'
              ? (RESULT_SHORT[result.resultStatus] ?? finishedText)
              : finishedText
            : `${isLeader ? 'lead' : `+${Math.max(0, gap).toFixed(1)} m`}${STATE_SHORT[t.state] ? ` · ${STATE_SHORT[t.state]}` : ''}`,
        stamina: t.staminaPct,
        state: t.state,
      };
    });
  }
  const withResult = entrants.filter((e) => e.result);
  if (withResult.length) {
    return entrants
      .toSorted((a, b) => (a.result?.officialPosition ?? 99) - (b.result?.officialPosition ?? 99))
      .map((e) => ({
        id: e.entrantId,
        pos: e.result?.officialPosition ?? null,
        lane: e.lane,
        name: e.animal.name,
        extra:
          e.result?.resultStatus === 'FINISHED'
            ? e.result.finishTimeMs
              ? fmtRaceTime(e.result.finishTimeMs)
              : ''
            : (RESULT_SHORT[e.result?.resultStatus ?? ''] ?? ''),
        stamina: null,
        state: e.result?.resultStatus ?? '',
      }));
  }
  return entrants
    .toSorted((a, b) => a.lane - b.lane)
    .map((e: Entrant) => ({
      id: e.entrantId,
      pos: null,
      lane: e.lane,
      name: e.animal.name,
      extra: e.temperament.replace('_', ' ').toLowerCase(),
      stamina: null,
      state: '',
    }));
}

export function Standings({ race, tick, title }: { race: Race; tick: RaceTick | null; title: string }) {
  const [gapMode, setGapMode] = useState<GapMode>(() =>
    readLocal<GapMode>(GAP_MODE_KEY, 'leader') === 'interval' ? 'interval' : 'leader',
  );
  const chooseGapMode = (mode: GapMode) => {
    setGapMode(mode);
    writeLocal(GAP_MODE_KEY, mode);
  };
  const rows = rowsFor(race, tick, gapMode);
  const showGapToggle = Boolean(tick?.entrants.length);
  return (
    <section className="card standings-panel">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h2>{title}</h2>
        {tick && (
          <span className="chip">
            Lap {Math.min(tick.lap, race.laps)}/{race.laps}
          </span>
        )}
      </div>
      {showGapToggle && (
        <fieldset className="tabs gap-toggle" aria-label="Gap shown">
          {(
            [
              ['leader', 'To leader'],
              ['interval', 'Interval'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={gapMode === mode ? 'active' : undefined}
              aria-pressed={gapMode === mode}
              data-testid={`gap-mode-${mode}`}
              onClick={() => chooseGapMode(mode)}
            >
              {label}
            </button>
          ))}
        </fieldset>
      )}
      <div className="standings" data-testid="standings">
        {rows.map((row) => (
          <div
            key={row.id}
            className={`standing-row${row.pos === 1 ? ' p1' : ''}`}
            data-testid="standing-row"
            data-entrant-id={row.id}
            data-pos={row.pos ?? ''}
          >
            <span className="pos">{row.pos ?? '–'}</span>
            <Lane lane={row.lane} small />
            <span style={{ minWidth: 0 }}>
              <span className="name" style={{ display: 'block' }}>
                {row.name}
              </span>
              {row.stamina !== null && (
                <span className="stamina" title={`Stamina ${Math.round(row.stamina)}%`}>
                  <i
                    style={{
                      width: `${Math.max(0, Math.min(100, row.stamina))}%`,
                      background: row.stamina < 25 ? 'var(--warn)' : undefined,
                    }}
                  />
                </span>
              )}
            </span>
            <span className="extra">{row.extra}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RaceFeed({ race, feed }: { race: Race; feed: FeedItem[] }) {
  const name = nameLookup(race.entrants);
  const items = feed.toReversed().slice(0, 40);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Race feed</h2>
      </div>
      {items.length === 0 ? (
        <div className="small muted">Overtakes, stumbles, laps and finishes appear here once the race is running.</div>
      ) : (
        <div className="feed">
          {items.map((item) => {
            const { text } = eventText(item.event, name);
            return (
              <div key={item.seq}>
                <span className="t">{fmtClock(item.tick * race.tickMs)}</span>
                <span>{text}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
