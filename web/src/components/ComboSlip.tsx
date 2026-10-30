import { useEffect, useRef, useState } from 'react';
import { api, ApiError, useSession } from '../lib/api';
import { onBet, refreshWallet, walletStore, watchBet } from '../lib/app';
import { clearCombo, comboStore, patchCombo, removeComboLeg, selectionKey } from '../lib/combo';
import { uuid } from '../lib/crypto';
import { friendlyCode, friendlyError } from '../lib/errors';
import { fmtPoints, fmtPrice, marketLabel } from '../lib/format';
import { useStore } from '../lib/hooks';
import { Link } from '../lib/router';
import type { Bet, PricePolicy } from '../lib/types';

type Placement = { kind: 'placing' | 'pending' | 'accepted' | 'rejected' | 'error'; bet?: Bet; code?: string; message: string };
type Quote = { combinedPrice: number; legs: { marketId: string; price: number; priceVersion: number }[] };

function placementFromBet(bet: Bet): Placement {
  if (bet.status === 'PENDING') return { kind: 'pending', bet, message: 'Combo PENDING · waiting for confirmation…' };
  if (bet.status === 'REJECTED') return { kind: 'rejected', bet, code: bet.rejectReason ?? undefined, message: `Combo REJECTED · ${friendlyCode(bet.rejectReason)}` };
  const price = bet.lockedPrice ?? bet.legs.reduce((p, leg) => p * (leg.lockedPrice ?? leg.acceptedPrice), 1);
  if (bet.status === 'WON') return { kind: 'accepted', bet, message: `Combo WON · paid ${fmtPoints(bet.payout)} pts` };
  if (bet.status === 'LOST') return { kind: 'rejected', bet, message: `Combo LOST · ${fmtPoints(bet.stake)} pts at ${fmtPrice(price)}` };
  if (bet.status === 'VOID') return { kind: 'accepted', bet, message: 'Combo VOID · stake refunded' };
  if (bet.status === 'CASHED_OUT') return { kind: 'accepted', bet, message: `Combo CASHED_OUT · ${fmtPoints(bet.cashOutAmount ?? bet.payout)} pts returned` };
  return { kind: 'accepted', bet, message: `Combo ${bet.status} · ${fmtPoints(bet.stake)} pts at ${fmtPrice(price)} · returns ${fmtPoints(Math.floor(bet.stake * price))} pts` };
}

