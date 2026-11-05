import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import {
  closeRescue,
  lifesaverStore,
  openRescue,
  refreshLifesaver,
  refreshWallet,
  rescueStore,
  walletStore,
} from '../lib/app';
import { friendlyError } from '../lib/errors';
import { fmtPoints } from '../lib/format';
import { useStore } from '../lib/hooks';
import type { LifesaverClaim } from '../lib/types';

type Phase = 'sinking' | 'throwing' | 'pulling' | 'saved' | 'missed';

const RACERS = ['🐌', '🐢', '🦒', '🐎', '🐕', '🦤', '🐇'];
const THROW_MS = 1150;
const PULL_MS = 1800;
const CONFETTI = Array.from({ length: 28 }, (_, index) => index);
const DROPS = Array.from({ length: 8 }, (_, index) => index);
const BUBBLES = Array.from({ length: 5 }, (_, index) => index);

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function useCountUp(from: number, to: number, active: boolean, duration: number): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    let frame = 0;
    const started = performance.now();
    const step = (now: number) => {
      const t = duration <= 0 ? 1 : Math.min(1, (now - started) / duration);
      setProgress(t);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [active, duration]);
  const t = active ? progress : 0;
  return Math.round(from + (to - from) * (1 - (1 - t) ** 3));
}

