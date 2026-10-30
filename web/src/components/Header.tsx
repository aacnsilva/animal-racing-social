import { useEffect, useState } from 'react';
import { api, login, logout, useSession } from '../lib/api';
import { dailyStore, refreshDaily, seasonStore, toast, unreadStore, walletStore } from '../lib/app';
import { friendlyError } from '../lib/errors';
import { fmtCountdown, fmtPoints } from '../lib/format';
import { useNow, useStore } from '../lib/hooks';
import { Link, useLocation } from '../lib/router';
import { Avatar, Logo, ProviderIcon } from './ui';

type TabIconName = 'races' | 'bets' | 'wallet' | 'ranks' | 'more';

const NAV: { to: string; label: string; testId: string; match: (path: string) => boolean; tab?: { id: string; label: string; icon: TabIconName } }[] = [
  { to: '/', label: 'Races', testId: 'nav-races', match: (path) => path === '/' || path === '/results' || path.startsWith('/races'), tab: { id: 'races', label: 'Races', icon: 'races' } },
  { to: '/bets', label: 'My bets', testId: 'nav-bets', match: (path) => path.startsWith('/bets'), tab: { id: 'bets', label: 'My bets', icon: 'bets' } },
  { to: '/wallet', label: 'Wallet', testId: 'nav-wallet', match: (path) => path.startsWith('/wallet'), tab: { id: 'wallet', label: 'Wallet', icon: 'wallet' } },
  { to: '/leaderboards', label: 'Leaderboards', testId: 'nav-leaderboards', match: (path) => path.startsWith('/leaderboards'), tab: { id: 'leaderboards', label: 'Ranks', icon: 'ranks' } },
  { to: '/animals', label: 'Animals', testId: 'nav-animals', match: (path) => path.startsWith('/animals') },
  { to: '/venues', label: 'Venues', testId: 'nav-venues', match: (path) => path.startsWith('/venues') },
];

const TAB_ICON: Record<TabIconName, string> = {
  races: 'M5 21V4h11l-2 4 2 4H5',
  bets: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM14 5v2M14 11v2M14 17v2',
  wallet: 'M4 7a2 2 0 0 1 2-2h11v4M4 7v10a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2zM16 14h1',
  ranks: 'M3 20h18M5 20v-6h4v6M10 20V8h4v12M15 20v-9h4v9',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};

function TabIcon({ name }: { name: TabIconName }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d={TAB_ICON[name]} stroke="currentColor" strokeWidth={name === 'more' ? 3.2 : 1.9} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TabBar({ path, menuOpen, moreActive, onMore }: { path: string; menuOpen: boolean; moreActive: boolean; onMore: () => void }) {
  return (
    <nav className="tabbar" aria-label="Sections">
      {NAV.filter((item) => item.tab).map((item) => (
        <Link key={item.to} to={item.to} data-testid={`tab-${item.tab!.id}`} className={!menuOpen && item.match(path) ? 'active' : ''} aria-current={item.match(path) ? 'page' : undefined}>
          <TabIcon name={item.tab!.icon} />
          <span>{item.tab!.label}</span>
        </Link>
      ))}
      <button type="button" data-testid="tab-more" className={menuOpen || moreActive ? 'active' : ''} aria-expanded={menuOpen} aria-controls="site-nav" onClick={onMore}>
        <TabIcon name="more" />
        <span>More</span>
      </button>
    </nav>
  );
}

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
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const user = session.user;
  const moreActive = !NAV.some((item) => item.tab && item.match(path));
  return (
    <>
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
        {open && <div className="nav-scrim" onClick={() => setOpen(false)} aria-hidden />}
        <nav id="site-nav" className={`nav${open ? ' open' : ''}`}>
          {NAV.map((item) => (
            <Link key={item.to} to={item.to} data-testid={item.testId} className={`${item.match(path) ? 'active' : ''}${item.tab ? ' tabbed' : ''}`}>
              {item.label}
            </Link>
          ))}
          {user?.role === 'ADMIN' && (
            <Link to="/admin" data-testid="nav-admin" className={path.startsWith('/admin') ? 'active' : ''}>
              Admin
            </Link>
          )}
          {user && (
            <Link to="/me" data-testid="nav-profile" className={`sheet-only${path.startsWith('/me') ? ' active' : ''}`}>
              Profile
            </Link>
          )}
          {user && (
            <button type="button" className="sheet-only nav-signout" data-testid="nav-logout" onClick={() => void logout()}>
              Sign out
            </button>
          )}
          {season && (
            <div className="nav-foot sheet-only">
              {season.name} · ends {new Date(season.endsAt).toLocaleDateString()}
            </div>
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
                <button className="btn ghost small icon user-logout" data-testid="logout" onClick={() => void logout()} title="Sign out" aria-label="Sign out" style={{ width: 30, height: 30 }}>
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
      <TabBar path={path} menuOpen={open} moreActive={moreActive} onMore={() => setOpen((v) => !v)} />
    </>
  );
}
