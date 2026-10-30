mod json;
pub mod metrics;

use std::future::Future;
use std::sync::OnceLock;
use std::time::Duration;

use opentelemetry::KeyValue;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::{MetricExporter, SpanExporter};
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::metrics::periodic_reader_with_async_runtime::PeriodicReader;
use opentelemetry_sdk::metrics::{SdkMeterProvider, Temporality};
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::resource::{EnvResourceDetector, ResourceDetector, TelemetryResourceDetector};
use opentelemetry_sdk::runtime::Tokio;
use opentelemetry_sdk::trace::SdkTracerProvider;
use opentelemetry_sdk::trace::span_processor_with_async_runtime::BatchSpanProcessor;
use tracing::Instrument;
use tracing_subscriber::Layer;
use tracing_subscriber::filter::{EnvFilter, LevelFilter};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

pub use json::JsonLayer;
pub use tracing_opentelemetry::OpenTelemetrySpanExt;

const FLUSH_TIMEOUT: Duration = Duration::from_secs(3);
const METRIC_INTERVAL: Duration = Duration::from_secs(15);

static SERVICE: OnceLock<String> = OnceLock::new();
static PROVIDERS: OnceLock<Providers> = OnceLock::new();

#[derive(Clone)]
struct Providers {
    tracer: SdkTracerProvider,
    meter: Option<SdkMeterProvider>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    pub service: String,
    pub sdk_disabled: bool,
    pub export_traces: bool,
    pub export_metrics: bool,
}

impl Settings {
    pub fn from_env(default_service: &str) -> Settings {
        Settings::from_lookup(default_service, |name| std::env::var(name).ok())
    }

    pub fn from_lookup(default_service: &str, lookup: impl Fn(&str) -> Option<String>) -> Settings {
        let value = |name: &str| lookup(name).map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
        let attribute_service = value("OTEL_RESOURCE_ATTRIBUTES").and_then(|attributes| {
            attributes.split(',').find_map(|entry| {
                let (key, value) = entry.split_once('=')?;
                (key.trim() == "service.name" && !value.trim().is_empty()).then(|| value.trim().to_string())
            })
        });
        let service = value("OTEL_SERVICE_NAME").or(attribute_service).unwrap_or_else(|| default_service.to_string());
        let sdk_disabled = value("OTEL_SDK_DISABLED").is_some_and(|flag| flag.eq_ignore_ascii_case("true"));
        let endpoint = value("OTEL_EXPORTER_OTLP_ENDPOINT").is_some();
        Settings {
            service,
            sdk_disabled,
            export_traces: !sdk_disabled && (endpoint || value("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT").is_some()),
            export_metrics: !sdk_disabled && (endpoint || value("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT").is_some()),
        }
    }
}

pub fn service_name() -> &'static str {
    SERVICE.get().map(String::as_str).unwrap_or("engine")
}

