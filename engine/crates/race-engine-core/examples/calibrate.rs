#[path = "../tests/support/mod.rs"]
mod support;

use std::collections::BTreeMap;
use std::time::Instant;

use race_engine_core::{
    EntrantInput, EventKind, LoadedParams, PreparedRace, RaceInputs, ResultStatus, Temperament,
    estimate_probabilities, fast_rng, plan_race, simulate, simulate_from,
};

fn scaled(field: &[EntrantInput], factor: f64) -> Vec<EntrantInput> {
    field
        .iter()
        .map(|entrant| {
            let mut copy = entrant.clone();
            copy.stats.velocity *= factor;
            copy
        })
        .collect()
}

#[expect(
    clippy::print_stdout,
    reason = "calibration report is written to stdout"
)]
fn plan_report(params: &LoadedParams) {
    println!("== plan (typical field of 8; slow = velocity x0.94, fast = x1.06)");
    for venue in support::venues() {
        for species in support::species_for(&venue) {
            let field = support::typical_field(species, 8);
            let plan = plan_race(params, &venue, species, &venue.class, &field).expect("plan");
            let slow = plan_race(params, &venue, species, &venue.class, &scaled(&field, 0.94))
                .expect("plan");
            let fast = plan_race(params, &venue, species, &venue.class, &scaled(&field, 1.06))
                .expect("plan");
            let candidates: Vec<String> = plan
                .candidates
                .iter()
                .map(|candidate| format!("{}:{:.0}", candidate.laps, candidate.median_duration_sec))
                .collect();
            println!(
                "{:<18} {:<8} {:<9} laps {} est {:>4}s in_window {} | {} | slow {}:{:.0}{} fast {}:{:.0}{}",
                venue.id,
                species,
                venue.class,
                plan.laps,
                plan.estimated_duration_sec,
                plan.in_window,
                candidates.join(" "),
                slow.laps,
                slow.median_duration_sec,
                if slow.in_window { "" } else { "!" },
                fast.laps,
                fast.median_duration_sec,
                if fast.in_window { "" } else { "!" },
            );
        }
    }
}

#[expect(
    clippy::print_stdout,
    reason = "calibration report is written to stdout"
)]
fn field_report(params: &LoadedParams, runs: u32) {
    println!("== varied fields of 8: winners over {runs} runs");
    let venue_ids = [
        "v_meadow_dash",
        "v_frost_strip",
        "v_riverside_oval",
        "v_mudflat_ring",
        "v_hairpin_hollow",
        "v_glacier_grand",
        "v_jungle_marathon",
        "v_coastal_classic",
        "v_lido_sprint",
        "v_reef_tank_rush",
        "v_olympic_pool",
        "v_grand_aquarium",
    ];
    let mut favourite_total = 0.0;
    let mut favourite_count = 0.0;
    for venue_id in venue_ids {
        let venue = support::venue(venue_id);
        for species in support::species_for(&venue) {
            for seed in 1..=3u8 {
                let field = support::varied_field(species, 8, seed);
                let plan = plan_race(params, &venue, species, &venue.class, &field).expect("plan");
                let race =
                    PreparedRace::new(params, &venue, species, plan.laps, &field).expect("race");
                let mut rng = fast_rng([seed.wrapping_add(77); 32]);
                let mut wins = vec![0u32; field.len()];
                for _ in 0..runs {
                    let outcome = simulate_from(&race, None, &mut rng).expect("outcome");
                    wins[outcome.official[0]] += 1;
                }
                let favourite = support::favourite(species, &field);
                let favourite_share = f64::from(wins[favourite]) / f64::from(runs);
                favourite_total += favourite_share;
                favourite_count += 1.0;
                let distinct = wins.iter().filter(|count| **count > 0).count();
                let shares: Vec<String> = wins
                    .iter()
                    .enumerate()
                    .map(|(index, count)| {
                        let entrant = &field[index];
                        format!(
                            "{}{}{:.0}",
                            &entrant.temperament.key()[..2],
                            if index == favourite { "*" } else { "" },
                            100.0 * f64::from(*count) / f64::from(runs)
                        )
                    })
                    .collect();
                println!(
                    "{:<18} {:<8} seed {} laps {} fav {:.2} distinct {} | {}",
                    venue_id,
                    species,
                    seed,
                    plan.laps,
                    favourite_share,
                    distinct,
                    shares.join(" ")
                );
            }
        }
    }
    println!(
        "mean favourite win share {:.3}",
        favourite_total / favourite_count
    );
}

