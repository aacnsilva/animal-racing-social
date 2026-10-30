import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

type ProviderId = 'google' | 'github';
type Profile = { subject: string; name: string; email: string };
type Grant = { provider: ProviderId; clientId: string; redirectUri: string; challenge: string; profile: Profile; expiresAt: number };

const clients = new Map<string, { id: string; secret: string }>();
for (const entry of (process.env.MOCK_CLIENTS ?? 'google:ars-google:ars-google-secret,github:ars-github:ars-github-secret').split(',')) {
  const [provider, id, secret] = entry.split(':');
  if (provider && id && secret) clients.set(provider, { id, secret });
}

const codes = new Map<string, Grant>();
const tokens = new Map<string, { provider: ProviderId; profile: Profile }>();

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
const numericId = (subject: string) => (/^\d+$/.test(subject) ? Number(subject) : Number.parseInt(createHash('sha256').update(subject).digest('hex').slice(0, 10), 16));

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if ((req.headers['content-type'] ?? '').includes('application/json')) return new URLSearchParams(JSON.parse(text || '{}'));
  return new URLSearchParams(text);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function authorizePage(res: ServerResponse, provider: ProviderId, query: URLSearchParams): void {
  const client = clients.get(provider);
  const redirectUri = query.get('redirect_uri') ?? '';
  if (!client || query.get('client_id') !== client.id || !redirectUri || query.get('code_challenge_method') !== 'S256' || !query.get('code_challenge')) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('invalid authorization request');
    return;
  }
  const suggested = query.get('login_hint') ?? `racer-${randomBytes(3).toString('hex')}`;
  const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge'].map((name) => `<input type="hidden" name="${name}" value="${escape(query.get(name) ?? '')}">`).join('');
  const title = provider === 'google' ? 'Mock Google' : 'Mock GitHub';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} sign-in</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f1ea;margin:0;display:grid;place-items:center;min-height:100vh}form{background:#fff;padding:24px;border-radius:12px;box-shadow:0 2px 12px #0002;display:grid;gap:12px;width:min(360px,90vw)}label{display:grid;gap:4px;font-size:14px}input{padding:8px;font-size:16px}button{padding:10px;font-size:16px;cursor:pointer}.row{display:flex;gap:8px}.row button{flex:1}</style></head>
<body><form method="post" action="/${provider}/approve"><h1>${title}</h1><p>Development identity provider. No real account is used.</p>${hidden}
<label>Account ID<input name="subject" value="${escape(suggested)}" required></label>
<label>Display name<input name="name" value="${escape(query.get('name_hint') ?? 'Test Racer')}" required></label>
<label>Email<input name="email" type="email" value="${escape(`${suggested}@example.test`)}"></label>
<div class="row"><button type="submit" name="decision" value="allow">Sign in</button><button type="submit" name="decision" value="deny">Cancel</button></div></form></body></html>`);
}

async function approve(req: IncomingMessage, res: ServerResponse, provider: ProviderId): Promise<void> {
  const form = await readForm(req);
  const redirectUri = form.get('redirect_uri') ?? '';
  const target = new URL(redirectUri);
  if (form.get('state')) target.searchParams.set('state', form.get('state')!);
  if (form.get('decision') === 'deny') {
    target.searchParams.set('error', 'access_denied');
  } else {
    const code = randomBytes(16).toString('base64url');
    codes.set(code, {
      provider,
      clientId: form.get('client_id') ?? '',
      redirectUri,
      challenge: form.get('code_challenge') ?? '',
      profile: { subject: form.get('subject') ?? 'anonymous', name: form.get('name') ?? 'Racer', email: form.get('email') ?? '' },
      expiresAt: Date.now() + 60_000,
    });
    target.searchParams.set('code', code);
  }
  res.writeHead(302, { location: target.toString() });
  res.end();
}

async function exchange(req: IncomingMessage, res: ServerResponse, provider: ProviderId): Promise<void> {
  const form = await readForm(req);
  const client = clients.get(provider);
  const grant = codes.get(form.get('code') ?? '');
  codes.delete(form.get('code') ?? '');
  if (!client || form.get('client_id') !== client.id || form.get('client_secret') !== client.secret) return json(res, 401, { error: 'invalid_client' });
  if (!grant || grant.provider !== provider || grant.expiresAt < Date.now()) return json(res, 400, { error: 'invalid_grant' });
  if (grant.redirectUri !== form.get('redirect_uri') || grant.clientId !== client.id) return json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
  if (challengeOf(form.get('code_verifier') ?? '') !== grant.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
  const accessToken = randomBytes(24).toString('base64url');
  tokens.set(accessToken, { provider, profile: grant.profile });
  return json(res, 200, { access_token: accessToken, token_type: provider === 'google' ? 'Bearer' : 'bearer', expires_in: 3600, scope: provider === 'google' ? 'openid email profile' : 'read:user' });
}

function profile(req: IncomingMessage, res: ServerResponse, provider: ProviderId): void {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '');
  const session = tokens.get(token);
  if (!session || session.provider !== provider) return json(res, 401, { error: 'invalid_token' });
  const { subject, name, email } = session.profile;
  if (provider === 'google') return json(res, 200, { sub: subject, name, email, email_verified: true, picture: null });
  return json(res, 200, { id: numericId(subject), login: subject, name, email: email || null, avatar_url: null });
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/google/authorize') return authorizePage(res, 'google', url.searchParams);
    if (req.method === 'GET' && url.pathname === '/github/login/oauth/authorize') return authorizePage(res, 'github', url.searchParams);
    if (req.method === 'POST' && url.pathname === '/google/approve') return await approve(req, res, 'google');
    if (req.method === 'POST' && url.pathname === '/github/approve') return await approve(req, res, 'github');
    if (req.method === 'POST' && url.pathname === '/google/token') return await exchange(req, res, 'google');
    if (req.method === 'POST' && url.pathname === '/github/login/oauth/access_token') return await exchange(req, res, 'github');
    if (req.method === 'GET' && url.pathname === '/google/userinfo') return profile(req, res, 'google');
    if (req.method === 'GET' && url.pathname === '/github/user') return profile(req, res, 'github');
    json(res, 404, { error: 'not_found' });
  } catch (error) {
    json(res, 400, { error: 'invalid_request', error_description: error instanceof Error ? error.message : String(error) });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 9000);
  server.listen(port, () => process.stdout.write(`mock-oauth listening on ${port}\n`));
}
