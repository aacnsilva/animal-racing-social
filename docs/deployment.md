# Deployment (single VPS)

Production runs the whole stack with Docker Compose on one VPS (4 GB RAM is
enough). Images are built and tested in GitHub Actions, pushed to GHCR, and
pulled by the VPS. Nothing is compiled on the server.

```
git push main ──► GitHub Actions
                   ├─ unit: server typecheck + tests, generated protobuf in sync, mock-oauth tests, web build
                   ├─ engine: cargo test
                   ├─ e2e: docker compose build → up → Playwright UI tests
                   │        └─ on main: push server/engine/web images to GHCR (sha-<commit>, latest)
                   └─ deploy (if DEPLOY_ENABLED): scp deploy files → ssh → deploy.sh sha-<commit>
VPS /opt/ars ──► docker compose -f compose.prod.yml pull && up -d --wait
                   Caddy (80/443, automatic HTTPS) → web assets, /v1 → api, /v1/races/*/stream → sse
```

## 1. Prepare the VPS (once)

Requirements: Ubuntu/Debian, a DNS `A` record for your domain pointing at the
server, ports 80 and 443 open.

```bash
scp deploy/setup-vps.sh root@your-vps:/root/
```

```bash
ssh root@your-vps 'DOMAIN=racing.example.com BOOTSTRAP_ADMINS=github:12345 /root/setup-vps.sh'
```

`setup-vps.sh` installs Docker, creates a `deploy` user in the `docker` group,
enables the firewall (SSH, 80, 443), creates `/opt/ars` and writes
`/opt/ars/.env` with generated secrets (Postgres, service DB roles, JWT,
script-sealing key). It also installs a nightly `backup.sh` cron job. It is
idempotent and never overwrites an existing `.env`.

Then edit `/opt/ars/.env` on the server:

| Variable | Value |
|---|---|
| `OAUTH_GOOGLE_CLIENT_ID` / `_SECRET` | Google OAuth client, redirect URI `https://<DOMAIN>/v1/auth/google/callback` |
| `OAUTH_GITHUB_CLIENT_ID` / `_SECRET` | GitHub OAuth app, callback URL `https://<DOMAIN>/v1/auth/github/callback` |
| `BOOTSTRAP_ADMINS` | `provider:subject` list that becomes ADMIN on login (GitHub subject = numeric user id, Google = `sub`) |

A provider with no client id is simply hidden from the login screen.
`POSTGRES_PASSWORD` only applies when the database volume is first created.
Never rotate `SCRIPT_KEYS` by replacing the key: add a new one
(`k2:<hex>,k1:<hex>`) and set `SCRIPT_KEY_ID=k2`, so already-sealed races can
still be revealed.

## 2. Connect GitHub Actions (once)

1. Create an SSH key pair for CI and add the public key to
   `/home/deploy/.ssh/authorized_keys` on the VPS.
2. In the repository settings, create an environment **production** with these
   secrets:
   - `VPS_HOST`: server hostname or IP
   - `VPS_USER`: `deploy`
   - `VPS_SSH_KEY`: the private key
   - `VPS_KNOWN_HOSTS`: output of `ssh-keyscan your-vps`
3. Add a repository variable `DEPLOY_ENABLED=true`.

Every push to `main` now runs the pipeline and, once the e2e suite passes,
deploys the exact images it tested (`sha-<commit>` tags).

The deploy job logs the VPS into GHCR with the workflow's short-lived token.
For manual deploys or rollbacks later, either make the three packages
(`server`, `engine`, `web`) public, or run `docker login ghcr.io` once on the
VPS with a personal access token that has `read:packages`.

## 3. Day-2 operations

All commands run on the VPS as `deploy`, in `/opt/ars`.

| Task | Command |
|---|---|
| Deploy a specific build / roll back | `./deploy.sh sha-<commit>` |
| Status | `docker compose -f compose.prod.yml --env-file .env ps` |
| Logs | `docker compose -f compose.prod.yml --env-file .env logs -f --tail=100 api` |
| Backup now | `./backup.sh` (nightly via cron, keeps 14 dumps in `backups/`) |
| Restore | `gunzip -c backups/<file>.sql.gz \| docker compose -f compose.prod.yml --env-file .env exec -T postgres psql -U postgres -d ars` (on an empty database) |

`deploy.sh` pulls the images and runs the one-shot `migrate` job, which
applies new SQL migrations, refreshes role grants and creates Kafka topics.
It then recreates changed services and waits for health checks to pass.
Migrations are forward-only and additive, so rolling back the images keeps
the newer schema.

## 4. Resource budget (4 GB VPS)

| Component | Memory limit |
|---|---|
| Kafka (KRaft, 512 MB heap) | 900 MB |
| Postgres | 512 MB |
| Redis | 128 MB |
| 11 TypeScript services | 192 MB each (≈ 60–90 MB used) |
| race-engine, race-broadcaster | 192 MB each |
| odds-engine | 384 MB |
| Caddy | 128 MB |

Monte Carlo load is tunable in `.env`: `ODDS_RUNS_PRERACE`, `ODDS_RUNS_LIVE`,
`ODDS_THREADS`.
