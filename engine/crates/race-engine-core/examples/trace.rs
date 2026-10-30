#[path = "../tests/support/mod.rs"]
mod support;

use race_engine_core::{EntrantInput, EntrantState, RaceInputs, plan_race, simulate};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let venue = support::venue(args.get(1).map(String::as_str).unwrap_or("v_jungle_marathon"));
    let species = args.get(2).map(String::as_str).unwrap_or("HORSE");
    let params = support::params();
    let base = support::typical_stats(species);
    let field: Vec<EntrantInput> = (0..8)
        .map(|index| EntrantInput {
            entrant_id: format!("e{}", index + 1),
            animal_id: format!("{index}"),
            lane: index as u32 + 1,
            temperament: support::TEMPERAMENTS[index % 4],
            stats: base,
        })
        .collect();
    let plan = plan_race(&params, &venue, species, &venue.class, &field).expect("plan");
    let inputs = RaceInputs { race_id: "1".into(), engine_version: "1.0.0".into(), species: species.into(), laps: plan.laps, entrants: field.clone() };
    let seed_value: u8 = args.get(3).and_then(|value| value.parse().ok()).unwrap_or(1);
    let sealed = simulate(&params, &venue, &inputs, &[seed_value; 32]).expect("simulate");
    let script = &sealed.script;
    let length = script.track.length.0;
    println!("laps {} length {} finishTick {}", plan.laps, length, script.result.finish_tick);
    for fraction in [0.1, 0.25, 0.5, 0.75, 0.85, 0.9, 0.95] {
        let tick = script.ticks.iter().find(|tick| tick.entrants.iter().map(|e| e.dist.0).fold(0.0, f64::max) >= fraction * length).expect("tick");
        let cells: Vec<String> = tick.entrants.iter().map(|e| format!("{}:{}{:.0}/{:.1}/{:.0}", e.pos, &field[e.id[1..].parse::<usize>().unwrap() - 1].temperament.key()[..2], e.dist.0, e.speed.0, e.stamina_pct.0)).collect();
        println!("{:>4.0}% t{:>4} {}", fraction * 100.0, tick.tick, cells.join(" "));
    }
    for entrant in &script.result.entrants {
        let tired = script.ticks.iter().filter(|tick| tick.entrants.iter().any(|e| e.id == entrant.id && e.state == EntrantState::Tired)).count();
        let temperament = field[entrant.id[1..].parse::<usize>().unwrap() - 1].temperament.key();
        println!("{} {} {:?} pos {} time {:?} tiredTicks {}", entrant.id, temperament, entrant.result_status, entrant.official_position, entrant.finish_time_ms, tired);
    }
}
