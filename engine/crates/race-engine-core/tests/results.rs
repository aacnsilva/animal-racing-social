mod support;

use std::collections::BTreeSet;

use race_engine_core::{EntrantState, EventKind, IncidentKind, RaceScript, ResultStatus, simulate};

fn check_script(script: &RaceScript) {
    let count = script.entrants.len();
    let length = script.track.length.0;
    for (position, tick) in script.ticks.iter().enumerate() {
        assert_eq!(tick.tick as usize, position);
        assert_eq!(tick.entrants.len(), count);
        let positions: BTreeSet<u32> = tick.entrants.iter().map(|entrant| entrant.pos).collect();
        assert_eq!(positions, (1..=count as u32).collect::<BTreeSet<u32>>(), "tick {} pos not a permutation", tick.tick);
        for entrant in &tick.entrants {
            assert!(entrant.dist.0 >= 0.0 && entrant.dist.0 <= length + 1e-6);
            assert!(entrant.stamina_pct.0 >= 0.0 && entrant.stamina_pct.0 <= 100.0);
            assert!(entrant.lane.0 >= 1.0 && entrant.lane.0 <= script.track.lanes as f64);
        }
        assert!(tick.lap >= 1 && tick.lap <= script.track.laps);
    }
    let last = script.ticks.last().expect("ticks");
    assert_eq!(last.tick, script.result.finish_tick);
    assert!(last.entrants.iter().all(|entrant| matches!(entrant.state, EntrantState::Finished | EntrantState::Dnf)));
    let result = &script.result;
    assert_eq!(result.order.len(), count);
    assert_eq!(result.as_run.len(), count);
    assert_eq!(result.order.iter().collect::<BTreeSet<_>>().len(), count);
    assert_eq!(result.as_run.iter().collect::<BTreeSet<_>>().len(), count);
    let official: BTreeSet<u32> = result.entrants.iter().map(|entrant| entrant.official_position).collect();
    let as_run: BTreeSet<u32> = result.entrants.iter().map(|entrant| entrant.as_run_position).collect();
    assert_eq!(official, (1..=count as u32).collect::<BTreeSet<u32>>());
    assert_eq!(as_run, (1..=count as u32).collect::<BTreeSet<u32>>());
    let rank = |status: ResultStatus| match status {
        ResultStatus::Finished => 0,
        ResultStatus::Disqualified => 1,
        ResultStatus::Dnf => 2,
        ResultStatus::NonRunner => 3,
    };
    for pair in result.entrants.windows(2) {
        assert!(pair[0].official_position < pair[1].official_position);
        assert!(rank(pair[0].result_status) <= rank(pair[1].result_status));
        if pair[0].result_status == pair[1].result_status {
            match pair[0].result_status {
                ResultStatus::Finished | ResultStatus::Disqualified => {
                    assert!(pair[0].finish_time_ms <= pair[1].finish_time_ms)
                }
                ResultStatus::Dnf => assert!(pair[0].distance_covered.0 >= pair[1].distance_covered.0),
                ResultStatus::NonRunner => {}
            }
        }
    }
    for (position, id) in result.order.iter().enumerate() {
        assert_eq!(&result.entrants[position].id, id);
    }
    let finishes: Vec<(String, u32)> = script
        .ticks
        .iter()
        .flat_map(|tick| tick.events.iter())
        .filter(|event| event.kind == EventKind::Finish)
        .map(|event| (event.id.clone().expect("id"), event.pos.expect("pos")))
        .collect();
    for (id, pos) in &finishes {
        let entrant = result.entrants.iter().find(|entrant| &entrant.id == id).expect("entrant");
        assert_eq!(entrant.as_run_position, *pos);
    }
    let finished_count = result
        .entrants
        .iter()
        .filter(|entrant| matches!(entrant.result_status, ResultStatus::Finished | ResultStatus::Disqualified))
        .count();
    assert_eq!(finishes.len(), finished_count);
    if finished_count > 0 {
        assert_eq!(result.lap_leaders.len(), script.track.laps as usize);
        let laps: Vec<u32> = result.lap_leaders.iter().map(|leader| leader.lap).collect();
        assert_eq!(laps, (1..=script.track.laps).collect::<Vec<u32>>());
        assert_eq!(result.lap_leaders.last().expect("last").entrant_id, result.as_run[0]);
        let lap_events: Vec<(u32, String)> = script
            .ticks
            .iter()
            .flat_map(|tick| tick.events.iter())
            .filter(|event| event.kind == EventKind::Lap)
            .map(|event| (event.lap.expect("lap"), event.id.clone().expect("id")))
            .collect();
        assert_eq!(lap_events.len(), result.lap_leaders.len());
        for leader in &result.lap_leaders {
            assert!(lap_events.contains(&(leader.lap, leader.entrant_id.clone())));
            let led = &result.entrants.iter().find(|entrant| entrant.id == leader.entrant_id).expect("entrant").laps_led;
            assert!(led.contains(&leader.lap));
        }
    }
    for (index, incident) in result.incidents.iter().enumerate() {
        assert_eq!(incident.seq as usize, index + 1);
        if index > 0 {
            assert!(incident.tick >= result.incidents[index - 1].tick);
        }
    }
}

