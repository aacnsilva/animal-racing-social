# Animal Racing Social

A portfolio project: a fictional animal-racing betting app combined with an Instagram-style social network.

> **No real money.** All bets use fictional points with no cash value. Nothing can be bought, cashed out or transferred.

## Vision

Fans follow fictional animal races (snails, turtles, ostriches, corgis...), place point-based predictions, and share the moment: photos, posts and short videos of their favourite racers, race highlights and leaderboards.

The project exists to showcase backend architecture at scale, with two halves that each stress a different set of distributed-systems problems.

## Racing side: event-driven architecture (implemented)

- **Kafka** as the backbone: race lifecycle, ticks, markets, bet commands/events, wallet, stable, season and notification events flow through topics as Protobuf envelopes.
- **Provably fair races**: every race is simulated and sealed (AES-GCM) before betting opens; seed and script hashes are published up front and the seed and full script are revealed at the finish, so anyone can re-run the engine and verify.
- **Ledger, not balance**: wallets are an append-only ledger with idempotent `(type, refId)` entries; balances are a cached sum.
- **Independent consumers** for odds, market management, bet acceptance, settlement, combo aggregation, wallet, leaderboards and notifications, each owning its own Postgres schema and DB role.
- **Exactly-once-ish settlement** with per-schema transactional outboxes, idempotent consumers and a dead-letter queue with replay.
- **Live updates** pushed to browsers over Server-Sent Events (one stream per race), rendered in 3D with three.js.

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

| Path | What |
|---|---|
| [`docs/api`](docs/api) | Design: betting & racing, race engine, platform APIs, Kafka events, OpenAPI |
| [`docs/db`](docs/db) | Data model and the original DDL |
| [`docs/implementation.md`](docs/implementation.md) | Contracts between services, engine and web (what the code implements) |
| [`docs/deployment.md`](docs/deployment.md) | CI/CD and VPS operations |
| `proto/` | Protobuf event schemas (single source of truth for Rust and TypeScript) |
| `engine/` | Rust: `race-engine-core`, `race-engine`, `race-broadcaster`, `odds-engine` |
| `server/` | TypeScript services on Node 22 (`api`, `sse`, `scheduler`, `stable`, `market-manager`, `bet-worker`, `settlement`, `combo-aggregator`, `wallet`, `season`, `notification`, `migrate`) |
| `web/` | React + three.js client (Vite), served by Caddy |
| `mock-oauth/` | Fake Google/GitHub OAuth provider (PKCE) for local runs and tests |
| `e2e/` | Playwright UI tests |
| `db/` | SQL migrations and per-service role grants |
| `shared/` | Venues, species, market templates, programme, engine params |
| `deploy/` | Production compose, VPS setup, deploy and backup scripts |

Stack: Kafka 3.9 (KRaft), PostgreSQL 16, Redis 7, Rust, Node 22 (TypeScript run directly, no build step), React, three.js, Caddy. Runtime npm dependencies of the services: `pg`, `kafkajs`, `@redis/client`, `@bufbuild/protobuf`.

## Run it locally

Requirements: Docker with Compose v2.

```bash
docker compose up -d --build --wait
```

Open http://localhost:8080 and sign in with Google or GitHub. Locally both point at the mock provider on http://localhost:9000, where you can type any account id. The account id `admin1` is an admin: the Admin page can schedule a one-off race a minute or two ahead, so you don't have to wait for the programme (3 races per hour).

```bash
docker compose down -v
```

That stops everything and wipes the data.

## Tests

| Suite | Command |
|---|---|
| TypeScript unit tests | `cd server && npm ci && npm test` |
| Mock OAuth tests | `cd mock-oauth && npm test` |
| Engine tests | `cd engine && cargo test --workspace` |
| Playwright UI tests (stack running on :8080) | `cd e2e && npm ci && npx playwright install chromium && npx playwright test` |

After changing `proto/`, regenerate the TypeScript types with `cd server && npm run gen` (needs `protoc`); CI fails if they are stale.

## Deploy

Push to `main`: GitHub Actions runs every suite, builds the images, runs the Playwright tests against the full stack, pushes the tested images to GHCR and deploys them to the VPS over SSH. One-time VPS setup and day-2 operations are in [`docs/deployment.md`](docs/deployment.md).

## Disclaimer

This is a learning and portfolio project. It does not offer gambling, real-money wagering or prizes of any kind.

## License

MIT
