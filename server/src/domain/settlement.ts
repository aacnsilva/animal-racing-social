import { payoutFor, product, round4 } from './pricing.ts';

export type LegState = { status: 'OPEN' | 'WON' | 'LOST' | 'VOID'; lockedPrice: number };

export type ComboOutcome = { status: 'OPEN' } | { status: 'WON' | 'LOST' | 'VOID'; payout: number; effectivePrice: number };

export function foldCombo(stake: number, legs: readonly LegState[]): ComboOutcome {
  if (legs.some((leg) => leg.status === 'LOST')) return { status: 'LOST', payout: 0, effectivePrice: 0 };
  if (legs.some((leg) => leg.status === 'OPEN')) return { status: 'OPEN' };
  if (legs.every((leg) => leg.status === 'VOID')) return { status: 'VOID', payout: stake, effectivePrice: 1 };
  const effectivePrice = round4(product(legs.map((leg) => (leg.status === 'WON' ? leg.lockedPrice : 1))));
  return { status: 'WON', payout: payoutFor(stake, effectivePrice), effectivePrice };
}

export function singleOutcome(stake: number, lockedPrice: number, legStatus: 'WON' | 'LOST' | 'VOID'): { status: 'WON' | 'LOST' | 'VOID'; payout: number } {
  if (legStatus === 'WON') return { status: 'WON', payout: payoutFor(stake, lockedPrice) };
  if (legStatus === 'VOID') return { status: 'VOID', payout: stake };
  return { status: 'LOST', payout: 0 };
}
