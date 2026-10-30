use crate::error::EngineError;
use crate::inputs::{EntrantInput, RaceInputs};
use crate::params::LoadedParams;
use crate::script::{RaceScript, sha256_hex};
use crate::simulate::simulate;
use crate::venue::Venue;

#[derive(Debug, Clone, PartialEq)]
pub enum Verification {
    Ok { script_hash: String },
    Mismatch { reason: String },
}

pub fn parse_seed(hex_seed: &str) -> Result<[u8; 32], EngineError> {
    let bytes = hex::decode(hex_seed).map_err(|_| EngineError::InvalidInputs("seed is not hex".into()))?;
    bytes.try_into().map_err(|_| EngineError::InvalidInputs("seed must be 32 bytes".into()))
}

pub fn inputs_from_script(script: &RaceScript) -> RaceInputs {
    RaceInputs {
        race_id: script.race_id.clone(),
        engine_version: script.engine_version.clone(),
        species: script.species.clone(),
        laps: script.track.laps,
        entrants: script
            .entrants
            .iter()
            .map(|entrant| EntrantInput {
                entrant_id: entrant.id.clone(),
                animal_id: entrant.animal_id.clone(),
                lane: entrant.lane,
                temperament: entrant.temperament,
                stats: crate::inputs::Stats {
                    velocity: entrant.stats.velocity.0,
                    stamina: entrant.stats.stamina.0,
                    acceleration: entrant.stats.acceleration.0,
                    consistency: entrant.stats.consistency.0,
                },
            })
            .collect(),
    }
}

pub fn verify(
    params: &LoadedParams,
    venue: &Venue,
    inputs: &RaceInputs,
    seed: &[u8; 32],
    expected_script_hash: &str,
) -> Verification {
    match simulate(params, venue, inputs, seed) {
        Ok(sealed) if sealed.script_hash.eq_ignore_ascii_case(expected_script_hash) => {
            Verification::Ok { script_hash: sealed.script_hash }
        }
        Ok(sealed) => Verification::Mismatch {
            reason: format!("scriptHash {} != expected {}", sealed.script_hash, expected_script_hash),
        },
        Err(err) => Verification::Mismatch { reason: err.to_string() },
    }
}

pub fn verify_script_bytes(params: &LoadedParams, venue: &Venue, script_bytes: &[u8]) -> Verification {
    let script = match RaceScript::from_json_bytes(script_bytes) {
        Ok(script) => script,
        Err(err) => return Verification::Mismatch { reason: err.to_string() },
    };
    if script.params_hash != params.hash {
        return Verification::Mismatch {
            reason: format!("paramsHash {} does not match the params used ({})", script.params_hash, params.hash),
        };
    }
    if script.track.venue_id != venue.id || script.track.venue_version != venue.version {
        return Verification::Mismatch {
            reason: format!(
                "script venue {}@{} differs from {}@{}",
                script.track.venue_id, script.track.venue_version, venue.id, venue.version
            ),
        };
    }
    let seed = match parse_seed(&script.seed) {
        Ok(seed) => seed,
        Err(err) => return Verification::Mismatch { reason: err.to_string() },
    };
    let inputs = inputs_from_script(&script);
    verify(params, venue, &inputs, &seed, &sha256_hex(script_bytes))
}
