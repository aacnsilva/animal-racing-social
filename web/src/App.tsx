import { useEffect, useState, type ReactNode } from 'react';
import { ComboSlip } from './components/ComboSlip';
import { Header } from './components/Header';
import { useSession, setSessionError } from './lib/api';
import { loadSeason, refreshDaily, refreshUnread, refreshWallet, resetUserStores, toastStore } from './lib/app';
import { friendlyCode } from './lib/errors';
import { useStore } from './lib/hooks';
import { Link, matchPath, useLocation } from './lib/router';
import { AdminPage } from './pages/AdminPage';
import { AnimalPage, AnimalsPage } from './pages/AnimalsPage';
import { LeaderboardsPage } from './pages/LeaderboardsPage';
import { MyBetsPage } from './pages/MyBetsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ProfilePage } from './pages/ProfilePage';
import { RaceCardPage } from './pages/RaceCardPage';
import { RacePage } from './pages/RacePage';
import { VenuePage, VenuesPage } from './pages/VenuesPage';
import { WalletPage } from './pages/WalletPage';

type Route = [string, (params: Record<string, string>) => ReactNode, string];

const ROUTES: Route[] = [
  ['/', () => <RaceCardPage view="upcoming" />, 'Race card'],
  ['/results', () => <RaceCardPage view="results" />, 'Results'],
  ['/races/:id', (p) => <RacePage key={p.id} id={p.id!} />, 'Race'],
  ['/bets', () => <MyBetsPage />, 'My bets'],
  ['/wallet', () => <WalletPage />, 'Wallet'],
  ['/leaderboards', () => <LeaderboardsPage />, 'Leaderboards'],
  ['/animals', () => <AnimalsPage />, 'Animals'],
  ['/animals/:id', (p) => <AnimalPage key={p.id} id={p.id!} />, 'Animal'],
  ['/venues', () => <VenuesPage />, 'Venues'],
  ['/venues/:id', (p) => <VenuePage key={p.id} id={p.id!} />, 'Venue'],
  ['/notifications', () => <NotificationsPage />, 'Notifications'],
  ['/me', () => <ProfilePage />, 'Profile'],
  ['/admin', () => <AdminPage />, 'Admin'],
];

function NotFound() {
  return (
    <div className="card empty">
      <h2>Off the track</h2>
      <p>
        That page does not exist.{' '}
        <Link to="/" className="link">
          Back to the race card
        </Link>
      </p>
    </div>
  );
}

function Toasts() {
  const toasts = useStore(toastStore);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function App({ authError }: { authError: string | null }) {
  const session = useSession();
  const { path } = useLocation();
  const [bannerError, setBannerError] = useState<string | null>(authError);

  useEffect(() => {
    void loadSeason();
  }, []);

  useEffect(() => {
    if (session.status !== 'authed') {
      if (session.status === 'anon') resetUserStores();
      return;
    }
    refreshWallet(0);
    void refreshUnread();
    void refreshDaily();
    const unread = setInterval(() => void refreshUnread(), 30_000);
    const wallet = setInterval(() => refreshWallet(0), 30_000);
    const daily = setInterval(() => void refreshDaily(), 300_000);
    return () => {
      clearInterval(unread);
      clearInterval(wallet);
      clearInterval(daily);
    };
  }, [session.status, session.user?.userId]);

  useEffect(() => {
    if (session.error === 'BANNED') setBannerError('BANNED');
  }, [session.error]);

  let content: ReactNode = <NotFound />;
  let title = 'Not found';
  for (const [pattern, render, label] of ROUTES) {
    const params = matchPath(pattern, path);
    if (params) {
      content = render(params);
      title = label;
      break;
    }
  }

  useEffect(() => {
    document.title = `${title} · Animal Racing Social`;
  }, [title]);

  return (
    <div className="app">
      <Header />
      {bannerError && (
        <div className="banner notice error" role="alert" data-testid="auth-error">
          <span style={{ flex: 1 }}>
            Sign-in problem: {friendlyCode(bannerError)}
            <span className="code">{bannerError}</span>
          </span>
          <button
            className="btn small ghost"
            onClick={() => {
              setBannerError(null);
              setSessionError(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <main className="main">{content}</main>
      <footer className="footer">
        Animal Racing Social is a portfolio project. Fictional animals, fictional points: no real money, prizes or wagering of any kind.
      </footer>
      <ComboSlip />
      <Toasts />
    </div>
  );
}
