use race_engine_core::{LoadedParams, RaceScript, Verification, default_params, parse_venues, verify_script_bytes};

fn option(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|arg| arg == name).and_then(|index| args.get(index + 1).cloned())
}

fn load(args: &[String]) -> Result<Verification, String> {
    let script_path = option(args, "--script").ok_or("missing --script <file>")?;
    let venue_path = option(args, "--venue").ok_or("missing --venue <venues.json>")?;
    let mut script_bytes = std::fs::read(&script_path).map_err(|err| format!("read {script_path}: {err}"))?;
    if script_bytes.starts_with(&[0x28, 0xb5, 0x2f, 0xfd]) {
        script_bytes = ars_infra::sealing::decompress(&script_bytes)?;
    }
    let script = RaceScript::from_json_bytes(&script_bytes).map_err(|err| err.to_string())?;
    let venues_text = std::fs::read_to_string(&venue_path).map_err(|err| format!("read {venue_path}: {err}"))?;
    let venues = parse_venues(&venues_text).map_err(|err| err.to_string())?;
    let venue = venues
        .into_iter()
        .find(|venue| venue.id == script.track.venue_id && venue.version == script.track.venue_version)
        .ok_or(format!("venue {}@{} not found in {venue_path}", script.track.venue_id, script.track.venue_version))?;
    let params = match option(args, "--params") {
        Some(path) => {
            let text = std::fs::read_to_string(&path).map_err(|err| format!("read {path}: {err}"))?;
            LoadedParams::from_json_str(&text).map_err(|err| err.to_string())?
        }
        None => default_params().map_err(|err| err.to_string())?,
    };
    Ok(verify_script_bytes(&params, &venue, &script_bytes))
}

pub fn verify(args: &[String]) -> i32 {
    match load(args) {
        Ok(Verification::Ok { script_hash }) => {
            println!("OK scriptHash={script_hash}");
            0
        }
        Ok(Verification::Mismatch { reason }) => {
            println!("MISMATCH {reason}");
            1
        }
        Err(err) => {
            eprintln!("error: {err}");
            2
        }
    }
}
