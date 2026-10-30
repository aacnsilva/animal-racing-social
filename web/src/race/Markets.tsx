import { memo, useEffect, useRef, useState } from 'react';
import { ErrorNotice, Lane, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { fmtPrice, marketLabelOf } from '../lib/format';
import type { Entrant, Market, Race } from '../lib/types';
import type { SlipSelection } from './BetSlip';

type PickHandler = (selection: SlipSelection) => void;

const STATUS_CHIP: Record<string, string> = {
  PENDING: 'grey',
  OPEN: 'green',
  SUSPENDED: 'red',
  CLOSED: 'grey',
  RESULTED: 'gold',
  VOID: 'grey',
};

function MarketStatusChip({ status }: { status: string }) {
  return <span className={`chip ${STATUS_CHIP[status] ?? ''}`}>{status}</span>;
}

function PriceButton({
  entrantId,
  price,
  disabled,
  selected,
  onClick,
}: {
  entrantId: string;
  price: number | null;
  disabled: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const previous = useRef<number | null>(price);
  useEffect(() => {
    const element = ref.current;
    if (element && price !== null && previous.current !== null && price !== previous.current && typeof element.animate === 'function') {
      const up = price > previous.current;
      element.animate([{ boxShadow: `inset 0 0 0 2px ${up ? '#3ddc97' : '#ff6b6b'}` }, { boxShadow: 'inset 0 0 0 2px rgba(0, 0, 0, 0)' }], { duration: 900, easing: 'ease-out' });
    }
    previous.current = price;
  }, [price]);
  return (
    <button
      ref={ref}
      type="button"
      className={`price${selected ? ' selected' : ''}`}
      data-testid="price-button"
      data-entrant-id={entrantId}
      data-price={price ?? ''}
      disabled={disabled || price === null}
      onClick={onClick}
      title={price === null ? 'No price yet' : `Price ${fmtPrice(price)}`}
    >
      {price === null ? '—' : fmtPrice(price)}
    </button>
  );
}

function MarketCardInner({
  market,
  entrants,
  bettingOpen,
  selected,
  onPick,
}: {
  market: Market;
  entrants: Entrant[];
  bettingOpen: boolean;
  selected: SlipSelection | null;
  onPick: PickHandler;
}) {
  const canBet = market.status === 'OPEN' && bettingOpen;
  const prices = new Map(market.selections.map((s) => [s.entrantId, s]));
  const winning = new Set(market.result?.winning ?? []);
  const sorted = [...entrants].sort((a, b) => a.lane - b.lane);
  return (
    <div
      className={`market${market.type === 'TRICAST' ? ' wide' : ''}`}
      data-testid="market"
      data-market-id={market.id}
      data-market-type={market.type}
      data-market-params={JSON.stringify(market.params ?? {})}
      data-market-status={market.status}
    >
      <div className="market-head">
        <h3>{marketLabelOf(market)}</h3>
        <MarketStatusChip status={market.status} />
      </div>
      {market.closesAtLap && market.type !== 'TRICAST' && market.status !== 'RESULTED' && (
        <div className="tiny muted">{market.type === 'LEADER_AT_LAP' ? `Suspends just before lap ${market.params.lap} completes` : `Closes at lap ${market.closesAtLap}`}</div>
      )}
      {market.status === 'SUSPENDED' && <div className="market-veil">Suspended</div>}
      {market.status === 'VOID' && <div className="market-veil">Void · stakes refunded</div>}
      {market.type === 'TRICAST' ? (
        <TricastBuilder market={market} entrants={sorted} canBet={canBet} onPick={onPick} />
      ) : (
        <div className="market-body">
          {sorted.map((entrant) => {
            const selection = prices.get(entrant.entrantId);
            const won = selection ? winning.has(selection.selectionId) || winning.has(entrant.entrantId) : false;
            const isSelected = selected?.marketId === market.id && 'entrantId' in selected.selection && selected.selection.entrantId === entrant.entrantId;
            const nonRunner = entrant.result?.resultStatus === 'NON_RUNNER';
            return (
              <div key={entrant.entrantId} className={`sel-row${won ? ' won' : ''}`}>
                <Lane lane={entrant.lane} small />
                <span className="name" title={entrant.animal.name}>
                  {won ? '✓ ' : ''}
                  {entrant.animal.name}
                  {nonRunner ? ' (NR)' : ''}
                </span>
                <PriceButton
                  entrantId={entrant.entrantId}
                  price={selection ? selection.price : null}
                  disabled={!canBet}
                  selected={isSelected}
                  onClick={() =>
                    selection &&
                    onPick({
                      marketId: market.id,
                      marketType: market.type,
                      marketParams: market.params,
                      selection: { entrantId: entrant.entrantId },
                      label: entrant.animal.name,
                      lane: entrant.lane,
                      price: selection.price,
                      priceVersion: market.priceVersion,
                    })
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const MarketCard = memo(MarketCardInner);

type Quote = { price: number; priceVersion: number; probability: number };

function TricastBuilder({ market, entrants, canBet, onPick }: { market: Market; entrants: Entrant[]; canBet: boolean; onPick: PickHandler }) {
  const [picks, setPicks] = useState<[string, string, string]>(['', '', '']);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const valid = picks.every(Boolean) && new Set(picks).size === 3;
  const winning = market.result?.order?.length ? market.result.order : null;

  const requestQuote = async (silent = false) => {
    if (!valid) return;
    if (!silent) setBusy(true);
    try {
      const result = await api<Quote>(`/v1/markets/${market.id}/quotes`, { method: 'POST', body: { order: picks } });
      setQuote(result);
      setError(null);
    } catch (err) {
      if (!silent) setError(err);
      setQuote(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setQuote(null);
    setError(null);
  }, [picks[0], picks[1], picks[2]]);

  useEffect(() => {
    if (quote && market.priceVersion > quote.priceVersion && market.status === 'OPEN') void requestQuote(true);
  }, [market.priceVersion]);

  const name = (id: string) => entrants.find((e) => e.entrantId === id)?.animal.name ?? id;
  const setPick = (index: number, value: string) => {
    const next = [...picks] as [string, string, string];
    next[index] = value;
    setPicks(next);
  };

  return (
    <div className="stack" data-testid="tricast-builder" style={{ gap: 10 }}>
      <div className="small muted">Pick the exact first three in order. Prices are quoted on demand.</div>
      {winning && <div className="notice success small">Result: {winning.map(name).join(' → ')}</div>}
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {[0, 1, 2].map((index) => (
          <label className="field" key={index}>
            <span>{['1st', '2nd', '3rd'][index]}</span>
            <select className="select" data-testid={`tricast-pick-${index + 1}`} value={picks[index]} onChange={(e) => setPick(index, e.target.value)}>
              <option value="">Select…</option>
              {entrants.map((entrant) => (
                <option key={entrant.entrantId} value={entrant.entrantId} disabled={picks.includes(entrant.entrantId) && picks[index] !== entrant.entrantId}>
                  {entrant.lane} · {entrant.animal.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="row wrap">
        <button className="btn" data-testid="tricast-quote" disabled={!valid || busy} onClick={() => void requestQuote()}>
          {busy ? <Spinner /> : null} Get price
        </button>
        <span className="small muted">Price</span>
        <span className="slip-price" data-testid="tricast-price">
          {quote ? fmtPrice(quote.price) : '—'}
        </span>
        {quote && <span className="tiny muted">({(quote.probability * 100).toFixed(2)}% chance)</span>}
        <span className="spacer" />
        <button
          className="btn primary"
          data-testid="tricast-place"
          disabled={!quote || !canBet}
          onClick={() =>
            quote &&
            onPick({
              marketId: market.id,
              marketType: 'TRICAST',
              marketParams: market.params,
              selection: { order: picks },
              label: picks.map(name).join(' → '),
              lane: null,
              price: quote.price,
              priceVersion: quote.priceVersion,
            })
          }
        >
          Add to bet slip
        </button>
      </div>
      <ErrorNotice error={error} />
    </div>
  );
}

const GROUPS: { title: string; types: Market['type'][] }[] = [
  { title: 'Win & place', types: ['FINISH_POSITION', 'TOP_N'] },
  { title: 'In-running · leader at lap', types: ['LEADER_AT_LAP'] },
  { title: 'Tricast', types: ['TRICAST'] },
];

export function MarketsPanel({
  race,
  markets,
  bettingOpen,
  selected,
  onPick,
}: {
  race: Race;
  markets: Market[];
  bettingOpen: boolean;
  selected: SlipSelection | null;
  onPick: PickHandler;
}) {
  const entrants = race.entrants ?? [];
  const preRace = race.status === 'SCHEDULED' || race.status === 'OPEN' || race.status === 'LOCKED';
  const pendingLaps = markets.filter((m) => m.type === 'LEADER_AT_LAP' && m.status === 'PENDING').map((m) => m.params.lap);
  const visible = markets.filter((m) => !(m.type === 'LEADER_AT_LAP' && m.status === 'PENDING'));
  return (
    <section className="card">
      <div className="card-head">
        <h2>Markets</h2>
        <span className="small muted">
          {race.status === 'LIVE' ? 'In-running: bets are accepted after a short delay.' : bettingOpen ? 'Points only. Prices update live.' : 'Betting is closed.'}
        </span>
      </div>
      {!markets.length && <div className="empty">{race.status === 'CANCELLED' ? 'No markets: this race was cancelled.' : 'Markets are being priced and will appear here shortly.'}</div>}
      <div className="stack" style={{ gap: 18 }}>
        {GROUPS.map((group) => {
          const list = visible.filter((m) => group.types.includes(m.type));
          if (!list.length) {
            if (group.types[0] === 'LEADER_AT_LAP' && (pendingLaps.length > 0 || (preRace && race.class !== 'SPRINT' && markets.length > 0)))
              return (
                <div key={group.title} className="notice info small">
                  Leader-at-lap markets{pendingLaps.length ? ` (laps ${pendingLaps.join(', ')})` : ''} open when the race starts.
                </div>
              );
            return null;
          }
          return (
            <div key={group.title}>
              <div className="section-title">
                <h3 className="muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.75rem' }}>
                  {group.title}
                </h3>
              </div>
              <div className="markets-grid">
                {list.map((market) => (
                  <MarketCard key={market.id} market={market} entrants={entrants} bettingOpen={bettingOpen} selected={selected} onPick={onPick} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
