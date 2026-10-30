import { useEffect } from 'react';
import { Empty, ErrorNotice, Loading, Pager, RaceStatus } from '../components/ui';
import { api, qs } from '../lib/api';
import { CLASS_LABEL, fmtCountdown, fmtDateTime, fmtTime, SPECIES_ICON, titleCase } from '../lib/format';
import { useAsync, useNow, usePaged } from '../lib/hooks';
import { Link, setQuery, useLocation } from '../lib/router';
import type { Page, Race } from '../lib/types';

function Filters({ species, raceClass }: { species: string; raceClass: string }) {
  return (
    <div className="filters">
      <div className="tabs" role="group" aria-label="Species">
        {[
          ['', 'All species'],
          ['HORSE', '🐎 Horses'],
          ['GIRAFFE', '🦒 Giraffes'],
        ].map(([value, label]) => (
          <button key={value} className={species === value ? 'active' : ''} onClick={() => setQuery({ species: value || null })} data-filter-species={value || 'ALL'}>
            {label}
          </button>
        ))}
      </div>
      <div className="tabs" role="group" aria-label="Class">
        {[
          ['', 'All classes'],
          ['SPRINT', 'Sprint'],
          ['STANDARD', 'Standard'],
          ['ENDURANCE', 'Endurance'],
        ].map(([value, label]) => (
          <button key={value} className={raceClass === value ? 'active' : ''} onClick={() => setQuery({ class: value || null })} data-filter-class={value || 'ALL'}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RaceRow({ race, now }: { race: Race; now: number }) {
  const startsIn = Date.parse(race.startAt) - now;
  const closesIn = Date.parse(race.bettingClosesAt) - now;
  const finished = race.status === 'FINISHED' || race.status === 'SETTLED';
  let when: string;
  let sub: string;
  if (race.status === 'LIVE') {
    when = race.currentLap ? `Lap ${Math.min(race.currentLap, race.laps)}/${race.laps}` : 'Running';
    sub = 'Watch live';
  } else if (finished) {
    when = race.winner?.name ?? 'Result';
    sub = race.winner ? 'Winner' : fmtDateTime(race.finishedAt);
  } else if (race.status === 'CANCELLED') {
    when = 'Void';
    sub = race.cancelledReason ?? '';
  } else {
    when = startsIn > 0 ? fmtCountdown(startsIn) : 'Due off';
    sub = race.status === 'OPEN' && closesIn > 0 ? `bets close in ${fmtCountdown(closesIn)}` : race.status === 'LOCKED' ? 'betting closed' : 'opening soon';
  }
  return (
    <Link to={`/races/${race.id}`} className={`race-row${race.status === 'LIVE' ? ' live' : ''}`} data-testid="race-card-item" data-race-id={race.id}>
      <span className="time">{fmtTime(race.startAt)}</span>
      <span>
        <RaceStatus status={race.status} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="venue" style={{ display: 'block' }}>
          {SPECIES_ICON[race.species]} {race.venueName}
        </span>
        <span className="meta">
          {CLASS_LABEL[race.class]} · {race.laps} laps · {titleCase(race.surface)}
        </span>
      </span>
      <span className="meta">
        {race.entrantCount} runners · {titleCase(race.species)}s
      </span>
      <span className="when">
        <span style={{ display: 'block' }}>{when}</span>
        <span className="meta" style={{ fontWeight: 600 }}>
          {sub}
        </span>
      </span>
      <span className="arrow">›</span>
    </Link>
  );
}

function NextRaceHero({ races, now }: { races: Race[]; now: number }) {
  const live = races.filter((r) => r.status === 'LIVE');
  const next = races.find((r) => (r.status === 'OPEN' || r.status === 'SCHEDULED') && Date.parse(r.startAt) > now);
  const featured = live[0] ?? next;
  if (!featured) return null;
  const startsIn = Date.parse(featured.startAt) - now;
  return (
    <div className="hero">
      <Link to={`/races/${featured.id}`} className="hero-card">
        <div className="eyebrow">{featured.status === 'LIVE' ? 'Live now' : 'Next off'}</div>
        <h1>
          {SPECIES_ICON[featured.species]} {featured.venueName}
        </h1>
        <div className="row wrap">
          <RaceStatus status={featured.status} testId={false} />
          <span className="chip">{CLASS_LABEL[featured.class]}</span>
          <span className="chip">{featured.laps} laps</span>
          <span className="chip">{featured.entrantCount} runners</span>
        </div>
        <div className="big">{featured.status === 'LIVE' ? `Lap ${Math.min(featured.currentLap ?? 1, featured.laps)}/${featured.laps}` : fmtCountdown(startsIn)}</div>
        <span className="small muted">{featured.status === 'LIVE' ? 'Jump in: the 3D view and in-running markets are live.' : `Off at ${fmtTime(featured.startAt)} · tap to see the runners and prices`}</span>
      </Link>
      <div className="hero-side">
        <div className="stat-tile">
          <div className="label">Live now</div>
          <div className="value">{live.length}</div>
        </div>
        <div className="stat-tile">
          <div className="label">Upcoming today</div>
          <div className="value">{races.filter((r) => r.status !== 'LIVE').length}</div>
        </div>
        <div className="stat-tile">
          <div className="label">Points only</div>
          <div className="small muted" style={{ marginTop: 4 }}>
            Fictional points, seasons and leaderboards. No real money, ever.
          </div>
        </div>
      </div>
    </div>
  );
}

function Upcoming({ species, raceClass }: { species: string; raceClass: string }) {
  const now = useNow(1000);
  const schedule = useAsync(() => api<Page<Race>>(`/v1/schedule${qs({ species, class: raceClass, limit: 100 })}`), [species, raceClass]);
  useEffect(() => {
    const id = setInterval(schedule.reload, 15_000);
    return () => clearInterval(id);
  }, [schedule.reload]);
  const races = schedule.data?.items ?? [];
  return (
    <>
      {!species && !raceClass && <NextRaceHero races={races} now={now} />}
      <Filters species={species} raceClass={raceClass} />
      {schedule.error ? <ErrorNotice error={schedule.error} onRetry={schedule.reload} /> : null}
      {!schedule.data && schedule.loading ? (
        <Loading label="Loading the race card…" />
      ) : races.length === 0 ? (
        <Empty>No races on the card right now. The scheduler books races up to 24 hours ahead; check back in a minute.</Empty>
      ) : (
        <div className="race-list">
          {races.map((race) => (
            <RaceRow key={race.id} race={race} now={now} />
          ))}
        </div>
      )}
    </>
  );
}

function Results({ species, raceClass }: { species: string; raceClass: string }) {
  const now = useNow(30_000);
  const paged = usePaged((cursor) => api<Page<Race>>(`/v1/races${qs({ status: 'FINISHED', species, cursor, limit: 30 })}`), [species]);
  const items = raceClass ? paged.items.filter((race) => race.class === raceClass) : paged.items;
  return (
    <>
      <Filters species={species} raceClass={raceClass} />
      {paged.error ? <ErrorNotice error={paged.error} onRetry={paged.reload} /> : null}
      {paged.loading && !paged.items.length ? (
        <Loading label="Loading results…" />
      ) : items.length === 0 ? (
        <Empty>No finished races yet.</Empty>
      ) : (
        <div className="race-list">
          {items.map((race) => (
            <RaceRow key={race.id} race={race} now={now} />
          ))}
        </div>
      )}
      <Pager hasMore={paged.hasMore} loading={paged.loading} onMore={paged.loadMore} />
    </>
  );
}

export function RaceCardPage({ view }: { view: 'upcoming' | 'results' }) {
  const { query } = useLocation();
  const species = query.get('species') ?? '';
  const raceClass = query.get('class') ?? '';
  const search = query.toString();
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Race card</div>
          <h1>{view === 'upcoming' ? 'Today at the track' : 'Results'}</h1>
          <p>Horses and giraffes, three races an hour. Every race is simulated and sealed before the first bet.</p>
        </div>
        <div className="tabs">
          <Link to={`/${search ? `?${search}` : ''}`} className={view === 'upcoming' ? 'active' : ''}>
            Upcoming
          </Link>
          <Link to={`/results${search ? `?${search}` : ''}`} className={view === 'results' ? 'active' : ''}>
            Results
          </Link>
        </div>
      </div>
      {view === 'upcoming' ? <Upcoming species={species} raceClass={raceClass} /> : <Results species={species} raceClass={raceClass} />}
    </div>
  );
}
