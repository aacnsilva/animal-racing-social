import { BUCKETS, counter, histogram } from './telemetry.ts';

export const instruments = {
  betsPlaced: () => counter('ars.bets.placed', 'Bets placed through the API'),
  betsDecided: () => counter('ars.bets.decided', 'Bets accepted or rejected by the acceptance worker'),
  acceptanceDuration: () => histogram('ars.bet.acceptance.duration', 's', 'Time from bet request to decision', BUCKETS.acceptance),
  settlementLag: () => histogram('ars.bet.settlement.lag', 's', 'Time from the race finishing to the bet settling', BUCKETS.settlement),
  cashouts: () => counter('ars.cashouts', 'Cash-out requests by outcome'),
  pointsStaked: () => counter('ars.points.staked', 'Points staked on accepted bets'),
  pointsReturned: () => counter('ars.points.returned', 'Points returned by payouts, refunds and cash-outs'),
  ledgerEntries: () => counter('ars.ledger.entries', 'Ledger entries appended'),
  marketTransitions: () => counter('ars.market.transitions', 'Market status transitions'),
  schedulerSkipped: () => counter('ars.scheduler.skipped', 'Programme slots the scheduler could not fill'),
  notificationsCreated: () => counter('ars.notifications.created', 'In-app notifications created'),
  stableChanges: () => counter('ars.stable.changes', 'Animals recruited and retired'),
  authLogins: () => counter('ars.auth.logins', 'OAuth sign-in attempts by outcome'),
  authRefresh: () => counter('ars.auth.refresh', 'Session refreshes by outcome'),
  sseEvents: () => counter('ars.sse.events', 'Server-sent events written to clients'),
  leaderboardUpdate: () => histogram('ars.leaderboard.update.duration', 's', 'Time to update one leaderboard', BUCKETS.fast),
};

export function marketTransition(marketType: string, from: string, to: string, reason: string): void {
  instruments.marketTransitions().add(1, { market_type: marketType, from, to, reason });
}
