use std::ops::{Deref, DerefMut};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use tokio::sync::{Mutex, MutexGuard};
use tokio_postgres::{Client, NoTls};

use crate::Res;

pub struct Db {
    url: String,
    slots: Vec<Mutex<Option<Client>>>,
    next: AtomicUsize,
}

pub struct DbConn<'a> {
    guard: MutexGuard<'a, Option<Client>>,
}

impl Deref for DbConn<'_> {
    type Target = Client;

    fn deref(&self) -> &Client {
        self.guard.as_ref().expect("connected client")
    }
}

impl DerefMut for DbConn<'_> {
    fn deref_mut(&mut self) -> &mut Client {
        self.guard.as_mut().expect("connected client")
    }
}

pub async fn connect(url: &str) -> Res<Client> {
    let (client, connection) = tokio_postgres::connect(url, NoTls).await.map_err(|err| format!("postgres connect: {err}"))?;
    tokio::spawn(async move {
        if let Err(err) = connection.await {
            tracing::warn!("postgres connection closed: {err}");
        }
    });
    Ok(client)
}

impl Db {
    pub fn new(url: &str, size: usize) -> Db {
        Db {
            url: url.to_string(),
            slots: (0..size.max(1)).map(|_| Mutex::new(None)).collect(),
            next: AtomicUsize::new(0),
        }
    }

    pub async fn acquire(&self) -> Res<DbConn<'_>> {
        let mut guard = None;
        for slot in &self.slots {
            if let Ok(locked) = slot.try_lock() {
                guard = Some(locked);
                break;
            }
        }
        let mut guard = match guard {
            Some(guard) => guard,
            None => {
                let index = self.next.fetch_add(1, Ordering::Relaxed) % self.slots.len();
                self.slots[index].lock().await
            }
        };
        let stale = guard.as_ref().map(|client| client.is_closed()).unwrap_or(true);
        if stale {
            *guard = Some(connect(&self.url).await?);
        }
        Ok(DbConn { guard })
    }

    pub async fn wait_ready(&self) {
        loop {
            match self.acquire().await {
                Ok(conn) => match conn.simple_query("SELECT 1").await {
                    Ok(_) => return,
                    Err(err) => tracing::warn!("database not ready: {err}"),
                },
                Err(err) => tracing::warn!("database not ready: {err}"),
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }
}
