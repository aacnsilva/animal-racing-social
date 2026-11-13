import { useEffect, useMemo, useRef, useState } from 'react';
import { ProviderIcon } from '../components/ui';
import { login, useSession } from '../lib/api';
import { toast } from '../lib/app';
import { useStore } from '../lib/hooks';
import { navigate } from '../lib/router';
import type { Species } from '../lib/types';
import { AnimalPreview } from './AnimalPreview';
import type { RaceSetup } from './game';
import { isTouchDevice } from './input';
import { ArcadeClient } from './net';
import type { RoomConfig, RoomView } from './protocol';
import { RaceView, type RaceOutcome } from './RaceView';
import { ANIMALS, buildGrid, fmtRaceTime, isSpecies, SLOT_COLORS, SPECIES_ORDER, type Difficulty } from './roster';
import { loadTrack, trackDef, TRACKS, type TrackId } from './tracks';

const LAPS = [1, 2, 3, 5];
const DIFFICULTIES: { id: Difficulty; label: string }[] = [
  { id: 'EASY', label: 'Chill' },
  { id: 'MEDIUM', label: 'Spicy' },
  { id: 'HARD', label: 'Feral' },
];
const PREFS_KEY = 'ars.play.prefs';
const BEST_KEY = 'ars.play.best';

type Prefs = { species: Species; trackId: TrackId; laps: number; bots: number; difficulty: Difficulty };
const DEFAULT_PREFS: Prefs = { species: 'HORSE', trackId: 'meadow', laps: 3, bots: 7, difficulty: 'MEDIUM' };

function readJson(key: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
  } catch {
    return {};
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

function loadPrefs(): Prefs {
  const raw = readJson(PREFS_KEY);
  return {
    species: isSpecies(raw.species) ? raw.species : DEFAULT_PREFS.species,
    trackId: trackDef(String(raw.trackId)).id,
    laps: LAPS.find((laps) => laps === raw.laps) ?? DEFAULT_PREFS.laps,
    bots: typeof raw.bots === 'number' && raw.bots >= 0 && raw.bots <= 9 ? Math.round(raw.bots) : DEFAULT_PREFS.bots,
    difficulty: DIFFICULTIES.find((entry) => entry.id === raw.difficulty)?.id ?? DEFAULT_PREFS.difficulty,
  };
}

function loadBest(): Record<string, number> {
  const best: Record<string, number> = {};
  for (const [key, value] of Object.entries(readJson(BEST_KEY))) if (typeof value === 'number') best[key] = value;
  return best;
}

function StatBars({ species }: { species: Species }) {
  const bars = ANIMALS[species].bars;
  return (
    <div className="gp-bars">
      {(
        [
          ['Speed', bars.speed],
          ['Launch', bars.accel],
          ['Grip', bars.handling],
          ['Stamina', bars.stamina],
        ] as const
      ).map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <i>
            <b style={{ width: `${value * 20}%` }} />
          </i>
        </div>
      ))}
    </div>
  );
}

function AnimalPicker({
  value,
  onChange,
  compact,
}: {
  value: Species;
  onChange: (species: Species) => void;
  compact?: boolean;
}) {
  return (
    <div className={`gp-animals${compact ? ' compact' : ''}`}>
      {SPECIES_ORDER.map((species) => {
        const animal = ANIMALS[species];
        return (
          <button
            key={species}
            type="button"
            aria-pressed={value === species}
            className={`gp-animal${value === species ? ' active' : ''}`}
            data-testid={`gp-animal-${species}`}
            onClick={() => onChange(species)}
          >
            <span className="emoji" aria-hidden>
              {animal.emoji}
            </span>
            <span className="label">{animal.name}</span>
            {!compact && <StatBars species={species} />}
          </button>
        );
      })}
    </div>
  );
}

