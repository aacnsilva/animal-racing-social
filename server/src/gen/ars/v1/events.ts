import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";

export const protobufPackage = "ars.v1";

export const protobufFileName = "ars/v1/events.proto";

export interface Envelope {
  eventId: string;
  type: string;
  version: number;
  occurredAt: string;
  payload:
    | { $case: "raceScheduled"; value: RaceScheduled }
    | { $case: "raceOpened"; value: RaceOpened }
    | { $case: "raceLocked"; value: RaceLocked }
    | { $case: "raceStarted"; value: RaceStarted }
    | { $case: "scriptSealed"; value: ScriptSealed }
    | { $case: "scriptFailed"; value: ScriptFailed }
    | { $case: "raceFinished"; value: RaceFinished }
    | { $case: "raceSettled"; value: RaceSettled }
    | { $case: "raceCancelled"; value: RaceCancelled }
    | { $case: "generateScript"; value: GenerateScript }
    | { $case: "scheduleRace"; value: ScheduleRace }
    | { $case: "cancelRace"; value: CancelRace }
    | { $case: "marketCommand"; value: MarketCommand }
    | { $case: "raceTick"; value: RaceTick }
    | { $case: "lapCompleted"; value: LapCompleted }
    | { $case: "marketOpened"; value: MarketOpened }
    | { $case: "priceUpdated"; value: PriceUpdated }
    | { $case: "marketSuspended"; value: MarketSuspended }
    | { $case: "marketResumed"; value: MarketResumed }
    | { $case: "marketClosed"; value: MarketClosed }
    | { $case: "marketResulted"; value: MarketResulted }
    | { $case: "marketVoided"; value: MarketVoided }
    | { $case: "betRequested"; value: BetRequested }
    | { $case: "comboRequested"; value: ComboRequested }
    | { $case: "cashOutRequested"; value: CashOutRequested }
    | { $case: "betAccepted"; value: BetAccepted }
    | { $case: "betRejected"; value: BetRejected }
    | { $case: "legSettled"; value: LegSettled }
    | { $case: "betSettled"; value: BetSettled }
    | { $case: "betCashedOut"; value: BetCashedOut }
    | { $case: "cashOutRejected"; value: CashOutRejected }
    | { $case: "ledgerEntryAppended"; value: LedgerEntryAppended }
    | { $case: "animalRecruited"; value: AnimalRecruited }
    | { $case: "animalAged"; value: AnimalAged }
    | { $case: "animalRetired"; value: AnimalRetired }
    | { $case: "seasonStarted"; value: SeasonStarted }
    | { $case: "seasonEnding"; value: SeasonEnding }
    | { $case: "seasonEnded"; value: SeasonEnded }
    | { $case: "leaderboardMoved"; value: LeaderboardMoved }
    | { $case: "notificationCreated"; value: NotificationCreated }
    | { $case: "adminAudit"; value: AdminAudit }
    | undefined;
}

export interface Stats {
  velocity: number;
  stamina: number;
  acceleration: number;
  consistency: number;
}

export interface EntrantInfo {
  entrantId: string;
  animalId: string;
  lane: number;
  temperament: string;
  stats: Stats | undefined;
  name: string;
}

export interface RaceScheduled {
  raceId: string;
  seasonId: string;
  species: string;
  raceClass: string;
  venueId: string;
  venueVersion: number;
  engineVersion: string;
  startAt: string;
  laps: number;
  estimatedDurationSec: number;
  tickMs: number;
  entrants: EntrantInfo[];
  seedHash: string;
  scriptHash: string;
}

export interface RaceOpened {
  raceId: string;
}

export interface RaceLocked {
  raceId: string;
}

export interface RaceStarted {
  raceId: string;
  startedAt: string;
}

export interface ScriptSealed {
  raceId: string;
  engineVersion: string;
  seedHash: string;
  scriptHash: string;
}

export interface ScriptFailed {
  raceId: string;
  reason: string;
}

export interface Incident {
  seq: number;
  tick: number;
  type: string;
  entrantId?: string | undefined;
  dataJson: string;
}

export interface EntrantResult {
  entrantId: string;
  officialPosition: number;
  asRunPosition: number;
  resultStatus: string;
  finishTimeMs?: string | undefined;
  distanceCovered: number;
  lapsLed: number[];
}

export interface LapLeader {
  lap: number;
  entrantId: string;
  tick: number;
}

export interface RaceFinished {
  raceId: string;
  finishTick: number;
  order: string[];
  asRun: string[];
  incidents: Incident[];
  seed: string;
  results: EntrantResult[];
  lapLeaders: LapLeader[];
  finishedAt: string;
}

export interface RaceSettled {
  raceId: string;
}

export interface RaceCancelled {
  raceId: string;
  reason: string;
}

export interface GenerateScript {
  raceId: string;
  engineVersion: string;
  venueId: string;
  venueVersion: number;
  laps: number;
  entrants: EntrantInfo[];
  species: string;
}

export interface ScheduleRace {
  raceId: string;
  startAt: string;
  species: string;
  raceClass: string;
  venueId?: string | undefined;
  fieldSize?: number | undefined;
  adminUserId: string;
}

export interface CancelRace {
  raceId: string;
  reason: string;
  adminUserId: string;
}

export interface MarketCommand {
  marketId: string;
  raceId: string;
  action: string;
  reason: string;
  adminUserId: string;
}

export interface TickEntrant {
  id: string;
  dist: number;
  lane: number;
  speed: number;
  staminaPct: number;
  state: string;
  pos: number;
}

export interface TickEvent {
  type: string;
  id?: string | undefined;
  a?: string | undefined;
  b?: string | undefined;
  lap?: number | undefined;
  pos?: number | undefined;
}

export interface RaceTick {
  raceId: string;
  tick: number;
  lap: number;
  entrants: TickEntrant[];
  events: TickEvent[];
}

export interface LapCompleted {
  raceId: string;
  tick: number;
  lap: number;
  leaderEntrantId: string;
  standings: string[];
}

export interface SelectionPrice {
  selectionId: string;
  entrantId: string;
  price: number;
  probability: number;
}

export interface MarketOpened {
  marketId: string;
  raceId: string;
  type: string;
  params: { [key: string]: number };
  selections: SelectionPrice[];
  priceVersion: number;
  closesAtLap?: number | undefined;
}

export interface MarketOpened_ParamsEntry {
  key: string;
  value: number;
}

export interface PriceUpdated {
  marketId: string;
  raceId: string;
  tick: number;
  priceVersion: number;
  selections: SelectionPrice[];
}

export interface MarketSuspended {
  marketId: string;
  raceId: string;
  tick: number;
  reason: string;
}

export interface MarketResumed {
  marketId: string;
  raceId: string;
  tick: number;
  priceVersion: number;
}

export interface MarketClosed {
  marketId: string;
  raceId: string;
  tick: number;
}

export interface MarketResulted {
  marketId: string;
  raceId: string;
  winning: string[];
  order: string[];
}

export interface MarketVoided {
  marketId: string;
  raceId: string;
  reason: string;
}

export interface BetSelection {
  entrantId?: string | undefined;
  order: string[];
}

export interface BetRequested {
  betId: string;
  userId: string;
  marketId: string;
  selection: BetSelection | undefined;
  stake: string;
  acceptedPrice: number;
  priceVersion: number;
  acceptPriceChanges: string;
  requestedAtTick?: number | undefined;
  acceptAtTick?: number | undefined;
  raceId: string;
  seasonId: string;
  acceptAtMs: string;
}

export interface ComboLeg {
  legNo: number;
  marketId: string;
  raceId: string;
  selection: BetSelection | undefined;
  acceptedPrice: number;
  priceVersion: number;
}

export interface ComboRequested {
  betId: string;
  userId: string;
  legs: ComboLeg[];
  stake: string;
  acceptPriceChanges: string;
  acceptAtTick?: number | undefined;
  seasonId: string;
  acceptAtMs: string;
}

export interface CashOutRequested {
  betId: string;
  userId: string;
  quoteId: string;
  minAmount: string;
  requestedAtTick?: number | undefined;
  acceptAtTick?: number | undefined;
  cashoutId: string;
  acceptAtMs: string;
}

export interface BetAccepted {
  betId: string;
  userId: string;
  marketId: string;
  raceId: string;
  selection: BetSelection | undefined;
  stake: string;
  lockedPrice: number;
  betType: string;
  raceIds: string[];
  seasonId: string;
}

export interface BetRejected {
  betId: string;
  userId: string;
  reason: string;
}

export interface LegSettled {
  betId: string;
  legNo: number;
  marketId: string;
  outcome: string;
  userId: string;
}

export interface BetSettled {
  betId: string;
  userId: string;
  outcome: string;
  payout: string;
  stake: string;
  seasonId: string;
  betType: string;
}

export interface BetCashedOut {
  betId: string;
  userId: string;
  amount: string;
  tick?: number | undefined;
  stake: string;
  seasonId: string;
}

export interface CashOutRejected {
  betId: string;
  userId: string;
  reason: string;
  cashoutId: string;
}

export interface LedgerEntryAppended {
  entryId: string;
  userId: string;
  seasonId: string;
  type: string;
  amount: string;
  refId: string;
  balanceAfter: string;
  openStakeAfter: string;
}

export interface CareerStats {
  races: number;
  wins: number;
  podiums: number;
}

export interface AnimalRecruited {
  animalId: string;
  species: string;
  name: string;
  base: Stats | undefined;
  temperament: string;
}

export interface AnimalAged {
  animalId: string;
  ageWeeks: number;
  lifeStage: string;
  current: Stats | undefined;
  careerDay: number;
}

export interface AnimalRetired {
  animalId: string;
  reason: string;
  careerStats: CareerStats | undefined;
}

export interface SeasonStarted {
  seasonId: string;
  startsAt: string;
  endsAt: string;
  startingGrant: string;
  name: string;
}

export interface SeasonEnding {
  seasonId: string;
  endsAt: string;
}

export interface SeasonStanding {
  userId: string;
  rank: number;
  score: number;
}

export interface SeasonEnded {
  seasonId: string;
  top: SeasonStanding[];
}

export interface LeaderboardMoved {
  seasonId: string;
  userId: string;
  board: string;
  fromRank: number;
  toRank: number;
  threshold: number;
  entered: boolean;
}

export interface NotificationCreated {
  userId: string;
  notificationId: string;
  type: string;
  payloadJson: string;
  createdAt: string;
}

export interface AdminAudit {
  auditId: string;
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  beforeJson: string;
  afterJson: string;
  reason: string;
}

function createBaseEnvelope(): Envelope {
  return { eventId: "", type: "", version: 0, occurredAt: "", payload: undefined };
}