#[expect(
    clippy::print_stdout,
    reason = "calibration report is written to stdout"
)]
fn temperament_report(params: &LoadedParams, runs: u32) {
    println!("== temperament balance (identical stats, 2 of each temperament)");
    for venue in support::venues() {
        for species in support::species_for(&venue) {
            let base = support::typical_stats(species);
            let field: Vec<EntrantInput> = (0..8u32)
                .map(|index| EntrantInput {
                    entrant_id: format!("e{}", index + 1),
                    animal_id: format!("{index}"),
                    lane: index + 1,
                    temperament: support::TEMPERAMENTS[index as usize % 4],
                    stats: base,
                })
                .collect();
            let plan = plan_race(params, &venue, species, &venue.class, &field).expect("plan");
            let race = PreparedRace::new(params, &venue, species, plan.laps, &field).expect("race");
            let mut rng = fast_rng([9; 32]);
            let mut wins: BTreeMap<&str, u32> = BTreeMap::new();
            let mut lane_wins = [0u32; 8];
            for _ in 0..runs {
                let outcome = simulate_from(&race, None, &mut rng).expect("outcome");
                *wins
                    .entry(field[outcome.official[0]].temperament.key())
                    .or_default() += 1;
                lane_wins[outcome.official[0]] += 1;
            }
            let shares: Vec<String> = wins
                .iter()
                .map(|(name, count)| {
                    format!("{} {:.2}", &name[..5], f64::from(*count) / f64::from(runs))
                })
                .collect();
            let lanes: Vec<String> = lane_wins
                .iter()
                .map(|count| format!("{:.0}", 100.0 * f64::from(*count) / f64::from(runs)))
                .collect();
            println!(
                "{:<18} {:<8} {} | lanes {}",
                venue.id,
                species,
                shares.join(" "),
                lanes.join(" ")
            );
        }
    }
}

#[expect(
    clippy::print_stdout,
    clippy::cast_precision_loss,
    reason = "calibration report averages small counts and writes them to stdout"
)]
fn incident_report(params: &LoadedParams, races: u32) {
    println!("== full scripts: incidents, overtakes, stamina");
    let mut total_races = 0u32;
    let mut clean_races = 0u32;
    for venue in support::venues() {
        for species in support::species_for(&venue) {
            let field = support::varied_field(species, 8, 4);
            let plan = plan_race(params, &venue, species, &venue.class, &field).expect("plan");
            let inputs = RaceInputs {
                race_id: "1".into(),
                engine_version: "1.4.0".into(),
                species: species.into(),
                laps: plan.laps,
                entrants: field.clone(),
            };
            let mut with_incident = 0;
            let mut incident_kinds: BTreeMap<&'static str, u32> = BTreeMap::new();
            let mut overtakes = 0usize;
            let mut tired = 0usize;
            let mut winner_stamina = 0.0;
            let mut spread = 0.0;
            let mut dnf = 0;
            let mut bytes = 0usize;
            let started = Instant::now();
            for seed in 0..races {
                let mut seed_bytes = [0u8; 32];
                seed_bytes[..4].copy_from_slice(&seed.to_le_bytes());
                let sealed = simulate(params, &venue, &inputs, &seed_bytes).expect("simulate");
                let script = &sealed.script;
                bytes += sealed.json.len();
                if !script.result.incidents.is_empty() {
                    with_incident += 1;
                }
                for incident in &script.result.incidents {
                    *incident_kinds.entry(incident.kind.key()).or_default() += 1;
                }
                for tick in &script.ticks {
                    overtakes += tick
                        .events
                        .iter()
                        .filter(|event| event.kind == EventKind::Overtake)
                        .count();
                    tired += tick
                        .entrants
                        .iter()
                        .filter(|entrant| entrant.state == race_engine_core::EntrantState::Tired)
                        .count();
                }
                let winner_id = &script.result.as_run[0];
                let last_tick = script.ticks.last().expect("ticks");
                let winner_state = last_tick
                    .entrants
                    .iter()
                    .find(|entrant| &entrant.id == winner_id)
                    .expect("winner");
                winner_stamina += winner_state.stamina_pct.0;
                let finishers: Vec<i64> = script
                    .result
                    .entrants
                    .iter()
                    .filter_map(|entrant| entrant.finish_time_ms)
                    .collect();
                if let (Some(first), Some(last)) = (finishers.iter().min(), finishers.iter().max())
                {
                    spread += (last - first) as f64 / 1000.0;
                }
                dnf += script
                    .result
                    .entrants
                    .iter()
                    .filter(|entrant| entrant.result_status != ResultStatus::Finished)
                    .count();
            }
            total_races += races;
            clean_races += races - with_incident;
            let elapsed = started.elapsed().as_secs_f64() * 1000.0 / f64::from(races);
            println!(
                "{:<18} {:<8} laps {:>2} clean {:.2} incidents {:?} overtakes/race {:.0} tired-ticks/race {:.0} winner-stamina {:.0} spread {:.1}s dnf {} json {:.0}KB {:.1}ms",
                venue.id,
                species,
                plan.laps,
                1.0 - f64::from(with_incident) / f64::from(races),
                incident_kinds,
                overtakes as f64 / f64::from(races),
                tired as f64 / f64::from(races),
                winner_stamina / f64::from(races),
                spread / f64::from(races),
                dnf,
                bytes as f64 / f64::from(races) / 1024.0,
                elapsed
            );
        }
    }
    println!(
        "overall clean share {:.3}",
        f64::from(clean_races) / f64::from(total_races)
    );
}

