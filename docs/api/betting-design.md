# Betting & Racing Design (v1)

Design for the racing engine and betting API. Spec origin: issue #1.
Machine-readable contracts live next to this file:

- [`openapi.yaml`](./openapi.yaml): REST API
- [`events.md`](./events.md): Kafka topics and event schemas

> All amounts are **fictional points**. "Cash-out" means settling a bet early
> for points; nothing has real-money value.

## 1. Principles

1. **The script is secret, the clock is public.** A race is fully simulated
   before it starts and the script is sealed. Only the Race Broadcaster reads
   it, releasing one tick at a time on wall-clock time. Nothing else (clients,
   odds engine, cash-out) ever sees future ticks.
2. **Provably fair.** `seedHash` and `scriptHash` are published when the race is
   scheduled. Seed and full script are revealed at `FINISHED`, so anyone can
   re-run the engine and verify.
3. **Everything is a market.** Win, positions, podium, tricast and live lap bets
   all share one `Market → Selection → Bet` model.
4. **Odds from revealed state only.** The Odds Engine runs its own Monte Carlo
   from current positions, stamina and public stats, never from the script.
5. **Ledger, not balance.** Wallet balance = sum of immutable ledger entries.
   Every entry is keyed by a unique business id (`betId`, …), so replayed
   events are harmless.
6. **Live actions are delayed.** In-running bets and cash-outs are accepted
   asynchronously after a short delay (`acceptDelayTicks`, default 2) and
   re-checked against the price at that moment.

## 2. Services

```
Scheduler ──► Race Engine ──(sealed script)──► Script Store
                                                   │
                                Race Broadcaster ◄─┘   (one loop per live race)
                                       │ race.ticks
            ┌──────────────┬───────────┼──────────────┬─────────────┐
       Odds Engine    Market Manager   Settlement     SSE Gateway   Stable (aging)
            │ market.events   │            │ bet.events     │
            └───────► Bet Service ◄────────┘          Browser (three.js)
                          │
                       Wallet (ledger)
```

| Service | Responsibility |
|---|---|
| Scheduler | Owns the daily race programme; picks entrants; triggers script generation before each race. |
| Race Engine | Chooses track/laps for a target duration, simulates, seals the script. Stateless. |
| Race Broadcaster | Publishes `RaceTick` at `startAt + tick × tickMs`. Many races run concurrently, one partition key per race. |
| Odds Engine | On each tick: Monte Carlo rest-of-race from revealed state → prices for every open market. |
| Market Manager | Opens/suspends/closes markets on race progress (e.g. opens `LEADER_AT_LAP`, suspends before checkpoints). |
| Bet Service | Validates bets and cash-outs, applies acceptance delay, reserves stake. |
| Settlement | Results markets on `LapCompleted` / `RaceFinished`; emits `BetSettled`. |
| Wallet | Consumes bet events, writes ledger entries. |
| Stable | Animal lifecycle: aging, form history, retirement, new recruits. |
| SSE Gateway | Fans `race.ticks` + `market.events` + user's `bet.events` to browsers. |

## 3. Race lifecycle

```
SCHEDULED ─► OPEN ─► LIVE ─► FINISHED ─► SETTLED
 (entrants,   (pre-race   (ticks broadcasting,   (seed+script   (all markets
  seedHash,    markets)    in-running markets,    revealed)      resulted)
  scriptHash)              cash-out)
```

A script is generated **just before** the race moves to `OPEN`; the daily
programme is controlled by us, so there is no queue of pre-built secret races.
Multiple races may be `LIVE` simultaneously.

### Duration

