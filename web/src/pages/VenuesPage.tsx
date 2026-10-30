import { ElevationProfile, TrackLegend, TrackMap } from '../components/charts';
import { Empty, ErrorNotice, Loading, Pager } from '../components/ui';
import { api, qs } from '../lib/api';
import { CLASS_LABEL, fmtDateTime, SPECIES_ICON, titleCase } from '../lib/format';
import { useAsync, useNow, usePaged } from '../lib/hooks';
import { Link } from '../lib/router';
import type { Page, Race, Venue } from '../lib/types';
import { RaceRow } from './RaceCardPage';

function segmentText(venue: Venue): string {
  const curves = venue.segments.filter((s) => s.type === 'CURVE');
  const tight = curves.filter((s) => (s.radius ?? 99) < 30).length;
  const hills = venue.segments.filter((s) => s.type === 'UPHILL' || s.type === 'DOWNHILL').length;
  return [`${curves.length} curve${curves.length === 1 ? '' : 's'}`, tight ? `${tight} tight` : null, hills ? `${hills} hill section${hills === 1 ? '' : 's'}` : 'flat'].filter(Boolean).join(' · ');
}

export function VenuesPage() {
  const venues = useAsync(() => api<Venue[]>('/v1/venues'), []);
  if (venues.error) return <ErrorNotice error={venues.error} onRetry={venues.reload} />;
  if (!venues.data) return <Loading />;
  const classes = ['SPRINT', 'STANDARD', 'ENDURANCE'] as const;
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">Tracks</div>
          <h1>Venues</h1>
          <p>Twelve fixed, versioned venues, four per race class. The 3D viewer builds each track from the same segments the engine simulates.</p>
        </div>
      </div>
      {classes.map((raceClass) => {
        const list = venues.data!.filter((venue) => venue.class === raceClass);
        if (!list.length) return null;
        return (
          <section key={raceClass}>
            <div className="section-title">
              <h2>{CLASS_LABEL[raceClass]}</h2>
              <span className="small muted">
                {list[0]!.lapsRange[0]}–{list[0]!.lapsRange[1]} laps
              </span>
            </div>
            <div className="cards">
              {list.map((venue) => (
                <Link key={venue.id} to={`/venues/${venue.id}`} className="card venue-card" data-testid="venue-card" data-venue-id={venue.id}>
                  <TrackMap venue={venue} mini />
                  <div className="row">
                    <h3 style={{ flex: 1 }}>{venue.name}</h3>
                    <span className="chip">{titleCase(venue.surface)}</span>
                  </div>
                  <div className="small muted">{venue.description}</div>
                  <div className="tiny muted">
                    {venue.lapLength.toFixed(0)} m lap · {segmentText(venue)}
                    {venue.status !== 'ACTIVE' ? ` · ${venue.status.toLowerCase()}` : ''}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function VenuePage({ id }: { id: string }) {
  const venue = useAsync(() => api<Venue>(`/v1/venues/${id}`), [id]);
  const history = usePaged((cursor) => api<Page<Race>>(`/v1/venues/${id}/history${qs({ cursor, limit: 20 })}`), [id]);
  const now = useNow(30_000);
  if (venue.error) return <ErrorNotice error={venue.error} onRetry={venue.reload} />;
  if (!venue.data) return <Loading />;
  const v = venue.data;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">
            <Link to="/venues">Venues</Link> · {CLASS_LABEL[v.class]} · version {v.version}
          </div>
          <h1>{v.name}</h1>
          <p>{v.description}</p>
        </div>
        <div className="row wrap">
          <span className="chip">{titleCase(v.surface)}</span>
          <span className="chip">{v.lapLength.toFixed(2)} m lap</span>
          <span className="chip">
            {v.lapsRange[0]}–{v.lapsRange[1]} laps
          </span>
          <span className="chip">{v.lanes} lanes</span>
        </div>
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
        <section className="card stack">
          <div className="card-head" style={{ marginBottom: 0 }}>
            <h2>Track map</h2>
            <span className="small muted">lane 1 is the inner rail · arrow shows direction</span>
          </div>
          <TrackMap venue={v} />
          <TrackLegend venue={v} />
          <h3>Elevation</h3>
          <ElevationProfile venue={v} />
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Segments</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Type</th>
                  <th className="right">Length</th>
                  <th className="right">Detail</th>
                </tr>
              </thead>
              <tbody>
                {v.segments.map((segment, index) => {
                  const length = segment.type === 'CURVE' ? (segment.radius ?? 0) * Math.abs(((segment.angle ?? 0) * Math.PI) / 180) : segment.length ?? 0;
                  return (
                    <tr key={index}>
                      <td className="muted">{index + 1}</td>
                      <td>{titleCase(segment.type)}</td>
                      <td className="right num">{length.toFixed(1)} m</td>
                      <td className="right num small">
                        {segment.type === 'CURVE'
                          ? `r ${segment.radius} m · ${segment.angle}°${(segment.radius ?? 99) < 30 ? ' · tight' : ''}`
                          : segment.grade
                            ? `${(segment.grade * 100).toFixed(0)}% grade`
                            : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section>
        <div className="section-title">
          <h2>Recent races here</h2>
        </div>
        {history.loading && !history.items.length ? (
          <Loading />
        ) : history.items.length === 0 ? (
          <Empty>No finished races at {v.name} yet.</Empty>
        ) : (
          <div className="race-list">
            {history.items.map((race) => (
              <RaceRow key={race.id} race={race} now={now} />
            ))}
          </div>
        )}
        <Pager hasMore={history.hasMore} loading={history.loading} onMore={history.loadMore} />
        <div className="tiny muted" style={{ marginTop: 8 }}>
          {SPECIES_ICON.HORSE} and {SPECIES_ICON.GIRAFFE} share venues; each species has its own surface and segment affinities. Last updated {fmtDateTime(new Date(now).toISOString())}.
        </div>
      </section>
    </div>
  );
}
