mod error;
mod inputs;
mod outcome;
mod params;
mod plan;
mod rng;
mod script;
mod sim;
mod simulate;
mod venue;
mod verify;

pub use error::EngineError;
pub use inputs::{EntrantInput, RaceInputs, Stats, Temperament, entrant_number, sorted_entrants};
pub use outcome::{
    Outcome, ProbabilityCounter, ProbabilityTable, RevealedEntrant, RevealedState, check_revealed,
    estimate_probabilities, simulate_from,
};
pub use params::{EngineParams, LoadedParams, canonical_json, core_version};
pub use plan::{LapEstimate, Plan, dry_run_durations, median, plan_race};
pub use rng::fast_rng;
pub use script::{
    EntrantState, EventKind, Incident, IncidentKind, LapLeader, Num, RaceScript, ResultEntrant, ResultStatus,
    ScriptEntrant, ScriptResult, ScriptStats, ScriptTick, ScriptTrack, SealedScript, TickEntrant, TickEvent,
    round2, sha256_hex,
};
pub use sim::PreparedRace;
pub use simulate::simulate;
pub use venue::{SegmentSpec, Venue, parse_venues};
pub use verify::{Verification, inputs_from_script, parse_seed, verify, verify_script_bytes};

pub const ENGINE_VERSION: &str = "1.0.0";

pub const DEFAULT_PARAMS_JSON: &str = include_str!("../../../../shared/engine-params.json");

pub fn default_params() -> Result<LoadedParams, EngineError> {
    LoadedParams::from_json_str(DEFAULT_PARAMS_JSON)
}
