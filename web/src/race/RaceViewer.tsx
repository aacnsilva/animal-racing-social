import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Spinner } from '../components/ui';
import { fmtClock, fmtCountdown } from '../lib/format';
import { readLocal, writeLocal } from '../lib/hooks';
import type { Entrant, Race, RaceTick, Venue } from '../lib/types';
import { eventText, nameLookup, type Tone } from './events';
import { LivePlayback, StaticPlayback, type FrameSource, type ReplayPlayback } from './playback';
import type { CameraMode, RaceScene } from './scene';
import type { FeedItem, RaceStream } from './stream';

const CAMERAS: { mode: CameraMode; label: string; short: string }[] = [
  { mode: 'follow', label: 'Follow', short: 'Follow' },
  { mode: 'tv', label: 'Trackside', short: 'Side' },
  { mode: 'overview', label: 'Overview', short: 'Overview' },
];

const noopSubscribe = () => () => undefined;

function buildStaticSource(entrants: Entrant[], finished: boolean, totalLength: number): FrameSource {
  if (finished) {
    return new StaticPlayback(
      entrants.map((e) => ({
        id: e.entrantId,
        lane: e.lane,
        dist: e.result
          ? e.result.resultStatus === 'FINISHED' || e.result.resultStatus === 'DISQUALIFIED'
            ? totalLength
            : e.result.distanceCovered
          : 0,
        state:
          e.result && (e.result.resultStatus === 'DNF' || e.result.resultStatus === 'NON_RUNNER')
            ? 'DNF'
            : e.result
              ? 'FINISHED'
              : 'RUNNING',
        pos: e.result?.officialPosition,
      })),
    );
  }
  return new StaticPlayback(entrants.map((e) => ({ id: e.entrantId, lane: e.lane })));
}

function ReplayBar({ replay, onExit }: { replay: ReplayPlayback; onExit: () => void }) {
  const position = useSyncExternalStore(
    (listener) => replay.subscribe(listener),
    () => Math.floor(replay.positionMs / 250),
  );
  const playing = useSyncExternalStore(
    (listener) => replay.subscribe(listener),
    () => replay.isPlaying,
  );
  const speed = useSyncExternalStore(
    (listener) => replay.subscribe(listener),
    () => replay.speed,
  );
  return (
    <div className="replay-bar">
      <button
        className="btn small"
        onClick={() => (playing ? replay.pause() : replay.play())}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(1, replay.durationMs)}
        step={250}
        value={position * 250}
        onChange={(e) => replay.seek(Number(e.target.value))}
        aria-label="Scrub replay"
      />
      <span className="num small">
        {fmtClock(position * 250)} / {fmtClock(replay.durationMs)}
      </span>
      <span className="speed">
        {[1, 2, 4, 8].map((s) => (
          <button key={s} className={speed === s ? 'active' : ''} onClick={() => replay.setSpeed(s)}>
            {s}×
          </button>
        ))}
      </span>
      <button className="btn small ghost" onClick={onExit} style={{ color: '#fff' }}>
        Exit
      </button>
    </div>
  );
}

