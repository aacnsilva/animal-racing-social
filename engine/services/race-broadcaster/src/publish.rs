use ars_proto::{EntrantResult, Incident, LapLeader, RaceFinished, RaceTick, TickEntrant, TickEvent};
use race_engine_core::{RaceScript, ScriptTick};

pub fn entrant_number(id: &str) -> i32 {
    ars_infra::ids::entrant_db_id(id).unwrap_or(0)
}

pub fn tick_message(race_id: i64, tick: &ScriptTick) -> RaceTick {
    RaceTick {
        race_id,
        tick: tick.tick,
        lap: tick.lap,
        entrants: tick
            .entrants
            .iter()
            .map(|entrant| TickEntrant {
                id: entrant.id.clone(),
                dist: entrant.dist.0,
                lane: entrant.lane.0,
                speed: entrant.speed.0,
                stamina_pct: entrant.stamina_pct.0,
                state: entrant.state.key().to_string(),
                pos: entrant.pos,
            })
            .collect(),
        events: tick
            .events
            .iter()
            .map(|event| TickEvent {
                r#type: event.kind.key().to_string(),
                id: event.id.clone(),
                a: event.a.clone(),
                b: event.b.clone(),
                lap: event.lap,
                pos: event.pos,
            })
            .collect(),
    }
}

pub fn standings(tick: &ScriptTick) -> Vec<String> {
    let mut entrants: Vec<_> = tick.entrants.iter().collect();
    entrants.sort_by_key(|entrant| entrant.pos);
    entrants.into_iter().map(|entrant| entrant.id.clone()).collect()
}

pub fn finished_message(race_id: i64, script: &RaceScript, seed_hex: &str, finished_at: &str) -> RaceFinished {
    let result = &script.result;
    RaceFinished {
        race_id,
        finish_tick: result.finish_tick,
        order: result.order.clone(),
        as_run: result.as_run.clone(),
        incidents: result
            .incidents
            .iter()
            .map(|incident| Incident {
                seq: incident.seq,
                tick: incident.tick,
                r#type: incident.kind.key().to_string(),
                entrant_id: incident.entrant_id.clone(),
                data_json: incident.data.to_string(),
            })
            .collect(),
        seed: seed_hex.to_string(),
        results: result
            .entrants
            .iter()
            .map(|entrant| EntrantResult {
                entrant_id: entrant.id.clone(),
                official_position: entrant.official_position,
                as_run_position: entrant.as_run_position,
                result_status: entrant.result_status.key().to_string(),
                finish_time_ms: entrant.finish_time_ms,
                distance_covered: entrant.distance_covered.0,
                laps_led: entrant.laps_led.clone(),
            })
            .collect(),
        lap_leaders: result
            .lap_leaders
            .iter()
            .map(|leader| LapLeader { lap: leader.lap, entrant_id: leader.entrant_id.clone(), tick: leader.tick })
            .collect(),
        finished_at: finished_at.to_string(),
    }
}

pub fn state_json(race_id: i64, status: &str, tick: &ScriptTick, tick_ms: u32, start_at: &str) -> String {
    serde_json::json!({
        "raceId": race_id.to_string(),
        "status": status,
        "tick": tick.tick,
        "lap": tick.lap,
        "tickMs": tick_ms,
        "startAt": start_at,
        "entrants": tick.entrants,
        "events": tick.events,
        "updatedAt": ars_infra::time::now_rfc3339(),
    })
    .to_string()
}
