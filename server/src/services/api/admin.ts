import { sha256 } from '../../lib/crypto.ts';
import { decodeCursor, page, pageLimit } from '../../lib/cursor.ts';
import { many, one, tx, type Client } from '../../lib/db.ts';
import { accepted, ApiError, pathId, v, type Ctx, type Router } from '../../lib/http.ts';
import { newId } from '../../lib/ids.ts';
import { walletApi } from '../../lib/internal.ts';
import { payload, Topics } from '../../lib/kafka.ts';
import { enqueue, enqueueRaw } from '../../lib/outbox.ts';
import { activeSeason, seasonJson, type SeasonRow } from '../../lib/seasons.ts';
import { iso } from '../../lib/time.ts';
import { validateTemplate } from '../../domain/markets.ts';
import { validateProgramme } from '../../domain/scheduler.ts';
import { animalSummary } from '../../read/animals.ts';
import { venueJson } from './catalog.ts';
import { requireAdmin, type Deps } from './context.ts';
import { scriptBytes } from './races.ts';
import { userWithProviders } from './auth.ts';

const CLASSES = ['SPRINT', 'STANDARD', 'ENDURANCE'] as const;
const SURFACES = ['DIRT', 'GRASS', 'SAND', 'MUD', 'ICE'] as const;
const SEGMENTS = ['STRAIGHT', 'CURVE', 'UPHILL', 'DOWNHILL'] as const;

async function audit(client: Client, adminId: string, action: string, targetType: string, targetId: string, before: unknown, after: unknown, reason?: string): Promise<string> {
  const auditId = newId(0);
  await client.query(
    `INSERT INTO admin.audit_log (audit_id, admin_user_id, action, target_type, target_id, before, after, reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [auditId, adminId, action, targetType, targetId, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after), reason ?? null],
  );
  await enqueue(client, 'admin', Topics.adminAudit, targetId, payload('adminAudit', {
    auditId, adminUserId: adminId, action, targetType, targetId,
    beforeJson: before === undefined ? '' : JSON.stringify(before), afterJson: after === undefined ? '' : JSON.stringify(after), reason: reason ?? '',
  }));
  return auditId;
}

function programmeJson(row: Record<string, any>) {
  return {
    version: row.version,
    racesPerHour: row.races_per_hour,
    classMix: row.class_mix,
    speciesRotation: row.species_rotation,
    horizonHours: row.horizon_hours,
    recoveryMinutes: row.recovery_minutes,
    effectiveFrom: iso(row.effective_from),
  };
}

function parseVenue(body: Record<string, unknown>) {
  const segments = v.arr(body.segments, 'segments', { min: 2, max: 40 }).map((raw, index) => {
    const segment = v.obj(raw, `segments[${index}]`);
    const type = v.oneOf(segment.type, `segments[${index}].type`, SEGMENTS);
    if (type === 'CURVE') {
      return { type, radius: v.num(segment.radius, `segments[${index}].radius`, { min: 10, max: 200 }), angle: v.num(segment.angle, `segments[${index}].angle`, { min: -360, max: 360 }) };
    }
    const base = { type, length: v.num(segment.length, `segments[${index}].length`, { min: 5, max: 1000 }) };
    return type === 'STRAIGHT' ? base : { ...base, grade: v.num(segment.grade, `segments[${index}].grade`, { min: 0, max: 0.2 }) };
  });
  const lapsRange = v.arr(body.lapsRange, 'lapsRange', { min: 2, max: 2 }).map((laps, index) => v.int(laps, `lapsRange[${index}]`, { min: 1, max: 30 }));
  if (lapsRange[0]! > lapsRange[1]!) throw new ApiError(422, 'VALIDATION_FAILED', 'lapsRange must be ascending');
  const lapLength = segments.reduce((sum, segment) => {
    const s = segment as { radius?: number; angle?: number; length?: number };
    return sum + (s.radius !== undefined ? (s.radius * Math.abs(s.angle ?? 0) * Math.PI) / 180 : s.length ?? 0);
  }, 0);
  return {
    name: v.str(body.name, 'name', { max: 60 }),
    raceClass: v.oneOf(body.class, 'class', CLASSES),
    surface: v.oneOf(body.surface, 'surface', SURFACES),
    description: body.description === undefined ? '' : v.str(body.description, 'description', { min: 0, max: 300 }),
    segments,
    lapsRange,
    lapLength: Math.round(lapLength * 100) / 100,
    assets: body.assets === undefined ? {} : v.obj(body.assets, 'assets'),
  };
}

async function insertVenue(client: Client, venueId: string, version: number, venue: ReturnType<typeof parseVenue>, status: string) {
  return (await one(
    client,
    `INSERT INTO racing.venues (venue_id, version, name, race_class, surface, lanes, lap_length, laps_min, laps_max, segments, assets, status, description)
     VALUES ($1, $2, $3, $4, $5, 10, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [venueId, version, venue.name, venue.raceClass, venue.surface, venue.lapLength, venue.lapsRange[0], venue.lapsRange[1],
      JSON.stringify(venue.segments), JSON.stringify(venue.assets), status, venue.description],
  ))!;
}

