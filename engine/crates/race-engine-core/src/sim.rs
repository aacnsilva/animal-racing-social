use crate::error::EngineError;
use crate::inputs::{EntrantInput, Stats, Temperament, sorted_entrants, validate_entrants};
use crate::params::{IncidentParams, LoadedParams, NoiseParams, PhysicsParams, StaminaParams, TemperamentParams};
use crate::rng::Streams;
use crate::script::{EntrantState, EventKind, Incident, IncidentKind, TickEvent, round2};
use crate::venue::{Track, Venue};

#[derive(Debug, Clone)]
pub(crate) struct PreparedEntrant {
    pub id: String,
    pub animal_id: String,
    pub lane: u32,
    pub temperament: Temperament,
    pub stats: Stats,
    pub v_top: f64,
    pub inverse_reference_speed: f64,
    pub accel_step: f64,
    pub brake_step: f64,
    pub drain_per_meter: f64,
    pub plan_coefficient: f64,
    pub stumble_per_meter: f64,
    pub form_sd: f64,
    pub pace_sd: f64,
    pub pace_innovation_sd: f64,
    pub tactics: TemperamentParams,
}

#[derive(Debug, Clone)]
pub struct PreparedRace {
    pub(crate) track: Track,
    pub(crate) entrants: Vec<PreparedEntrant>,
    pub(crate) venue: Venue,
    pub(crate) species: String,
    pub(crate) tick_ms: u32,
    pub(crate) dt: f64,
    pub(crate) physics: PhysicsParams,
    pub(crate) noise: NoiseParams,
    pub(crate) stamina: StaminaParams,
    pub(crate) incidents: IncidentParams,
    pub(crate) max_ticks: u32,
}

impl PreparedRace {
    pub fn new(
        params: &LoadedParams,
        venue: &Venue,
        species: &str,
        laps: u32,
        entrants: &[EntrantInput],
    ) -> Result<PreparedRace, EngineError> {
        let engine = &params.params;
        if laps == 0 || laps > 100 {
            return Err(EngineError::InvalidInputs(format!("laps {laps} out of range")));
        }
        let species_params = engine
            .species
            .get(species)
            .ok_or_else(|| EngineError::InvalidInputs(format!("unknown species {species}")))?;
        validate_entrants(entrants, venue)?;
        let track = Track::build(venue, laps, species_params, engine)?;
        let dt = engine.tick_ms as f64 / 1000.0;
        let stamina = engine.stamina;
        let effective_length = libm::pow(stamina.reference_length, 1.0 - stamina.length_exponent)
            * libm::pow(track.length, stamina.length_exponent);
        let base_drain = 100.0 * stamina.drain_budget / effective_length;
        let surface_ratio = track.surface_affinity / stamina.effort_reference;
        let surface_cost = surface_ratio * surface_ratio * surface_ratio;
        let noise = engine.noise;
        let incidents = engine.incidents;
        let correlation = noise.pace_correlation;
        let mut prepared = Vec::with_capacity(entrants.len());
        for entrant in sorted_entrants(entrants) {
            let stats = entrant.stats;
            let tactics = *engine
                .temperaments
                .get(entrant.temperament.key())
                .ok_or_else(|| EngineError::InvalidParams(format!("no temperament {}", entrant.temperament.key())))?;
            let reference = species_params.reference_velocity;
            let v_top = reference * libm::pow(stats.velocity / reference, engine.physics.velocity_elasticity);
            let capacity = stamina.capacity_base + stamina.capacity_per_point * stats.stamina;
            let drain_per_meter = base_drain / capacity;
            let inconsistency = 1.0 - stats.consistency;
            let pace_sd = noise.pace_sd_base + noise.pace_sd_per_inconsistency * inconsistency;
            prepared.push(PreparedEntrant {
                id: entrant.entrant_id.clone(),
                animal_id: entrant.animal_id.clone(),
                lane: entrant.lane,
                temperament: entrant.temperament,
                stats,
                v_top,
                inverse_reference_speed: 1.0 / (v_top * stamina.effort_reference),
                accel_step: stats.acceleration * dt,
                brake_step: stats.acceleration * engine.physics.braking_factor * dt,
                drain_per_meter,
                plan_coefficient: drain_per_meter * track.average_drain_factor * surface_cost,
                stumble_per_meter: incidents.stumble_per_km / 1000.0 * (inconsistency / 0.25),
                form_sd: noise.form_sd_base + noise.form_sd_per_inconsistency * inconsistency,
                pace_sd,
                pace_innovation_sd: pace_sd * libm::sqrt((1.0 - correlation * correlation).max(0.0)),
                tactics,
            });
        }
        Ok(PreparedRace {
            track,
            entrants: prepared,
            venue: venue.clone(),
            species: species.to_string(),
            tick_ms: engine.tick_ms,
            dt,
            physics: engine.physics,
            noise,
            stamina,
            incidents,
            max_ticks: engine.max_ticks,
        })
    }

