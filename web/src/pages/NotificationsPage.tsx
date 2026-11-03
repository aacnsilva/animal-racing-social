import { useEffect, useRef, useState } from 'react';
import { Empty, ErrorNotice, Loading, Pager, SignInPrompt, Switch } from '../components/ui';
import { api, qs, useSession } from '../lib/api';
import { toast, unreadStore } from '../lib/app';
import { friendlyError } from '../lib/errors';
import { fmtRelative } from '../lib/format';
import { useAsync, usePaged, useStore } from '../lib/hooks';
import {
  NOTIFICATION_ICON,
  NOTIFICATION_LABEL,
  NOTIFICATION_TYPES,
  notificationLink,
  notificationText,
} from '../lib/notifications';
import { navigate } from '../lib/router';
import type { Notification, Page } from '../lib/types';

type Settings = { enabled: boolean; types: Record<string, boolean> };

function SettingsCard() {
  const settings = useAsync(() => api<Settings>('/v1/me/notification-settings'), []);
  const [saving, setSaving] = useState(false);
  const save = async (next: Settings) => {
    settings.setData(next);
    setSaving(true);
    try {
      settings.setData(await api<Settings>('/v1/me/notification-settings', { method: 'PUT', body: next }));
    } catch (error) {
      toast(friendlyError(error), 'error');
      settings.reload();
    } finally {
      setSaving(false);
    }
  };
  if (settings.error) return <ErrorNotice error={settings.error} onRetry={settings.reload} />;
  if (!settings.data) return <Loading />;
  const s = settings.data;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Settings</h2>
        {saving && <span className="tiny muted">saving…</span>}
      </div>
      <div className="setting">
        <div>
          <b>In-app notifications</b>
          <div className="tiny muted">Turn everything off at once</div>
        </div>
        <Switch checked={s.enabled} onChange={(enabled) => void save({ ...s, enabled })} label="All notifications" />
      </div>
      {NOTIFICATION_TYPES.map((type) => (
        <div className="setting" key={type} data-testid="notification-setting" data-type={type}>
          <div>
            <span>{NOTIFICATION_LABEL[type]}</span>
          </div>
          <Switch
            checked={s.enabled && s.types[type]}
            disabled={!s.enabled}
            onChange={(value) => void save({ ...s, types: { ...s.types, [type]: value } })}
            label={NOTIFICATION_LABEL[type]}
          />
        </div>
      ))}
    </section>
  );
}

export function NotificationsPage() {
  const session = useSession();
  const authed = session.status === 'authed';
  const unread = useStore(unreadStore);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const paged = usePaged(
    (cursor) =>
      authed
        ? api<Page<Notification> & { unreadCount: number }>(
            `/v1/me/notifications${qs({ unread: onlyUnread ? 'true' : null, cursor, limit: 30 })}`,
          ).then((page) => {
            unreadStore.set(page.unreadCount);
            return page;
          })
        : Promise.resolve({ items: [], nextCursor: null }),
    [authed, onlyUnread],
  );
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [readItems, setReadItems] = useState(paged.items);
  if (readItems !== paged.items) {
    setReadItems(paged.items);
    setReadIds(new Set());
  }

  const { reload } = paged;
  const previousUnread = useRef(unread);
  useEffect(() => {
    if (unread > previousUnread.current) reload();
    previousUnread.current = unread;
  }, [unread, reload]);

  if (session.status === 'loading') return <Loading />;
  if (!authed) return <SignInPrompt message="Sign in to see your notifications." />;

  const markRead = async (ids: string[] | 'all') => {
    try {
      const result = await api<{ unreadCount: number }>('/v1/me/notifications/read', {
        method: 'POST',
        body: ids === 'all' ? { all: true } : { ids },
      });
      unreadStore.set(result.unreadCount);
      if (ids === 'all') setReadIds(new Set(paged.items.map((n) => n.id)));
      else setReadIds((prev) => new Set([...prev, ...ids]));
    } catch (error) {
      toast(friendlyError(error), 'error');
    }
  };

  return (
    <div className="race-body notif-layout">
      <main>
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <div className="eyebrow">Inbox</div>
            <h1>Notifications</h1>
            <p>Bet results, cash-outs, races you backed and leaderboard moves. Kept for 30 days.</p>
          </div>
          <div className="row wrap">
            <div className="tabs">
              <button className={!onlyUnread ? 'active' : ''} onClick={() => setOnlyUnread(false)}>
                All
              </button>
              <button className={onlyUnread ? 'active' : ''} onClick={() => setOnlyUnread(true)}>
                Unread ({unread})
              </button>
            </div>
            <button className="btn" data-testid="mark-all-read" onClick={() => void markRead('all')}>
              Mark all read
            </button>
          </div>
        </div>
        <section className="card flush">
          {paged.error ? <ErrorNotice error={paged.error} onRetry={paged.reload} /> : null}
          {paged.loading && !paged.items.length ? (
            <Loading />
          ) : paged.items.length === 0 ? (
            <Empty>{onlyUnread ? 'All caught up.' : 'Nothing here yet. Place a bet and results will land here.'}</Empty>
          ) : (
            paged.items.map((n) => {
              const isUnread = !n.readAt && !readIds.has(n.id);
              const link = notificationLink(n);
              return (
                <button
                  type="button"
                  key={n.id}
                  className={`notif${isUnread ? ' unread' : ''}`}
                  data-testid="notification-item"
                  data-notification-id={n.id}
                  data-type={n.type}
                  data-unread={isUnread ? 'true' : 'false'}
                  onClick={() => {
                    if (isUnread) void markRead([n.id]);
                    if (link) navigate(link);
                  }}
                >
                  <span className="ico">{NOTIFICATION_ICON[n.type] ?? '•'}</span>
                  <span className="notif-body">
                    <b>{NOTIFICATION_LABEL[n.type] ?? n.type}</b>
                    <span className="small">{notificationText(n)}</span>
                    <span className="tiny muted">{fmtRelative(n.createdAt)}</span>
                  </span>
                  {isUnread && <span className="dot" title="Unread" />}
                </button>
              );
            })
          )}
          <Pager hasMore={paged.hasMore} loading={paged.loading} onMore={paged.loadMore} />
        </section>
      </main>
      <aside>
        <SettingsCard />
      </aside>
    </div>
  );
}
