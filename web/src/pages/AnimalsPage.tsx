import { AgingChart } from '../components/charts';
import { Empty, ErrorNotice, Form, Loading, Pager, StatBars } from '../components/ui';
import { api, qs } from '../lib/api';
import { CLASS_LABEL, fmtDateTime, fmtRelative, fmtStat, SPECIES_ICON, TEMPERAMENT_LABEL, titleCase } from '../lib/format';
import { useAsync, usePaged } from '../lib/hooks';
import { Link, setQuery, useLocation } from '../lib/router';
import type { Animal, AnimalHistoryItem, AnimalSummary, Page } from '../lib/types';

const age = (weeks: number) => `${Math.floor(weeks / 52)}y ${weeks % 52}w`;

function pct(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : '—';
}

export function AnimalCard({ animal }: { animal: AnimalSummary }) {
  return (
    <Link to={`/animals/${animal.id}`} className="card animal-card" data-testid="animal-card" data-animal-id={animal.id}>
      <div className="animal-head">
        <span className="animal-icon">{SPECIES_ICON[animal.species]}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{animal.name}</h3>
          <div className="tiny muted">
            {titleCase(animal.lifeStage)} · {age(animal.ageWeeks)} · {TEMPERAMENT_LABEL[animal.temperament]}
          </div>
        </div>
        {animal.status === 'RETIRED' ? <span className="chip grey">Retired</span> : animal.restingUntil ? <span className="chip blue">Resting</span> : null}
      </div>
      <StatBars stats={animal.current} />
      <div className="row">
        <Form last5={animal.form.last5} />
        <span className="spacer" />
        <span className="tiny muted">
          {animal.form.wins}W · {animal.form.podiums}P · {animal.form.races} runs
        </span>
      </div>
    </Link>
  );
}

