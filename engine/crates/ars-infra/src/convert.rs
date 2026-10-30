use ars_proto::EntrantInfo;
use race_engine_core::{EntrantInput, Stats, Temperament};
use serde::{Deserialize, Deserializer};

use crate::{Context, Res};

fn temperament(text: &str) -> Res<Temperament> {
    Temperament::parse(text).context(&format!("invalid temperament {text}"))
}

pub fn entrant_from_proto(info: &EntrantInfo) -> Res<EntrantInput> {
    let stats = info.stats.as_ref().context(&format!("entrant {} has no stats", info.entrant_id))?;
    Ok(EntrantInput {
        entrant_id: info.entrant_id.clone(),
        animal_id: info.animal_id.to_string(),
        lane: info.lane,
        temperament: temperament(&info.temperament)?,
        stats: Stats {
            velocity: stats.velocity,
            stamina: stats.stamina,
            acceleration: stats.acceleration,
            consistency: stats.consistency,
        },
    })
}

pub fn entrants_from_proto(infos: &[EntrantInfo]) -> Res<Vec<EntrantInput>> {
    infos.iter().map(entrant_from_proto).collect()
}

fn stat(value: &serde_json::Value, name: &str) -> Res<f64> {
    match &value[name] {
        serde_json::Value::Number(number) => number.as_f64().context(name),
        serde_json::Value::String(text) => text.parse().context(name),
        _ => Err(format!("stats_snapshot.{name} missing")),
    }
}

pub fn stats_from_json(value: &serde_json::Value) -> Res<Stats> {
    Ok(Stats {
        velocity: stat(value, "velocity")?,
        stamina: stat(value, "stamina")?,
        acceleration: stat(value, "acceleration")?,
        consistency: stat(value, "consistency")?,
    })
}

pub const ENTRANT_COLUMNS: &str = "race_id, entrant_id, animal_id, lane, temperament, stats_snapshot";

pub fn entrant_from_row(row: &tokio_postgres::Row) -> Res<EntrantInput> {
    let entrant_id: i32 = row.try_get("entrant_id").context("entrant_id")?;
    let animal_id: i64 = row.try_get("animal_id").context("animal_id")?;
    let lane: i32 = row.try_get("lane").context("lane")?;
    let temperament_text: String = row.try_get("temperament").context("temperament")?;
    let snapshot: serde_json::Value = row.try_get("stats_snapshot").context("stats_snapshot")?;
    Ok(EntrantInput {
        entrant_id: crate::ids::entrant_wire_id(entrant_id),
        animal_id: animal_id.to_string(),
        lane: lane as u32,
        temperament: temperament(&temperament_text)?,
        stats: stats_from_json(&snapshot)?,
    })
}

#[derive(Debug, Clone)]
pub struct IdText(pub String);

impl<'de> Deserialize<'de> for IdText {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<IdText, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        match value {
            serde_json::Value::String(text) => Ok(IdText(text)),
            serde_json::Value::Number(number) => Ok(IdText(number.to_string())),
            other => Err(serde::de::Error::custom(format!("expected id string, got {other}"))),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireEntrant {
    pub entrant_id: String,
    pub animal_id: IdText,
    pub lane: u32,
    pub temperament: String,
    pub stats: Stats,
}

pub fn entrants_from_wire(entrants: &[WireEntrant]) -> Res<Vec<EntrantInput>> {
    entrants
        .iter()
        .map(|entrant| {
            Ok(EntrantInput {
                entrant_id: entrant.entrant_id.clone(),
                animal_id: entrant.animal_id.0.clone(),
                lane: entrant.lane,
                temperament: temperament(&entrant.temperament)?,
                stats: entrant.stats,
            })
        })
        .collect()
}
