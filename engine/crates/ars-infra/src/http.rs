use axum::Json;
use axum::Router;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use crate::{Context, Res};

pub async fn serve(port: u16, router: Router) -> Res<()> {
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.context("bind http port")?;
    crate::log::info(format!("http listening on :{port}"));
    axum::serve(listener, router).await.context("http server")
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
