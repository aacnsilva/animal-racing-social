use std::sync::Arc;
use std::time::Instant;

use ars_infra::kafka::MARKET_EVENTS;
use ars_infra::{Context, Res};
use ars_proto::envelope::Payload;
use ars_proto::{PriceUpdated, SelectionPrice};
use race_engine_core::{PreparedRace, ProbabilityTable, estimate_probabilities};

use crate::pricing::{floor_probability, price, round_probability};
use crate::registry::Market;
use crate::state::Shared;

pub const PRICE_TTL_SECONDS: i64 = 48 * 3600;

pub fn request(app: &Shared, race_id: i64) {
    let start = match app.registry.lock() {
        Ok(mut registry) => match registry.races.get_mut(&race_id) {
            Some(entry) if entry.pricing => {
                entry.pending = true;
                false
            }
            Some(entry) => {
                entry.pricing = true;
                true
            }
            None => false,
        },
        Err(_) => false,
    };
    if start {
        let app = app.clone();
        tokio::spawn(async move {
            loop {
                if let Err(err) = price_once(&app, race_id).await {
                    tracing::warn!(raceId = %race_id, "race {race_id}: live pricing failed: {err}");
                }
                let again = match app.registry.lock() {
                    Ok(mut registry) => match registry.races.get_mut(&race_id) {
                        Some(entry) if entry.pending => {
                            entry.pending = false;
                            true
                        }
                        Some(entry) => {
                            entry.pricing = false;
                            false
                        }
                        None => false,
                    },
                    Err(_) => false,
                };
                if !again {
                    break;
                }
            }
        });
    }
}

pub async fn prepare(app: &Shared, race_id: i64) -> Res<(Arc<PreparedRace>, String)> {
    let (info, prepared) = {
        let registry = app.registry.lock().map_err(|_| "registry poisoned".to_string())?;
        let entry = registry.races.get(&race_id).context("race not registered")?;
        (entry.info.clone(), entry.prepared.clone())
    };
    if let (Some(prepared), Some(info)) = (&prepared, &info) {
        return Ok((prepared.clone(), info.race_class.clone()));
    }
    let info = match info {
        Some(info) => info,
        None => {
            let loaded = crate::rebuild::load_race(app, race_id).await?.context("RACE_NOT_FOUND")?;
            if let Ok(mut registry) = app.registry.lock()
                && let Some(entry) = registry.races.get_mut(&race_id) {
                    entry.info = Some(loaded.clone());
                }
            loaded
        }
    };
    let (venue, params) = {
        let conn = app.db.acquire().await?;
        let venue = app.catalog.venue(&conn, &info.venue_id, info.venue_version).await?;
        let params = app.catalog.params(&conn, &info.engine_version).await?;
        (venue, params)
    };
    let prepared = Arc::new(
        PreparedRace::new(&params, &venue, &info.species, info.laps, &info.entrants).map_err(|err| err.to_string())?,
    );
    if let Ok(mut registry) = app.registry.lock()
        && let Some(entry) = registry.races.get_mut(&race_id) {
            entry.prepared = Some(prepared.clone());
        }
    Ok((prepared, info.race_class))
}

pub fn selections_for(market: &Market, table: &ProbabilityTable, margin: f64) -> Vec<SelectionPrice> {
    market
        .selections
        .iter()
        .filter_map(|(selection_id, entrant_id)| {
            let index = table.index_of(entrant_id)?;
            let probability = floor_probability(market.kind.probability(table, index), table.runs);
            Some(SelectionPrice {
                selection_id: *selection_id,
                entrant_id: entrant_id.clone(),
                price: price(probability, margin),
                probability: round_probability(probability),
            })
        })
        .collect()
}

