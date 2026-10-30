mod support;

use race_engine_core::{RaceInputs, sha256_hex, simulate};

fn inputs() -> (race_engine_core::Venue, RaceInputs) {
    let venue = support::venue("v_riverside_oval");
    (venue, support::race_inputs("HORSE", 6, support::varied_field("HORSE", 8, 11)))
}

#[test]
fn same_inputs_and_seed_give_identical_bytes_and_hash() {
    let params = support::params();
    let (venue, inputs) = inputs();
    let first = simulate(&params, &venue, &inputs, &support::seed(7)).expect("simulate");
    let second = simulate(&params, &venue, &inputs, &support::seed(7)).expect("simulate");
    assert_eq!(first.json, second.json);
    assert_eq!(first.script_hash, second.script_hash);
    assert_eq!(first.script_hash, sha256_hex(&first.json));
    assert_eq!(first.seed_hash, sha256_hex(&support::seed(7)));
}

#[test]
fn different_seeds_give_different_scripts() {
    let params = support::params();
    let (venue, inputs) = inputs();
    let hashes: Vec<String> = (0..6)
        .map(|value| simulate(&params, &venue, &inputs, &support::seed(value)).expect("simulate").script_hash)
        .collect();
    for (index, hash) in hashes.iter().enumerate() {
        for other in &hashes[index + 1..] {
            assert_ne!(hash, other);
        }
    }
}

#[test]
fn entrant_input_order_does_not_matter() {
    let params = support::params();
    let (venue, inputs) = inputs();
    let mut shuffled = inputs.clone();
    shuffled.entrants.reverse();
    let first = simulate(&params, &venue, &inputs, &support::seed(3)).expect("simulate");
    let second = simulate(&params, &venue, &shuffled, &support::seed(3)).expect("simulate");
    assert_eq!(first.script_hash, second.script_hash);
}

#[test]
fn script_round_trips_through_json() {
    let params = support::params();
    let (venue, inputs) = inputs();
    let sealed = simulate(&params, &venue, &inputs, &support::seed(5)).expect("simulate");
    let parsed = race_engine_core::RaceScript::from_json_bytes(&sealed.json).expect("parse");
    assert_eq!(parsed.to_json_bytes(), sealed.json);
}
