mod api;
mod consumer;
mod live;
mod metrics;
mod pricing;
mod rebuild;
mod registry;
mod state;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use ars_infra::catalog::Catalog;
use ars_infra::db::Db;
use ars_infra::kafka::Producer;
use ars_infra::{Res, config, telemetry};
use tokio::sync::Semaphore;

use crate::registry::Registry;
use crate::state::{App, Settings};

const USAGE: &str = "odds-engine: Monte Carlo pricing from revealed race state

USAGE:
  odds-engine                 run (HTTP on PORT, default 7003; consumes race.lifecycle, market.events, race.ticks)
  odds-engine --help | --version

ENV: DATABASE_URL KAFKA_BROKERS REDIS_URL PORT ODDS_MARGIN ODDS_RUNS_PRERACE ODDS_RUNS_LIVE ODDS_THREADS ODDS_STALE_MS
     RUST_LOG OTEL_EXPORTER_OTLP_ENDPOINT OTEL_SERVICE_NAME OTEL_RESOURCE_ATTRIBUTES OTEL_SDK_DISABLED";

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("--help") | Some("-h") | Some("help") => println!("{USAGE}"),
        Some("--version") | Some("-V") => println!("odds-engine {}", race_engine_core::ENGINE_VERSION),
        Some(other) => {
            eprintln!("unknown argument {other}\n\n{USAGE}");
            std::process::exit(2);
        }
        None => {
            let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime");
            runtime.block_on(async {
                telemetry::init("odds-engine");
                if let Err(err) = run().await {
                    tracing::error!("{err}");
                    telemetry::exit(1).await;
                }
            });
        }
    }
}

async fn run() -> Res<()> {
    telemetry::exit_on_signal();
    let default_threads = std::thread::available_parallelism().map(|count| count.get()).unwrap_or(2);
    let settings = Settings {
        margin: config::number("ODDS_MARGIN", 0.05),
        runs_prerace: config::number("ODDS_RUNS_PRERACE", 5000u32).max(1),
        runs_live: config::number("ODDS_RUNS_LIVE", 2000u32).max(1),
        threads: config::number("ODDS_THREADS", default_threads).max(1),
        stale_ms: config::number("ODDS_STALE_MS", 2500i64),
    };
    tracing::info!(
        margin = settings.margin,
        runsPrerace = settings.runs_prerace,
        runsLive = settings.runs_live,
        threads = settings.threads,
        "margin {} prerace runs {} live runs {} threads {}",
        settings.margin,
        settings.runs_prerace,
        settings.runs_live,
        settings.threads
    );
    let port: u16 = config::number("PORT", 7003);
    let brokers = config::kafka_brokers();
    let redis = loop {
        match ars_infra::redis_store::connect(&config::redis_url()).await {
            Ok(connection) => break connection,
            Err(err) => {
                tracing::warn!("{err}");
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    };
    let app = Arc::new(App {
        db: Db::new(&config::database_url(), 4),
        catalog: Catalog::new(),
        producer: Producer::new(&brokers, "odds-engine")?,
        redis,
        registry: Mutex::new(Registry::default()),
        settings,
        compute: Semaphore::new(1),
    });
    let http_app = app.clone();
    tokio::spawn(async move {
        if let Err(err) = ars_infra::http::serve(port, api::router(http_app)).await {
            tracing::error!("{err}");
            telemetry::exit(1).await;
        }
    });
    app.db.wait_ready().await;
    rebuild::rebuild(&app).await?;
    consumer::run(app, &brokers).await
}
