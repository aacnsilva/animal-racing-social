use std::sync::Arc;
use std::time::Instant;

use ars_infra::convert::{WireEntrant, entrants_from_wire};
use ars_infra::http::{bad_request, classify, internal};
use axum::Json;
use axum::Router;
use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use race_engine_core::{PreparedRace, estimate_probabilities};
use serde::Deserialize;
use tracing::Instrument;
use tracing::field::Empty;

use crate::pricing::{MarketKind, floor_probability, price, round_probability};
use crate::state::Shared;

pub fn router(app: Shared) -> Router {
    Router::new().route("/healthz", get(healthz)).route("/internal/price", post(price_handler)).with_state(app)
}

async fn healthz(State(app): State<Shared>) -> Json<serde_json::Value> {
    let (races, markets) = app.registry.lock().map(|registry| (registry.races.len(), registry.markets.len())).unwrap_or((0, 0));
    Json(serde_json::json!({ "status": "ok", "races": races, "markets": markets }))
}

#[derive(Deserialize)]
struct MarketRequest {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    params: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PriceRequest {
    venue_id: String,
    venue_version: u32,
    species: String,
    laps: u32,
    engine_version: Option<String>,
    entrants: Vec<WireEntrant>,
    runs: Option<u32>,
    markets: Vec<MarketRequest>,
}

async fn price_handler(State(app): State<Shared>, body: Result<Json<PriceRequest>, axum::extract::rejection::JsonRejection>) -> Response {
    let Json(request) = match body {
        Ok(body) => body,
        Err(err) => return bad_request(err.body_text()),
    };
    let entrants = match entrants_from_wire(&request.entrants) {
        Ok(entrants) => entrants,
        Err(err) => return bad_request(err),
    };
    let mut kinds = Vec::with_capacity(request.markets.len());
    for market in &request.markets {
        match MarketKind::from_json(&market.kind, &market.params) {
            Ok(kind) => kinds.push(kind),
            Err(err) => return bad_request(err),
        }
    }
    let loaded = async {
        let conn = app.db.acquire().await?;
        let version = match &request.engine_version {
            Some(version) if !version.is_empty() => version.clone(),
            _ => app.catalog.active_engine_version(&conn).await?,
        };
        let venue = app.catalog.venue(&conn, &request.venue_id, request.venue_version).await?;
        let params = app.catalog.params(&conn, &version).await?;
        Ok::<_, String>((venue, params))
    }
    .await;
    let (venue, params) = match loaded {
        Ok(loaded) => loaded,
        Err(err) => return classify(err),
    };
    let race_class = venue.class.clone();
    let server = tracing::Span::current();
    server.record("ars.flow", "race-scheduling");
    server.record("race_class", race_class.as_str());
    let race = match PreparedRace::new(&params, &venue, &request.species, request.laps, &entrants) {
        Ok(race) => Arc::new(race),
        Err(err) => return bad_request(err.to_string()),
    };
    let runs = request.runs.unwrap_or(app.settings.runs_prerace).clamp(1, 100_000);
    let threads = app.settings.threads;
    let Ok(permit) = app.compute.acquire().await else { return internal("compute pool closed") };
    let span = tracing::info_span!(
        "odds.monte_carlo",
        "phase" = "pre",
        "runs" = i64::from(runs),
        "race_class" = race_class.as_str(),
        "otel.status_code" = Empty,
    );
    let started = Instant::now();
    let seed: [u8; 32] = ars_infra::ids::random_bytes();
    let computed = tokio::task::spawn_blocking(move || estimate_probabilities(&race, None, runs, threads, seed))
        .instrument(span.clone())
        .await;
    drop(permit);
    let elapsed = started.elapsed();
    let table = match computed {
        Ok(Ok(table)) => table,
        Ok(Err(err)) => {
            span.record("otel.status_code", "error");
            return bad_request(err.to_string());
        }
        Err(err) => {
            span.record("otel.status_code", "error");
            return internal(err.to_string());
        }
    };
    drop(span);
    crate::metrics::monte_carlo("pre", &race_class, elapsed);
    tracing::info!(
        venueId = %request.venue_id,
        species = %request.species,
        laps = request.laps,
        entrants = entrants.len(),
        markets = kinds.len(),
        runs,
        elapsedMs = elapsed.as_millis() as u64,
        "priced {} {} laps {} ({} entrants, {} markets) from {runs} runs in {} ms",
        request.venue_id,
        request.species,
        request.laps,
        entrants.len(),
        kinds.len(),
        elapsed.as_millis()
    );
    let margin = app.settings.margin;
    let markets: Vec<serde_json::Value> = request
        .markets
        .iter()
        .zip(&kinds)
        .map(|(market, kind)| {
            let selections: Vec<serde_json::Value> = entrants
                .iter()
                .filter_map(|entrant| {
                    let index = table.index_of(&entrant.entrant_id)?;
                    let probability = floor_probability(kind.probability(&table, index), table.runs);
                    Some(serde_json::json!({
                        "entrantId": entrant.entrant_id,
                        "probability": round_probability(probability),
                        "price": price(probability, margin),
                    }))
                })
                .collect();
            let params = if market.params.is_null() { serde_json::json!({}) } else { market.params.clone() };
            serde_json::json!({ "type": market.kind, "params": params, "selections": selections })
        })
        .collect();
    Json(serde_json::json!({ "runs": table.runs, "markets": markets })).into_response()
}