export function RaceViewer({
  race,
  venue,
  stream,
  replay,
  displayTick,
  feed,
  now,
  replayAvailable,
  replayLoading,
  onWatchReplay,
  onExitReplay,
  focusId,
  onFocus,
}: {
  race: Race;
  venue: Venue | null;
  stream: RaceStream;
  replay: ReplayPlayback | null;
  displayTick: RaceTick | null;
  feed: FeedItem[];
  now: number;
  replayAvailable: boolean;
  replayLoading: boolean;
  onWatchReplay: () => void;
  onExitReplay: () => void;
  focusId: string | null;
  onFocus: (entrantId: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<RaceScene | null>(null);
  const sceneReady = scene !== null;
  const [webglError, setWebglError] = useState<string | null>(null);
  const [mode, setMode] = useState<CameraMode>(() => readLocal<CameraMode>('ars.camera', 'follow'));
  const live = useMemo(() => new LivePlayback(race.tickMs), [race.tickMs]);
  const entrants = race.entrants ?? [];
  const [seenFocus, setSeenFocus] = useState(focusId);
  if (seenFocus !== focusId) {
    setSeenFocus(focusId);
    if (focusId && mode === 'overview') setMode('follow');
  }
  const entrantKey = entrants.map((e) => `${e.entrantId}:${e.lane}`).join(',');
  const resultKey = entrants.map((e) => `${e.result?.officialPosition ?? ''}${e.result?.resultStatus ?? ''}`).join(',');

  useEffect(() => {
    live.reset(stream.getState().tick);
    return stream.onTick((tick, kind) => {
      if (kind === 'snapshot') live.reset(tick);
      else if (tick) live.push(tick);
    });
  }, [stream, live]);

  const sceneKey = venue && entrants.length ? `${venue.id}@${venue.version}|${entrantKey}|${race.species}` : null;

  const createScene = useEffectEvent((SceneClass: typeof RaceScene, container: HTMLDivElement) => {
    if (!venue) return null;
    return new SceneClass(container, {
      venueId: venue.id,
      segments: venue.segments,
      lapLength: venue.lapLength,
      lanes: venue.lanes || 10,
      surface: venue.surface || race.surface,
      species: race.species,
      entrants: entrants.map((e) => ({ id: e.entrantId, lane: e.lane })),
    });
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || sceneKey === null) return undefined;
    let disposed = false;
    let created: RaceScene | null = null;
    const build = async () => {
      let SceneClass: typeof RaceScene;
      try {
        ({ RaceScene: SceneClass } = await import('./scene'));
      } catch {
        setWebglError('The 3D viewer failed to load');
        return;
      }
      if (disposed) return;
      try {
        created = createScene(SceneClass, container);
        if (!created) return;
        setScene(created);
        setWebglError(null);
      } catch (error) {
        setWebglError((error instanceof Error && error.message) || 'WebGL is not available');
      }
    };
    void build();
    return () => {
      disposed = true;
      created?.dispose();
      setScene(null);
    };
  }, [sceneKey]);

  const finished = race.status === 'FINISHED' || race.status === 'SETTLED';
  const hasLiveTick = Boolean(stream.getState().tick);

  const totalLength = venue ? venue.lapLength * race.laps : 0;
  const staticKey = `${entrantKey}|${resultKey}|${finished}|${totalLength}`;
  const [staticSource, setStaticSource] = useState(() => ({
    key: staticKey,
    source: buildStaticSource(entrants, finished, totalLength),
  }));
  if (staticSource.key !== staticKey) {
    setStaticSource({ key: staticKey, source: buildStaticSource(entrants, finished, totalLength) });
  }
  const staticFrames = staticSource.source;

  useEffect(() => {
    if (!scene) return;
    if (replay) scene.setSource(replay);
    else if (hasLiveTick) scene.setSource(live);
    else scene.setSource(staticFrames);
  }, [scene, replay, hasLiveTick, live, staticFrames]);

  useEffect(() => {
    scene?.setFocus(focusId);
  }, [scene, focusId]);

  useEffect(() => {
    writeLocal('ars.camera', mode);
    scene?.setCameraMode(mode);
  }, [scene, mode]);

  const name = nameLookup(entrants);
  const tickerSource: { key: string | number; text: string; tone: Tone }[] = [];
  if (replay) {
    const current = displayTick?.tick ?? 0;
    for (let t = Math.max(0, current - 16); t <= current; t += 1) {
      const tick = replay.ticks[t];
      if (!tick) continue;
      tick.events.forEach((event, i) => {
        const { text, tone } = eventText(event, name);
        tickerSource.push({ key: `${tick.tick}-${i}`, text, tone });
      });
    }
  } else {
    const latestTick = displayTick?.tick ?? 0;
    for (const item of feed.filter((entry) => latestTick - entry.tick < 16)) {
      const { text, tone } = eventText(item.event, name);
      tickerSource.push({ key: item.seq, text, tone });
    }
  }
  const ticker = tickerSource.slice(-4);

  const preRace = race.status === 'SCHEDULED' || race.status === 'OPEN' || race.status === 'LOCKED';
  const startsIn = Date.parse(race.startAt) - now;
  const lap = displayTick ? Math.min(displayTick.lap, race.laps) : preRace ? 0 : race.laps;

  return (
    <div className="viewer" data-testid="race-viewer" ref={containerRef}>
      {webglError && (
        <div className="viewer-fallback">
          <div className="stack" style={{ alignItems: 'center', maxWidth: 420 }}>
            <div style={{ fontSize: '2rem' }}>🏟️</div>
            <b>3D view unavailable</b>
            <span className="small">
              Your browser could not start WebGL ({webglError}). Live standings, the race feed and betting keep working.
            </span>
          </div>
        </div>
      )}
      {!webglError && !sceneReady && (
        <div className="viewer-fallback">
          <span>
            <Spinner /> Building the track…
          </span>
        </div>
      )}
      <div className="hud">
        <div className="hud-top">
          <div className="hud-pill">
            {preRace ? (
              <span>Parade ring</span>
            ) : (
              <span className="lap">
                Lap {lap}/{race.laps}
              </span>
            )}
            {replay && (
              <span className="chip gold" style={{ marginLeft: 8 }}>
                Replay
              </span>
            )}
            {!replay && race.status === 'LIVE' && (
              <span className="status status-LIVE" style={{ marginLeft: 8 }}>
                LIVE
              </span>
            )}
          </div>
          {!webglError && (
            <div className="hud-controls">
              <fieldset className="hud-cams" aria-label="Camera">
                {CAMERAS.map((camera) => (
                  <button
                    key={camera.mode}
                    className={mode === camera.mode ? 'active' : ''}
                    onClick={() => setMode(camera.mode)}
                    aria-label={camera.label}
                    title={camera.label}
                  >
                    <span className="hide-sm">{camera.label}</span>
                    <span className="show-sm">{camera.short}</span>
                  </button>
                ))}
              </fieldset>
              <label className="hud-focus">
                <span className="sr-only">Animal to follow</span>
                <select
                  value={focusId ?? ''}
                  onChange={(e) => onFocus(e.target.value || null)}
                  aria-label="Animal to follow"
                  data-testid="camera-focus"
                >
                  <option value="">Leader</option>
                  {entrants
                    .toSorted((a, b) => a.lane - b.lane)
                    .map((e) => (
                      <option key={e.entrantId} value={e.entrantId}>
                        {e.lane}. {e.animal.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          )}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="hud-ticker">
            {ticker.map((item) => (
              <div key={item.key} className={item.tone}>
                {item.text}
              </div>
            ))}
          </div>
          {replay && <ReplayBar replay={replay} onExit={onExitReplay} />}
        </div>
      </div>
      {preRace && !replay && (
        <div className="hud-center" style={{ placeItems: 'start center', paddingTop: 58 }}>
          <div>
            <div className="tiny" style={{ textTransform: 'uppercase', letterSpacing: '0.12em', opacity: 0.8 }}>
              Off in
            </div>
            <div className="big">{startsIn > 0 ? fmtCountdown(startsIn) : 'Any moment'}</div>
          </div>
        </div>
      )}
      {finished && !replay && !hasLiveTick && (
        <div className="hud-center">
          <div className="stack" style={{ gap: 8, alignItems: 'center' }}>
            <b>Race finished</b>
            {replayAvailable ? (
              <button className="btn primary" onClick={onWatchReplay} disabled={replayLoading}>
                {replayLoading ? <Spinner /> : '▶'} Watch replay
              </button>
            ) : (
              <span className="small muted">Replay no longer available</span>
            )}
          </div>
        </div>
      )}
      {finished && !replay && hasLiveTick && replayAvailable && (
        <div className="hud-center" style={{ placeItems: 'end center', paddingBottom: 60 }}>
          <div>
            <button className="btn primary" onClick={onWatchReplay} disabled={replayLoading}>
              {replayLoading ? <Spinner /> : '▶'} Watch replay
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function useReplayTick(replay: ReplayPlayback | null): RaceTick | null {
  return useSyncExternalStore(replay ? (listener) => replay.subscribe(listener) : noopSubscribe, () =>
    replay ? replay.tickAt(replay.positionMs) : null,
  );
}