export function adminRoutes(router: Router, deps: Deps): void {
  const admin = (ctx: Ctx) => requireAdmin(ctx, deps);

  router.get('/v1/admin/programme', async (ctx) => {
    await admin(ctx);
    const row = await one(deps.pool, 'SELECT * FROM racing.programme ORDER BY version DESC LIMIT 1');
    return row ? programmeJson(row) : null;
  });

  router.put('/v1/admin/programme', async (ctx) => {
    const { userId } = await admin(ctx);
    let programme;
    try {
      programme = validateProgramme(await ctx.body());
    } catch (error) {
      throw new ApiError(422, 'VALIDATION_FAILED', (error as Error).message);
    }
    return tx(deps.pool, async (client) => {
      const before = await one(client, 'SELECT * FROM racing.programme ORDER BY version DESC LIMIT 1 FOR UPDATE');
      const row = (await one(
        client,
        `INSERT INTO racing.programme (version, races_per_hour, class_mix, species_rotation, horizon_hours, recovery_minutes, effective_from, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7) RETURNING *`,
        [(before?.version ?? 0) + 1, programme.racesPerHour, JSON.stringify(programme.classMix), programme.speciesRotation, programme.horizonHours,
          JSON.stringify(programme.recoveryMinutes), userId],
      ))!;
      await audit(client, userId, 'programme.update', 'programme', String(row.version), before ? programmeJson(before) : null, programmeJson(row));
      return programmeJson(row);
    });
  });

  router.post('/v1/admin/races', async (ctx) => {
    const { userId } = await admin(ctx);
    const body = await ctx.body();
    const startAt = v.date(body.startAt, 'startAt');
    if (startAt.getTime() < Date.now() + 65_000) throw new ApiError(422, 'VALIDATION_FAILED', 'startAt must be at least 65 seconds in the future');
    if (startAt.getTime() > Date.now() + 48 * 3600_000) throw new ApiError(422, 'VALIDATION_FAILED', 'startAt must be within 48 hours');
    const species = v.oneOf(body.species, 'species', ['HORSE', 'GIRAFFE'] as const);
    const raceClass = v.oneOf(body.class, 'class', CLASSES);
    const venueId = body.venueId === undefined || body.venueId === null ? undefined : v.str(body.venueId, 'venueId');
    const fieldSize = body.fieldSize === undefined || body.fieldSize === null ? undefined : v.int(body.fieldSize, 'fieldSize', { min: 6, max: 10 });
    const raceId = newId(0);
    await tx(deps.pool, async (client) => {
      await enqueue(client, 'admin', Topics.raceCommands, raceId, payload('scheduleRace', {
        raceId, startAt: startAt.toISOString(), species, raceClass, venueId, fieldSize, adminUserId: userId,
      }));
      await audit(client, userId, 'race.schedule', 'race', raceId, null, { startAt, species, raceClass, venueId, fieldSize });
    });
    return accepted({ raceId });
  });

  router.post('/v1/admin/races/:raceId/cancel', async (ctx) => {
    const { userId } = await admin(ctx);
    const raceId = pathId(ctx, 'raceId');
    const body = await ctx.body();
    const reason = body.reason === undefined ? 'ADMIN' : v.str(body.reason, 'reason', { max: 200 });
    const race = await one(deps.pool, 'SELECT status FROM racing.races WHERE race_id = $1', [raceId]);
    if (!race) throw new ApiError(404, 'NOT_FOUND', 'Unknown race');
    if (['FINISHED', 'SETTLED', 'CANCELLED'].includes(race.status)) throw new ApiError(409, 'CONFLICT', `Race is already ${race.status}`);
    await tx(deps.pool, async (client) => {
      await enqueue(client, 'admin', Topics.raceCommands, raceId, payload('cancelRace', { raceId, reason, adminUserId: userId }));
      await audit(client, userId, 'race.cancel', 'race', raceId, { status: race.status }, { status: 'CANCELLED' }, reason);
    });
    return accepted({ raceId });
  });

  router.get('/v1/admin/races/:raceId/debug', async (ctx) => {
    await admin(ctx);
    const raceId = pathId(ctx, 'raceId');
    const race = await one(deps.pool, 'SELECT * FROM racing.races WHERE race_id = $1', [raceId]);
    if (!race) throw new ApiError(404, 'NOT_FOUND', 'Unknown race');
    const script = JSON.parse((await scriptBytes(deps, raceId)).toString('utf8'));
    return { race: { ...race, seed: race.seed?.toString('hex'), seed_hash: race.seed_hash?.toString('hex'), script_hash: race.script_hash?.toString('hex') }, script };
  });

  router.get('/v1/admin/market-templates/:raceClass', async (ctx) => {
    await admin(ctx);
    const raceClass = v.oneOf(ctx.params.raceClass, 'class', CLASSES);
    const row = await one(deps.pool, 'SELECT * FROM market.market_templates WHERE race_class = $1 AND is_active', [raceClass]);
    return row ? { class: raceClass, version: row.version, ...row.definition } : null;
  });

  router.put('/v1/admin/market-templates/:raceClass', async (ctx) => {
    const { userId } = await admin(ctx);
    const raceClass = v.oneOf(ctx.params.raceClass, 'class', CLASSES);
    const body = await ctx.body();
    let markets;
    try {
      markets = validateTemplate(body.markets);
    } catch (error) {
      throw new ApiError(422, 'VALIDATION_FAILED', (error as Error).message);
    }
    return tx(deps.pool, async (client) => {
      const before = await one(client, 'SELECT * FROM market.market_templates WHERE race_class = $1 AND is_active FOR UPDATE', [raceClass]);
      const latest = await one(client, 'SELECT max(version) AS version FROM market.market_templates WHERE race_class = $1', [raceClass]);
      await client.query('UPDATE market.market_templates SET is_active = false WHERE race_class = $1', [raceClass]);
      const version = (latest?.version ?? 0) + 1;
      await client.query(
        'INSERT INTO market.market_templates (race_class, version, definition, is_active, created_by) VALUES ($1, $2, $3, true, $4)',
        [raceClass, version, JSON.stringify({ markets }), userId],
      );
      await audit(client, userId, 'market-template.update', 'market-template', raceClass, before?.definition ?? null, { markets });
      return { class: raceClass, version, markets };
    });
  });

  for (const action of ['suspend', 'resume', 'void'] as const) {
    router.post(`/v1/admin/markets/:marketId/${action}`, async (ctx) => {
      const { userId } = await admin(ctx);
      const marketId = pathId(ctx, 'marketId');
      const body = await ctx.body();
      const reason = body.reason === undefined ? 'MANUAL' : v.str(body.reason, 'reason', { max: 200 });
      const market = await one(deps.pool, 'SELECT race_id, status FROM market.markets WHERE market_id = $1', [marketId]);
      if (!market) throw new ApiError(404, 'NOT_FOUND', 'Unknown market');
      await tx(deps.pool, async (client) => {
        await enqueue(client, 'admin', Topics.raceCommands, market.race_id, payload('marketCommand', {
          marketId, raceId: market.race_id, action: action.toUpperCase(), reason, adminUserId: userId,
        }));
        await audit(client, userId, `market.${action}`, 'market', marketId, { status: market.status }, { action }, reason);
      });
      return accepted({ marketId });
    });
  }

  router.get('/v1/admin/venues', async (ctx) => {
    await admin(ctx);
    const rows = await many(deps.pool, 'SELECT * FROM racing.venues ORDER BY venue_id, version DESC');
    return rows.map(venueJson);
  });

  router.post('/v1/admin/venues', async (ctx) => {
    const { userId } = await admin(ctx);
    const body = await ctx.body();
    const venueId = v.str(body.id, 'id', { max: 40 });
    if (!/^v_[a-z0-9_]+$/.test(venueId)) throw new ApiError(422, 'VALIDATION_FAILED', 'id must look like v_name');
    const venue = parseVenue(body);
    return tx(deps.pool, async (client) => {
      const exists = await one(client, 'SELECT 1 FROM racing.venues WHERE venue_id = $1', [venueId]);
      if (exists) throw new ApiError(409, 'CONFLICT', 'Venue id already exists');
      const row = await insertVenue(client, venueId, 1, venue, 'ACTIVE');
      await audit(client, userId, 'venue.create', 'venue', venueId, null, venueJson(row));
      return venueJson(row);
    });
  });

  router.put('/v1/admin/venues/:venueId', async (ctx) => {
    const { userId } = await admin(ctx);
    const venue = parseVenue(await ctx.body());
    return tx(deps.pool, async (client) => {
      const latest = await one(client, 'SELECT * FROM racing.venues WHERE venue_id = $1 ORDER BY version DESC LIMIT 1 FOR UPDATE', [ctx.params.venueId]);
      if (!latest) throw new ApiError(404, 'NOT_FOUND', 'Unknown venue');
      const row = await insertVenue(client, ctx.params.venueId!, latest.version + 1, venue, 'ACTIVE');
      await audit(client, userId, 'venue.publish', 'venue', ctx.params.venueId!, venueJson(latest), venueJson(row));
      return venueJson(row);
    });
  });

  router.post('/v1/admin/venues/:venueId/retire', async (ctx) => {
    const { userId } = await admin(ctx);
    return tx(deps.pool, async (client) => {
      const latest = await one(client, 'SELECT * FROM racing.venues WHERE venue_id = $1 ORDER BY version DESC LIMIT 1 FOR UPDATE', [ctx.params.venueId]);
      if (!latest) throw new ApiError(404, 'NOT_FOUND', 'Unknown venue');
      if (latest.status === 'RETIRED') return venueJson(latest);
      const json = venueJson(latest);
      const row = await insertVenue(client, ctx.params.venueId!, latest.version + 1, {
        name: json.name, raceClass: json.class, surface: json.surface, description: json.description, segments: json.segments,
        lapsRange: json.lapsRange, lapLength: json.lapLength, assets: json.assets,
      }, 'RETIRED');
      await audit(client, userId, 'venue.retire', 'venue', ctx.params.venueId!, json, venueJson(row));
      return venueJson(row);
    });
  });

  router.get('/v1/admin/engine/versions', async (ctx) => {
    await admin(ctx);
    const rows = await many(deps.pool, 'SELECT engine_version, params_hash, is_active, replayable, created_at FROM racing.engine_versions ORDER BY created_at');
    return rows.map((row) => ({
      engineVersion: row.engine_version, paramsHash: row.params_hash.toString('hex'), isActive: row.is_active, replayable: row.replayable, createdAt: iso(row.created_at),
    }));
  });

  router.put('/v1/admin/engine/active', async (ctx) => {
    const { userId } = await admin(ctx);
    const engineVersion = v.str((await ctx.body()).engineVersion, 'engineVersion');
    return tx(deps.pool, async (client) => {
      const target = await one(client, 'SELECT replayable FROM racing.engine_versions WHERE engine_version = $1', [engineVersion]);
      if (!target) throw new ApiError(404, 'NOT_FOUND', 'Unknown engine version');
      if (!target.replayable) throw new ApiError(409, 'CONFLICT', 'That engine version is not deployed');
      const before = await one(client, 'SELECT engine_version FROM racing.engine_versions WHERE is_active');
      await client.query('UPDATE racing.engine_versions SET is_active = false WHERE is_active');
      await client.query('UPDATE racing.engine_versions SET is_active = true WHERE engine_version = $1', [engineVersion]);
      await audit(client, userId, 'engine.activate', 'engine', engineVersion, before, { engineVersion });
      return { engineVersion };
    });
  });

  router.get('/v1/admin/engine/params/:version', async (ctx) => {
    await admin(ctx);
    const row = await one(deps.pool, 'SELECT engine_version, params FROM racing.engine_versions WHERE engine_version = $1', [ctx.params.version]);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Unknown engine version');
    return { engineVersion: row.engine_version, params: row.params };
  });

  router.put('/v1/admin/engine/params/:version', async (ctx) => {
    const { userId } = await admin(ctx);
    const params = v.obj((await ctx.body()).params, 'params');
    return tx(deps.pool, async (client) => {
      const source = await one(client, 'SELECT engine_version FROM racing.engine_versions WHERE engine_version = $1', [ctx.params.version]);
      if (!source) throw new ApiError(404, 'NOT_FOUND', 'Unknown engine version');
      const core = source.engine_version.split('+')[0];
      const variants = await one(client, `SELECT count(*)::int AS n FROM racing.engine_versions WHERE engine_version LIKE $1`, [`${core}+p%`]);
      const engineVersion = `${core}+p${variants!.n + 2}`;
      const text = JSON.stringify({ ...params, version: engineVersion });
      await client.query(
        'INSERT INTO racing.engine_versions (engine_version, params, params_hash, is_active, replayable) VALUES ($1, $2, $3, false, true)',
        [engineVersion, text, sha256(text)],
      );
      await audit(client, userId, 'engine.params', 'engine', engineVersion, { from: source.engine_version }, { engineVersion });
      return { engineVersion };
    });
  });

  router.get('/v1/admin/animals', async (ctx) => {
    await admin(ctx);
    const limit = pageLimit(ctx.query, 50);
    const cursor = decodeCursor(ctx.query.get('cursor'));
    const rows = await many(
      deps.pool,
      `SELECT * FROM stable.animals WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR species = $2)
         AND ($3::text IS NULL OR (name, animal_id) > ($3, $4::bigint)) ORDER BY name, animal_id LIMIT $5`,
      [ctx.query.get('status'), ctx.query.get('species'), cursor?.[0] ?? null, cursor?.[1] ?? '0', limit + 1],
    );
    return page(rows.map(animalSummary), limit, (animal) => [animal.name, animal.id]);
  });

  router.post('/v1/admin/animals/:animalId/retire', async (ctx) => {
    const { userId } = await admin(ctx);
    const animalId = pathId(ctx, 'animalId');
    return tx(deps.pool, async (client) => {
      const animal = await one(client, 'SELECT * FROM stable.animals WHERE animal_id = $1 FOR UPDATE', [animalId]);
      if (!animal) throw new ApiError(404, 'NOT_FOUND', 'Unknown animal');
      if (animal.status === 'RETIRED') return animalSummary(animal);
      const row = (await one(client, `UPDATE stable.animals SET status = 'RETIRED', retired_at = now(), retire_reason = 'ADMIN' WHERE animal_id = $1 RETURNING *`, [animalId]))!;
      await enqueue(client, 'admin', Topics.stableEvents, animalId, payload('animalRetired', {
        animalId, reason: 'ADMIN', careerStats: { races: animal.races, wins: animal.wins, podiums: animal.podiums },
      }));
      await audit(client, userId, 'animal.retire', 'animal', animalId, { status: 'ACTIVE' }, { status: 'RETIRED' });
      return animalSummary(row);
    });
  });

  router.put('/v1/admin/stable/pool-size', async (ctx) => {
    const { userId } = await admin(ctx);
    const body = await ctx.body();
    const species = v.oneOf(body.species, 'species', ['HORSE', 'GIRAFFE'] as const);
    const size = v.int(body.size, 'size', { min: 20, max: 500 });
    return tx(deps.pool, async (client) => {
      const before = await one(client, 'SELECT target_pool_size FROM stable.species WHERE species = $1 FOR UPDATE', [species]);
      await client.query('UPDATE stable.species SET target_pool_size = $2 WHERE species = $1', [species, size]);
      await audit(client, userId, 'stable.pool-size', 'species', species, before, { size });
      return { species, size };
    });
  });

  router.get('/v1/admin/seasons', async (ctx) => {
    await admin(ctx);
    return (await many<SeasonRow>(deps.pool, 'SELECT * FROM season.seasons ORDER BY starts_at DESC')).map(seasonJson);
  });

  const seasonInput = (body: Record<string, unknown>) => {
    const startsAt = v.date(body.startsAt, 'startsAt');
    const endsAt = v.date(body.endsAt, 'endsAt');
    if (startsAt <= new Date()) throw new ApiError(422, 'VALIDATION_FAILED', 'startsAt must be in the future');
    if (endsAt.getTime() - startsAt.getTime() < 2 * 3600_000) throw new ApiError(422, 'VALIDATION_FAILED', 'A season must last at least 2 hours');
    return {
      name: v.str(body.name, 'name', { max: 60 }),
      startsAt,
      endsAt,
      startingGrant: body.startingGrant === undefined ? 10000 : v.int(body.startingGrant, 'startingGrant', { min: 1 }),
      dailyGrant: body.dailyGrant === undefined ? 50 : v.int(body.dailyGrant, 'dailyGrant', { min: 0 }),
    };
  };

  router.post('/v1/admin/seasons', async (ctx) => {
    const { userId } = await admin(ctx);
    const input = seasonInput(await ctx.body());
    return tx(deps.pool, async (client) => {
      const row = await one<SeasonRow>(
        client,
        `INSERT INTO season.seasons (season_id, name, status, starts_at, ends_at, last_race_at, starting_grant, daily_grant)
         VALUES ($1, $2, 'UPCOMING', $3, $4, $4::timestamptz - interval '1 hour', $5, $6) RETURNING *`,
        [newId(0), input.name, input.startsAt, input.endsAt, input.startingGrant, input.dailyGrant],
      ).catch((error) => {
        if (error.code === '23P01') throw new ApiError(409, 'CONFLICT', 'Seasons cannot overlap');
        throw error;
      });
      await audit(client, userId, 'season.create', 'season', row!.season_id, null, seasonJson(row!));
      return seasonJson(row!);
    });
  });

  router.put('/v1/admin/seasons/:seasonId', async (ctx) => {
    const { userId } = await admin(ctx);
    const seasonId = pathId(ctx, 'seasonId');
    const input = seasonInput(await ctx.body());
    return tx(deps.pool, async (client) => {
      const before = await one<SeasonRow>(client, 'SELECT * FROM season.seasons WHERE season_id = $1 FOR UPDATE', [seasonId]);
      if (!before) throw new ApiError(404, 'NOT_FOUND', 'Unknown season');
      if (before.status !== 'UPCOMING') throw new ApiError(409, 'CONFLICT', 'Only upcoming seasons can be edited');
      const row = await one<SeasonRow>(
        client,
        `UPDATE season.seasons SET name = $2, starts_at = $3, ends_at = $4, last_race_at = $4::timestamptz - interval '1 hour', starting_grant = $5, daily_grant = $6
         WHERE season_id = $1 RETURNING *`,
        [seasonId, input.name, input.startsAt, input.endsAt, input.startingGrant, input.dailyGrant],
      ).catch((error) => {
        if (error.code === '23P01') throw new ApiError(409, 'CONFLICT', 'Seasons cannot overlap');
        throw error;
      });
      await audit(client, userId, 'season.update', 'season', seasonId, seasonJson(before), seasonJson(row!));
      return seasonJson(row!);
    });
  });

  router.get('/v1/admin/users', async (ctx) => {
    await admin(ctx);
    const q = ctx.query.get('q')?.trim() ?? '';
    const rows = await many(
      deps.pool,
      `SELECT * FROM identity.users WHERE $1 = '' OR display_name ILIKE '%' || $1 || '%' OR user_id::text = $1 ORDER BY created_at DESC LIMIT 50`,
      [q],
    );
    return { items: rows.map((row) => ({ userId: row.user_id, displayName: row.display_name, role: row.role, bannedAt: iso(row.banned_at), createdAt: iso(row.created_at) })) };
  });

  router.get('/v1/admin/users/:userId', async (ctx) => {
    await admin(ctx);
    const userId = pathId(ctx, 'userId');
    const user = await userWithProviders(deps.pool, userId);
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'Unknown user');
    const row = await one(deps.pool, 'SELECT banned_at, ban_reason FROM identity.users WHERE user_id = $1', [userId]);
    const wallets = await many(deps.pool, 'SELECT season_id, balance, open_stake FROM wallet.wallets WHERE user_id = $1 ORDER BY season_id DESC', [userId]);
    return {
      ...user,
      bannedAt: iso(row?.banned_at),
      banReason: row?.ban_reason ?? null,
      wallets: wallets.map((w) => ({ seasonId: w.season_id, balance: Number(w.balance), inOpenBets: Number(w.open_stake) })),
    };
  });

  router.get('/v1/admin/users/:userId/ledger', async (ctx) => {
    await admin(ctx);
    const rows = await many(deps.pool, 'SELECT * FROM wallet.ledger_entries WHERE user_id = $1 ORDER BY created_at DESC, entry_id DESC LIMIT 200', [pathId(ctx, 'userId')]);
    return {
      items: rows.map((row) => ({
        entryId: row.entry_id, seasonId: row.season_id, type: row.type, amount: Number(row.amount), refId: row.ref_id, balanceAfter: Number(row.balance_after), createdAt: iso(row.created_at),
      })),
    };
  });

  router.post('/v1/admin/users/:userId/adjust', async (ctx) => {
    const { userId: adminId } = await admin(ctx);
    const userId = pathId(ctx, 'userId');
    const body = await ctx.body();
    const amount = v.int(body.amount, 'amount');
    if (amount === 0) throw new ApiError(422, 'VALIDATION_FAILED', 'amount must not be zero');
    const reason = v.str(body.reason, 'reason', { max: 200 });
    const season = await activeSeason(deps.pool);
    if (!season) throw new ApiError(409, 'CONFLICT', 'No active season');
    const auditId = await tx(deps.pool, (client) => audit(client, adminId, 'user.adjust', 'user', userId, null, { amount, seasonId: season.season_id }, reason));
    const result = await walletApi.adjust(userId, season.season_id, amount, `admin:${auditId}`, reason);
    return { balance: result.balance };
  });

  router.post('/v1/admin/users/:userId/ban', async (ctx) => {
    const { userId: adminId } = await admin(ctx);
    const userId = pathId(ctx, 'userId');
    const body = await ctx.body();
    const banned = body.banned === undefined ? true : v.bool(body.banned, 'banned');
    const reason = body.reason === undefined ? null : v.str(body.reason, 'reason', { max: 200 });
    if (userId === adminId && banned) throw new ApiError(409, 'CONFLICT', 'Admins cannot ban themselves');
    return tx(deps.pool, async (client) => {
      const before = await one(client, 'SELECT banned_at FROM identity.users WHERE user_id = $1 FOR UPDATE', [userId]);
      if (!before) throw new ApiError(404, 'NOT_FOUND', 'Unknown user');
      await client.query('UPDATE identity.users SET banned_at = $2, ban_reason = $3 WHERE user_id = $1', [userId, banned ? new Date() : null, banned ? reason : null]);
      if (banned) await client.query('UPDATE identity.refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await audit(client, adminId, banned ? 'user.ban' : 'user.unban', 'user', userId, { bannedAt: iso(before.banned_at) }, { banned }, reason ?? undefined);
      return { userId, banned };
    });
  });

  router.get('/v1/admin/dlq', async (ctx) => {
    await admin(ctx);
    const rows = await many(deps.pool, 'SELECT dlq_id, consumer, topic, partition, msg_offset, msg_key, event_type, error, created_at, replayed_at FROM admin.dlq ORDER BY dlq_id DESC LIMIT 200');
    return {
      items: rows.map((row) => ({
        id: String(row.dlq_id), consumer: row.consumer, topic: row.topic, partition: row.partition, offset: row.msg_offset, key: row.msg_key,
        eventType: row.event_type, error: row.error, createdAt: iso(row.created_at), replayedAt: iso(row.replayed_at),
      })),
    };
  });

  router.post('/v1/admin/dlq/:dlqId/replay', async (ctx) => {
    const { userId } = await admin(ctx);
    const dlqId = pathId(ctx, 'dlqId');
    return tx(deps.pool, async (client) => {
      const row = await one(client, 'SELECT * FROM admin.dlq WHERE dlq_id = $1 FOR UPDATE', [dlqId]);
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Unknown DLQ entry');
      await enqueueRaw(client, 'admin', row.topic, row.msg_key ?? dlqId, row.event_type ?? 'Unknown', row.payload, row.headers ?? {});
      await client.query('UPDATE admin.dlq SET replayed_at = now(), replayed_by = $2 WHERE dlq_id = $1', [dlqId, userId]);
      await audit(client, userId, 'dlq.replay', 'dlq', dlqId, null, { topic: row.topic });
      return { id: dlqId, replayed: true };
    });
  });

  router.get('/v1/admin/audit', async (ctx) => {
    await admin(ctx);
    const limit = pageLimit(ctx.query, 50);
    const cursor = decodeCursor(ctx.query.get('cursor'));
    const rows = await many(
      deps.pool,
      `SELECT a.*, u.display_name FROM admin.audit_log a LEFT JOIN identity.users u ON u.user_id = a.admin_user_id
       WHERE ($1::bigint IS NULL OR a.audit_id < $1) ORDER BY a.audit_id DESC LIMIT $2`,
      [cursor?.[0] ?? null, limit + 1],
    );
    return page(rows.map((row) => ({
      id: row.audit_id, adminUserId: row.admin_user_id, adminName: row.display_name, action: row.action, targetType: row.target_type,
      targetId: row.target_id, before: row.before, after: row.after, reason: row.reason, createdAt: iso(row.created_at),
    })), limit, (entry) => [entry.id]);
  });
}
