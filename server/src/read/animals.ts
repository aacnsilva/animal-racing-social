import { iso } from '../lib/time.ts';

export function statsOf(row: Record<string, any>, prefix: 'cur' | 'base') {
  return {
    velocity: Number(row[`${prefix}_velocity`]),
    stamina: Number(row[`${prefix}_stamina`]),
    acceleration: Number(row[`${prefix}_acceleration`]),
    consistency: Number(row[`${prefix}_consistency`]),
  };
}

export function animalSummary(row: Record<string, any>) {
  return {
    id: row.animal_id,
    name: row.name,
    species: row.species,
    status: row.status,
    ageWeeks: row.age_weeks,
    careerDay: row.career_day,
    lifeStage: row.life_stage,
    temperament: row.temperament,
    current: statsOf(row, 'cur'),
    form: { last5: row.last5 ?? [], races: row.races, wins: row.wins, podiums: row.podiums },
    restingUntil: row.resting_until && row.resting_until > new Date() ? iso(row.resting_until) : null,
  };
}

export function animalDetail(row: Record<string, any>, venueForm: Record<string, any>[], aging: Record<string, any>[]) {
  return {
    ...animalSummary(row),
    base: statsOf(row, 'base'),
    recruitedAt: iso(row.recruited_at),
    retiredAt: iso(row.retired_at),
    retireReason: row.retire_reason,
    venueForm: venueForm.map((form) => ({ venueId: form.venue_id, venueName: form.venue_name, races: form.races, wins: form.wins, podiums: form.podiums })),
    agingHistory: aging.map((day) => ({ day: day.day, careerDay: day.career_day, lifeStage: day.life_stage, stats: day.stats })),
  };
}
