# Deployment (single VPS)

Production runs the whole stack with Docker Compose on one VPS (4 GB RAM is
enough). Images are built and tested in GitHub Actions, pushed to GHCR, and
pulled by the VPS. Nothing is compiled on the server.

```
git push main ──► GitHub Actions
                   ├─ unit: server typecheck + tests, generated protobuf in sync, mock-oauth tests, web build
                   ├─ engine: cargo test
                   ├─ e2e: docker compose build → up → Playwright UI tests → observability checks
                   │        └─ on main: push server/engine/web/alloy/jaeger/grafana images to GHCR (sha-<commit>, latest)
                   └─ deploy (if DEPLOY_ENABLED): scp deploy files → ssh → deploy.sh sha-<commit>
VPS /opt/ars ──► docker compose -f compose.prod.yml pull && up -d --wait
                   Caddy (80/443, automatic HTTPS) → web assets, /v1 → api, /v1/races/*/stream → sse, /grafana → Grafana
```

## 1. Prepare the VPS (once)

Requirements: Ubuntu/Debian, a DNS `A` record for your domain pointing at the
server, ports 80 and 443 open.

```bash
scp deploy/setup-vps.sh root@your-vps:/root/
```

```bash
ssh root@your-vps 'DOMAIN=racing.example.com BOOTSTRAP_ADMINS=github:12345 DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... /root/setup-vps.sh'
```

`DISCORD_WEBHOOK_URL` is the webhook of the Discord channel that receives
alerts (Discord: channel settings → Integrations → Webhooks → New Webhook →
Copy Webhook URL).

`setup-vps.sh` installs Docker, adds a 2 GB swap file if the server has no
swap, creates a `deploy` user in the `docker` group, enables the firewall
(SSH, 80, 443), creates `/opt/ars` and writes `/opt/ars/.env` with generated
secrets (Postgres, service DB roles, JWT, script-sealing key, Grafana admin
password). It also installs a nightly `backup.sh` cron job. It is idempotent
and never overwrites an existing `.env`.

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
For manual deploys or rollbacks later, either make the six packages
(`server`, `engine`, `web`, `alloy`, `jaeger`, `grafana`) public, or run
`docker login ghcr.io` once on the VPS with a personal access token that has
`read:packages`.

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
| Alloy, VictoriaMetrics, VictoriaLogs, Jaeger | 256 MB each |
| Grafana | 192 MB |

The limits add up to more than 4 GB, but typical use is about 1.7 GB; the
2 GB swap file absorbs bursts. Move to an 8 GB server if `HostPressure`
fires regularly.

Monte Carlo load is tunable in `.env`: `ODDS_RUNS_PRERACE`, `ODDS_RUNS_LIVE`,
`ODDS_THREADS`.

## 5. Observability

Design: [`observability.md`](./observability.md).

Grafana is the only observability UI exposed: `https://<DOMAIN>/grafana`,
user `admin`, password `GRAFANA_ADMIN_PASSWORD` from `/opt/ars/.env`. The
**ARS** folder holds five dashboards (Overview, Race day, Betting & wallet,
Event pipeline, Platform). Explore has three datasources: VictoriaMetrics
(metrics, PromQL), VictoriaLogs (logs, LogsQL) and Jaeger (traces). A log
line's `trace_id` links to its trace, and a span links back to its logs.

Useful queries:

| Question | Where |
|---|---|
| Everything one request did | Copy `x-trace-id` from the response headers, open it in Explore → Jaeger |
| Logs of a service | Explore → VictoriaLogs: `{job="bet-worker"} AND level:error` |
| Logs of a trace | `trace_id:="<id>"` |
| Trace of a bet | Betting & wallet dashboard → **Bet lookup** row, enter the bet id |
| Consumer lag | Event pipeline dashboard, or `sum by (consumergroup) (kafka_consumergroup_uncommitted_offsets_sum)` |

Settings in `.env`:

| Variable | Default | Meaning |
|---|---|---|
| `GRAFANA_ADMIN_PASSWORD` | generated | Grafana `admin` password (only applied when the Grafana volume is created; change it later in Grafana) |
| `DISCORD_WEBHOOK_URL` | required | Where alerts are posted |
| `TRACE_SAMPLE_PERCENT` | 25 | Share of ordinary traces kept; errors, slow traces and settlement, cash-out, cancellation, admin and reconciliation flows are always kept |
| `METRICS_RETENTION` / `LOGS_RETENTION` / `TRACE_RETENTION` | 30d / 14d / 168h | Retention per store |

