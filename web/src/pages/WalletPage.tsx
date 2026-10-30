import { useEffect, useState } from 'react';
import { Empty, ErrorNotice, Loading, Pager, SignInPrompt } from '../components/ui';
import { api, qs, useSession } from '../lib/api';
import { dailyStore, refreshDaily, refreshWallet, seasonStore, toast, walletStore } from '../lib/app';
import { friendlyError } from '../lib/errors';
import { fmtCountdown, fmtDateTime, fmtPoints, fmtSigned } from '../lib/format';
import { useNow, usePaged, useStore } from '../lib/hooks';
import type { LedgerEntry, Page } from '../lib/types';

const LEDGER_LABEL: Record<string, string> = {
  SIGNUP_GRANT: 'Season grant',
  SEASON_GRANT: 'Season grant',
  DAILY_GRANT: 'Daily reward',
  BET_STAKE: 'Stake',
  BET_PAYOUT: 'Payout',
  BET_REFUND: 'Refund',
  CASHOUT: 'Cash-out',
  ADMIN_ADJUST: 'Adjustment',
};

export function WalletPage() {
  const session = useSession();
  const wallet = useStore(walletStore);
  const daily = useStore(dailyStore);
  const season = useStore(seasonStore);
  const now = useNow(1000);
  const [claiming, setClaiming] = useState(false);
  const authed = session.status === 'authed';
  const ledger = usePaged(
    (cursor) => (authed ? api<Page<LedgerEntry>>(`/v1/me/wallet/ledger${qs({ cursor, limit: 25 })}`) : Promise.resolve({ items: [], nextCursor: null })),
    [authed],
  );

  useEffect(() => {
    if (!authed) return;
    refreshWallet(0);
    void refreshDaily();
  }, [authed]);

  if (session.status === 'loading') return <Loading />;
  if (!authed) return <SignInPrompt message="Sign in to see your wallet." />;

  const claim = async () => {
    setClaiming(true);
    try {
      const result = await api<{ amount: number; balance: number; streak?: number }>('/v1/me/rewards/daily', { method: 'POST' });
      toast(`Daily reward claimed: +${fmtPoints(result.amount)} pts`, 'success');
      walletStore.set((w) => (w ? { ...w, balance: result.balance } : w));
      refreshWallet();
      await refreshDaily();
      ledger.reload();
    } catch (error) {
      toast(friendlyError(error), 'error');
      await refreshDaily();
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">{season ? season.name : 'Wallet'}</div>
          <h1>Wallet</h1>
          <p>Points are fictional and have no cash value. Your season balance is rebuilt from an append-only ledger.</p>
        </div>
      </div>
      <div className="tiles">
        <div className="stat-tile">
          <div className="label">Balance</div>
          <div className="value">
            <span data-testid="wallet-balance">{wallet ? String(Math.round(wallet.balance)) : ''}</span>
            <span className="small muted"> pts</span>
          </div>
        </div>
        <div className="stat-tile">
          <div className="label">In open bets</div>
          <div className="value">{wallet ? fmtPoints(wallet.inOpenBets) : '—'}</div>
        </div>
        <div className="stat-tile">
          <div className="label">Leaderboard score</div>
          <div className="value">{wallet ? fmtPoints(wallet.rankScore) : '—'}</div>
          <div className="tiny muted">balance + stakes in open bets</div>
        </div>
        <div className="stat-tile">
          <div className="label">Daily reward</div>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn reward" disabled={!daily?.claimable || claiming} onClick={() => void claim()}>
              {daily?.claimable ? `Claim +${daily.amount}` : daily ? `Next in ${fmtCountdown(Date.parse(daily.nextClaimAt) - now)}` : '…'}
            </button>
          </div>
          {daily && (
            <div className="tiny muted" style={{ marginTop: 6 }}>
              Streak {daily.streak} day{daily.streak === 1 ? '' : 's'} · best {daily.bestStreak}
            </div>
          )}
        </div>
      </div>
      <section className="card flush">
        <div className="card-head" style={{ padding: '14px 16px 0' }}>
          <h2>Ledger</h2>
        </div>
        {ledger.error ? <ErrorNotice error={ledger.error} onRetry={ledger.reload} /> : null}
        {ledger.loading && !ledger.items.length ? (
          <Loading />
        ) : ledger.items.length === 0 ? (
          <Empty>No ledger entries yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th className="right">Amount</th>
                  <th className="right">Balance</th>
                  <th className="hide-sm">Reference</th>
                </tr>
              </thead>
              <tbody>
                {ledger.items.map((entry) => (
                  <tr key={entry.entryId} data-testid="ledger-row" data-type={entry.type}>
                    <td className="small">{fmtDateTime(entry.createdAt)}</td>
                    <td>
                      <span className={`chip ${entry.amount >= 0 ? 'green' : 'red'}`}>{LEDGER_LABEL[entry.type] ?? entry.type}</span>
                    </td>
                    <td className="right num" style={{ color: entry.amount >= 0 ? 'var(--turf)' : 'var(--danger)', fontWeight: 800 }}>
                      {fmtSigned(entry.amount)}
                    </td>
                    <td className="right num">{fmtPoints(entry.balanceAfter)}</td>
                    <td className="mono tiny muted hide-sm">{entry.refId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager hasMore={ledger.hasMore} loading={ledger.loading} onMore={ledger.loadMore} />
      </section>
    </div>
  );
}
