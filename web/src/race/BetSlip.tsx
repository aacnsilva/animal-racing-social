import { useEffect, useRef, useState } from 'react';
import { Lane, ProviderIcon } from '../components/ui';
import { api, ApiError, login, useSession } from '../lib/api';
import { onBet, refreshWallet, toast, walletStore, watchBet } from '../lib/app';
import { addComboLeg } from '../lib/combo';
import { uuid } from '../lib/crypto';
import { friendlyCode, friendlyError } from '../lib/errors';
import { fmtPoints, fmtPrice, fmtTime, marketLabel } from '../lib/format';
import { useStore } from '../lib/hooks';
import type { Bet, BetSelection, Market, MarketType, PricePolicy, Race } from '../lib/types';

export type SlipSelection = {
  marketId: string;
  marketType: MarketType;
  marketParams: Record<string, number>;
  selection: BetSelection;
  label: string;
  lane: number | null;
  price: number;
  priceVersion: number;
};

type SlipStatus = { kind: 'placing' | 'pending' | 'accepted' | 'rejected' | 'error'; message: string; code?: string; betId?: string };

function statusFromBet(bet: Bet): SlipStatus {
  if (bet.status === 'PENDING') return { kind: 'pending', betId: bet.id, message: 'Bet PENDING · waiting for confirmation…' };
  if (bet.status === 'REJECTED') return { kind: 'rejected', betId: bet.id, code: bet.rejectReason ?? undefined, message: `Bet REJECTED · ${friendlyCode(bet.rejectReason)}` };
  const price = bet.lockedPrice ?? bet.legs[0]?.lockedPrice ?? bet.legs[0]?.acceptedPrice ?? 0;
  if (bet.status === 'WON') return { kind: 'accepted', betId: bet.id, message: `Bet WON · paid ${fmtPoints(bet.payout)} pts` };
  if (bet.status === 'LOST') return { kind: 'rejected', betId: bet.id, message: `Bet LOST · ${fmtPoints(bet.stake)} pts at ${fmtPrice(price)}` };
  if (bet.status === 'VOID') return { kind: 'pending', betId: bet.id, message: 'Bet VOID · stake refunded' };
  if (bet.status === 'CASHED_OUT') return { kind: 'accepted', betId: bet.id, message: `Bet CASHED_OUT · ${fmtPoints(bet.cashOutAmount ?? bet.payout)} pts returned` };
  return {
    kind: 'accepted',
    betId: bet.id,
    message: `Bet ${bet.status} · ${fmtPoints(bet.stake)} pts at ${fmtPrice(price)} · returns ${fmtPoints(Math.floor(bet.stake * price))} pts`,
  };
}

const QUICK = [10, 50, 100, 500];

const MARKET_STATE: Record<string, string> = {
  PENDING: 'This market is not open yet.',
  SUSPENDED: 'This market is suspended right now.',
  CLOSED: 'This market has closed.',
  RESULTED: 'This market has been resulted.',
  VOID: 'This market was voided.',
};

