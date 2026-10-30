use std::collections::BTreeMap;

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::error::EngineError;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineParams {
    pub version: String,
    pub tick_ms: u32,
    pub max_ticks: u32,
    pub classes: BTreeMap<String, ClassWindow>,
    pub planning: PlanningParams,
    pub physics: PhysicsParams,
    pub noise: NoiseParams,
    pub stamina: StaminaParams,
    pub temperaments: BTreeMap<String, TemperamentParams>,
    pub incidents: IncidentParams,
    pub surfaces: BTreeMap<String, SurfaceParams>,
    pub species: BTreeMap<String, SpeciesParams>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassWindow {
    pub min_sec: f64,
    pub max_sec: f64,
    pub target_sec: f64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningParams {
    pub dry_runs: u32,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicsParams {
    pub velocity_elasticity: f64,
    pub braking_factor: f64,
    pub curve_look_ahead_sec: f64,
    pub tight_curve_radius: f64,
    pub lane_width: f64,
    pub lane_change_per_tick: f64,
    pub blocking_gap: f64,
    pub lane_clearance: f64,
    pub free_lane_behind: f64,
    pub free_lane_ahead: f64,
    pub overtake_margin: f64,
    pub race_effort: f64,
    pub min_effort: f64,
    pub uphill_speed_loss_per_grade: f64,
    pub downhill_speed_gain_per_grade: f64,
    pub uphill_drain_per_grade: f64,
    pub downhill_drain_per_grade: f64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoiseParams {
    pub form_sd_base: f64,
    pub form_sd_per_inconsistency: f64,
    pub form_clamp_sd: f64,
    pub pace_sd_base: f64,
    pub pace_sd_per_inconsistency: f64,
    pub pace_correlation: f64,
    pub pace_update_ticks: u32,
    pub pacing_error_sd: f64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaminaParams {
    pub drain_budget: f64,
    pub reference_length: f64,
    pub length_exponent: f64,
    pub effort_reference: f64,
    pub capacity_base: f64,
    pub capacity_per_point: f64,
    pub tired_threshold: f64,
    pub tired_factor: f64,
    pub exhausted_factor: f64,
    pub pacing_reserve: f64,
    pub kick_reserve: f64,
    pub replan_ticks: u32,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemperamentParams {
    pub effort_bias: f64,
    pub early_boost: f64,
    pub early_until: f64,
    pub kick_boost: f64,
    pub kick_fraction: f64,
    pub kick_max_distance: f64,
    pub kick_jitter: f64,
    pub discipline: f64,
    pub preferred_min_position: u32,
    pub preferred_max_position: u32,
    pub chase_bonus: f64,
    pub ease_off: f64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncidentParams {
    pub stumble_per_km: f64,
    pub stumble_tired_multiplier: f64,
    pub stumble_ticks_min: u32,
    pub stumble_ticks_max: u32,
    pub stumble_speed_drop: f64,
    pub stumble_target_factor: f64,
    pub false_start_per_race: f64,
    pub false_start_delay_ticks: u32,
    pub refused_per_entrant: f64,
    pub pulled_up_per_entrant: f64,
    pub pulled_up_from_fraction: f64,
    pub pulled_up_to_fraction: f64,
    pub disqualified_per_race: f64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceParams {
    pub grip: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeciesParams {
    pub reference_velocity: f64,
    pub lateral_grip: f64,
    pub surface_affinity: BTreeMap<String, f64>,
    pub segment_affinity: BTreeMap<String, f64>,
    pub surface_stamina_drain: BTreeMap<String, f64>,
    pub surface_stumble: BTreeMap<String, f64>,
    pub segment_stumble: BTreeMap<String, f64>,
}

pub const SURFACES: [&str; 5] = ["DIRT", "GRASS", "SAND", "MUD", "ICE"];
pub const SEGMENT_KINDS: [&str; 5] = ["STRAIGHT", "CURVE", "TIGHT_CURVE", "UPHILL", "DOWNHILL"];
pub const TEMPERAMENTS: [&str; 4] = ["FRONT_RUNNER", "STALKER", "CLOSER", "STEADY"];

#[derive(Debug, Clone)]
pub struct LoadedParams {
    pub params: EngineParams,
    pub canonical_json: String,
    pub hash: String,
}

impl LoadedParams {
    pub fn from_json_str(text: &str) -> Result<LoadedParams, EngineError> {
        let value: serde_json::Value = serde_json::from_str(text)
            .map_err(|err| EngineError::InvalidParams(format!("not valid JSON: {err}")))?;
        LoadedParams::from_value(&value)
    }

    pub fn from_value(value: &serde_json::Value) -> Result<LoadedParams, EngineError> {
        let params: EngineParams = serde_json::from_value(value.clone())
            .map_err(|err| EngineError::InvalidParams(err.to_string()))?;
        validate(&params)?;
        let canonical_json = canonical_json(value);
        let hash = hex::encode(Sha256::digest(canonical_json.as_bytes()));
        Ok(LoadedParams { params, canonical_json, hash })
    }

    pub fn version(&self) -> &str {
        &self.params.version
    }

    pub fn value(&self) -> serde_json::Value {
        serde_json::from_str(&self.canonical_json).unwrap_or(serde_json::Value::Null)
    }
}

pub fn canonical_json(value: &serde_json::Value) -> String {
    let mut out = String::new();
    write_canonical(value, &mut out);
    out
}

fn write_canonical(value: &serde_json::Value, out: &mut String) {
    match value {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (index, key) in keys.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::Value::String((*key).clone()).to_string());
                out.push(':');
                write_canonical(&map[*key], out);
            }
            out.push('}');
        }
        serde_json::Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        serde_json::Value::Number(number) => match number.as_f64() {
            Some(float) if number.is_f64() => out.push_str(&serde_json::Value::from(float).to_string()),
            _ => out.push_str(&number.to_string()),
        },
        other => out.push_str(&other.to_string()),
    }
}

fn require_keys(map: &BTreeMap<String, f64>, keys: &[&str], context: &str) -> Result<(), EngineError> {
    for key in keys {
        match map.get(*key) {
            Some(value) if value.is_finite() && *value > 0.0 => {}
            _ => {
                return Err(EngineError::InvalidParams(format!("{context}.{key} missing or not positive")));
            }
        }
    }
    Ok(())
}

fn validate(params: &EngineParams) -> Result<(), EngineError> {
    if params.tick_ms == 0 {
        return Err(EngineError::InvalidParams("tickMs must be positive".into()));
    }
    if params.max_ticks < 10 {
        return Err(EngineError::InvalidParams("maxTicks too small".into()));
    }
    if params.noise.pace_update_ticks == 0 || params.stamina.replan_ticks == 0 {
        return Err(EngineError::InvalidParams("noise.paceUpdateTicks must be positive".into()));
    }
    if params.incidents.stumble_ticks_min == 0 || params.incidents.stumble_ticks_max < params.incidents.stumble_ticks_min {
        return Err(EngineError::InvalidParams("incidents.stumbleTicks range invalid".into()));
    }
    for name in TEMPERAMENTS {
        if !params.temperaments.contains_key(name) {
            return Err(EngineError::InvalidParams(format!("temperaments.{name} missing")));
        }
    }
    for name in SURFACES {
        if !params.surfaces.contains_key(name) {
            return Err(EngineError::InvalidParams(format!("surfaces.{name} missing")));
        }
    }
    if params.species.is_empty() {
        return Err(EngineError::InvalidParams("species missing".into()));
    }
    for (name, species) in &params.species {
        let context = format!("species.{name}");
        require_keys(&species.surface_affinity, &SURFACES, &format!("{context}.surfaceAffinity"))?;
        require_keys(&species.segment_affinity, &SEGMENT_KINDS, &format!("{context}.segmentAffinity"))?;
        require_keys(&species.surface_stamina_drain, &SURFACES, &format!("{context}.surfaceStaminaDrain"))?;
        require_keys(&species.surface_stumble, &SURFACES, &format!("{context}.surfaceStumble"))?;
        require_keys(&species.segment_stumble, &SEGMENT_KINDS, &format!("{context}.segmentStumble"))?;
        if species.reference_velocity <= 0.0 || species.lateral_grip <= 0.0 {
            return Err(EngineError::InvalidParams(format!("{context} referenceVelocity/lateralGrip must be positive")));
        }
    }
    Ok(())
}

pub fn core_version(engine_version: &str) -> &str {
    engine_version.split('+').next().unwrap_or(engine_version)
}
