import { useEffect, useState, type ReactNode } from 'react';
import { Empty, ErrorNotice, Loading, Pager, SignInPrompt } from '../components/ui';
import { api, ApiError, qs, useSession } from '../lib/api';
import { toast } from '../lib/app';
import { friendlyError } from '../lib/errors';
import { CLASS_LABEL, fmtDateTime, fmtPoints, fmtSigned, fmtTime } from '../lib/format';
import { useAsync, usePaged } from '../lib/hooks';
import { Link, setQuery, useLocation } from '../lib/router';
import type { LedgerEntry, Page, Race, RaceClass, Season, Species, User, Venue } from '../lib/types';

type Result = { kind: 'success' | 'error'; text: string; code?: string } | null;

function ResultNotice({ result, testId }: { result: Result; testId?: string }) {
  if (!result) return null;
  return (
    <div className={`notice small ${result.kind}`} data-testid={testId}>
      {result.text}
      {result.code && <span className="code">{result.code}</span>}
    </div>
  );
}

const fail = (error: unknown): Result => ({ kind: 'error', text: friendlyError(error), code: error instanceof ApiError ? error.code : undefined });

function Card({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="card stack">
      <div>
        <h2>{title}</h2>
        {hint && <div className="small muted" style={{ marginTop: 4 }}>{hint}</div>}
      </div>
      {children}
    </section>
  );
}