pub fn hostname() -> String {
    std::env::var("HOSTNAME")
        .ok()
        .or_else(|| std::fs::read_to_string("/proc/sys/kernel/hostname").ok())
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

fn resource(service: &str) -> Resource {
    let detectors: [Box<dyn ResourceDetector>; 2] = [Box::new(TelemetryResourceDetector), Box::new(EnvResourceDetector::new())];
    Resource::builder_empty()
        .with_attribute(KeyValue::new("service.instance.id", hostname()))
        .with_detectors(&detectors)
        .with_service_name(service.to_string())
        .build()
}

fn log_filter() -> EnvFilter {
    EnvFilter::builder().with_default_directive(LevelFilter::INFO.into()).from_env_lossy()
}

pub fn init(default_service: &str) {
    init_with(Settings::from_env(default_service));
}

pub fn init_with(settings: Settings) {
    let _ = SERVICE.set(settings.service.clone());
    opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
    let logs = JsonLayer::stdout(&settings.service).with_filter(log_filter());
    if settings.sdk_disabled {
        let _ = tracing_subscriber::registry().with(logs).try_init();
        return;
    }
    let resource = resource(&settings.service);
    let mut failures = Vec::new();
    let mut tracer_builder = SdkTracerProvider::builder().with_resource(resource.clone());
    if settings.export_traces {
        match SpanExporter::builder().with_http().build() {
            Ok(exporter) => tracer_builder = tracer_builder.with_span_processor(BatchSpanProcessor::builder(exporter, Tokio).build()),
            Err(err) => failures.push(format!("trace exporter disabled: {err}")),
        }
    }
    let tracer_provider = tracer_builder.build();
    let mut meter_provider = None;
    if settings.export_metrics {
        match MetricExporter::builder().with_http().with_temporality(Temporality::Cumulative).build() {
            Ok(exporter) => {
                let mut reader = PeriodicReader::builder(exporter, Tokio);
                if std::env::var_os("OTEL_METRIC_EXPORT_INTERVAL").is_none() {
                    reader = reader.with_interval(METRIC_INTERVAL);
                }
                meter_provider = Some(SdkMeterProvider::builder().with_resource(resource).with_reader(reader.build()).build());
            }
            Err(err) => failures.push(format!("metric exporter disabled: {err}")),
        }
    }
    let tracer = tracer_provider.tracer("ars");
    opentelemetry::global::set_tracer_provider(tracer_provider.clone());
    if let Some(meter_provider) = &meter_provider {
        opentelemetry::global::set_meter_provider(meter_provider.clone());
    }
    let traces = tracing_opentelemetry::layer()
        .with_tracer(tracer)
        .with_threads(false)
        .with_location(false)
        .with_target(false)
        .with_tracked_inactivity(false)
        .with_filter(LevelFilter::INFO);
    let _ = tracing_subscriber::registry().with(logs).with(traces).try_init();
    let _ = PROVIDERS.set(Providers { tracer: tracer_provider, meter: meter_provider });
    for failure in failures {
        tracing::warn!("{failure}");
    }
}

pub async fn shutdown() {
    let Some(providers) = PROVIDERS.get().cloned() else { return };
    let tracer = tokio::task::spawn_blocking(move || {
        let _ = providers.tracer.force_flush();
        let _ = providers.tracer.shutdown();
    });
    let meter = tokio::task::spawn_blocking(move || {
        if let Some(meter) = providers.meter {
            let _ = meter.shutdown();
        }
    });
    let _ = tokio::time::timeout(FLUSH_TIMEOUT, async {
        let _ = tracer.await;
        let _ = meter.await;
    })
    .await;
}

pub async fn exit(code: i32) -> ! {
    shutdown().await;
    std::process::exit(code)
}

pub fn exit_on_signal() {
    tokio::spawn(async {
        let mut terminate = match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(stream) => stream,
            Err(err) => {
                tracing::warn!("cannot install SIGTERM handler: {err}");
                return;
            }
        };
        tokio::select! {
            _ = terminate.recv() => tracing::info!("SIGTERM received; exiting"),
            _ = tokio::signal::ctrl_c() => tracing::info!("SIGINT received; exiting"),
        }
        exit(0).await;
    });
}

pub async fn traced<T, E>(span: &tracing::Span, work: impl Future<Output = Result<T, E>>) -> Result<T, E> {
    let result = work.instrument(span.clone()).await;
    if result.is_err() {
        span.record("otel.status_code", "error");
    }
    result
}

pub fn set_parent(span: &tracing::Span, parent: opentelemetry::Context) {
    let _ = span.set_parent(parent);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |name| pairs.iter().find(|(key, _)| *key == name).map(|(_, value)| value.to_string())
    }

    #[test]
    fn settings_default_to_no_export_without_endpoint() {
        let settings = Settings::from_lookup("race-engine", lookup(&[]));
        assert_eq!(
            settings,
            Settings { service: "race-engine".into(), sdk_disabled: false, export_traces: false, export_metrics: false }
        );
    }

    #[test]
    fn settings_honour_service_name_endpoint_and_disable_flag() {
        let settings = Settings::from_lookup(
            "odds-engine",
            lookup(&[("OTEL_SERVICE_NAME", "odds-a"), ("OTEL_EXPORTER_OTLP_ENDPOINT", "http://alloy:4318")]),
        );
        assert_eq!(settings.service, "odds-a");
        assert!(settings.export_traces && settings.export_metrics);
        let from_attributes = Settings::from_lookup(
            "odds-engine",
            lookup(&[("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment=dev,service.name=odds-b")]),
        );
        assert_eq!(from_attributes.service, "odds-b");
        let disabled = Settings::from_lookup(
            "odds-engine",
            lookup(&[("OTEL_SDK_DISABLED", "TRUE"), ("OTEL_EXPORTER_OTLP_ENDPOINT", "http://alloy:4318")]),
        );
        assert!(disabled.sdk_disabled && !disabled.export_traces && !disabled.export_metrics);
    }

    #[tokio::test]
    async fn init_without_endpoint_installs_no_exporters_and_shuts_down() {
        init_with(Settings::from_lookup("telemetry-test", lookup(&[])));
        assert_eq!(service_name(), "telemetry-test");
        assert!(PROVIDERS.get().is_some_and(|providers| providers.meter.is_none()));
        metrics::record_processed("group", "topic", "RaceTick", true, Duration::from_millis(3));
        let started = std::time::Instant::now();
        shutdown().await;
        assert!(started.elapsed() < FLUSH_TIMEOUT);
    }
}
