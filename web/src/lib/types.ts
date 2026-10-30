export type Species = 'HORSE' | 'GIRAFFE';
export type RaceClass = 'SPRINT' | 'STANDARD' | 'ENDURANCE';
export type Temperament = 'FRONT_RUNNER' | 'STALKER' | 'CLOSER' | 'STEADY';
export type RaceStatus = 'SCHEDULED' | 'OPEN' | 'LOCKED' | 'LIVE' | 'FINISHED' | 'SETTLED' | 'CANCELLED';
export type MarketType = 'FINISH_POSITION' | 'TOP_N' | 'TRICAST' | 'LEADER_AT_LAP';
export type MarketStatus = 'PENDING' | 'OPEN' | 'SUSPENDED' | 'CLOSED' | 'RESULTED' | 'VOID';
export type BetStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WON' | 'LOST' | 'VOID' | 'CASHED_OUT';
export type PricePolicy = 'NONE' | 'BETTER' | 'ANY';
export type ProviderId = 'google' | 'github';
export type EntrantState = 'RUNNING' | 'SPRINTING' | 'TIRED' | 'STUMBLED' | 'DNF' | 'FINISHED';
export type ResultStatus = 'FINISHED' | 'DISQUALIFIED' | 'DNF' | 'NON_RUNNER';

export type Stats = { velocity: number; stamina: number; acceleration: number; consistency: number };

export type User = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: 'USER' | 'ADMIN';
  providers: ProviderId[];
  createdAt: string;
};

export type AnimalSummary = {
  id: string;
  name: string;
  species: Species;
  status: 'ACTIVE' | 'RETIRED';
  ageWeeks: number;
  careerDay: number;
  lifeStage: 'ROOKIE' | 'PRIME' | 'VETERAN';
  temperament: Temperament;
  current: Stats;
  form: { last5: string[]; races: number; wins: number; podiums: number };
  restingUntil: string | null;
};

export type Animal = AnimalSummary & {
  base: Stats;
  recruitedAt: string;
  retiredAt: string | null;
  retireReason: string | null;
  venueForm: { venueId: string; venueName: string; races: number; wins: number; podiums: number }[];
  agingHistory: { day: string; careerDay: number; lifeStage: string; stats: Stats }[];
};

export type AnimalHistoryItem = {
  raceId: string;
  finishedAt: string | null;
  class: RaceClass;
  venueId: string;
  venueName: string;
  position: number | null;
  resultStatus: ResultStatus | null;
  timeSec: number | null;
  lapsLed: number[];
  statsSnapshot: Stats;
  fieldSize: number;
};

export type EntrantResult = {
  officialPosition: number;
  asRunPosition: number;
  resultStatus: ResultStatus;
  finishTimeMs: number | null;
  distanceCovered: number;
};

export type Entrant = {
  entrantId: string;
  lane: number;
  temperament: Temperament;
  statsSnapshot: Stats;
  animal: AnimalSummary;
  result: EntrantResult | null;
};

export type Race = {
  id: string;
  seasonId: string;
  status: RaceStatus;
  class: RaceClass;
  species: Species;
  venueId: string;
  venueVersion: number;
  venueName: string;
  surface: string;
  laps: number;
  estimatedDurationSec: number;
  tickMs: number;
  startAt: string;
  bettingClosesAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  currentTick: number | null;
  currentLap: number | null;
  seedHash: string | null;
  scriptHash: string | null;
  cancelledReason: string | null;
  entrantCount: number;
  entrants?: Entrant[];
  result: string[] | null;
  winner: { entrantId: string; animalId: string; name: string } | null;
};

export type Selection = { selectionId: string; entrantId: string; price: number; probability: number };

export type Market = {
  id: string;
  raceId: string;
  type: MarketType;
  params: Record<string, number>;
  status: MarketStatus;
  closesAtLap: number | null;
  priceVersion: number;
  selections: Selection[];
  result: { winning: string[]; order: string[] } | null;
};

export type BetSelection = { entrantId: string } | { order: [string, string, string] };

export type BetLeg = {
  legId: string;
  marketId: string;
  raceId: string;
  marketType: MarketType;
  marketParams: Record<string, number>;
  selection: BetSelection;
  acceptedPrice: number;
  priceVersion: number;
  lockedPrice: number | null;
  status: 'OPEN' | 'WON' | 'LOST' | 'VOID';
  placedAtTick: number | null;
};

export type Bet = {
  id: string;
  type: 'SINGLE' | 'COMBO';
  legs: BetLeg[];
  stake: number;
  lockedPrice: number | null;
  status: BetStatus;
  rejectReason: string | null;
  payout: number | null;
  cashOutAmount: number | null;
  placedAtTick: number | null;
  acceptPriceChanges: PricePolicy;
  requestedAt: string;
  acceptedAt: string | null;
  settledAt: string | null;
};

export type CashOutQuote = { quoteId: string; amount: number; priceVersion: number; expiresAtTick: number | null; expiresAt: string };

export type Wallet = { seasonId: string; balance: number; inOpenBets: number; rankScore: number };

export type LedgerEntry = {
  entryId: string;
  seasonId: string;
  type: string;
  amount: number;
  refId: string;
  balanceAfter: number;
  createdAt: string;
};

export type DailyReward = { claimable: boolean; amount: number; nextClaimAt: string; streak: number; bestStreak: number };

export type Season = {
  id: string;
  name: string;
  status: 'UPCOMING' | 'ACTIVE' | 'ENDED';
  startsAt: string;
  endsAt: string;
  lastRaceAt: string;
  startingGrant: number;
  dailyGrant: number;
};

export type LeaderboardEntry = { rank: number; userId: string; displayName: string; avatarUrl: string | null; score: number };

export type Segment = {
  type: 'STRAIGHT' | 'CURVE' | 'UPHILL' | 'DOWNHILL';
  length?: number;
  radius?: number;
  angle?: number;
  grade?: number;
};

export type Venue = {
  id: string;
  version: number;
  name: string;
  class: RaceClass;
  surface: string;
  description: string;
  lanes: number;
  lapLength: number;
  lapsRange: [number, number];
  segments: Segment[];
  assets: Record<string, unknown>;
  status: string;
};

export type Notification = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
};

export type Page<T> = { items: T[]; nextCursor: string | null };

export type TickEntrant = {
  id: string;
  dist: number;
  lane: number;
  speed: number;
  staminaPct: number;
  state: EntrantState;
  pos: number;
};

export type TickEvent = {
  type: string;
  id?: string;
  a?: string;
  b?: string;
  lap?: number;
  pos?: number;
};

export type RaceTick = { tick: number; lap: number; entrants: TickEntrant[]; events: TickEvent[] };

export type RaceResultResponse = {
  race: Race;
  order: string[];
  asRun: string[];
  lapLeaders: { lap: number; entrantId: string; tick: number }[];
  incidents: { seq: number; tick: number; type: string; entrantId: string | null; data: Record<string, unknown> | null }[];
  markets: { marketId: string; type: MarketType; params: Record<string, number>; status: MarketStatus; winning: Selection[]; order: string[] }[];
  seed: string | null;
  seedHash: string | null;
  scriptHash: string | null;
  engineVersion: string;
  replay: { available: boolean; expiresAt: string | null };
};

export type Session = { accessToken: string; expiresIn: number; user: User };
