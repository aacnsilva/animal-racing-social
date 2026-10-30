use std::fmt::{Debug, Write as _};
use std::io::Write as _;
use std::sync::Arc;

use opentelemetry::trace::TraceContextExt;
use serde_json::Value;
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::{Context, Layer};

const RESERVED: [&str; 6] = ["t", "level", "service", "msg", "trace_id", "span_id"];

type Sink = Arc<dyn Fn(&[u8]) + Send + Sync>;

pub struct JsonLayer {
    service: String,
    sink: Sink,
}

impl JsonLayer {
    pub fn new(service: &str, sink: impl Fn(&[u8]) + Send + Sync + 'static) -> JsonLayer {
        JsonLayer { service: service.to_string(), sink: Arc::new(sink) }
    }

    pub fn stdout(service: &str) -> JsonLayer {
        JsonLayer::new(service, |line| {
            let _ = std::io::stdout().lock().write_all(line);
        })
    }

    fn render(&self, level: &Level, fields: Fields, ids: Option<(String, String)>) -> String {
        let mut line = String::with_capacity(160);
        line.push_str("{\"t\":");
        push_string(&mut line, &crate::time::now_rfc3339());
        line.push_str(",\"level\":");
        push_string(&mut line, level_name(level));
        line.push_str(",\"service\":");
        push_string(&mut line, &self.service);
        line.push_str(",\"msg\":");
        push_string(&mut line, fields.message.as_deref().unwrap_or_default());
        if let Some((trace_id, span_id)) = ids {
            line.push_str(",\"trace_id\":");
            push_string(&mut line, &trace_id);
            line.push_str(",\"span_id\":");
            push_string(&mut line, &span_id);
        }
        for (key, value) in fields.extra {
            if RESERVED.contains(&key) {
                continue;
            }
            line.push(',');
            push_string(&mut line, key);
            line.push(':');
            let _ = write!(line, "{value}");
        }
        line.push_str("}\n");
        line
    }
}

fn level_name(level: &Level) -> &'static str {
    match *level {
        Level::ERROR => "error",
        Level::WARN => "warn",
        Level::INFO => "info",
        Level::DEBUG => "debug",
        Level::TRACE => "trace",
    }
}

fn push_string(line: &mut String, text: &str) {
    match serde_json::to_string(text) {
        Ok(encoded) => line.push_str(&encoded),
        Err(_) => line.push_str("\"\""),
    }
}

fn current_ids() -> Option<(String, String)> {
    let context = opentelemetry::Context::current();
    let span = context.span();
    let span_context = span.span_context();
    span_context.is_valid().then(|| (span_context.trace_id().to_string(), span_context.span_id().to_string()))
}

#[derive(Default)]
struct Fields {
    message: Option<String>,
    extra: Vec<(&'static str, Value)>,
}

impl Fields {
    fn put(&mut self, field: &Field, value: Value) {
        if field.name() == "message" {
            self.message = Some(match value {
                Value::String(text) => text,
                other => other.to_string(),
            });
        } else {
            self.extra.push((field.name(), value));
        }
    }
}

impl Visit for Fields {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.put(field, Value::from(value));
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.put(field, Value::from(value));
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.put(field, Value::from(value));
    }

    fn record_f64(&mut self, field: &Field, value: f64) {
        self.put(field, Value::from(value));
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.put(field, Value::from(value));
    }