function TrackPicker({
  value,
  onChange,
  best,
  disabled,
}: {
  value: TrackId;
  onChange: (id: TrackId) => void;
  best?: Record<string, number>;
  disabled?: boolean;
}) {
  const outlines = useMemo(
    () => TRACKS.map((def) => ({ def, track: loadTrack(def.id), outline: loadTrack(def.id).outline(96, 10) })),
    [],
  );
  return (
    <div className="gp-tracks">
      {outlines.map(({ def, track, outline }) => {
        const record = best ? Object.entries(best).find(([key]) => key.startsWith(`${def.id}:`)) : undefined;
        return (
          <button
            key={def.id}
            type="button"
            aria-pressed={value === def.id}
            disabled={disabled}
            className={`gp-track${value === def.id ? ' active' : ''}`}
            data-testid={`gp-track-${def.id}`}
            style={{
              background: `linear-gradient(160deg, ${def.card.top}, ${def.card.mid} 55%, ${def.card.bottom})`,
            }}
            onClick={() => onChange(def.id)}
          >
            <svg viewBox="0 0 96 96" aria-hidden>
              <path d={outline.d} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="7" strokeLinejoin="round" />
              <path d={outline.d} fill="none" stroke="#fff" strokeWidth="3.5" strokeLinejoin="round" />
              <circle cx={outline.start[0]} cy={outline.start[1]} r="4" fill={def.card.accent} stroke="#000" />
            </svg>
            <span className="info">
              <b>{def.name}</b>
              <span>
                {def.grade} · {Math.round(track.length)} m
              </span>
              {record && <span className="best">Best {fmtRaceTime(record[1])}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function RaceOptions({
  config,
  onChange,
  maxBots,
  disabled,
}: {
  config: RoomConfig;
  onChange: (patch: Partial<RoomConfig>) => void;
  maxBots: number;
  disabled?: boolean;
}) {
  return (
    <div className="gp-options">
      <div className="gp-option">
        <span>Laps</span>
        <div className="gp-seg">
          {LAPS.map((laps) => (
            <button
              key={laps}
              type="button"
              disabled={disabled}
              className={config.laps === laps ? 'active' : ''}
              data-testid={`gp-laps-${laps}`}
              onClick={() => onChange({ laps })}
            >
              {laps}
            </button>
          ))}
        </div>
      </div>
      <div className="gp-option">
        <span>Rival bots</span>
        <div className="gp-stepper">
          <button
            type="button"
            disabled={disabled || config.bots <= 0}
            aria-label="Fewer bots"
            onClick={() => onChange({ bots: config.bots - 1 })}
          >
            −
          </button>
          <b data-testid="gp-bots">{Math.min(config.bots, maxBots)}</b>
          <button
            type="button"
            disabled={disabled || config.bots >= maxBots}
            aria-label="More bots"
            onClick={() => onChange({ bots: config.bots + 1 })}
          >
            +
          </button>
        </div>
      </div>
      <div className="gp-option">
        <span>Bot mood</span>
        <div className="gp-seg">
          {DIFFICULTIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              disabled={disabled}
              className={config.difficulty === entry.id ? 'active' : ''}
              onClick={() => onChange({ difficulty: entry.id })}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SignInPrompt({ redirect, text }: { redirect: string; text: string }) {
  return (
    <div className="gp-signin" data-testid="gp-signin">
      <p className="muted">{text}</p>
      <div className="row wrap">
        <button className="btn provider-btn" onClick={() => login('google', redirect)}>
          <ProviderIcon provider="google" /> Google
        </button>
        <button className="btn provider-btn" onClick={() => login('github', redirect)}>
          <ProviderIcon provider="github" /> GitHub
        </button>
      </div>
    </div>
  );
}

function Lobby({
  room,
  you,
  client,
  reconnecting,
  onLeave,
}: {
  room: RoomView;
  you: string;
  client: ArcadeClient;
  reconnecting: boolean;
  onLeave: () => void;
}) {
  const me = room.players.find((player) => player.id === you);
  const isHost = room.hostId === you;
  const host = room.players.find((player) => player.id === room.hostId);
  const link = `${window.location.origin}/play/room/${room.code}`;
  const busy = room.phase !== 'LOBBY';
  const share = async () => {
    try {
      if (navigator.share && isTouchDevice()) {
        await navigator.share({ title: 'Animal Grand Prix', text: `Race me! Room code ${room.code}`, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      toast('Invite link copied', 'success');
    } catch {
      toast(`Share this code: ${room.code}`, 'info');
    }
  };
  return (
    <div className="stack gp-lobby" data-testid="gp-lobby-view">
      <div className="card gp-code-card">
        <div>
          <span className="gp-eyebrow">Room code</span>
          <div className="gp-code" data-testid="gp-room-code">
            {room.code}
          </div>
          <p className="muted">Friends join at /play with this code, or with your invite link.</p>
        </div>
        <div className="gp-code-actions">
          <button className="btn primary" onClick={() => void share()} data-testid="gp-share">
            Share invite
          </button>
          <button className="btn ghost" onClick={onLeave} data-testid="gp-leave">
            Leave
          </button>
        </div>
      </div>
      {reconnecting && <div className="notice warn">Connection lost. Reconnecting…</div>}
      {busy && (
        <div className="notice info" data-testid="gp-in-progress">
          A race is in progress. You are in for the next one.
        </div>
      )}
      <div className="card">
        <div className="card-head">
          <h3>Racers · {room.players.length}/10</h3>
        </div>
        <div className="gp-slots">
          {Array.from({ length: 10 }, (_, slot) => {
            const player = room.players.find((entry) => entry.slot === slot);
            return (
              <div
                key={slot}
                className={`gp-slot${player ? ' filled' : ''}${player?.id === you ? ' me' : ''}`}
                data-testid={player ? 'gp-player' : undefined}
              >
                <i style={{ background: SLOT_COLORS[slot] }} />
                {player ? (
                  <>
                    <span className="emoji" aria-hidden>
                      {ANIMALS[player.species].emoji}
                    </span>
                    <span className="name">{player.name}</span>
                    {player.id === room.hostId && <span className="chip gold">Host</span>}
                    {player.id === you && <span className="chip green">You</span>}
                    {!player.connected && <span className="chip grey">Away</span>}
                  </>
                ) : (
                  <span className="name muted">Open seat</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Your animal</h3>
        </div>
        <AnimalPicker
          compact
          value={me?.species ?? 'HORSE'}
          onChange={(species) => client.send({ t: 'pick', species })}
        />
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Race setup</h3>
          {!isHost && <span className="muted">{host?.name ?? 'The host'} decides</span>}
        </div>
        <TrackPicker
          value={room.config.trackId}
          disabled={!isHost || busy}
          onChange={(trackId) => client.send({ t: 'config', trackId })}
        />
        <RaceOptions
          config={room.config}
          maxBots={10 - room.players.length}
          disabled={!isHost || busy}
          onChange={(patch) => client.send({ t: 'config', ...patch })}
        />
      </div>
      <div className="gp-cta">
        {isHost ? (
          <button
            className="btn primary gp-go"
            disabled={busy}
            data-testid="gp-start"
            onClick={() => client.send({ t: 'start' })}
          >
            Start race
          </button>
        ) : (
          <div className="gp-waiting" data-testid="gp-waiting">
            Waiting for {host?.name ?? 'the host'} to start…
          </div>
        )}
      </div>
    </div>
  );
}

type ActiveRace = { key: string; setup: RaceSetup; multi: boolean };

export function PlayPage({ code }: { code?: string }) {
  const session = useSession();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [best, setBest] = useState<Record<string, number>>(loadBest);
  const [race, setRace] = useState<ActiveRace | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [client] = useState(() => new ArcadeClient());
  const net = useStore(client.store);
  const launched = useRef(0);
  const soloCount = useRef(0);
  const authed = session.status === 'authed';

  const update = (patch: Partial<Prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      writeJson(PREFS_KEY, next);
      return next;
    });
  };

  useEffect(() => () => client.close(), [client]);

  const wantedCode = code?.toUpperCase() ?? null;
  const roomCode = net.room?.code ?? null;
  useEffect(() => {
    if (!wantedCode || !authed) return;
    if (net.status !== 'idle' || roomCode === wantedCode) return;
    void client.connect(wantedCode, prefs.species);
  }, [wantedCode, authed, net.status, roomCode, client, prefs.species]);

  useEffect(() => {
    if (roomCode && roomCode !== wantedCode) navigate(`/play/room/${roomCode}`, { replace: true });
  }, [roomCode, wantedCode]);

  const room = net.room;
  const you = net.you;
  useEffect(() => {
    const sync = () => {
      const state = client.store.get();
      const current = state.room;
      if (!current || !state.you || current.phase === 'LOBBY') {
        launched.current = 0;
        setRace((active) => (active?.multi ? null : active));
        return;
      }
      const me = current.players.find((player) => player.id === state.you);
      if (!me?.racing || launched.current === current.raceNo || current.phase === 'RESULTS') return;
      launched.current = current.raceNo;
      const humans = current.players.filter((player) => player.racing);
      const grid = buildGrid(
        humans.map((player) => ({ slot: player.slot, id: player.id, name: player.name, species: player.species })),
        Math.min(current.config.bots, 10 - humans.length),
        current.seed,
        current.config.difficulty,
      );
      setRace({
        key: `${current.code}:${current.raceNo}`,
        multi: true,
        setup: {
          trackId: current.config.trackId,
          laps: current.config.laps,
          seed: current.seed,
          grid,
          meSlot: me.slot,
          countdownMs: 4000,
          startAt: current.startAt,
          serverNow: client.serverNow,
          sendSample: (sample) => client.send({ t: 's', d: sample }),
        },
      });
    };
    return client.store.subscribe(sync);
  }, [client]);

  const startSolo = () => {
    soloCount.current += 1;
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const name = session.user?.displayName ?? 'You';
    const meSlot = prefs.bots;
    const bots = buildGrid([], prefs.bots, seed, prefs.difficulty);
    const grid = [...bots, { slot: meSlot, id: 'me', name, species: prefs.species, skill: 1 }];
    if (isTouchDevice() && document.fullscreenEnabled)
      void document.documentElement.requestFullscreen().catch(() => undefined);
    setRace({
      key: `solo:${soloCount.current}`,
      multi: false,
      setup: {
        trackId: prefs.trackId,
        laps: prefs.laps,
        seed,
        grid,
        meSlot,
        countdownMs: 4500,
        startAt: null,
        serverNow: null,
        sendSample: null,
      },
    });
  };

  const onFinished = (outcome: RaceOutcome) => {
    const key = `${outcome.trackId}:${outcome.laps}`;
    setBest((current) => {
      if (current[key] !== undefined && current[key] <= outcome.timeMs) return current;
      const next = { ...current, [key]: outcome.timeMs };
      writeJson(BEST_KEY, next);
      return next;
    });
  };

  const leaveRoom = () => {
    client.close();
    setRace(null);
    navigate('/play', { replace: true });
  };

  if (race) {
    return (
      <RaceView
        key={race.key}
        setup={race.setup}
        room={race.multi ? room : null}
        you={you}
        client={race.multi ? client : null}
        onFinished={onFinished}
        onRestart={race.multi ? null : startSolo}
        onExit={race.multi ? leaveRoom : () => setRace(null)}
        onLobby={race.multi ? () => client.send({ t: 'lobby' }) : null}
      />
    );
  }

  if (room && you) {
    return (
      <div className="gp-page">
        <Lobby room={room} you={you} client={client} reconnecting={net.status === 'reconnecting'} onLeave={leaveRoom} />
      </div>
    );
  }

  const bestForLaps = Object.fromEntries(Object.entries(best).filter(([key]) => key.endsWith(`:${prefs.laps}`)));
  const connecting = net.status === 'connecting';
  const animal = ANIMALS[prefs.species];
  const soloConfig: RoomConfig = {
    trackId: prefs.trackId,
    laps: prefs.laps,
    bots: prefs.bots,
    difficulty: prefs.difficulty,
  };

  return (
    <div className="gp-page stack" data-testid="gp-hub">
      <section className="gp-hero">
        <div className="gp-hero-copy">
          <span className="gp-eyebrow">New · arcade racing</span>
          <h1>Animal Grand Prix</h1>
          <p>
            Stop watching and start racing. Pick an animal, hit the boost and out-run up to nine rivals, solo or with
            friends.
          </p>
          <div className="gp-hero-animal">
            <b>
              {animal.emoji} {animal.name}
            </b>
            <span>{animal.blurb}</span>
          </div>
        </div>
        <AnimalPreview species={prefs.species} color={SLOT_COLORS[SPECIES_ORDER.indexOf(prefs.species)]} />
      </section>

      {wantedCode && !authed && session.status !== 'loading' && (
        <div className="card">
          <div className="card-head">
            <h3>Join room {wantedCode}</h3>
          </div>
          <SignInPrompt redirect={`/play/room/${wantedCode}`} text="Sign in to join your friends on the grid." />
        </div>
      )}
      {net.error && (
        <div className="notice error" role="alert" data-testid="gp-error">
          <span style={{ flex: 1 }}>{net.error.message}</span>
          <button
            className="btn small ghost"
            onClick={() => {
              client.close();
              if (wantedCode) navigate('/play', { replace: true });
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <h3>1 · Pick your animal</h3>
        </div>
        <AnimalPicker value={prefs.species} onChange={(species) => update({ species })} />
      </section>

      <section className="card">
        <div className="card-head">
          <h3>2 · Pick a track</h3>
        </div>
        <TrackPicker value={prefs.trackId} onChange={(trackId) => update({ trackId })} best={bestForLaps} />
        <RaceOptions config={soloConfig} maxBots={9} onChange={(patch) => update(patch)} />
      </section>

      <section className="gp-modes">
        <div className="card gp-mode">
          <h3>Solo race</h3>
          <p className="muted">No sign-in needed. You start at the back of the grid, so get overtaking.</p>
          <button className="btn primary gp-go" onClick={startSolo} data-testid="gp-solo">
            Race now
          </button>
        </div>
        <div className="card gp-mode">
          <h3>Race friends</h3>
          {authed ? (
            <>
              <p className="muted">Create a room and share the code. Up to 10 racers, bots fill the gaps.</p>
              <button
                className="btn turf gp-go"
                disabled={connecting}
                data-testid="gp-create"
                onClick={() => void client.connect(null, prefs.species)}
              >
                {connecting ? 'Opening…' : 'Create room'}
              </button>
              <form
                className="gp-join"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (joinCode.trim().length === 5) void client.connect(joinCode.trim().toUpperCase(), prefs.species);
                }}
              >
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase().slice(0, 5))}
                  placeholder="CODE"
                  aria-label="Room code"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  data-testid="gp-join-code"
                />
                <button className="btn" disabled={connecting || joinCode.trim().length !== 5} data-testid="gp-join">
                  Join
                </button>
              </form>
            </>
          ) : session.status === 'loading' ? (
            <p className="muted">Checking your session…</p>
          ) : (
            <SignInPrompt redirect="/play" text="Sign in to create a room or join one with a code." />
          )}
        </div>
      </section>

      <section className="card gp-help">
        <div className="card-head">
          <h3>How to race</h3>
        </div>
        <ul>
          <li>
            <b>Steer</b> by dragging the stick left or right on touch, or with the arrow keys / A and D. On touch your
            animal runs by itself.
          </li>
          <li>
            <b>Boost</b> burns stamina. Golden treats refill it, glowing pads fire you forward for free.
          </li>
          <li>
            <b>Slipstream</b> right behind a rival to gain speed, then swing out and pass.
          </li>
          <li>
            <b>Perfect start:</b> tap boost just as the countdown hits GO.
          </li>
          <li>Stay off the rough. Animals out of their element race in a bubble, obviously.</li>
        </ul>
      </section>
    </div>
  );
}
