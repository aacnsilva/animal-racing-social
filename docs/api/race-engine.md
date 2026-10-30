# Race Engine (v1)

The race engine turns a race's inputs into a deterministic, sealed race
script. See [`betting-design.md`](./betting-design.md) for how scripts are
broadcast and priced.

## 1. Languages

| Rust (heavy / hot path) | TypeScript (everything else) |
|---|---|
| `race-engine-core` crate (physics, RNG, incidents) | API gateway, Bet Service, Wallet |
| `race-engine` service (script generation + sealing) | Scheduler, Stable (aging), Seasons, Leaderboards |
| `odds-engine` (Monte Carlo per tick, all live races) | Market Manager, Settlement |
| `race-broadcaster` (tick timers for concurrent races) | SSE Gateway, social services |
| `race-engine-core` → **WASM** build for the browser verifier | Frontend (three.js) |

Rust ↔ TS contracts are the Kafka event schemas (JSON v1, moving to
Protobuf/Avro when stable) plus the shared `venue` / `script` JSON schemas.

## 2. Determinism

```
script = simulate(engineVersion, params, venue@version, entrants[], laps, seed)
```

- No I/O, clock or ambient randomness. RNG: `ChaCha20Rng` seeded from the
  32-byte race seed; one sub-stream per entrant plus one for incidents, so
  adding an incident type doesn't shift everyone's movement.
- Float determinism: fixed iteration order, no parallelism inside a race, no
  platform-dependent math (use `libm`). The CI golden-script tests run on x86 and
  WASM to prove identical output.
- `params` (incident rates, noise levels, drain curves) are versioned **with**
  the engine, not runtime config: they're part of the simulation input and
  hashed into `scriptHash`.

## 3. Library API (`race-engine-core`)

| Function | Input | Output | Used by |
|---|---|---|---|
| `plan_race` | venue, entrants, class target window | `laps`, `estimated_duration_sec` | Scheduler (via service) |
| `simulate` | venue, entrants, laps, seed | `RaceScript` | race-engine |
| `simulate_from` | venue, entrants, laps, `RevealedState @ tick`, rng | `Outcome` (finish order, lap leaders, incidents) | odds-engine (2k–5k ×/tick) |
| `price_race` | venue, entrants, laps, runs | probabilities per market | odds-engine (pre-race) |
| `verify` | inputs, revealed seed, `scriptHash` | `Ok` / `Mismatch` | CLI, browser (WASM) |

`plan_race` runs a few dry simulations on throwaway seeds and picks the lap
count (within `venue.lapsRange`) whose median finish lands in the class window
(SPRINT 120–180 s, STANDARD ~300 s, ENDURANCE ≤ 600 s).

`simulate_from` must work from revealed data only: positions, speeds,
stamina, states, incidents so far. Hidden internal state (e.g. an entrant's
current pacing decision) is re-sampled.

## 4. Service API (`race-engine`)

Async via Kafka:

```
race.commands (key raceId)
  GenerateScript { raceId, engineVersion, venueId, venueVersion, laps, entrants[] }

race.lifecycle
  ScriptSealed { raceId, engineVersion, seedHash, scriptHash }
  ScriptFailed { raceId, reason }
```

- The service generates the seed (CSPRNG), simulates, writes `{script, seed}`
  encrypted to the Script Store, and publishes **hashes only**.
- The Script Store is readable only by `race-broadcaster` before `FINISHED`.

Internal HTTP (not public):

```
POST /internal/plan                  → { laps, estimatedDurationSec }
POST /internal/simulate              → dry run with a caller-supplied seed (admin/testing; never for real races)
GET  /internal/scripts/{raceId}      → broadcaster only
GET  /internal/engine-versions       → supported versions + params hash
```

## 5. Physics model (per 500 ms tick)

```
target  = velocity × ageFactor
        × surfaceAffinity[species][surface]
        × segmentMod(curve radius, grade)
        × temperamentEffort(lap, position, staminaPct)
speed  += clamp(target − speed, ±acceleration·dt) + noise(1 − consistency)
stamina -= drain(effort, grade, surface)      // < 25% → TIRED, target × 0.8
lane     : 1D blocking model; overtakes when gap & lane free
```

### Temperament (public, fixed for life)

| Temperament | Behaviour |
|---|---|
| `FRONT_RUNNER` | Pushes early to lead; fades if stamina is short. Strong in LEADER_AT_LAP markets. |
| `STALKER` | Sits 2nd–4th, pushes in the last third. |
| `CLOSER` | Conserves, big surge in the final lap(s). Odds drift then crash late. |
| `STEADY` | Even pace; low variance, rarely spectacular. |

Shown on the animal profile with stats; the odds engine uses it like any
other public stat.

## 6. Incidents (rare)

Rates are engine `params` (defaults below, tuned so most races have none).