- Fixed tick rate: **`tickMs = 500`**.
- Target duration **120–600 s** → 240–1200 ticks.
- The engine chooses `laps` and `trackLength` per race class; exact finish tick
  is only known after simulation and is **never published** before the race
  ends (it would leak the winner's pace). Public metadata shows `laps` and
  `estimatedDurationSec`.

| Class | Laps | Approx. duration |
|---|---|---|
| SPRINT | 3–4 | 2–3 min |
| STANDARD | 6–8 | ~5 min |
| ENDURANCE | 12–15 | up to 10 min |

### Race script (private until FINISHED)

```jsonc
{
  "raceId": "r_…", "seed": "…", "tickMs": 500,
  "track": { "length": 400, "laps": 7, "shape": "oval" },
  "ticks": [
    { "tick": 0, "lap": 1,
      "entrants": [{ "id": "e1", "dist": 0.0, "lane": 2, "speed": 0,
                     "staminaPct": 100, "state": "RUNNING" }],
      "events": [] }
  ]
}
```

`state`: `RUNNING | SPRINTING | TIRED | STUMBLED | FINISHED`.
`events`: `OVERTAKE{a,b}`, `STUMBLE{id}`, `SPRINT{id}`, `LAP{id,lap}`, `FINISH{id,pos}`.

The browser buffers ~1 tick and interpolates `dist`/`lane` for 60 fps three.js
rendering; `state` selects animation clips and `events` drive camera cuts and
sound. Late joiners fetch revealed ticks via `GET /races/{id}/ticks`.

## 4. Animals, aging and history

All stats are public.

```
Animal { id, name, species, bornAt, ageRaces, status: ACTIVE|RETIRED,
         base: { velocity, stamina, acceleration, consistency },
         current: { … }   // base × ageFactor
}
```

- **Age is calendar-driven: 1 real day = 1 animal week** (≈ 52 days = 1 animal
  year). The Stable runs a daily job that advances every active animal and
  emits `AnimalAged`. Racing does not age an animal (but may add fatigue later).
- **ageFactor** follows a per-species curve: rises to a peak (prime), then
  declines. Species have different curves (ants peak fast and fade fast;
  tortoises the opposite). Example: a horse is a ROOKIE for its first ~3 animal
  years (~150 days), PRIME until ~8 (~420 days), then VETERAN.
- Ages shown in the UI as animal years/weeks (`ageWeeks`), so players feel it.
- **Retirement** when `current` falls below a species threshold or max age; the
  Stable recruits a new randomized animal to keep rosters full
  (`AnimalRetired`, `AnimalRecruited` events, which also make good social content).
- **Stats are snapshotted** onto the entrant at scheduling time. A race and its
  bets are always judged on the stats shown when betting opened.
- **History**: every finished race appends a `RaceResult` row per animal
  (position, time, lap leaders, stats snapshot). Exposed as form
  (`last5: [1,3,2,6,1]`), win %, podium %, and per-class records.

The Odds Engine's pre-race prices use current stats; form is informational
(and can later feed a small "form" adjustment).

## 5. Markets

| Type | Params | Selection | Window |
|---|---|---|---|
| `FINISH_POSITION` | `position: 1\|2\|3` | entrant | OPEN → closes at configured lap (default: last lap) |
| `TOP_N` | `n: 3` | entrant | OPEN → closes at configured lap |
| `TRICAST` | — | exact `[1st,2nd,3rd]` | OPEN only (pre-race) |
| `LEADER_AT_LAP` | `lap: k` | entrant | opened by Market Manager in-running; closes `suspendTicksBefore` ticks before lap `k` completes |

`FINISH_POSITION{position:1}` is the plain win market.
`LEADER_AT_LAP` markets are generated from the lap count (every 2–3 laps, never
the final lap).

**Tricast** has N×(N−1)×(N−2) combinations, so it isn't listed; clients request a
quote: `POST /markets/{id}/quotes { order: [a,b,c] }`.

### Market states

`OPEN ⇄ SUSPENDED → CLOSED → RESULTED`. Suspended during sharp events
(stumble, overtake in the top 3) and just before checkpoints.

### Pricing

- Probability `p` from 2k–5k Monte Carlo runs of the remaining race per tick.
- `price = 1 / (p × (1 + margin))`, `margin ≈ 5%`, clamped to [1.01, 1000].
- Every price change bumps the market's `priceVersion`.

## 6. Bets

```
POST /v1/markets/{marketId}/bets   Idempotency-Key: <uuid>
{ "selection": { "entrantId": "e3" } | { "order": ["e3","e1","e5"] },
  "stake": 100,
  "acceptedPrice": 4.20, "priceVersion": 37,
  "acceptPriceChanges": "NONE" | "BETTER" | "ANY" }
→ 202 { betId, status: "PENDING" }
```

- **No stake limits.** Minimum 1 point, maximum = available balance (all-in
  allowed). The balance check and stake debit are one atomic ledger write
  (`SELECT … FOR UPDATE` on the user's wallet row or a conditional insert), so
  concurrent bets across races can't overspend.
- Pre-race (`OPEN` race): validated immediately, delay 0.
- In-running: accepted after `acceptDelayTicks`, re-priced against the then
  current version and the `acceptPriceChanges` policy.
- On accept, stake is debited (`BET_STAKE`). Price is **locked** at acceptance.

Bet states: `PENDING → ACCEPTED → (WON | LOST | VOID | CASHED_OUT)` or `PENDING → REJECTED`.

## 7. Cash-out (full only)

Value of an accepted, unsettled bet:

```
pNow      = odds engine's current probability that the bet wins
fair      = stake × lockedPrice × pNow
cashOut   = floor(fair × (1 − cashOutMargin))      // cashOutMargin ≈ 5%
```

(For single selections this is ≈ `stake × lockedPrice / currentPrice`.)

```
GET  /v1/bets/{betId}/cashout          → { amount, quoteId, priceVersion, expiresAtTick }
POST /v1/bets/{betId}/cashout          Idempotency-Key
     { quoteId, minAmount }            → 202 PENDING → CASHED_OUT | REJECTED
```

- Full cash-out only: the bet is closed entirely.
- Same acceptance delay as live bets; rejected if the value drops below
  `minAmount`, the market is suspended, or the bet has settled.
- Live cash-out values are pushed over SSE (`cashout.updated`) for the
  user's open bets.

## 8. Wallet

Ledger entry types: `SIGNUP_GRANT`, `DAILY_GRANT`, `BET_STAKE (−)`,
`BET_PAYOUT (+)`, `BET_REFUND (+, void)`, `CASHOUT (+)`.
Unique constraint `(type, refId)` makes every consumer idempotent.
Because all-in is allowed, `DAILY_GRANT` is the safety net that gets busted
players back in the game.

## 8a. Seasons & leaderboards

- A **season** is a fixed calendar window (default 4 weeks) with status
  `UPCOMING | ACTIVE | ENDED`. Every ledger entry carries `seasonId`.
- At season start each user gets a fresh season wallet (`SEASON_GRANT`);
  the previous season's balance is frozen as its final score.
- **Leaderboard** (per season) ranks by season balance; secondary boards for
  biggest single payout, best ROI (min. N bets) and longest win streak.
- Implemented as a Kafka consumer of `wallet.events` / `bet.events` that
  maintains Redis sorted sets (`lb:{seasonId}:balance`, …). Postgres is the
  source of truth; Redis can be rebuilt by replaying the topics.
- Season end emits `SeasonEnded{seasonId, top[]}`, which the social feed can
  turn into champion posts.

## 9. Concurrency & partitioning

- Many concurrent races. All race-scoped topics are keyed by `raceId`, so a
  race's ticks, prices and bet commands are totally ordered on one partition.
- `bet.events` is keyed by `userId` so a user's wallet updates are ordered.
- Bet Service and Odds Engine are partition-assigned consumers; scaling = more
  partitions + instances. On a single 4 GB VPS: 6 partitions per topic, one
  instance each.
- Broadcaster leadership per race via Kafka consumer group on
  `race.lifecycle` (one owner per partition); on failover the new owner resumes
  from the last published tick using wall-clock time.
