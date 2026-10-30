import type { ReactNode } from 'react';
import { ApiError, login, useSession } from '../lib/api';
import { friendlyError } from '../lib/errors';
import { fmtStat, formClass, STAT_LABEL, statPct } from '../lib/format';
import { laneColor, laneText } from '../lib/track';
import type { ProviderId, Stats } from '../lib/types';

export function Lane({ lane, small }: { lane: number; small?: boolean }) {
  return (
    <span className={`lane${small ? ' sm' : ''}`} style={{ background: laneColor(lane), color: laneText(lane) }} title={`Lane ${lane}`}>
      {lane}
    </span>
  );
}

export function RaceStatus({ status, testId = true }: { status: string; testId?: boolean }) {
  return (
    <span className={`status status-${status}`} data-testid={testId ? 'race-status' : undefined}>
      {status}
    </span>
  );
}

export function Form({ last5 }: { last5: string[] }) {
  if (!last5?.length) return <span className="muted small">no form</span>;
  return (
    <span className="form" title="Last five, most recent first">
      {last5.map((entry, i) => (
        <span key={i} className={formClass(entry)}>
          {entry}
        </span>
      ))}
    </span>
  );
}

export function StatBars({ stats, compare }: { stats: Stats; compare?: Stats }) {
  const keys = Object.keys(STAT_LABEL) as (keyof Stats)[];
  return (
    <div className="statbars">
      {keys.map((key) => (
        <StatLine key={key} k={key} value={stats[key]} compare={compare?.[key]} />
      ))}
    </div>
  );
}

function StatLine({ k, value, compare }: { k: keyof Stats; value: number; compare?: number }) {
  return (
    <>
      <span className="muted">{STAT_LABEL[k]}</span>
      <span className="statbar" title={compare !== undefined ? `base ${fmtStat(k, compare)}` : undefined}>
        <i style={{ width: `${Math.round(statPct(k, value) * 100)}%` }} />
      </span>
      <span className="num">{fmtStat(k, value)}</span>
    </>
  );
}

export function MiniStats({ stats }: { stats: Stats }) {
  const keys = Object.keys(STAT_LABEL) as (keyof Stats)[];
  return (
    <span className="minibars" title={keys.map((k) => `${STAT_LABEL[k]} ${fmtStat(k, stats[k])}`).join(' · ')}>
      {keys.map((k) => (
        <i key={k} style={{ height: `${Math.max(12, statPct(k, stats[k]) * 100)}%` }} />
      ))}
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading">
      <Spinner /> <span style={{ marginLeft: 8 }}>{label}</span>
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const code = error instanceof ApiError ? error.code : null;
  return (
    <div className="notice error row wrap">
      <span>
        {friendlyError(error)}
        {code && <span className="code">{code}</span>}
      </span>
      {onRetry && (
        <button className="btn small" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </label>
  );
}

export function ProviderIcon({ provider }: { provider: ProviderId }) {
  if (provider === 'github') {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function SignInPrompt({ message = 'Sign in to continue.' }: { message?: string }) {
  const session = useSession();
  if (session.status === 'loading') return <Loading />;
  return (
    <div className="card stack" style={{ alignItems: 'center', textAlign: 'center', padding: 32 }}>
      <div style={{ fontSize: '2rem' }}>🏇</div>
      <h3>{message}</h3>
      <p className="muted small" style={{ margin: 0 }}>
        Points only, no real money. Every new racer gets the season grant to play with.
      </p>
      <div className="row">
        <button className="btn provider-btn" onClick={() => login('google')}>
          <ProviderIcon provider="google" /> Continue with Google
        </button>
        <button className="btn provider-btn" onClick={() => login('github')}>
          <ProviderIcon provider="github" /> Continue with GitHub
        </button>
      </div>
    </div>
  );
}

export function Avatar({ name, url }: { name: string; url?: string | null }) {
  return <span className="avatar">{url ? <img src={url} alt="" referrerPolicy="no-referrer" /> : (name || '?').slice(0, 1).toUpperCase()}</span>;
}

export function Pager({ hasMore, loading, onMore }: { hasMore: boolean; loading: boolean; onMore: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="pager">
      <button className="btn" onClick={onMore} disabled={loading}>
        {loading ? <Spinner /> : null} Load more
      </button>
    </div>
  );
}

export function Logo() {
  return (
    <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#f4b740" />
          <stop offset="1" stopColor="#e76f51" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="36" height="36" rx="10" fill="#122a20" stroke="#2f473d" />
      <path d="M8 27c4-10 10-15 24-15" stroke="url(#lg)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M8 32c5-7 11-10 24-10" stroke="#3ddc97" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.8" />
      <circle cx="31" cy="12" r="3.2" fill="#fff" />
    </svg>
  );
}
