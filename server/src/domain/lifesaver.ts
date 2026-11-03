export const FREE_LIFESAVERS_PER_SEASON = 1;
export const DEFAULT_LIFESAVER_GRANT = 5000;

export type LifesaverState = 'NO_SEASON' | 'AFLOAT' | 'WAITING_ON_BETS' | 'READY' | 'USED';

export type LifesaverInput = {
  hasSeason: boolean;
  balance: number;
  openStake: number;
  freeUsed: number;
};

export function freeLifesaverRef(seasonId: string): string {
  return `free:${seasonId}`;
}

export function lifesaverState(input: LifesaverInput): LifesaverState {
  if (!input.hasSeason) return 'NO_SEASON';
  if (input.balance > 0) return 'AFLOAT';
  if (input.freeUsed >= FREE_LIFESAVERS_PER_SEASON) return 'USED';
  if (input.openStake > 0) return 'WAITING_ON_BETS';
  return 'READY';
}

const REJECTIONS: Record<LifesaverState, { code: string; message: string } | null> = {
  READY: null,
  NO_SEASON: { code: 'CONFLICT', message: 'No active season' },
  AFLOAT: { code: 'NOT_BUSTED', message: 'Lifesavers are only for players who have lost all their points' },
  WAITING_ON_BETS: { code: 'BETS_STILL_OPEN', message: 'Wait for your open bets to settle first' },
  USED: { code: 'LIFESAVER_USED', message: 'Your free lifesaver for this season is already used' },
};

export function lifesaverRejection(state: LifesaverState): { code: string; message: string } | null {
  return REJECTIONS[state];
}

export type LifesaverStatus = {
  state: LifesaverState;
  claimable: boolean;
  amount: number;
  freePerSeason: number;
  freeRemaining: number;
  seasonId: string | null;
  usedAt: string | null;
};
