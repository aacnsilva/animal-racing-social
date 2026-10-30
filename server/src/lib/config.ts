export function env(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing environment variable ${name}`);
}

export function envInt(name: string, fallback: number): number {
  const value = Number.parseInt(env(name, String(fallback)), 10);
  if (Number.isNaN(value)) throw new Error(`Environment variable ${name} must be an integer`);
  return value;
}

export function envFloat(name: string, fallback: number): number {
  const value = Number.parseFloat(env(name, String(fallback)));
  if (Number.isNaN(value)) throw new Error(`Environment variable ${name} must be a number`);
  return value;
}

export function envBool(name: string, fallback: boolean): boolean {
  return ['1', 'true', 'yes', 'on'].includes(env(name, String(fallback)).toLowerCase());
}

export const settings = {
  get tickMs() { return envInt('TICK_MS', 500); },
  get acceptDelayTicks() { return envInt('ACCEPT_DELAY_TICKS', 2); },
  get livePriceTolerance() { return envFloat('LIVE_PRICE_TOLERANCE', 0.1); },
  get oddsMargin() { return envFloat('ODDS_MARGIN', 0.05); },
  get cashOutMargin() { return envFloat('CASHOUT_MARGIN', 0.05); },
  get comboMaxLegs() { return envInt('COMBO_MAX_LEGS', 8); },
  get seasonLengthDays() { return envInt('SEASON_LENGTH_DAYS', 28); },
  get priceHistoryRetentionDays() { return envInt('PRICE_HISTORY_RETENTION_DAYS', 28); },
  get replayRetentionHours() { return envInt('REPLAY_RETENTION_HOURS', 24); },
};
