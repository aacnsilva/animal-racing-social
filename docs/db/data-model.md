# Data Model (betting side, v1)

DDL: [`schema.sql`](./schema.sql). API: [`../api/`](../api/).

## 1. Layout

One PostgreSQL 16 instance on the VPS, **one schema per owning service**,
each with its own DB role. A service writes only its own schema; it learns
about other services' data through Kafka events (never cross-schema joins in
write paths).

| Schema | Owner | Holds |
|---|---|---|
| `identity` | Auth (TS) | users, OAuth identities, refresh tokens |
| `stable` | Stable (TS) | species, animals, aging history, venue form |
| `racing` | Scheduler (TS) + race-engine (Rust) | venues, engine versions, races, entrants, results, replays, programme |
| `sealed` | race-engine (write), race-broadcaster (read) | encrypted scripts + seeds before FINISHED |
| `market` | Market Manager / Odds Engine | templates, markets, latest prices, price snapshots |
| `betting` | Bet Service, Settlement, Combo Aggregator | bets, legs, cash-outs |
| `wallet` | Wallet | per-season wallets, ledger, daily rewards |
| `season` | Season / Leaderboard | seasons, per-user season stats, frozen results |
| `notification` | Notification Service | inbox, settings |
| `admin` | Admin API | audit log |

Read models that combine schemas (e.g. race result page: race + entrants +
animals + market results) are served by the API from read-only roles or
denormalized copies built from events.

## 2. Entity overview

```
seasons ─< races ─< race_entrants >─ animals >─ species
             │  ├─< race_lap_leaders            └─< animal_daily_stats
             │  ├─< race_incidents                └─< animal_venue_form
             │  └── venues(id,version), engine_versions, race_replays, sealed.race_scripts
             └─< markets ─< selections
                   │
users ─< bets ─< bet_legs >── markets          (bet_legs.market_id: logical ref across schemas)
   │      └─< cashouts
   ├─< wallets(user, season) ─< ledger_entries
   ├── daily_rewards, user_season_stats, notification settings
   └─< notifications
```

## 3. Key design decisions

**User-scoped vs global.** Every table is tagged `[U]` (leading `user_id`,
moves to user shards when the social layer lands) or `[G]` (stays on the
global database). User-scoped tables have **no foreign keys to global
tables** (`bet_legs.market_id`, `race_id` are logical references), so they can
move to another shard without schema changes.

**Bets = header + legs.** A single is a bet with one leg; a combo has 2–8.
`UNIQUE (user_id, bet_id, race_id)` on legs enforces "one leg per race".
Selections are either `entrant_id` or `tricast_order` (CHECK enforces exactly one).

**Wallet = ledger + cached balance.** `ledger_entries` is the truth;
`wallets.balance` is a cached sum updated in the same transaction.
`UNIQUE (user_id, type, ref_id)` makes every consumer idempotent
(stake per `betId`, payout per `betId`, daily grant per `userId:date`).
Placing a bet is one transaction:

```sql
UPDATE wallet.wallets
   SET balance = balance - $stake, open_stake = open_stake + $stake
 WHERE user_id = $u AND season_id = $s AND balance >= $stake;   -- 0 rows → INSUFFICIENT_FUNDS
INSERT INTO wallet.ledger_entries (…, type, amount, ref_id, balance_after)
VALUES (…, 'BET_STAKE', -$stake, $betId, …);
```

All-in works naturally; concurrent bets can't overspend because the row
update is conditional.

> Bet Service and Wallet are separate services. In v1 the stake debit is
> done synchronously by Wallet (HTTP/gRPC call within the bet acceptance),
> so a bet is never accepted without funds; payouts are async via
> `bet.events`.

**Leaderboard score ignores open bets.** `rank_score = balance + open_stake`,
maintained in `season.user_season_stats` and mirrored to Redis sorted sets.
ROI and streak boards filter `settled_bets ≥ 20`.

