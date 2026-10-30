use crate::error::EngineError;
use crate::inputs::RaceInputs;
use crate::params::LoadedParams;
use crate::rng::SeededStreams;
use crate::script::{
    LapLeader, Num, RaceScript, ResultEntrant, ResultStatus, ScriptEntrant, ScriptResult, ScriptStats, ScriptTick,
    ScriptTrack, SealedScript, TickEntrant, TickEvent, EventKind, round2, sha256_hex,
};
use crate::sim::{Phase, PreparedRace, Sim};
use crate::venue::Venue;

pub fn simulate(
    params: &LoadedParams,
    venue: &Venue,
    inputs: &RaceInputs,
    seed: &[u8; 32],
) -> Result<SealedScript, EngineError> {
    let race = PreparedRace::new(params, venue, &inputs.species, inputs.laps, &inputs.entrants)?;
    let script = run_recorded(params, &race, inputs, seed);
    let json = script.to_json_bytes();
    let script_hash = sha256_hex(&json);
    let seed_hash = sha256_hex(seed);
    Ok(SealedScript { script, json, script_hash, seed_hash })
}

fn run_recorded(params: &LoadedParams, race: &PreparedRace, inputs: &RaceInputs, seed: &[u8; 32]) -> RaceScript {
    let mut streams = SeededStreams::new(seed, race.entrants.len());
    let mut sim = Sim::new(race, true);
    sim.start(&mut streams);
    let mut ticks = Vec::with_capacity(1200);
    let mut previous_positions = sim.positions();
    let start_events = std::mem::take(&mut sim.events);
    ticks.push(tick_record(&sim, &previous_positions, start_events));
    let count = race.entrants.len();
    while !sim.is_done() {
        let racing_before: Vec<bool> = sim.runners.iter().map(|runner| runner.phase == Phase::Running).collect();
        sim.step(&mut streams);
        let positions = sim.positions();
        let mut overtakes: Vec<(u32, u32, TickEvent)> = Vec::new();
        for a in 0..count {
            if !racing_before[a] || !matches!(sim.runners[a].phase, Phase::Running | Phase::Finished) {
                continue;
            }
            for b in 0..count {
                if a == b || !racing_before[b] || !matches!(sim.runners[b].phase, Phase::Running | Phase::Finished) {
                    continue;
                }
                if previous_positions[a] > previous_positions[b] && positions[a] < positions[b] {
                    overtakes.push((
                        positions[a],
                        positions[b],
                        TickEvent::pair(EventKind::Overtake, &race.entrants[a].id, &race.entrants[b].id),
                    ));
                }
            }
        }
        overtakes.sort_by_key(|entry| (entry.0, entry.1));
        let mut events = std::mem::take(&mut sim.events);
        events.extend(overtakes.into_iter().map(|entry| entry.2));
        ticks.push(tick_record(&sim, &positions, events));
        previous_positions = positions;
    }
    sim.finalize(&mut streams);
    let result = build_result(&sim);
    let track = &race.track;
    RaceScript {
        race_id: inputs.race_id.clone(),
        engine_version: inputs.engine_version.clone(),
        params_hash: params.hash.clone(),
        seed: hex::encode(seed),
        tick_ms: race.tick_ms,
        species: race.species.clone(),
        track: ScriptTrack {
            venue_id: race.venue.id.clone(),
            venue_version: race.venue.version,
            surface: race.venue.surface.clone(),
            lap_length: Num(race.venue.lap_length),
            laps: track.laps,
            length: Num::rounded(track.length),
            lanes: race.venue.lanes,
        },
        entrants: race
            .entrants
            .iter()
            .map(|entrant| ScriptEntrant {
                id: entrant.id.clone(),
                animal_id: entrant.animal_id.clone(),
                lane: entrant.lane,
                temperament: entrant.temperament,
                stats: ScriptStats {
                    velocity: Num(entrant.stats.velocity),
                    stamina: Num(entrant.stats.stamina),
                    acceleration: Num(entrant.stats.acceleration),
                    consistency: Num(entrant.stats.consistency),
                },
            })
            .collect(),
        ticks,
        result,
    }
}

fn tick_record(sim: &Sim<'_>, positions: &[u32], events: Vec<TickEvent>) -> ScriptTick {
    let entrants = sim
        .runners
        .iter()
        .enumerate()
        .map(|(index, runner)| TickEntrant {
            id: sim.race.entrants[index].id.clone(),
            dist: Num::rounded(runner.dist),
            lane: Num::rounded(runner.lane),
            speed: Num::rounded(runner.speed),
            stamina_pct: Num::rounded(runner.stamina),
            state: sim.display_state(index),
            pos: positions[index],
        })
        .collect();
    ScriptTick { tick: sim.tick, lap: sim.leader_lap(), entrants, events }
}

fn build_result(sim: &Sim<'_>) -> ScriptResult {
    let race = sim.race;
    let official = sim.official_order();
    let as_run = sim.as_run_order();
    let mut as_run_position = vec![0u32; race.entrants.len()];
    for (rank, index) in as_run.iter().enumerate() {
        as_run_position[*index] = rank as u32 + 1;
    }
    let mut laps_led: Vec<Vec<u32>> = vec![Vec::new(); race.entrants.len()];
    let mut lap_leaders = Vec::new();
    for (lap_index, leader) in sim.lap_leaders.iter().enumerate() {
        if let Some((index, tick)) = leader {
            laps_led[*index].push(lap_index as u32 + 1);
            lap_leaders.push(LapLeader {
                lap: lap_index as u32 + 1,
                entrant_id: race.entrants[*index].id.clone(),
                tick: *tick,
            });
        }
    }
    let entrants = official
        .iter()
        .enumerate()
        .map(|(rank, index)| {
            let runner = &sim.runners[*index];
            let (status, finish_time_ms, distance) = match runner.phase {
                Phase::Finished => (
                    if runner.disqualified { ResultStatus::Disqualified } else { ResultStatus::Finished },
                    Some(libm::round(runner.finish_time * race.tick_ms as f64) as i64),
                    race.track.length,
                ),
                Phase::NonRunner => (ResultStatus::NonRunner, None, 0.0),
                Phase::PulledUp | Phase::Running => (ResultStatus::Dnf, None, runner.dist),
            };
            ResultEntrant {
                id: race.entrants[*index].id.clone(),
                official_position: rank as u32 + 1,
                as_run_position: as_run_position[*index],
                result_status: status,
                finish_time_ms,
                distance_covered: Num(round2(distance)),
                laps_led: laps_led[*index].clone(),
            }
        })
        .collect();
    ScriptResult {
        finish_tick: sim.tick,
        order: official.iter().map(|index| race.entrants[*index].id.clone()).collect(),
        as_run: as_run.iter().map(|index| race.entrants[*index].id.clone()).collect(),
        entrants,
        lap_leaders,
        incidents: sim.incidents.clone(),
    }
}
