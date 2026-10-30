use std::sync::Arc;
use std::time::Duration;

use ars_infra::convert::{ENTRANT_COLUMNS, entrant_from_row, entrants_from_proto};
use ars_infra::kafka::{Producer, RACE_COMMANDS, RACE_LIFECYCLE};
use ars_infra::sealing::{Keyring, compress};
use ars_infra::{Context, Res, log};
use ars_proto::envelope::Payload;
use ars_proto::{GenerateScript, ScriptFailed, ScriptSealed};
use race_engine_core::{RaceInputs, simulate};
use rdkafka::Message;
use rdkafka::consumer::{CommitMode, Consumer};

use crate::AppState;

enum Failure {
    Permanent(String),
    Transient(String),
}

impl From<String> for Failure {
    fn from(message: String) -> Failure {
        if message.contains("NOT_FOUND") || message.contains("INVALID") || message.contains("UNSUPPORTED") {
            Failure::Permanent(message)
        } else {
            Failure::Transient(message)
        }
    }
}

pub async fn run(state: Arc<AppState>, producer: Producer, keyring: Keyring, brokers: &str) -> Res<()> {
    let consumer = ars_infra::kafka::consumer(brokers, "race-engine", &[RACE_COMMANDS], "earliest")?;
    log::info("consuming race.commands as group race-engine");
    loop {
        let message = match consumer.recv().await {
            Ok(message) => message,
            Err(err) => {
                log::warn(format!("kafka receive error: {err}"));
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
        };
        if let Some(bytes) = message.payload() {
            match ars_infra::envelope::decode(bytes) {
                Ok(envelope) => {
                    if let Some(Payload::GenerateScript(command)) = envelope.payload {
                        handle_with_retry(&state, &producer, &keyring, &command).await;
                    }
                }
                Err(err) => log::warn(format!("skipping undecodable race.commands message: {err}")),
            }
        }
        if let Err(err) = consumer.store_offset_from_message(&message) {
            log::warn(format!("store offset failed: {err}"));
        }
        let _ = consumer.commit_consumer_state(CommitMode::Async);
    }
}

async fn handle_with_retry(state: &AppState, producer: &Producer, keyring: &Keyring, command: &GenerateScript) {
    let mut delay = Duration::from_millis(500);
    loop {
        match generate(state, producer, keyring, command).await {
            Ok(()) => return,
            Err(Failure::Permanent(reason)) if reason == "RACE_NOT_FOUND" => {
                log::warn(format!("race {}: GenerateScript for a race that is not in racing.races; skipped", command.race_id));
                return;
            }
            Err(Failure::Permanent(reason)) => {
                log::warn(format!("race {} script failed: {reason}", command.race_id));
                let failed = Payload::ScriptFailed(ScriptFailed { race_id: command.race_id, reason: reason.clone() });
                let key = command.race_id.to_string();
                loop {
                    match producer.publish_payload(RACE_LIFECYCLE, &key, failed.clone()).await {
                        Ok(()) => return,
                        Err(err) => {
                            log::warn(err);
                            tokio::time::sleep(delay).await;
                        }
                    }
                }
            }
            Err(Failure::Transient(reason)) => {
                log::warn(format!("race {} script generation retrying: {reason}", command.race_id));
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(Duration::from_secs(30));
            }
        }
    }
}

struct RaceRow {
    status: String,
    species: String,
    venue_id: String,
    venue_version: i32,
    laps: i32,
    engine_version: String,
    seed_hash: Option<Vec<u8>>,
    script_hash: Option<Vec<u8>>,
}

async fn load_race(client: &tokio_postgres::Client, race_id: i64) -> Result<Option<RaceRow>, String> {
    let row = client
        .query_opt(
            "SELECT status, species, venue_id, venue_version, laps, engine_version, seed_hash, script_hash
             FROM racing.races WHERE race_id = $1",
            &[&race_id],
        )
        .await
        .context("load race")?;
    Ok(row.map(|row| RaceRow {
        status: row.get(0),
        species: row.get(1),
        venue_id: row.get(2),
        venue_version: row.get(3),
        laps: row.get(4),
        engine_version: row.get(5),
        seed_hash: row.get(6),
        script_hash: row.get(7),
    }))
}

async fn publish_sealed(producer: &Producer, race_id: i64, engine_version: &str, seed_hash: &[u8], script_hash: &[u8]) -> Result<(), Failure> {
    let payload = Payload::ScriptSealed(ScriptSealed {
        race_id,
        engine_version: engine_version.to_string(),
        seed_hash: hex::encode(seed_hash),
        script_hash: hex::encode(script_hash),
    });
    producer.publish_payload(RACE_LIFECYCLE, &race_id.to_string(), payload).await.map_err(Failure::Transient)
}

async fn generate(state: &AppState, producer: &Producer, keyring: &Keyring, command: &GenerateScript) -> Result<(), Failure> {
    let race_id = command.race_id;
    let mut conn = state.db.acquire().await.map_err(Failure::Transient)?;
    let race = load_race(&conn, race_id).await.map_err(Failure::Transient)?.ok_or_else(|| Failure::Permanent("RACE_NOT_FOUND".into()))?;
    if let (Some(seed_hash), Some(script_hash)) = (&race.seed_hash, &race.script_hash) {
        log::info(format!("race {race_id} already sealed; re-publishing ScriptSealed"));
        return publish_sealed(producer, race_id, &race.engine_version, seed_hash, script_hash).await;
    }
    if race.status == "CANCELLED" {
        return Err(Failure::Permanent("RACE_CANCELLED".into()));
    }
    let mut mismatches = Vec::new();
    if !command.venue_id.is_empty() && command.venue_id != race.venue_id {
        mismatches.push(format!("venueId {} != {}", command.venue_id, race.venue_id));
    }
    if command.venue_version != 0 && command.venue_version as i32 != race.venue_version {
        mismatches.push(format!("venueVersion {} != {}", command.venue_version, race.venue_version));
    }
    if command.laps != 0 && command.laps as i32 != race.laps {
        mismatches.push(format!("laps {} != {}", command.laps, race.laps));
    }
    if !command.engine_version.is_empty() && command.engine_version != race.engine_version {
        mismatches.push(format!("engineVersion {} != {}", command.engine_version, race.engine_version));
    }
    if !command.species.is_empty() && command.species != race.species {
        mismatches.push(format!("species {} != {}", command.species, race.species));
    }
    if !mismatches.is_empty() {
        return Err(Failure::Permanent(format!("INPUT_MISMATCH {}", mismatches.join(", "))));
    }
    let entrants = if command.entrants.is_empty() {
        let rows = conn
            .query(&format!("SELECT {ENTRANT_COLUMNS} FROM racing.race_entrants WHERE race_id = $1 ORDER BY entrant_id"), &[&race_id])
            .await
            .context("load entrants")
            .map_err(Failure::Transient)?;
        rows.iter().map(entrant_from_row).collect::<Res<Vec<_>>>().map_err(|err| Failure::Permanent(format!("ENTRANTS_INVALID {err}")))?
    } else {
        entrants_from_proto(&command.entrants).map_err(|err| Failure::Permanent(format!("ENTRANTS_INVALID {err}")))?
    };
    let venue = state.catalog.venue(&conn, &race.venue_id, race.venue_version as u32).await?;
    let params = state.catalog.params(&conn, &race.engine_version).await?;
    let inputs = RaceInputs {
        race_id: race_id.to_string(),
        engine_version: race.engine_version.clone(),
        species: race.species.clone(),
        laps: race.laps as u32,
        entrants,
    };
    let seed: [u8; 32] = ars_infra::ids::random_bytes();
    let sealed = tokio::task::spawn_blocking(move || simulate(&params, &venue, &inputs, &seed))
        .await
        .map_err(|err| Failure::Transient(err.to_string()))?
        .map_err(|err| Failure::Permanent(format!("SIMULATION_FAILED {err}")))?;
    let aad = race_id.to_string();
    let seed_ciphertext = keyring.seal(&aad, &seed).map_err(Failure::Permanent)?;
    let compressed = compress(&sealed.json).map_err(Failure::Permanent)?;
    let script_ciphertext = keyring.seal(&aad, &compressed).map_err(Failure::Permanent)?;
    let seed_hash = hex::decode(&sealed.seed_hash).map_err(|err| Failure::Permanent(err.to_string()))?;
    let script_hash = hex::decode(&sealed.script_hash).map_err(|err| Failure::Permanent(err.to_string()))?;
    let transaction = conn.transaction().await.context("begin").map_err(Failure::Transient)?;
    let updated = transaction
        .execute(
            "UPDATE racing.races SET seed_hash = $2, script_hash = $3
             WHERE race_id = $1 AND seed_hash IS NULL AND script_hash IS NULL",
            &[&race_id, &seed_hash, &script_hash],
        )
        .await
        .context("set hashes")
        .map_err(Failure::Transient)?;
    if updated == 0 {
        drop(transaction);
        let race = load_race(&conn, race_id).await.map_err(Failure::Transient)?.ok_or_else(|| Failure::Permanent("RACE_NOT_FOUND".into()))?;
        return match (&race.seed_hash, &race.script_hash) {
            (Some(seed_hash), Some(script_hash)) => publish_sealed(producer, race_id, &race.engine_version, seed_hash, script_hash).await,
            _ => Err(Failure::Transient("race hashes changed concurrently".into())),
        };
    }
    transaction
        .execute(
            "INSERT INTO sealed.race_scripts (race_id, key_id, seed_ciphertext, script_ciphertext, script_bytes)
             VALUES ($1, $2, $3, $4, $5)",
            &[&race_id, &keyring.current_id(), &seed_ciphertext, &script_ciphertext, &(sealed.json.len() as i32)],
        )
        .await
        .context("insert sealed script")
        .map_err(Failure::Transient)?;
    transaction.commit().await.context("commit seal").map_err(Failure::Transient)?;
    drop(conn);
    log::info(format!("race {race_id} sealed: engine {} scriptHash {}", race.engine_version, sealed.script_hash));
    publish_sealed(producer, race_id, &race.engine_version, &seed_hash, &script_hash).await
}
