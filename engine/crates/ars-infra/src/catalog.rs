use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use race_engine_core::{LoadedParams, SegmentSpec, Venue};
use tokio_postgres::Client;

use crate::{Context, Res};

#[derive(Debug, Default, Clone)]
pub struct Catalog {
    venues: Arc<Mutex<HashMap<(String, u32), Venue>>>,
    params: Arc<Mutex<HashMap<String, Arc<LoadedParams>>>>,
}

fn column_u32(row: &tokio_postgres::Row, column: &str) -> Res<u32> {
    let value: i32 = row.try_get(column).context(column)?;
    u32::try_from(value).context(column)
}

pub fn venue_from_row(row: &tokio_postgres::Row) -> Res<Venue> {
    let segments: serde_json::Value = row.try_get("segments").context("venue segments")?;
    let segments: Vec<SegmentSpec> =
        serde_json::from_value(segments).context("venue segments json")?;
    let venue = Venue {
        id: row.try_get("venue_id").context("venue_id")?,
        version: column_u32(row, "version")?,
        name: row.try_get("name").context("name")?,
        class: row.try_get("race_class").context("race_class")?,
        surface: row.try_get("surface").context("surface")?,
        lanes: column_u32(row, "lanes")?,
        lap_length: row.try_get("lap_length").context("lap_length")?,
        laps_range: [column_u32(row, "laps_min")?, column_u32(row, "laps_max")?],
        segments,
    };
    venue.validate().map_err(|err| err.to_string())?;
    Ok(venue)
}

pub const VENUE_COLUMNS: &str = "venue_id, version, name, race_class, surface, lanes, lap_length::float8 AS lap_length, laps_min, laps_max, segments";

impl Catalog {
    pub fn new() -> Catalog {
        Catalog::default()
    }

    pub async fn venue(&self, client: &Client, venue_id: &str, version: u32) -> Res<Venue> {
        let key = (venue_id.to_string(), version);
        if let Some(venue) = self
            .venues
            .lock()
            .ok()
            .and_then(|cache| cache.get(&key).cloned())
        {
            return Ok(venue);
        }
        let query = format!(
            "SELECT {VENUE_COLUMNS} FROM racing.venues WHERE venue_id = $1 AND version = $2"
        );
        let version_column = i32::try_from(version).context("venue version")?;
        let row = client
            .query_opt(&query, &[&venue_id, &version_column])
            .await
            .context("load venue")?
            .context(&format!("VENUE_NOT_FOUND {venue_id}@{version}"))?;
        let venue = venue_from_row(&row)?;
        if let Ok(mut cache) = self.venues.lock() {
            cache.insert(key, venue.clone());
        }
        Ok(venue)
    }

    pub async fn params(&self, client: &Client, engine_version: &str) -> Res<Arc<LoadedParams>> {
        if let Some(params) = self
            .params
            .lock()
            .ok()
            .and_then(|cache| cache.get(engine_version).cloned())
        {
            return Ok(params);
        }
        let row = client
            .query_opt(
                "SELECT params FROM racing.engine_versions WHERE engine_version = $1",
                &[&engine_version],
            )
            .await
            .context("load engine params")?
            .context(&format!("ENGINE_VERSION_NOT_FOUND {engine_version}"))?;
        let value: serde_json::Value = row.try_get("params").context("params column")?;
        let params = Arc::new(
            LoadedParams::from_value(&value)
                .map_err(|err| format!("PARAMS_INVALID {engine_version}: {err}"))?,
        );
        if race_engine_core::core_version(engine_version) != race_engine_core::ENGINE_VERSION {
            return Err(format!("ENGINE_VERSION_UNSUPPORTED {engine_version}"));
        }
        if let Ok(mut cache) = self.params.lock() {
            cache.insert(engine_version.to_string(), params.clone());
        }
        Ok(params)
    }

    pub async fn active_engine_version(&self, client: &Client) -> Res<String> {
        let row = client
            .query_opt(
                "SELECT engine_version FROM racing.engine_versions WHERE is_active",
                &[],
            )
            .await
            .context("load active engine version")?;
        Ok(row.map_or_else(
            || race_engine_core::ENGINE_VERSION.to_string(),
            |row| row.get::<_, String>(0),
        ))
    }
}
