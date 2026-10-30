mod api;
mod cli;
mod metrics;
mod register;
mod worker;

use std::sync::Arc;

use ars_infra::catalog::Catalog;
use ars_infra::db::Db;
use ars_infra::kafka::Producer;
use ars_infra::sealing::Keyring;
use ars_infra::{Res, config, telemetry};

pub struct AppState {
    pub db: Db,
    pub catalog: Catalog,
}

const USAGE: &str = "race-engine: generates and seals race scripts

USAGE:
  race-engine                     run the service (Kafka race.commands consumer + HTTP on PORT, default 7001)
  race-engine verify --script <file> --venue <venues.json> [--params <engine-params.json>]
                                  re-simulate a revealed script and print OK or MISMATCH
  race-engine --help | --version

ENV: DATABASE_URL KAFKA_BROKERS PORT SCRIPT_KEYS SCRIPT_KEY_ID RUST_LOG OTEL_EXPORTER_OTLP_ENDPOINT OTEL_SERVICE_NAME OTEL_RESOURCE_ATTRIBUTES OTEL_SDK_DISABLED";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("--help") | Some("-h") | Some("help") => println!("{USAGE}"),
        Some("--version") | Some("-V") => println!("race-engine {}", race_engine_core::ENGINE_VERSION),
        Some("verify") => std::process::exit(cli::verify(&args[1..])),
        Some(other) => {
            eprintln!("unknown argument {other}\n\n{USAGE}");
            std::process::exit(2);
        }
        None => {
            let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime");
            runtime.block_on(async {
                telemetry::init("race-engine");
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
    let keyring = Keyring::from_env()?;
    let port: u16 = config::number("PORT", 7001);
    let brokers = config::kafka_brokers();
    let state = Arc::new(AppState { db: Db::new(&config::database_url(), 4), catalog: Catalog::new() });
    state.db.wait_ready().await;
    register::register_engine_version(&state.db).await?;
    let producer = Producer::new(&brokers, "race-engine")?;
    let http_state = state.clone();
    tokio::spawn(async move {
        if let Err(err) = ars_infra::http::serve(port, api::router(http_state)).await {
            tracing::error!("{err}");
            telemetry::exit(1).await;
        }
    });
    worker::run(state, producer, keyring, &brokers).await
}
