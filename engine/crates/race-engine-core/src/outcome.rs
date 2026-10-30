use rand_core::Rng;

use crate::error::EngineError;
use crate::rng::{SharedStream, Streams, fast_rng};
use crate::script::{EntrantState, EventKind, RaceScript};
use crate::sim::{Phase, PreparedRace, Sim};

#[derive(Debug, Clone, PartialEq)]
pub struct RevealedEntrant {
    pub id: String,
    pub dist: f64,
    pub lane: f64,
    pub speed: f64,
    pub stamina_pct: f64,
    pub state: EntrantState,
    pub pos: u32,
    pub false_start: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RevealedState {
    pub tick: u32,
    pub entrants: Vec<RevealedEntrant>,
    pub lap_leaders: Vec<(u32, String)>,
}

impl RevealedState {
    pub fn from_script(script: &RaceScript, tick: u32) -> Option<RevealedState> {
        let record = script.ticks.iter().find(|candidate| candidate.tick == tick)?;
        let mut false_starters = Vec::new();
        let mut lap_leaders = Vec::new();
        for earlier in script.ticks.iter().take_while(|candidate| candidate.tick <= tick) {
            for event in &earlier.events {
                match event.kind {
                    EventKind::FalseStart => false_starters.extend(event.id.clone()),
                    EventKind::Lap => {
                        if let (Some(lap), Some(id)) = (event.lap, event.id.clone()) {
                            lap_leaders.push((lap, id));
                        }
                    }
                    _ => {}
                }
            }
        }
        Some(RevealedState {
            tick,
            entrants: record
                .entrants
                .iter()
                .map(|entrant| RevealedEntrant {
                    id: entrant.id.clone(),
                    dist: entrant.dist.0,
                    lane: entrant.lane.0,
                    speed: entrant.speed.0,
                    stamina_pct: entrant.stamina_pct.0,
                    state: entrant.state,
                    pos: entrant.pos,
                    false_start: false_starters.contains(&entrant.id),
                })
                .collect(),
            lap_leaders,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Outcome {
    pub official: Vec<usize>,
    pub as_run: Vec<usize>,
    pub lap_leaders: Vec<Option<usize>>,
    pub finish_tick: u32,
}

pub fn check_revealed(race: &PreparedRace, revealed: &RevealedState) -> Result<Vec<usize>, EngineError> {
    if revealed.entrants.len() != race.entrants.len() {
        return Err(EngineError::InvalidInputs(format!(
            "revealed state has {} entrants, race has {}",
            revealed.entrants.len(),
            race.entrants.len()
        )));
    }
    let mut mapping = Vec::with_capacity(revealed.entrants.len());
    for entrant in &revealed.entrants {
        let index = race
            .entrant_index(&entrant.id)
            .ok_or_else(|| EngineError::InvalidInputs(format!("unknown entrant {}", entrant.id)))?;
        if mapping.contains(&index) {
            return Err(EngineError::InvalidInputs(format!("duplicate entrant {}", entrant.id)));
        }
        mapping.push(index);
    }
    for (lap, id) in &revealed.lap_leaders {
        if *lap == 0 || *lap > race.track.laps || race.entrant_index(id).is_none() {
            return Err(EngineError::InvalidInputs(format!("invalid lap leader {id} at lap {lap}")));
        }
    }
    Ok(mapping)
}

fn restore<S: Streams>(sim: &mut Sim<'_>, revealed: &RevealedState, mapping: &[usize], streams: &mut S) {
    let race = sim.race;
    let length = race.track.length;
    let lanes = race.venue.lanes as f64;
    sim.tick = revealed.tick;
    let mut finished: Vec<(u32, usize)> = Vec::new();
    let mut kick_lock: Vec<(usize, f64)> = Vec::new();
    for index in 0..race.entrants.len() {
        sim.draw_hidden(index, streams);
    }
    for (position, entrant) in revealed.entrants.iter().enumerate() {
        let index = mapping[position];
        let remaining = length - entrant.dist;
        let resample = streams.entrant(index).uniform();
        let stumble_extra = streams.entrant(index).below(3);
        let runner = &mut sim.runners[index];
        runner.dist = entrant.dist.clamp(0.0, length);
        runner.speed = entrant.speed.max(0.0);
        runner.lane = entrant.lane.clamp(1.0, lanes);
        runner.lane_target = libm::round(runner.lane);
        runner.stamina = entrant.stamina_pct.clamp(0.0, 100.0);
        match entrant.state {
            EntrantState::Finished => {
                runner.phase = Phase::Finished;
                runner.dist = length;
                finished.push((entrant.pos, index));
            }
            EntrantState::Dnf => {
                runner.phase = if entrant.dist < 0.01 { Phase::NonRunner } else { Phase::PulledUp };
            }
            EntrantState::Sprinting => kick_lock.push((index, remaining)),
            EntrantState::Stumbled => runner.stumble_ticks = 1 + stumble_extra,
            EntrantState::Running | EntrantState::Tired => {
                if runner.kick_distance >= remaining {
                    runner.kick_distance = remaining * resample;
                }
                runner.kicking = false;
            }
        }
        let delay = race.incidents.false_start_delay_ticks;
        if entrant.false_start && revealed.tick < delay && runner.phase == Phase::Running && entrant.dist < 0.01 {
            runner.wait_ticks = delay - revealed.tick;
        }
    }
    for index in 0..race.entrants.len() {
        sim.sync_cursor(index);
    }
    for (index, remaining) in kick_lock {
        sim.runners[index].kicking = true;
        sim.lock_kick(index, remaining);
    }
    finished.sort();
    sim.finished = finished.len() as u32;
    for (rank, (_, index)) in finished.iter().enumerate() {
        sim.runners[*index].finish_rank = rank as u32 + 1;
        sim.runners[*index].finish_time = rank as f64;
    }
    for (lap, id) in &revealed.lap_leaders {
        if let Some(index) = race.entrant_index(id) {
            sim.lap_leaders[(*lap - 1) as usize] = Some((index, revealed.tick));
        }
    }
    let leader_dist = sim.runners.iter().map(|runner| runner.dist).fold(0.0, f64::max);
    let completed = (libm::floor(leader_dist / race.track.lap_length) as u32).min(race.track.laps);
    if completed > 0 {
        let positions = sim.positions();
        if let Some(current_leader) = positions.iter().position(|position| *position == 1) {
            for lap in 1..=completed {
                if sim.lap_leaders[(lap - 1) as usize].is_none() {
                    sim.lap_leaders[(lap - 1) as usize] = Some((current_leader, revealed.tick));
                }
            }
        }
    }
    sim.redraw_future_incidents(streams);
}

pub fn simulate_from<R: Rng>(
    race: &PreparedRace,
    revealed: Option<&RevealedState>,
    rng: &mut R,
) -> Result<Outcome, EngineError> {
    let mapping = match revealed {
        Some(state) => Some(check_revealed(race, state)?),
        None => None,
    };
    Ok(run_outcome(race, revealed, mapping.as_deref(), rng))
}

fn run_outcome<R: Rng>(
    race: &PreparedRace,
    revealed: Option<&RevealedState>,
    mapping: Option<&[usize]>,
    rng: &mut R,
) -> Outcome {
    let mut streams = SharedStream::new(rng);
    let mut sim = Sim::new(race, false);
    match (revealed, mapping) {
        (Some(state), Some(map)) => restore(&mut sim, state, map, &mut streams),
        _ => sim.start(&mut streams),
    }
    while !sim.is_done() {
        sim.step(&mut streams);
    }
    sim.finalize(&mut streams);
    Outcome {
        official: sim.official_order(),
        as_run: sim.as_run_order(),
        lap_leaders: sim.lap_leaders.iter().map(|leader| leader.map(|(index, _)| index)).collect(),
        finish_tick: sim.tick,
    }
}

#[derive(Debug, Clone)]
pub struct ProbabilityCounter {
    entrants: usize,
    laps: usize,
    runs: u32,
    position_counts: Vec<u32>,
    lap_counts: Vec<u32>,
    finish_tick_sum: f64,
}

impl ProbabilityCounter {
    pub fn new(entrants: usize, laps: usize) -> ProbabilityCounter {
        ProbabilityCounter {
            entrants,
            laps,
            runs: 0,
            position_counts: vec![0; entrants * entrants],
            lap_counts: vec![0; laps * entrants],
            finish_tick_sum: 0.0,
        }
    }

    pub fn add(&mut self, outcome: &Outcome) {
        self.runs += 1;
        for (rank, index) in outcome.official.iter().enumerate() {
            self.position_counts[*index * self.entrants + rank] += 1;
        }
        for (lap, leader) in outcome.lap_leaders.iter().enumerate().take(self.laps) {
            if let Some(index) = leader {
                self.lap_counts[lap * self.entrants + *index] += 1;
            }
        }
        self.finish_tick_sum += outcome.finish_tick as f64;
    }

    pub fn merge(&mut self, other: &ProbabilityCounter) {
        self.runs += other.runs;
        for (mine, theirs) in self.position_counts.iter_mut().zip(&other.position_counts) {
            *mine += *theirs;
        }
        for (mine, theirs) in self.lap_counts.iter_mut().zip(&other.lap_counts) {
            *mine += *theirs;
        }
        self.finish_tick_sum += other.finish_tick_sum;
    }

    pub fn table(&self, entrant_ids: Vec<String>) -> ProbabilityTable {
        let runs = self.runs.max(1) as f64;
        let positions = (0..self.entrants)
            .map(|entrant| {
                (0..self.entrants)
                    .map(|rank| self.position_counts[entrant * self.entrants + rank] as f64 / runs)
                    .collect()
            })
            .collect();
        let lap_leaders = (0..self.laps)
            .map(|lap| {
                (0..self.entrants).map(|entrant| self.lap_counts[lap * self.entrants + entrant] as f64 / runs).collect()
            })
            .collect();
        ProbabilityTable {
            entrant_ids,
            runs: self.runs,
            positions,
            lap_leaders,
            mean_finish_tick: self.finish_tick_sum / runs,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProbabilityTable {
    pub entrant_ids: Vec<String>,
    pub runs: u32,
    pub positions: Vec<Vec<f64>>,
    pub lap_leaders: Vec<Vec<f64>>,
    pub mean_finish_tick: f64,
}

impl ProbabilityTable {
    pub fn index_of(&self, entrant_id: &str) -> Option<usize> {
        self.entrant_ids.iter().position(|id| id == entrant_id)
    }

    pub fn finish_position(&self, entrant: usize, position: u32) -> f64 {
        if position == 0 {
            return 0.0;
        }
        self.positions
            .get(entrant)
            .and_then(|row| row.get(position as usize - 1))
            .copied()
            .unwrap_or(0.0)
    }

    pub fn win(&self, entrant: usize) -> f64 {
        self.finish_position(entrant, 1)
    }

    pub fn top_n(&self, entrant: usize, n: u32) -> f64 {
        (1..=n).map(|position| self.finish_position(entrant, position)).sum()
    }

    pub fn leader_at_lap(&self, entrant: usize, lap: u32) -> f64 {
        if lap == 0 {
            return 0.0;
        }
        self.lap_leaders
            .get(lap as usize - 1)
            .and_then(|row| row.get(entrant))
            .copied()
            .unwrap_or(0.0)
    }
}

pub fn estimate_probabilities(
    race: &PreparedRace,
    revealed: Option<&RevealedState>,
    runs: u32,
    threads: usize,
    seed: [u8; 32],
) -> Result<ProbabilityTable, EngineError> {
    let mapping = match revealed {
        Some(state) => Some(check_revealed(race, state)?),
        None => None,
    };
    let threads = threads.max(1).min(runs.max(1) as usize);
    let entrants = race.entrants.len();
    let laps = race.track.laps as usize;
    let counters: Vec<ProbabilityCounter> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..threads)
            .map(|worker| {
                let share = runs / threads as u32 + u32::from((worker as u32) < runs % threads as u32);
                let mapping = mapping.as_deref();
                scope.spawn(move || {
                    let mut rng = fast_rng(seed);
                    rng.set_stream(worker as u64);
                    let mut counter = ProbabilityCounter::new(entrants, laps);
                    for _ in 0..share {
                        let outcome = run_outcome(race, revealed, mapping, &mut rng);
                        counter.add(&outcome);
                    }
                    counter
                })
            })
            .collect();
        handles.into_iter().map(|handle| handle.join().unwrap_or_else(|_| ProbabilityCounter::new(entrants, laps))).collect()
    });
    let mut total = ProbabilityCounter::new(entrants, laps);
    for counter in &counters {
        total.merge(counter);
    }
    Ok(total.table(race.entrant_ids()))
}
