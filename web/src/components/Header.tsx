import { useEffect, useState } from 'react';
import { api, login, logout, useSession } from '../lib/api';
import { dailyStore, refreshDaily, seasonStore, toast, unreadStore, walletStore } from '../lib/app';
import { friendlyError } from '../lib/errors';
import { fmtCountdown, fmtPoints } from '../lib/format';
import { useNow, useStore } from '../lib/hooks';
import { Link, useLocation } from '../lib/router';
import { Avatar, Logo, ProviderIcon } from './ui';

const NAV = [
  { to: '/', label: 'Races', testId: 'nav-races', match: (path: string) => path === '/' || path === '/results' || path.startsWith('/races') },
  { to: '/bets', label: 'My bets', testId: 'nav-bets', match: (path: string) => path.startsWith('/bets') },
  { to: '/wallet', label: 'Wallet', testId: 'nav-wallet', match: (path: string) => path.startsWith('/wallet') },
  { to: '/leaderboards', label: 'Leaderboards', testId: 'nav-leaderboards', match: (path: string) => path.startsWith('/leaderboards') },
  { to: '/animals', label: 'Animals', testId: 'nav-animals', match: (path: string) => path.startsWith('/animals') },
  { to: '/venues', label: 'Venues', testId: 'nav-venues', match: (path: string) => path.startsWith('/venues') },
];

function DailyRewardButton() {
  const daily = useStore(dailyStore);
  const now = useNow(30_000);
  const [busy, setBusy] = useState(false);
  const claim = async () => {
    setBusy(true);
    try {
      const result = await api<{ amount: number; balance: number; streak?: number }>('/v1/me/rewards/daily', { method: 'POST' });
      walletStore.set((wallet) => (wallet ? { ...wallet, balance: result.balance } : wallet));
      dailyStore.set((d) => (d ? { ...d, claimable: false, streak: result.streak ?? d.streak + 1 } : d));
      toast(`Daily reward: +${fmtPoints(result.amount)} pts${result.streak ? ` · ${result.streak}-day streak` : ''}`, 'success');
      void refreshDaily();
    } catch (error) {
      toast(friendlyError(error), 'error');
      void refreshDaily();
    } finally {
      setBusy(false);
    }
  };
  const claimable = Boolean(daily?.claimable);
  const label = !daily ? 'Daily' : claimable ? `+${daily.amount}` : fmtCountdown(Date.parse(daily.nextClaimAt) - now);
  return (
    <button
      className="btn reward small"
      data-testid="daily-reward-claim"
      disabled={!claimable || busy}
      onClick={() => void claim()}
      title={claimable ? 'Claim your daily reward' : daily ? `Claimed today · streak ${daily.streak} · next reward in ${label}` : 'Daily reward'}
    >
      <span aria-hidden>🎁</span>
      <span className="hide-sm">{claimable ? `Claim ${label}` : label}</span>
    </button>
  );
}

export function Header() {
  const session = useSession();
  const { path } = useLocation();
  const wallet = useStore(walletStore);
  const unread = useStore(unreadStore);
  const season = useStore(seasonStore);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const user = session.user;
  return (
    <header className="header">
      <button className="btn ghost icon menu-toggle" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <Link to="/" className="brand">
        <span className="brand-mark">
          <Logo />
        </span>
        <span className="brand-text">
          <b>Animal Racing</b>
          <span>Social · points only</span>
        </span>
      </Link>
      <nav className={`nav${open ? ' open' : ''}`}>
        {NAV.map((item) => (
          <Link key={item.to} to={item.to} data-testid={item.testId} className={item.match(path) ? 'active' : ''}>
            {item.label}
          </Link>
        ))}
        {user?.role === 'ADMIN' && (
          <Link to="/admin" data-testid="nav-admin" className={path.startsWith('/admin') ? 'active' : ''}>
            Admin
          </Link>
        )}
      </nav>
      <div className="header-tools">
        {season && (
          <span className="season-chip" title={`Ends ${new Date(season.endsAt).toLocaleString()}`}>
            {season.name}
          </span>
        )}
        {user ? (
          <>
            {wallet && (
              <Link to="/wallet" className="balance-chip" title="Season balance">
                <span className="num" data-testid="balance">
                  {String(Math.round(wallet.balance))}
                </span>
                <span className="unit">pts</span>
              </Link>
            )}
            <DailyRewardButton />
            <Link to="/notifications" className={`bell${path.startsWith('/notifications') ? ' active' : ''}`} data-testid="nav-notifications" aria-label={`Notifications, ${unread} unread`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span className={`badge-count${unread > 0 ? '' : ' empty'}`} data-testid="notification-count">
                {unread > 99 ? '99+' : unread}
              </span>
            </Link>
            <div className="user-menu" data-testid="user-menu">
              <Link to="/me" className="who" title="Profile">
                <Avatar name={user.displayName} url={user.avatarUrl} />
                <span>{user.displayName}</span>
              </Link>
              <button className="btn ghost small icon" data-testid="logout" onClick={() => void logout()} title="Sign out" aria-label="Sign out" style={{ width: 30, height: 30 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </>
        ) : session.status === 'loading' ? null : (
          <div className="signin">
            <button className="btn small provider-btn" data-testid="login-google" onClick={() => login('google')}>
              <ProviderIcon provider="google" />
              <span className="hide-sm">Google</span>
            </button>
            <button className="btn small provider-btn" data-testid="login-github" onClick={() => login('github')}>
              <ProviderIcon provider="github" />
              <span className="hide-sm">GitHub</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