**Upgrading a VPS set up before observability existed:** add
`GRAFANA_ADMIN_PASSWORD=<openssl rand -hex 16>` and
`DISCORD_WEBHOOK_URL=<webhook>` to `/opt/ars/.env` (the deploy refuses to
start without them), and add swap if `swapon --show` prints nothing:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Alloy reads container logs and stats through the Docker socket and
`/run/containerd/containerd.sock`, and host metrics from `/proc`, `/sys` and
`/` (all read-only). Telemetry stores keep their data in the `vmdata`,
`vldata`, `jaegerdata` and `grafanadata` volumes; losing them loses history
only. Do not run a second Alloy against the `alloydata` volume: two writers
corrupt its write-ahead log and metrics silently go missing. If that happens,
stop Alloy, `docker volume rm ars_alloydata`, and start it again.

## 6. Alert runbook

Alerts are posted to Discord with a link to the dashboard panel and to this
section. Critical alerts repeat every hour, warnings every 6 hours, and
resolutions are posted too. To silence an alert during maintenance, use
Grafana → Alerting → Silences.

Commands below run in `/opt/ars`; `dc` stands for
`docker compose -f compose.prod.yml --env-file .env`.

### TickDriftHigh
Ticks are published more than 250 ms late (p99): the race clock is unfair.
Check host CPU and memory on the Platform dashboard (Monte Carlo pricing
competes with the broadcaster), then `dc logs --tail=200 race-broadcaster`.
Lower `ODDS_RUNS_LIVE` / `ODDS_THREADS` if the odds engine saturates the CPU.

### RaceOverdue
A race missed its start, finish or seal deadline. The `kind` label says which.
`start`: the broadcaster did not start an OPEN/LOCKED race 30 s after
`startAt`; check `dc ps race-broadcaster` and its logs. `finish`: a LIVE race
ran 5 minutes past its estimate. `seal`: the race engine has not sealed a
script; check `race-engine` logs and the `ScriptFailures` alert. An admin can
cancel a stuck race from the Admin page, which refunds every bet.

### NoActiveSeason
No season is active, so new players get no starting grant. Check
`dc logs --tail=100 season`; the season service creates the next season every
30 s when none is active.

### SchedulerHorizonLow
Less than half of the scheduling horizon has races. Look at **Scheduler
skipped slots** on the Race day dashboard: `not_enough_animals` points at the
stable, `no_engine` at the race engine, `error` at scheduler logs.

### OddsRepriceSlow
Live prices update less often than every 1.5 s (p95). The odds engine is
CPU-bound: check the Platform dashboard, lower `ODDS_RUNS_LIVE`, or raise
`ODDS_THREADS` if the server has idle cores.

### ScriptFailures
The race engine failed to generate a script. `dc logs --tail=200 race-engine`
and the trace linked from the error log line.

### StablePoolLow
A species has fewer than 80% of its target active animals. The stable recruits
every 10 minutes; check `dc logs --tail=100 stable`.

### BetsStuckPending
A bet has waited more than 30 s for a decision. Check bet-worker health and
the `bet.commands` lag on the Event pipeline dashboard, then the wallet (the
bet-worker debits through it).

### SettlementBacklog
Legs on finished races are still unsettled. Check settlement and
market-manager lag and logs; resulted markets drive settlement.

### LedgerMismatch
The wallet reconciliation job found a cached balance or open stake that does
not match the ledger. This is a correctness bug, not an outage: do not edit
balances by hand. The ledger is the source of truth; find the wallet with
`SELECT w.user_id, w.season_id, w.balance, sum(l.amount) FROM wallet.wallets w JOIN wallet.ledger_entries l USING (user_id, season_id) GROUP BY 1, 2, 3 HAVING w.balance <> sum(l.amount);`
and trace its recent bets.

### DeadLetter
A consumer gave up on a message after its retries and stored it in
`admin.dlq`. The Admin page's **Dead-letter queue** card shows the error; fix the cause, then
replay it from there. The replayed message keeps its original trace.

### OutboxStalled
An outbox has rows older than 30 s: its relay is not publishing. The `schema`
label names the owning service. Check Kafka health and that service's logs.

### ConsumerLagHigh
A critical consumer group is more than 1 000 messages behind. Check its
processing time on the Event pipeline dashboard and its container CPU and
memory.

### ServiceDown
A `/healthz` probe has failed for a minute. `dc ps`, then the service logs.
The `web` probe checks `https://<DOMAIN>/` from inside the server. This alert
also fires when Alloy itself is down (no probe data).

### ContainerRestarts
A container restarted or was OOM-killed in the last 10 minutes. Compare its
memory with its limit on the Platform dashboard and read its last logs.

### HostPressure
Disk above 85% or memory above 90%. Free disk with
`docker image prune -af --filter until=168h` and check `backups/`; shorten
retention in `.env` if telemetry volumes grow too large.

### SLO burn alerts
`SLOFastBurn` (critical) means an SLO is spending its 30-day error budget
14.4 times too fast over both the last hour and 5 minutes; `SLOSlowBurn`
(warning) 6 times over 6 hours and 30 minutes. The `slo` label names the
objective; the Overview dashboard shows compliance and burn rate for each,
and the matching dashboard shows the underlying latency or error rate.
