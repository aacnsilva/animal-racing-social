export type LifeStage = 'ROOKIE' | 'PRIME' | 'VETERAN';
export type Stats = { velocity: number; stamina: number; acceleration: number; consistency: number };

export type SpeciesConfig = {
  species: string;
  maxCareerDays: number;
  lifeStages: Record<LifeStage, [number, number]>;
  ageCurve: [number, number][];
  retireThreshold: number;
  targetPoolSize: number;
  baseRanges: Record<keyof Stats, [number, number]>;
};

export function interpolate(curve: readonly [number, number][], day: number): number {
  if (curve.length === 0) return 1;
  if (day <= curve[0]![0]) return curve[0]![1];
  for (let i = 1; i < curve.length; i++) {
    const [d1, f1] = curve[i]!;
    const [d0, f0] = curve[i - 1]!;
    if (day <= d1) return f0 + ((f1 - f0) * (day - d0)) / (d1 - d0);
  }
  return curve[curve.length - 1]![1];
}

export function ageFactor(config: SpeciesConfig, careerDay: number, declineRate = 1): number {
  const base = interpolate(config.ageCurve, careerDay);
  const veteranStart = config.lifeStages.VETERAN[0];
  if (careerDay <= veteranStart) return base;
  const atVeteran = interpolate(config.ageCurve, veteranStart);
  return atVeteran - (atVeteran - base) * declineRate;
}

export function lifeStage(config: SpeciesConfig, careerDay: number): LifeStage {
  if (careerDay < config.lifeStages.PRIME[0]) return 'ROOKIE';
  if (careerDay < config.lifeStages.VETERAN[0]) return 'PRIME';
  return 'VETERAN';
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function currentStats(base: Stats, factor: number): Stats {
  return {
    velocity: round3(base.velocity * factor),
    stamina: round3(base.stamina * factor),
    acceleration: round3(base.acceleration * factor),
    consistency: round3(Math.min(1, base.consistency * factor)),
  };
}

export function retirementReason(config: SpeciesConfig, careerDay: number, factor: number): 'AGE' | 'DECLINE' | null {
  if (careerDay >= config.maxCareerDays) return 'AGE';
  if (careerDay >= config.lifeStages.VETERAN[0] && factor < config.retireThreshold) return 'DECLINE';
  return null;
}

export function randomBase(config: SpeciesConfig, random: () => number = Math.random): Stats {
  const pick = (range: [number, number]) => round3(range[0] + (range[1] - range[0]) * random());
  return {
    velocity: pick(config.baseRanges.velocity),
    stamina: pick(config.baseRanges.stamina),
    acceleration: pick(config.baseRanges.acceleration),
    consistency: pick(config.baseRanges.consistency),
  };
}

export function formToken(resultStatus: string, position: number): string {
  if (resultStatus === 'DISQUALIFIED') return 'DQ';
  if (resultStatus === 'DNF') return 'DNF';
  if (resultStatus === 'NON_RUNNER') return 'NR';
  return String(position);
}

export function pushForm(last5: readonly string[], token: string): string[] {
  return [token, ...last5].slice(0, 5);
}
