import { Avatar, Empty, ErrorNotice, Loading } from '../components/ui';
import { api, qs, useSession } from '../lib/api';
import { fmtPoints } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { setQuery, useLocation } from '../lib/router';
import type { LeaderboardEntry, Season } from '../lib/types';

const BOARDS = [
  { id: 'balance', label: 'Balance', hint: 'Balance plus stakes in open bets: only settled bets move you.' },
  { id: 'biggest-payout', label: 'Biggest payout', hint: 'The single largest return this season.' },
  { id: 'roi', label: 'Best ROI', hint: 'Return on stakes. Needs at least 20 settled bets.' },
  { id: 'win-streak', label: 'Win streak', hint: 'Longest run of winning bets. Needs at least 20 settled bets.' },
] as const;

function score(board: string, value: number): string {
  if (board === 'roi') return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
  if (board === 'win-streak') return `${value} win${value === 1 ? '' : 's'}`;
  return `${fmtPoints(value)} pts`;
}

export function LeaderboardsPage() {
  const session = useSession();
  const { query } = useLocation();
  const board = BOARDS.find((b) => b.id === query.get('board'))?.id ?? 'balance';
  const around = query.get('around') === 'me';
  const seasons = useAsync(() => api<Season[]>('/v1/seasons'), []);
  const seasonId = query.get('season') ?? seasons.data?.find((s) => s.status === 'ACTIVE')?.id ?? seasons.data?.[0]?.id ?? null;
  const authed = session.status === 'authed';
  const list = useAsync(
    () =>
      seasonId
        ? api<{ items: LeaderboardEntry[]; me: LeaderboardEntry | null }>(`/v1/seasons/${seasonId}/leaderboards/${board}${qs({ limit: 50, around: around && authed ? 'me' : null })}`)
        : Promise.resolve(null),
    [seasonId, board, around, authed],
  );
  const me = list.data?.me ?? null;
  const hint = BOARDS.find((b) => b.id === board)!.hint;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">Seasons</div>
          <h1>Leaderboards</h1>
          <p>{hint}</p>
        </div>
        <label className="field">
          <span>Season</span>
          <select className="select" value={seasonId ?? ''} onChange={(e) => setQuery({ season: e.target.value })}>
            {(seasons.data ?? []).map((season) => (
              <option key={season.id} value={season.id}>
                {season.name} · {season.status.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row wrap">
        <div className="tabs">
          {BOARDS.map((b) => (
            <button key={b.id} className={board === b.id ? 'active' : ''} onClick={() => setQuery({ board: b.id === 'balance' ? null : b.id })} data-board={b.id}>
              {b.label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {authed && (
          <div className="tabs">
            <button className={!around ? 'active' : ''} onClick={() => setQuery({ around: null })}>
              Top 50
            </button>
            <button className={around ? 'active' : ''} onClick={() => setQuery({ around: 'me' })} data-testid="leaderboard-around-me">
              Around me
            </button>
          </div>
        )}
      </div>
      {me && (
        <div className="card row wrap">
          <Avatar name={me.displayName} url={me.avatarUrl} />
          <b>You</b>
          <span className="muted">rank</span>
          <b className="num">#{me.rank}</b>
          <span className="spacer" />
          <b className="num">{score(board, me.score)}</b>
        </div>
      )}
      {authed && list.data && !me && <div className="notice info small">You are not ranked on this board yet. Settle some bets to get on it.</div>}
      <section className="card flush">
        {list.error ? <ErrorNotice error={list.error} onRetry={list.reload} /> : null}
        {list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty>No one is ranked yet this season.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Rank</th>
                  <th>Racer</th>
                  <th className="right">Score</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((entry) => (
                  <tr key={entry.userId} className={entry.userId === session.user?.userId ? 'me' : ''} data-testid="leaderboard-row" data-rank={entry.rank} data-user-id={entry.userId}>
                    <td>
                      <span className={`pos-badge${entry.rank <= 3 ? ` p${entry.rank}` : ''}`}>{entry.rank}</span>
                    </td>
                    <td>
                      <span className="row">
                        <Avatar name={entry.displayName} url={entry.avatarUrl} />
                        <b>{entry.displayName}</b>
                        {entry.userId === session.user?.userId && <span className="chip gold">you</span>}
                      </span>
                    </td>
                    <td className="right num" style={{ fontWeight: 800 }}>
                      {score(board, entry.score)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
