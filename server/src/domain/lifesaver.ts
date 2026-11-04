export const DEFAULT_LIFESAVER_GRANT = 5000;

export type LifesaverState = 'NO_SEASON' | 'AFLOAT' | 'WAITING_ON_BETS' | 'PENALIZED' | 'READY';

export type LifesaverInput = {
  hasSeason: boolean;
  balance: number;
  openStake: number;
  emptiedByPenalty?: boolean;
};

export function lifesaverRef(seasonId: string, usedCount: number): string {
  return `free:${seasonId}:${usedCount}`;
}

export function lifesaverState(input: LifesaverInput): LifesaverState {
  if (!input.hasSeason) return 'NO_SEASON';
  if (input.balance > 0) return 'AFLOAT';
  if (input.openStake > 0) return 'WAITING_ON_BETS';
  if (input.emptiedByPenalty) return 'PENALIZED';
  return 'READY';
}

const REJECTIONS: Record<LifesaverState, { code: string; message: string } | null> = {
  READY: null,
  NO_SEASON: { code: 'CONFLICT', message: 'No active season' },
  AFLOAT: { code: 'NOT_BUSTED', message: 'Lifesavers are only for players who have lost all their points' },
  WAITING_ON_BETS: { code: 'BETS_STILL_OPEN', message: 'Wait for your open bets to settle first' },
  PENALIZED: { code: 'PENALIZED', message: 'Lifesavers do not cover points taken away as a penalty' },
};

export function lifesaverRejection(state: LifesaverState): { code: string; message: string } | null {
  return REJECTIONS[state];
}

export type LifesaverStatus = {
  state: LifesaverState;
  claimable: boolean;
  amount: number;
  usedCount: number;
  seasonId: string | null;
  usedAt: string | null;
};
