use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime};

use ars_infra::kafka::{RACE_LIFECYCLE, RACE_TICKS};
use ars_infra::sealing::decompress;
use ars_infra::time::{format_rfc3339, unix_millis};
use ars_infra::{Context, Res, log};
use ars_proto::envelope::Payload;
use ars_proto::{LapCompleted, RaceStarted};
use race_engine_core::{EventKind, RaceScript, ScriptTick};
use redis::AsyncCommands;

use crate::Ctx;
use crate::publish::{entrant_number, finished_message, standings, state_json, tick_message};

pub const STATE_TTL_SECONDS: u64 = 7200;

pub fn state_key(race_id: i64) -> String {
    format!("race:{race_id}:state")
}

pub async fn sleep_until(target: SystemTime) {
    if let Ok(wait) = target.duration_since(SystemTime::now()) {
        tokio::time::sleep(wait).await;
    }
}

struct Loaded {
    script: RaceScript,
    compressed: Vec<u8>,
    key_id: String,
    seed_ciphertext: Vec<u8>,
}

async fn load_script(ctx: &Ctx, race_id: i64) -> Res<Loaded> {
    let row = {
        let conn = ctx.db.acquire().await?;
        conn.query_opt(
            "SELECT key_id, seed_ciphertext, script_ciphertext FROM sealed.race_scripts WHERE race_id = $1",
            &[&race_id],
        )
        .await
        .context("load sealed script")?
        .context("SEALED_SCRIPT_NOT_FOUND")?
    };
    let key_id: String = row.get(0);
    let seed_ciphertext: Vec<u8> = row.get(1);
    let script_ciphertext: Vec<u8> = row.get(2);
    let aad = race_id.to_string();
    let compressed = ctx.keyring.open(&key_id, &aad, &script_ciphertext)?;
    let decoded = compressed.clone();
    let script = tokio::task::spawn_blocking(move || {
        let json = decompress(&decoded)?;
        RaceScript::from_json_bytes(&json).map_err(|err| err.to_string())
    })
    .await
    .context("parse task")??;
    Ok(Loaded { script, compressed, key_id, seed_ciphertext })
}

async fn current_status(ctx: &Ctx, race_id: i64) -> Res<Option<(String, Option<SystemTime>)>> {
    let conn = ctx.db.acquire().await?;
    let row = conn
        .query_opt("SELECT status, started_at FROM racing.races WHERE race_id = $1", &[&race_id])
        .await
        .context("load race status")?;
    Ok(row.map(|row| (row.get(0), row.get(1))))
}

async fn last_published_tick(ctx: &Ctx, race_id: i64) -> Option<u32> {
    let mut redis = ctx.redis.clone();
    let text: Option<String> = redis.get(state_key(race_id)).await.ok().flatten();
    let value: serde_json::Value = serde_json::from_str(&text?).ok()?;
    value["tick"].as_u64().map(|tick| tick as u32)
}

async fn write_state(ctx: &Ctx, race_id: i64, status: &str, tick: &ScriptTick, tick_ms: u32, start_at: &str) {
    let mut redis = ctx.redis.clone();
    let body = state_json(race_id, status, tick, tick_ms, start_at);
    let result: redis::RedisResult<()> = redis.set_ex(state_key(race_id), body, STATE_TTL_SECONDS).await;
    if let Err(err) = result {
        log::warn(format!("race {race_id}: redis state write failed: {err}"));
    }
}

async fn publish_lap_events(ctx: &Ctx, race_id: i64, tick: &ScriptTick) -> Res<()> {
    for event in tick.events.iter().filter(|event| event.kind == EventKind::Lap) {
        let payload = Payload::LapCompleted(LapCompleted {
            race_id,
            tick: tick.tick,
            lap: event.lap.unwrap_or(tick.lap),
            leader_entrant_id: event.id.clone().unwrap_or_default(),
            standings: standings(tick),
        });
        ctx.producer.publish_payload(RACE_TICKS, &race_id.to_string(), payload).await?;
    }
    Ok(())
}

async fn publish_tick(ctx: &Ctx, race_id: i64, tick: &ScriptTick, tick_ms: u32, start_at: &str) -> Res<()> {
    let key = race_id.to_string();
    let message = Payload::RaceTick(tick_message(race_id, tick));
    if let Err(err) = ctx.producer.publish_payload(RACE_TICKS, &key, message).await {
        log::warn(format!("race {race_id}: tick {} not published: {err}", tick.tick));
    }
    publish_lap_events(ctx, race_id, tick).await?;
    write_state(ctx, race_id, "LIVE", tick, tick_ms, start_at).await;
    Ok(())
}