export const Envelope: MessageFns<Envelope> = {
  encode(message: Envelope, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.eventId !== "") {
      writer.uint32(10).string(message.eventId);
    }
    if (message.type !== "") {
      writer.uint32(18).string(message.type);
    }
    if (message.version !== 0) {
      writer.uint32(24).uint32(message.version);
    }
    if (message.occurredAt !== "") {
      writer.uint32(34).string(message.occurredAt);
    }
    switch (message.payload?.$case) {
      case "raceScheduled":
        RaceScheduled.encode(message.payload.value, writer.uint32(82).fork()).join();
        break;
      case "raceOpened":
        RaceOpened.encode(message.payload.value, writer.uint32(90).fork()).join();
        break;
      case "raceLocked":
        RaceLocked.encode(message.payload.value, writer.uint32(98).fork()).join();
        break;
      case "raceStarted":
        RaceStarted.encode(message.payload.value, writer.uint32(106).fork()).join();
        break;
      case "scriptSealed":
        ScriptSealed.encode(message.payload.value, writer.uint32(114).fork()).join();
        break;
      case "scriptFailed":
        ScriptFailed.encode(message.payload.value, writer.uint32(122).fork()).join();
        break;
      case "raceFinished":
        RaceFinished.encode(message.payload.value, writer.uint32(130).fork()).join();
        break;
      case "raceSettled":
        RaceSettled.encode(message.payload.value, writer.uint32(138).fork()).join();
        break;
      case "raceCancelled":
        RaceCancelled.encode(message.payload.value, writer.uint32(146).fork()).join();
        break;
      case "generateScript":
        GenerateScript.encode(message.payload.value, writer.uint32(162).fork()).join();
        break;
      case "scheduleRace":
        ScheduleRace.encode(message.payload.value, writer.uint32(170).fork()).join();
        break;
      case "cancelRace":
        CancelRace.encode(message.payload.value, writer.uint32(178).fork()).join();
        break;
      case "marketCommand":
        MarketCommand.encode(message.payload.value, writer.uint32(186).fork()).join();
        break;
      case "raceTick":
        RaceTick.encode(message.payload.value, writer.uint32(242).fork()).join();
        break;
      case "lapCompleted":
        LapCompleted.encode(message.payload.value, writer.uint32(250).fork()).join();
        break;
      case "marketOpened":
        MarketOpened.encode(message.payload.value, writer.uint32(322).fork()).join();
        break;
      case "priceUpdated":
        PriceUpdated.encode(message.payload.value, writer.uint32(330).fork()).join();
        break;
      case "marketSuspended":
        MarketSuspended.encode(message.payload.value, writer.uint32(338).fork()).join();
        break;
      case "marketResumed":
        MarketResumed.encode(message.payload.value, writer.uint32(346).fork()).join();
        break;
      case "marketClosed":
        MarketClosed.encode(message.payload.value, writer.uint32(354).fork()).join();
        break;
      case "marketResulted":
        MarketResulted.encode(message.payload.value, writer.uint32(362).fork()).join();
        break;
      case "marketVoided":
        MarketVoided.encode(message.payload.value, writer.uint32(370).fork()).join();
        break;
      case "betRequested":
        BetRequested.encode(message.payload.value, writer.uint32(402).fork()).join();
        break;
      case "comboRequested":
        ComboRequested.encode(message.payload.value, writer.uint32(410).fork()).join();
        break;
      case "cashOutRequested":
        CashOutRequested.encode(message.payload.value, writer.uint32(418).fork()).join();
        break;
      case "betAccepted":
        BetAccepted.encode(message.payload.value, writer.uint32(482).fork()).join();
        break;
      case "betRejected":
        BetRejected.encode(message.payload.value, writer.uint32(490).fork()).join();
        break;
      case "legSettled":
        LegSettled.encode(message.payload.value, writer.uint32(498).fork()).join();
        break;
      case "betSettled":
        BetSettled.encode(message.payload.value, writer.uint32(506).fork()).join();
        break;
      case "betCashedOut":
        BetCashedOut.encode(message.payload.value, writer.uint32(514).fork()).join();
        break;
      case "cashOutRejected":
        CashOutRejected.encode(message.payload.value, writer.uint32(522).fork()).join();
        break;
      case "ledgerEntryAppended":
        LedgerEntryAppended.encode(message.payload.value, writer.uint32(562).fork()).join();
        break;
      case "animalRecruited":
        AnimalRecruited.encode(message.payload.value, writer.uint32(642).fork()).join();
        break;
      case "animalAged":
        AnimalAged.encode(message.payload.value, writer.uint32(650).fork()).join();
        break;
      case "animalRetired":
        AnimalRetired.encode(message.payload.value, writer.uint32(658).fork()).join();
        break;
      case "seasonStarted":
        SeasonStarted.encode(message.payload.value, writer.uint32(722).fork()).join();
        break;
      case "seasonEnding":
        SeasonEnding.encode(message.payload.value, writer.uint32(730).fork()).join();
        break;
      case "seasonEnded":
        SeasonEnded.encode(message.payload.value, writer.uint32(738).fork()).join();
        break;
      case "leaderboardMoved":
        LeaderboardMoved.encode(message.payload.value, writer.uint32(746).fork()).join();
        break;
      case "notificationCreated":
        NotificationCreated.encode(message.payload.value, writer.uint32(802).fork()).join();
        break;
      case "adminAudit":
        AdminAudit.encode(message.payload.value, writer.uint32(882).fork()).join();
        break;
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): Envelope {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseEnvelope();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 10) {
              break;
            }

            message.eventId = reader.string();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.type = reader.string();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.version = reader.uint32();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.occurredAt = reader.string();
            continue;
          }
          case 10: {
            if (tag !== 82) {
              break;
            }

            message.payload = { $case: "raceScheduled", value: RaceScheduled.decode(reader, reader.uint32()) };
            continue;
          }
          case 11: {
            if (tag !== 90) {
              break;
            }

            message.payload = { $case: "raceOpened", value: RaceOpened.decode(reader, reader.uint32()) };
            continue;
          }
          case 12: {
            if (tag !== 98) {
              break;
            }

            message.payload = { $case: "raceLocked", value: RaceLocked.decode(reader, reader.uint32()) };
            continue;
          }
          case 13: {
            if (tag !== 106) {
              break;
            }

            message.payload = { $case: "raceStarted", value: RaceStarted.decode(reader, reader.uint32()) };
            continue;
          }
          case 14: {
            if (tag !== 114) {
              break;
            }

            message.payload = { $case: "scriptSealed", value: ScriptSealed.decode(reader, reader.uint32()) };
            continue;
          }
          case 15: {
            if (tag !== 122) {
              break;
            }

            message.payload = { $case: "scriptFailed", value: ScriptFailed.decode(reader, reader.uint32()) };
            continue;
          }
          case 16: {
            if (tag !== 130) {
              break;
            }

            message.payload = { $case: "raceFinished", value: RaceFinished.decode(reader, reader.uint32()) };
            continue;
          }
          case 17: {
            if (tag !== 138) {
              break;
            }

            message.payload = { $case: "raceSettled", value: RaceSettled.decode(reader, reader.uint32()) };
            continue;
          }
          case 18: {
            if (tag !== 146) {
              break;
            }

            message.payload = { $case: "raceCancelled", value: RaceCancelled.decode(reader, reader.uint32()) };
            continue;
          }
          case 20: {
            if (tag !== 162) {
              break;
            }

            message.payload = { $case: "generateScript", value: GenerateScript.decode(reader, reader.uint32()) };
            continue;
          }
          case 21: {
            if (tag !== 170) {
              break;
            }

            message.payload = { $case: "scheduleRace", value: ScheduleRace.decode(reader, reader.uint32()) };
            continue;
          }
          case 22: {
            if (tag !== 178) {
              break;
            }

            message.payload = { $case: "cancelRace", value: CancelRace.decode(reader, reader.uint32()) };
            continue;
          }
          case 23: {
            if (tag !== 186) {
              break;
            }

            message.payload = { $case: "marketCommand", value: MarketCommand.decode(reader, reader.uint32()) };
            continue;
          }
          case 30: {
            if (tag !== 242) {
              break;
            }

            message.payload = { $case: "raceTick", value: RaceTick.decode(reader, reader.uint32()) };
            continue;
          }
          case 31: {
            if (tag !== 250) {
              break;
            }

            message.payload = { $case: "lapCompleted", value: LapCompleted.decode(reader, reader.uint32()) };
            continue;
          }
          case 40: {
            if (tag !== 322) {
              break;
            }

            message.payload = { $case: "marketOpened", value: MarketOpened.decode(reader, reader.uint32()) };
            continue;
          }
          case 41: {
            if (tag !== 330) {
              break;
            }

            message.payload = { $case: "priceUpdated", value: PriceUpdated.decode(reader, reader.uint32()) };
            continue;
          }
          case 42: {
            if (tag !== 338) {
              break;
            }

            message.payload = { $case: "marketSuspended", value: MarketSuspended.decode(reader, reader.uint32()) };
            continue;
          }
          case 43: {
            if (tag !== 346) {
              break;
            }

            message.payload = { $case: "marketResumed", value: MarketResumed.decode(reader, reader.uint32()) };
            continue;
          }
          case 44: {
            if (tag !== 354) {
              break;
            }

            message.payload = { $case: "marketClosed", value: MarketClosed.decode(reader, reader.uint32()) };
            continue;
          }
          case 45: {
            if (tag !== 362) {
              break;
            }

            message.payload = { $case: "marketResulted", value: MarketResulted.decode(reader, reader.uint32()) };
            continue;
          }
          case 46: {
            if (tag !== 370) {
              break;
            }

            message.payload = { $case: "marketVoided", value: MarketVoided.decode(reader, reader.uint32()) };
            continue;
          }
          case 50: {
            if (tag !== 402) {
              break;
            }

            message.payload = { $case: "betRequested", value: BetRequested.decode(reader, reader.uint32()) };
            continue;
          }
          case 51: {
            if (tag !== 410) {
              break;
            }

            message.payload = { $case: "comboRequested", value: ComboRequested.decode(reader, reader.uint32()) };
            continue;
          }
          case 52: {
            if (tag !== 418) {
              break;
            }

            message.payload = { $case: "cashOutRequested", value: CashOutRequested.decode(reader, reader.uint32()) };
            continue;
          }
          case 60: {
            if (tag !== 482) {
              break;
            }

            message.payload = { $case: "betAccepted", value: BetAccepted.decode(reader, reader.uint32()) };
            continue;
          }
          case 61: {
            if (tag !== 490) {
              break;
            }

            message.payload = { $case: "betRejected", value: BetRejected.decode(reader, reader.uint32()) };
            continue;
          }
          case 62: {
            if (tag !== 498) {
              break;
            }

            message.payload = { $case: "legSettled", value: LegSettled.decode(reader, reader.uint32()) };
            continue;
          }
          case 63: {
            if (tag !== 506) {
              break;
            }

            message.payload = { $case: "betSettled", value: BetSettled.decode(reader, reader.uint32()) };
            continue;
          }
          case 64: {
            if (tag !== 514) {
              break;
            }

            message.payload = { $case: "betCashedOut", value: BetCashedOut.decode(reader, reader.uint32()) };
            continue;
          }
          case 65: {
            if (tag !== 522) {
              break;
            }

            message.payload = { $case: "cashOutRejected", value: CashOutRejected.decode(reader, reader.uint32()) };
            continue;
          }
          case 70: {
            if (tag !== 562) {
              break;
            }

            message.payload = {
              $case: "ledgerEntryAppended",
              value: LedgerEntryAppended.decode(reader, reader.uint32()),
            };
            continue;
          }
          case 80: {
            if (tag !== 642) {
              break;
            }

            message.payload = { $case: "animalRecruited", value: AnimalRecruited.decode(reader, reader.uint32()) };
            continue;
          }
          case 81: {
            if (tag !== 650) {
              break;
            }

            message.payload = { $case: "animalAged", value: AnimalAged.decode(reader, reader.uint32()) };
            continue;
          }
          case 82: {
            if (tag !== 658) {
              break;
            }

            message.payload = { $case: "animalRetired", value: AnimalRetired.decode(reader, reader.uint32()) };
            continue;
          }
          case 90: {
            if (tag !== 722) {
              break;
            }

            message.payload = { $case: "seasonStarted", value: SeasonStarted.decode(reader, reader.uint32()) };
            continue;
          }
          case 91: {
            if (tag !== 730) {
              break;
            }

            message.payload = { $case: "seasonEnding", value: SeasonEnding.decode(reader, reader.uint32()) };
            continue;
          }
          case 92: {
            if (tag !== 738) {
              break;
            }

            message.payload = { $case: "seasonEnded", value: SeasonEnded.decode(reader, reader.uint32()) };
            continue;
          }
          case 93: {
            if (tag !== 746) {
              break;
            }

            message.payload = { $case: "leaderboardMoved", value: LeaderboardMoved.decode(reader, reader.uint32()) };
            continue;
          }
          case 100: {
            if (tag !== 802) {
              break;
            }

            message.payload = {
              $case: "notificationCreated",
              value: NotificationCreated.decode(reader, reader.uint32()),
            };
            continue;
          }
          case 110: {
            if (tag !== 882) {
              break;
            }

            message.payload = { $case: "adminAudit", value: AdminAudit.decode(reader, reader.uint32()) };
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<Envelope>, I>>(base?: I): Envelope {
    return Envelope.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<Envelope>, I>>(object: I): Envelope {
    const message = createBaseEnvelope();
    message.eventId = object.eventId ?? "";
    message.type = object.type ?? "";
    message.version = object.version ?? 0;
    message.occurredAt = object.occurredAt ?? "";
    switch (object.payload?.$case) {
      case "raceScheduled": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "raceScheduled", value: RaceScheduled.fromPartial(object.payload.value) };
        }
        break;
      }
      case "raceOpened": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "raceOpened", value: RaceOpened.fromPartial(object.payload.value) };
        }
        break;
      }
      case "raceLocked": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "raceLocked", value: RaceLocked.fromPartial(object.payload.value) };
        }
        break;
      }
      case "raceStarted": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "raceStarted", value: RaceStarted.fromPartial(object.payload.value) };
        }
        break;
      }
      case "scriptSealed": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "scriptSealed", value: ScriptSealed.fromPartial(object.payload.value) };
        }
        break;
      }
      case "scriptFailed": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "scriptFailed", value: ScriptFailed.fromPartial(object.payload.value) };
        }
        break;
      }
      case "raceFinished": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "raceFinished", value: RaceFinished.fromPartial(object.payload.value) };
        }
        break;
      }
      case "raceSettled": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "raceSettled", value: RaceSettled.fromPartial(object.payload.value) };
        }
        break;
      }
      case "raceCancelled": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "raceCancelled", value: RaceCancelled.fromPartial(object.payload.value) };
        }
        break;
      }
      case "generateScript": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "generateScript", value: GenerateScript.fromPartial(object.payload.value) };
        }
        break;
      }
      case "scheduleRace": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "scheduleRace", value: ScheduleRace.fromPartial(object.payload.value) };
        }
        break;
      }
      case "cancelRace": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "cancelRace", value: CancelRace.fromPartial(object.payload.value) };
        }
        break;
      }
      case "marketCommand": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "marketCommand", value: MarketCommand.fromPartial(object.payload.value) };
        }
        break;
      }
      case "raceTick": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "raceTick", value: RaceTick.fromPartial(object.payload.value) };
        }
        break;
      }
      case "lapCompleted": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "lapCompleted", value: LapCompleted.fromPartial(object.payload.value) };
        }
        break;
      }
      case "marketOpened": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "marketOpened", value: MarketOpened.fromPartial(object.payload.value) };
        }
        break;
      }
      case "priceUpdated": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "priceUpdated", value: PriceUpdated.fromPartial(object.payload.value) };
        }
        break;
      }
      case "marketSuspended": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "marketSuspended", value: MarketSuspended.fromPartial(object.payload.value) };
        }
        break;
      }
      case "marketResumed": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "marketResumed", value: MarketResumed.fromPartial(object.payload.value) };
        }
        break;
      }
      case "marketClosed": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "marketClosed", value: MarketClosed.fromPartial(object.payload.value) };
        }
        break;
      }
      case "marketResulted": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "marketResulted", value: MarketResulted.fromPartial(object.payload.value) };
        }
        break;
      }
      case "marketVoided": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "marketVoided", value: MarketVoided.fromPartial(object.payload.value) };
        }
        break;
      }
      case "betRequested": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "betRequested", value: BetRequested.fromPartial(object.payload.value) };
        }
        break;
      }
      case "comboRequested": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "comboRequested", value: ComboRequested.fromPartial(object.payload.value) };
        }
        break;
      }
      case "cashOutRequested": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "cashOutRequested", value: CashOutRequested.fromPartial(object.payload.value) };
        }
        break;
      }
      case "betAccepted": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "betAccepted", value: BetAccepted.fromPartial(object.payload.value) };
        }
        break;
      }
      case "betRejected": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "betRejected", value: BetRejected.fromPartial(object.payload.value) };
        }
        break;
      }
      case "legSettled": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "legSettled", value: LegSettled.fromPartial(object.payload.value) };
        }
        break;
      }
      case "betSettled": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "betSettled", value: BetSettled.fromPartial(object.payload.value) };
        }
        break;
      }
      case "betCashedOut": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "betCashedOut", value: BetCashedOut.fromPartial(object.payload.value) };
        }
        break;
      }
      case "cashOutRejected": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "cashOutRejected", value: CashOutRejected.fromPartial(object.payload.value) };
        }
        break;
      }
      case "ledgerEntryAppended": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = {
            $case: "ledgerEntryAppended",
            value: LedgerEntryAppended.fromPartial(object.payload.value),
          };
        }
        break;
      }
      case "animalRecruited": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "animalRecruited", value: AnimalRecruited.fromPartial(object.payload.value) };
        }
        break;
      }
      case "animalAged": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "animalAged", value: AnimalAged.fromPartial(object.payload.value) };
        }
        break;
      }
      case "animalRetired": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "animalRetired", value: AnimalRetired.fromPartial(object.payload.value) };
        }
        break;
      }
      case "seasonStarted": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "seasonStarted", value: SeasonStarted.fromPartial(object.payload.value) };
        }
        break;
      }
      case "seasonEnding": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "seasonEnding", value: SeasonEnding.fromPartial(object.payload.value) };
        }
        break;
      }
      case "seasonEnded": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "seasonEnded", value: SeasonEnded.fromPartial(object.payload.value) };
        }
        break;
      }
      case "leaderboardMoved": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "leaderboardMoved", value: LeaderboardMoved.fromPartial(object.payload.value) };
        }
        break;
      }
      case "notificationCreated": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = {
            $case: "notificationCreated",
            value: NotificationCreated.fromPartial(object.payload.value),
          };
        }
        break;
      }
      case "adminAudit": {
        if (object.payload?.value !== undefined && object.payload?.value !== null) {
          message.payload = { $case: "adminAudit", value: AdminAudit.fromPartial(object.payload.value) };
        }
        break;
      }
    }
    return message;
  },
};