    pub fn entrant_count(&self) -> usize {
        self.entrants.len()
    }

    pub fn laps(&self) -> u32 {
        self.track.laps
    }

    pub fn length(&self) -> f64 {
        self.track.length
    }

    pub fn lap_length(&self) -> f64 {
        self.track.lap_length
    }

    pub fn tick_ms(&self) -> u32 {
        self.tick_ms
    }

    pub fn entrant_ids(&self) -> Vec<String> {
        self.entrants.iter().map(|entrant| entrant.id.clone()).collect()
    }

    pub fn entrant_index(&self, id: &str) -> Option<usize> {
        self.entrants.iter().position(|entrant| entrant.id == id)
    }

    pub fn venue(&self) -> &Venue {
        &self.venue
    }

    pub fn species(&self) -> &str {
        &self.species
    }

    pub fn false_start_delay_ticks(&self) -> u32 {
        self.incidents.false_start_delay_ticks
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Phase {
    Running,
    Finished,
    PulledUp,
    NonRunner,
}

#[derive(Debug, Clone)]
pub(crate) struct Runner {
    pub dist: f64,
    pub speed: f64,
    pub lane: f64,
    pub lane_target: f64,
    pub stamina: f64,
    pub phase: Phase,
    pub wait_ticks: u32,
    pub stumble_ticks: u32,
    pub kicking: bool,
    pub cruise_effort: f64,
    pub kick_effort: f64,
    pub inverse_reference_speed: f64,
    pub pacing_error: f64,
    pub form: f64,
    pub pace: f64,
    pub kick_distance: f64,
    pub pull_up_at: f64,
    pub finish_time: f64,
    pub finish_rank: u32,
    pub disqualified: bool,
    pub pacing_scale: f64,
    pub stumble_budget: f64,
    pub segment_lap: u32,
    pub segment_index: usize,
    pub segment_end: f64,
    pub laps_done: u32,
}

pub(crate) struct Sim<'a> {
    pub race: &'a PreparedRace,
    pub runners: Vec<Runner>,
    pub tick: u32,
    pub finished: u32,
    pub lap_leaders: Vec<Option<(usize, u32)>>,
    pub record: bool,
    pub events: Vec<TickEvent>,
    pub incidents: Vec<Incident>,
    snapshot_dist: Vec<f64>,
    snapshot_lane: Vec<f64>,
    snapshot_speed: Vec<f64>,
    snapshot_active: Vec<bool>,
    ranks: Vec<u32>,
    order: Vec<usize>,
    order_position: Vec<usize>,
    lap_crossings: Vec<(u32, f64, usize)>,
    finish_crossings: Vec<(f64, usize)>,
}

impl<'a> Sim<'a> {
    pub fn new(race: &'a PreparedRace, record: bool) -> Sim<'a> {
        let count = race.entrants.len();
        let runners = race
            .entrants
            .iter()
            .map(|entrant| Runner {
                dist: 0.0,
                speed: 0.0,
                lane: entrant.lane as f64,
                lane_target: entrant.lane as f64,
                stamina: 100.0,
                phase: Phase::Running,
                wait_ticks: 0,
                stumble_ticks: 0,
                kicking: false,
                cruise_effort: race.physics.race_effort,
                kick_effort: race.physics.race_effort,
                inverse_reference_speed: entrant.inverse_reference_speed,
                pacing_error: 1.0,
                form: 1.0,
                pace: 0.0,
                kick_distance: 0.0,
                pull_up_at: f64::INFINITY,
                finish_time: f64::INFINITY,
                finish_rank: 0,
                disqualified: false,
                pacing_scale: -1.0,
                stumble_budget: f64::INFINITY,
                segment_lap: 0,
                segment_index: 0,
                segment_end: race.track.segment_end(0, 0),
                laps_done: 0,
            })
            .collect();
        Sim {
            race,
            runners,
            tick: 0,
            finished: 0,
            lap_leaders: vec![None; race.track.laps as usize],
            record,
            events: Vec::new(),
            incidents: Vec::new(),
            snapshot_dist: vec![0.0; count],
            snapshot_lane: vec![0.0; count],
            snapshot_speed: vec![0.0; count],
            snapshot_active: vec![false; count],
            ranks: vec![0; count],
            order: (0..count).collect(),
            order_position: (0..count).collect(),
            lap_crossings: Vec::with_capacity(count),
            finish_crossings: Vec::with_capacity(count),
        }
    }

    pub fn draw_hidden<S: Streams>(&mut self, index: usize, streams: &mut S) {
        let race = self.race;
        let entrant = &race.entrants[index];
        let stream = streams.entrant(index);
        let clamp = race.noise.form_clamp_sd;
        let form_z = stream.normal().clamp(-clamp, clamp);
        let pace_z = stream.normal().clamp(-clamp, clamp);
        let jitter = 1.0 + entrant.tactics.kick_jitter * (2.0 * stream.uniform() - 1.0);
        let pacing_z = stream.normal().clamp(-clamp, clamp);
        let runner = &mut self.runners[index];
        runner.pacing_error = (1.0 + pacing_z * race.noise.pacing_error_sd).max(0.5);
        runner.form = 1.0 + form_z * entrant.form_sd;
        runner.inverse_reference_speed = entrant.inverse_reference_speed / runner.form;
        runner.pace = pace_z * entrant.pace_sd;
        let base_kick = (entrant.tactics.kick_fraction * race.track.length).min(entrant.tactics.kick_max_distance);
        runner.kick_distance = base_kick * jitter;
        self.plan_efforts(index);
    }

    pub fn plan_efforts(&mut self, index: usize) {
        let race = self.race;
        let tactics = &race.entrants[index].tactics;
        let length = race.track.length;
        let runner = &mut self.runners[index];
        let kick = runner.kick_distance.min(length);
        let early = (tactics.early_until * length).min(length - kick).max(0.0);
        let cruise = race.physics.race_effort + tactics.effort_bias
            - (tactics.early_boost * early + tactics.kick_boost * kick) / length;
        runner.cruise_effort = cruise;
        runner.kick_effort = cruise + tactics.kick_boost;
    }

    fn draw_pull_up<S: Streams>(&mut self, index: usize, streams: &mut S) {
        let incidents = self.race.incidents;
        let stream = streams.incident();
        if stream.uniform() < incidents.pulled_up_per_entrant {
            let span = incidents.pulled_up_to_fraction - incidents.pulled_up_from_fraction;
            let fraction = incidents.pulled_up_from_fraction + span * stream.uniform();
            self.runners[index].pull_up_at = fraction * self.race.track.length;
        }
    }

    pub fn start<S: Streams>(&mut self, streams: &mut S) {
        let count = self.runners.len();
        for index in 0..count {
            self.draw_hidden(index, streams);
        }
        let incidents = self.race.incidents;
        for index in 0..count {
            if streams.incident().uniform() < incidents.refused_per_entrant {
                self.runners[index].phase = Phase::NonRunner;
                self.push_event(TickEvent::single(EventKind::RefusedToRun, &self.race.entrants[index].id));
                self.push_incident(IncidentKind::RefusedToRun, Some(index), serde_json::json!({}));
            }
        }
        if streams.incident().uniform() < incidents.false_start_per_race {
            let candidates: Vec<usize> = (0..count).filter(|index| self.runners[*index].phase == Phase::Running).collect();
            if !candidates.is_empty() {
                let pick = candidates[streams.incident().below(candidates.len() as u32) as usize];
                self.runners[pick].wait_ticks = incidents.false_start_delay_ticks;
                self.push_event(TickEvent::single(EventKind::FalseStart, &self.race.entrants[pick].id));
                let delay_ms = incidents.false_start_delay_ticks as u64 * self.race.tick_ms as u64;
                self.push_incident(IncidentKind::FalseStart, Some(pick), serde_json::json!({ "delayMs": delay_ms }));
            }
        }
        for index in 0..count {
            self.draw_pull_up(index, streams);
        }
        for index in 0..count {
            self.runners[index].stumble_budget = streams.incident().exponential();
        }
    }

    pub fn redraw_future_incidents<S: Streams>(&mut self, streams: &mut S) {
        for index in 0..self.runners.len() {
            if self.runners[index].phase != Phase::Running {
                continue;
            }
            self.runners[index].pull_up_at = f64::INFINITY;
            self.draw_pull_up(index, streams);
            if self.runners[index].pull_up_at < self.runners[index].dist {
                self.runners[index].pull_up_at = f64::INFINITY;
            }
            self.runners[index].stumble_budget = streams.incident().exponential();
        }
    }

    fn push_event(&mut self, event: TickEvent) {
        if self.record {
            self.events.push(event);
        }
    }

    fn push_incident(&mut self, kind: IncidentKind, index: Option<usize>, data: serde_json::Value) {
        if self.record {
            let seq = self.incidents.len() as u32 + 1;
            self.incidents.push(Incident {
                seq,
                tick: self.tick,
                kind,
                entrant_id: index.map(|value| self.race.entrants[value].id.clone()),
                data,
            });
        }
    }

    pub fn running_count(&self) -> usize {
        self.runners.iter().filter(|runner| runner.phase == Phase::Running).count()
    }

    pub fn is_done(&self) -> bool {
        self.running_count() == 0
    }

    pub fn sync_cursor(&mut self, index: usize) {
        let track = &self.race.track;
        let runner = &mut self.runners[index];
        let (lap, segment) = track.locate(runner.dist);
        runner.segment_lap = lap;
        runner.segment_index = segment;
        runner.segment_end = track.segment_end(lap, segment);
        runner.laps_done = (libm::floor(runner.dist / track.lap_length) as u32).min(track.laps);
    }

    fn sort_order(&mut self) {
        let count = self.order.len();
        for position in 1..count {
            let mut cursor = position;
            while cursor > 0 {
                let before = self.order[cursor - 1];
                let current = self.order[cursor];
                let before_dist = self.snapshot_dist[before];
                let current_dist = self.snapshot_dist[current];
                if current_dist > before_dist || (current_dist == before_dist && current < before) {
                    self.order.swap(cursor - 1, cursor);
                    cursor -= 1;
                } else {
                    break;
                }
            }
        }
        let mut ahead = 0;
        for position in 0..count {
            let index = self.order[position];
            self.order_position[index] = position;
            self.ranks[index] = ahead + 1;
            if matches!(self.runners[index].phase, Phase::Running | Phase::Finished) {
                ahead += 1;
            }
        }
    }

    pub fn step<S: Streams>(&mut self, streams: &mut S) {
        self.tick += 1;
        self.events.clear();
        let count = self.runners.len();
        for index in 0..count {
            let runner = &self.runners[index];
            self.snapshot_dist[index] = runner.dist;
            self.snapshot_lane[index] = runner.lane;
            self.snapshot_speed[index] = runner.speed;
            self.snapshot_active[index] = runner.phase == Phase::Running && runner.wait_ticks == 0;
        }
        self.sort_order();
        self.lap_crossings.clear();
        self.finish_crossings.clear();
        let pace_update = self.tick.is_multiple_of(self.race.noise.pace_update_ticks);
        let replan = self.tick.is_multiple_of(self.race.stamina.replan_ticks);
        for index in 0..count {
            match self.runners[index].phase {
                Phase::Finished | Phase::NonRunner => continue,
                Phase::PulledUp => {
                    self.coast_to_stop(index);
                    continue;
                }
                Phase::Running => {}
            }
            if self.runners[index].wait_ticks > 0 {
                self.runners[index].wait_ticks -= 1;
                continue;
            }
            self.advance_runner(index, pace_update, replan, streams);
        }
        self.resolve_laps(streams);
        self.resolve_finishes(streams);
        if self.tick >= self.race.max_ticks {
            for runner in &mut self.runners {
                if runner.phase == Phase::Running {
                    runner.phase = Phase::PulledUp;
                }
            }
        }
    }

    fn coast_to_stop(&mut self, index: usize) {
        let race = self.race;
        let entrant = &race.entrants[index];
        let runner = &mut self.runners[index];
        runner.speed = (runner.speed - entrant.brake_step).max(0.0);
        runner.dist = (runner.dist + runner.speed * race.dt).min(race.track.length - 0.5);
    }

    fn effort(&self, index: usize, remaining: f64, scale: f64) -> f64 {
        let race = self.race;
        let entrant = &race.entrants[index];
        let runner = &self.runners[index];
        let tactics = &entrant.tactics;
        if runner.kicking {
            return runner.kick_effort.max(race.physics.min_effort);
        }
        let progress = 1.0 - remaining / race.track.length;
        let mut desired = if progress < tactics.early_until {
            runner.cruise_effort + tactics.early_boost
        } else {
            runner.cruise_effort
        };
        let rank = self.ranks[index];
        if rank > tactics.preferred_max_position {
            desired += tactics.chase_bonus;
        } else if rank < tactics.preferred_min_position {
            desired -= tactics.ease_off;
        }
        if scale < 1.0 {
            desired *= 1.0 - tactics.discipline * (1.0 - scale);
        }
        desired.max(race.physics.min_effort)
    }

    pub fn lock_kick(&mut self, index: usize, remaining: f64) {
        let scale = self.sustainable_scale(index, remaining);
        let discipline = self.race.entrants[index].tactics.discipline;
        let runner = &mut self.runners[index];
        if scale < 1.0 {
            runner.kick_effort *= 1.0 - discipline * (1.0 - scale);
        }
    }

    fn sustainable_scale(&self, index: usize, remaining: f64) -> f64 {
        let race = self.race;
        let entrant = &race.entrants[index];
        let runner = &self.runners[index];
        let tactics = &entrant.tactics;
        let length = race.track.length;
        let kick = if runner.kicking { remaining } else { runner.kick_distance.min(remaining) };
        let rest = remaining - kick;
        let covered = length - remaining;
        let early_end = tactics.early_until * length;
        let early_left = if covered < early_end { (early_end - covered).min(rest) } else { 0.0 };
        let cruise_left = rest - early_left;
        let early_effort = runner.cruise_effort + tactics.early_boost;
        let cruise_effort = runner.cruise_effort;
        let kick_effort = runner.kick_effort;
        let demand = entrant.plan_coefficient
            * runner.pacing_error
            * (early_effort * early_effort * early_effort * early_left
                + cruise_effort * cruise_effort * cruise_effort * cruise_left
                + kick_effort * kick_effort * kick_effort * kick);
        if demand <= 0.0 {
            return f64::INFINITY;
        }
        let reserve = if runner.kicking { race.stamina.kick_reserve } else { race.stamina.pacing_reserve };
        let available = runner.stamina - reserve;
        if available <= 0.0 {
            return 0.0;
        }
        libm::cbrt(available / demand)
    }

    #[inline]
    fn lane_conflict(&self, other: usize, candidate: f64) -> bool {
        let clearance = self.race.physics.lane_clearance;
        (self.snapshot_lane[other] - candidate).abs() < clearance
            || (self.runners[other].lane_target - candidate).abs() < clearance
    }

    fn lane_free(&self, index: usize, candidate: f64, dist: f64) -> bool {
        let physics = &self.race.physics;
        let position = self.order_position[index];
        for cursor in (0..position).rev() {
            let other = self.order[cursor];
            if self.snapshot_dist[other] - dist >= physics.free_lane_ahead {
                break;
            }
            if self.snapshot_active[other] && self.lane_conflict(other, candidate) {
                return false;
            }
        }
        for cursor in position + 1..self.order.len() {
            let other = self.order[cursor];
            if self.snapshot_dist[other] - dist <= -physics.free_lane_behind {
                break;
            }
            if self.snapshot_active[other] && self.lane_conflict(other, candidate) {
                return false;
            }
        }
        true
    }

    fn traffic(&mut self, index: usize, target: f64) -> f64 {
        let physics = self.race.physics;
        let lanes = self.race.venue.lanes as f64;
        let dist = self.snapshot_dist[index];
        let lane_now = self.runners[index].lane;
        let mut blocker = None;
        let position = self.order_position[index];
        for cursor in (0..position).rev() {
            let other = self.order[cursor];
            let gap = self.snapshot_dist[other] - dist;
            if gap >= physics.blocking_gap {
                break;
            }
            if gap > 0.0
                && self.snapshot_active[other]
                && (self.snapshot_lane[other] - lane_now).abs() < physics.lane_clearance
            {
                blocker = Some(other);
                break;
            }
        }
        let settled = (self.runners[index].lane_target - lane_now).abs() < 1e-9;
        match blocker {
            Some(other) if target > self.snapshot_speed[other] => {
                if settled {
                    let current = self.runners[index].lane_target;
                    for candidate in [current - 1.0, current + 1.0] {
                        if candidate >= 1.0 && candidate <= lanes && self.lane_free(index, candidate, dist) {
                            self.runners[index].lane_target = candidate;
                            break;
                        }
                    }
                }
                target.min(self.snapshot_speed[other] + physics.overtake_margin)
            }
            _ => {
                if settled && self.runners[index].lane_target > 1.0 {
                    let candidate = self.runners[index].lane_target - 1.0;
                    if self.lane_free(index, candidate, dist) {
                        self.runners[index].lane_target = candidate;
                    }
                }
                target
            }
        }
    }

    fn advance_runner<S: Streams>(&mut self, index: usize, pace_update: bool, replan: bool, streams: &mut S) {
        let race = self.race;
        let entrant = &race.entrants[index];
        let track = &race.track;
        let physics = &race.physics;
        let stamina_params = &race.stamina;
        let incidents = &race.incidents;
        if self.runners[index].dist >= self.runners[index].pull_up_at {
            self.runners[index].phase = Phase::PulledUp;
            let dist = round2(self.runners[index].dist);
            self.push_event(TickEvent::single(EventKind::PulledUp, &entrant.id));
            self.push_incident(IncidentKind::PulledUp, Some(index), serde_json::json!({ "dist": dist }));
            self.coast_to_stop(index);
            return;
        }
        if pace_update {
            let shock = streams.entrant(index).normal();
            let runner = &mut self.runners[index];
            runner.pace = race.noise.pace_correlation * runner.pace + entrant.pace_innovation_sd * shock;
        }
        let dist = self.runners[index].dist;
        let speed = self.runners[index].speed;
        let remaining = track.length - dist;
        if !self.runners[index].kicking && remaining <= self.runners[index].kick_distance {
            self.runners[index].kicking = true;
            self.lock_kick(index, remaining);
            self.push_event(TickEvent::single(EventKind::Sprint, &entrant.id));
        }
        if !self.runners[index].kicking && (replan || self.runners[index].pacing_scale < 0.0) {
            self.runners[index].pacing_scale = self.sustainable_scale(index, remaining);
        }
        let runner = &self.runners[index];
        let segment = track.segments[runner.segment_index];
        let ahead = track.segment_ahead(runner.segment_lap, runner.segment_index, runner.segment_end, dist + speed * physics.curve_look_ahead_sec);
        let effort = self.effort(index, remaining, runner.pacing_scale);
        let mut target = entrant.v_top * runner.form * (1.0 + runner.pace) * segment.speed_factor * effort;
        target = target.min(segment.speed_cap).min(ahead.speed_cap);
        if runner.stamina <= 0.0 {
            target *= stamina_params.exhausted_factor;
        } else if runner.stamina < stamina_params.tired_threshold {
            target *= stamina_params.tired_factor;
        }
        if runner.stumble_ticks > 0 {
            target *= incidents.stumble_target_factor;
        }
        let target = self.traffic(index, target);
        let delta = (target - speed).clamp(-entrant.brake_step, entrant.accel_step);
        let new_speed = (speed + delta).max(0.0);
        let runner = &mut self.runners[index];
        let lane_step = physics.lane_change_per_tick;
        runner.lane += (runner.lane_target - runner.lane).clamp(-lane_step, lane_step);
        let lane_factor = if segment.radius > 0.0 {
            segment.radius / (segment.radius + (runner.lane - 1.0) * physics.lane_width)
        } else {
            1.0
        };
        let advance = new_speed * race.dt * lane_factor;
        let relative = new_speed * runner.inverse_reference_speed;
        let cost = relative * relative * relative;
        runner.stamina = (runner.stamina - entrant.drain_per_meter * cost * segment.drain_factor * advance).max(0.0);
        runner.speed = new_speed;
        if runner.stumble_ticks > 0 {
            runner.stumble_ticks -= 1;
        } else {
            let tired = if runner.stamina < stamina_params.tired_threshold { incidents.stumble_tired_multiplier } else { 1.0 };
            runner.stumble_budget -= entrant.stumble_per_meter * segment.stumble_factor * advance * tired;
            if runner.stumble_budget <= 0.0 {
                let span = incidents.stumble_ticks_max - incidents.stumble_ticks_min + 1;
                let ticks = incidents.stumble_ticks_min + streams.incident().below(span);
                let budget = streams.incident().exponential();
                let runner = &mut self.runners[index];
                runner.stumble_budget = budget;
                runner.stumble_ticks = ticks;
                runner.speed *= incidents.stumble_speed_drop;
                self.push_event(TickEvent::single(EventKind::Stumble, &entrant.id));
                self.push_incident(IncidentKind::Stumble, Some(index), serde_json::json!({ "ticks": ticks }));
            }
        }
        let new_dist = dist + advance;
        if advance > 0.0 {
            while self.runners[index].laps_done < track.laps {
                let lap_number = self.runners[index].laps_done + 1;
                let line = lap_number as f64 * track.lap_length;
                if line > new_dist {
                    break;
                }
                if self.lap_leaders[(lap_number - 1) as usize].is_none() {
                    let time = (self.tick - 1) as f64 + (line - dist) / advance;
                    self.lap_crossings.push((lap_number, time, index));
                }
                self.runners[index].laps_done = lap_number;
            }
        }
        let runner = &mut self.runners[index];
        if new_dist >= track.length && advance > 0.0 {
            let time = (self.tick - 1) as f64 + (track.length - dist) / advance;
            runner.dist = track.length;
            runner.phase = Phase::Finished;
            runner.finish_time = time;
            self.finish_crossings.push((time, index));
        } else {
            runner.dist = new_dist;
            track.advance_cursor(&mut runner.segment_lap, &mut runner.segment_index, &mut runner.segment_end, new_dist);
        }
    }

    fn resolve_laps<S: Streams>(&mut self, streams: &mut S) {
        if self.lap_crossings.is_empty() {
            return;
        }
        let mut crossings = std::mem::take(&mut self.lap_crossings);
        crossings.sort_by(|left, right| {
            left.0.cmp(&right.0).then(left.1.total_cmp(&right.1)).then(left.2.cmp(&right.2))
        });
        let mut start = 0;
        while start < crossings.len() {
            let lap = crossings[start].0;
            let mut end = start;
            while end < crossings.len() && crossings[end].0 == lap {
                end += 1;
            }
            let best_time = crossings[start].1;
            let tied: Vec<usize> = crossings[start..end]
                .iter()
                .filter(|crossing| crossing.1.to_bits() == best_time.to_bits())
                .map(|crossing| crossing.2)
                .collect();
            if self.lap_leaders[(lap - 1) as usize].is_none() {
                let winner = if tied.len() > 1 {
                    let pick = tied[streams.incident().below(tied.len() as u32) as usize];
                    for other in tied.iter().copied().filter(|other| *other != pick) {
                        let a = self.race.entrants[pick].id.clone();
                        let b = self.race.entrants[other].id.clone();
                        self.push_event(TickEvent::pair(EventKind::PhotoFinish, &a, &b));
                        self.push_incident(
                            IncidentKind::PhotoFinish,
                            Some(pick),
                            serde_json::json!({ "a": a, "b": b, "lap": lap }),
                        );
                    }
                    pick
                } else {
                    crossings[start].2
                };
                self.lap_leaders[(lap - 1) as usize] = Some((winner, self.tick));
                if self.record {
                    let mut event = TickEvent::single(EventKind::Lap, &self.race.entrants[winner].id);
                    event.lap = Some(lap);
                    self.events.push(event);
                }
            }
            start = end;
        }
        crossings.clear();
        self.lap_crossings = crossings;
    }

    fn resolve_finishes<S: Streams>(&mut self, streams: &mut S) {
        if self.finish_crossings.is_empty() {
            return;
        }
        let mut crossings = std::mem::take(&mut self.finish_crossings);
        crossings.sort_by(|left, right| left.0.total_cmp(&right.0).then(left.1.cmp(&right.1)));
        let mut start = 0;
        while start < crossings.len() {
            let mut end = start + 1;
            while end < crossings.len() && crossings[end].0.to_bits() == crossings[start].0.to_bits() {
                end += 1;
            }
            if end - start > 1 {
                let mut position = end - 1;
                while position > start {
                    let pick = start + streams.incident().below((position - start + 1) as u32) as usize;
                    crossings.swap(position, pick);
                    position -= 1;
                }
                for pair in start..end - 1 {
                    let a = self.race.entrants[crossings[pair].1].id.clone();
                    let b = self.race.entrants[crossings[pair + 1].1].id.clone();
                    let position = self.finished + (pair - start) as u32 + 1;
                    self.push_event(TickEvent::pair(EventKind::PhotoFinish, &a, &b));
                    self.push_incident(
                        IncidentKind::PhotoFinish,
                        Some(crossings[pair].1),
                        serde_json::json!({ "a": a, "b": b, "position": position }),
                    );
                }
            }
            for crossing in &crossings[start..end] {
                self.finished += 1;
                let rank = self.finished;
                self.runners[crossing.1].finish_rank = rank;
                if self.record {
                    let mut event = TickEvent::single(EventKind::Finish, &self.race.entrants[crossing.1].id);
                    event.pos = Some(rank);
                    self.events.push(event);
                }
            }
            start = end;
        }
        crossings.clear();
        self.finish_crossings = crossings;
    }

    pub fn finalize<S: Streams>(&mut self, streams: &mut S) {
        if self.finished == 0 {
            return;
        }
        if streams.incident().uniform() < self.race.incidents.disqualified_per_race {
            let pick_rank = streams.incident().below(self.finished) + 1;
            if let Some(index) = self.runners.iter().position(|runner| runner.finish_rank == pick_rank) {
                self.runners[index].disqualified = true;
                self.push_incident(
                    IncidentKind::Disqualified,
                    Some(index),
                    serde_json::json!({ "asRunPosition": pick_rank }),
                );
            }
        }
    }

    pub fn as_run_order(&self) -> Vec<usize> {
        let mut finishers: Vec<usize> =
            (0..self.runners.len()).filter(|index| self.runners[*index].phase == Phase::Finished).collect();
        finishers.sort_by_key(|index| self.runners[*index].finish_rank);
        let mut order = finishers;
        order.extend(self.retired_order());
        order
    }

    pub fn official_order(&self) -> Vec<usize> {
        let mut finishers: Vec<usize> =
            (0..self.runners.len()).filter(|index| self.runners[*index].phase == Phase::Finished).collect();
        finishers.sort_by_key(|index| (self.runners[*index].disqualified, self.runners[*index].finish_rank));
        let mut order = finishers;
        order.extend(self.retired_order());
        order
    }

    fn retired_order(&self) -> Vec<usize> {
        let mut pulled: Vec<usize> =
            (0..self.runners.len()).filter(|index| self.runners[*index].phase == Phase::PulledUp).collect();
        pulled.sort_by(|left, right| {
            self.runners[*right]
                .dist
                .total_cmp(&self.runners[*left].dist)
                .then(self.race.entrants[*left].lane.cmp(&self.race.entrants[*right].lane))
                .then(left.cmp(right))
        });
        let mut non_runners: Vec<usize> =
            (0..self.runners.len()).filter(|index| self.runners[*index].phase == Phase::NonRunner).collect();
        non_runners.sort_by(|left, right| {
            self.race.entrants[*left].lane.cmp(&self.race.entrants[*right].lane).then(left.cmp(right))
        });
        pulled.extend(non_runners);
        pulled
    }

    pub fn positions(&self) -> Vec<u32> {
        let count = self.runners.len();
        let mut order: Vec<usize> = (0..count).collect();
        let category = |phase: Phase| match phase {
            Phase::Finished => 0u8,
            Phase::Running => 1,
            Phase::PulledUp | Phase::NonRunner => 2,
        };
        order.sort_by(|left, right| {
            let a = &self.runners[*left];
            let b = &self.runners[*right];
            category(a.phase)
                .cmp(&category(b.phase))
                .then_with(|| match a.phase {
                    Phase::Finished => a.finish_rank.cmp(&b.finish_rank),
                    _ => b.dist.total_cmp(&a.dist),
                })
                .then(self.race.entrants[*left].lane.cmp(&self.race.entrants[*right].lane))
                .then(left.cmp(right))
        });
        let mut positions = vec![0u32; count];
        for (rank, index) in order.into_iter().enumerate() {
            positions[index] = rank as u32 + 1;
        }
        positions
    }

    pub fn display_state(&self, index: usize) -> EntrantState {
        let runner = &self.runners[index];
        match runner.phase {
            Phase::Finished => EntrantState::Finished,
            Phase::PulledUp | Phase::NonRunner => EntrantState::Dnf,
            Phase::Running => {
                if runner.stumble_ticks > 0 {
                    EntrantState::Stumbled
                } else if runner.stamina < self.race.stamina.tired_threshold {
                    EntrantState::Tired
                } else if runner.kicking {
                    EntrantState::Sprinting
                } else {
                    EntrantState::Running
                }
            }
        }
    }

    pub fn leader_lap(&self) -> u32 {
        let track = &self.race.track;
        let leader = self.runners.iter().map(|runner| runner.dist).fold(0.0, f64::max);
        let lap = libm::floor(leader / track.lap_length) as u32 + 1;
        lap.min(track.laps)
    }
}
