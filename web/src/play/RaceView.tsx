import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { readMuted } from './audio';
import { Game, type FinishSummary, type RaceSetup, type ResultRow } from './game';
import { isTouchDevice } from './input';
import type { ArcadeClient } from './net';
import type { RoomView } from './protocol';
import { ANIMALS, fmtRaceTime, ordinal, SLOT_COLORS } from './roster';
import { trackDef } from './tracks';

export type RaceOutcome = FinishSummary & { trackId: string; laps: number };

type Props = {
  setup: RaceSetup;
  room: RoomView | null;
  you: string | null;
  client: ArcadeClient | null;
  onFinished: (outcome: RaceOutcome) => void;
  onRestart: (() => void) | null;
  onExit: () => void;
  onLobby: (() => void) | null;
};

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void document.documentElement.requestFullscreen().catch(() => undefined);
}

function canFullscreen(): boolean {
  return typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled;
}

export function RaceView({ setup, room, you, client, onFinished, onRestart, onExit, onLobby }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const [summary, setSummary] = useState<FinishSummary | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [menu, setMenu] = useState(false);
  const [muted, setMuted] = useState(readMuted);
  const [failed, setFailed] = useState(false);
  const touch = isTouchDevice();
  const multi = setup.startAt !== null;
  const track = trackDef(setup.trackId);
  const settled = !multi || room?.phase === 'RESULTS' || room?.phase === 'LOBBY';

  const finished = useEffectEvent((result: FinishSummary) => {
    setSummary(result);
    client?.send({ t: 'finish', ms: result.timeMs });
    onFinished({ ...result, trackId: setup.trackId, laps: setup.laps });
  });

  useEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    let instance: Game;
    try {
      instance = new Game(element, setup, { onFinish: (result) => finished(result) });
    } catch {
      queueMicrotask(() => setFailed(true));
      return undefined;
    }
    game.current = instance;
    client?.setWorldHandler((serverTime, list) => instance.applyWorld(serverTime, list));
    document.documentElement.classList.add('gp-lock');
    let wake: { release: () => Promise<void> } | null = null;
    if ('wakeLock' in navigator)
      navigator.wakeLock
        .request('screen')
        .then((lock) => {
          wake = lock;
          return undefined;
        })
        .catch(() => undefined);
    return () => {
      client?.setWorldHandler(null);
      game.current = null;
      instance.dispose();
      document.documentElement.classList.remove('gp-lock');
      void wake?.release().catch(() => undefined);
    };
  }, [setup, client]);

  useEffect(() => {
    if (!room) return;
    for (const player of room.players) game.current?.setRemoteFinish(player.slot, player.finishMs);
  }, [room]);

  useEffect(() => {
    if (!summary) return undefined;
    const timer = setTimeout(() => setShowResults(true), 1800);
    return () => clearTimeout(timer);
  }, [summary]);

  const resultsOpen = showResults || (multi && room?.phase === 'RESULTS');
  useEffect(() => {
    if (!resultsOpen) return undefined;
    const refresh = () => setRows(game.current?.standings(settled) ?? []);
    refresh();
    const timer = setInterval(refresh, 500);
    return () => clearInterval(timer);
  }, [resultsOpen, settled]);

  useEffect(() => {
    game.current?.setPaused(menu && !summary);
  }, [menu, summary]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape' || event.code === 'KeyP') setMenu((open) => !open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleMute = () => {
    const next = !muted;
    game.current?.sound.setMuted(next);
    setMuted(next);
  };
  const leave = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    onExit();
  };

  const isHost = Boolean(room && you && room.hostId === you);
  const hostName = room?.players.find((player) => player.id === room.hostId)?.name ?? 'the host';
  const mine = rows.find((row) => row.me);

  return (
    <div
      className={`gp-root${touch ? ' touch' : ''}`}
      ref={root}
      data-testid="gp-race"
      data-finished={summary ? 'true' : 'false'}
    >
      <div className="gp-stage" data-hud="stage" />
      <div className="gp-streaks" data-hud="streaks" aria-hidden />
      {failed && (
        <div className="gp-panel-wrap">
          <div className="gp-panel">
            <h2>3D is not available</h2>
            <p className="muted">This browser could not start WebGL, which the race needs.</p>
            <button className="btn primary block" onClick={leave}>
              Back
            </button>
          </div>
        </div>
      )}
      <div className="gp-hud" aria-hidden={resultsOpen}>
        <div className="gp-top">
          <div className="gp-place">
            <b data-hud="pos" data-testid="gp-position">
              -
            </b>
            <span data-hud="total" />
          </div>
          <div className="gp-stats">
            <div>
              <span>LAP</span>
              <b data-hud="lap" data-testid="gp-lap">
                1/{setup.laps}
              </b>
            </div>
            <div>
              <span>TIME</span>
              <b data-hud="time" data-testid="gp-time">
                0:00.00
              </b>
            </div>
          </div>
          <div className="gp-tools">
            <button type="button" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} data-testid="gp-mute">
              {muted ? '🔇' : '🔊'}
            </button>
            {canFullscreen() && (
              <button type="button" onClick={toggleFullscreen} aria-label="Fullscreen">
                ⛶
              </button>
            )}
            <button type="button" onClick={() => setMenu(true)} aria-label="Menu" data-testid="gp-menu">
              ☰
            </button>
          </div>
        </div>
        <div className="gp-board" data-hud="board" />
        <canvas className="gp-minimap" data-hud="minimap" />
        <div className="gp-message" data-hud="message" data-testid="gp-message" />
        <div className="gp-wrong" data-hud="wrong" hidden>
          WRONG WAY
        </div>
        <div className="gp-draft" data-hud="draft" hidden>
          SLIPSTREAM
        </div>
        <div className="gp-gauge">
          <div className="gp-speed">
            <b data-hud="speed" data-testid="gp-speed">
              0
            </b>
            <span>km/h</span>
          </div>
          <div className="gp-stamina" title="Boost stamina">
            <i data-hud="stamina" />
          </div>
        </div>
        <div className="gp-pad left">
          <button type="button" data-control="left" aria-label="Steer left">
            ◀
          </button>
          <button type="button" data-control="right" aria-label="Steer right">
            ▶
          </button>
        </div>
        <div className="gp-pad right">
          <button type="button" data-control="down" className="brake" aria-label="Brake">
            BRAKE
          </button>
          <button type="button" data-control="boost" className="boost" aria-label="Boost">
            BOOST
          </button>
        </div>
        {!touch && <div className="gp-keys">←/→ steer · ↑ run · ↓ brake · Space boost · Esc menu</div>}
      </div>

      {menu && !resultsOpen && (
        <div className="gp-panel-wrap" data-testid="gp-pause">
          <div className="gp-panel">
            <h2>{multi ? 'Race menu' : 'Paused'}</h2>
            <p className="muted">
              {track.name} · {setup.laps} {setup.laps === 1 ? 'lap' : 'laps'}
            </p>
            <button className="btn primary block" onClick={() => setMenu(false)}>
              Resume
            </button>
            {onRestart && (
              <button className="btn block" onClick={onRestart}>
                Restart race
              </button>
            )}
            <button className="btn danger block" onClick={leave} data-testid="gp-quit">
              {multi ? 'Leave room' : 'Quit to menu'}
            </button>
          </div>
        </div>
      )}

      {resultsOpen && (
        <div className="gp-panel-wrap results" data-testid="gp-results">
          <div className="gp-panel wide">
            <div className="gp-result-head">
              <div>
                <h2>{mine ? (mine.place === 1 ? 'Victory!' : `${ordinal(mine.place)} place`) : 'Race over'}</h2>
                <p className="muted">
                  {track.name}
                  {summary ? ` · ${fmtRaceTime(summary.timeMs)}` : ''}
                  {summary?.bestLapMs ? ` · best lap ${fmtRaceTime(summary.bestLapMs)}` : ''}
                </p>
              </div>
              <span className="gp-trophy" aria-hidden>
                {mine?.place === 1 ? '🏆' : mine?.place === 2 ? '🥈' : mine?.place === 3 ? '🥉' : '🏁'}
              </span>
            </div>
            <ol className="gp-results">
              {rows.map((row) => (
                <li key={row.slot} className={row.me ? 'me' : ''}>
                  <b>{row.place}</b>
                  <i style={{ background: SLOT_COLORS[row.slot % SLOT_COLORS.length] }} />
                  <span className="name">
                    {ANIMALS[row.species].emoji} {row.name}
                    {row.bot && <em>BOT</em>}
                  </span>
                  <span className="time">
                    {row.finishMs !== null ? fmtRaceTime(row.finishMs) : settled ? 'DNF' : 'racing…'}
                  </span>
                </li>
              ))}
            </ol>
            <div className="gp-actions">
              {onRestart && (
                <button className="btn primary" onClick={onRestart} data-testid="gp-again">
                  Race again
                </button>
              )}
              {multi && onLobby && isHost && room?.phase === 'RESULTS' && (
                <button className="btn primary" onClick={onLobby} data-testid="gp-lobby">
                  Back to lobby
                </button>
              )}
              {multi && room?.phase === 'RESULTS' && !isHost && (
                <span className="muted">Waiting for {hostName} to reopen the lobby…</span>
              )}
              {multi && room?.phase !== 'RESULTS' && <span className="muted">Waiting for the other racers…</span>}
              <button className="btn" onClick={leave} data-testid="gp-exit">
                {multi ? 'Leave room' : 'Change setup'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
