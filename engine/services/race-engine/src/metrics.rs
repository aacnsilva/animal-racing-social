use std::sync::OnceLock;
use std::time::Duration;

use ars_infra::telemetry::metrics::{counter, race_class as class_label, seconds};
use opentelemetry::KeyValue;
use opentelemetry::metrics::{Counter, Histogram};

const ENGINE_BUCKETS: [f64; 11] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0];

struct Instruments {
    seal: Histogram<f64>,
    plan: Histogram<f64>,
    scripts: Counter<u64>,
}

fn instruments() -> &'static Instruments {
    static INSTRUMENTS: OnceLock<Instruments> = OnceLock::new();
    INSTRUMENTS.get_or_init(|| Instruments {
        seal: seconds("ars.engine.seal.duration", &ENGINE_BUCKETS),
        plan: seconds("ars.engine.plan.duration", &ENGINE_BUCKETS),
        scripts: counter("ars.engine.scripts"),
    })
}

pub fn seal_duration(race_class: &str, elapsed: Duration) {
    instruments().seal.record(elapsed.as_secs_f64(), &[KeyValue::new("race_class", class_label(race_class))]);
}

pub fn plan_duration(race_class: &str, elapsed: Duration) {
    instruments().plan.record(elapsed.as_secs_f64(), &[KeyValue::new("race_class", class_label(race_class))]);
}

pub fn script(outcome: &'static str) {
    instruments().scripts.add(1, &[KeyValue::new("outcome", outcome)]);
}
