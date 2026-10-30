use sha2::{Digest, Sha256};

use crate::error::EngineError;
use crate::inputs::EntrantInput;
use crate::outcome::simulate_from;
use crate::params::LoadedParams;
use crate::rng::fast_rng;
use crate::sim::PreparedRace;
use crate::venue::Venue;

#[derive(Debug, Clone, PartialEq)]
pub struct LapEstimate {
    pub laps: u32,
    pub median_duration_sec: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub laps: u32,
    pub estimated_duration_sec: u32,
    pub median_duration_sec: f64,
    pub in_window: bool,
    pub candidates: Vec<LapEstimate>,
}

pub fn dry_run_durations(
    params: &LoadedParams,
    venue: &Venue,
    species: &str,
    laps: u32,
    entrants: &[EntrantInput],
    runs: u32,
) -> Result<Vec<f64>, EngineError> {
    let race = PreparedRace::new(params, venue, species, laps, entrants)?;
    let mut durations = Vec::with_capacity(runs as usize);
    for run in 0..runs {
        let label = format!("plan|{}|{}|{}|{}", venue.id, venue.version, laps, run);
        let seed: [u8; 32] = Sha256::digest(label.as_bytes()).into();
        let mut rng = fast_rng(seed);
        let outcome = simulate_from(&race, None, &mut rng)?;
        durations.push(outcome.finish_tick as f64 * race.tick_ms() as f64 / 1000.0);
    }
    Ok(durations)
}

pub fn median(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|left, right| left.total_cmp(right));
    let middle = sorted.len() / 2;
    if sorted.len() % 2 == 1 { sorted[middle] } else { (sorted[middle - 1] + sorted[middle]) / 2.0 }
}

pub fn plan_race(
    params: &LoadedParams,
    venue: &Venue,
    species: &str,
    race_class: &str,
    entrants: &[EntrantInput],
) -> Result<Plan, EngineError> {
    let window = *params
        .params
        .classes
        .get(race_class)
        .ok_or_else(|| EngineError::InvalidInputs(format!("unknown race class {race_class}")))?;
    venue.validate()?;
    let runs = params.params.planning.dry_runs.max(1);
    let mut candidates = Vec::new();
    for laps in venue.laps_range[0]..=venue.laps_range[1] {
        let durations = dry_run_durations(params, venue, species, laps, entrants, runs)?;
        candidates.push(LapEstimate { laps, median_duration_sec: median(&durations) });
    }
    let distance_outside = |value: f64| {
        if value < window.min_sec {
            window.min_sec - value
        } else if value > window.max_sec {
            value - window.max_sec
        } else {
            0.0
        }
    };
    let best = candidates
        .iter()
        .min_by(|left, right| {
            let left_key = (distance_outside(left.median_duration_sec), (left.median_duration_sec - window.target_sec).abs());
            let right_key = (distance_outside(right.median_duration_sec), (right.median_duration_sec - window.target_sec).abs());
            left_key.0.total_cmp(&right_key.0).then(left_key.1.total_cmp(&right_key.1)).then(left.laps.cmp(&right.laps))
        })
        .cloned()
        .ok_or_else(|| EngineError::InvalidVenue("empty lapsRange".into()))?;
    Ok(Plan {
        laps: best.laps,
        estimated_duration_sec: libm::round(best.median_duration_sec) as u32,
        median_duration_sec: best.median_duration_sec,
        in_window: distance_outside(best.median_duration_sec) == 0.0,
        candidates,
    })
}