async fn write_price(app: &Shared, market_id: i64, version: u32, tick: u32, selections: &[SelectionPrice]) -> Res<()> {
    let json = serde_json::Value::Array(
        selections
            .iter()
            .map(|selection| {
                serde_json::json!({
                    "selectionId": selection.selection_id.to_string(),
                    "entrantId": selection.entrant_id,
                    "price": selection.price,
                    "probability": selection.probability,
                })
            })
            .collect(),
    )
    .to_string();
    let key = format!("price:{market_id}");
    let mut redis = app.redis.clone();
    redis::pipe()
        .atomic()
        .hset_multiple(&key, &[("version", version.to_string()), ("tick", tick.to_string()), ("selections", json)])
        .ignore()
        .expire(&key, PRICE_TTL_SECONDS)
        .ignore()
        .query_async::<()>(&mut redis)
        .await
        .context("redis price write")
}

/// Fixed Monte Carlo seed per race (common random numbers): consecutive ticks
/// reuse the same random draws, so prices move with the revealed race state
/// instead of jittering with sampling noise, and live bets can be matched.
fn race_seed(race_id: i64) -> [u8; 32] {
    let mut seed = *b"ars-odds-engine-live-pricing-crn";
    for (byte, id) in seed.iter_mut().zip(race_id.to_le_bytes()) {
        *byte ^= id;
    }
    seed
}

async fn price_once(app: &Shared, race_id: i64) -> Res<()> {
    let (prepared, race_class) = prepare(app, race_id).await?;
    let (revealed, markets) = {
        let registry = app.registry.lock().map_err(|_| "registry poisoned".to_string())?;
        let entry = registry.races.get(&race_id).context("race dropped")?;
        (entry.live.revealed(), registry.priceable_markets(race_id))
    };
    let Some(revealed) = revealed else { return Ok(()) };
    if markets.is_empty() {
        return Ok(());
    }
    let tick = revealed.tick;
    let runs = app.settings.runs_live;
    let threads = app.settings.threads;
    let permit = app.compute.acquire().await.map_err(|err| err.to_string())?;
    let started = Instant::now();
    let seed = race_seed(race_id);
    let table = tokio::task::spawn_blocking(move || estimate_probabilities(&prepared, Some(&revealed), runs, threads, seed))
        .await
        .context("pricing task")?
        .map_err(|err| err.to_string())?;
    drop(permit);
    let elapsed = started.elapsed();
    crate::metrics::monte_carlo("live", &race_class, elapsed);
    let mut published = 0;
    for market in markets {
        let selections = selections_for(&market, &table, app.settings.margin);
        if selections.is_empty() {
            continue;
        }
        let version = {
            let mut registry = app.registry.lock().map_err(|_| "registry poisoned".to_string())?;
            match registry.markets.get_mut(&market.market_id) {
                Some(entry) => {
                    entry.price_version += 1;
                    entry.price_version
                }
                None => continue,
            }
        };
        if let Err(err) = write_price(app, market.market_id, version, tick, &selections).await {
            tracing::warn!(marketId = %market.market_id, "{err}");
        }
        let payload = Payload::PriceUpdated(PriceUpdated { market_id: market.market_id, race_id, tick, price_version: version, selections });
        app.producer.publish_payload(MARKET_EVENTS, &race_id.to_string(), payload).await?;
        published += 1;
    }
    let published_at = Instant::now();
    let (count, previous) = {
        let mut registry = app.registry.lock().map_err(|_| "registry poisoned".to_string())?;
        match registry.races.get_mut(&race_id) {
            Some(entry) => {
                entry.priced += 1;
                let previous = if published > 0 { entry.last_reprice.replace(published_at) } else { None };
                (Some(entry.priced), previous)
            }
            None => (None, None),
        }
    };
    if let Some(previous) = previous {
        crate::metrics::reprice_interval(&race_class, published_at.duration_since(previous));
    }
    if count.is_some_and(|count| count == 1 || count % 20 == 0) {
        tracing::info!(
            raceId = %race_id,
            tick,
            markets = published,
            runs,
            elapsedMs = elapsed.as_millis() as u64,
            "race {race_id} tick {tick}: priced {published} markets from {runs} runs in {} ms",
            elapsed.as_millis()
        );
    }
    Ok(())
}
