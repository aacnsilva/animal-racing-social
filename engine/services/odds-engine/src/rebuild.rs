use std::collections::HashMap;

use ars_infra::convert::{ENTRANT_COLUMNS, entrant_from_row};
use ars_infra::{Context, Res};

use crate::pricing::MarketKind;
use crate::registry::{Market, MarketStatus, RaceInfo};
use crate::state::Shared;

pub async fn load_race(app: &Shared, race_id: i64) -> Res<Option<RaceInfo>> {
    let conn = app.db.acquire().await?;
    let Some(row) = conn
        .query_opt(
            "SELECT species, venue_id, venue_version, laps, engine_version, race_class FROM racing.races WHERE race_id = $1",
            &[&race_id],
        )
        .await
        .context("load race")?
    else {
        return Ok(None);
    };
    let entrants = conn
        .query(&format!("SELECT {ENTRANT_COLUMNS} FROM racing.race_entrants WHERE race_id = $1 ORDER BY entrant_id"), &[&race_id])
        .await
        .context("load entrants")?
        .iter()
        .map(entrant_from_row)
        .collect::<Res<Vec<_>>>()?;
    Ok(Some(RaceInfo {
        species: row.get(0),
        venue_id: row.get(1),
        venue_version: row.get::<_, i32>(2) as u32,
        laps: row.get::<_, i32>(3) as u32,
        engine_version: row.get(4),
        race_class: row.get(5),
        entrants,
    }))
}

pub async fn rebuild(app: &Shared) -> Res<()> {
    let conn = app.db.acquire().await?;
    let races = conn
        .query(
            "SELECT race_id, species, venue_id, venue_version, laps, engine_version, race_class FROM racing.races
              WHERE status IN ('OPEN', 'LOCKED', 'LIVE')",
            &[],
        )
        .await
        .context("load open races")?;
    let race_ids: Vec<i64> = races.iter().map(|row| row.get(0)).collect();
    let mut entrants: HashMap<i64, Vec<race_engine_core::EntrantInput>> = HashMap::new();
    for row in conn
        .query(&format!("SELECT {ENTRANT_COLUMNS} FROM racing.race_entrants WHERE race_id = ANY($1) ORDER BY race_id, entrant_id"), &[&race_ids])
        .await
        .context("load entrants")?
    {
        let race_id: i64 = row.get("race_id");
        match entrant_from_row(&row) {
            Ok(entrant) => entrants.entry(race_id).or_default().push(entrant),
            Err(err) => tracing::warn!(raceId = %race_id, "race {race_id}: skipping entrant: {err}"),
        }
    }
    let markets = conn
        .query(
            "SELECT market_id, race_id, type, params, status, price_version FROM market.markets
              WHERE status IN ('OPEN', 'SUSPENDED') AND race_id = ANY($1)",
            &[&race_ids],
        )
        .await
        .context("load markets")?;
    let market_ids: Vec<i64> = markets.iter().map(|row| row.get(0)).collect();
    let mut selections: HashMap<i64, Vec<(i64, String)>> = HashMap::new();
    for row in conn
        .query(
            "SELECT selection_id, market_id, entrant_id FROM market.selections WHERE market_id = ANY($1) ORDER BY market_id, entrant_id",
            &[&market_ids],
        )
        .await
        .context("load selections")?
    {
        let market_id: i64 = row.get(1);
        let entrant: i32 = row.get(2);
        selections.entry(market_id).or_default().push((row.get(0), ars_infra::ids::entrant_wire_id(entrant)));
    }
    drop(conn);
    let mut cached_versions: HashMap<i64, u32> = HashMap::new();
    if !market_ids.is_empty() {
        let mut pipe = redis::pipe();
        for market_id in &market_ids {
            pipe.hget(format!("price:{market_id}"), "version");
        }
        let mut redis = app.redis.clone();
        let versions: Vec<Option<u32>> = pipe.query_async(&mut redis).await.context("load cached price versions")?;
        for (market_id, version) in market_ids.iter().zip(versions) {
            if let Some(version) = version {
                cached_versions.insert(*market_id, version);
            }
        }
    }
    let mut registry = app.registry.lock().map_err(|_| "registry poisoned".to_string())?;
    for row in &races {
        let race_id: i64 = row.get(0);
        let entry = registry.races.entry(race_id).or_default();
        entry.info = Some(RaceInfo {
            species: row.get(1),
            venue_id: row.get(2),
            venue_version: row.get::<_, i32>(3) as u32,
            laps: row.get::<_, i32>(4) as u32,
            engine_version: row.get(5),
            race_class: row.get(6),
            entrants: entrants.remove(&race_id).unwrap_or_default(),
        });
    }
    let mut market_count = 0;
    for row in &markets {
        let market_id: i64 = row.get(0);
        let kind_text: String = row.get(2);
        let params: serde_json::Value = row.get(3);
        let status: String = row.get(4);
        let kind = match MarketKind::from_json(&kind_text, &params) {
            Ok(kind) => kind,
            Err(err) => {
                tracing::warn!(marketId = %market_id, "market {market_id}: {err}");
                continue;
            }
        };
        registry.markets.insert(
            market_id,
            Market {
                market_id,
                race_id: row.get(1),
                kind,
                status: if status == "SUSPENDED" { MarketStatus::Suspended } else { MarketStatus::Open },
                selections: selections.remove(&market_id).unwrap_or_default(),
                price_version: (row.get::<_, i32>(5).max(0) as u32).max(cached_versions.get(&market_id).copied().unwrap_or(0)),
            },
        );
        market_count += 1;
    }
    tracing::info!(races = races.len(), markets = market_count, "registry rebuilt: {} races, {market_count} markets", races.len());
    Ok(())
}
