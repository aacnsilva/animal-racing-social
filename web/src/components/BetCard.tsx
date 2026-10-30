import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { onBet, onCashoutRejected, publishBet, refreshWallet, watchBet } from '../lib/app';
import { uuid } from '../lib/crypto';
import { friendlyCode, friendlyError } from '../lib/errors';
import { fmtDateTime, fmtPoints, fmtPrice, fmtTime, legPrice, marketLabel, selectionLabel } from '../lib/format';
import { Link } from '../lib/router';
import type { Bet, CashOutQuote, Race } from '../lib/types';

export type LiveCashout = { amount: number; quoteId: string; at: number };

type CashState = { kind: 'idle' | 'sending' | 'pending' | 'error' | 'rejected'; message?: string; code?: string };

export function CashOut({ bet, live, poll }: { bet: Bet; live?: LiveCashout; poll: boolean }) {
  const [fetched, setFetched] = useState<LiveCashout | null>(null);
  const [unavailable, setUnavailable] = useState<{ code: string; at: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<CashState>({ kind: 'idle' });
  const stopWatch = useRef<(() => void) | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  const unavailableRef = useRef(unavailable);
  unavailableRef.current = unavailable;

  const fetchQuote = useCallback(async (): Promise<LiveCashout | null> => {
    try {
      const quote = await api<CashOutQuote>(`/v1/bets/${bet.id}/cashout`);
      const value = { amount: quote.amount, quoteId: quote.quoteId, at: Date.now() };
      setFetched(value);
      setUnavailable(null);
      return value;
    } catch (error) {
      setFetched(null);
      setUnavailable({ code: error instanceof ApiError ? error.code : 'UNKNOWN', at: Date.now() });
      return null;
    }
  }, [bet.id]);

  useEffect(() => {
    if (!poll) return;
    void fetchQuote();
    const id = setInterval(() => {
      const current = liveRef.current;
      const blocked = unavailableRef.current;
      if (blocked && Date.now() - blocked.at < (blocked.code === 'MARKET_SUSPENDED' ? 8000 : 20000)) return;
      if (!current || Date.now() - current.at > 4000) void fetchQuote();
    }, 5000);
    return () => clearInterval(id);
  }, [poll, fetchQuote]);

  useEffect(() => () => stopWatch.current?.(), []);

  useEffect(
    () =>
      onCashoutRejected((betId, reason) => {
        if (betId !== bet.id) return;
        setState({ kind: 'rejected', code: reason || undefined, message: `Cash-out rejected · ${friendlyCode(reason || 'NOT_CASHABLE')}` });
      }),
    [bet.id],
  );

  useEffect(() => {
    if (state.kind !== 'pending') return;
    const timer = setTimeout(() => setState({ kind: 'error', message: 'Cash-out not confirmed yet. It may have been rejected; check your notifications.' }), 20_000);
    const off = onBet((updated) => {
      if (updated.id === bet.id && updated.status !== 'ACCEPTED') clearTimeout(timer);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [state.kind, bet.id]);

  const liveUsable = live && (!unavailable || live.at > unavailable.at) && (!fetched || live.at >= fetched.at);
  const current = liveUsable ? live : fetched;
  const blocked = current ? null : unavailable?.code ?? null;

  const confirm = async (shown: LiveCashout, attempt = 0, floor?: number): Promise<void> => {
    setState({ kind: 'sending', message: 'Requesting cash-out…' });
    const minAmount = floor ?? Math.floor(shown.amount * 0.97);
    const fresh = attempt === 0 ? await fetchQuote() : shown;
    const quote = fresh ?? shown;
    if (quote.amount < minAmount) {
      setState({ kind: 'error', message: `Value dropped to ${fmtPoints(quote.amount)} pts. Confirm again.` });
      return;
    }
    try {
      const updated = await api<Bet>(`/v1/bets/${bet.id}/cashout`, {
        method: 'POST',
        headers: { 'Idempotency-Key': uuid() },
        body: { quoteId: quote.quoteId, minAmount },
      });
      publishBet(updated);
      setConfirming(false);
      if (updated.status === 'CASHED_OUT') {
        refreshWallet();
        return;
      }
      setState({ kind: 'pending', message: `Cash-out requested for ${fmtPoints(quote.amount)} pts…` });
      stopWatch.current?.();
      stopWatch.current = watchBet(bet.id, (b) => b.status !== 'ACCEPTED', 25_000);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'UNKNOWN';
      if (code === 'QUOTE_EXPIRED' && attempt < 3) {
        const next = await fetchQuote();
        if (next && next.amount >= minAmount) return confirm(next, attempt + 1, minAmount);
        setState({ kind: 'error', code, message: next ? `Value moved to ${fmtPoints(next.amount)} pts. Confirm again.` : friendlyError(error) });
        return;
      }
      setState({ kind: 'error', code, message: friendlyError(error) });
    }
  };

  const amountText = current ? String(Math.floor(current.amount)) : '';
  return (
    <div className="cashout">
      <span className="small muted">Cash out</span>
      <span className="value">
        <span data-testid="cashout-amount">{amountText}</span>
        {current ? ' pts' : blocked ? '' : poll ? '…' : ''}
      </span>
      {blocked && <span className="tiny muted">{blocked === 'MARKET_SUSPENDED' ? 'suspended' : 'unavailable'}</span>}
      <span className="spacer" />
      {!confirming ? (
        <button
          className="btn small turf"
          data-testid="cashout-button"
          disabled={(!current && poll) || state.kind === 'sending' || state.kind === 'pending'}
          onClick={() => {
            setConfirming(true);
            setState({ kind: 'idle' });
            void fetchQuote();
          }}
        >
          Cash out
        </button>
      ) : (
        <span className="row" style={{ gap: 6 }}>
          <button className="btn small primary" data-testid="cashout-confirm" disabled={!current || state.kind === 'sending'} onClick={() => current && void confirm(current)}>
            Confirm {current ? `${fmtPoints(current.amount)} pts` : ''}
          </button>
          <button className="btn small ghost" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </span>
      )}
      {state.kind !== 'idle' && state.message && (
        <div className={`notice small ${state.kind === 'error' || state.kind === 'rejected' ? 'error' : 'info'}`} style={{ width: '100%' }}>
          {state.message}
          {state.code && <span className="code">{state.code}</span>}
        </div>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  ACCEPTED: 'Open',
  REJECTED: 'Rejected',
  WON: 'Won',
  LOST: 'Lost',
  VOID: 'Void',
  CASHED_OUT: 'Cashed out',
};

export function BetCard({
  bet,
  races,
  focusRaceId,
  live,
  cashout,
}: {
  bet: Bet;
  races: Record<string, Race | undefined>;
  focusRaceId?: string;
  live?: LiveCashout;
  cashout: 'live' | 'manual' | 'none';
}) {
  const price = bet.lockedPrice ?? bet.legs.reduce((p, leg) => p * legPrice(leg), 1);
  const potential = Math.floor(bet.stake * price);
  const firstLeg = bet.legs[0];
  const title =
    bet.type === 'COMBO'
      ? `Combo · ${bet.legs.length} legs`
      : firstLeg
        ? selectionLabel(firstLeg.selection, races[firstLeg.raceId]?.entrants)
        : 'Bet';
  const dead = bet.status === 'LOST' || bet.status === 'REJECTED';
  return (
    <div className={`bet-card${dead ? ' lost' : ''}`} data-testid="my-bet" data-bet-id={bet.id} data-bet-status={bet.status}>
      <div className="top">
        <b title={title}>{title}</b>
        <span className={`chip bet-status-${bet.status}`}>{STATUS_LABEL[bet.status] ?? bet.status}</span>
      </div>
      <div className="legs">
        {bet.legs.map((leg) => {
          const race = races[leg.raceId];
          return (
            <div className="leg" key={leg.legId}>
              <span className={`dot ${dead && leg.status === 'OPEN' ? 'LOST' : leg.status}`} />
              <span style={{ minWidth: 0, flex: 1 }}>
                {bet.type === 'COMBO' && <b>{selectionLabel(leg.selection, race?.entrants)} · </b>}
                {marketLabel(leg.marketType, leg.marketParams)}
                {leg.raceId !== focusRaceId && (
                  <>
                    {' · '}
                    <Link to={`/races/${leg.raceId}`} className="link">
                      {race ? `${fmtTime(race.startAt)} ${race.venueName}` : `Race ${leg.raceId.slice(-5)}`}
                    </Link>
                  </>
                )}
              </span>
              <span className="num">@{fmtPrice(legPrice(leg))}</span>
            </div>
          );
        })}
      </div>
      <div className="figures">
        <span>
          Stake <b>{fmtPoints(bet.stake)}</b>
        </span>
        <span>
          Price <b>{fmtPrice(price)}</b>
        </span>
        {bet.status === 'WON' && (
          <span>
            Paid <b style={{ color: 'var(--accent)' }}>{fmtPoints(bet.payout)}</b>
          </span>
        )}
        {bet.status === 'LOST' && (
          <span>
            Lost <b style={{ color: 'var(--danger)' }}>{fmtPoints(bet.stake)}</b>
          </span>
        )}
        {bet.status === 'CASHED_OUT' && (
          <span>
            Cashed out <b>{fmtPoints(bet.cashOutAmount ?? bet.payout)}</b>
          </span>
        )}
        {(bet.status === 'ACCEPTED' || bet.status === 'PENDING') && (
          <span>
            To return <b>{fmtPoints(potential)}</b>
          </span>
        )}
        {bet.status === 'VOID' && (
          <span>
            Refunded <b>{fmtPoints(bet.payout ?? bet.stake)}</b>
          </span>
        )}
        <span className="muted">{fmtDateTime(bet.requestedAt)}</span>
      </div>
      {bet.status === 'REJECTED' && bet.rejectReason && (
        <div className="notice error small">
          {friendlyCode(bet.rejectReason)}
          <span className="code">{bet.rejectReason}</span>
        </div>
      )}
      {bet.status === 'ACCEPTED' && cashout !== 'none' && <CashOut bet={bet} live={live} poll={cashout === 'live'} />}
    </div>
  );
}
