export type ComboLegCheck = { marketId: string; raceId: string; seasonId: string };

export type ComboViolation = 'COMBO_TOO_MANY_LEGS' | 'COMBO_SAME_RACE' | 'COMBO_CROSS_SEASON' | 'INVALID_SELECTION';

export function comboViolation(legs: readonly ComboLegCheck[], maxLegs: number): ComboViolation | null {
  if (legs.length < 2) return 'INVALID_SELECTION';
  if (legs.length > maxLegs) return 'COMBO_TOO_MANY_LEGS';
  if (new Set(legs.map((leg) => leg.raceId)).size !== legs.length) return 'COMBO_SAME_RACE';
  if (new Set(legs.map((leg) => leg.seasonId)).size !== 1) return 'COMBO_CROSS_SEASON';
  return null;
}
