use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};

use crate::error::EngineError;
use crate::inputs::Temperament;

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
pub struct Num(pub f64);

impl Num {
    pub fn rounded(value: f64) -> Num {
        Num(round2(value))
    }
}

pub fn round2(value: f64) -> f64 {
    let rounded = libm::round(value * 100.0) / 100.0;
    if rounded == 0.0 { 0.0 } else { rounded }
}

impl Serialize for Num {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let value = self.0;
        if value.is_finite() && libm::floor(value) == value && value.abs() < 1e15 {
            serializer.serialize_i64(value as i64)
        } else {
            serializer.serialize_f64(value)
        }
    }
}

impl<'de> Deserialize<'de> for Num {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Num, D::Error> {
        f64::deserialize(deserializer).map(Num)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EntrantState {
    Running,
    Sprinting,
    Tired,
    Stumbled,
    Dnf,
    Finished,
}

impl EntrantState {
    pub fn key(self) -> &'static str {
        match self {
            EntrantState::Running => "RUNNING",
            EntrantState::Sprinting => "SPRINTING",
            EntrantState::Tired => "TIRED",
            EntrantState::Stumbled => "STUMBLED",
            EntrantState::Dnf => "DNF",
            EntrantState::Finished => "FINISHED",
        }
    }

    pub fn parse(text: &str) -> Option<EntrantState> {
        match text {
            "RUNNING" => Some(EntrantState::Running),
            "SPRINTING" => Some(EntrantState::Sprinting),
            "TIRED" => Some(EntrantState::Tired),
            "STUMBLED" => Some(EntrantState::Stumbled),
            "DNF" => Some(EntrantState::Dnf),
            "FINISHED" => Some(EntrantState::Finished),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EventKind {
    Overtake,
    Stumble,
    Sprint,
    Lap,
    Finish,
    FalseStart,
    RefusedToRun,
    PulledUp,
    PhotoFinish,
}

impl EventKind {
    pub fn key(self) -> &'static str {
        match self {
            EventKind::Overtake => "OVERTAKE",
            EventKind::Stumble => "STUMBLE",
            EventKind::Sprint => "SPRINT",
            EventKind::Lap => "LAP",
            EventKind::Finish => "FINISH",
            EventKind::FalseStart => "FALSE_START",
            EventKind::RefusedToRun => "REFUSED_TO_RUN",
            EventKind::PulledUp => "PULLED_UP",
            EventKind::PhotoFinish => "PHOTO_FINISH",
        }
    }

    pub fn is_incident(self) -> bool {
        matches!(
            self,
            EventKind::Stumble | EventKind::FalseStart | EventKind::RefusedToRun | EventKind::PulledUp | EventKind::PhotoFinish
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IncidentKind {
    Stumble,
    FalseStart,
    RefusedToRun,
    PulledUp,
    Disqualified,
    PhotoFinish,
}

impl IncidentKind {
    pub fn key(self) -> &'static str {
        match self {
            IncidentKind::Stumble => "STUMBLE",
            IncidentKind::FalseStart => "FALSE_START",
            IncidentKind::RefusedToRun => "REFUSED_TO_RUN",
            IncidentKind::PulledUp => "PULLED_UP",
            IncidentKind::Disqualified => "DISQUALIFIED",
            IncidentKind::PhotoFinish => "PHOTO_FINISH",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResultStatus {
    Finished,
    Disqualified,
    Dnf,
    NonRunner,
}

impl ResultStatus {
    pub fn key(self) -> &'static str {
        match self {
            ResultStatus::Finished => "FINISHED",
            ResultStatus::Disqualified => "DISQUALIFIED",
            ResultStatus::Dnf => "DNF",
            ResultStatus::NonRunner => "NON_RUNNER",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceScript {
    pub race_id: String,
    pub engine_version: String,
    pub params_hash: String,
    pub seed: String,
    pub tick_ms: u32,
    pub species: String,
    pub track: ScriptTrack,
    pub entrants: Vec<ScriptEntrant>,
    pub ticks: Vec<ScriptTick>,
    pub result: ScriptResult,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptTrack {
    pub venue_id: String,
    pub venue_version: u32,
    pub surface: String,
    pub lap_length: Num,
    pub laps: u32,
    pub length: Num,
    pub lanes: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScriptStats {
    pub velocity: Num,
    pub stamina: Num,
    pub acceleration: Num,
    pub consistency: Num,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptEntrant {
    pub id: String,
    pub animal_id: String,
    pub lane: u32,
    pub temperament: Temperament,
    pub stats: ScriptStats,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScriptTick {
    pub tick: u32,
    pub lap: u32,
    pub entrants: Vec<TickEntrant>,
    pub events: Vec<TickEvent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TickEntrant {
    pub id: String,
    pub dist: Num,
    pub lane: Num,
    pub speed: Num,
    pub stamina_pct: Num,
    pub state: EntrantState,
    pub pos: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TickEvent {
    #[serde(rename = "type")]
    pub kind: EventKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub a: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub b: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lap: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pos: Option<u32>,
}

impl TickEvent {
    pub fn single(kind: EventKind, id: &str) -> TickEvent {
        TickEvent { kind, id: Some(id.to_string()), a: None, b: None, lap: None, pos: None }
    }

    pub fn pair(kind: EventKind, a: &str, b: &str) -> TickEvent {
        TickEvent { kind, id: None, a: Some(a.to_string()), b: Some(b.to_string()), lap: None, pos: None }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResult {
    pub finish_tick: u32,
    pub order: Vec<String>,
    pub as_run: Vec<String>,
    pub entrants: Vec<ResultEntrant>,
    pub lap_leaders: Vec<LapLeader>,
    pub incidents: Vec<Incident>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultEntrant {
    pub id: String,
    pub official_position: u32,
    pub as_run_position: u32,
    pub result_status: ResultStatus,
    pub finish_time_ms: Option<i64>,
    pub distance_covered: Num,
    pub laps_led: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LapLeader {
    pub lap: u32,
    pub entrant_id: String,
    pub tick: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Incident {
    pub seq: u32,
    pub tick: u32,
    #[serde(rename = "type")]
    pub kind: IncidentKind,
    pub entrant_id: Option<String>,
    pub data: serde_json::Value,
}

impl RaceScript {
    pub fn to_json_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }

    pub fn from_json_bytes(bytes: &[u8]) -> Result<RaceScript, EngineError> {
        serde_json::from_slice(bytes).map_err(|err| EngineError::InvalidScript(err.to_string()))
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[derive(Debug, Clone, PartialEq)]
pub struct SealedScript {
    pub script: RaceScript,
    pub json: Vec<u8>,
    pub script_hash: String,
    pub seed_hash: String,
}