pub async fn run_race(ctx: Arc<Ctx>, race_id: i64, start_at: SystemTime, cancelled: Arc<AtomicBool>) -> Res<()> {
    let start_text = format_rfc3339(start_at);
    let (initial_status, _) = current_status(&ctx, race_id).await?.context("RACE_NOT_FOUND")?;
    let loaded = load_script(&ctx, race_id).await?;
    let script = &loaded.script;
    let tick_ms = script.tick_ms.max(1);
    let finish_tick = script.result.finish_tick;
    let mut resuming = initial_status == "LIVE";
    if !resuming {
        sleep_until(start_at).await;
        if cancelled.load(Ordering::Relaxed) {
            return Ok(());
        }
        let started = {
            let conn = ctx.db.acquire().await?;
            conn.query_opt(
                "UPDATE racing.races SET status = 'LIVE', started_at = now()
                 WHERE race_id = $1 AND status IN ('OPEN', 'LOCKED') RETURNING started_at",
                &[&race_id],
            )
            .await
            .context("set LIVE")?
        };
        match started {
            Some(row) => {
                let started_at: SystemTime = row.get(0);
                let payload = Payload::RaceStarted(RaceStarted { race_id, started_at: format_rfc3339(started_at) });
                ctx.producer.publish_payload(RACE_LIFECYCLE, &race_id.to_string(), payload).await?;
                log::info(format!("race {race_id} LIVE ({} ticks, {} laps)", finish_tick, script.track.laps));
            }
            None => match current_status(&ctx, race_id).await?.map(|(status, _)| status).as_deref() {
                Some("LIVE") => resuming = true,
                other => {
                    log::info(format!("race {race_id} not started (status {other:?})"));
                    return Ok(());
                }
            },
        }
    }
    let elapsed_ms = (unix_millis(SystemTime::now()) - unix_millis(start_at)).max(0);
    let wall_tick = ((elapsed_ms / tick_ms as i64) as u32).min(finish_tick);
    let mut next_tick = 0;
    if resuming {
        let last = last_published_tick(&ctx, race_id).await;
        if last.is_none() {
            let started_at = current_status(&ctx, race_id).await?.and_then(|(_, started_at)| started_at).unwrap_or(start_at);
            let payload = Payload::RaceStarted(RaceStarted { race_id, started_at: format_rfc3339(started_at) });
            ctx.producer.publish_payload(RACE_LIFECYCLE, &race_id.to_string(), payload).await?;
        }
        let gap_from = last.map(|tick| tick + 1).unwrap_or(0);
        for tick in script.ticks.iter().filter(|tick| tick.tick >= gap_from && tick.tick < wall_tick) {
            publish_lap_events(&ctx, race_id, tick).await?;
        }
        log::info(format!("race {race_id} resumed at tick {wall_tick} (last published {last:?})"));
        next_tick = wall_tick;
    } else if wall_tick > 10 {
        for tick in script.ticks.iter().filter(|tick| tick.tick < wall_tick) {
            publish_lap_events(&ctx, race_id, tick).await?;
        }
        next_tick = wall_tick;
    }
    for tick in script.ticks.iter().filter(|tick| tick.tick >= next_tick) {
        sleep_until(start_at + Duration::from_millis(tick.tick as u64 * tick_ms as u64)).await;
        if cancelled.load(Ordering::Relaxed) {
            write_state(&ctx, race_id, "CANCELLED", tick, tick_ms, &start_text).await;
            log::info(format!("race {race_id} cancelled at tick {}", tick.tick));
            return Ok(());
        }
        publish_tick(&ctx, race_id, tick, tick_ms, &start_text).await?;
    }
    finish(&ctx, race_id, &loaded, &start_text).await
}

