use serde::{Deserialize, Serialize};

use crate::error::EngineError;
use crate::venue::Venue;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Stats {
    pub velocity: f64,
    pub stamina: f64,
    pub acceleration: f64,
    pub consistency: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Temperament {
    FrontRunner,
    Stalker,
    Closer,
    Steady,
}

impl Temperament {
    pub fn key(self) -> &'static str {
        match self {
            Temperament::FrontRunner => "FRONT_RUNNER",
            Temperament::Stalker => "STALKER",
            Temperament::Closer => "CLOSER",
            Temperament::Steady => "STEADY",
        }
    }

    pub fn parse(text: &str) -> Option<Temperament> {
        match text {
            "FRONT_RUNNER" => Some(Temperament::FrontRunner),
            "STALKER" => Some(Temperament::Stalker),
            "CLOSER" => Some(Temperament::Closer),
            "STEADY" => Some(Temperament::Steady),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrantInput {
    pub entrant_id: String,
    pub animal_id: String,
    pub lane: u32,
    pub temperament: Temperament,
    pub stats: Stats,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RaceInputs {
    pub race_id: String,
    pub engine_version: String,
    pub species: String,
    pub laps: u32,
    pub entrants: Vec<EntrantInput>,
}

pub fn entrant_number(entrant_id: &str) -> Option<u32> {
    entrant_id.strip_prefix('e').and_then(|digits| digits.parse::<u32>().ok())
}

pub fn sorted_entrants(entrants: &[EntrantInput]) -> Vec<EntrantInput> {
    let mut sorted = entrants.to_vec();
    sorted.sort_by(|left, right| {
        let left_key = (entrant_number(&left.entrant_id).unwrap_or(u32::MAX), left.entrant_id.as_str());
        let right_key = (entrant_number(&right.entrant_id).unwrap_or(u32::MAX), right.entrant_id.as_str());
        left_key.cmp(&right_key)
    });
    sorted
}

pub fn validate_entrants(entrants: &[EntrantInput], venue: &Venue) -> Result<(), EngineError> {
    if entrants.is_empty() || entrants.len() > venue.lanes as usize {
        return Err(EngineError::InvalidInputs(format!(
            "entrant count {} must be between 1 and {}",
            entrants.len(),
            venue.lanes
        )));
    }
    for (index, entrant) in entrants.iter().enumerate() {
        if entrant.entrant_id.is_empty() {
            return Err(EngineError::InvalidInputs("empty entrantId".into()));
        }
        if entrant.lane == 0 || entrant.lane > venue.lanes {
            return Err(EngineError::InvalidInputs(format!("lane {} out of range", entrant.lane)));
        }
        let stats = entrant.stats;
        let finite = stats.velocity.is_finite()
            && stats.stamina.is_finite()
            && stats.acceleration.is_finite()
            && stats.consistency.is_finite();
        if !finite || stats.velocity <= 0.0 || stats.acceleration <= 0.0 || stats.stamina < 0.0 {
            return Err(EngineError::InvalidInputs(format!("stats of {} out of range", entrant.entrant_id)));
        }
        if !(0.0..=1.0).contains(&stats.consistency) || stats.stamina > 100.0 {
            return Err(EngineError::InvalidInputs(format!("stats of {} out of range", entrant.entrant_id)));
        }
        for other in &entrants[index + 1..] {
            if other.entrant_id == entrant.entrant_id {
                return Err(EngineError::InvalidInputs(format!("duplicate entrant {}", entrant.entrant_id)));
            }
            if other.lane == entrant.lane {
                return Err(EngineError::InvalidInputs(format!("duplicate lane {}", entrant.lane)));
            }
        }
    }
    Ok(())
}
