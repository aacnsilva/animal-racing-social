mod api;
mod cli;
mod register;
mod worker;

use std::sync::Arc;

use ars_infra::catalog::Catalog;
use ars_infra::db::Db;
use ars_infra::kafka::Producer;
use ars_infra::sealing::Keyring;
use ars_infra::{Res, config, log};

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

ENV: DATABASE_URL KAFKA_BROKERS PORT SCRIPT_KEYS SCRIPT_KEY_ID";

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
            if let Err(err) = runtime.block_on(run()) {
                log::error(err);
                std::process::exit(1);
            }
        }
    }
}

async fn run() -> Res<()> {
    log::init("race-engine");
    log::exit_on_signal();
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
            log::error(err);
            std::process::exit(1);
        }
    });
    worker::run(state, producer, keyring, &brokers).await
}