    fn record_error(&mut self, field: &Field, value: &(dyn std::error::Error + 'static)) {
        self.put(field, Value::from(value.to_string()));
    }

    fn record_debug(&mut self, field: &Field, value: &dyn Debug) {
        self.put(field, Value::from(format!("{value:?}")));
    }
}

impl<S: Subscriber> Layer<S> for JsonLayer {
    fn on_event(&self, event: &Event<'_>, _context: Context<'_, S>) {
        let mut fields = Fields::default();
        event.record(&mut fields);
        let line = self.render(event.metadata().level(), fields, current_ids());
        (self.sink)(line.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use opentelemetry::trace::TracerProvider as _;
    use opentelemetry_sdk::trace::SdkTracerProvider;
    use tracing_subscriber::layer::SubscriberExt;

    use super::*;

    fn capture(run: impl FnOnce()) -> Vec<String> {
        let buffer = Arc::new(Mutex::new(Vec::new()));
        let writer = buffer.clone();
        let provider = SdkTracerProvider::builder().build();
        let subscriber = tracing_subscriber::registry()
            .with(JsonLayer::new("race-broadcaster", move |line| writer.lock().expect("buffer").extend_from_slice(line)))
            .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
        tracing::subscriber::with_default(subscriber, run);
        let text = String::from_utf8(buffer.lock().expect("buffer").clone()).expect("utf8");
        text.lines().map(str::to_string).collect()
    }

    fn keys(line: &str) -> Vec<String> {
        let value: Value = serde_json::from_str(line).expect("json line");
        let object = value.as_object().expect("object");
        let mut keys: Vec<(usize, String)> =
            object.keys().map(|key| (line.find(&format!("\"{key}\":")).expect("key in line"), key.clone())).collect();
        keys.sort();
        keys.into_iter().map(|(_, key)| key).collect()
    }

    #[test]
    fn event_inside_span_carries_trace_ids_and_fields() {
        let lines = capture(|| {
            let span = tracing::info_span!("broadcaster.start_race");
            let _entered = span.enter();
            tracing::info!(raceId = "123", laps = 3u64, ratio = 0.5, live = true, "race 123 LIVE (3 laps)");
        });
        assert_eq!(lines.len(), 1);
        let line = &lines[0];
        assert_eq!(keys(line), ["t", "level", "service", "msg", "trace_id", "span_id", "raceId", "laps", "ratio", "live"]);
        let value: Value = serde_json::from_str(line).expect("json");
        let t = value["t"].as_str().expect("t");
        assert_eq!(t.len(), 24);
        assert!(t.ends_with('Z') && &t[19..20] == ".");
        assert!(crate::time::parse_rfc3339(t).is_some());
        assert_eq!(value["level"], "info");
        assert_eq!(value["service"], "race-broadcaster");
        assert_eq!(value["msg"], "race 123 LIVE (3 laps)");
        assert_eq!(value["raceId"], "123");
        assert_eq!(value["laps"], 3);
        assert_eq!(value["ratio"], 0.5);
        assert_eq!(value["live"], true);
        let trace_id = value["trace_id"].as_str().expect("trace_id");
        let span_id = value["span_id"].as_str().expect("span_id");
        assert_eq!(trace_id.len(), 32);
        assert_eq!(span_id.len(), 16);
        assert!(trace_id.chars().chain(span_id.chars()).all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_ne!(trace_id, "0".repeat(32));
    }

    #[test]
    fn event_outside_span_has_no_trace_ids() {
        let lines = capture(|| {
            tracing::warn!(error = "boom", "kafka receive error: boom");
            tracing::error!("leadership lost");
        });
        assert_eq!(lines.len(), 2);
        assert_eq!(keys(&lines[0]), ["t", "level", "service", "msg", "error"]);
        assert_eq!(keys(&lines[1]), ["t", "level", "service", "msg"]);
        let first: Value = serde_json::from_str(&lines[0]).expect("json");
        let second: Value = serde_json::from_str(&lines[1]).expect("json");
        assert_eq!(first["level"], "warn");
        assert_eq!(second["level"], "error");
        assert!(first.get("trace_id").is_none() && first.get("span_id").is_none());
    }

    #[test]
    fn reserved_names_are_not_overwritten_and_text_is_escaped() {
        let lines = capture(|| tracing::info!(msg = "other", level = "x", "quote \" and\nnewline"));
        let value: Value = serde_json::from_str(&lines[0]).expect("json");
        assert_eq!(value["msg"], "quote \" and\nnewline");
        assert_eq!(value["level"], "info");
        assert_eq!(lines.len(), 1);
    }
}
