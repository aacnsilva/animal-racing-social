# Animal Racing Social

A portfolio project: a fictional animal-racing betting app combined with an Instagram-style social network.

> **No real money.** All bets use fictional points with no cash value. Nothing can be bought, cashed out or transferred.

## Vision

Fans follow fictional animal races (horses and giraffes on land, sharks and octopuses in the water...), place point-based predictions, and share the moment: photos, posts and short videos of their favourite racers, race highlights and leaderboards.

The project exists to showcase backend architecture at scale, with two halves that each stress a different set of distributed-systems problems.

## Racing side: event-driven architecture (implemented)

- **Kafka** as the backbone: race lifecycle, ticks, markets, bet commands/events, wallet, stable, season and notification events flow through topics as Protobuf envelopes.
- **Provably fair races**: every race is simulated and sealed (AES-GCM) before betting opens; seed and script hashes are published up front and the seed and full script are revealed at the finish, so anyone can re-run the engine and verify.
- **Ledger, not balance**: wallets are an append-only ledger with idempotent `(type, refId)` entries; balances are a cached sum.
- **Independent consumers** for odds, market management, bet acceptance, settlement, combo aggregation, wallet, leaderboards and notifications, each owning its own Postgres schema and DB role.
- **Exactly-once-ish settlement** with per-schema transactional outboxes, idempotent consumers and a dead-letter queue with replay.
- **Live updates** pushed to browsers over Server-Sent Events (one stream per race), rendered in 3D with three.js.

## Animal Grand Prix: race it yourself (implemented)

`/play` is an arcade racer built on the same three.js animal rigs: pick a horse, giraffe, shark or octopus and drive it around four circuits (turf, desert sand, ice and the sea floor) against up to nine rivals.

- **Solo** needs no sign-in: bots follow a deterministic plan derived from the race seed.
- **Multiplayer** needs a sign-in: create a room, share the 5-letter code or the `/play/room/CODE` link, up to 10 racers, bots fill the empty grid slots.
- **Netcode**: the `arcade` service keeps rooms in memory and speaks JSON over one WebSocket (`/v1/arcade/ws`). Each client simulates its own animal and sends ~12 samples per second; the server relays them, owns the lobby, the start clock and the finish order, and clamps reported finish times to its own clock. Bots are computed identically on every client from the shared seed and the synced clock, so they cost no bandwidth.
- **Fair starts**: when the host starts a race every client loads the venue first and reports ready; the countdown begins once all racers are ready, or after 25 seconds for anyone still loading.
- **Auth**: the API issues a 60-second ticket (`POST /v1/arcade/ticket`) that the socket presents in its first message, so the `arcade` service needs no database.
- **Rendering**: the game runs on the same stack as the race viewer: the procedural land and sea venues, baked sky with image-based lighting, skinned animal rigs and the HDR bloom pipeline with quality tiers that step down on slow devices.
- **Mobile first**: touch steering, auto-run, portrait and landscape layouts.

## Social side: sharding and redundancy (planned)

- **Sharded storage** for users, posts, follows and comments (shard key by user id), with a routing layer.
- **Replication and failover**: primary/replica per shard, read replicas for feeds, tested failover.
- **Media pipeline** for photos and short videos: object storage, async transcoding, CDN-style caching.
- **Feeds** built with fan-out on write for most users and fan-out on read for high-follower accounts.
- **Redundancy drills**: kill a node, lose a shard replica, partition the network, and show the system keeps serving.

User ids are already shard-aware, so betting data written today needs no migration when the social layer lands.

## Architecture

```
Scheduler ─GenerateScript─► race-engine (Rust) ──sealed script──► Postgres `sealed`
    │                                                                 │
    │ RaceScheduled/Opened/Locked                race-broadcaster (Rust) ◄┘ ticks on wall-clock time
    ▼                                                   │ race.ticks, RaceStarted/Finished
Market Manager ◄── odds-engine (Rust, Monte Carlo from revealed state only) ──► PriceUpdated, Redis prices
    │ market.events
    ▼
API ─bet.commands─► Bet worker ─debit─► Wallet ─wallet.events─► Season (leaderboards)
                         │ bet.events          ▲
                    Settlement ─► Combo aggregator ─┘           Notification ─► SSE gateway ─► browser
```

