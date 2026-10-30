use std::time::Instant;

use axum::Json;
use axum::Router;
use axum::extract::{MatchedPath, Request};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use opentelemetry::propagation::{Extractor, TextMapPropagator};
use opentelemetry_sdk::propagation::TraceContextPropagator;
use tracing::Instrument;
use tracing::field::Empty;

use crate::{Context, Res};

pub async fn serve(port: u16, router: Router) -> Res<()> {
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.context("bind http port")?;
    tracing::info!(port, "http listening on :{port}");
    axum::serve(listener, router.route_layer(axum::middleware::from_fn(trace_internal))).await.context("http server")
}

struct HeaderReader<'a>(&'a HeaderMap);

impl Extractor for HeaderReader<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).and_then(|value| value.to_str().ok())
    }

    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(|name| name.as_str()).collect()
    }
}

pub fn extract_context(headers: &HeaderMap) -> opentelemetry::Context {
    TraceContextPropagator::new().extract(&HeaderReader(headers))
}

async fn trace_internal(request: Request, next: Next) -> Response {
    let route = request.extensions().get::<MatchedPath>().map(|path| path.as_str().to_string());
    let Some(route) = route.filter(|route| route.starts_with("/internal/")) else {
        return next.run(request).await;
    };
    let method = request.method().as_str().to_string();
    let span = tracing::info_span!(
        parent: None,
        "http.server",
        "otel.name" = %format!("{method} {route}"),
        "otel.kind" = "server",
        "otel.status_code" = Empty,
        "http.request.method" = method.as_str(),
        "http.route" = route.as_str(),
        "http.response.status_code" = Empty,
        "ars.flow" = Empty,
        "race_class" = Empty,
    );
    crate::telemetry::set_parent(&span, extract_context(request.headers()));
    let started = Instant::now();
    let response = next.run(request).instrument(span.clone()).await;
    let status = response.status().as_u16();
    span.record("http.response.status_code", i64::from(status));
    if status >= 500 {
        span.record("otel.status_code", "error");
    }
    crate::telemetry::metrics::record_http(&route, &method, status, started.elapsed());
    response
}

pub fn error(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (status, Json(serde_json::json!({ "code": code, "message": message.into() }))).into_response()
}

pub fn bad_request(message: impl Into<String>) -> Response {
    error(StatusCode::BAD_REQUEST, "VALIDATION_FAILED", message)
}

pub fn not_found(message: impl Into<String>) -> Response {
    error(StatusCode::NOT_FOUND, "NOT_FOUND", message)
}

pub fn internal(message: impl Into<String>) -> Response {
    error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL", message)
}

pub fn classify(message: String) -> Response {
    if message.contains("NOT_FOUND") {
        not_found(message)
    } else if message.contains("invalid") || message.contains("UNSUPPORTED") || message.contains("unknown") {
        bad_request(message)
    } else {
        internal(message)
    }
}