export function ComboSlip({ docked = false }: { docked?: boolean }) {
  const combo = useStore(comboStore);
  const session = useSession();
  const wallet = useStore(walletStore);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<unknown>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const keyRef = useRef<string | null>(null);
  const stopWatch = useRef<(() => void) | null>(null);
  const placedId = placement?.bet?.id;

  const signature = combo.legs.map((leg) => `${leg.marketId}:${selectionKey(leg.selection)}`).join('|');

  useEffect(() => {
    if (!combo.legs.length) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      const legs = comboStore.get().legs;
      if (!legs.length) return;
      try {
        const result = await api<Quote>('/v1/bets/combos/quote', { method: 'POST', body: { legs: legs.map((leg) => ({ marketId: leg.marketId, selection: leg.selection })) } });
        if (cancelled) return;
        setQuote(result);
        setQuoteError(null);
        const state = comboStore.get();
        const byMarket = new Map(result.legs.map((leg) => [leg.marketId, leg]));
        let changed = false;
        const next = state.legs.map((leg) => {
          const q = byMarket.get(leg.marketId);
          if (q && (q.price !== leg.price || q.priceVersion !== leg.priceVersion)) {
            changed = true;
            return { ...leg, price: q.price, priceVersion: q.priceVersion };
          }
          return leg;
        });
        if (changed) comboStore.set({ ...state, legs: next });
      } catch (error) {
        if (cancelled) return;
        setQuote(null);
        setQuoteError(error);
      }
    };
    void run();
    const id = setInterval(run, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [signature]);

  useEffect(
    () =>
      onBet((bet) => {
        if (bet.id !== placedId) return;
        const next = placementFromBet(bet);
        setPlacement(next);
        if (next.kind === 'accepted') {
          refreshWallet();
          clearCombo();
        }
      }),
    [placedId],
  );

  useEffect(() => () => stopWatch.current?.(), []);

  useEffect(() => {
    if (comboStore.get().legs.length > 0) setPlacement((current) => (current && (current.kind === 'accepted' || current.kind === 'rejected' || current.kind === 'error') ? null : current));
  }, [signature]);

  if (!combo.legs.length && !placement) return null;

  const raceCounts = new Map<string, number>();
  for (const leg of combo.legs) raceCounts.set(leg.raceId, (raceCounts.get(leg.raceId) ?? 0) + 1);
  const combined = quote?.combinedPrice ?? combo.legs.reduce((p, leg) => p * leg.price, 1);
  const stake = Number(combo.stake);
  const stakeValid = Number.isInteger(stake) && stake >= 1;

  const place = async () => {
    if (session.status !== 'authed') {
      setPlacement({ kind: 'error', code: 'SIGN_IN_REQUIRED', message: friendlyCode('SIGN_IN_REQUIRED') });
      return;
    }
    if (!stakeValid) {
      setPlacement({ kind: 'error', code: 'STAKE_OUT_OF_RANGE', message: friendlyCode('STAKE_OUT_OF_RANGE') });
      return;
    }
    const key = keyRef.current ?? uuid();
    keyRef.current = key;
    setPlacement({ kind: 'placing', message: 'Placing combo…' });
    try {
      const bet = await api<Bet>('/v1/bets/combos', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: {
          legs: combo.legs.map((leg) => ({ marketId: leg.marketId, selection: leg.selection, acceptedPrice: leg.price, priceVersion: leg.priceVersion })),
          stake,
          acceptPriceChanges: combo.policy,
        },
      });
      keyRef.current = null;
      const next = placementFromBet(bet);
      setPlacement(next);
      if (next.kind === 'accepted') {
        refreshWallet();
        clearCombo();
      }
      if (bet.status === 'PENDING') {
        stopWatch.current?.();
        stopWatch.current = watchBet(bet.id, (b) => b.status !== 'PENDING');
      }
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'UNKNOWN';
      if (code !== 'NETWORK_ERROR') keyRef.current = null;
      setPlacement({ kind: 'error', code, message: friendlyError(error) });
    }
  };

  const quoteCode = quoteError instanceof ApiError ? quoteError.code : null;
  const message =
    placement ??
    (quoteError
      ? { kind: 'error' as const, code: quoteCode ?? undefined, message: quoteCode === 'BETTING_CLOSED' || quoteCode === 'MARKET_SUSPENDED' ? `One of the legs: ${friendlyError(quoteError)}` : friendlyError(quoteError) }
      : combo.legs.length < 2
        ? { kind: 'pending' as const, message: 'Add a selection from another race to build a combo.' }
        : null);

  if (!combo.open) {
    return (
      <div className={`combo collapsed${docked ? ' docked' : ''}`} data-testid="combo-slip">
        <button className="btn ghost small" onClick={() => patchCombo({ open: true })}>
          Combo · {combo.legs.length} leg{combo.legs.length === 1 ? '' : 's'} · @{fmtPrice(combined)}
        </button>
      </div>
    );
  }

  return (
    <div className={`combo${docked ? ' docked' : ''}`} data-testid="combo-slip">
      <div className="combo-head">
        <h3>
          Combo slip · {combo.legs.length} leg{combo.legs.length === 1 ? '' : 's'}
        </h3>
        <button className="btn ghost small" onClick={() => patchCombo({ open: false })} title="Collapse">
          ▾
        </button>
        <button
          className="btn ghost small"
          onClick={() => {
            clearCombo();
            setPlacement(null);
          }}
          title="Clear combo"
        >
          Clear
        </button>
      </div>
      {combo.legs.map((leg) => {
        const clash = (raceCounts.get(leg.raceId) ?? 0) > 1;
        return (
          <div key={leg.marketId} className={`combo-leg${clash ? ' clash' : ''}`}>
            <div style={{ minWidth: 0 }}>
              <b>{leg.selectionLabel}</b>
              <span className="muted tiny">
                {marketLabel(leg.marketType, leg.marketParams)} · <Link to={`/races/${leg.raceId}`}>{leg.raceLabel}</Link>
                {clash && <span className="chip red" style={{ marginLeft: 6 }}>same race</span>}
              </span>
            </div>
            <span className="num" style={{ fontWeight: 900 }}>
              {fmtPrice(leg.price)}
            </span>
            <button className="btn ghost small" onClick={() => removeComboLeg(leg.marketId)} aria-label="Remove leg">
              ✕
            </button>
          </div>
        );
      })}
      {combo.legs.length > 0 && (
        <>
          <div className="returns">
            <span>Combined price</span>
            <b>{fmtPrice(combined)}</b>
          </div>
          <div className="stake-row">
            <label className="field">
              <span>Stake</span>
              <input
                className="input num"
                data-testid="combo-stake"
                inputMode="numeric"
                placeholder="Points"
                value={combo.stake}
                onChange={(e) => patchCombo({ stake: e.target.value.replace(/[^0-9]/g, '') })}
              />
            </label>
            <label className="field">
              <span>Price changes</span>
              <select className="select" value={combo.policy} onChange={(e) => patchCombo({ policy: e.target.value as PricePolicy })}>
                <option value="NONE">Small changes only</option>
                <option value="BETTER">Better or small drops</option>
                <option value="ANY">Any price</option>
              </select>
            </label>
          </div>
          <div className="returns">
            <span>
              Potential return {wallet ? <span className="muted tiny">· balance {fmtPoints(wallet.balance)}</span> : null}
            </span>
            <b>{stakeValid ? `${fmtPoints(Math.floor(stake * combined))} pts` : '—'}</b>
          </div>
          <button className="btn primary block" data-testid="place-combo" onClick={place} disabled={placement?.kind === 'placing'}>
            Place combo
          </button>
        </>
      )}
      {message && (
        <div
          className={`notice ${message.kind === 'accepted' ? 'success' : message.kind === 'error' || message.kind === 'rejected' ? 'error' : 'info'}`}
          data-testid="combo-message"
        >
          {message.message}
          {message.code && <span className="code">{message.code}</span>}
          {placement && placement.kind !== 'placing' && placement.kind !== 'pending' && (
            <button className="btn ghost small" style={{ marginLeft: 6 }} onClick={() => setPlacement(null)}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