export function Buoy({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="buoy-svg">
      <circle cx="32" cy="32" r="22" fill="none" stroke="#fff6ec" strokeWidth="13" />
      <circle
        cx="32"
        cy="32"
        r="22"
        fill="none"
        stroke="#ff4d4d"
        strokeWidth="13"
        strokeDasharray="17.28 17.28"
        transform="rotate(-8 32 32)"
      />
      <circle cx="32" cy="32" r="28.5" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <circle cx="32" cy="32" r="15.5" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <path
        d="M14 20 Q20 12 30 10"
        stroke="rgba(255,255,255,0.7)"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Waves() {
  const wave = 'M0 18 Q25 6 50 18 T100 18 T150 18 T200 18 T250 18 T300 18 T350 18 T400 18 V40 H0 Z';
  return (
    <div className="rescue-waves">
      <svg className="wave back" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden>
        <path d={wave} />
      </svg>
      <svg className="wave front" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden>
        <path d={wave} />
      </svg>
    </div>
  );
}

function RescueDialog() {
  const lifesaver = useStore(lifesaverStore);
  const wallet = useStore(walletStore);
  const [phase, setPhase] = useState<Phase>('sinking');
  const [racer] = useState(() => RACERS[Math.floor(Math.random() * RACERS.length)]);
  const [claim, setClaim] = useState<LifesaverClaim | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const focusOnMount = useCallback((element: HTMLButtonElement | null) => element?.focus(), []);
  const reduced = reducedMotion();
  const amount = claim?.amount ?? lifesaver?.amount ?? 500;
  const before = claim?.balanceBefore ?? wallet?.balance ?? 0;
  const after = claim?.balance ?? before + amount;
  const counted = useCountUp(before, after, phase === 'pulling' || phase === 'saved', reduced ? 0 : PULL_MS);
  const busy = phase === 'throwing' || phase === 'pulling';

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) closeRescue(phase === 'saved');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, phase]);

  const rescue = async () => {
    setError(null);
    setPhase('throwing');
    const request = api<LifesaverClaim>('/v1/me/rewards/lifesaver', { method: 'POST' }).then(
      (value) => ({ ok: true as const, value }),
      (failure: unknown) => ({ ok: false as const, failure }),
    );
    const [result] = await Promise.all([request, wait(reduced ? 0 : THROW_MS)]);
    if (!alive.current) return;
    if (!result.ok) {
      setError(friendlyError(result.failure));
      setPhase('missed');
      void refreshLifesaver();
      return;
    }
    setClaim(result.value);
    walletStore.set((w) => (w ? { ...w, balance: result.value.balance, rankScore: result.value.balance } : w));
    setPhase('pulling');
    await wait(reduced ? 0 : PULL_MS + 150);
    if (!alive.current) return;
    setPhase('saved');
    refreshWallet(0);
    void refreshLifesaver();
  };

  const title =
    phase === 'saved'
      ? 'Saved!'
      : phase === 'missed'
        ? 'Splash… it missed!'
        : phase === 'pulling'
          ? 'Heave-ho!'
          : phase === 'throwing'
            ? 'Lifesaver incoming!'
            : 'Racer overboard!';

  const text =
    phase === 'saved'
      ? `+${fmtPoints(amount)} points and back on dry land. Race wisely!`
      : phase === 'missed'
        ? (error ?? 'Something went wrong.')
        : phase === 'pulling'
          ? 'Hold on tight, we are hauling you back to the track…'
          : phase === 'throwing'
            ? 'Grab on!'
            : `You are out of points and sinking fast. Grab a free lifesaver worth ${fmtPoints(amount)} points.`;

  return (
    <div className="rescue-backdrop" data-testid="lifesaver-dialog" data-phase={phase}>
      <dialog
        open
        className={`rescue phase-${phase}${reduced ? ' reduced' : ''}`}
        aria-modal="true"
        aria-labelledby="rescue-title"
        aria-describedby="rescue-text"
      >
        <div className="rescue-stage" aria-hidden>
          <div className="rescue-sun" />
          <div className="rescue-cloud c1" />
          <div className="rescue-cloud c2" />
          <div className="rescue-target">
            <div className="rescue-rope" />
            <div className="rescue-swimmer">
              <div className="rescue-help">{phase === 'saved' ? 'Phew!' : 'Help!'}</div>
              <div className="rescue-sign num">{fmtPoints(counted)} pts</div>
              <div className="rescue-racer">{racer}</div>
              <div className="rescue-bubbles">
                {BUBBLES.map((index) => (
                  <span key={index} style={{ ['--i' as string]: index }} />
                ))}
              </div>
              <div className="rescue-drips">
                {DROPS.map((index) => (
                  <span key={index} style={{ ['--i' as string]: index }} />
                ))}
              </div>
            </div>
            <div className="rescue-throw-x">
              <div className="rescue-throw-y">
                <div className="rescue-spin">
                  <Buoy size={84} />
                </div>
              </div>
            </div>
            <div className="rescue-splash">
              {DROPS.map((index) => (
                <span key={index} style={{ ['--i' as string]: index }} />
              ))}
            </div>
          </div>
          <Waves />
          <div className="rescue-confetti">
            {CONFETTI.map((index) => (
              <span key={index} style={{ ['--i' as string]: index }} />
            ))}
          </div>
        </div>
        <div className="rescue-copy">
          <h2 id="rescue-title">{title}</h2>
          <p id="rescue-text" aria-live="polite">
            {text}
          </p>
          {(phase === 'pulling' || phase === 'saved') && (
            <div className="rescue-balance">
              <span className="num" data-testid="lifesaver-balance">
                {String(counted)}
              </span>
              <span className="unit">pts</span>
            </div>
          )}
          <div className="rescue-actions">
            {phase === 'sinking' && (
              <>
                <button className="btn ghost" onClick={() => closeRescue(false)}>
                  Keep treading water
                </button>
                <button
                  ref={focusOnMount}
                  className="btn lifesaver"
                  data-testid="lifesaver-throw"
                  onClick={() => void rescue()}
                >
                  <Buoy size={20} />
                  Throw me the lifesaver
                </button>
              </>
            )}
            {busy && (
              <button className="btn lifesaver" disabled>
                <Buoy size={20} />
                {phase === 'throwing' ? 'Throwing…' : 'Pulling…'}
              </button>
            )}
            {phase === 'missed' && (
              <button ref={focusOnMount} className="btn" onClick={() => closeRescue(false)}>
                Close
              </button>
            )}
            {phase === 'saved' && (
              <button
                ref={focusOnMount}
                className="btn primary"
                data-testid="lifesaver-done"
                onClick={() => closeRescue(true)}
              >
                Back to the races
              </button>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}

export function LifesaverRescue() {
  const { open } = useStore(rescueStore);
  return open ? <RescueDialog /> : null;
}

export function LifesaverBuoyButton() {
  const lifesaver = useStore(lifesaverStore);
  if (!lifesaver?.claimable) return null;
  return (
    <button
      className="btn lifesaver small sos"
      data-testid="lifesaver-open"
      onClick={openRescue}
      title={`You are out of points: grab your free lifesaver (+${fmtPoints(lifesaver.amount)})`}
    >
      <Buoy size={18} />
      <span className="hide-sm">SOS</span>
    </button>
  );
}

export function LifesaverTile() {
  const lifesaver = useStore(lifesaverStore);
  const status = !lifesaver
    ? '…'
    : lifesaver.state === 'READY'
      ? 'You are out of points!'
      : lifesaver.state === 'WAITING_ON_BETS'
        ? 'Out of points, but bets are still running. Wait for them to settle.'
        : lifesaver.state === 'PENALIZED'
          ? 'Your points were removed as a penalty, so no lifesaver this time.'
          : lifesaver.state === 'NO_SEASON'
            ? 'No active season'
            : `Unlimited · kicks in if you lose every point${lifesaver.usedCount > 0 ? ` · used ${lifesaver.usedCount}× this season` : ''}`;
  return (
    <div className="stat-tile lifesaver-tile" data-testid="lifesaver-tile" data-state={lifesaver?.state ?? ''}>
      <div className="label">Lifesaver</div>
      <div className="row" style={{ marginTop: 6, alignItems: 'center', gap: 10 }}>
        <span className={`lifesaver-mini${lifesaver?.claimable ? ' ready' : ''}`}>
          <Buoy size={34} />
        </span>
        {lifesaver?.claimable ? (
          <button className="btn lifesaver" data-testid="lifesaver-claim" onClick={openRescue}>
            Rescue me +{fmtPoints(lifesaver.amount)}
          </button>
        ) : (
          <span className="value small">{lifesaver ? `+${fmtPoints(lifesaver.amount)}` : '—'}</span>
        )}
      </div>
      <div className="tiny muted" style={{ marginTop: 6 }}>
        {status}
      </div>
    </div>
  );
}
