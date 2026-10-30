# Kafka Events (v1)

All events share an envelope:

```jsonc
{ "eventId": "uuid", "type": "RaceTick", "version": 1,
  "occurredAt": "2026-10-30T12:00:00.000Z", "payload": { … } }
```

Consumers dedupe on `eventId` and on business keys (`betId`, `marketId`, …).

## Topics

| Topic | Key | Producers | Consumers |
|---|---|---|---|
| `race.lifecycle` | raceId | Scheduler, Broadcaster | Market Manager, Broadcaster, Settlement, Stable, SSE |
| `race.ticks` | raceId | Broadcaster | Odds Engine, Market Manager, Settlement, SSE |
| `market.events` | raceId | Market Manager, Odds Engine, Settlement | Bet Service, SSE |
| `bet.commands` | raceId | Bet Service (API) | Bet Service (acceptance worker) |
| `bet.events` | userId | Bet Service, Settlement | Wallet, SSE, Social feed |
| `wallet.events` | userId | Wallet | SSE |
| `stable.events` | animalId | Stable | Scheduler, Social feed |

## race.lifecycle

| Type | Payload |
|---|---|
| `RaceScheduled` | `raceId, class, startAt, laps, trackLength, estimatedDurationSec, tickMs, entrants[{entrantId, animalId, lane, statsSnapshot}], seedHash, scriptHash` |
| `RaceOpened` | `raceId` (pre-race markets open) |
| `RaceStarted` | `raceId, startedAt` |
| `RaceFinished` | `raceId, finishTick, order[entrantId], seed` (script now public) |
| `RaceSettled` | `raceId` |
| `RaceCancelled` | `raceId, reason` (all bets VOID) |

## race.ticks

| Type | Payload |
|---|---|
| `RaceTick` | `raceId, tick, lap, entrants[{id, dist, lane, speed, staminaPct, state}], events[]` |
| `LapCompleted` | `raceId, tick, lap, leaderEntrantId, standings[entrantId]` |

## market.events

| Type | Payload |
|---|---|
| `MarketOpened` | `marketId, raceId, type, params, selections[{selectionId, entrantId, price}], priceVersion` |
| `PriceUpdated` | `marketId, tick, priceVersion, selections[{selectionId, price, probability}]` |
| `MarketSuspended` | `marketId, tick, reason: CHECKPOINT\|INCIDENT\|MANUAL` |
| `MarketResumed` | `marketId, tick, priceVersion` |
| `MarketClosed` | `marketId, tick` |
| `MarketResulted` | `marketId, winning: [selectionId] \| order[entrantId]` |

## bet.commands

| Type | Payload |
|---|---|
| `BetRequested` | `betId, userId, marketId, selection, stake, acceptedPrice, priceVersion, acceptPriceChanges, requestedAtTick, acceptAtTick` |
| `CashOutRequested` | `betId, userId, quoteId, minAmount, requestedAtTick, acceptAtTick` |

## bet.events

| Type | Payload |
|---|---|
| `BetAccepted` | `betId, userId, marketId, raceId, selection, stake, lockedPrice` |
| `BetRejected` | `betId, userId, reason: PRICE_CHANGED\|MARKET_SUSPENDED\|MARKET_CLOSED\|INSUFFICIENT_FUNDS` |
| `BetSettled` | `betId, userId, outcome: WON\|LOST\|VOID, payout` |
| `BetCashedOut` | `betId, userId, amount, tick` |
| `CashOutRejected` | `betId, userId, reason: BELOW_MIN\|MARKET_SUSPENDED\|ALREADY_SETTLED\|QUOTE_EXPIRED` |

## wallet.events

| Type | Payload |
|---|---|
| `LedgerEntryAppended` | `entryId, userId, type, amount, refId, balanceAfter` |

## stable.events

| Type | Payload |
|---|---|
| `AnimalRecruited` | `animalId, species, name, base` |
| `AnimalAged` | `animalId, ageRaces, current` |
| `AnimalRetired` | `animalId, reason: AGE\|DECLINE, careerStats` |
