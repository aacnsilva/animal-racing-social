mod support;

use race_engine_core::{PreparedRace, RevealedState, estimate_probabilities, plan_race, simulate};

#[test]
fn probabilities_from_revealed_state_are_valid_and_sharpen() {
    let params = support::params();
    let venue = support::venue("v_riverside_oval");
    let field = support::varied_field("HORSE", 8, 21);
    let plan = plan_race(&params, &venue, "HORSE", "STANDARD", &field).expect("plan");
    let inputs = support::race_inputs("HORSE", plan.laps, field.clone());
    let sealed = simulate(&params, &venue, &inputs, &support::seed(99)).expect("simulate");
    let script = &sealed.script;
    let race = PreparedRace::new(&params, &venue, "HORSE", plan.laps, &field).expect("race");
    let winner = race.entrant_index(&script.result.order[0]).expect("winner");
    let finish = script.result.finish_tick;
    let mut sharpness = Vec::new();
    let mut winner_probability = Vec::new();
    for fraction in [0.0, 0.3, 0.6, 0.85, 0.97] {
        let tick = (finish as f64 * fraction) as u32;
        let revealed = RevealedState::from_script(script, tick).expect("tick");
        let table = estimate_probabilities(&race, Some(&revealed), 1500, 2, [tick as u8; 32]).expect("estimate");
        let count = field.len();
        for row in &table.positions {
            let sum: f64 = row.iter().sum();
            assert!((sum - 1.0).abs() < 1e-9, "row sums to {sum}");
        }
        for column in 0..count {
            let sum: f64 = table.positions.iter().map(|row| row[column]).sum();
            assert!((sum - 1.0).abs() < 1e-9, "column sums to {sum}");
        }
        for lap in 1..=plan.laps {
            let sum: f64 = (0..count).map(|entrant| table.leader_at_lap(entrant, lap)).sum();
            assert!((sum - 1.0).abs() < 1e-9, "lap {lap} leader probabilities sum to {sum}");
        }
        for entrant in 0..count {
            let top3 = table.top_n(entrant, 3);
            assert!((0.0..=1.0 + 1e-12).contains(&top3));
        }
        let best = (0..count).map(|entrant| table.win(entrant)).fold(0.0, f64::max);
        sharpness.push(best);
        winner_probability.push(table.win(winner));
    }
    assert!(sharpness.last().expect("last") > sharpness.first().expect("first"), "{sharpness:?}");
    assert!(winner_probability[4] > winner_probability[0], "{winner_probability:?}");
    assert!(winner_probability[4] > 0.5, "{winner_probability:?}");
    let pre_race = estimate_probabilities(&race, None, 1000, 2, [1; 32]).expect("estimate");
    let total: f64 = (0..field.len()).map(|entrant| pre_race.win(entrant)).sum();
    assert!((total - 1.0).abs() < 1e-9);
}

#[test]
fn finished_entrants_are_certain() {
    let params = support::params();
    let venue = support::venue("v_meadow_dash");
    let field = support::varied_field("GIRAFFE", 6, 5);
    let inputs = support::race_inputs("GIRAFFE", 3, field.clone());
    let sealed = simulate(&params, &venue, &inputs, &support::seed(4)).expect("simulate");
    let script = &sealed.script;
    let race = PreparedRace::new(&params, &venue, "GIRAFFE", 3, &field).expect("race");
    let first_finish_tick = script
        .ticks
        .iter()
        .find(|tick| tick.entrants.iter().any(|entrant| entrant.pos == 1 && entrant.state == race_engine_core::EntrantState::Finished))
        .expect("someone finished")
        .tick;
    let revealed = RevealedState::from_script(script, first_finish_tick).expect("tick");
    let table = estimate_probabilities(&race, Some(&revealed), 200, 1, [3; 32]).expect("estimate");
    let winner = race.entrant_index(&script.result.as_run[0]).expect("winner");
    if script.result.order[0] == script.result.as_run[0] {
        assert!(table.win(winner) > 0.99);
    }
    assert!((table.leader_at_lap(winner, 3) - 1.0).abs() < 1e-12);
}
