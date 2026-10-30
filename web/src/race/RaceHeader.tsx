import { useState } from 'react';
import { RaceStatus } from '../components/ui';
import { CLASS_LABEL, fmtClock, fmtCountdown, fmtDateTime, fmtTime, shortHash, SPECIES_ICON, titleCase } from '../lib/format';
import { Link } from '../lib/router';
import type { Race, Venue } from '../lib/types';
import type { Connection } from './stream';

function Hash({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <span className="row" style={{ gap: 6 }}>
      {label}
      <code title={value}>{shortHash(value, 10)}</code>
      <button
        className="btn ghost small"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </span>
  );
}

const CONNECTION_LABEL: Record<Connection, string> = { connecting: 'Connecting', open: 'Live feed', reconnecting: 'Reconnecting' };

export function RaceHeader({ race, venue, connection, now }: { race: Race; venue: Venue | null; connection: Connection; now: number }) {
  const closesIn = Date.parse(race.bettingClosesAt) - now;
  const startsIn = Date.parse(race.startAt) - now;
  const started = race.startedAt ? Date.parse(race.startedAt) : Date.parse(race.startAt);
  const preRace = race.status === 'SCHEDULED' || race.status === 'OPEN' || race.status === 'LOCKED';
  const finished = race.status === 'FINISHED' || race.status === 'SETTLED';
  return (
    <section className="race-head" data-testid="race-header">
      <div className="title">
        <div className="eyebrow">
          {CLASS_LABEL[race.class]} · {SPECIES_ICON[race.species]} {titleCase(race.species)} race · {fmtDateTime(race.startAt)}
        </div>
        <h1>
          <Link to={`/venues/${race.venueId}`}>{race.venueName}</Link>
          <RaceStatus status={race.status} />
        </h1>
        <div className="facts">
          <span className="chip">{race.laps} laps</span>
          {venue && <span className="chip">{(venue.lapLength * race.laps).toFixed(0)} m</span>}
          <span className="chip">{titleCase(race.surface)}</span>
          <span className="chip">{race.entrantCount || race.entrants?.length || 0} runners</span>
          <span className="chip">~{Math.round(race.estimatedDurationSec / 60)} min</span>
          <span className={`chip ${connection === 'open' ? 'green' : 'grey'}`} title="Live stream connection">
            {CONNECTION_LABEL[connection]}
          </span>
        </div>
        <div className="hashes">
          <Hash label="Seed hash" value={race.seedHash} />
          <Hash label="Script hash" value={race.scriptHash} />
          {!race.seedHash && <span>Commitment pending: the script is sealed before betting opens.</span>}
        </div>
      </div>
      <div className="clocks">
        {race.status === 'CANCELLED' ? (
          <div className="clock">
            <div className="label">Cancelled</div>
            <div className="value">{race.cancelledReason ?? 'Void'}</div>
          </div>
        ) : (
          <>
            <div className="clock">
              <div className="label">Betting closes</div>
              <div className="value">{closesIn > 0 && preRace ? fmtCountdown(closesIn) : race.status === 'LIVE' ? 'In-running' : 'Closed'}</div>
              <div className="tiny muted">{fmtTime(race.bettingClosesAt)}</div>
            </div>
            <div className="clock">
              <div className="label">{preRace ? 'Starts in' : finished ? 'Finished' : 'Running'}</div>
              <div className="value">
                {preRace ? (startsIn > 0 ? fmtCountdown(startsIn) : 'Any moment') : finished ? fmtTime(race.finishedAt) : fmtClock(now - started)}
              </div>
              <div className="tiny muted">{race.status === 'LIVE' && race.currentLap ? `Lap ${Math.min(race.currentLap, race.laps)} of ${race.laps}` : `Off ${fmtTime(race.startAt)}`}</div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
