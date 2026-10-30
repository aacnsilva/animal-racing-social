import { ApiError } from './api';

const MESSAGES: Record<string, string> = {
  BETTING_CLOSED: 'Betting has closed for this market.',
  MARKET_SUSPENDED: 'This market is suspended for a moment. Try again shortly.',
  MARKET_CLOSED: 'This market has closed.',
  PRICE_CHANGED: 'The price moved before your bet was accepted.',
  INSUFFICIENT_FUNDS: 'You do not have enough points for that stake.',
  COMBO_SAME_RACE: 'Combo legs must come from different races.',
  COMBO_TOO_MANY_LEGS: 'A combo can have at most 8 legs.',
  COMBO_CROSS_SEASON: 'All combo legs must be in the same season.',
  INVALID_SELECTION: 'That selection is not valid for this market.',
  STAKE_OUT_OF_RANGE: 'Stake must be a whole number of points, at least 1.',
  IDEMPOTENCY_KEY_REQUIRED: 'The request was missing its idempotency key.',
  UNAUTHORIZED: 'Please sign in to continue.',
  FORBIDDEN: 'You do not have permission to do that.',
  BANNED: 'This account has been banned.',
  NOT_FOUND: 'We could not find that.',
  VALIDATION_FAILED: 'Some of the values are not valid.',
  RATE_LIMITED: 'Too many requests. Slow down a little.',
  QUOTE_EXPIRED: 'Prices moved and the cash-out quote expired. Try again.',
  NOT_CASHABLE: 'This bet cannot be cashed out right now.',
  ALREADY_SETTLED: 'This bet has already settled.',
  BELOW_MIN: 'The cash-out value dropped below your minimum.',
  ALREADY_CLAIMED: 'You already claimed today’s reward.',
  CONFLICT: 'That conflicts with the current state.',
  RACE_NOT_FINISHED: 'The race has not finished yet.',
  REPLAY_EXPIRED: 'The replay for this race is no longer available.',
  PROVIDER_ALREADY_LINKED: 'That account is already linked to another racer.',
  STATE_MISMATCH: 'Sign-in expired or was tampered with. Please try again.',
  PROVIDER_DENIED: 'Sign-in was cancelled at the provider.',
  PROVIDER_ERROR: 'The sign-in provider returned an error. Please try again.',
  NETWORK_ERROR: 'The server could not be reached. Check your connection.',
  SIGN_IN_REQUIRED: 'Sign in to place bets.',
};

export function friendlyCode(code: string | null | undefined): string {
  if (!code) return 'Something went wrong.';
  return MESSAGES[code] ?? code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function errorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  return 'UNKNOWN';
}

export function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    const base = MESSAGES[error.code];
    if (error.code === 'VALIDATION_FAILED' && error.message) return error.message;
    if (base) return base;
    return error.message || friendlyCode(error.code);
  }
  return (error as Error)?.message ?? 'Something went wrong.';
}
