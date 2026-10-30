import { useEffect } from 'react';
import { BetCard } from '../components/BetCard';
import { Empty, ErrorNotice, Loading, Pager, SignInPrompt } from '../components/ui';
import { api, qs, useSession } from '../lib/api';
import { onBet } from '../lib/app';
import { usePaged } from '../lib/hooks';
import { useRaceInfos } from '../lib/raceCache';
import { Link, setQuery, useLocation } from '../lib/router';
import type { Bet, Page } from '../lib/types';

export function MyBetsPage() {
  const session = useSession();
  const { query } = useLocation();
  const tab = query.get('tab') === 'settled' ? 'settled' : 'open';
  const authed = session.status === 'authed';
  const paged = usePaged(
    (cursor) => (authed ? api<Page<Bet>>(`/v1/me/bets${qs({ status: tab === 'open' ? 'OPEN' : 'SETTLED', cursor, limit: 20 })}`) : Promise.resolve({ items: [], nextCursor: null })),
    [tab, authed],
  );
  const races = useRaceInfos(paged.items.flatMap((bet) => bet.legs.map((leg) => leg.raceId)));

  useEffect(
    () =>
      onBet((bet) => {
        if (paged.items.some((b) => b.id === bet.id && b.status !== bet.status)) paged.reload();
      }),
    [paged.items, paged.reload],
  );

  if (session.status === 'loading') return <Loading />;
  if (!authed) return <SignInPrompt message="Sign in to see your bets." />;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Betting</div>
          <h1>My bets</h1>
          <p>Singles and combos for the current and past seasons. Open bets can be cashed out while their markets trade.</p>
        </div>
        <div className="tabs">
          <button className={tab === 'open' ? 'active' : ''} onClick={() => setQuery({ tab: null })} data-tab="open">
            Open
          </button>
          <button className={tab === 'settled' ? 'active' : ''} onClick={() => setQuery({ tab: 'settled' })} data-tab="settled">
            Settled
          </button>
        </div>
      </div>
      {paged.error ? <ErrorNotice error={paged.error} onRetry={paged.reload} /> : null}
      {paged.loading && !paged.items.length ? (
        <Loading />
      ) : paged.items.length === 0 ? (
        <Empty>
          {tab === 'open' ? 'No open bets. ' : 'Nothing settled yet. '}
          <Link to="/" className="link">
            Find a race
          </Link>
        </Empty>
      ) : (
        <div className="cards bet-cards">
          {paged.items.map((bet) => (
            <BetCard key={bet.id} bet={bet} races={races} cashout="manual" />
          ))}
        </div>
      )}
      <Pager hasMore={paged.hasMore} loading={paged.loading} onMore={paged.loadMore} />
    </div>
  );
}
