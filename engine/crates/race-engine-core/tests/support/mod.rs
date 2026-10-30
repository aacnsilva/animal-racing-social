#![allow(dead_code)]

use race_engine_core::{EntrantInput, LoadedParams, Stats, Temperament, Venue, default_params, fast_rng, parse_venues};
use rand_chacha::ChaCha8Rng;
use rand_core::Rng;

pub const VENUES_JSON: &str = include_str!("../../../../../shared/venues.json");

pub fn params() -> LoadedParams {
    default_params().expect("embedded params load")
}

pub fn venues() -> Vec<Venue> {
    parse_venues(VENUES_JSON).expect("venues parse")
}

pub fn venue(id: &str) -> Venue {
    venues().into_iter().find(|venue| venue.id == id).expect("venue exists")
}

pub const TEMPERAMENTS: [Temperament; 4] =
    [Temperament::FrontRunner, Temperament::Stalker, Temperament::Closer, Temperament::Steady];

pub fn typical_stats(species: &str) -> Stats {
    match species {
        "GIRAFFE" => Stats { velocity: 13.6, stamina: 80.0, acceleration: 2.6, consistency: 0.74 },
        _ => Stats { velocity: 15.1, stamina: 74.0, acceleration: 3.4, consistency: 0.78 },
    }
}

pub fn ranges(species: &str) -> [(f64, f64); 4] {
    match species {
        "GIRAFFE" => [(12.5, 15.5), (65.0, 98.0), (1.8, 3.5), (0.55, 0.92)],
        _ => [(14.0, 17.0), (55.0, 95.0), (2.5, 4.5), (0.6, 0.95)],
    }
}

fn uniform(rng: &mut ChaCha8Rng) -> f64 {
    (rng.next_u64() >> 11) as f64 / 9_007_199_254_740_992.0
}

pub fn typical_field(species: &str, count: usize) -> Vec<EntrantInput> {
    let base = typical_stats(species);
    (0..count)
        .map(|index| {
            let spread = (index as f64 - (count as f64 - 1.0) / 2.0) / count as f64;
            EntrantInput {
                entrant_id: format!("e{}", index + 1),
                animal_id: format!("{}", 100 + index),
                lane: index as u32 + 1,
                temperament: TEMPERAMENTS[index % 4],
                stats: Stats {
                    velocity: base.velocity * (1.0 + 0.04 * spread),
                    stamina: base.stamina - 10.0 * spread,
                    acceleration: base.acceleration * (1.0 + 0.1 * spread),
                    consistency: base.consistency,
                },
            }
        })
        .collect()
}

pub fn varied_field(species: &str, count: usize, seed: u8) -> Vec<EntrantInput> {
    let mut rng = fast_rng([seed; 32]);
    let ranges = ranges(species);
    let mut lanes: Vec<u32> = (1..=10).collect();
    for position in (1..lanes.len()).rev() {
        let pick = (rng.next_u64() % (position as u64 + 1)) as usize;
        lanes.swap(position, pick);
    }
    (0..count)
        .map(|index| {
            let mut draw = |range: (f64, f64)| range.0 + (range.1 - range.0) * uniform(&mut rng);
            let stats = Stats {
                velocity: (draw(ranges[0]) * 100.0).round() / 100.0,
                stamina: draw(ranges[1]).round(),
                acceleration: (draw(ranges[2]) * 100.0).round() / 100.0,
                consistency: (draw(ranges[3]) * 1000.0).round() / 1000.0,
            };
            let temperament = TEMPERAMENTS[(rng.next_u64() % 4) as usize];
            EntrantInput {
                entrant_id: format!("e{}", index + 1),
                animal_id: format!("{}", 500 + index),
                lane: lanes[index],
                temperament,
                stats,
            }
        })
        .collect()
}

pub fn strength(species: &str, stats: &Stats) -> f64 {
    let ranges = ranges(species);
    let normalize = |value: f64, range: (f64, f64)| (value - range.0) / (range.1 - range.0);
    3.0 * normalize(stats.velocity, ranges[0])
        + normalize(stats.stamina, ranges[1])
        + normalize(stats.acceleration, ranges[2])
        + normalize(stats.consistency, ranges[3])
}

pub fn favourite(species: &str, field: &[EntrantInput]) -> usize {
    let mut best = 0;
    for index in 1..field.len() {
        if strength(species, &field[index].stats) > strength(species, &field[best].stats) {
            best = index;
        }
    }
    best
}

pub fn race_inputs(species: &str, laps: u32, entrants: Vec<EntrantInput>) -> race_engine_core::RaceInputs {
    race_engine_core::RaceInputs {
        race_id: "1001".into(),
        engine_version: race_engine_core::ENGINE_VERSION.into(),
        species: species.into(),
        laps,
        entrants,
    }
}

pub fn seed(value: u64) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    bytes[..8].copy_from_slice(&value.to_le_bytes());
    bytes[31] = 0x5a;
    bytes
}

pub fn params_with(edit: impl Fn(&mut serde_json::Value)) -> LoadedParams {
    let mut value: serde_json::Value =
        serde_json::from_str(race_engine_core::DEFAULT_PARAMS_JSON).expect("params json");
    edit(&mut value);
    LoadedParams::from_value(&value).expect("edited params load")
}
