export type SeasonStats = {
  settledBets: number;
  totalStaked: number;
  totalReturned: number;
  biggestPayout: number;
  biggestPayoutBet: string | null;
  currentStreak: number;
  bestStreak: number;
};

export const BOARDS = ['balance', 'biggest-payout', 'roi', 'win-streak'] as const;
export type Board = (typeof BOARDS)[number];
export const MIN_SETTLED_FOR_RANKING = 20;

export function emptyStats(): SeasonStats {
  return { settledBets: 0, totalStaked: 0, totalReturned: 0, biggestPayout: 0, biggestPayoutBet: null, currentStreak: 0, bestStreak: 0 };
}

export function applySettled(stats: SeasonStats, event: { betId: string; outcome: 'WON' | 'LOST' | 'VOID' | 'CASHED_OUT'; stake: number; returned: number }): SeasonStats {
  const next = { ...stats, settledBets: stats.settledBets + 1, totalStaked: stats.totalStaked + event.stake, totalReturned: stats.totalReturned + event.returned };
  if (event.outcome === 'WON') {
    next.currentStreak = stats.currentStreak + 1;
    next.bestStreak = Math.max(stats.bestStreak, next.currentStreak);
    if (event.returned > stats.biggestPayout) {
      next.biggestPayout = event.returned;
      next.biggestPayoutBet = event.betId;
    }
  } else if (event.outcome === 'LOST') {
    next.currentStreak = 0;
  }
  return next;
}

export function roi(stats: SeasonStats): number {
  return stats.totalStaked === 0 ? 0 : (stats.totalReturned - stats.totalStaked) / stats.totalStaked;
}

export function boardScore(board: Board, stats: SeasonStats, rankScore: number): number | null {
  switch (board) {
    case 'balance':
      return rankScore;
    case 'biggest-payout':
      return stats.biggestPayout > 0 ? stats.biggestPayout : null;
    case 'roi':
      return stats.settledBets >= MIN_SETTLED_FOR_RANKING ? Math.round(roi(stats) * 10000) / 10000 : null;
    case 'win-streak':
      return stats.settledBets >= MIN_SETTLED_FOR_RANKING && stats.bestStreak > 0 ? stats.bestStreak : null;
  }
}

export const RANK_THRESHOLDS = [10, 100] as const;

export function thresholdCrossings(fromRank: number | null, toRank: number | null): { threshold: number; entered: boolean }[] {
  const inside = (rank: number | null, threshold: number) => rank !== null && rank <= threshold;
  const crossings: { threshold: number; entered: boolean }[] = [];
  for (const threshold of RANK_THRESHOLDS) {
    const was = inside(fromRank, threshold);
    const is = inside(toRank, threshold);
    if (was !== is) crossings.push({ threshold, entered: is });
  }
  return crossings;
}
