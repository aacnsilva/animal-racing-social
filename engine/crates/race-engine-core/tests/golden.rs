mod support;

use race_engine_core::{EntrantInput, RaceInputs, Venue, parse_seed, simulate};

const GOLDEN: &str = include_str!("fixtures/golden.json");

#[test]
fn golden_script_hash_is_stable() {
    let fixture: serde_json::Value = serde_json::from_str(GOLDEN).expect("fixture json");
    let venue: Venue = serde_json::from_value(fixture["venue"].clone()).expect("venue");
    let entrants: Vec<EntrantInput> = serde_json::from_value(fixture["entrants"].clone()).expect("entrants");
    let inputs = RaceInputs {
        race_id: fixture["raceId"].as_str().expect("raceId").into(),
        engine_version: fixture["engineVersion"].as_str().expect("engineVersion").into(),
        species: fixture["species"].as_str().expect("species").into(),
        laps: fixture["laps"].as_u64().expect("laps") as u32,
        entrants,
    };
    let seed = parse_seed(fixture["seed"].as_str().expect("seed")).expect("seed hex");
    let sealed = simulate(&support::params(), &venue, &inputs, &seed).expect("simulate");
    let expected = fixture["scriptHash"].as_str().expect("scriptHash");
    assert_eq!(
        sealed.script_hash, expected,
        "golden scriptHash changed (engine or shared/engine-params.json changed); new hash {}",
        sealed.script_hash
    );
}