export function BetSlip({
  race,
  markets,
  slip,
  bettingOpen,
  onClose,
  onPlaced,
  onRequote,
}: {
  race: Race;
  markets: Market[];
  slip: SlipSelection;
  bettingOpen: boolean;
  onClose: () => void;
  onPlaced: (bet: Bet) => void;
  onRequote: (slip: SlipSelection) => void;
}) {
  const session = useSession();
  const wallet = useStore(walletStore);
  const [stake, setStake] = useState('');
  const [policy, setPolicy] = useState<PricePolicy>('NONE');
  const [status, setStatus] = useState<SlipStatus | null>(null);
  const keyRef = useRef<string | null>(null);
  const stopWatch = useRef<(() => void) | null>(null);
  const slipKey = `${slip.marketId}:${'order' in slip.selection ? slip.selection.order.join('>') : slip.selection.entrantId}`;

  useEffect(() => {
    setStatus(null);
    keyRef.current = null;
  }, [slipKey]);

  useEffect(() => () => stopWatch.current?.(), []);

  const watchedId = status?.betId;
  useEffect(
    () =>
      onBet((bet) => {
        if (bet.id !== watchedId) return;
        setStatus(statusFromBet(bet));
        if (bet.status !== 'PENDING') refreshWallet();
      }),
    [watchedId],
  );

  const market = markets.find((m) => m.id === slip.marketId);
  let price = slip.price;
  let priceVersion = slip.priceVersion;
  if (market && 'entrantId' in slip.selection) {
    const entrantId = slip.selection.entrantId;
    const current = market.selections.find((s) => s.entrantId === entrantId);
    if (current) {
      price = current.price;
      priceVersion = market.priceVersion;
    }
  }

  useEffect(() => {
    if (!market || !('order' in slip.selection) || market.priceVersion <= slip.priceVersion || market.status !== 'OPEN') return;
    let cancelled = false;
    api<{ price: number; priceVersion: number }>(`/v1/markets/${market.id}/quotes`, { method: 'POST', body: { order: slip.selection.order } })
      .then((quote) => {
        if (!cancelled) onRequote({ ...slip, price: quote.price, priceVersion: quote.priceVersion });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [market?.priceVersion, slipKey]);

  const moved = slip.price !== price;

  const stakeNumber = Number(stake);
  const stakeValid = stake !== '' && Number.isInteger(stakeNumber) && stakeNumber >= 1;
  const marketOpen = market?.status === 'OPEN';
  const authed = session.status === 'authed';

  const place = async () => {
    if (!authed) {
      setStatus({ kind: 'error', code: 'SIGN_IN_REQUIRED', message: friendlyCode('SIGN_IN_REQUIRED') });
      return;
    }
    if (!stakeValid) {
      setStatus({ kind: 'error', code: 'STAKE_OUT_OF_RANGE', message: friendlyCode('STAKE_OUT_OF_RANGE') });
      return;
    }
    const key = keyRef.current ?? uuid();
    keyRef.current = key;
    setStatus({ kind: 'placing', message: 'Placing bet…' });
    try {
      const bet = await api<Bet>(`/v1/markets/${slip.marketId}/bets`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: { selection: slip.selection, stake: stakeNumber, acceptedPrice: price, priceVersion, acceptPriceChanges: policy },
      });
      keyRef.current = null;
      onPlaced(bet);
      setStatus(statusFromBet(bet));
      if (bet.status === 'PENDING') {
        stopWatch.current?.();
        stopWatch.current = watchBet(bet.id, (b) => b.status !== 'PENDING');
      } else refreshWallet();
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'UNKNOWN';
      if (code !== 'NETWORK_ERROR') keyRef.current = null;
      setStatus({ kind: 'error', code, message: friendlyError(error) });
    }
  };

  const addToCombo = () => {
    const result = addComboLeg({
      raceId: race.id,
      raceLabel: `${fmtTime(race.startAt)} ${race.venueName}`,
      raceStartAt: race.startAt,
      marketId: slip.marketId,
      marketType: slip.marketType,
      marketParams: slip.marketParams,
      selection: slip.selection,
      selectionLabel: slip.label,
      price,
      priceVersion,
    });
    toast(result === 'duplicate' ? 'Already in your combo.' : result === 'replaced' ? 'Combo leg updated.' : 'Added to combo slip.', 'success', 2500);
  };

  const tone = status?.kind === 'accepted' ? 'success' : status?.kind === 'error' || status?.kind === 'rejected' ? 'error' : 'info';

  return (
    <section className="slip floating" data-testid="bet-slip">
      <div className="slip-head">
        <h3>Bet slip</h3>
        <button className="btn ghost small" onClick={onClose} aria-label="Close bet slip">
          ✕
        </button>
      </div>
      <div className="slip-sel">
        {slip.lane !== null && <Lane lane={slip.lane} />}
        <div className="what">
          <b>{slip.label}</b>
          <span className="tiny muted">
            {marketLabel(slip.marketType, slip.marketParams)} · {race.venueName}
          </span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="slip-price">{fmtPrice(price)}</div>
          {moved && <div className="tiny muted">was {fmtPrice(slip.price)}</div>}
        </div>
      </div>
      {!marketOpen && market && <div className="notice warn small">{MARKET_STATE[market.status] ?? 'This market is not open.'}</div>}
      {marketOpen && !bettingOpen && <div className="notice warn small">Betting is closed for this race.</div>}
      <div className="stake-row">
        <label className="field">
          <span>Stake (pts)</span>
          <input
            className="input num"
            data-testid="stake-input"
            inputMode="numeric"
            placeholder="0"
            value={stake}
            onChange={(e) => setStake(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void place();
            }}
          />
        </label>
        <label className="field">
          <span>If price changes</span>
          <select className="select" data-testid="accept-changes-select" value={policy} onChange={(e) => setPolicy(e.target.value as PricePolicy)}>
            <option value="NONE">Small changes only</option>
            <option value="BETTER">Better or small drops</option>
            <option value="ANY">Any price</option>
          </select>
        </label>
      </div>
      <div className="quick-stakes">
        {QUICK.map((amount) => (
          <button key={amount} className="btn small" onClick={() => setStake(String((Number(stake) || 0) + amount))}>
            +{amount}
          </button>
        ))}
        {wallet && (
          <button className="btn small" onClick={() => setStake(String(Math.floor(wallet.balance)))} title="All in">
            Max
          </button>
        )}
      </div>
      <div className="returns">
        <span>Potential return</span>
        <b>{stakeValid ? `${fmtPoints(Math.floor(stakeNumber * price))} pts` : '—'}</b>
      </div>
      {authed ? (
        <div className="row">
          <button className="btn primary" style={{ flex: 1 }} data-testid="place-bet" onClick={() => void place()} disabled={status?.kind === 'placing'}>
            Place bet
          </button>
          <button className="btn" data-testid="add-to-combo" onClick={addToCombo} title="Add this selection to a multi-race combo">
            + Combo
          </button>
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row">
            <button className="btn primary" style={{ flex: 1 }} data-testid="place-bet" onClick={() => void place()}>
              Place bet
            </button>
            <button className="btn" data-testid="add-to-combo" onClick={addToCombo}>
              + Combo
            </button>
          </div>
          <div className="row">
            <button className="btn small provider-btn" onClick={() => login('google')}>
              <ProviderIcon provider="google" /> Sign in
            </button>
            <button className="btn small provider-btn" onClick={() => login('github')}>
              <ProviderIcon provider="github" /> Sign in
            </button>
          </div>
        </div>
      )}
      {status && (
        <div className={`notice ${tone}`} data-testid="bet-slip-message">
          {status.message}
          {status.code && <span className="code">{status.code}</span>}
        </div>
      )}
      <div className="tiny muted">Fictional points only. No real money, ever.</div>
    </section>
  );
}