**No ties, enforced by the DB.** `UNIQUE (race_id, official_position)` on
`race_entrants`. Every entrant row carries `result_status`
(`FINISHED | DISQUALIFIED | DNF | NON_RUNNER`); `animals.last5` stores display
tokens (`1`, `3`, `DQ`, `DNF`, `NR`).

**Seasons can't overlap** (exclusion constraint) and expose
`last_race_at = ends_at − 1 h`; the Scheduler refuses to book later races.

**Sealed scripts are isolated.** `sealed.race_scripts` lives in its own
schema; only the race-engine role can INSERT and only the broadcaster role
can SELECT. Admin and API roles have no grant. At FINISHED the plaintext is
copied into `racing.race_replays` (public) and the seed into `racing.races.seed`.
A retention job deletes replays after `REPLAY_RETENTION_HOURS`; results,
seed, hashes and incidents stay forever.

**Prices.** Three tiers:

| Tier | Where | Retention |
|---|---|---|
| Live | Redis `price:{marketId}` + `market.selections` (latest only) | until resulted |
| Replay buffer | Kafka `market.events` | **7 days** (`KAFKA_RETENTION_DAYS`), for rebuilding consumers, not for queries |
| History | `market.price_history`: one compressed series per market, written at `MarketResulted` | **`PRICE_HISTORY_RETENTION`**, config, default **one season (28 days rolling)** |
| Forever | `market.price_snapshots` (opening / at-lock / at-start) | permanent |

Odds charts on replay and history pages read `price_history`; a daily job
deletes rows past `expires_at`. Bet disputes don't depend on it: each leg
stores its locked price and `price_version`.

**Immutable config.** Venues, engine versions, market templates and the
race programme are versioned rows; editing creates a new version, and races
reference the version they used.

**Outbox + dedupe.** Each publishing service writes events to its own
`<schema>.outbox` in the same transaction as the state change; a relay
publishes to Kafka. Consumers record `processed_events (consumer, event_id)`
or rely on business-key uniques.

## 4. Settlement with user shards (future-proofing)

Bets are sharded by user, but settlement asks "all open legs on market X".
Instead of a global scan, **each shard's Settlement consumer** handles
`MarketResulted` and settles its own legs using the partial index
`bet_legs (market_id) WHERE status = 'OPEN'`. With one database today that's
a single consumer; with N shards it's N consumers in parallel, with no
cross-shard queries.

## 5. Redis

| Key | Type | Owner | TTL | Purpose |
|---|---|---|---|---|
| `price:{marketId}` | hash `{version, selections}` | Odds Engine | until market resulted | live prices for bets & combos |
| `race:{raceId}:state` | string (JSON snapshot) | Broadcaster | race end + 1 h | SSE `snapshot` on connect |
| `idem:{userId}:{key}` | string (response) | Bet Service | 2 h | fast idempotent retries |
| `cashout:quote:{quoteId}` | hash | Bet Service | until next reprice | quote validation |
| `lb:{seasonId}:{board}` | sorted set | Leaderboard | season end + 7 d | rankings |
| `rl:{userId}:{bucket}` | token bucket | API | seconds | rate limiting |
| `notif:unread:{userId}` | counter | Notification | none | badge count |

Redis is always rebuildable: prices from the latest `PriceUpdated`, boards
from `user_season_stats`, unread counts from `notifications`.

## 6. Volume estimates (per day)

| Table | Rows/day | Notes |
|---|---|---|
| races | 72 | |
| race_entrants | ~580 | |
| markets | ~72 × 8 ≈ 600 | |
| race_replays | 72 × ~100–500 KB compressed | deleted after retention |
| bets / bet_legs | depends on users; 1k DAU × 20 bets ≈ 20k / ~30k | |
| ledger_entries | ≈ 2 × bets + grants | |
| notifications | ≈ bets + race-starting alerts | 30-day retention |

Comfortably within a single 4 GB VPS for the portfolio scale.
