use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use race_engine_core::{EntrantInput, EntrantState, PreparedRace, RevealedEntrant, RevealedState};

use crate::pricing::MarketKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarketStatus {
    Open,
    Suspended,
}

#[derive(Debug, Clone)]
pub struct Market {
    pub market_id: i64,
    pub race_id: i64,
    pub kind: MarketKind,
    pub status: MarketStatus,
    pub selections: Vec<(i64, String)>,
    pub price_version: u32,
}

#[derive(Debug, Clone)]
pub struct RaceInfo {
    pub species: String,
    pub venue_id: String,
    pub venue_version: u32,
    pub laps: u32,
    pub engine_version: String,
    pub entrants: Vec<EntrantInput>,
}

#[derive(Debug, Clone, Default)]
pub struct LiveState {
    pub tick: Option<u32>,
    pub entrants: Vec<RevealedEntrant>,
    pub lap_leaders: Vec<(u32, String)>,
    pub false_starters: BTreeSet<String>,
}

impl LiveState {
    pub fn revealed(&self) -> Option<RevealedState> {
        let tick = self.tick?;
        Some(RevealedState {
            tick,
            entrants: self
                .entrants
                .iter()
                .map(|entrant| RevealedEntrant { false_start: self.false_starters.contains(&entrant.id), ..entrant.clone() })
                .collect(),
            lap_leaders: self.lap_leaders.clone(),
        })
    }

    pub fn record_lap(&mut self, lap: u32, leader: &str) {
        if lap > 0 && !leader.is_empty() && !self.lap_leaders.iter().any(|(known, _)| *known == lap) {
            self.lap_leaders.push((lap, leader.to_string()));
        }
    }

    pub fn finished(&self) -> bool {
        !self.entrants.is_empty()
            && self.entrants.iter().all(|entrant| matches!(entrant.state, EntrantState::Finished | EntrantState::Dnf))
    }
}

#[derive(Default)]
pub struct RaceEntry {
    pub info: Option<RaceInfo>,
    pub prepared: Option<Arc<PreparedRace>>,
    pub live: LiveState,
    pub pricing: bool,
    pub pending: bool,
    pub priced: u64,
}

#[derive(Default)]
pub struct Registry {
    pub races: HashMap<i64, RaceEntry>,
    pub markets: HashMap<i64, Market>,
}

impl Registry {
    pub fn drop_race(&mut self, race_id: i64) {
        self.races.remove(&race_id);
        self.markets.retain(|_, market| market.race_id != race_id);
    }

    pub fn priceable_markets(&self, race_id: i64) -> Vec<Market> {
        let mut markets: Vec<Market> = self
            .markets
            .values()
            .filter(|market| market.race_id == race_id && market.kind != MarketKind::Tricast)
            .cloned()
            .collect();
        markets.sort_by_key(|market| market.market_id);
        markets
    }
}
