import { useEffect, useState } from 'react';
import { Avatar, Loading, ProviderIcon, SignInPrompt } from '../components/ui';
import { api, ApiError, setSessionUser, useSession } from '../lib/api';
import { toast } from '../lib/app';
import { friendlyError } from '../lib/errors';
import { fmtDateTime } from '../lib/format';
import type { ProviderId, User } from '../lib/types';

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'google', label: 'Google' },
  { id: 'github', label: 'GitHub' },
];

export function ProfilePage() {
  const session = useSession();
  const user = session.user;
  const [name, setName] = useState(user?.displayName ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string; code?: string } | null>(null);
  const [linking, setLinking] = useState<ProviderId | null>(null);

  useEffect(() => {
    if (!user) return;
    setName(user.displayName);
    setAvatarUrl(user.avatarUrl ?? '');
  }, [user?.userId]);

  useEffect(() => {
    if (session.status !== 'authed') return;
    api<User>('/v1/me')
      .then((fresh) => setSessionUser(fresh))
      .catch(() => undefined);
  }, [session.status]);

  if (session.status === 'loading') return <Loading />;
  if (!user) return <SignInPrompt message="Sign in to manage your profile." />;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = {};
      if (name.trim() !== user.displayName) body.displayName = name.trim();
      if ((avatarUrl.trim() || null) !== user.avatarUrl) body.avatarUrl = avatarUrl.trim() || null;
      const updated = await api<User>('/v1/me', { method: 'PATCH', body });
      setSessionUser(updated);
      setMessage({ kind: 'success', text: 'Profile saved.' });
    } catch (error) {
      setMessage({ kind: 'error', text: friendlyError(error), code: error instanceof ApiError ? error.code : undefined });
    } finally {
      setSaving(false);
    }
  };

  const link = async (provider: ProviderId) => {
    setLinking(provider);
    try {
      const result = await api<{ url: string }>(`/v1/me/providers/${provider}/link`, { method: 'POST' });
      window.location.assign(result.url);
    } catch (error) {
      toast(friendlyError(error), 'error');
      setLinking(null);
    }
  };

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 820 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">Account</div>
          <h1 className="row">
            <Avatar name={user.displayName} url={user.avatarUrl} /> {user.displayName}
          </h1>
          <p>
            Racer since {fmtDateTime(user.createdAt)} · {user.role === 'ADMIN' ? 'Administrator' : 'Player'}
          </p>
        </div>
      </div>
      <section className="card stack">
        <h2>Profile</h2>
        <label className="field">
          <span>Display name</span>
          <input className="input" data-testid="display-name-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Avatar URL (https)</span>
          <input className="input" value={avatarUrl} placeholder="https://…" onChange={(e) => setAvatarUrl(e.target.value)} />
        </label>
        <div className="row">
          <button className="btn primary" data-testid="save-profile" onClick={() => void save()} disabled={saving || name.trim().length < 2}>
            Save profile
          </button>
          {message && (
            <span className={`notice small ${message.kind}`} data-testid="profile-message">
              {message.text}
              {message.code && <span className="code">{message.code}</span>}
            </span>
          )}
        </div>
      </section>
      <section className="card stack">
        <h2>Sign-in methods</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Link both providers to sign in either way. Accounts are keyed by provider identity, never by email.
        </p>
        {PROVIDERS.map((provider) => {
          const linked = user.providers.includes(provider.id);
          return (
            <div className="setting" key={provider.id} data-provider={provider.id} data-linked={linked ? 'true' : 'false'}>
              <span className="provider-btn">
                <ProviderIcon provider={provider.id} />
              </span>
              <div>
                <b>{provider.label}</b>
                <div className="tiny muted">{linked ? 'Linked' : 'Not linked'}</div>
              </div>
              {linked ? (
                <span className="chip green">Linked</span>
              ) : (
                <button className="btn small" onClick={() => void link(provider.id)} disabled={linking !== null} data-testid={`link-${provider.id}`}>
                  Link {provider.label}
                </button>
              )}
            </div>
          );
        })}
      </section>
      <section className="card">
        <h2 style={{ marginBottom: 10 }}>Details</h2>
        <dl className="kv">
          <dt>User id</dt>
          <dd className="mono">{user.userId}</dd>
          <dt>Role</dt>
          <dd>{user.role}</dd>
        </dl>
      </section>
    </div>
  );
}
