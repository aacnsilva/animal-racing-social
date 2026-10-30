# Observability Design (v1)

How we see what the racing platform is doing: logs, metrics, traces, SLOs
and alerts. Contracts the services already follow are in
[`implementation.md`](./implementation.md); operations, Grafana access and
the alert runbook in [`deployment.md`](./deployment.md#5-observability).

Status: implemented. Where the build differs from the first draft of this
design, the text below describes what was built.

| Decision | Choice |
|---|---|
| Telemetry stores | Self-hosted on the VPS: **VictoriaMetrics** (metrics), **VictoriaLogs** (logs), **Jaeger v2** (traces) |
| Collector | **Grafana Alloy**: one OTLP endpoint for services, log shipping, embedded infra exporters |
| UI and alerting | **Grafana**: dashboards, Explore, alert rules |
| Instrumentation | Official **OpenTelemetry SDKs** (TypeScript and Rust), manual instrumentation at shared chokepoints |
| Alert delivery | **Discord** webhook |
| Access | Grafana for admins only, at `/grafana` behind its own login; nothing else exposed |

## 1. Goals and principles

1. **Product signals first.** The questions that matter are: is the race clock
   on time (fairness), do bets get decided and settled quickly, and is any
   point ever created or lost. Infrastructure metrics support those answers;
   they are not the goal.
2. **One trace per business flow, across HTTP and Kafka.** A bet is followed
   from the browser request through the outbox, Kafka, the acceptance worker,
   the wallet debit and every consumer of `BetAccepted`.
3. **Correlated by `trace_id`.** Every log line written inside a span carries
   its `trace_id`/`span_id`; Grafana jumps logs ↔ traces ↔ metrics.
4. **Sealed-information rule.** Before a race is FINISHED, no telemetry may
   contain anything derived from its script: seed, finish tick, order, lap
   leaders, script size, simulated positions. This is the same fairness rule
   as the API, and admins are bound by it too. Pre-race spans and logs carry
   only public facts (race id, venue, laps, hashes).
5. **Bounded cost.** Fits beside the app on the 4 GB VPS (§11). Metric labels
   are bounded enums; ids live in traces and logs only.
6. **Telemetry never breaks the app.** Exporters are asynchronous with bounded
   queues; when Alloy is down, spans are dropped and logs wait in Docker's
   json-file buffer.

## 2. Architecture

```
 TS services ─┐  OTLP/HTTP (traces + metrics)                    ┌──► Jaeger v2 (Badger)      traces
 Rust services┼──────────────────────────────► Grafana Alloy ────┼──► VictoriaMetrics        metrics
 Caddy ───────┘  (edge spans)                    │  ▲             └──► VictoriaLogs           logs
                                                 │  │ docker logs (json-file, stdout JSON)
 Embedded exporters inside Alloy: postgres,      │  └── every container
 redis, kafka (consumer lag), cadvisor, unix,    │
 blackbox (/healthz probes), Caddy /metrics ─────┘
                                                        Grafana ──reads──► VictoriaMetrics (Prometheus datasource)
                                                                           VictoriaLogs (victoriametrics-logs plugin)
                                                                           Jaeger
                                                        Grafana alerting ──► Discord webhook
```

| Component | Image | Role | RAM limit | Retention |
|---|---|---|---|---|
| Grafana Alloy | `grafana/alloy:v1.20.1` | OTLP/HTTP receiver (4318), tail sampling, log shipping, infra exporters, scrapes | 256 MB | WAL only |
| VictoriaMetrics | `victoriametrics/victoria-metrics:v1.154.0` | Prometheus-compatible TSDB, remote-write target | 256 MB | 30 d |
| VictoriaLogs | `victoriametrics/victoria-logs:v1.53.0` | Log store, Loki push API ingest | 256 MB | 14 d |
| Jaeger v2 | `jaegertracing/jaeger:2.20.0` | Trace store (Badger) and query API | 256 MB | 7 d |
| Grafana | `grafana/grafana:13.2.4` + `victoriametrics-logs-datasource` 0.33.1 | Dashboards, Explore, alerting | 192 MB | — |

Jaeger stays on 2.20: 2.21 removed the v1 HTTP API that Grafana's Jaeger
datasource still calls.

Configs live in `deploy/observability/`. Alloy, Jaeger and Grafana are built
into images with their configuration, provisioning and dashboards baked in
(`ghcr.io/<repo>/alloy|jaeger|grafana`, published by CI next to the app
images), so the VPS only needs `compose.prod.yml`. The stack is always on, in
production, development and CI. Only Grafana is reachable from outside,
through Caddy.

## 3. Instrumentation

### 3.1 TypeScript services

Dependencies (official SDK, no auto-instrumentation bundle: the
`require`-patching instrumentations need ESM loader hooks that clash with
Node's type stripping, and we already have single chokepoints):

`@opentelemetry/api`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/sdk-trace-base`,
`@opentelemetry/sdk-metrics`, `@opentelemetry/exporter-trace-otlp-proto`,
`@opentelemetry/exporter-metrics-otlp-proto`, `@opentelemetry/resources`,
`@opentelemetry/core`.

`server/src/lib/telemetry.ts` initialises tracing and metrics before any
service code (first import in `main.ts`), sets the W3C propagator, and flushes
on shutdown from `runtime.ts`. Resource: `service.name` (= service), 
`service.version` (= image tag), `deployment.environment`, `service.instance.id`.

| Chokepoint | File | Telemetry |
|---|---|---|
| HTTP server | `lib/http.ts` `serve()` | SERVER span `METHOD /route/template`, extracts `traceparent`; `http.server.request.duration` |
| Internal HTTP client | `lib/internal.ts` `call()` | CLIENT span, injects `traceparent`; `http.client.request.duration` |
| Kafka consumer | `lib/kafka.ts` `runConsumer()` | CONSUMER span `process <topic> <EventType>`, parent = extracted headers; retries and DLQ as span events; `messaging.process.duration` |
| Outbox enqueue | `lib/outbox.ts` `enqueue()` | Stores the active context in the row's `headers` |
| Outbox relay | `lib/outbox.ts` `drain()` | PRODUCER span `publish <topic> <EventType>` per message, parent = stored context; injects its own context into Kafka headers |
| Database | `lib/db.ts` `tx()`, `one()`, `many()` | CLIENT span `db.operation` + table, statement summary only (no parameters) |
| Redis | `lib/redis.ts` | No spans or metrics (high volume, low value); the Redis exporter in Alloy covers the server |
| Timers | the services' timer bodies | INTERNAL root span only around runs that change state (`scheduler.schedule_race`, `scheduler.lock_races`, `market.tick_transition`, `wallet.reconcile`); idle runs are not traced |

Every response carries an `x-trace-id` header with its trace id.

### 3.2 Rust services

Crates: `opentelemetry`, `opentelemetry_sdk` (tokio runtime),
`opentelemetry-otlp` (HTTP/protobuf over hyper, no extra TLS stack),
`tracing`, `tracing-subscriber` (`env-filter`), `tracing-opentelemetry`. The
JSON log layer is hand-written (`ars-infra/src/telemetry/json.rs`) to emit
exactly the field names and order of the TypeScript logs.

- `ars-infra` replaces its `log` module with a `telemetry::init(service)`
  that installs a `tracing` subscriber: JSON to stdout (§5 schema) plus the
  OpenTelemetry layer. Existing `log::info(...)` calls become `tracing` events.
- axum gets a span layer for `/internal/*` (extracts `traceparent`).
- `ars-infra::kafka` injects/extracts `traceparent` on rdkafka `OwnedHeaders`,
  so the broadcaster, race-engine and odds engine join the same traces as the
  TypeScript producers and consumers.
- Spans are created only around commands, reveals and pricing requests, never
  per tick (§4.3).

### 3.3 Edge

Caddy's `tracing` directive creates the root SERVER span (`edge`) for every
`/v1/*` request and forwards `traceparent` to `api` (SSE streams are not
traced: they live for minutes). It exports over OTLP/HTTP like the services.
Its `metrics` option exposes request counts and latency on the internal
`:2020/metrics` listener for Alloy to scrape. The browser sends no telemetry
in v1.

## 4. Traces

### 4.1 Propagation

| Hop | Carrier |
|---|---|
| Browser → Caddy → api/sse | Caddy starts the trace; `traceparent` header upstream |
| Service → service HTTP (wallet, race-engine, odds-engine) | `traceparent` / `tracestate` headers |
| Producer → Kafka → consumer | Kafka record headers `traceparent` / `tracestate` (OpenTelemetry messaging conventions) |
| Transaction → outbox → relay | New column `<schema>.outbox.headers JSONB` captured at `enqueue()` |
| Dead letter → replay | New column `admin.dlq.headers JSONB`; the replay publish links to the original trace |

The protobuf envelope is unchanged; trace context travels in headers, and
`eventId` is recorded as `messaging.message.id`.

### 4.2 Flows

Each flow is its own trace. Flows are tied together with ids recorded as span
attributes (`ars.race_id`, `ars.bet_id`, `ars.market_id`, `ars.user_id`), which
are searchable in Jaeger.

| Flow | Root | Spans across |
|---|---|---|
| Bet placement | `POST /v1/markets/:marketId/bets` | api → outbox → `bet.commands` → bet-worker → `POST /internal/debit` (wallet) → `bet.events` → season, notification, sse |
| Combo / cash-out | `POST /v1/bets/combos`, `POST /v1/bets/:betId/cashout` | as above, with the live acceptance wait as a span event |
| Race scheduling | `scheduler.fill_horizon` timer / `ScheduleRace` command | scheduler → `/internal/plan` (race-engine) → `GenerateScript` → race-engine seal → `ScriptSealed` → scheduler → `RaceScheduled` → market-manager → `/internal/price` (odds-engine) |
| Race start | broadcaster start span | `RaceStarted` → market-manager (resume, open lap markets) |
| Race settlement | broadcaster reveal span | `RaceFinished` → market-manager (results) → `MarketResulted` → settlement → `LegSettled` → combo-aggregator → `BetSettled` → wallet, season, notification |
| Cancellation | `POST /v1/admin/races/:raceId/cancel` | api → `CancelRace` → scheduler → `RaceCancelled` → market-manager → `MarketVoided` → settlement → wallet refunds |
| Daily reward, login, admin | their HTTP request | api → wallet / identity |

### 4.3 What is not traced

Race ticks (2 Hz per live race, several consumers), `PriceUpdated` (1 Hz per
market), SSE fan-out writes and health checks would dwarf everything else.
They are covered by metrics. The exception: a tick that **changes market
state** (suspend, resume, close) starts a short root span in market-manager,
so `MarketSuspended`/`MarketClosed` consumers still have context.

### 4.4 Sampling

- Services: `parentbased_always_on` (every flow is recorded at the source).
- Alloy tail sampling (`otelcol.processor.tail_sampling`, 10 s decision wait)
  keeps 100% of traces that have an error, a span over 2 s, or belong to
  settlement, cash-out, cancellation, admin or reconciliation flows
  (`ars.flow` span attribute), and 25% of the rest. The percentage is
  `TRACE_SAMPLE_PERCENT` (100 in development and CI).

### 4.5 Attribute policy

Allowed: the pseudonymous ids above, route templates, market type, race class,
species, venue, outcomes and reasons, error codes.
Forbidden: display names, emails, IP addresses, request or response bodies,
`Authorization`, cookies, OAuth `code`/`state`, refresh tokens, idempotency
keys, and anything under the sealed-information rule (§1.4).

## 5. Logs

One JSON object per line on stdout, the same field names in both languages:

```jsonc
{ "t": "2026-10-30T15:00:03.395Z", "level": "info", "service": "bet-worker",
  "msg": "bet accepted", "trace_id": "4bf9…", "span_id": "00f0…",
  "betId": "1096…", "lockedPrice": 1.58 }
```

- TypeScript `lib/log.ts` reads the active span; Rust gets the same shape
  from the `tracing-subscriber` JSON layer (field names mapped).
- Shipping: Docker json-file (10 MB × 3 rotation, already in production
  compose) → Alloy `discovery.docker` + `loki.source.docker` → VictoriaLogs
  Loki push API, which parses the JSON line into fields itself (`msg`
  becomes the message). Stream fields: `job` (the compose service, the same
  label metrics use) and `container`. Query a service with
  `{job="bet-worker"}`.
- Retention 14 days. `/healthz` is not logged; Alloy drops Kafka broker
  lines below WARN.
- Grafana derived field: `trace_id` → Jaeger. Jaeger datasource
  "trace to logs" → VictoriaLogs `trace_id:<id>`.

## 6. Metrics

### 6.1 Conventions

- OpenTelemetry instruments, exported over OTLP to Alloy (every 15 s,
  cumulative temporality), translated to Prometheus names
  (`ars.bet.acceptance.duration` in seconds → `ars_bet_acceptance_duration_seconds_bucket`)
  and remote-written to VictoriaMetrics. `service.name` becomes the `job`
  label and dots in attribute names become underscores (`http.route` →
  `http_route`).
- Labels are bounded enums only: `job`, `http_route`, `http_request_method`,
  `http_response_status_code`, `topic`, `consumer_group`, `event_type`,
  `market_type`, `race_class`, `species`, `phase` (`pre`/`live`), `outcome`,
  `reason`. **Never** user, bet, race or market ids.
- Budget: under 20 000 active series in total.
- Domain gauges that need SQL are **observable gauges owned by the service
  that owns the data** (scheduler for races, bet-worker for pending bets,
  wallet for the ledger, …), evaluated every 30 s with that service's own
  database role. No cross-schema reporting service.

### 6.2 Catalog

| Area | Instrument | Type, unit | Labels | Owner |
|---|---|---|---|---|
| HTTP | `http.server.request.duration` | histogram, s | service, route, method, status_class | api, sse, wallet, engine services |
| HTTP | `http.client.request.duration` | histogram, s | service, peer, route, status_class | callers of internal HTTP |
| Messaging | `messaging.process.duration` | histogram, s | consumer_group, topic, event_type, outcome | every consumer |
| Messaging | `ars.consumer.retries`, `ars.consumer.dead_lettered` | counter | consumer_group, event_type | every consumer |
| Messaging | `ars.outbox.pending`, `ars.outbox.oldest_age` | gauge, 1 / s | schema | relays |
| Messaging | `ars.dlq.open` | gauge | consumer_group | api |
| Racing | `ars.broadcaster.tick_drift` | histogram, s (publish time − `startAt + tick × tickMs`) | race_class | race-broadcaster |
| Racing | `ars.broadcaster.start_delay` | histogram, s | race_class | race-broadcaster |
| Racing | `ars.races` | gauge | status, race_class, species | scheduler |
| Racing | `ars.races.overdue` | gauge (OPEN/LOCKED 30 s past `startAt`; LIVE past estimate + 5 min) | kind | scheduler |
| Racing | `ars.scheduler.horizon`, `ars.scheduler.horizon_target` | gauge, s (last scheduled start − now; the horizon it aims for) | — | scheduler |
| Racing | `ars.scheduler.skipped` | counter | reason | scheduler |
| Engine | `ars.engine.seal.duration`, `ars.engine.plan.duration` | histogram, s | race_class | race-engine |
| Engine | `ars.engine.scripts` | counter | outcome | race-engine |
| Odds | `ars.odds.mc.duration` | histogram, s | phase, race_class | odds-engine |
| Odds | `ars.odds.reprice.interval` | histogram, s | race_class | odds-engine |
| Odds | `ars.odds.stale_ticks` | counter | — | odds-engine |
| Markets | `ars.market.transitions` | counter | market_type, from, to, reason | market-manager |
| Betting | `ars.bets.placed` | counter | bet_type, phase, market_type | api |
| Betting | `ars.bets.decided` | counter | bet_type, phase, outcome, reason | bet-worker |
| Betting | `ars.bet.acceptance.duration` | histogram, s (requested → decided) | bet_type, phase | bet-worker |
| Betting | `ars.bets.pending_oldest_age` | gauge, s | — | bet-worker |
| Betting | `ars.bet.settlement.lag` | histogram, s (race `finished_at` → bet settled) | bet_type, outcome | settlement, combo-aggregator |
| Betting | `ars.legs.unsettled_on_finished_races` | gauge | — | settlement |
| Betting | `ars.cashouts` | counter | phase, outcome, reason | bet-worker |
| Economy | `ars.points.staked` | counter, points | bet_type, phase | bet-worker |
| Economy | `ars.points.returned` | counter, points | bet_type, kind (payout, refund, cashout) | settlement, combo-aggregator, bet-worker |
| Wallet | `ars.ledger.entries` | counter | type | wallet |
| Wallet | `ars.ledger.mismatched_wallets` | gauge (balance ≠ Σ ledger, or open stake ≠ Σ open stakes) | — | wallet |
| Wallet | `ars.ledger.open_stake_drift`, `ars.ledger.balance_drift` | gauge, points (Σ absolute differences) | — | wallet |
| Wallet | `ars.ledger.reconciled_age` | gauge, s (since the last reconciliation) | — | wallet |
| Season | `ars.season.active` | gauge (0/1) | — | season |
| Season | `ars.leaderboard.update.duration` | histogram, s | board | season |
| Realtime | `ars.sse.connections` | gauge | auth | sse |
| Realtime | `ars.sse.events` | counter | event | sse |
| Notifications | `ars.notifications.created` | counter | type | notification |
| Stable | `ars.stable.pool`, `ars.stable.pool_target` | gauge | species, life_stage / species | stable |
| Stable | `ars.stable.changes` | counter | species, kind (recruited, retired_age, retired_decline, retired_admin) | stable |
| Auth | `ars.auth.logins` | counter | provider, outcome | api |
| Auth | `ars.auth.refresh` | counter | outcome (rotated, grace, reuse_detected, expired) | api |

The two ledger gauges come from a **reconciliation job** in the wallet
service (every 5 minutes): it compares cached balances with the ledger and
open stakes with accepted, unsettled bets. "Ledger, not balance" becomes a
continuously checked invariant.

### 6.3 Platform metrics (Alloy)

| Source | Alloy component | Key series |
|---|---|---|
| Postgres | `prometheus.exporter.postgres` | connections by state, transactions, deadlocks, cache hit ratio, database size |
| Redis | `prometheus.exporter.redis` | memory, ops/s, evictions, keyspace hits |
| Kafka | `prometheus.exporter.kafka` | consumer group lag (`kafka_consumergroup_uncommitted_offsets_sum` per group and topic), partition offsets |
| Containers | `prometheus.exporter.cadvisor` | CPU, memory vs limit, restarts, OOM kills (needs the Docker and containerd sockets) |
| Host | `prometheus.exporter.unix` | CPU, memory, disk, network |
| Health | `prometheus.exporter.blackbox` | `/healthz` of every service and `https://DOMAIN/` |
| Edge | `prometheus.scrape` of Caddy | requests, status codes, latency |
| Telemetry stack | `prometheus.scrape` of Alloy, VictoriaMetrics, VictoriaLogs, Jaeger | ingestion rates, dropped data |

## 7. SLOs

Windows are 30 days. Sources are the metrics in §6.

| SLO | SLI | Target |
|---|---|---|
| Fair clock | Ticks published within 250 ms of their scheduled time | 99.9% |
| Punctual starts | Races starting within 2 s of `startAt` | 99% |
| Bet decisions | Pre-race bets decided within 2 s; in-running within 2.5 s (2-tick delay + 1.5 s) | 99% |
| Settlement | Bets settled within 60 s of the race finishing | 99% |
| API availability | Non-5xx responses (4xx count as success) | 99.5% |
| API latency | Read requests under 300 ms, writes under 800 ms | 95% |
| Live prices | Reprice interval under 1.5 s during live races | 95% |
| Event pipeline | Outbox age under 10 s and critical consumer lag under 1 000 | 99% of minutes |

Error-budget alerts use multi-window burn rates: fast (14.4× over 1 h and
5 min) is critical, slow (6× over 6 h and 30 min) is a warning.

## 8. Alerts

Grafana-managed rules, provisioned from `deploy/observability/grafana/provisioning/alerting/`.
One Discord contact point (`DISCORD_WEBHOOK_URL`). Notification policy:
critical alerts are sent immediately and repeat every hour; warnings are
grouped for 5 minutes and repeat every 6 hours; resolutions are sent. Every
alert links to its dashboard and runbook section.

| Alert | Condition | For | Severity |
|---|---|---|---|
| TickDriftHigh | p99 `tick_drift` > 250 ms | 5 m | critical |
| RaceOverdue | `ars_races_overdue` > 0 | 1 m | critical |
| BetsStuckPending | `pending_oldest_age` > 30 s | 2 m | critical |
| SettlementBacklog | `legs_unsettled_on_finished_races` > 0 | 2 m | critical |
| LedgerMismatch | `mismatched_wallets` > 0 or `open_stake_drift` ≠ 0 | 0 m | critical |
| DeadLetter | `ars_dlq_open` > 0 (until replayed) | 0 m | critical |
| OutboxStalled | `outbox_oldest_age` > 30 s | 2 m | critical |
| ServiceDown | blackbox probe failing | 1 m | critical |
| NoActiveSeason | `ars_season_active` = 0 | 5 m | critical |
| SLOFastBurn | any SLO in §7 at 14.4× burn | — | critical |
| SLOSlowBurn | any SLO in §7 at 6× burn | — | warning |
| ConsumerLagHigh | lag > 1 000 for bet-worker, settlement, wallet, market-manager | 5 m | warning |
| SchedulerHorizonLow | horizon < 50% of `ars_scheduler_horizon_target` | 10 m | warning |
| OddsRepriceSlow | p95 `reprice_interval` > 1.5 s | 10 m | warning |
| ScriptFailures | increase in `ars_engine_scripts{outcome="failed"}` | 0 m | warning |
| StablePoolLow | pool < 80% of target for a species | 30 m | warning |
| RefreshTokenReuse | increase in `ars_auth_refresh{outcome="reuse_detected"}` | 0 m | warning |
| ContainerRestarts | restarts or OOM kills | 0 m | warning |
| HostPressure | disk > 85% or memory > 90% | 10 m | warning |

## 9. Dashboards

Provisioned as JSON from `deploy/observability/grafana/dashboards/`:

1. **Overview**: SLO compliance and error budget, alerts firing, golden
   signals per service, live races.
2. **Race day**: live and upcoming races by status, tick drift heatmap, start
   delays, Monte Carlo duration and reprice cadence per class, market
   transitions by reason.
3. **Betting and wallet**: bet funnel (placed → decided → settled), rejection
   reasons, acceptance and settlement latency (pre vs live), cash-outs, points
   staked vs returned (realised margin), ledger entry mix, reconciliation.
4. **Event pipeline**: consumer lag, processing duration by event type,
   retries, DLQ, outbox backlog and age per schema.
5. **Platform**: host, containers (memory vs limit, restarts), Postgres,
   Redis, Kafka, Caddy.

Explore covers ad-hoc logs ↔ traces. A saved query, "trace of a bet",
searches Jaeger by `ars.bet_id`.

## 10. Access and security

- Caddy routes `/grafana/*` to Grafana (`GF_SERVER_ROOT_URL=https://DOMAIN/grafana/`,
  served from sub-path). Grafana's own login: admin password generated by
  `setup-vps.sh` into `.env` (`GRAFANA_ADMIN_PASSWORD`); sign-up, anonymous
  access and Gravatar are disabled.
- Jaeger, VictoriaMetrics, VictoriaLogs and Alloy UIs and the OTLP ports stay
  on the internal Docker network.
- Alloy mounts the Docker and containerd sockets read-only for container
  discovery, logs and cAdvisor, and the host's `/proc`, `/sys` and `/`
  read-only for host metrics. On this single-tenant VPS that is acceptable;
  Alloy has no published port.
- Telemetry follows §4.5 and the sealed-information rule; a CI check greps
  service logs from the e2e run for seeds and pre-finish result fields.

## 11. Resources and retention

| | Typical RAM | Limit | Retention | Disk |
|---|---|---|---|---|
| App stack (today) | ≈ 1.1 GB idle | 3.2 GB | — | — |
| Observability | ≈ 0.5–0.65 GB | 1.2 GB | metrics 30 d, logs 14 d, traces 7 d | ≈ 6 GB |
| **Total** | **≈ 1.7 GB** | 4.4 GB | | |

Typical use fits a 4 GB VPS, but the limits now overcommit physical memory.
`setup-vps.sh` adds a 2 GB swap file so a burst of Monte Carlo pricing can't
OOM-kill Kafka. Move to an 8 GB VPS if `HostPressure` fires regularly.

## 12. Environments

| | Development | CI (e2e job) | Production |
|---|---|---|---|
| Stack | always on (`docker compose up`) | same | always on |
| Grafana | http://localhost:8080/grafana (`admin` / `admin`) | API, checked by Playwright | https://DOMAIN/grafana |
| Store UIs | Jaeger, VictoriaMetrics and VictoriaLogs on 127.0.0.1 only | same | not published |
| Sampling | keep 100% | keep 100% | §4.4 |
| Alerts | evaluated, posted to the fake Discord webhook on the mock server | same | Discord |
| Retention | 2 d everywhere | ephemeral | §11 |

Without `OTEL_EXPORTER_OTLP_ENDPOINT` (unit tests, ad-hoc runs) the SDKs
record nothing and export nothing; `OTEL_SDK_DISABLED=true` does the same
explicitly. Trace context still propagates, so logs keep their trace ids.

## 13. Contract changes

- Migration `004`: `headers JSONB NOT NULL DEFAULT '{}'` on every
  `<schema>.outbox`, and `headers JSONB` on `admin.dlq`.
- Kafka record headers `traceparent` / `tracestate` on every message
  (TypeScript and Rust producers).
- Env vars:
  - `OTEL_EXPORTER_OTLP_ENDPOINT` (`http://alloy:4318`), `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_SDK_DISABLED`
  - `GRAFANA_ADMIN_PASSWORD`, `DISCORD_WEBHOOK_URL`
  - `TELEMETRY_RETENTION_*` (per store)
- The engine's ad-hoc `log` module is replaced by `tracing`. Its log lines
  must keep following the sealed-information rule (the finish tick and
  script size were removed from them in this pass).

## 14. Verification

| Check | How |
|---|---|
The checks below run in CI. The Playwright project `observability`
(`e2e/tests/observability.spec.ts`) runs after all UI tests, so a full race
day has already happened.

| Check | How |
|---|---|
| Propagation | Unit tests: inject/extract round-trip over HTTP headers and Kafka headers, root spans, log correlation (TS, `server/test/telemetry.test.ts`); rdkafka header round-trip and log format (Rust, `ars-infra`) |
| End-to-end trace | Place a bet through Caddy, take `x-trace-id`, and require one Jaeger trace with spans from `caddy`, `api`, `bet-worker` and `wallet`, where the bet-worker consumer span's parent is the outbox relay's `publish bet.commands` span; no forbidden attribute keys |
| Metrics present | VictoriaMetrics has tick drift, start delay, acceptance, settlement lag, engine, odds, HTTP, messaging, Kafka lag, Postgres, Redis, Caddy, container and host series; every health probe is up; the ledger reconciliation reports no mismatch or drift; a season is active |
| Logs correlated | VictoriaLogs returns `api` and `bet-worker` lines for the bet's trace id, and every service has logs |
| Provisioning valid | Grafana datasources healthy (VictoriaLogs when its plugin is installed, always in CI), the five dashboards and 33 alert rules loaded with no evaluation errors |
| Alert delivery | Grafana's receiver test posts to the fake Discord webhook and the message arrives |
| Sealed-information rule | No engine log line carries seed, finish tick, finish order or script size fields, and no race-engine span attribute key mentions seed, finish, order, leader or position |

## 15. Rollout

| Phase | Delivers | Done when |
|---|---|---|
| 1. Pipeline and logs | Alloy, VictoriaLogs, Grafana, unified JSON logs with trace ids, Caddy at `/grafana` | Logs of every container searchable in Grafana |
| 2. Traces | OTel SDKs, propagation over HTTP/Kafka/outbox/DLQ, Jaeger, tail sampling | e2e trace check passes |
| 3. Metrics | Catalog §6, VictoriaMetrics, Alloy exporters, reconciliation job, dashboards | Dashboards populated by an e2e race day |
| 4. SLOs and alerts | Rules §7–8, Discord contact point, runbook entries in `deployment.md` | A forced failure (stop the broadcaster) posts `RaceOverdue` to Discord |

All four phases shipped together.
