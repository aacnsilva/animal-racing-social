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

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationSettings = { enabled: boolean; types: Partial<Record<NotificationType, boolean>> };

export function isEnabled(settings: NotificationSettings | null | undefined, type: NotificationType): boolean {
  if (!settings) return true;
  if (!settings.enabled) return false;
  return settings.types[type] !== false;
}

export function settledType(outcome: string): NotificationType {
  if (outcome === 'WON') return 'BET_WON';
  if (outcome === 'VOID') return 'BET_VOID';
  return 'BET_LOST';
}
