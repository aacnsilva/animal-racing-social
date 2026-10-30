import { friendlyCode } from './errors';
import { fmtPoints, titleCase } from './format';
import type { Notification } from './types';

export const NOTIFICATION_TYPES = [
  'RACE_STARTING',
  'BET_WON',
  'BET_LOST',
  'BET_VOID',
  'BET_REJECTED',
  'CASHOUT_DONE',
  'CASHOUT_REJECTED',
  'DAILY_REWARD_READY',
  'LEADERBOARD_MOVE',
  'SEASON_ENDING',
  'SEASON_RESULT',
] as const;

export const NOTIFICATION_LABEL: Record<string, string> = {
  RACE_STARTING: 'Race starting soon',
  BET_WON: 'Bet won',
  BET_LOST: 'Bet lost',
  BET_VOID: 'Bet voided',
  BET_REJECTED: 'Bet rejected',
  CASHOUT_DONE: 'Cash-out completed',
  CASHOUT_REJECTED: 'Cash-out rejected',
  DAILY_REWARD_READY: 'Daily reward ready',
  LEADERBOARD_MOVE: 'Leaderboard moves',
  SEASON_ENDING: 'Season ending',
  SEASON_RESULT: 'Season results',
};

export const NOTIFICATION_ICON: Record<string, string> = {
  RACE_STARTING: '⏱',
  BET_WON: '★',
  BET_LOST: '✕',
  BET_VOID: '↺',
  BET_REJECTED: '!',
  CASHOUT_DONE: '⇣',
  CASHOUT_REJECTED: '!',
  DAILY_REWARD_READY: '◎',
  LEADERBOARD_MOVE: '↑',
  SEASON_ENDING: '⌛',
  SEASON_RESULT: '♛',
};

const str = (value: unknown) => (value === undefined || value === null ? '' : String(value));

export function notificationText(n: Notification): string {
  const p = n.payload ?? {};
  const where = p.venueName ? ` at ${str(p.venueName)}` : '';
  switch (n.type) {
    case 'RACE_STARTING':
      return `A race you backed${where} starts in about 2 minutes.`;
    case 'BET_WON':
      return `Your bet${where} won ${fmtPoints(Number(p.payout ?? 0))} pts.`;
    case 'BET_LOST':
      return `Your bet${where} lost (stake ${fmtPoints(Number(p.stake ?? 0))} pts).`;
    case 'BET_VOID':
      return `Your bet${where} was voided and refunded.`;
    case 'BET_REJECTED':
      return `Your bet${where} was rejected: ${friendlyCode(str(p.reason))}`;
    case 'CASHOUT_DONE':
      return `Cashed out${where} for ${fmtPoints(Number(p.amount ?? 0))} pts.`;
    case 'CASHOUT_REJECTED':
      return `Cash-out rejected: ${friendlyCode(str(p.reason))}`;
    case 'DAILY_REWARD_READY':
      return `Your daily reward of ${fmtPoints(Number(p.amount ?? 50))} pts is ready to claim.`;
    case 'LEADERBOARD_MOVE':
      return p.entered
        ? `You entered the top ${str(p.threshold)} on the ${titleCase(str(p.board))} board (rank ${str(p.toRank)}).`
        : `You dropped out of the top ${str(p.threshold)} on the ${titleCase(str(p.board))} board.`;
    case 'SEASON_ENDING':
      return 'The season ends in 24 hours. Last chance to climb the boards.';
    case 'SEASON_RESULT':
      return `${str(p.seasonName) || 'The season'} is over: you finished #${str(p.rank)} of ${str(p.participants)} with ${fmtPoints(Number(p.score ?? 0))} pts.`;
    default:
      return titleCase(n.type);
  }
}

export function notificationLink(n: Notification): string | null {
  const p = n.payload ?? {};
  if (p.raceId) return `/races/${str(p.raceId)}`;
  if (n.type === 'DAILY_REWARD_READY') return '/wallet';
  if (n.type === 'LEADERBOARD_MOVE' || n.type === 'SEASON_RESULT') return '/leaderboards';
  return null;
}
