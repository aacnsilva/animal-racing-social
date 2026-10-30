use std::sync::Arc;
use std::time::Instant;

use axum::Json;
use axum::Router;
use axum::extract::State;
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use ars_infra::convert::{IdText, WireEntrant, entrants_from_wire};
use ars_infra::http::{bad_request, classify, internal};
use race_engine_core::{RaceInputs, parse_seed, plan_race, simulate};
use serde::Deserialize;
use tracing::Instrument;
use tracing::field::Empty;

use crate::AppState;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/internal/engine-versions", get(engine_versions))
        .route("/internal/plan", post(plan))
        .route("/internal/simulate", post(simulate_handler))
        .with_state(state)
}

async fn healthz() -> Response {
    Json(serde_json::json!({ "status": "ok", "engineVersion": race_engine_core::ENGINE_VERSION })).into_response()
}

async fn engine_versions(State(state): State<Arc<AppState>>) -> Response {
    match crate::register::supported_versions(&state.db).await {
        Ok(versions) => Json(
            versions
                .into_iter()
                .map(|(version, hash)| serde_json::json!({ "engineVersion": version, "paramsHash": hash }))
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(err) => internal(err),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanRequest {
    venue_id: String,
    venue_version: u32,
    species: String,
    race_class: Option<String>,
    engine_version: Option<String>,
    entrants: Vec<WireEntrant>,
}

async fn resolve_version(state: &AppState, requested: Option<String>) -> Result<String, String> {
    match requested {
        Some(version) if !version.is_empty() => Ok(version),
        _ => {
            let conn = state.db.acquire().await?;
            state.catalog.active_engine_version(&conn).await
        }
    }
}

async fn plan(State(state): State<Arc<AppState>>, body: Result<Json<PlanRequest>, axum::extract::rejection::JsonRejection>) -> Response {
    let Json(request) = match body {
        Ok(body) => body,
        Err(err) => return bad_request(err.body_text()),
    };
    let entrants = match entrants_from_wire(&request.entrants) {
        Ok(entrants) => entrants,
        Err(err) => return bad_request(err),
    };
    let loaded = async {
        let version = resolve_version(&state, request.engine_version.clone()).await?;
        let conn = state.db.acquire().await?;
        let venue = state.catalog.venue(&conn, &request.venue_id, request.venue_version).await?;
        let params = state.catalog.params(&conn, &version).await?;
        Ok::<_, String>((venue, params))
    }
    .await;
    let (venue, params) = match loaded {
        Ok(loaded) => loaded,
        Err(err) => return classify(err),
    };
    let race_class = request.race_class.clone().unwrap_or_else(|| venue.class.clone());
    let server = tracing::Span::current();
    server.record("ars.flow", "race-scheduling");
    server.record("race_class", race_class.as_str());
    let span = tracing::info_span!("engine.plan", "ars.flow" = "race-scheduling", "race_class" = race_class.as_str(), "otel.status_code" = Empty);
    let species = request.species.clone();
    let plan_class = race_class.clone();
    let started = Instant::now();
    let planned = tokio::task::spawn_blocking(move || plan_race(&params, &venue, &species, &plan_class, &entrants))
        .instrument(span.clone())
        .await;
    match planned {
        Ok(Ok(plan)) => {
            crate::metrics::plan_duration(&race_class, started.elapsed());
            Json(serde_json::json!({ "laps": plan.laps, "estimatedDurationSec": plan.estimated_duration_sec })).into_response()
        }
        Ok(Err(err)) => {
            span.record("otel.status_code", "error");
            bad_request(err.to_string())
        }
        Err(err) => {
            span.record("otel.status_code", "error");
            internal(err.to_string())
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SimulateRequest {
    race_id: IdText,
    engine_version: Option<String>,
    venue_id: String,
    venue_version: u32,
    species: String,
    laps: u32,
    entrants: Vec<WireEntrant>,
    seed: String,
}

async fn simulate_handler(
    State(state): State<Arc<AppState>>,
    body: Result<Json<SimulateRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(request) = match body {
        Ok(body) => body,
        Err(err) => return bad_request(err.body_text()),
    };
    let entrants = match entrants_from_wire(&request.entrants) {
        Ok(entrants) => entrants,
        Err(err) => return bad_request(err),
    };
    let seed = match parse_seed(&request.seed) {
        Ok(seed) => seed,
        Err(err) => return bad_request(err.to_string()),
    };
    let loaded = async {
        let version = resolve_version(&state, request.engine_version.clone()).await?;
        let conn = state.db.acquire().await?;
        let venue = state.catalog.venue(&conn, &request.venue_id, request.venue_version).await?;
        let params = state.catalog.params(&conn, &version).await?;
        Ok::<_, String>((version, venue, params))
    }
    .await;
    let (version, venue, params) = match loaded {
        Ok(loaded) => loaded,
        Err(err) => return classify(err),
    };
    let inputs = RaceInputs {
        race_id: request.race_id.0.clone(),
        engine_version: version,
        species: request.species.clone(),
        laps: request.laps,
        entrants,
    };
    let result = tokio::task::spawn_blocking(move || simulate(&params, &venue, &inputs, &seed)).await;
    match result {
        Ok(Ok(sealed)) => ([(header::CONTENT_TYPE, "application/json")], sealed.json).into_response(),
        Ok(Err(err)) => bad_request(err.to_string()),
        Err(err) => internal(err.to_string()),
    }
}