| Incident | When | Default rate | Effect | Market rules |
|---|---|---|---|---|
| `STUMBLE` | any tick | ∝ (1−consistency) × curve × surface | speed drop for 2–6 ticks | none |
| `FALSE_START` | tick 0 | 1% per race | offender starts +3 s late | none (race stands) |
| `REFUSED_TO_RUN` | tick 0 | 0.5% per entrant | never starts | classified **last** (`NON_RUNNER`); bets on it LOST; other bets stand |
| `PULLED_UP` | mid-race | 0.3% per entrant | stops, `state: DNF` | classified **last** (`DNF`); bets on it LOST; already resulted lap markets stand |
| `DISQUALIFIED` | after finish | 0.2% per race | moved to **last** (`DISQUALIFIED`), others promoted | position/podium/tricast settle on **official** order; `LEADER_AT_LAP` settles as run |

**No bets are voided by incidents.** Non-runners, DNFs and DQs all count as
last place. When several entrants are classified last, the official order is:
finishers → `DISQUALIFIED` (by crossing time) → `DNF` (by distance covered) →
`NON_RUNNER` (by lane). Every result row stores a `resultStatus`
(`FINISHED | DISQUALIFIED | DNF | NON_RUNNER`) so history, form and the UI
can tell them apart (e.g. form `1-3-DQ-2-NR`). Only `RaceCancelled` voids bets.

Incidents appear in tick `events[]` when they happen (so the broadcaster
reveals them live and markets suspend). DQ is announced at `RaceFinished`
(`order` = official, `asRun` = before DQ).

## 7. Replays & retention

- Config: `REPLAY_RETENTION_HOURS` (default **24**, min 24).
- Within retention: full script is served from the Script Store
  (`GET /v1/races/{id}/ticks`, `/script`) after `FINISHED`.
- After retention: script deleted; we keep inputs, seed, `scriptHash`,
  `engineVersion`, results and incidents forever (small). A replay can be
  regenerated on demand **only if** that `engineVersion` is still in
  `/internal/engine-versions`; otherwise the API returns `410 REPLAY_EXPIRED`.
- Highlight clips for the social feed should be rendered/captured within
  the retention window.

## 8. Wire formats

- **Kafka (service ↔ service): Protobuf.** Schemas in `proto/` are the single
  source of truth, generated with `prost` (Rust) and `ts-proto` (TypeScript).
  Envelope fields (`eventId`, `type`, `version`, `occurredAt`) are a shared
  `Envelope` message; payloads evolve by adding fields only.
- **Browser (REST + SSE): JSON.** The SSE Gateway / API translate Protobuf → JSON
  using the generated types, so field names stay identical. Script Store and
  replays are served as JSON so the WASM verifier and three.js read the same
  shape.

## 9. Odds cadence

- The Odds Engine reprices **every second tick (1 s)** per live race; it may
  reprice immediately on an incident or lap completion.
- `PriceUpdated` therefore arrives at ≤ 1 Hz per market; the bet/cash-out
  acceptance delay (2 ticks) stays aligned with one reprice.

## 10. Fields & species

- **6–10 entrants per race**, single species. Every venue has **10 lanes**.
- v1 species: **horses** and **giraffes**. 1 real day = 1 animal week.

**Max career: 5 seasons = 140 days** (= 140 animal weeks ≈ 2.7 animal years).
Life stages are expressed in career days:

| | Horse | Giraffe |
|---|---|---|
| ROOKIE | days 0–25 | days 0–35 (slower to mature) |
| PRIME | days 25–95 | days 35–110 |
| VETERAN | days 95–140 | days 110–140 |
| Retire | ≤ day 140, earlier if stats decline below threshold | same |
| Strengths | acceleration, tight curves, DIRT/GRASS | top speed on long straights, stamina, SAND |
| Weaknesses | stamina on MUD | tight curves (hairpins), ICE stumble risk |

Animals enter the roster at a random age within ROOKIE so retirements are
staggered; the Stable keeps each species' active pool sized for its race
programme.

## 11. Race programme

- **3 races per hour, 24/7** (= 72/day), alternating species
  (≈ 36 horse + 36 giraffe races/day). Class mix per hour configurable
  (default: 1 SPRINT, 1 STANDARD, 1 SPRINT/ENDURANCE alternating).
- Cadence per race: scheduled & sealed (up to 24 h ahead) → OPEN until
  `startAt − 60 s` → LIVE 2–10 min. Races overlap; at most ~3 are LIVE at once.
- **Recovery, not daily caps.** Animals may race any number of times per day
  but never concurrently. After a race an animal is `RESTING` for
  **1–2 h** (SPRINT 60 min, STANDARD 90 min, ENDURANCE 120 min; config).
  The Scheduler books an animal only if
  `prevStartAt + 10 min (max race) + recovery ≤ nextStartAt`.
- Roster sizing: a species races every ~40 min → ~36 races × ~8 entrants
  ≈ 290 starts/day. An animal can do a race every ~2 h → up to ~12/day, so the
  hard minimum is **~25 animals per species**. For variety and fresh
  match-ups the target pool is **~60 per species** (each races ~5×/day).
  With 140-day careers that's ~0.4 retirements + recruits per species per day.
