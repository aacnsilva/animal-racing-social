export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function priceFromProbability(probability: number, margin: number, runs = 5000): number {
  const floored = Math.max(probability, 0.5 / runs);
  return Math.min(1000, Math.max(1.01, round2(1 / (floored * (1 + margin)))));
}

export function harvilleProbability(win: Map<string, number>, order: readonly string[]): number {
  if (order.length !== 3 || new Set(order).size !== 3) return 0;
  const [a, b, c] = order.map((id) => win.get(id) ?? 0) as [number, number, number];
  if (a >= 1 || a + b >= 1) return 0;
  return a * (b / (1 - a)) * (c / (1 - a - b));
}

export function tricastPrice(win: Map<string, number>, order: readonly string[], margin: number): { price: number; probability: number } {
  const probability = harvilleProbability(win, order);
  return { price: priceFromProbability(probability, margin, 5000), probability };
}

export function product(values: readonly number[]): number {
  return values.reduce((acc, value) => acc * value, 1);
}

export function combinedPrice(prices: readonly number[]): number {
  return round4(product(prices));
}

export function payoutFor(stake: number, lockedPrice: number): number {
  return Math.floor(stake * lockedPrice + 1e-9);
}

export function cashOutAmount(stake: number, lockedPrices: readonly number[], probabilitiesNow: readonly number[], margin: number): number {
  const fair = stake * product(lockedPrices) * product(probabilitiesNow);
  return Math.max(0, Math.floor(fair * (1 - margin) + 1e-9));
}
