use std::sync::OnceLock;
use std::time::Duration;

use ars_infra::telemetry::metrics::{counter, race_class as class_label, seconds};
use opentelemetry::KeyValue;
use opentelemetry::metrics::{Counter, Histogram};

const MC_BUCKETS: [f64; 10] = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0];
const REPRICE_BUCKETS: [f64; 10] = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 5.0, 10.0];

struct Instruments {
    monte_carlo: Histogram<f64>,
    reprice_interval: Histogram<f64>,
    stale_ticks: Counter<u64>,
}

fn instruments() -> &'static Instruments {
    static INSTRUMENTS: OnceLock<Instruments> = OnceLock::new();
    INSTRUMENTS.get_or_init(|| Instruments {
        monte_carlo: seconds("ars.odds.mc.duration", &MC_BUCKETS),
        reprice_interval: seconds("ars.odds.reprice.interval", &REPRICE_BUCKETS),
        stale_ticks: counter("ars.odds.stale_ticks"),
    })
}

pub fn monte_carlo(phase: &'static str, race_class: &str, elapsed: Duration) {
    instruments()
        .monte_carlo
        .record(elapsed.as_secs_f64(), &[KeyValue::new("phase", phase), KeyValue::new("race_class", class_label(race_class))]);
}

pub fn reprice_interval(race_class: &str, interval: Duration) {
    instruments().reprice_interval.record(interval.as_secs_f64(), &[KeyValue::new("race_class", class_label(race_class))]);
}

pub fn stale_tick() {
    instruments().stale_ticks.add(1, &[]);
}