#[expect(
    clippy::print_stdout,
    reason = "calibration report is written to stdout"
)]
fn stat_effects(params: &LoadedParams, runs: u32) {
    println!("== single stat advantage: win share of e1 boosted (others typical, 8 runners)");
    for venue_id in [
        "v_meadow_dash",
        "v_hairpin_hollow",
        "v_mudflat_ring",
        "v_glacier_grand",
        "v_jungle_marathon",
    ] {
        let venue = support::venue(venue_id);
        for species in support::species_for(&venue) {
            let mut cells = Vec::new();
            for stat in ["velocity", "stamina", "acceleration", "consistency"] {
                let base = support::typical_stats(species);
                let mut field: Vec<EntrantInput> = (0..8u32)
                    .map(|index| EntrantInput {
                        entrant_id: format!("e{}", index + 1),
                        animal_id: format!("{index}"),
                        lane: index + 1,
                        temperament: Temperament::Steady,
                        stats: base,
                    })
                    .collect();
                let stats = &mut field[3].stats;
                match stat {
                    "velocity" => stats.velocity *= 1.05,
                    "stamina" => stats.stamina = (stats.stamina + 15.0).min(100.0),
                    "acceleration" => stats.acceleration *= 1.3,
                    _ => stats.consistency = (stats.consistency + 0.15).min(1.0),
                }
                let plan = plan_race(params, &venue, species, &venue.class, &field).expect("plan");
                let race =
                    PreparedRace::new(params, &venue, species, plan.laps, &field).expect("race");
                let mut rng = fast_rng([3; 32]);
                let mut wins = 0;
                for _ in 0..runs {
                    let outcome = simulate_from(&race, None, &mut rng).expect("outcome");
                    if outcome.official[0] == 3 {
                        wins += 1;
                    }
                }
                cells.push(format!(
                    "{} {:.2}",
                    &stat[..4],
                    f64::from(wins) / f64::from(runs)
                ));
            }
            println!("{:<18} {:<8} {}", venue_id, species, cells.join(" "));
        }
    }
}

#[expect(
    clippy::print_stdout,
    reason = "calibration report is written to stdout"
)]
fn timing(params: &LoadedParams) {
    let venue = support::venue("v_jungle_marathon");
    let field = support::varied_field("GIRAFFE", 10, 7);
    let plan = plan_race(params, &venue, "GIRAFFE", "ENDURANCE", &field).expect("plan");
    let race = PreparedRace::new(params, &venue, "GIRAFFE", plan.laps, &field).expect("race");
    for (runs, threads) in [(2000u32, 1usize), (2000, 4), (5000, 4)] {
        let started = Instant::now();
        let table = estimate_probabilities(&race, None, runs, threads, [5; 32]).expect("estimate");
        println!(
            "MC endurance 10 runners laps {} runs {} threads {}: {:.0} ms (mean finish tick {:.0})",
            plan.laps,
            runs,
            threads,
            started.elapsed().as_secs_f64() * 1000.0,
            table.mean_finish_tick
        );
    }
}

fn main() {
    let params = support::params();
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map_or("all", String::as_str);
    let runs: u32 = args
        .get(2)
        .and_then(|value| value.parse().ok())
        .unwrap_or(400);
    if mode == "all" || mode == "plan" {
        plan_report(&params);
    }
    if mode == "all" || mode == "field" {
        field_report(&params, runs);
    }
    if mode == "all" || mode == "temperament" {
        temperament_report(&params, runs);
    }
    if mode == "all" || mode == "stats" {
        stat_effects(&params, runs);
    }
    if mode == "all" || mode == "incidents" {
        incident_report(&params, runs.min(200));
    }
    if mode == "all" || mode == "timing" {
        timing(&params);
    }
}
