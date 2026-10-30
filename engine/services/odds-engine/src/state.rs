use std::sync::{Arc, Mutex};

use ars_infra::catalog::Catalog;
use ars_infra::db::Db;
use ars_infra::kafka::Producer;
use redis::aio::ConnectionManager;
use tokio::sync::Semaphore;

use crate::registry::Registry;

pub struct Settings {
    pub margin: f64,
    pub runs_prerace: u32,
    pub runs_live: u32,
    pub threads: usize,
    pub stale_ms: i64,
}

pub struct App {
    pub db: Db,
    pub catalog: Catalog,
    pub producer: Producer,
    pub redis: ConnectionManager,
    pub registry: Mutex<Registry>,
    pub settings: Settings,
    pub compute: Semaphore,
}

pub type Shared = Arc<App>;
