mod metrics;
mod publish;
mod race;
mod scheduler;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use ars_infra::db::Db;
use ars_infra::kafka::Producer;
use ars_infra::sealing::Keyring;
use ars_infra::{Res, config, telemetry};
use axum::Json;
use axum::Router;
use axum::extract::State;
use axum::routing::get;
use redis::aio::ConnectionManager;

pub struct Ctx {
    pub db: Db,
    pub producer: Producer,
    pub keyring: Keyring,
    pub redis: ConnectionManager,
    pub retention_hours: i64,
    pub leader: AtomicBool,
    pub live: AtomicUsize,
}

const LEADER_LOCK_KEY: i64 = 0x4152_5342_524f_4144;

const USAGE: &str = "race-broadcaster: releases sealed race scripts tick by tick on wall-clock time

USAGE:
  race-broadcaster            run (Postgres advisory-lock leadership; health HTTP on PORT, default 7002)
  race-broadcaster --help | --version

ENV: DATABASE_URL KAFKA_BROKERS REDIS_URL PORT SCRIPT_KEYS SCRIPT_KEY_ID REPLAY_RETENTION_HOURS
     RUST_LOG OTEL_EXPORTER_OTLP_ENDPOINT OTEL_SERVICE_NAME OTEL_RESOURCE_ATTRIBUTES OTEL_SDK_DISABLED";

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("--help") | Some("-h") | Some("help") => println!("{USAGE}"),
        Some("--version") | Some("-V") => println!("race-broadcaster {}", race_engine_core::ENGINE_VERSION),
        Some(other) => {
            eprintln!("unknown argument {other}\n\n{USAGE}");
            std::process::exit(2);
        }
        None => {
            let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime");
            runtime.block_on(async {
                telemetry::init("race-broadcaster");
                if let Err(err) = run().await {
                    tracing::error!("{err}");
                    telemetry::exit(1).await;
                }
            });
        }
    }
}

async fn healthz(State(ctx): State<Arc<Ctx>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "leader": ctx.leader.load(Ordering::Relaxed),
        "liveRaces": ctx.live.load(Ordering::Relaxed),
    }))
}

async fn run() -> Res<()> {
    telemetry::exit_on_signal();
    let keyring = Keyring::from_env()?;
    let port: u16 = config::number("PORT", 7002);
    let url = config::database_url();
    let retention_hours = config::number::<i64>("REPLAY_RETENTION_HOURS", 24).max(24);
    let producer = Producer::new(&config::kafka_brokers(), "race-broadcaster")?;
    let redis = loop {
        match ars_infra::redis_store::connect(&config::redis_url()).await {
            Ok(connection) => break connection,
            Err(err) => {
                tracing::warn!("{err}");
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    };
    let ctx = Arc::new(Ctx {
        db: Db::new(&url, 8),
        producer,
        keyring,
        redis,
        retention_hours,
        leader: AtomicBool::new(false),
        live: AtomicUsize::new(0),
    });
    let router = Router::new().route("/healthz", get(healthz)).with_state(ctx.clone());
    tokio::spawn(async move {
        if let Err(err) = ars_infra::http::serve(port, router).await {
            tracing::error!("{err}");
            telemetry::exit(1).await;
        }
    });
    ctx.db.wait_ready().await;
    let lock_client = acquire_leadership(&url).await;
    ctx.leader.store(true, Ordering::Relaxed);
    tracing::info!("leadership acquired");
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            if lock_client.simple_query("SELECT 1").await.is_err() {
                tracing::error!("leadership connection lost; exiting so a standby can take over");
                telemetry::exit(1).await;
            }
        }
    });
    scheduler::run(ctx).await
}

async fn acquire_leadership(url: &str) -> tokio_postgres::Client {
    let mut waiting_logged = false;
    loop {
        match ars_infra::db::connect(url).await {
            Ok(client) => loop {
                match client.query_one("SELECT pg_try_advisory_lock($1)", &[&LEADER_LOCK_KEY]).await {
                    Ok(row) if row.get::<_, bool>(0) => return client,
                    Ok(_) => {
                        if !waiting_logged {
                            tracing::info!("standby: another broadcaster holds leadership");
                            waiting_logged = true;
                        }
                        tokio::time::sleep(Duration::from_secs(2)).await;
                    }
                    Err(err) => {
                        tracing::warn!("leadership query failed: {err}");
                        break;
                    }
                }
            },
            Err(err) => tracing::warn!("{err}"),
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}