function ScheduleRace() {
  const [species, setSpecies] = useState<Species>('HORSE');
  const [raceClass, setRaceClass] = useState<RaceClass>('SPRINT');
  const [minutes, setMinutes] = useState('2');
  const [venueId, setVenueId] = useState('');
  const [fieldSize, setFieldSize] = useState('');
  const [busy, setBusy] = useState(false);
  const [raceId, setRaceId] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);
  const venues = useAsync(() => api<Venue[]>(`/v1/venues${qs({ class: raceClass })}`), [raceClass]);

  useEffect(() => setVenueId(''), [raceClass]);

  const submit = async () => {
    setBusy(true);
    setResult(null);
    setRaceId(null);
    const requested = Number(minutes);
    const seconds = Math.max(70, Number.isFinite(requested) ? requested * 60 : 120);
    const startAt = new Date(Date.now() + seconds * 1000).toISOString();
    try {
      const response = await api<{ raceId: string }>('/v1/admin/races', {
        method: 'POST',
        body: { startAt, species, class: raceClass, venueId: venueId || undefined, fieldSize: fieldSize ? Number(fieldSize) : undefined },
      });
      setRaceId(response.raceId);
      setResult({ kind: 'success', text: `Scheduled for ${fmtTime(startAt)}${seconds !== requested * 60 ? ' (moved to the earliest allowed start)' : ''}. It appears on the card once its script is sealed.` });
    } catch (error) {
      setResult(fail(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Schedule a one-off race" hint="Starts must be at least 65 seconds ahead. The engine plans laps and seals the script asynchronously.">
      <div className="form-grid">
        <label className="field">
          <span>Species</span>
          <select className="select" data-testid="admin-race-species" value={species} onChange={(e) => setSpecies(e.target.value as Species)}>
            <option value="HORSE">Horse</option>
            <option value="GIRAFFE">Giraffe</option>
          </select>
        </label>
        <label className="field">
          <span>Class</span>
          <select className="select" data-testid="admin-race-class" value={raceClass} onChange={(e) => setRaceClass(e.target.value as RaceClass)}>
            <option value="SPRINT">Sprint</option>
            <option value="STANDARD">Standard</option>
            <option value="ENDURANCE">Endurance</option>
          </select>
        </label>
        <label className="field">
          <span>Minutes from now</span>
          <input className="input" data-testid="admin-race-minutes" type="number" min="1.1" step="0.5" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
        <label className="field">
          <span>Venue (optional)</span>
          <select className="select" value={venueId} onChange={(e) => setVenueId(e.target.value)} data-testid="admin-race-venue">
            <option value="">Random</option>
            {(venues.data ?? []).map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Field size</span>
          <select className="select" value={fieldSize} onChange={(e) => setFieldSize(e.target.value)} data-testid="admin-race-field-size">
            <option value="">Default</option>
            {[6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                {n} runners
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row wrap">
        <button className="btn primary" data-testid="admin-schedule-submit" onClick={() => void submit()} disabled={busy}>
          Schedule race
        </button>
        {raceId && (
          <span className="small">
            Race id{' '}
            <Link to={`/races/${raceId}`} className="link mono" data-testid="admin-scheduled-race-id">
              {raceId}
            </Link>
          </span>
        )}
      </div>
      <ResultNotice result={result} />
    </Card>
  );
}

function CancelRace() {
  const [raceId, setRaceId] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<Result>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setResult(null);
    try {
      await api(`/v1/admin/races/${encodeURIComponent(raceId.trim())}/cancel`, { method: 'POST', body: reason.trim() ? { reason: reason.trim() } : {} });
      setResult({ kind: 'success', text: `Cancellation requested for race ${raceId.trim()}. Markets will be voided and stakes refunded.` });
    } catch (error) {
      setResult(fail(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Cancel a race" hint="Voids every market and refunds all bets.">
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        <label className="field">
          <span>Race id</span>
          <input className="input mono" data-testid="admin-cancel-race-id" value={raceId} onChange={(e) => setRaceId(e.target.value)} />
        </label>
        <label className="field">
          <span>Reason</span>
          <input className="input" value={reason} placeholder="ADMIN" onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div>
        <button className="btn danger" data-testid="admin-cancel-submit" onClick={() => void submit()} disabled={busy || !raceId.trim()}>
          Cancel race
        </button>
      </div>
      <ResultNotice result={result} testId="admin-cancel-message" />
    </Card>
  );
}

function UpcomingRaces() {
  const schedule = useAsync(() => api<Page<Race>>('/v1/schedule?limit=50'), []);
  return (
    <Card title="On the card">
      {schedule.error ? <ErrorNotice error={schedule.error} onRetry={schedule.reload} /> : null}
      {!schedule.data ? (
        <Loading />
      ) : schedule.data.items.length === 0 ? (
        <div className="small muted">Nothing scheduled.</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 320 }}>
          <table className="table">
            <tbody>
              {schedule.data.items.map((race) => (
                <tr key={race.id}>
                  <td className="num">{fmtTime(race.startAt)}</td>
                  <td>
                    <Link to={`/races/${race.id}`} className="link">
                      {race.venueName}
                    </Link>
                    <div className="tiny muted mono">{race.id}</div>
                  </td>
                  <td>
                    <span className={`status status-${race.status}`}>{race.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <button className="btn small" onClick={schedule.reload}>
          Refresh
        </button>
      </div>
    </Card>
  );
}

function MarketControl() {
  const [marketId, setMarketId] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<Result>(null);
  const act = async (action: 'suspend' | 'resume' | 'void') => {
    setResult(null);
    try {
      await api(`/v1/admin/markets/${encodeURIComponent(marketId.trim())}/${action}`, { method: 'POST', body: reason.trim() ? { reason: reason.trim() } : {} });
      setResult({ kind: 'success', text: `${action} requested for market ${marketId.trim()}.` });
    } catch (error) {
      setResult(fail(error));
    }
  };
  return (
    <Card title="Market controls" hint="Find market ids on a race page (each market card carries its id).">
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        <label className="field">
          <span>Market id</span>
          <input className="input mono" data-testid="admin-market-id" value={marketId} onChange={(e) => setMarketId(e.target.value)} />
        </label>
        <label className="field">
          <span>Reason</span>
          <input className="input" value={reason} placeholder="MANUAL" onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="row wrap">
        <button className="btn" data-testid="admin-market-suspend" disabled={!marketId.trim()} onClick={() => void act('suspend')}>
          Suspend
        </button>
        <button className="btn" data-testid="admin-market-resume" disabled={!marketId.trim()} onClick={() => void act('resume')}>
          Resume
        </button>
        <button className="btn danger" data-testid="admin-market-void" disabled={!marketId.trim()} onClick={() => void act('void')}>
          Void
        </button>
      </div>
      <ResultNotice result={result} testId="admin-market-message" />
    </Card>
  );
}

function JsonEditor({ title, hint, load, save, transform }: { title: string; hint: string; load: () => Promise<unknown>; save: (value: unknown) => Promise<unknown>; transform?: (value: unknown) => unknown }) {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState<unknown>(null);
  const [result, setResult] = useState<Result>(null);
  const [busy, setBusy] = useState(false);
  const reload = async () => {
    setResult(null);
    try {
      const value = await load();
      setLoaded(value);
      setText(JSON.stringify(transform ? transform(value) : value, null, 2));
    } catch (error) {
      setResult(fail(error));
    }
  };
  useEffect(() => {
    void reload();
  }, [load]);
  const submit = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      setResult({ kind: 'error', text: `Invalid JSON: ${(error as Error).message}` });
      return;
    }
    setBusy(true);
    try {
      const saved = await save(parsed);
      setLoaded(saved);
      setText(JSON.stringify(transform ? transform(saved) : saved, null, 2));
      setResult({ kind: 'success', text: 'Saved as a new version.' });
    } catch (error) {
      setResult(fail(error));
    } finally {
      setBusy(false);
    }
  };
  const version = (loaded as { version?: number } | null)?.version;
  return (
    <Card title={title} hint={hint}>
      {version !== undefined && <span className="chip">version {version}</span>}
      <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="row">
        <button className="btn primary" onClick={() => void submit()} disabled={busy}>
          Save new version
        </button>
        <button className="btn ghost" onClick={() => void reload()}>
          Reload
        </button>
      </div>
      <ResultNotice result={result} />
    </Card>
  );
}

const programmeLoad = () => api<unknown>('/v1/admin/programme');
const programmeSave = (value: unknown) => api<unknown>('/v1/admin/programme', { method: 'PUT', body: value });
const stripProgramme = (value: unknown) => {
  if (!value || typeof value !== 'object') return value;
  const { racesPerHour, classMix, speciesRotation, horizonHours, recoveryMinutes } = value as Record<string, unknown>;
  return { racesPerHour, classMix, speciesRotation, horizonHours, recoveryMinutes };
};

function Templates() {
  const [raceClass, setRaceClass] = useState<RaceClass>('STANDARD');
  const [load, setLoad] = useState(() => () => api<unknown>(`/v1/admin/market-templates/STANDARD`));
  useEffect(() => {
    setLoad(() => () => api<unknown>(`/v1/admin/market-templates/${raceClass}`));
  }, [raceClass]);
  return (
    <div className="stack">
      <div className="tabs">
        {(['SPRINT', 'STANDARD', 'ENDURANCE'] as const).map((c) => (
          <button key={c} className={raceClass === c ? 'active' : ''} onClick={() => setRaceClass(c)}>
            {CLASS_LABEL[c]}
          </button>
        ))}
      </div>
      <JsonEditor
        key={raceClass}
        title={`Market template · ${CLASS_LABEL[raceClass]}`}
        hint="Edit the markets array. Changes apply to races scheduled afterwards."
        load={load}
        save={(value) => api<unknown>(`/v1/admin/market-templates/${raceClass}`, { method: 'PUT', body: { markets: (value as { markets?: unknown }).markets ?? value } })}
        transform={(value) => ({ markets: (value as { markets?: unknown } | null)?.markets ?? [] })}
      />
    </div>
  );
}

function Seasons() {
  const seasons = useAsync(() => api<Season[]>('/v1/admin/seasons'), []);
  const [form, setForm] = useState({ name: '', startsAt: '', endsAt: '', startingGrant: '10000', dailyGrant: '50' });
  const [result, setResult] = useState<Result>(null);
  const create = async () => {
    setResult(null);
    try {
      await api<Season>('/v1/admin/seasons', {
        method: 'POST',
        body: {
          name: form.name,
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
          startingGrant: Number(form.startingGrant),
          dailyGrant: Number(form.dailyGrant),
        },
      });
      setResult({ kind: 'success', text: 'Season created.' });
      seasons.reload();
    } catch (error) {
      setResult(error instanceof RangeError ? { kind: 'error', text: 'Pick valid start and end dates.' } : fail(error));
    }
  };
  return (
    <div className="admin-grid">
      <Card title="Seasons">
        {seasons.error ? <ErrorNotice error={seasons.error} /> : null}
        {!seasons.data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Window</th>
                  <th className="right">Grants</th>
                </tr>
              </thead>
              <tbody>
                {seasons.data.map((season) => (
                  <tr key={season.id}>
                    <td>
                      <b>{season.name}</b>
                      <div className="tiny muted mono">{season.id}</div>
                    </td>
                    <td>
                      <span className={`chip ${season.status === 'ACTIVE' ? 'green' : 'grey'}`}>{season.status}</span>
                    </td>
                    <td className="small">
                      {fmtDateTime(season.startsAt)} → {fmtDateTime(season.endsAt)}
                    </td>
                    <td className="right num small">
                      {fmtPoints(season.startingGrant)} / {fmtPoints(season.dailyGrant)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Create season" hint="Seasons cannot overlap and must last at least two hours.">
        <label className="field">
          <span>Name</span>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <div className="form-grid form-pair">
          <label className="field">
            <span>Starts</span>
            <input className="input" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
          </label>
          <label className="field">
            <span>Ends</span>
            <input className="input" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
          </label>
          <label className="field">
            <span>Starting grant</span>
            <input className="input" type="number" value={form.startingGrant} onChange={(e) => setForm({ ...form, startingGrant: e.target.value })} />
          </label>
          <label className="field">
            <span>Daily grant</span>
            <input className="input" type="number" value={form.dailyGrant} onChange={(e) => setForm({ ...form, dailyGrant: e.target.value })} />
          </label>
        </div>
        <div>
          <button className="btn primary" onClick={() => void create()} disabled={!form.name || !form.startsAt || !form.endsAt}>
            Create season
          </button>
        </div>
        <ResultNotice result={result} />
      </Card>
    </div>
  );
}

type AdminUser = User & { bannedAt: string | null; banReason: string | null; wallets: { seasonId: string; balance: number; inOpenBets: number }[] };

function UserDetail({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const detail = useAsync(() => api<AdminUser>(`/v1/admin/users/${userId}`), [userId]);
  const ledger = useAsync(() => api<{ items: LedgerEntry[] }>(`/v1/admin/users/${userId}/ledger`), [userId]);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [banReason, setBanReason] = useState('');
  const [result, setResult] = useState<Result>(null);
  if (detail.error) return <ErrorNotice error={detail.error} />;
  if (!detail.data) return <Loading />;
  const u = detail.data;
  const adjust = async () => {
    setResult(null);
    try {
      const response = await api<{ balance: number }>(`/v1/admin/users/${userId}/adjust`, { method: 'POST', body: { amount: Number(amount), reason } });
      setResult({ kind: 'success', text: `Adjusted. New balance ${fmtPoints(response.balance)} pts.` });
      setAmount('');
      detail.reload();
      ledger.reload();
    } catch (error) {
      setResult(fail(error));
    }
  };
  const ban = async (banned: boolean) => {
    setResult(null);
    try {
      await api(`/v1/admin/users/${userId}/ban`, { method: 'POST', body: banned ? { banned, reason: banReason || undefined } : { banned } });
      setResult({ kind: 'success', text: banned ? 'User banned and sessions revoked.' : 'User unbanned.' });
      detail.reload();
      onChanged();
    } catch (error) {
      setResult(fail(error));
    }
  };
  return (
    <div className="stack">
      <dl className="kv">
        <dt>Name</dt>
        <dd>
          <b>{u.displayName}</b> {u.role === 'ADMIN' && <span className="chip gold">admin</span>} {u.bannedAt && <span className="chip red">banned</span>}
        </dd>
        <dt>User id</dt>
        <dd className="mono">{u.userId}</dd>
        <dt>Providers</dt>
        <dd>{u.providers.join(', ') || '—'}</dd>
        <dt>Joined</dt>
        <dd>{fmtDateTime(u.createdAt)}</dd>
        {u.bannedAt && (
          <>
            <dt>Banned</dt>
            <dd>
              {fmtDateTime(u.bannedAt)} {u.banReason ? `· ${u.banReason}` : ''}
            </dd>
          </>
        )}
        {u.wallets.map((wallet) => (
          <span key={wallet.seasonId} style={{ display: 'contents' }}>
            <dt>Wallet {wallet.seasonId.slice(-5)}</dt>
            <dd className="num">
              {fmtPoints(wallet.balance)} pts · {fmtPoints(wallet.inOpenBets)} in open bets
            </dd>
          </span>
        ))}
      </dl>
      <div className="form-grid" style={{ gridTemplateColumns: '110px 1fr auto' }}>
        <label className="field">
          <span>Amount</span>
          <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="+/-" />
        </label>
        <label className="field">
          <span>Reason</span>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button className="btn" onClick={() => void adjust()} disabled={!amount || Number(amount) === 0 || !reason}>
          Adjust points
        </button>
      </div>
      <div className="form-grid" style={{ gridTemplateColumns: '1fr auto' }}>
        <label className="field">
          <span>Ban reason</span>
          <input className="input" value={banReason} onChange={(e) => setBanReason(e.target.value)} />
        </label>
        {u.bannedAt ? (
          <button className="btn" onClick={() => void ban(false)}>
            Unban
          </button>
        ) : (
          <button className="btn danger" onClick={() => void ban(true)}>
            Ban user
          </button>
        )}
      </div>
      <ResultNotice result={result} />
      <h3>Ledger</h3>
      {!ledger.data ? (
        <Loading />
      ) : ledger.data.items.length === 0 ? (
        <div className="small muted">No entries.</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 260 }}>
          <table className="table">
            <tbody>
              {ledger.data.items.slice(0, 60).map((entry) => (
                <tr key={entry.entryId}>
                  <td className="small">{fmtDateTime(entry.createdAt)}</td>
                  <td className="small">{entry.type}</td>
                  <td className="right num">{fmtSigned(entry.amount)}</td>
                  <td className="right num muted">{fmtPoints(entry.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Users() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const users = useAsync(() => api<{ items: { userId: string; displayName: string; role: string; bannedAt: string | null; createdAt: string }[] }>(`/v1/admin/users${qs({ q: search })}`), [search]);
  return (
    <div className="admin-grid">
      <Card title="Users">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q);
          }}
        >
          <input className="input" style={{ flex: 1 }} placeholder="Name or user id" value={q} onChange={(e) => setQ(e.target.value)} data-testid="admin-user-search" />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
        {users.error ? <ErrorNotice error={users.error} /> : null}
        {!users.data ? (
          <Loading />
        ) : users.data.items.length === 0 ? (
          <div className="small muted">No users found.</div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table className="table">
              <tbody>
                {users.data.items.map((user) => (
                  <tr key={user.userId} className={selected === user.userId ? 'me' : ''} style={{ cursor: 'pointer' }} onClick={() => setSelected(user.userId)} data-testid="admin-user-row">
                    <td>
                      <b>{user.displayName}</b>
                      <div className="tiny muted mono">{user.userId}</div>
                    </td>
                    <td>
                      {user.role === 'ADMIN' && <span className="chip gold">admin</span>} {user.bannedAt && <span className="chip red">banned</span>}
                    </td>
                    <td className="small muted">{fmtDateTime(user.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="User detail">{selected ? <UserDetail key={selected} userId={selected} onChanged={users.reload} /> : <div className="small muted">Select a user.</div>}</Card>
    </div>
  );
}

type DlqItem = { id: string; consumer: string; topic: string; partition: number; offset: string; key: string | null; eventType: string | null; error: string; createdAt: string; replayedAt: string | null };
type AuditItem = { id: string; adminUserId: string; adminName: string | null; action: string; targetType: string; targetId: string; before: unknown; after: unknown; reason: string | null; createdAt: string };

function Ops() {
  const dlq = useAsync(() => api<{ items: DlqItem[] }>('/v1/admin/dlq'), []);
  const audit = usePaged((cursor) => api<Page<AuditItem>>(`/v1/admin/audit${qs({ cursor, limit: 30 })}`), []);
  const replay = async (id: string) => {
    try {
      await api(`/v1/admin/dlq/${id}/replay`, { method: 'POST' });
      toast('Message replayed.', 'success');
      dlq.reload();
    } catch (error) {
      toast(friendlyError(error), 'error');
    }
  };
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Card title="Dead-letter queue" hint="Messages a consumer could not process. Replay re-publishes the original payload.">
        {dlq.error ? <ErrorNotice error={dlq.error} /> : null}
        {!dlq.data ? (
          <Loading />
        ) : dlq.data.items.length === 0 ? (
          <div className="small muted">The DLQ is empty.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Consumer / topic</th>
                  <th>Event</th>
                  <th>Error</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {dlq.data.items.map((item) => (
                  <tr key={item.id} data-testid="admin-dlq-row">
                    <td className="small">{fmtDateTime(item.createdAt)}</td>
                    <td className="small">
                      {item.consumer}
                      <div className="tiny muted">
                        {item.topic}#{item.partition}@{item.offset}
                      </div>
                    </td>
                    <td className="small">{item.eventType ?? '—'}</td>
                    <td className="small" style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>
                      {item.error}
                    </td>
                    <td className="right">
                      {item.replayedAt ? (
                        <span className="chip grey">replayed</span>
                      ) : (
                        <button className="btn small" onClick={() => void replay(item.id)}>
                          Replay
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Audit log">
        {audit.error ? <ErrorNotice error={audit.error} /> : null}
        {audit.loading && !audit.items.length ? (
          <Loading />
        ) : audit.items.length === 0 ? (
          <Empty>No admin actions yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Admin</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {audit.items.map((item) => (
                  <tr key={item.id} data-testid="admin-audit-row">
                    <td className="small">{fmtDateTime(item.createdAt)}</td>
                    <td className="small">{item.adminName ?? item.adminUserId}</td>
                    <td>
                      <span className="chip">{item.action}</span>
                    </td>
                    <td className="small mono">
                      {item.targetType}:{item.targetId}
                    </td>
                    <td className="small">
                      {item.reason && <div>{item.reason}</div>}
                      <details className="json">
                        <summary>before / after</summary>
                        <pre>{JSON.stringify({ before: item.before, after: item.after }, null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager hasMore={audit.hasMore} loading={audit.loading} onMore={audit.loadMore} />
      </Card>
    </div>
  );
}

const TABS = [
  { id: 'races', label: 'Races' },
  { id: 'markets', label: 'Markets' },
  { id: 'programme', label: 'Programme' },
  { id: 'seasons', label: 'Seasons' },
  { id: 'users', label: 'Users' },
  { id: 'ops', label: 'DLQ & audit' },
] as const;

export function AdminPage() {
  const session = useSession();
  const { query } = useLocation();
  const tab = TABS.find((t) => t.id === query.get('tab'))?.id ?? 'races';
  if (session.status === 'loading') return <Loading />;
  if (!session.user) return <SignInPrompt message="Sign in as an administrator." />;
  if (session.user.role !== 'ADMIN') {
    return (
      <div className="card empty">
        <h2>Admins only</h2>
        <p>Your account does not have the ADMIN role.</p>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">Operations</div>
          <h1>Admin</h1>
          <p>Every write is audited. Sealed scripts stay sealed until a race finishes, for admins too.</p>
        </div>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setQuery({ tab: t.id === 'races' ? null : t.id })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'races' && (
        <div className="admin-grid">
          <ScheduleRace />
          <CancelRace />
          <UpcomingRaces />
        </div>
      )}
      {tab === 'markets' && (
        <div className="stack" style={{ gap: 16 }}>
          <div className="admin-grid">
            <MarketControl />
          </div>
          <Templates />
        </div>
      )}
      {tab === 'programme' && (
        <JsonEditor
          title="Race programme"
          hint="racesPerHour, classMix.slots, speciesRotation, horizonHours, recoveryMinutes per class. Saving creates a new version."
          load={programmeLoad}
          save={programmeSave}
          transform={stripProgramme}
        />
      )}
      {tab === 'seasons' && <Seasons />}
      {tab === 'users' && <Users />}
      {tab === 'ops' && <Ops />}
    </div>
  );
}
