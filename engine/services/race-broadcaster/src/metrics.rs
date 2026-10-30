use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

use ars_infra::telemetry::metrics::{race_class as class_label, seconds};
use opentelemetry::KeyValue;
use opentelemetry::metrics::Histogram;

const DRIFT_BUCKETS: [f64; 10] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0];
const START_BUCKETS: [f64; 10] = [0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0];

struct Instruments {
    tick_drift: Histogram<f64>,
    start_delay: Histogram<f64>,
}

fn instruments() -> &'static Instruments {
    static INSTRUMENTS: OnceLock<Instruments> = OnceLock::new();
    INSTRUMENTS.get_or_init(|| Instruments {
        tick_drift: seconds("ars.broadcaster.tick_drift", &DRIFT_BUCKETS),
        start_delay: seconds("ars.broadcaster.start_delay", &START_BUCKETS),
    })
}

pub fn lateness(scheduled: SystemTime, published: SystemTime) -> f64 {
    published.duration_since(scheduled).unwrap_or(Duration::ZERO).as_secs_f64()
}

pub fn tick_drift(race_class: &str, scheduled: SystemTime, published: SystemTime) {
    instruments().tick_drift.record(lateness(scheduled, published), &[KeyValue::new("race_class", class_label(race_class))]);
}

pub fn start_delay(race_class: &str, start_at: SystemTime, published: SystemTime) {
    instruments().start_delay.record(lateness(start_at, published), &[KeyValue::new("race_class", class_label(race_class))]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lateness_is_clamped_at_zero() {
        let scheduled = SystemTime::UNIX_EPOCH + Duration::from_secs(100);
        assert_eq!(lateness(scheduled, scheduled + Duration::from_millis(40)), 0.04);
        assert_eq!(lateness(scheduled, scheduled - Duration::from_millis(40)), 0.0);
    }
}