#[test]
fn scripts_have_unique_positions_and_consistent_results() {
    let params = support::params();
    for venue_id in ["v_meadow_dash", "v_hairpin_hollow", "v_glacier_grand"] {
        let venue = support::venue(venue_id);
        for species in ["HORSE", "GIRAFFE"] {
            for value in 0..4 {
                let inputs = support::race_inputs(species, venue.laps_range[0], support::varied_field(species, 6 + value as usize, value as u8 + 1));
                let sealed = simulate(&params, &venue, &inputs, &support::seed(value)).expect("simulate");
                check_script(&sealed.script);
            }
        }
    }
}

#[test]
fn incidents_classify_in_official_order() {
    let params = support::params_with(|value| {
        let incidents = &mut value["incidents"];
        incidents["refusedPerEntrant"] = serde_json::json!(0.25);
        incidents["pulledUpPerEntrant"] = serde_json::json!(0.25);
        incidents["disqualifiedPerRace"] = serde_json::json!(1.0);
        incidents["falseStartPerRace"] = serde_json::json!(1.0);
    });
    let venue = support::venue("v_canyon_chute");
    let mut seen = BTreeSet::new();
    for value in 0..30 {
        let inputs = support::race_inputs("HORSE", 3, support::varied_field("HORSE", 10, value as u8 + 3));
        let sealed = simulate(&params, &venue, &inputs, &support::seed(value)).expect("simulate");
        check_script(&sealed.script);
        let result = &sealed.script.result;
        for incident in &result.incidents {
            seen.insert(incident.kind.key());
        }
        for entrant in &result.entrants {
            seen.insert(entrant.result_status.key());
            if entrant.result_status == ResultStatus::NonRunner {
                for tick in &sealed.script.ticks {
                    let state = tick.entrants.iter().find(|candidate| candidate.id == entrant.id).expect("entrant");
                    assert_eq!(state.dist.0, 0.0);
                    assert_eq!(state.state, EntrantState::Dnf);
                }
            }
        }
        let disqualified = result.incidents.iter().filter(|incident| incident.kind == IncidentKind::Disqualified).count();
        assert!(disqualified <= 1);
        if disqualified == 1 {
            let finishers = result
                .entrants
                .iter()
                .filter(|entrant| matches!(entrant.result_status, ResultStatus::Finished | ResultStatus::Disqualified))
                .count() as u32;
            let dq = result
                .entrants
                .iter()
                .find(|entrant| entrant.result_status == ResultStatus::Disqualified)
                .expect("disqualified entrant");
            assert_eq!(dq.official_position, finishers);
            if dq.as_run_position < finishers {
                assert_ne!(result.order, result.as_run);
            }
        }
        let tick_zero: Vec<EventKind> = sealed.script.ticks[0].events.iter().map(|event| event.kind).collect();
        assert!(tick_zero.contains(&EventKind::FalseStart) || result.entrants.iter().all(|entrant| entrant.result_status == ResultStatus::NonRunner));
    }
    for expected in ["REFUSED_TO_RUN", "PULLED_UP", "DISQUALIFIED", "FALSE_START", "FINISHED", "DNF", "NON_RUNNER"] {
        assert!(seen.contains(expected), "never saw {expected}");
    }
}

#[test]
fn script_json_matches_contract_shape() {
    let params = support::params();
    let venue = support::venue("v_dune_loop");
    let inputs = support::race_inputs("GIRAFFE", 6, support::varied_field("GIRAFFE", 8, 2));
    let sealed = simulate(&params, &venue, &inputs, &support::seed(1)).expect("simulate");
    let value: serde_json::Value = serde_json::from_slice(&sealed.json).expect("json");
    for key in ["raceId", "engineVersion", "paramsHash", "seed", "tickMs", "species", "track", "entrants", "ticks", "result"] {
        assert!(value.get(key).is_some(), "missing {key}");
    }
    assert_eq!(value["tickMs"], 500);
    assert_eq!(value["seed"].as_str().expect("seed").len(), 64);
    assert_eq!(value["track"]["length"], serde_json::json!(3376.44));
    assert_eq!(value["track"]["lanes"], 10);
    let first_tick = &value["ticks"][0];
    assert_eq!(first_tick["tick"], 0);
    assert_eq!(first_tick["lap"], 1);
    let entrant = &first_tick["entrants"][0];
    for key in ["id", "dist", "lane", "speed", "staminaPct", "state", "pos"] {
        assert!(entrant.get(key).is_some(), "missing tick entrant {key}");
    }
    assert_eq!(entrant["dist"], serde_json::json!(0));
    assert_eq!(entrant["staminaPct"], serde_json::json!(100));
    let result = &value["result"];
    for key in ["finishTick", "order", "asRun", "entrants", "lapLeaders", "incidents"] {
        assert!(result.get(key).is_some(), "missing result {key}");
    }
    for key in ["id", "officialPosition", "asRunPosition", "resultStatus", "finishTimeMs", "distanceCovered", "lapsLed"] {
        assert!(result["entrants"][0].get(key).is_some(), "missing result entrant {key}");
    }
}