| Path                                               | What                                                                                                                                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/api`](docs/api)                             | Design: betting & racing, race engine, platform APIs, Kafka events, OpenAPI                                                                                                                     |
| [`docs/db`](docs/db)                               | Data model and the original DDL                                                                                                                                                                 |
| [`docs/implementation.md`](docs/implementation.md) | Contracts between services, engine and web (what the code implements)                                                                                                                           |
| [`docs/deployment.md`](docs/deployment.md)         | CI/CD and VPS operations                                                                                                                                                                        |
| [`docs/observability.md`](docs/observability.md)   | Observability design: traces, logs, metrics, SLOs, alerts                                                                                                                                       |
| `proto/`                                           | Protobuf event schemas (single source of truth for Rust and TypeScript)                                                                                                                         |
| `engine/`                                          | Rust: `race-engine-core`, `race-engine`, `race-broadcaster`, `odds-engine`                                                                                                                      |
| `server/`                                          | TypeScript services on Node 22 (`api`, `sse`, `arcade`, `scheduler`, `stable`, `market-manager`, `bet-worker`, `settlement`, `combo-aggregator`, `wallet`, `season`, `notification`, `migrate`) |
| `web/`                                             | React + three.js client (Vite), served by Caddy                                                                                                                                                 |
| `mock-oauth/`                                      | Fake Google/GitHub OAuth provider (PKCE) for local runs and tests                                                                                                                               |
| `e2e/`                                             | Playwright UI tests, desktop and mobile                                                                                                                                                         |
| `db/`                                              | SQL migrations and per-service role grants                                                                                                                                                      |
| `shared/`                                          | Venues, species, market templates, programme, engine params                                                                                                                                     |
| `deploy/`                                          | Production compose, VPS setup, deploy and backup scripts                                                                                                                                        |

Stack: Kafka 3.9 (KRaft), PostgreSQL 16, Redis 7, Rust, Node 22 (TypeScript run directly, no build step), React, three.js, Caddy. Runtime npm dependencies of the services: `pg`, `kafkajs`, `@redis/client`, `@bufbuild/protobuf`, `ws` and the OpenTelemetry SDK.

Observability: OpenTelemetry traces and metrics from every service, JSON logs with trace ids, collected by Grafana Alloy into VictoriaMetrics, VictoriaLogs and Jaeger, with Grafana dashboards and alerts to Discord. See [`docs/observability.md`](docs/observability.md).

## Run it locally

Requirements: Docker with Compose v2.

```bash
docker compose up -d --build --wait
```

Open http://localhost:8080 and sign in with Google or GitHub. Locally both point at the mock provider on http://localhost:9000, where you can type any account id. The account id `admin1` is an admin: the Admin page can schedule a one-off race a minute or two ahead, so you don't have to wait for the programme (6 races per hour).

Grafana runs at http://localhost:8080/grafana (user `admin`, password `admin`) with the same dashboards, alerts and datasources as production. The stores' own UIs are on localhost only: Jaeger http://localhost:16686, VictoriaMetrics http://localhost:8428/vmui, VictoriaLogs http://localhost:9428/select/vmui. Alerts go to a fake Discord webhook on the mock server: http://localhost:9000/webhooks/discord lists what was posted.

```bash
docker compose down -v
```

That stops everything and wipes the data.

## Tests

| Suite                                                                                       | Command                                                                      |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| TypeScript unit tests                                                                       | `cd server && npm ci && npm test`                                            |
| Mock OAuth tests                                                                            | `cd mock-oauth && npm test`                                                  |
| Engine tests                                                                                | `cd engine && cargo test --workspace`                                        |
| Playwright UI (desktop and Pixel 7 mobile) and observability tests (stack running on :8080) | `cd e2e && npm ci && npx playwright install chromium && npx playwright test` |

After changing `proto/`, regenerate the TypeScript types with `cd server && npm run gen` (needs `protoc`); CI fails if they are stale.

## Deploy

Push to `main`: GitHub Actions runs every suite, builds the images, runs the Playwright tests against the full stack, pushes the tested images to GHCR and deploys them to the VPS over SSH. One-time VPS setup and day-2 operations are in [`docs/deployment.md`](docs/deployment.md).

## Disclaimer

This is a learning and portfolio project. It does not offer gambling, real-money wagering or prizes of any kind.

## License

MIT