async fn finish(ctx: &Ctx, race_id: i64, loaded: &Loaded, start_text: &str) -> Res<()> {
    let script = &loaded.script;
    let result = &script.result;
    let seed = ctx.keyring.open(&loaded.key_id, &race_id.to_string(), &loaded.seed_ciphertext)?;
    let mut conn = ctx.db.acquire().await?;
    let transaction = conn.transaction().await.context("begin reveal")?;
    let finished = transaction
        .query_opt(
            "UPDATE racing.races
                SET status = 'FINISHED', finish_tick = $2, finished_at = now(), seed = $3,
                    replay_expires_at = now() + make_interval(hours => $4)
              WHERE race_id = $1 AND status = 'LIVE'
          RETURNING finished_at, replay_expires_at",
            &[&race_id, &(result.finish_tick as i32), &seed, &(ctx.retention_hours as i32)],
        )
        .await
        .context("set FINISHED")?;
    let Some(row) = finished else {
        drop(transaction);
        log::warn(format!("race {race_id} was no longer LIVE at its final tick; nothing revealed"));
        return Ok(());
    };
    let finished_at: SystemTime = row.get(0);
    let expires_at: SystemTime = row.get(1);
    transaction
        .execute("UPDATE racing.race_entrants SET official_position = NULL WHERE race_id = $1", &[&race_id])
        .await
        .context("clear positions")?;
    for entrant in &result.entrants {
        let finish_time = entrant.finish_time_ms.map(|value| value as i32);
        transaction
            .execute(
                "UPDATE racing.race_entrants
                    SET official_position = $3, as_run_position = $4, result_status = $5,
                        finish_time_ms = $6, distance_covered = $7::float8
                  WHERE race_id = $1 AND entrant_id = $2",
                &[
                    &race_id,
                    &entrant_number(&entrant.id),
                    &(entrant.official_position as i32),
                    &(entrant.as_run_position as i32),
                    &entrant.result_status.key(),
                    &finish_time,
                    &entrant.distance_covered.0,
                ],
            )
            .await
            .context("update entrant result")?;
    }
    transaction.execute("DELETE FROM racing.race_lap_leaders WHERE race_id = $1", &[&race_id]).await.context("clear lap leaders")?;
    for leader in &result.lap_leaders {
        transaction
            .execute(
                "INSERT INTO racing.race_lap_leaders (race_id, lap, entrant_id, tick) VALUES ($1, $2, $3, $4)",
                &[&race_id, &(leader.lap as i32), &entrant_number(&leader.entrant_id), &(leader.tick as i32)],
            )
            .await
            .context("insert lap leader")?;
    }
    transaction.execute("DELETE FROM racing.race_incidents WHERE race_id = $1", &[&race_id]).await.context("clear incidents")?;
    for incident in &result.incidents {
        let entrant = incident.entrant_id.as_deref().map(entrant_number);
        transaction
            .execute(
                "INSERT INTO racing.race_incidents (race_id, seq, tick, type, entrant_id, data) VALUES ($1, $2, $3, $4, $5, $6::jsonb)",
                &[&race_id, &(incident.seq as i32), &(incident.tick as i32), &incident.kind.key(), &entrant, &incident.data],
            )
            .await
            .context("insert incident")?;
    }
    transaction
        .execute(
            "INSERT INTO racing.race_replays (race_id, script, expires_at) VALUES ($1, $2, $3)
             ON CONFLICT (race_id) DO UPDATE SET script = EXCLUDED.script, expires_at = EXCLUDED.expires_at",
            &[&race_id, &loaded.compressed, &expires_at],
        )
        .await
        .context("insert replay")?;
    transaction
        .execute(
            "UPDATE sealed.race_scripts SET revealed_at = now(), expires_at = $2 WHERE race_id = $1",
            &[&race_id, &expires_at],
        )
        .await
        .context("mark revealed")?;
    transaction.commit().await.context("commit reveal")?;
    drop(conn);
    let finished_text = format_rfc3339(finished_at);
    let message = finished_message(race_id, script, &hex::encode(&seed), &finished_text);
    ctx.producer.publish_payload(RACE_LIFECYCLE, &race_id.to_string(), Payload::RaceFinished(message)).await?;
    if let Some(last) = script.ticks.last() {
        write_state(ctx, race_id, "FINISHED", last, script.tick_ms, start_text).await;
    }
    log::info(format!("race {race_id} FINISHED: winner {} order {:?}", result.order.first().cloned().unwrap_or_default(), result.order));
    Ok(())
}

pub async fn republish_finished(ctx: &Ctx, race_id: i64) -> Res<()> {
    let row = {
        let conn = ctx.db.acquire().await?;
        conn.query_opt(
            "SELECT r.seed, r.finished_at, r.start_at, p.script FROM racing.races r
               JOIN racing.race_replays p USING (race_id)
              WHERE r.race_id = $1 AND r.status IN ('FINISHED', 'SETTLED')",
            &[&race_id],
        )
        .await
        .context("load finished race")?
        .context("REPLAY_NOT_FOUND")?
    };
    let seed: Vec<u8> = row.get(0);
    let finished_at: SystemTime = row.get(1);
    let start_at: SystemTime = row.get(2);
    let compressed: Vec<u8> = row.get(3);
    let script = RaceScript::from_json_bytes(&decompress(&compressed)?).map_err(|err| err.to_string())?;
    let message = finished_message(race_id, &script, &hex::encode(&seed), &format_rfc3339(finished_at));
    ctx.producer.publish_payload(RACE_LIFECYCLE, &race_id.to_string(), Payload::RaceFinished(message)).await?;
    if let Some(last) = script.ticks.last() {
        write_state(ctx, race_id, "FINISHED", last, script.tick_ms, &format_rfc3339(start_at)).await;
    }
    log::info(format!("race {race_id}: re-published RaceFinished"));
    Ok(())
}

pub async fn state_status(ctx: &Ctx, race_id: i64) -> Option<String> {
    let mut redis = ctx.redis.clone();
    let text: Option<String> = redis.get(state_key(race_id)).await.ok().flatten();
    let value: serde_json::Value = serde_json::from_str(&text?).ok()?;
    value["status"].as_str().map(str::to_string)
}
