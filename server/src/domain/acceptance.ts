export type PricePolicy = 'NONE' | 'BETTER' | 'ANY';

export type PriceDecision = { ok: true; lockedPrice: number } | { ok: false; reason: 'PRICE_CHANGED' };

export function decidePrice(policy: PricePolicy, acceptedPrice: number, currentPrice: number): PriceDecision {
  if (policy === 'ANY') return { ok: true, lockedPrice: currentPrice };
  if (policy === 'BETTER') return currentPrice + 1e-9 >= acceptedPrice ? { ok: true, lockedPrice: currentPrice } : { ok: false, reason: 'PRICE_CHANGED' };
  return Math.abs(currentPrice - acceptedPrice) < 0.005 ? { ok: true, lockedPrice: acceptedPrice } : { ok: false, reason: 'PRICE_CHANGED' };
}
