export type PricePolicy = 'NONE' | 'BETTER' | 'ANY';

export type PriceDecision = { ok: true; lockedPrice: number } | { ok: false; reason: 'PRICE_CHANGED' };

export function decidePrice(
  policy: PricePolicy,
  acceptedPrice: number,
  currentPrice: number,
  tolerance = 0,
): PriceDecision {
  if (policy === 'ANY') return { ok: true, lockedPrice: currentPrice };
  const floor = acceptedPrice * (1 - tolerance) - 1e-9;
  if (policy === 'BETTER')
    return currentPrice >= floor ? { ok: true, lockedPrice: currentPrice } : { ok: false, reason: 'PRICE_CHANGED' };
  if (tolerance <= 0)
    return Math.abs(currentPrice - acceptedPrice) < 0.005
      ? { ok: true, lockedPrice: acceptedPrice }
      : { ok: false, reason: 'PRICE_CHANGED' };
  const ceiling = acceptedPrice * (1 + tolerance) + 1e-9;
  return currentPrice >= floor && currentPrice <= ceiling
    ? { ok: true, lockedPrice: currentPrice }
    : { ok: false, reason: 'PRICE_CHANGED' };
}
