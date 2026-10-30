import { one, type Queryable } from './db.ts';

export type SeasonRow = {
  season_id: string;
  name: string;
  status: 'UPCOMING' | 'ACTIVE' | 'ENDED';
  starts_at: Date;
  ends_at: Date;
  last_race_at: Date;
  starting_grant: string;
  daily_grant: string;
  ending_notified_at: Date | null;
};

export function activeSeason(db: Queryable): Promise<SeasonRow | undefined> {
  return one<SeasonRow>(db, `SELECT * FROM season.seasons WHERE status = 'ACTIVE' ORDER BY starts_at DESC LIMIT 1`);
}

export function seasonJson(row: SeasonRow) {
  return {
    id: row.season_id,
    name: row.name,
    status: row.status,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    lastRaceAt: row.last_race_at.toISOString(),
    startingGrant: Number(row.starting_grant),
    dailyGrant: Number(row.daily_grant),
  };
}
