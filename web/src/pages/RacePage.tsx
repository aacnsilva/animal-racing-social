import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BetCard } from '../components/BetCard';
import { ErrorNotice, Loading } from '../components/ui';
import { api, ApiError, useSession } from '../lib/api';
import { onBet, toast } from '../lib/app';
import { friendlyError } from '../lib/errors';
import { useAsync, useNow } from '../lib/hooks';
import { useRaceInfos } from '../lib/raceCache';
import { Link } from '../lib/router';
import type { Bet, Market, Page, Race, RaceTick, Venue } from '../lib/types';
import { BetSlip, type SlipSelection } from '../race/BetSlip';
import { Entrants } from '../race/Entrants';
import { MarketsPanel } from '../race/Markets';
import { ReplayPlayback } from '../race/playback';
import { RaceHeader } from '../race/RaceHeader';
import { RaceResult } from '../race/RaceResult';
import { RaceViewer, useReplayTick } from '../race/RaceViewer';
import { RaceFeed, Standings } from '../race/Standings';
import { RaceStream } from '../race/stream';

export function RacePage({ id }: { id: string }) {
  const session = useSession();
  const ready = session.status !== 'loading';
  const userKey = session.user?.userId ?? 'anon';
  const stream = useMemo(() => new RaceStream(id), [id, userKey]);
  const state = useSyncExternalStore(stream.subscribe, stream.getState);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [slip, setSlip] = useState<SlipSelection | null>(null);
  const [replay, setReplay] = useState<ReplayPlayback | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const viewerAnchor = useRef<HTMLDivElement>(null);
  const now = useNow(1000);

  useEffect(() => {
    if (!ready) return;
    stream.start();
    return () => stream.stop();
  }, [stream, ready]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setNotFound(false);
    setLoadError(null);
    (async () => {
      try {
        const [race, markets, bets] = await Promise.all([
          api<Race>(`/v1/races/${id}`),
          api<Market[]>(`/v1/races/${id}/markets`).catch(() => null),
          session.status === 'authed'
            ? api<Page<Bet>>(`/v1/me/bets?raceId=${id}&limit=50`).then((p) => p.items).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (!cancelled) stream.seed(race, markets, bets);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED')) setNotFound(true);
        else setLoadError(error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stream, ready]);

  useEffect(() => onBet((bet) => stream.upsertBet(bet)), [stream]);

  const raceStatus = state.race?.status;
  useEffect(() => {
    if (raceStatus !== 'FINISHED' && raceStatus !== 'SETTLED') return;
    if (state.race?.entrants?.some((e) => e.result)) return;
    const timer = setTimeout(() => {
      api<Race>(`/v1/races/${id}`)
        .then((fresh) => stream.mergeRace(fresh))
        .catch(() => undefined);
    }, 1500);
    return () => clearTimeout(timer);
  }, [raceStatus, stream]);

  const race = state.race;
  const venue = useAsync<Venue | null>(
    () => (race ? api<Venue>(`/v1/venues/${race.venueId}?version=${race.venueVersion}`) : Promise.resolve(null)),
    [race?.venueId, race?.venueVersion],
  );

  const otherRaceIds = state.myBets.flatMap((bet) => bet.legs.map((leg) => leg.raceId)).filter((raceId) => raceId !== id);
  const otherRaces = useRaceInfos(otherRaceIds);
  const replayTick = useReplayTick(replay);
  const displayTick: RaceTick | null = replay ? replayTick : state.tick;

  const onPick = useCallback((selection: SlipSelection) => setSlip(selection), []);

  const watchReplay = useCallback(async () => {
    if (!race) return;
    setReplayLoading(true);
    try {
      const ticks = await api<RaceTick[]>(`/v1/races/${race.id}/ticks`);
      const playback = new ReplayPlayback(ticks, race.tickMs);
      setReplay(playback);
      playback.play();
      viewerAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      toast(friendlyError(error), 'error');
    } finally {
      setReplayLoading(false);
    }
  }, [race?.id, race?.tickMs]);

  if (notFound) {
    return (
      <div className="card empty">
        <h2>Race not found</h2>
        <p>
          <Link to="/" className="link">
            Back to the race card
          </Link>
        </p>
      </div>
    );
  }
  if (!race) return loadError ? <ErrorNotice error={loadError} /> : <Loading label="Loading race…" />;

  const bettingOpen = (race.status === 'OPEN' && now < Date.parse(race.bettingClosesAt)) || race.status === 'LIVE';
  const finished = race.status === 'FINISHED' || race.status === 'SETTLED';
  const entrants = race.entrants ?? [];
  const winMarket = state.markets.find((m) => m.type === 'FINISH_POSITION' && m.params.position === 1);
  const racesForBets: Record<string, Race> = { ...otherRaces, [race.id]: race };
  const replayAvailable = finished;

  return (
    <div>
      <RaceHeader race={race} venue={venue.data} connection={state.connection} now={now} />
      {race.status === 'CANCELLED' && (
        <div className="notice warn" style={{ marginBottom: 16 }}>
          This race was cancelled ({race.cancelledReason ?? 'no reason given'}). All markets are void and stakes are refunded.
        </div>
      )}
      <div className="stage" ref={viewerAnchor}>
        <RaceViewer
          race={race}
          venue={venue.data}
          stream={stream}
          replay={replay}
          displayTick={displayTick}
          feed={state.feed}
          now={now}
          replayAvailable={replayAvailable}
          replayLoading={replayLoading}
          onWatchReplay={() => void watchReplay()}
          onExitReplay={() => {
            replay?.pause();
            setReplay(null);
          }}
        />
        <Standings race={race} tick={displayTick} title={replay ? 'Replay standings' : race.status === 'LIVE' ? 'Live standings' : finished ? 'Final standings' : 'Field'} />
      </div>
      <div className="race-body">
        <main>
          <MarketsPanel race={race} markets={state.markets} bettingOpen={bettingOpen} selected={slip} onPick={onPick} />
          {finished && <RaceResult raceId={race.id} version={state.resultVersion} entrants={entrants} onWatchReplay={() => void watchReplay()} replayLoading={replayLoading} />}
          <Entrants entrants={entrants} winMarket={winMarket} />
        </main>
        <aside>
          {slip && (
            <BetSlip
              race={race}
              markets={state.markets}
              slip={slip}
              bettingOpen={bettingOpen}
              onClose={() => setSlip(null)}
              onPlaced={(bet) => stream.upsertBet(bet)}
              onRequote={(next) => setSlip(next)}
            />
          )}
          <section className="card">
            <div className="card-head">
              <h2>My bets</h2>
              {session.status === 'authed' && (
                <Link to="/bets" className="small link">
                  All bets
                </Link>
              )}
            </div>
            {session.status !== 'authed' ? (
              <div className="small muted">Sign in to bet with your season points.</div>
            ) : state.myBets.length === 0 ? (
              <div className="small muted">No bets on this race yet. Pick a price to get started.</div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {state.myBets.map((bet) => (
                  <BetCard key={bet.id} bet={bet} races={racesForBets} focusRaceId={race.id} live={state.cashouts[bet.id]} cashout="live" />
                ))}
              </div>
            )}
          </section>
          <RaceFeed race={race} feed={state.feed} />
        </aside>
      </div>
    </div>
  );
}