function createBaseStats(): Stats {
  return { velocity: 0, stamina: 0, acceleration: 0, consistency: 0 };
}

export const Stats: MessageFns<Stats> = {
  encode(message: Stats, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.velocity !== 0) {
      writer.uint32(9).double(message.velocity);
    }
    if (message.stamina !== 0) {
      writer.uint32(17).double(message.stamina);
    }
    if (message.acceleration !== 0) {
      writer.uint32(25).double(message.acceleration);
    }
    if (message.consistency !== 0) {
      writer.uint32(33).double(message.consistency);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): Stats {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseStats();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 9) {
              break;
            }

            message.velocity = reader.double();
            continue;
          }
          case 2: {
            if (tag !== 17) {
              break;
            }

            message.stamina = reader.double();
            continue;
          }
          case 3: {
            if (tag !== 25) {
              break;
            }

            message.acceleration = reader.double();
            continue;
          }
          case 4: {
            if (tag !== 33) {
              break;
            }

            message.consistency = reader.double();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<Stats>, I>>(base?: I): Stats {
    return Stats.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<Stats>, I>>(object: I): Stats {
    const message = createBaseStats();
    message.velocity = object.velocity ?? 0;
    message.stamina = object.stamina ?? 0;
    message.acceleration = object.acceleration ?? 0;
    message.consistency = object.consistency ?? 0;
    return message;
  },
};

function createBaseEntrantInfo(): EntrantInfo {
  return { entrantId: "", animalId: "0", lane: 0, temperament: "", stats: undefined, name: "" };
}

export const EntrantInfo: MessageFns<EntrantInfo> = {
  encode(message: EntrantInfo, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.entrantId !== "") {
      writer.uint32(10).string(message.entrantId);
    }
    if (message.animalId !== "0") {
      writer.uint32(16).int64(message.animalId);
    }
    if (message.lane !== 0) {
      writer.uint32(24).uint32(message.lane);
    }
    if (message.temperament !== "") {
      writer.uint32(34).string(message.temperament);
    }
    if (message.stats !== undefined) {
      Stats.encode(message.stats, writer.uint32(42).fork()).join();
    }
    if (message.name !== "") {
      writer.uint32(50).string(message.name);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): EntrantInfo {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseEntrantInfo();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 10) {
              break;
            }

            message.entrantId = reader.string();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.animalId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.lane = reader.uint32();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.temperament = reader.string();
            continue;
          }
          case 5: {
            if (tag !== 42) {
              break;
            }

            message.stats = Stats.decode(reader, reader.uint32());
            continue;
          }
          case 6: {
            if (tag !== 50) {
              break;
            }

            message.name = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<EntrantInfo>, I>>(base?: I): EntrantInfo {
    return EntrantInfo.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<EntrantInfo>, I>>(object: I): EntrantInfo {
    const message = createBaseEntrantInfo();
    message.entrantId = object.entrantId ?? "";
    message.animalId = object.animalId ?? "0";
    message.lane = object.lane ?? 0;
    message.temperament = object.temperament ?? "";
    message.stats = (object.stats !== undefined && object.stats !== null) ? Stats.fromPartial(object.stats) : undefined;
    message.name = object.name ?? "";
    return message;
  },
};

function createBaseRaceScheduled(): RaceScheduled {
  return {
    raceId: "0",
    seasonId: "0",
    species: "",
    raceClass: "",
    venueId: "",
    venueVersion: 0,
    engineVersion: "",
    startAt: "",
    laps: 0,
    estimatedDurationSec: 0,
    tickMs: 0,
    entrants: [],
    seedHash: "",
    scriptHash: "",
  };
}

export const RaceScheduled: MessageFns<RaceScheduled> = {
  encode(message: RaceScheduled, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.raceId !== "0") {
      writer.uint32(8).int64(message.raceId);
    }
    if (message.seasonId !== "0") {
      writer.uint32(16).int64(message.seasonId);
    }
    if (message.species !== "") {
      writer.uint32(26).string(message.species);
    }
    if (message.raceClass !== "") {
      writer.uint32(34).string(message.raceClass);
    }
    if (message.venueId !== "") {
      writer.uint32(42).string(message.venueId);
    }
    if (message.venueVersion !== 0) {
      writer.uint32(48).uint32(message.venueVersion);
    }
    if (message.engineVersion !== "") {
      writer.uint32(58).string(message.engineVersion);
    }
    if (message.startAt !== "") {
      writer.uint32(66).string(message.startAt);
    }
    if (message.laps !== 0) {
      writer.uint32(72).uint32(message.laps);
    }
    if (message.estimatedDurationSec !== 0) {
      writer.uint32(80).uint32(message.estimatedDurationSec);
    }
    if (message.tickMs !== 0) {
      writer.uint32(88).uint32(message.tickMs);
    }
    for (const v of message.entrants) {
      EntrantInfo.encode(v!, writer.uint32(98).fork()).join();
    }
    if (message.seedHash !== "") {
      writer.uint32(106).string(message.seedHash);
    }
    if (message.scriptHash !== "") {
      writer.uint32(114).string(message.scriptHash);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): RaceScheduled {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseRaceScheduled();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.seasonId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.species = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.raceClass = reader.string();
            continue;
          }
          case 5: {
            if (tag !== 42) {
              break;
            }

            message.venueId = reader.string();
            continue;
          }
          case 6: {
            if (tag !== 48) {
              break;
            }

            message.venueVersion = reader.uint32();
            continue;
          }
          case 7: {
            if (tag !== 58) {
              break;
            }

            message.engineVersion = reader.string();
            continue;
          }
          case 8: {
            if (tag !== 66) {
              break;
            }

            message.startAt = reader.string();
            continue;
          }
          case 9: {
            if (tag !== 72) {
              break;
            }

            message.laps = reader.uint32();
            continue;
          }
          case 10: {
            if (tag !== 80) {
              break;
            }

            message.estimatedDurationSec = reader.uint32();
            continue;
          }
          case 11: {
            if (tag !== 88) {
              break;
            }

            message.tickMs = reader.uint32();
            continue;
          }
          case 12: {
            if (tag !== 98) {
              break;
            }

            message.entrants.push(EntrantInfo.decode(reader, reader.uint32()));
            continue;
          }
          case 13: {
            if (tag !== 106) {
              break;
            }

            message.seedHash = reader.string();
            continue;
          }
          case 14: {
            if (tag !== 114) {
              break;
            }

            message.scriptHash = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<RaceScheduled>, I>>(base?: I): RaceScheduled {
    return RaceScheduled.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<RaceScheduled>, I>>(object: I): RaceScheduled {
    const message = createBaseRaceScheduled();
    message.raceId = object.raceId ?? "0";
    message.seasonId = object.seasonId ?? "0";
    message.species = object.species ?? "";
    message.raceClass = object.raceClass ?? "";
    message.venueId = object.venueId ?? "";
    message.venueVersion = object.venueVersion ?? 0;
    message.engineVersion = object.engineVersion ?? "";
    message.startAt = object.startAt ?? "";
    message.laps = object.laps ?? 0;
    message.estimatedDurationSec = object.estimatedDurationSec ?? 0;
    message.tickMs = object.tickMs ?? 0;
    message.entrants = object.entrants?.map((e) => EntrantInfo.fromPartial(e)) || [];
    message.seedHash = object.seedHash ?? "";
    message.scriptHash = object.scriptHash ?? "";
    return message;
  },
};

function createBaseRaceOpened(): RaceOpened {
  return { raceId: "0" };
}

export const RaceOpened: MessageFns<RaceOpened> = {
  encode(message: RaceOpened, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.raceId !== "0") {
      writer.uint32(8).int64(message.raceId);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): RaceOpened {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseRaceOpened();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<RaceOpened>, I>>(base?: I): RaceOpened {
    return RaceOpened.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<RaceOpened>, I>>(object: I): RaceOpened {
    const message = createBaseRaceOpened();
    message.raceId = object.raceId ?? "0";
    return message;
  },
};

function createBaseRaceLocked(): RaceLocked {
  return { raceId: "0" };
}

export const RaceLocked: MessageFns<RaceLocked> = {
  encode(message: RaceLocked, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.raceId !== "0") {
      writer.uint32(8).int64(message.raceId);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): RaceLocked {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseRaceLocked();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<RaceLocked>, I>>(base?: I): RaceLocked {
    return RaceLocked.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<RaceLocked>, I>>(object: I): RaceLocked {
    const message = createBaseRaceLocked();
    message.raceId = object.raceId ?? "0";
    return message;
  },
};

function createBaseRaceStarted(): RaceStarted {
  return { raceId: "0", startedAt: "" };
}

export const RaceStarted: MessageFns<RaceStarted> = {
  encode(message: RaceStarted, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.raceId !== "0") {
      writer.uint32(8).int64(message.raceId);
    }
    if (message.startedAt !== "") {
      writer.uint32(18).string(message.startedAt);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): RaceStarted {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseRaceStarted();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.startedAt = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<RaceStarted>, I>>(base?: I): RaceStarted {
    return RaceStarted.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<RaceStarted>, I>>(object: I): RaceStarted {
    const message = createBaseRaceStarted();
    message.raceId = object.raceId ?? "0";
    message.startedAt = object.startedAt ?? "";
    return message;
  },
};

function createBaseScriptSealed(): ScriptSealed {
  return { raceId: "0", engineVersion: "", seedHash: "", scriptHash: "" };
}

export const ScriptSealed: MessageFns<ScriptSealed> = {
  encode(message: ScriptSealed, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.raceId !== "0") {
      writer.uint32(8).int64(message.raceId);
    }
    if (message.engineVersion !== "") {
      writer.uint32(18).string(message.engineVersion);
    }
    if (message.seedHash !== "") {
      writer.uint32(26).string(message.seedHash);
    }
    if (message.scriptHash !== "") {
      writer.uint32(34).string(message.scriptHash);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): ScriptSealed {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseScriptSealed();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.engineVersion = reader.string();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.seedHash = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.scriptHash = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<ScriptSealed>, I>>(base?: I): ScriptSealed {
    return ScriptSealed.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<ScriptSealed>, I>>(object: I): ScriptSealed {
    const message = createBaseScriptSealed();
    message.raceId = object.raceId ?? "0";
    message.engineVersion = object.engineVersion ?? "";
    message.seedHash = object.seedHash ?? "";
    message.scriptHash = object.scriptHash ?? "";
    return message;
  },
};

function createBaseScriptFailed(): ScriptFailed {
  return { raceId: "0", reason: "" };
}

export const ScriptFailed: MessageFns<ScriptFailed> = {
  encode(message: ScriptFailed, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.raceId !== "0") {
      writer.uint32(8).int64(message.raceId);
    }
    if (message.reason !== "") {
      writer.uint32(18).string(message.reason);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): ScriptFailed {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseScriptFailed();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.reason = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<ScriptFailed>, I>>(base?: I): ScriptFailed {
    return ScriptFailed.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<ScriptFailed>, I>>(object: I): ScriptFailed {
    const message = createBaseScriptFailed();
    message.raceId = object.raceId ?? "0";
    message.reason = object.reason ?? "";
    return message;
  },
};

function createBaseIncident(): Incident {
  return { seq: 0, tick: 0, type: "", entrantId: undefined, dataJson: "" };
}

export const Incident: MessageFns<Incident> = {
  encode(message: Incident, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.seq !== 0) {
      writer.uint32(8).uint32(message.seq);
    }
    if (message.tick !== 0) {
      writer.uint32(16).uint32(message.tick);
    }
    if (message.type !== "") {
      writer.uint32(26).string(message.type);
    }
    if (message.entrantId !== undefined) {
      writer.uint32(34).string(message.entrantId);
    }
    if (message.dataJson !== "") {
      writer.uint32(42).string(message.dataJson);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): Incident {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseIncident();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.seq = reader.uint32();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.tick = reader.uint32();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.type = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.entrantId = reader.string();
            continue;
          }
          case 5: {
            if (tag !== 42) {
              break;
            }

            message.dataJson = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<Incident>, I>>(base?: I): Incident {
    return Incident.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<Incident>, I>>(object: I): Incident {
    const message = createBaseIncident();
    message.seq = object.seq ?? 0;
    message.tick = object.tick ?? 0;
    message.type = object.type ?? "";
    message.entrantId = object.entrantId ?? undefined;
    message.dataJson = object.dataJson ?? "";
    return message;
  },
};

function createBaseEntrantResult(): EntrantResult {
  return {
    entrantId: "",
    officialPosition: 0,
    asRunPosition: 0,
    resultStatus: "",
    finishTimeMs: undefined,
    distanceCovered: 0,
    lapsLed: [],
  };
}

export const EntrantResult: MessageFns<EntrantResult> = {
  encode(message: EntrantResult, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.entrantId !== "") {
      writer.uint32(10).string(message.entrantId);
    }
    if (message.officialPosition !== 0) {
      writer.uint32(16).uint32(message.officialPosition);
    }
    if (message.asRunPosition !== 0) {
      writer.uint32(24).uint32(message.asRunPosition);
    }
    if (message.resultStatus !== "") {
      writer.uint32(34).string(message.resultStatus);
    }
    if (message.finishTimeMs !== undefined) {
      writer.uint32(40).int64(message.finishTimeMs);
    }
    if (message.distanceCovered !== 0) {
      writer.uint32(49).double(message.distanceCovered);
    }
    if (message.lapsLed.length !== 0) {
      writer.uint32(58).fork();
      for (const v of message.lapsLed) {
        writer.uint32(v);
      }
      writer.join();
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): EntrantResult {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseEntrantResult();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 10) {
              break;
            }

            message.entrantId = reader.string();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.officialPosition = reader.uint32();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.asRunPosition = reader.uint32();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.resultStatus = reader.string();
            continue;
          }
          case 5: {
            if (tag !== 40) {
              break;
            }

            message.finishTimeMs = reader.int64().toString();
            continue;
          }
          case 6: {
            if (tag !== 49) {
              break;
            }

            message.distanceCovered = reader.double();
            continue;
          }
          case 7: {
            if (tag === 56) {
              message.lapsLed.push(reader.uint32());

              continue;
            }

            if (tag === 58) {
              const end2 = reader.uint32() + reader.pos;
              while (reader.pos < end2) {
                message.lapsLed.push(reader.uint32());
              }

              continue;
            }

            break;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<EntrantResult>, I>>(base?: I): EntrantResult {
    return EntrantResult.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<EntrantResult>, I>>(object: I): EntrantResult {
    const message = createBaseEntrantResult();
    message.entrantId = object.entrantId ?? "";
    message.officialPosition = object.officialPosition ?? 0;
    message.asRunPosition = object.asRunPosition ?? 0;
    message.resultStatus = object.resultStatus ?? "";
    message.finishTimeMs = object.finishTimeMs ?? undefined;
    message.distanceCovered = object.distanceCovered ?? 0;
    message.lapsLed = object.lapsLed?.map((e) => e) || [];
    return message;
  },
};

function createBaseLapLeader(): LapLeader {
  return { lap: 0, entrantId: "", tick: 0 };
}

export const LapLeader: MessageFns<LapLeader> = {
  encode(message: LapLeader, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.lap !== 0) {
      writer.uint32(8).uint32(message.lap);
    }
    if (message.entrantId !== "") {
      writer.uint32(18).string(message.entrantId);
    }
    if (message.tick !== 0) {
      writer.uint32(24).uint32(message.tick);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): LapLeader {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseLapLeader();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.lap = reader.uint32();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.entrantId = reader.string();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.tick = reader.uint32();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<LapLeader>, I>>(base?: I): LapLeader {
    return LapLeader.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<LapLeader>, I>>(object: I): LapLeader {
    const message = createBaseLapLeader();
    message.lap = object.lap ?? 0;
    message.entrantId = object.entrantId ?? "";
    message.tick = object.tick ?? 0;
    return message;
  },
};

function createBaseRaceFinished(): RaceFinished {
  return {
    raceId: "0",
    finishTick: 0,
    order: [],
    asRun: [],
    incidents: [],
    seed: "",
    results: [],
    lapLeaders: [],
    finishedAt: "",
  };
}

export const RaceFinished: MessageFns<RaceFinished> = {
  encode(message: RaceFinished, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.raceId !== "0") {
      writer.uint32(8).int64(message.raceId);
    }
    if (message.finishTick !== 0) {
      writer.uint32(16).uint32(message.finishTick);
    }
    for (const v of message.order) {
      writer.uint32(26).string(v!);
    }
    for (const v of message.asRun) {
      writer.uint32(34).string(v!);
    }
    for (const v of message.incidents) {
      Incident.encode(v!, writer.uint32(42).fork()).join();
    }
    if (message.seed !== "") {
      writer.uint32(50).string(message.seed);
    }
    for (const v of message.results) {
      EntrantResult.encode(v!, writer.uint32(58).fork()).join();
    }
    for (const v of message.lapLeaders) {
      LapLeader.encode(v!, writer.uint32(66).fork()).join();
    }
    if (message.finishedAt !== "") {
      writer.uint32(74).string(message.finishedAt);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): RaceFinished {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseRaceFinished();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.finishTick = reader.uint32();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.order.push(reader.string());
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.asRun.push(reader.string());
            continue;
          }
          case 5: {
            if (tag !== 42) {
              break;
            }

            message.incidents.push(Incident.decode(reader, reader.uint32()));
            continue;
          }
          case 6: {
            if (tag !== 50) {
              break;
            }

            message.seed = reader.string();
            continue;
          }
          case 7: {
            if (tag !== 58) {
              break;
            }

            message.results.push(EntrantResult.decode(reader, reader.uint32()));
            continue;
          }
          case 8: {
            if (tag !== 66) {
              break;
            }

            message.lapLeaders.push(LapLeader.decode(reader, reader.uint32()));
            continue;
          }
          case 9: {
            if (tag !== 74) {
              break;
            }

            message.finishedAt = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<RaceFinished>, I>>(base?: I): RaceFinished {
    return RaceFinished.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<RaceFinished>, I>>(object: I): RaceFinished {
    const message = createBaseRaceFinished();
    message.raceId = object.raceId ?? "0";
    message.finishTick = object.finishTick ?? 0;
    message.order = object.order?.map((e) => e) || [];
    message.asRun = object.asRun?.map((e) => e) || [];
    message.incidents = object.incidents?.map((e) => Incident.fromPartial(e)) || [];
    message.seed = object.seed ?? "";
    message.results = object.results?.map((e) => EntrantResult.fromPartial(e)) || [];
    message.lapLeaders = object.lapLeaders?.map((e) => LapLeader.fromPartial(e)) || [];
    message.finishedAt = object.finishedAt ?? "";
    return message;
  },
};

function createBaseRaceSettled(): RaceSettled {
  return { raceId: "0" };
}

export const RaceSettled: MessageFns<RaceSettled> = {
  encode(message: RaceSettled, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.raceId !== "0") {
      writer.uint32(8).int64(message.raceId);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): RaceSettled {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseRaceSettled();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<RaceSettled>, I>>(base?: I): RaceSettled {
    return RaceSettled.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<RaceSettled>, I>>(object: I): RaceSettled {
    const message = createBaseRaceSettled();
    message.raceId = object.raceId ?? "0";
    return message;
  },
};

function createBaseRaceCancelled(): RaceCancelled {
  return { raceId: "0", reason: "" };
}

export const RaceCancelled: MessageFns<RaceCancelled> = {
  encode(message: RaceCancelled, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.raceId !== "0") {
      writer.uint32(8).int64(message.raceId);
    }
    if (message.reason !== "") {
      writer.uint32(18).string(message.reason);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): RaceCancelled {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseRaceCancelled();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.reason = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<RaceCancelled>, I>>(base?: I): RaceCancelled {
    return RaceCancelled.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<RaceCancelled>, I>>(object: I): RaceCancelled {
    const message = createBaseRaceCancelled();
    message.raceId = object.raceId ?? "0";
    message.reason = object.reason ?? "";
    return message;
  },
};

function createBaseGenerateScript(): GenerateScript {
  return { raceId: "0", engineVersion: "", venueId: "", venueVersion: 0, laps: 0, entrants: [], species: "" };
}

export const GenerateScript: MessageFns<GenerateScript> = {
  encode(message: GenerateScript, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.raceId !== "0") {
      writer.uint32(8).int64(message.raceId);
    }
    if (message.engineVersion !== "") {
      writer.uint32(18).string(message.engineVersion);
    }
    if (message.venueId !== "") {
      writer.uint32(26).string(message.venueId);
    }
    if (message.venueVersion !== 0) {
      writer.uint32(32).uint32(message.venueVersion);
    }
    if (message.laps !== 0) {
      writer.uint32(40).uint32(message.laps);
    }
    for (const v of message.entrants) {
      EntrantInfo.encode(v!, writer.uint32(50).fork()).join();
    }
    if (message.species !== "") {
      writer.uint32(58).string(message.species);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): GenerateScript {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseGenerateScript();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.engineVersion = reader.string();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.venueId = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 32) {
              break;
            }

            message.venueVersion = reader.uint32();
            continue;
          }
          case 5: {
            if (tag !== 40) {
              break;
            }

            message.laps = reader.uint32();
            continue;
          }
          case 6: {
            if (tag !== 50) {
              break;
            }

            message.entrants.push(EntrantInfo.decode(reader, reader.uint32()));
            continue;
          }
          case 7: {
            if (tag !== 58) {
              break;
            }

            message.species = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<GenerateScript>, I>>(base?: I): GenerateScript {
    return GenerateScript.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<GenerateScript>, I>>(object: I): GenerateScript {
    const message = createBaseGenerateScript();
    message.raceId = object.raceId ?? "0";
    message.engineVersion = object.engineVersion ?? "";
    message.venueId = object.venueId ?? "";
    message.venueVersion = object.venueVersion ?? 0;
    message.laps = object.laps ?? 0;
    message.entrants = object.entrants?.map((e) => EntrantInfo.fromPartial(e)) || [];
    message.species = object.species ?? "";
    return message;
  },
};

function createBaseScheduleRace(): ScheduleRace {
  return {
    raceId: "0",
    startAt: "",
    species: "",
    raceClass: "",
    venueId: undefined,
    fieldSize: undefined,
    adminUserId: "0",
  };
}

export const ScheduleRace: MessageFns<ScheduleRace> = {
  encode(message: ScheduleRace, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.raceId !== "0") {
      writer.uint32(8).int64(message.raceId);
    }
    if (message.startAt !== "") {
      writer.uint32(18).string(message.startAt);
    }
    if (message.species !== "") {
      writer.uint32(26).string(message.species);
    }
    if (message.raceClass !== "") {
      writer.uint32(34).string(message.raceClass);
    }
    if (message.venueId !== undefined) {
      writer.uint32(42).string(message.venueId);
    }
    if (message.fieldSize !== undefined) {
      writer.uint32(48).uint32(message.fieldSize);
    }
    if (message.adminUserId !== "0") {
      writer.uint32(56).int64(message.adminUserId);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): ScheduleRace {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseScheduleRace();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.startAt = reader.string();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.species = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.raceClass = reader.string();
            continue;
          }
          case 5: {
            if (tag !== 42) {
              break;
            }

            message.venueId = reader.string();
            continue;
          }
          case 6: {
            if (tag !== 48) {
              break;
            }

            message.fieldSize = reader.uint32();
            continue;
          }
          case 7: {
            if (tag !== 56) {
              break;
            }

            message.adminUserId = reader.int64().toString();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<ScheduleRace>, I>>(base?: I): ScheduleRace {
    return ScheduleRace.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<ScheduleRace>, I>>(object: I): ScheduleRace {
    const message = createBaseScheduleRace();
    message.raceId = object.raceId ?? "0";
    message.startAt = object.startAt ?? "";
    message.species = object.species ?? "";
    message.raceClass = object.raceClass ?? "";
    message.venueId = object.venueId ?? undefined;
    message.fieldSize = object.fieldSize ?? undefined;
    message.adminUserId = object.adminUserId ?? "0";
    return message;
  },
};

function createBaseCancelRace(): CancelRace {
  return { raceId: "0", reason: "", adminUserId: "0" };
}

export const CancelRace: MessageFns<CancelRace> = {
  encode(message: CancelRace, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.raceId !== "0") {
      writer.uint32(8).int64(message.raceId);
    }
    if (message.reason !== "") {
      writer.uint32(18).string(message.reason);
    }
    if (message.adminUserId !== "0") {
      writer.uint32(24).int64(message.adminUserId);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): CancelRace {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseCancelRace();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.reason = reader.string();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.adminUserId = reader.int64().toString();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<CancelRace>, I>>(base?: I): CancelRace {
    return CancelRace.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<CancelRace>, I>>(object: I): CancelRace {
    const message = createBaseCancelRace();
    message.raceId = object.raceId ?? "0";
    message.reason = object.reason ?? "";
    message.adminUserId = object.adminUserId ?? "0";
    return message;
  },
};

function createBaseMarketCommand(): MarketCommand {
  return { marketId: "0", raceId: "0", action: "", reason: "", adminUserId: "0" };
}

export const MarketCommand: MessageFns<MarketCommand> = {
  encode(message: MarketCommand, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.marketId !== "0") {
      writer.uint32(8).int64(message.marketId);
    }
    if (message.raceId !== "0") {
      writer.uint32(16).int64(message.raceId);
    }
    if (message.action !== "") {
      writer.uint32(26).string(message.action);
    }
    if (message.reason !== "") {
      writer.uint32(34).string(message.reason);
    }
    if (message.adminUserId !== "0") {
      writer.uint32(40).int64(message.adminUserId);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): MarketCommand {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseMarketCommand();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.marketId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.action = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.reason = reader.string();
            continue;
          }
          case 5: {
            if (tag !== 40) {
              break;
            }

            message.adminUserId = reader.int64().toString();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<MarketCommand>, I>>(base?: I): MarketCommand {
    return MarketCommand.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<MarketCommand>, I>>(object: I): MarketCommand {
    const message = createBaseMarketCommand();
    message.marketId = object.marketId ?? "0";
    message.raceId = object.raceId ?? "0";
    message.action = object.action ?? "";
    message.reason = object.reason ?? "";
    message.adminUserId = object.adminUserId ?? "0";
    return message;
  },
};

function createBaseTickEntrant(): TickEntrant {
  return { id: "", dist: 0, lane: 0, speed: 0, staminaPct: 0, state: "", pos: 0 };
}

export const TickEntrant: MessageFns<TickEntrant> = {
  encode(message: TickEntrant, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.id !== "") {
      writer.uint32(10).string(message.id);
    }
    if (message.dist !== 0) {
      writer.uint32(17).double(message.dist);
    }
    if (message.lane !== 0) {
      writer.uint32(25).double(message.lane);
    }
    if (message.speed !== 0) {
      writer.uint32(33).double(message.speed);
    }
    if (message.staminaPct !== 0) {
      writer.uint32(41).double(message.staminaPct);
    }
    if (message.state !== "") {
      writer.uint32(50).string(message.state);
    }
    if (message.pos !== 0) {
      writer.uint32(56).uint32(message.pos);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): TickEntrant {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseTickEntrant();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 10) {
              break;
            }

            message.id = reader.string();
            continue;
          }
          case 2: {
            if (tag !== 17) {
              break;
            }

            message.dist = reader.double();
            continue;
          }
          case 3: {
            if (tag !== 25) {
              break;
            }

            message.lane = reader.double();
            continue;
          }
          case 4: {
            if (tag !== 33) {
              break;
            }

            message.speed = reader.double();
            continue;
          }
          case 5: {
            if (tag !== 41) {
              break;
            }

            message.staminaPct = reader.double();
            continue;
          }
          case 6: {
            if (tag !== 50) {
              break;
            }

            message.state = reader.string();
            continue;
          }
          case 7: {
            if (tag !== 56) {
              break;
            }

            message.pos = reader.uint32();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<TickEntrant>, I>>(base?: I): TickEntrant {
    return TickEntrant.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<TickEntrant>, I>>(object: I): TickEntrant {
    const message = createBaseTickEntrant();
    message.id = object.id ?? "";
    message.dist = object.dist ?? 0;
    message.lane = object.lane ?? 0;
    message.speed = object.speed ?? 0;
    message.staminaPct = object.staminaPct ?? 0;
    message.state = object.state ?? "";
    message.pos = object.pos ?? 0;
    return message;
  },
};

function createBaseTickEvent(): TickEvent {
  return { type: "", id: undefined, a: undefined, b: undefined, lap: undefined, pos: undefined };
}

export const TickEvent: MessageFns<TickEvent> = {
  encode(message: TickEvent, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.type !== "") {
      writer.uint32(10).string(message.type);
    }
    if (message.id !== undefined) {
      writer.uint32(18).string(message.id);
    }
    if (message.a !== undefined) {
      writer.uint32(26).string(message.a);
    }
    if (message.b !== undefined) {
      writer.uint32(34).string(message.b);
    }
    if (message.lap !== undefined) {
      writer.uint32(40).uint32(message.lap);
    }
    if (message.pos !== undefined) {
      writer.uint32(48).uint32(message.pos);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): TickEvent {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseTickEvent();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 10) {
              break;
            }

            message.type = reader.string();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.id = reader.string();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.a = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.b = reader.string();
            continue;
          }
          case 5: {
            if (tag !== 40) {
              break;
            }

            message.lap = reader.uint32();
            continue;
          }
          case 6: {
            if (tag !== 48) {
              break;
            }

            message.pos = reader.uint32();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<TickEvent>, I>>(base?: I): TickEvent {
    return TickEvent.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<TickEvent>, I>>(object: I): TickEvent {
    const message = createBaseTickEvent();
    message.type = object.type ?? "";
    message.id = object.id ?? undefined;
    message.a = object.a ?? undefined;
    message.b = object.b ?? undefined;
    message.lap = object.lap ?? undefined;
    message.pos = object.pos ?? undefined;
    return message;
  },
};

function createBaseRaceTick(): RaceTick {
  return { raceId: "0", tick: 0, lap: 0, entrants: [], events: [] };
}

export const RaceTick: MessageFns<RaceTick> = {
  encode(message: RaceTick, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.raceId !== "0") {
      writer.uint32(8).int64(message.raceId);
    }
    if (message.tick !== 0) {
      writer.uint32(16).uint32(message.tick);
    }
    if (message.lap !== 0) {
      writer.uint32(24).uint32(message.lap);
    }
    for (const v of message.entrants) {
      TickEntrant.encode(v!, writer.uint32(34).fork()).join();
    }
    for (const v of message.events) {
      TickEvent.encode(v!, writer.uint32(42).fork()).join();
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): RaceTick {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseRaceTick();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.tick = reader.uint32();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.lap = reader.uint32();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.entrants.push(TickEntrant.decode(reader, reader.uint32()));
            continue;
          }
          case 5: {
            if (tag !== 42) {
              break;
            }

            message.events.push(TickEvent.decode(reader, reader.uint32()));
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<RaceTick>, I>>(base?: I): RaceTick {
    return RaceTick.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<RaceTick>, I>>(object: I): RaceTick {
    const message = createBaseRaceTick();
    message.raceId = object.raceId ?? "0";
    message.tick = object.tick ?? 0;
    message.lap = object.lap ?? 0;
    message.entrants = object.entrants?.map((e) => TickEntrant.fromPartial(e)) || [];
    message.events = object.events?.map((e) => TickEvent.fromPartial(e)) || [];
    return message;
  },
};

function createBaseLapCompleted(): LapCompleted {
  return { raceId: "0", tick: 0, lap: 0, leaderEntrantId: "", standings: [] };
}

export const LapCompleted: MessageFns<LapCompleted> = {
  encode(message: LapCompleted, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.raceId !== "0") {
      writer.uint32(8).int64(message.raceId);
    }
    if (message.tick !== 0) {
      writer.uint32(16).uint32(message.tick);
    }
    if (message.lap !== 0) {
      writer.uint32(24).uint32(message.lap);
    }
    if (message.leaderEntrantId !== "") {
      writer.uint32(34).string(message.leaderEntrantId);
    }
    for (const v of message.standings) {
      writer.uint32(42).string(v!);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): LapCompleted {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseLapCompleted();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.tick = reader.uint32();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.lap = reader.uint32();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.leaderEntrantId = reader.string();
            continue;
          }
          case 5: {
            if (tag !== 42) {
              break;
            }

            message.standings.push(reader.string());
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<LapCompleted>, I>>(base?: I): LapCompleted {
    return LapCompleted.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<LapCompleted>, I>>(object: I): LapCompleted {
    const message = createBaseLapCompleted();
    message.raceId = object.raceId ?? "0";
    message.tick = object.tick ?? 0;
    message.lap = object.lap ?? 0;
    message.leaderEntrantId = object.leaderEntrantId ?? "";
    message.standings = object.standings?.map((e) => e) || [];
    return message;
  },
};

function createBaseSelectionPrice(): SelectionPrice {
  return { selectionId: "0", entrantId: "", price: 0, probability: 0 };
}

export const SelectionPrice: MessageFns<SelectionPrice> = {
  encode(message: SelectionPrice, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.selectionId !== "0") {
      writer.uint32(8).int64(message.selectionId);
    }
    if (message.entrantId !== "") {
      writer.uint32(18).string(message.entrantId);
    }
    if (message.price !== 0) {
      writer.uint32(25).double(message.price);
    }
    if (message.probability !== 0) {
      writer.uint32(33).double(message.probability);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): SelectionPrice {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseSelectionPrice();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.selectionId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.entrantId = reader.string();
            continue;
          }
          case 3: {
            if (tag !== 25) {
              break;
            }

            message.price = reader.double();
            continue;
          }
          case 4: {
            if (tag !== 33) {
              break;
            }

            message.probability = reader.double();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<SelectionPrice>, I>>(base?: I): SelectionPrice {
    return SelectionPrice.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<SelectionPrice>, I>>(object: I): SelectionPrice {
    const message = createBaseSelectionPrice();
    message.selectionId = object.selectionId ?? "0";
    message.entrantId = object.entrantId ?? "";
    message.price = object.price ?? 0;
    message.probability = object.probability ?? 0;
    return message;
  },
};

function createBaseMarketOpened(): MarketOpened {
  return { marketId: "0", raceId: "0", type: "", params: {}, selections: [], priceVersion: 0, closesAtLap: undefined };
}

export const MarketOpened: MessageFns<MarketOpened> = {
  encode(message: MarketOpened, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.marketId !== "0") {
      writer.uint32(8).int64(message.marketId);
    }
    if (message.raceId !== "0") {
      writer.uint32(16).int64(message.raceId);
    }
    if (message.type !== "") {
      writer.uint32(26).string(message.type);
    }
    globalThis.Object.entries(message.params).forEach(([key, value]: [string, number]) => {
      MarketOpened_ParamsEntry.encode({ key: key as any, value }, writer.uint32(34).fork()).join();
    });
    for (const v of message.selections) {
      SelectionPrice.encode(v!, writer.uint32(42).fork()).join();
    }
    if (message.priceVersion !== 0) {
      writer.uint32(48).uint32(message.priceVersion);
    }
    if (message.closesAtLap !== undefined) {
      writer.uint32(56).uint32(message.closesAtLap);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): MarketOpened {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseMarketOpened();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.marketId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.type = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            const entry4 = MarketOpened_ParamsEntry.decode(reader, reader.uint32());
            if (entry4.value !== undefined) {
              message.params[entry4.key] = entry4.value;
            }
            continue;
          }
          case 5: {
            if (tag !== 42) {
              break;
            }

            message.selections.push(SelectionPrice.decode(reader, reader.uint32()));
            continue;
          }
          case 6: {
            if (tag !== 48) {
              break;
            }

            message.priceVersion = reader.uint32();
            continue;
          }
          case 7: {
            if (tag !== 56) {
              break;
            }

            message.closesAtLap = reader.uint32();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<MarketOpened>, I>>(base?: I): MarketOpened {
    return MarketOpened.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<MarketOpened>, I>>(object: I): MarketOpened {
    const message = createBaseMarketOpened();
    message.marketId = object.marketId ?? "0";
    message.raceId = object.raceId ?? "0";
    message.type = object.type ?? "";
    message.params = (globalThis.Object.entries(object.params ?? {}) as [string, number][]).reduce(
      (acc: { [key: string]: number }, [key, value]: [string, number]) => {
        if (value !== undefined) {
          acc[key] = globalThis.Number(value);
        }
        return acc;
      },
      {},
    );
    message.selections = object.selections?.map((e) => SelectionPrice.fromPartial(e)) || [];
    message.priceVersion = object.priceVersion ?? 0;
    message.closesAtLap = object.closesAtLap ?? undefined;
    return message;
  },
};

function createBaseMarketOpened_ParamsEntry(): MarketOpened_ParamsEntry {
  return { key: "", value: 0 };
}

export const MarketOpened_ParamsEntry: MessageFns<MarketOpened_ParamsEntry> = {
  encode(message: MarketOpened_ParamsEntry, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.key !== "") {
      writer.uint32(10).string(message.key);
    }
    if (message.value !== 0) {
      writer.uint32(16).int32(message.value);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): MarketOpened_ParamsEntry {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseMarketOpened_ParamsEntry();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 10) {
              break;
            }

            message.key = reader.string();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.value = reader.int32();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<MarketOpened_ParamsEntry>, I>>(base?: I): MarketOpened_ParamsEntry {
    return MarketOpened_ParamsEntry.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<MarketOpened_ParamsEntry>, I>>(object: I): MarketOpened_ParamsEntry {
    const message = createBaseMarketOpened_ParamsEntry();
    message.key = object.key ?? "";
    message.value = object.value ?? 0;
    return message;
  },
};

function createBasePriceUpdated(): PriceUpdated {
  return { marketId: "0", raceId: "0", tick: 0, priceVersion: 0, selections: [] };
}

export const PriceUpdated: MessageFns<PriceUpdated> = {
  encode(message: PriceUpdated, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.marketId !== "0") {
      writer.uint32(8).int64(message.marketId);
    }
    if (message.raceId !== "0") {
      writer.uint32(16).int64(message.raceId);
    }
    if (message.tick !== 0) {
      writer.uint32(24).uint32(message.tick);
    }
    if (message.priceVersion !== 0) {
      writer.uint32(32).uint32(message.priceVersion);
    }
    for (const v of message.selections) {
      SelectionPrice.encode(v!, writer.uint32(42).fork()).join();
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): PriceUpdated {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBasePriceUpdated();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.marketId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.tick = reader.uint32();
            continue;
          }
          case 4: {
            if (tag !== 32) {
              break;
            }

            message.priceVersion = reader.uint32();
            continue;
          }
          case 5: {
            if (tag !== 42) {
              break;
            }

            message.selections.push(SelectionPrice.decode(reader, reader.uint32()));
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<PriceUpdated>, I>>(base?: I): PriceUpdated {
    return PriceUpdated.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<PriceUpdated>, I>>(object: I): PriceUpdated {
    const message = createBasePriceUpdated();
    message.marketId = object.marketId ?? "0";
    message.raceId = object.raceId ?? "0";
    message.tick = object.tick ?? 0;
    message.priceVersion = object.priceVersion ?? 0;
    message.selections = object.selections?.map((e) => SelectionPrice.fromPartial(e)) || [];
    return message;
  },
};

function createBaseMarketSuspended(): MarketSuspended {
  return { marketId: "0", raceId: "0", tick: 0, reason: "" };
}

export const MarketSuspended: MessageFns<MarketSuspended> = {
  encode(message: MarketSuspended, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.marketId !== "0") {
      writer.uint32(8).int64(message.marketId);
    }
    if (message.raceId !== "0") {
      writer.uint32(16).int64(message.raceId);
    }
    if (message.tick !== 0) {
      writer.uint32(24).uint32(message.tick);
    }
    if (message.reason !== "") {
      writer.uint32(34).string(message.reason);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): MarketSuspended {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseMarketSuspended();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.marketId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.tick = reader.uint32();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.reason = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<MarketSuspended>, I>>(base?: I): MarketSuspended {
    return MarketSuspended.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<MarketSuspended>, I>>(object: I): MarketSuspended {
    const message = createBaseMarketSuspended();
    message.marketId = object.marketId ?? "0";
    message.raceId = object.raceId ?? "0";
    message.tick = object.tick ?? 0;
    message.reason = object.reason ?? "";
    return message;
  },
};

function createBaseMarketResumed(): MarketResumed {
  return { marketId: "0", raceId: "0", tick: 0, priceVersion: 0 };
}

export const MarketResumed: MessageFns<MarketResumed> = {
  encode(message: MarketResumed, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.marketId !== "0") {
      writer.uint32(8).int64(message.marketId);
    }
    if (message.raceId !== "0") {
      writer.uint32(16).int64(message.raceId);
    }
    if (message.tick !== 0) {
      writer.uint32(24).uint32(message.tick);
    }
    if (message.priceVersion !== 0) {
      writer.uint32(32).uint32(message.priceVersion);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): MarketResumed {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseMarketResumed();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.marketId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.tick = reader.uint32();
            continue;
          }
          case 4: {
            if (tag !== 32) {
              break;
            }

            message.priceVersion = reader.uint32();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<MarketResumed>, I>>(base?: I): MarketResumed {
    return MarketResumed.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<MarketResumed>, I>>(object: I): MarketResumed {
    const message = createBaseMarketResumed();
    message.marketId = object.marketId ?? "0";
    message.raceId = object.raceId ?? "0";
    message.tick = object.tick ?? 0;
    message.priceVersion = object.priceVersion ?? 0;
    return message;
  },
};

function createBaseMarketClosed(): MarketClosed {
  return { marketId: "0", raceId: "0", tick: 0 };
}

export const MarketClosed: MessageFns<MarketClosed> = {
  encode(message: MarketClosed, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.marketId !== "0") {
      writer.uint32(8).int64(message.marketId);
    }
    if (message.raceId !== "0") {
      writer.uint32(16).int64(message.raceId);
    }
    if (message.tick !== 0) {
      writer.uint32(24).uint32(message.tick);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): MarketClosed {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseMarketClosed();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.marketId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.tick = reader.uint32();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<MarketClosed>, I>>(base?: I): MarketClosed {
    return MarketClosed.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<MarketClosed>, I>>(object: I): MarketClosed {
    const message = createBaseMarketClosed();
    message.marketId = object.marketId ?? "0";
    message.raceId = object.raceId ?? "0";
    message.tick = object.tick ?? 0;
    return message;
  },
};

function createBaseMarketResulted(): MarketResulted {
  return { marketId: "0", raceId: "0", winning: [], order: [] };
}

export const MarketResulted: MessageFns<MarketResulted> = {
  encode(message: MarketResulted, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.marketId !== "0") {
      writer.uint32(8).int64(message.marketId);
    }
    if (message.raceId !== "0") {
      writer.uint32(16).int64(message.raceId);
    }
    if (message.winning.length !== 0) {
      writer.uint32(26).fork();
      for (const v of message.winning) {
        writer.int64(v);
      }
      writer.join();
    }
    for (const v of message.order) {
      writer.uint32(34).string(v!);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): MarketResulted {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseMarketResulted();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.marketId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag === 24) {
              message.winning.push(reader.int64().toString());

              continue;
            }

            if (tag === 26) {
              const end2 = reader.uint32() + reader.pos;
              while (reader.pos < end2) {
                message.winning.push(reader.int64().toString());
              }

              continue;
            }

            break;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.order.push(reader.string());
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<MarketResulted>, I>>(base?: I): MarketResulted {
    return MarketResulted.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<MarketResulted>, I>>(object: I): MarketResulted {
    const message = createBaseMarketResulted();
    message.marketId = object.marketId ?? "0";
    message.raceId = object.raceId ?? "0";
    message.winning = object.winning?.map((e) => e) || [];
    message.order = object.order?.map((e) => e) || [];
    return message;
  },
};

function createBaseMarketVoided(): MarketVoided {
  return { marketId: "0", raceId: "0", reason: "" };
}

export const MarketVoided: MessageFns<MarketVoided> = {
  encode(message: MarketVoided, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.marketId !== "0") {
      writer.uint32(8).int64(message.marketId);
    }
    if (message.raceId !== "0") {
      writer.uint32(16).int64(message.raceId);
    }
    if (message.reason !== "") {
      writer.uint32(26).string(message.reason);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): MarketVoided {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseMarketVoided();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.marketId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.reason = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<MarketVoided>, I>>(base?: I): MarketVoided {
    return MarketVoided.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<MarketVoided>, I>>(object: I): MarketVoided {
    const message = createBaseMarketVoided();
    message.marketId = object.marketId ?? "0";
    message.raceId = object.raceId ?? "0";
    message.reason = object.reason ?? "";
    return message;
  },
};

function createBaseBetSelection(): BetSelection {
  return { entrantId: undefined, order: [] };
}

export const BetSelection: MessageFns<BetSelection> = {
  encode(message: BetSelection, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.entrantId !== undefined) {
      writer.uint32(10).string(message.entrantId);
    }
    for (const v of message.order) {
      writer.uint32(18).string(v!);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): BetSelection {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseBetSelection();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 10) {
              break;
            }

            message.entrantId = reader.string();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.order.push(reader.string());
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<BetSelection>, I>>(base?: I): BetSelection {
    return BetSelection.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<BetSelection>, I>>(object: I): BetSelection {
    const message = createBaseBetSelection();
    message.entrantId = object.entrantId ?? undefined;
    message.order = object.order?.map((e) => e) || [];
    return message;
  },
};

function createBaseBetRequested(): BetRequested {
  return {
    betId: "0",
    userId: "0",
    marketId: "0",
    selection: undefined,
    stake: "0",
    acceptedPrice: 0,
    priceVersion: 0,
    acceptPriceChanges: "",
    requestedAtTick: undefined,
    acceptAtTick: undefined,
    raceId: "0",
    seasonId: "0",
    acceptAtMs: "0",
  };
}

export const BetRequested: MessageFns<BetRequested> = {
  encode(message: BetRequested, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.betId !== "0") {
      writer.uint32(8).int64(message.betId);
    }
    if (message.userId !== "0") {
      writer.uint32(16).int64(message.userId);
    }
    if (message.marketId !== "0") {
      writer.uint32(24).int64(message.marketId);
    }
    if (message.selection !== undefined) {
      BetSelection.encode(message.selection, writer.uint32(34).fork()).join();
    }
    if (message.stake !== "0") {
      writer.uint32(40).int64(message.stake);
    }
    if (message.acceptedPrice !== 0) {
      writer.uint32(49).double(message.acceptedPrice);
    }
    if (message.priceVersion !== 0) {
      writer.uint32(56).uint32(message.priceVersion);
    }
    if (message.acceptPriceChanges !== "") {
      writer.uint32(66).string(message.acceptPriceChanges);
    }
    if (message.requestedAtTick !== undefined) {
      writer.uint32(72).uint32(message.requestedAtTick);
    }
    if (message.acceptAtTick !== undefined) {
      writer.uint32(80).uint32(message.acceptAtTick);
    }
    if (message.raceId !== "0") {
      writer.uint32(88).int64(message.raceId);
    }
    if (message.seasonId !== "0") {
      writer.uint32(96).int64(message.seasonId);
    }
    if (message.acceptAtMs !== "0") {
      writer.uint32(104).int64(message.acceptAtMs);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): BetRequested {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseBetRequested();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.betId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.userId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.marketId = reader.int64().toString();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.selection = BetSelection.decode(reader, reader.uint32());
            continue;
          }
          case 5: {
            if (tag !== 40) {
              break;
            }

            message.stake = reader.int64().toString();
            continue;
          }
          case 6: {
            if (tag !== 49) {
              break;
            }

            message.acceptedPrice = reader.double();
            continue;
          }
          case 7: {
            if (tag !== 56) {
              break;
            }

            message.priceVersion = reader.uint32();
            continue;
          }
          case 8: {
            if (tag !== 66) {
              break;
            }

            message.acceptPriceChanges = reader.string();
            continue;
          }
          case 9: {
            if (tag !== 72) {
              break;
            }

            message.requestedAtTick = reader.uint32();
            continue;
          }
          case 10: {
            if (tag !== 80) {
              break;
            }

            message.acceptAtTick = reader.uint32();
            continue;
          }
          case 11: {
            if (tag !== 88) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 12: {
            if (tag !== 96) {
              break;
            }

            message.seasonId = reader.int64().toString();
            continue;
          }
          case 13: {
            if (tag !== 104) {
              break;
            }

            message.acceptAtMs = reader.int64().toString();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<BetRequested>, I>>(base?: I): BetRequested {
    return BetRequested.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<BetRequested>, I>>(object: I): BetRequested {
    const message = createBaseBetRequested();
    message.betId = object.betId ?? "0";
    message.userId = object.userId ?? "0";
    message.marketId = object.marketId ?? "0";
    message.selection = (object.selection !== undefined && object.selection !== null)
      ? BetSelection.fromPartial(object.selection)
      : undefined;
    message.stake = object.stake ?? "0";
    message.acceptedPrice = object.acceptedPrice ?? 0;
    message.priceVersion = object.priceVersion ?? 0;
    message.acceptPriceChanges = object.acceptPriceChanges ?? "";
    message.requestedAtTick = object.requestedAtTick ?? undefined;
    message.acceptAtTick = object.acceptAtTick ?? undefined;
    message.raceId = object.raceId ?? "0";
    message.seasonId = object.seasonId ?? "0";
    message.acceptAtMs = object.acceptAtMs ?? "0";
    return message;
  },
};

function createBaseComboLeg(): ComboLeg {
  return { legNo: 0, marketId: "0", raceId: "0", selection: undefined, acceptedPrice: 0, priceVersion: 0 };
}

export const ComboLeg: MessageFns<ComboLeg> = {
  encode(message: ComboLeg, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.legNo !== 0) {
      writer.uint32(8).uint32(message.legNo);
    }
    if (message.marketId !== "0") {
      writer.uint32(16).int64(message.marketId);
    }
    if (message.raceId !== "0") {
      writer.uint32(24).int64(message.raceId);
    }
    if (message.selection !== undefined) {
      BetSelection.encode(message.selection, writer.uint32(34).fork()).join();
    }
    if (message.acceptedPrice !== 0) {
      writer.uint32(41).double(message.acceptedPrice);
    }
    if (message.priceVersion !== 0) {
      writer.uint32(48).uint32(message.priceVersion);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): ComboLeg {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseComboLeg();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.legNo = reader.uint32();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.marketId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.selection = BetSelection.decode(reader, reader.uint32());
            continue;
          }
          case 5: {
            if (tag !== 41) {
              break;
            }

            message.acceptedPrice = reader.double();
            continue;
          }
          case 6: {
            if (tag !== 48) {
              break;
            }

            message.priceVersion = reader.uint32();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<ComboLeg>, I>>(base?: I): ComboLeg {
    return ComboLeg.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<ComboLeg>, I>>(object: I): ComboLeg {
    const message = createBaseComboLeg();
    message.legNo = object.legNo ?? 0;
    message.marketId = object.marketId ?? "0";
    message.raceId = object.raceId ?? "0";
    message.selection = (object.selection !== undefined && object.selection !== null)
      ? BetSelection.fromPartial(object.selection)
      : undefined;
    message.acceptedPrice = object.acceptedPrice ?? 0;
    message.priceVersion = object.priceVersion ?? 0;
    return message;
  },
};

function createBaseComboRequested(): ComboRequested {
  return {
    betId: "0",
    userId: "0",
    legs: [],
    stake: "0",
    acceptPriceChanges: "",
    acceptAtTick: undefined,
    seasonId: "0",
    acceptAtMs: "0",
  };
}

export const ComboRequested: MessageFns<ComboRequested> = {
  encode(message: ComboRequested, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.betId !== "0") {
      writer.uint32(8).int64(message.betId);
    }
    if (message.userId !== "0") {
      writer.uint32(16).int64(message.userId);
    }
    for (const v of message.legs) {
      ComboLeg.encode(v!, writer.uint32(26).fork()).join();
    }
    if (message.stake !== "0") {
      writer.uint32(32).int64(message.stake);
    }
    if (message.acceptPriceChanges !== "") {
      writer.uint32(42).string(message.acceptPriceChanges);
    }
    if (message.acceptAtTick !== undefined) {
      writer.uint32(48).uint32(message.acceptAtTick);
    }
    if (message.seasonId !== "0") {
      writer.uint32(56).int64(message.seasonId);
    }
    if (message.acceptAtMs !== "0") {
      writer.uint32(64).int64(message.acceptAtMs);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): ComboRequested {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseComboRequested();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.betId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.userId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.legs.push(ComboLeg.decode(reader, reader.uint32()));
            continue;
          }
          case 4: {
            if (tag !== 32) {
              break;
            }

            message.stake = reader.int64().toString();
            continue;
          }
          case 5: {
            if (tag !== 42) {
              break;
            }

            message.acceptPriceChanges = reader.string();
            continue;
          }
          case 6: {
            if (tag !== 48) {
              break;
            }

            message.acceptAtTick = reader.uint32();
            continue;
          }
          case 7: {
            if (tag !== 56) {
              break;
            }

            message.seasonId = reader.int64().toString();
            continue;
          }
          case 8: {
            if (tag !== 64) {
              break;
            }

            message.acceptAtMs = reader.int64().toString();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<ComboRequested>, I>>(base?: I): ComboRequested {
    return ComboRequested.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<ComboRequested>, I>>(object: I): ComboRequested {
    const message = createBaseComboRequested();
    message.betId = object.betId ?? "0";
    message.userId = object.userId ?? "0";
    message.legs = object.legs?.map((e) => ComboLeg.fromPartial(e)) || [];
    message.stake = object.stake ?? "0";
    message.acceptPriceChanges = object.acceptPriceChanges ?? "";
    message.acceptAtTick = object.acceptAtTick ?? undefined;
    message.seasonId = object.seasonId ?? "0";
    message.acceptAtMs = object.acceptAtMs ?? "0";
    return message;
  },
};

function createBaseCashOutRequested(): CashOutRequested {
  return {
    betId: "0",
    userId: "0",
    quoteId: "",
    minAmount: "0",
    requestedAtTick: undefined,
    acceptAtTick: undefined,
    cashoutId: "0",
    acceptAtMs: "0",
  };
}

export const CashOutRequested: MessageFns<CashOutRequested> = {
  encode(message: CashOutRequested, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.betId !== "0") {
      writer.uint32(8).int64(message.betId);
    }
    if (message.userId !== "0") {
      writer.uint32(16).int64(message.userId);
    }
    if (message.quoteId !== "") {
      writer.uint32(26).string(message.quoteId);
    }
    if (message.minAmount !== "0") {
      writer.uint32(32).int64(message.minAmount);
    }
    if (message.requestedAtTick !== undefined) {
      writer.uint32(40).uint32(message.requestedAtTick);
    }
    if (message.acceptAtTick !== undefined) {
      writer.uint32(48).uint32(message.acceptAtTick);
    }
    if (message.cashoutId !== "0") {
      writer.uint32(56).int64(message.cashoutId);
    }
    if (message.acceptAtMs !== "0") {
      writer.uint32(64).int64(message.acceptAtMs);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): CashOutRequested {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseCashOutRequested();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.betId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.userId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.quoteId = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 32) {
              break;
            }

            message.minAmount = reader.int64().toString();
            continue;
          }
          case 5: {
            if (tag !== 40) {
              break;
            }

            message.requestedAtTick = reader.uint32();
            continue;
          }
          case 6: {
            if (tag !== 48) {
              break;
            }

            message.acceptAtTick = reader.uint32();
            continue;
          }
          case 7: {
            if (tag !== 56) {
              break;
            }

            message.cashoutId = reader.int64().toString();
            continue;
          }
          case 8: {
            if (tag !== 64) {
              break;
            }

            message.acceptAtMs = reader.int64().toString();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<CashOutRequested>, I>>(base?: I): CashOutRequested {
    return CashOutRequested.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<CashOutRequested>, I>>(object: I): CashOutRequested {
    const message = createBaseCashOutRequested();
    message.betId = object.betId ?? "0";
    message.userId = object.userId ?? "0";
    message.quoteId = object.quoteId ?? "";
    message.minAmount = object.minAmount ?? "0";
    message.requestedAtTick = object.requestedAtTick ?? undefined;
    message.acceptAtTick = object.acceptAtTick ?? undefined;
    message.cashoutId = object.cashoutId ?? "0";
    message.acceptAtMs = object.acceptAtMs ?? "0";
    return message;
  },
};

function createBaseBetAccepted(): BetAccepted {
  return {
    betId: "0",
    userId: "0",
    marketId: "0",
    raceId: "0",
    selection: undefined,
    stake: "0",
    lockedPrice: 0,
    betType: "",
    raceIds: [],
    seasonId: "0",
  };
}

export const BetAccepted: MessageFns<BetAccepted> = {
  encode(message: BetAccepted, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.betId !== "0") {
      writer.uint32(8).int64(message.betId);
    }
    if (message.userId !== "0") {
      writer.uint32(16).int64(message.userId);
    }
    if (message.marketId !== "0") {
      writer.uint32(24).int64(message.marketId);
    }
    if (message.raceId !== "0") {
      writer.uint32(32).int64(message.raceId);
    }
    if (message.selection !== undefined) {
      BetSelection.encode(message.selection, writer.uint32(42).fork()).join();
    }
    if (message.stake !== "0") {
      writer.uint32(48).int64(message.stake);
    }
    if (message.lockedPrice !== 0) {
      writer.uint32(57).double(message.lockedPrice);
    }
    if (message.betType !== "") {
      writer.uint32(66).string(message.betType);
    }
    if (message.raceIds.length !== 0) {
      writer.uint32(74).fork();
      for (const v of message.raceIds) {
        writer.int64(v);
      }
      writer.join();
    }
    if (message.seasonId !== "0") {
      writer.uint32(80).int64(message.seasonId);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): BetAccepted {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseBetAccepted();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.betId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.userId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.marketId = reader.int64().toString();
            continue;
          }
          case 4: {
            if (tag !== 32) {
              break;
            }

            message.raceId = reader.int64().toString();
            continue;
          }
          case 5: {
            if (tag !== 42) {
              break;
            }

            message.selection = BetSelection.decode(reader, reader.uint32());
            continue;
          }
          case 6: {
            if (tag !== 48) {
              break;
            }

            message.stake = reader.int64().toString();
            continue;
          }
          case 7: {
            if (tag !== 57) {
              break;
            }

            message.lockedPrice = reader.double();
            continue;
          }
          case 8: {
            if (tag !== 66) {
              break;
            }

            message.betType = reader.string();
            continue;
          }
          case 9: {
            if (tag === 72) {
              message.raceIds.push(reader.int64().toString());

              continue;
            }

            if (tag === 74) {
              const end2 = reader.uint32() + reader.pos;
              while (reader.pos < end2) {
                message.raceIds.push(reader.int64().toString());
              }

              continue;
            }

            break;
          }
          case 10: {
            if (tag !== 80) {
              break;
            }

            message.seasonId = reader.int64().toString();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<BetAccepted>, I>>(base?: I): BetAccepted {
    return BetAccepted.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<BetAccepted>, I>>(object: I): BetAccepted {
    const message = createBaseBetAccepted();
    message.betId = object.betId ?? "0";
    message.userId = object.userId ?? "0";
    message.marketId = object.marketId ?? "0";
    message.raceId = object.raceId ?? "0";
    message.selection = (object.selection !== undefined && object.selection !== null)
      ? BetSelection.fromPartial(object.selection)
      : undefined;
    message.stake = object.stake ?? "0";
    message.lockedPrice = object.lockedPrice ?? 0;
    message.betType = object.betType ?? "";
    message.raceIds = object.raceIds?.map((e) => e) || [];
    message.seasonId = object.seasonId ?? "0";
    return message;
  },
};

function createBaseBetRejected(): BetRejected {
  return { betId: "0", userId: "0", reason: "" };
}

export const BetRejected: MessageFns<BetRejected> = {
  encode(message: BetRejected, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.betId !== "0") {
      writer.uint32(8).int64(message.betId);
    }
    if (message.userId !== "0") {
      writer.uint32(16).int64(message.userId);
    }
    if (message.reason !== "") {
      writer.uint32(26).string(message.reason);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): BetRejected {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseBetRejected();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.betId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.userId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.reason = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<BetRejected>, I>>(base?: I): BetRejected {
    return BetRejected.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<BetRejected>, I>>(object: I): BetRejected {
    const message = createBaseBetRejected();
    message.betId = object.betId ?? "0";
    message.userId = object.userId ?? "0";
    message.reason = object.reason ?? "";
    return message;
  },
};

function createBaseLegSettled(): LegSettled {
  return { betId: "0", legNo: 0, marketId: "0", outcome: "", userId: "0" };
}

export const LegSettled: MessageFns<LegSettled> = {
  encode(message: LegSettled, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.betId !== "0") {
      writer.uint32(8).int64(message.betId);
    }
    if (message.legNo !== 0) {
      writer.uint32(16).uint32(message.legNo);
    }
    if (message.marketId !== "0") {
      writer.uint32(24).int64(message.marketId);
    }
    if (message.outcome !== "") {
      writer.uint32(34).string(message.outcome);
    }
    if (message.userId !== "0") {
      writer.uint32(40).int64(message.userId);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): LegSettled {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseLegSettled();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.betId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.legNo = reader.uint32();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.marketId = reader.int64().toString();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.outcome = reader.string();
            continue;
          }
          case 5: {
            if (tag !== 40) {
              break;
            }

            message.userId = reader.int64().toString();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<LegSettled>, I>>(base?: I): LegSettled {
    return LegSettled.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<LegSettled>, I>>(object: I): LegSettled {
    const message = createBaseLegSettled();
    message.betId = object.betId ?? "0";
    message.legNo = object.legNo ?? 0;
    message.marketId = object.marketId ?? "0";
    message.outcome = object.outcome ?? "";
    message.userId = object.userId ?? "0";
    return message;
  },
};

function createBaseBetSettled(): BetSettled {
  return { betId: "0", userId: "0", outcome: "", payout: "0", stake: "0", seasonId: "0", betType: "" };
}

export const BetSettled: MessageFns<BetSettled> = {
  encode(message: BetSettled, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.betId !== "0") {
      writer.uint32(8).int64(message.betId);
    }
    if (message.userId !== "0") {
      writer.uint32(16).int64(message.userId);
    }
    if (message.outcome !== "") {
      writer.uint32(26).string(message.outcome);
    }
    if (message.payout !== "0") {
      writer.uint32(32).int64(message.payout);
    }
    if (message.stake !== "0") {
      writer.uint32(40).int64(message.stake);
    }
    if (message.seasonId !== "0") {
      writer.uint32(48).int64(message.seasonId);
    }
    if (message.betType !== "") {
      writer.uint32(58).string(message.betType);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): BetSettled {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseBetSettled();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.betId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.userId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.outcome = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 32) {
              break;
            }

            message.payout = reader.int64().toString();
            continue;
          }
          case 5: {
            if (tag !== 40) {
              break;
            }

            message.stake = reader.int64().toString();
            continue;
          }
          case 6: {
            if (tag !== 48) {
              break;
            }

            message.seasonId = reader.int64().toString();
            continue;
          }
          case 7: {
            if (tag !== 58) {
              break;
            }

            message.betType = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<BetSettled>, I>>(base?: I): BetSettled {
    return BetSettled.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<BetSettled>, I>>(object: I): BetSettled {
    const message = createBaseBetSettled();
    message.betId = object.betId ?? "0";
    message.userId = object.userId ?? "0";
    message.outcome = object.outcome ?? "";
    message.payout = object.payout ?? "0";
    message.stake = object.stake ?? "0";
    message.seasonId = object.seasonId ?? "0";
    message.betType = object.betType ?? "";
    return message;
  },
};

function createBaseBetCashedOut(): BetCashedOut {
  return { betId: "0", userId: "0", amount: "0", tick: undefined, stake: "0", seasonId: "0" };
}

export const BetCashedOut: MessageFns<BetCashedOut> = {
  encode(message: BetCashedOut, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.betId !== "0") {
      writer.uint32(8).int64(message.betId);
    }
    if (message.userId !== "0") {
      writer.uint32(16).int64(message.userId);
    }
    if (message.amount !== "0") {
      writer.uint32(24).int64(message.amount);
    }
    if (message.tick !== undefined) {
      writer.uint32(32).uint32(message.tick);
    }
    if (message.stake !== "0") {
      writer.uint32(40).int64(message.stake);
    }
    if (message.seasonId !== "0") {
      writer.uint32(48).int64(message.seasonId);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): BetCashedOut {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseBetCashedOut();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.betId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.userId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.amount = reader.int64().toString();
            continue;
          }
          case 4: {
            if (tag !== 32) {
              break;
            }

            message.tick = reader.uint32();
            continue;
          }
          case 5: {
            if (tag !== 40) {
              break;
            }

            message.stake = reader.int64().toString();
            continue;
          }
          case 6: {
            if (tag !== 48) {
              break;
            }

            message.seasonId = reader.int64().toString();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<BetCashedOut>, I>>(base?: I): BetCashedOut {
    return BetCashedOut.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<BetCashedOut>, I>>(object: I): BetCashedOut {
    const message = createBaseBetCashedOut();
    message.betId = object.betId ?? "0";
    message.userId = object.userId ?? "0";
    message.amount = object.amount ?? "0";
    message.tick = object.tick ?? undefined;
    message.stake = object.stake ?? "0";
    message.seasonId = object.seasonId ?? "0";
    return message;
  },
};

function createBaseCashOutRejected(): CashOutRejected {
  return { betId: "0", userId: "0", reason: "", cashoutId: "0" };
}

export const CashOutRejected: MessageFns<CashOutRejected> = {
  encode(message: CashOutRejected, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.betId !== "0") {
      writer.uint32(8).int64(message.betId);
    }
    if (message.userId !== "0") {
      writer.uint32(16).int64(message.userId);
    }
    if (message.reason !== "") {
      writer.uint32(26).string(message.reason);
    }
    if (message.cashoutId !== "0") {
      writer.uint32(32).int64(message.cashoutId);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): CashOutRejected {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseCashOutRejected();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.betId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.userId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.reason = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 32) {
              break;
            }

            message.cashoutId = reader.int64().toString();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<CashOutRejected>, I>>(base?: I): CashOutRejected {
    return CashOutRejected.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<CashOutRejected>, I>>(object: I): CashOutRejected {
    const message = createBaseCashOutRejected();
    message.betId = object.betId ?? "0";
    message.userId = object.userId ?? "0";
    message.reason = object.reason ?? "";
    message.cashoutId = object.cashoutId ?? "0";
    return message;
  },
};

function createBaseLedgerEntryAppended(): LedgerEntryAppended {
  return {
    entryId: "0",
    userId: "0",
    seasonId: "0",
    type: "",
    amount: "0",
    refId: "",
    balanceAfter: "0",
    openStakeAfter: "0",
  };
}

export const LedgerEntryAppended: MessageFns<LedgerEntryAppended> = {
  encode(message: LedgerEntryAppended, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.entryId !== "0") {
      writer.uint32(8).int64(message.entryId);
    }
    if (message.userId !== "0") {
      writer.uint32(16).int64(message.userId);
    }
    if (message.seasonId !== "0") {
      writer.uint32(24).int64(message.seasonId);
    }
    if (message.type !== "") {
      writer.uint32(34).string(message.type);
    }
    if (message.amount !== "0") {
      writer.uint32(40).int64(message.amount);
    }
    if (message.refId !== "") {
      writer.uint32(50).string(message.refId);
    }
    if (message.balanceAfter !== "0") {
      writer.uint32(56).int64(message.balanceAfter);
    }
    if (message.openStakeAfter !== "0") {
      writer.uint32(64).int64(message.openStakeAfter);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): LedgerEntryAppended {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseLedgerEntryAppended();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.entryId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.userId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.seasonId = reader.int64().toString();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.type = reader.string();
            continue;
          }
          case 5: {
            if (tag !== 40) {
              break;
            }

            message.amount = reader.int64().toString();
            continue;
          }
          case 6: {
            if (tag !== 50) {
              break;
            }

            message.refId = reader.string();
            continue;
          }
          case 7: {
            if (tag !== 56) {
              break;
            }

            message.balanceAfter = reader.int64().toString();
            continue;
          }
          case 8: {
            if (tag !== 64) {
              break;
            }

            message.openStakeAfter = reader.int64().toString();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<LedgerEntryAppended>, I>>(base?: I): LedgerEntryAppended {
    return LedgerEntryAppended.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<LedgerEntryAppended>, I>>(object: I): LedgerEntryAppended {
    const message = createBaseLedgerEntryAppended();
    message.entryId = object.entryId ?? "0";
    message.userId = object.userId ?? "0";
    message.seasonId = object.seasonId ?? "0";
    message.type = object.type ?? "";
    message.amount = object.amount ?? "0";
    message.refId = object.refId ?? "";
    message.balanceAfter = object.balanceAfter ?? "0";
    message.openStakeAfter = object.openStakeAfter ?? "0";
    return message;
  },
};

function createBaseCareerStats(): CareerStats {
  return { races: 0, wins: 0, podiums: 0 };
}

export const CareerStats: MessageFns<CareerStats> = {
  encode(message: CareerStats, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.races !== 0) {
      writer.uint32(8).uint32(message.races);
    }
    if (message.wins !== 0) {
      writer.uint32(16).uint32(message.wins);
    }
    if (message.podiums !== 0) {
      writer.uint32(24).uint32(message.podiums);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): CareerStats {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseCareerStats();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.races = reader.uint32();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.wins = reader.uint32();
            continue;
          }
          case 3: {
            if (tag !== 24) {
              break;
            }

            message.podiums = reader.uint32();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<CareerStats>, I>>(base?: I): CareerStats {
    return CareerStats.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<CareerStats>, I>>(object: I): CareerStats {
    const message = createBaseCareerStats();
    message.races = object.races ?? 0;
    message.wins = object.wins ?? 0;
    message.podiums = object.podiums ?? 0;
    return message;
  },
};

function createBaseAnimalRecruited(): AnimalRecruited {
  return { animalId: "0", species: "", name: "", base: undefined, temperament: "" };
}

export const AnimalRecruited: MessageFns<AnimalRecruited> = {
  encode(message: AnimalRecruited, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.animalId !== "0") {
      writer.uint32(8).int64(message.animalId);
    }
    if (message.species !== "") {
      writer.uint32(18).string(message.species);
    }
    if (message.name !== "") {
      writer.uint32(26).string(message.name);
    }
    if (message.base !== undefined) {
      Stats.encode(message.base, writer.uint32(34).fork()).join();
    }
    if (message.temperament !== "") {
      writer.uint32(42).string(message.temperament);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): AnimalRecruited {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseAnimalRecruited();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.animalId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.species = reader.string();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.name = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.base = Stats.decode(reader, reader.uint32());
            continue;
          }
          case 5: {
            if (tag !== 42) {
              break;
            }

            message.temperament = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<AnimalRecruited>, I>>(base?: I): AnimalRecruited {
    return AnimalRecruited.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<AnimalRecruited>, I>>(object: I): AnimalRecruited {
    const message = createBaseAnimalRecruited();
    message.animalId = object.animalId ?? "0";
    message.species = object.species ?? "";
    message.name = object.name ?? "";
    message.base = (object.base !== undefined && object.base !== null) ? Stats.fromPartial(object.base) : undefined;
    message.temperament = object.temperament ?? "";
    return message;
  },
};

function createBaseAnimalAged(): AnimalAged {
  return { animalId: "0", ageWeeks: 0, lifeStage: "", current: undefined, careerDay: 0 };
}

export const AnimalAged: MessageFns<AnimalAged> = {
  encode(message: AnimalAged, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.animalId !== "0") {
      writer.uint32(8).int64(message.animalId);
    }
    if (message.ageWeeks !== 0) {
      writer.uint32(16).uint32(message.ageWeeks);
    }
    if (message.lifeStage !== "") {
      writer.uint32(26).string(message.lifeStage);
    }
    if (message.current !== undefined) {
      Stats.encode(message.current, writer.uint32(34).fork()).join();
    }
    if (message.careerDay !== 0) {
      writer.uint32(40).uint32(message.careerDay);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): AnimalAged {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseAnimalAged();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.animalId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.ageWeeks = reader.uint32();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.lifeStage = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.current = Stats.decode(reader, reader.uint32());
            continue;
          }
          case 5: {
            if (tag !== 40) {
              break;
            }

            message.careerDay = reader.uint32();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<AnimalAged>, I>>(base?: I): AnimalAged {
    return AnimalAged.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<AnimalAged>, I>>(object: I): AnimalAged {
    const message = createBaseAnimalAged();
    message.animalId = object.animalId ?? "0";
    message.ageWeeks = object.ageWeeks ?? 0;
    message.lifeStage = object.lifeStage ?? "";
    message.current = (object.current !== undefined && object.current !== null)
      ? Stats.fromPartial(object.current)
      : undefined;
    message.careerDay = object.careerDay ?? 0;
    return message;
  },
};

function createBaseAnimalRetired(): AnimalRetired {
  return { animalId: "0", reason: "", careerStats: undefined };
}

export const AnimalRetired: MessageFns<AnimalRetired> = {
  encode(message: AnimalRetired, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.animalId !== "0") {
      writer.uint32(8).int64(message.animalId);
    }
    if (message.reason !== "") {
      writer.uint32(18).string(message.reason);
    }
    if (message.careerStats !== undefined) {
      CareerStats.encode(message.careerStats, writer.uint32(26).fork()).join();
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): AnimalRetired {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseAnimalRetired();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.animalId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.reason = reader.string();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.careerStats = CareerStats.decode(reader, reader.uint32());
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<AnimalRetired>, I>>(base?: I): AnimalRetired {
    return AnimalRetired.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<AnimalRetired>, I>>(object: I): AnimalRetired {
    const message = createBaseAnimalRetired();
    message.animalId = object.animalId ?? "0";
    message.reason = object.reason ?? "";
    message.careerStats = (object.careerStats !== undefined && object.careerStats !== null)
      ? CareerStats.fromPartial(object.careerStats)
      : undefined;
    return message;
  },
};

function createBaseSeasonStarted(): SeasonStarted {
  return { seasonId: "0", startsAt: "", endsAt: "", startingGrant: "0", name: "" };
}

export const SeasonStarted: MessageFns<SeasonStarted> = {
  encode(message: SeasonStarted, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.seasonId !== "0") {
      writer.uint32(8).int64(message.seasonId);
    }
    if (message.startsAt !== "") {
      writer.uint32(18).string(message.startsAt);
    }
    if (message.endsAt !== "") {
      writer.uint32(26).string(message.endsAt);
    }
    if (message.startingGrant !== "0") {
      writer.uint32(32).int64(message.startingGrant);
    }
    if (message.name !== "") {
      writer.uint32(42).string(message.name);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): SeasonStarted {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseSeasonStarted();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.seasonId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.startsAt = reader.string();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.endsAt = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 32) {
              break;
            }

            message.startingGrant = reader.int64().toString();
            continue;
          }
          case 5: {
            if (tag !== 42) {
              break;
            }

            message.name = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<SeasonStarted>, I>>(base?: I): SeasonStarted {
    return SeasonStarted.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<SeasonStarted>, I>>(object: I): SeasonStarted {
    const message = createBaseSeasonStarted();
    message.seasonId = object.seasonId ?? "0";
    message.startsAt = object.startsAt ?? "";
    message.endsAt = object.endsAt ?? "";
    message.startingGrant = object.startingGrant ?? "0";
    message.name = object.name ?? "";
    return message;
  },
};

function createBaseSeasonEnding(): SeasonEnding {
  return { seasonId: "0", endsAt: "" };
}

export const SeasonEnding: MessageFns<SeasonEnding> = {
  encode(message: SeasonEnding, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.seasonId !== "0") {
      writer.uint32(8).int64(message.seasonId);
    }
    if (message.endsAt !== "") {
      writer.uint32(18).string(message.endsAt);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): SeasonEnding {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseSeasonEnding();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.seasonId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.endsAt = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<SeasonEnding>, I>>(base?: I): SeasonEnding {
    return SeasonEnding.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<SeasonEnding>, I>>(object: I): SeasonEnding {
    const message = createBaseSeasonEnding();
    message.seasonId = object.seasonId ?? "0";
    message.endsAt = object.endsAt ?? "";
    return message;
  },
};

function createBaseSeasonStanding(): SeasonStanding {
  return { userId: "0", rank: 0, score: 0 };
}

export const SeasonStanding: MessageFns<SeasonStanding> = {
  encode(message: SeasonStanding, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.userId !== "0") {
      writer.uint32(8).int64(message.userId);
    }
    if (message.rank !== 0) {
      writer.uint32(16).uint32(message.rank);
    }
    if (message.score !== 0) {
      writer.uint32(25).double(message.score);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): SeasonStanding {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseSeasonStanding();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.userId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.rank = reader.uint32();
            continue;
          }
          case 3: {
            if (tag !== 25) {
              break;
            }

            message.score = reader.double();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<SeasonStanding>, I>>(base?: I): SeasonStanding {
    return SeasonStanding.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<SeasonStanding>, I>>(object: I): SeasonStanding {
    const message = createBaseSeasonStanding();
    message.userId = object.userId ?? "0";
    message.rank = object.rank ?? 0;
    message.score = object.score ?? 0;
    return message;
  },
};

function createBaseSeasonEnded(): SeasonEnded {
  return { seasonId: "0", top: [] };
}

export const SeasonEnded: MessageFns<SeasonEnded> = {
  encode(message: SeasonEnded, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.seasonId !== "0") {
      writer.uint32(8).int64(message.seasonId);
    }
    for (const v of message.top) {
      SeasonStanding.encode(v!, writer.uint32(18).fork()).join();
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): SeasonEnded {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseSeasonEnded();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.seasonId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 18) {
              break;
            }

            message.top.push(SeasonStanding.decode(reader, reader.uint32()));
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<SeasonEnded>, I>>(base?: I): SeasonEnded {
    return SeasonEnded.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<SeasonEnded>, I>>(object: I): SeasonEnded {
    const message = createBaseSeasonEnded();
    message.seasonId = object.seasonId ?? "0";
    message.top = object.top?.map((e) => SeasonStanding.fromPartial(e)) || [];
    return message;
  },
};

function createBaseLeaderboardMoved(): LeaderboardMoved {
  return { seasonId: "0", userId: "0", board: "", fromRank: 0, toRank: 0, threshold: 0, entered: false };
}

export const LeaderboardMoved: MessageFns<LeaderboardMoved> = {
  encode(message: LeaderboardMoved, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.seasonId !== "0") {
      writer.uint32(8).int64(message.seasonId);
    }
    if (message.userId !== "0") {
      writer.uint32(16).int64(message.userId);
    }
    if (message.board !== "") {
      writer.uint32(26).string(message.board);
    }
    if (message.fromRank !== 0) {
      writer.uint32(32).uint32(message.fromRank);
    }
    if (message.toRank !== 0) {
      writer.uint32(40).uint32(message.toRank);
    }
    if (message.threshold !== 0) {
      writer.uint32(48).uint32(message.threshold);
    }
    if (message.entered !== false) {
      writer.uint32(56).bool(message.entered);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): LeaderboardMoved {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseLeaderboardMoved();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.seasonId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.userId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.board = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 32) {
              break;
            }

            message.fromRank = reader.uint32();
            continue;
          }
          case 5: {
            if (tag !== 40) {
              break;
            }

            message.toRank = reader.uint32();
            continue;
          }
          case 6: {
            if (tag !== 48) {
              break;
            }

            message.threshold = reader.uint32();
            continue;
          }
          case 7: {
            if (tag !== 56) {
              break;
            }

            message.entered = reader.bool();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<LeaderboardMoved>, I>>(base?: I): LeaderboardMoved {
    return LeaderboardMoved.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<LeaderboardMoved>, I>>(object: I): LeaderboardMoved {
    const message = createBaseLeaderboardMoved();
    message.seasonId = object.seasonId ?? "0";
    message.userId = object.userId ?? "0";
    message.board = object.board ?? "";
    message.fromRank = object.fromRank ?? 0;
    message.toRank = object.toRank ?? 0;
    message.threshold = object.threshold ?? 0;
    message.entered = object.entered ?? false;
    return message;
  },
};

function createBaseNotificationCreated(): NotificationCreated {
  return { userId: "0", notificationId: "0", type: "", payloadJson: "", createdAt: "" };
}

export const NotificationCreated: MessageFns<NotificationCreated> = {
  encode(message: NotificationCreated, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.userId !== "0") {
      writer.uint32(8).int64(message.userId);
    }
    if (message.notificationId !== "0") {
      writer.uint32(16).int64(message.notificationId);
    }
    if (message.type !== "") {
      writer.uint32(26).string(message.type);
    }
    if (message.payloadJson !== "") {
      writer.uint32(34).string(message.payloadJson);
    }
    if (message.createdAt !== "") {
      writer.uint32(42).string(message.createdAt);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): NotificationCreated {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseNotificationCreated();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.userId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.notificationId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.type = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.payloadJson = reader.string();
            continue;
          }
          case 5: {
            if (tag !== 42) {
              break;
            }

            message.createdAt = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<NotificationCreated>, I>>(base?: I): NotificationCreated {
    return NotificationCreated.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<NotificationCreated>, I>>(object: I): NotificationCreated {
    const message = createBaseNotificationCreated();
    message.userId = object.userId ?? "0";
    message.notificationId = object.notificationId ?? "0";
    message.type = object.type ?? "";
    message.payloadJson = object.payloadJson ?? "";
    message.createdAt = object.createdAt ?? "";
    return message;
  },
};

function createBaseAdminAudit(): AdminAudit {
  return {
    auditId: "0",
    adminUserId: "0",
    action: "",
    targetType: "",
    targetId: "",
    beforeJson: "",
    afterJson: "",
    reason: "",
  };
}

export const AdminAudit: MessageFns<AdminAudit> = {
  encode(message: AdminAudit, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.auditId !== "0") {
      writer.uint32(8).int64(message.auditId);
    }
    if (message.adminUserId !== "0") {
      writer.uint32(16).int64(message.adminUserId);
    }
    if (message.action !== "") {
      writer.uint32(26).string(message.action);
    }
    if (message.targetType !== "") {
      writer.uint32(34).string(message.targetType);
    }
    if (message.targetId !== "") {
      writer.uint32(42).string(message.targetId);
    }
    if (message.beforeJson !== "") {
      writer.uint32(50).string(message.beforeJson);
    }
    if (message.afterJson !== "") {
      writer.uint32(58).string(message.afterJson);
    }
    if (message.reason !== "") {
      writer.uint32(66).string(message.reason);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): AdminAudit {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const previousRecursionDepth = (reader as any).__tsProtoDecodeDepth ?? 0;
    if (previousRecursionDepth >= 100) {
      throw new globalThis.Error("protobuf decode recursion limit exceeded");
    }
    (reader as any).__tsProtoDecodeDepth = previousRecursionDepth + 1;
    try {
      const end = length === undefined ? reader.len : reader.pos + length;
      const message = createBaseAdminAudit();
      while (reader.pos < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1: {
            if (tag !== 8) {
              break;
            }

            message.auditId = reader.int64().toString();
            continue;
          }
          case 2: {
            if (tag !== 16) {
              break;
            }

            message.adminUserId = reader.int64().toString();
            continue;
          }
          case 3: {
            if (tag !== 26) {
              break;
            }

            message.action = reader.string();
            continue;
          }
          case 4: {
            if (tag !== 34) {
              break;
            }

            message.targetType = reader.string();
            continue;
          }
          case 5: {
            if (tag !== 42) {
              break;
            }

            message.targetId = reader.string();
            continue;
          }
          case 6: {
            if (tag !== 50) {
              break;
            }

            message.beforeJson = reader.string();
            continue;
          }
          case 7: {
            if (tag !== 58) {
              break;
            }

            message.afterJson = reader.string();
            continue;
          }
          case 8: {
            if (tag !== 66) {
              break;
            }

            message.reason = reader.string();
            continue;
          }
        }
        if ((tag & 7) === 4 || tag === 0) {
          break;
        }
        reader.skip(tag & 7);
      }
      return message;
    } finally {
      (reader as any).__tsProtoDecodeDepth = previousRecursionDepth;
    }
  },

  create<I extends Exact<DeepPartial<AdminAudit>, I>>(base?: I): AdminAudit {
    return AdminAudit.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<AdminAudit>, I>>(object: I): AdminAudit {
    const message = createBaseAdminAudit();
    message.auditId = object.auditId ?? "0";
    message.adminUserId = object.adminUserId ?? "0";
    message.action = object.action ?? "";
    message.targetType = object.targetType ?? "";
    message.targetId = object.targetId ?? "";
    message.beforeJson = object.beforeJson ?? "";
    message.afterJson = object.afterJson ?? "";
    message.reason = object.reason ?? "";
    return message;
  },
};

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;

export type DeepPartial<T> = T extends Builtin ? T
  : T extends globalThis.Array<infer U> ? globalThis.Array<DeepPartial<U>>
  : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends { $case: string; value: unknown } ? { $case: T["$case"]; value?: DeepPartial<T["value"]> }
  : T extends {} ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;

type KeysOfUnion<T> = T extends T ? keyof T : never;
export type Exact<P, I> = P extends Builtin ? P
  :
    & P
    & { [K in keyof P as Extract<K, keyof I>]: Exact<P[K], I[K & keyof I]> }
    & { [K in Exclude<keyof I, KeysOfUnion<P>>]: never };

export interface MessageFns<T> {
  encode(message: T, writer?: BinaryWriter): BinaryWriter;
  decode(input: BinaryReader | Uint8Array, length?: number): T;
  create<I extends Exact<DeepPartial<T>, I>>(base?: I): T;
  fromPartial<I extends Exact<DeepPartial<T>, I>>(object: I): T;
}