export function AnimalsPage() {
  const { query } = useLocation();
  const species = query.get('species') ?? '';
  const status = query.get('status') ?? 'ACTIVE';
  const paged = usePaged((cursor) => api<Page<AnimalSummary>>(`/v1/animals${qs({ species, status: status === 'ALL' ? null : status, cursor, limit: 30 })}`), [species, status]);
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">The stable</div>
          <h1>Animals</h1>
          <p>Every stat is public. Animals age one week per real day, peak in their prime and retire after five seasons.</p>
        </div>
      </div>
      <div className="filters">
        <div className="tabs">
          {[
            ['', 'All'],
            ['HORSE', '🐎 Horses'],
            ['GIRAFFE', '🦒 Giraffes'],
          ].map(([value, label]) => (
            <button key={value} className={species === value ? 'active' : ''} onClick={() => setQuery({ species: value || null })}>
              {label}
            </button>
          ))}
        </div>
        <div className="tabs">
          {[
            ['ACTIVE', 'Active'],
            ['RETIRED', 'Retired'],
            ['ALL', 'Everyone'],
          ].map(([value, label]) => (
            <button key={value} className={status === value ? 'active' : ''} onClick={() => setQuery({ status: value === 'ACTIVE' ? null : value })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {paged.error ? <ErrorNotice error={paged.error} onRetry={paged.reload} /> : null}
      {paged.loading && !paged.items.length ? (
        <Loading />
      ) : paged.items.length === 0 ? (
        <Empty>No animals match.</Empty>
      ) : (
        <div className="cards">
          {paged.items.map((animal) => (
            <AnimalCard key={animal.id} animal={animal} />
          ))}
        </div>
      )}
      <Pager hasMore={paged.hasMore} loading={paged.loading} onMore={paged.loadMore} />
    </div>
  );
}

export function AnimalPage({ id }: { id: string }) {
  const animal = useAsync(() => api<Animal>(`/v1/animals/${id}`), [id]);
  const history = usePaged((cursor) => api<Page<AnimalHistoryItem>>(`/v1/animals/${id}/history${qs({ cursor, limit: 20 })}`), [id]);
  if (animal.error) return <ErrorNotice error={animal.error} onRetry={animal.reload} />;
  if (!animal.data) return <Loading />;
  const a = animal.data;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">
            <Link to="/animals">Animals</Link> · {titleCase(a.species)}
          </div>
          <h1 className="row">
            <span className="animal-icon">{SPECIES_ICON[a.species]}</span> {a.name}
          </h1>
          <p>
            {titleCase(a.lifeStage)} · {age(a.ageWeeks)} old · career day {a.careerDay} · {TEMPERAMENT_LABEL[a.temperament]}
            {a.status === 'RETIRED' ? ` · retired ${fmtDateTime(a.retiredAt)}${a.retireReason ? ` (${titleCase(a.retireReason)})` : ''}` : ''}
            {a.restingUntil ? ` · resting until ${fmtDateTime(a.restingUntil)}` : ''}
          </p>
        </div>
      </div>
      <div className="tiles">
        <div className="stat-tile">
          <div className="label">Runs</div>
          <div className="value">{a.form.races}</div>
        </div>
        <div className="stat-tile">
          <div className="label">Wins</div>
          <div className="value">{a.form.wins}</div>
          <div className="tiny muted">{pct(a.form.wins, a.form.races)} strike rate</div>
        </div>
        <div className="stat-tile">
          <div className="label">Podiums</div>
          <div className="value">{a.form.podiums}</div>
          <div className="tiny muted">{pct(a.form.podiums, a.form.races)} top three</div>
        </div>
        <div className="stat-tile">
          <div className="label">Form</div>
          <div style={{ marginTop: 8 }}>
            <Form last5={a.form.last5} />
          </div>
        </div>
      </div>
      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Stats</h2>
            <span className="small muted">current · base on hover</span>
          </div>
          <StatBars stats={a.current} compare={a.base} />
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th className="right">Current</th>
                  <th className="right">Base</th>
                </tr>
              </thead>
              <tbody>
                {(['velocity', 'stamina', 'acceleration', 'consistency'] as const).map((k) => (
                  <tr key={k}>
                    <td className="muted">{titleCase(k)}</td>
                    <td className="right num">{fmtStat(k, a.current[k])}</td>
                    <td className="right num muted">{fmtStat(k, a.base[k])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Aging curve</h2>
            <span className="small muted">condition vs base stats</span>
          </div>
          <AgingChart animal={a} />
        </section>
      </div>
      <section className="card">
        <div className="card-head">
          <h2>Venue form</h2>
          <span className="small muted">course specialists win more at home</span>
        </div>
        {a.venueForm.length === 0 ? (
          <div className="small muted">No runs recorded at any venue yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Venue</th>
                  <th className="right">Runs</th>
                  <th className="right">Wins</th>
                  <th className="right">Podiums</th>
                  <th className="right">Win %</th>
                </tr>
              </thead>
              <tbody>
                {a.venueForm.map((form) => (
                  <tr key={form.venueId}>
                    <td>
                      <Link to={`/venues/${form.venueId}`} className="link">
                        {form.venueName}
                      </Link>
                    </td>
                    <td className="right num">{form.races}</td>
                    <td className="right num">{form.wins}</td>
                    <td className="right num">{form.podiums}</td>
                    <td className="right num">{pct(form.wins, form.races)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card flush">
        <div className="card-head" style={{ padding: '14px 16px 0' }}>
          <h2>Race history</h2>
        </div>
        {history.loading && !history.items.length ? (
          <Loading />
        ) : history.items.length === 0 ? (
          <Empty>No finished races yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Venue</th>
                  <th>Class</th>
                  <th className="right">Pos</th>
                  <th className="right">Time</th>
                  <th className="right hide-sm">Laps led</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((item) => (
                  <tr key={item.raceId}>
                    <td className="small">
                      <Link to={`/races/${item.raceId}`} className="link">
                        {fmtRelative(item.finishedAt)}
                      </Link>
                    </td>
                    <td>{item.venueName}</td>
                    <td>
                      <span className="chip">{CLASS_LABEL[item.class]}</span>
                    </td>
                    <td className="right num">
                      {item.resultStatus && item.resultStatus !== 'FINISHED' ? (
                        <span className="chip red">{item.resultStatus === 'DISQUALIFIED' ? 'DQ' : item.resultStatus === 'NON_RUNNER' ? 'NR' : item.resultStatus}</span>
                      ) : (
                        <>
                          <b>{item.position ?? '—'}</b>
                          <span className="muted">/{item.fieldSize}</span>
                        </>
                      )}
                    </td>
                    <td className="right num">{item.timeSec !== null ? `${item.timeSec.toFixed(2)}s` : '—'}</td>
                    <td className="right num hide-sm">{item.lapsLed.length ? item.lapsLed.join(', ') : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager hasMore={history.hasMore} loading={history.loading} onMore={history.loadMore} />
      </section>
    </div>
  );
}

