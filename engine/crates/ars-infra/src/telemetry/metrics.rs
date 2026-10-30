use std::sync::OnceLock;
use std::time::Duration;

use opentelemetry::KeyValue;
use opentelemetry::metrics::{Counter, Histogram, Meter};

pub const DURATION_BUCKETS: [f64; 14] = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, 7.5, 10.0];

pub fn meter() -> Meter {
    opentelemetry::global::meter("ars")
}

pub fn seconds(name: &'static str, buckets: &[f64]) -> Histogram<f64> {
    meter().f64_histogram(name).with_unit("s").with_boundaries(buckets.to_vec()).build()
}

pub fn counter(name: &'static str) -> Counter<u64> {
    meter().u64_counter(name).build()
}

struct Shared {
    http_server: Histogram<f64>,
    process: Histogram<f64>,
}

fn shared() -> &'static Shared {
    static SHARED: OnceLock<Shared> = OnceLock::new();
    SHARED.get_or_init(|| Shared {
        http_server: seconds("http.server.request.duration", &DURATION_BUCKETS),
        process: seconds("messaging.process.duration", &DURATION_BUCKETS),
    })
}

pub fn record_http(route: &str, method: &str, status: u16, elapsed: Duration) {
    shared().http_server.record(
        elapsed.as_secs_f64(),
        &[
            KeyValue::new("http.route", route.to_string()),
            KeyValue::new("http.request.method", method.to_string()),
            KeyValue::new("http.response.status_code", i64::from(status)),
        ],
    );
}

pub fn record_processed(group: &str, topic: &str, event_type: &str, ok: bool, elapsed: Duration) {
    shared().process.record(
        elapsed.as_secs_f64(),
        &[
            KeyValue::new("consumer_group", group.to_string()),
            KeyValue::new("topic", topic.to_string()),
            KeyValue::new("event_type", event_type.to_string()),
            KeyValue::new("outcome", if ok { "ok" } else { "error" }),
        ],
    );
}

pub fn race_class(value: &str) -> &'static str {
    match value {
        "SPRINT" => "SPRINT",
        "STANDARD" => "STANDARD",
        "ENDURANCE" => "ENDURANCE",
        _ => "unknown",
    }
}
