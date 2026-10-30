use redis::aio::ConnectionManager;

use crate::{Context, Res};

pub async fn connect(url: &str) -> Res<ConnectionManager> {
    let client = redis::Client::open(url).context("redis url")?;
    client.get_connection_manager().await.context("redis connect")
}
