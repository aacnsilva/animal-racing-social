use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime};

use ars_infra::{Context, Res, log};
use tokio::task::JoinHandle;

use crate::Ctx;
use crate::race::{republish_finished, run_race, state_status};

struct Running {
    cancelled: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

pub async fn run(ctx: Arc<Ctx>) -> Res<()> {
    let mut running: HashMap<i64, Running> = HashMap::new();
    let mut backoff: HashMap<i64, Instant> = HashMap::new();
    let mut confirmed_finished: HashSet<i64> = HashSet::new();
    let mut next_retention = Instant::now();
    let mut ticker = tokio::time::interval(Duration::from_secs(1));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticker.tick().await;
        running.retain(|_, race| !race.handle.is_finished());
        ctx.live.store(running.len(), Ordering::Relaxed);
        if let Err(err) = poll(&ctx, &mut running, &mut backoff).await {
            log::warn(format!("poll failed: {err}"));
            continue;
        }
        if let Err(err) = check_finished_publication(&ctx, &running, &mut confirmed_finished).await {
            log::warn(format!("finish publication check failed: {err}"));
        }
        if Instant::now() >= next_retention {
            next_retention = Instant::now() + Duration::from_secs(3600);
            let retention_ctx = ctx.clone();
            tokio::spawn(async move {
                if let Err(err) = retention(&retention_ctx).await {
                    log::warn(format!("retention job failed: {err}"));
                }
            });
        }
    }
}

async fn poll(ctx: &Arc<Ctx>, running: &mut HashMap<i64, Running>, backoff: &mut HashMap<i64, Instant>) -> Res<()> {
    let conn = ctx.db.acquire().await?;
    let rows = conn
        .query(
            "SELECT race_id, status, start_at FROM racing.races
              WHERE seed_hash IS NOT NULL AND script_hash IS NOT NULL
                AND ((status IN ('OPEN', 'LOCKED') AND start_at <= now() + interval '3 seconds') OR status = 'LIVE')",
            &[],
        )
        .await
        .context("poll races")?;
    let ids: Vec<i64> = running.keys().copied().collect();
    let cancelled_rows = if ids.is_empty() {
        Vec::new()
    } else {
        conn.query("SELECT race_id FROM racing.races WHERE race_id = ANY($1) AND status = 'CANCELLED'", &[&ids])
            .await
            .context("poll cancellations")?
    };
    drop(conn);
    for row in cancelled_rows {
        let race_id: i64 = row.get(0);
        if let Some(race) = running.get(&race_id)
            && !race.cancelled.swap(true, Ordering::Relaxed) {
                log::info(format!("race {race_id} CANCELLED; stopping broadcast"));
            }
    }
    let now = Instant::now();
    for row in rows {
        let race_id: i64 = row.get(0);
        let start_at: SystemTime = row.get(2);
        if running.contains_key(&race_id) {
            continue;
        }
        if backoff.get(&race_id).is_some_and(|until| *until > now) {
            continue;
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        let task_ctx = ctx.clone();
        let task_cancelled = cancelled.clone();
        let handle = tokio::spawn(async move {
            if let Err(err) = run_race(task_ctx, race_id, start_at, task_cancelled).await {
                log::error(format!("race {race_id} broadcast failed: {err}"));
            }
        });
        backoff.insert(race_id, now + Duration::from_secs(30));
        running.insert(race_id, Running { cancelled, handle });
    }
    backoff.retain(|_, until| *until > now);
    Ok(())
}

async fn check_finished_publication(ctx: &Arc<Ctx>, running: &HashMap<i64, Running>, confirmed: &mut HashSet<i64>) -> Res<()> {
    let rows = {
        let conn = ctx.db.acquire().await?;
        conn.query(
            "SELECT race_id FROM racing.races WHERE status = 'FINISHED' AND finished_at > now() - interval '15 minutes'",
            &[],
        )
        .await
        .context("recent finished races")?
    };
    let recent: HashSet<i64> = rows.iter().map(|row| row.get::<_, i64>(0)).collect();
    confirmed.retain(|race_id| recent.contains(race_id));
    for race_id in recent {
        if confirmed.contains(&race_id) || running.contains_key(&race_id) {
            continue;
        }
        if state_status(ctx, race_id).await.as_deref() != Some("FINISHED") {
            republish_finished(ctx, race_id).await?;
        }
        confirmed.insert(race_id);
    }
    Ok(())
}

async fn retention(ctx: &Ctx) -> Res<()> {
    let conn = ctx.db.acquire().await?;
    let replays = conn.execute("DELETE FROM racing.race_replays WHERE expires_at < now()", &[]).await.context("delete replays")?;
    let scripts = conn
        .execute("DELETE FROM sealed.race_scripts WHERE revealed_at IS NOT NULL AND expires_at < now()", &[])
        .await
        .context("delete revealed scripts")?;
    let cancelled = conn
        .execute(
            "DELETE FROM sealed.race_scripts s USING racing.races r
              WHERE s.race_id = r.race_id AND r.status = 'CANCELLED' AND s.revealed_at IS NULL
                AND r.start_at < now() - make_interval(hours => $1)",
            &[&(ctx.retention_hours as i32)],
        )
        .await
        .context("delete cancelled scripts")?;
    log::info(format!("retention: deleted {replays} replays, {scripts} revealed scripts, {cancelled} cancelled-race scripts"));
    Ok(())
}
