pub mod catalog;
pub mod config;
pub mod convert;
pub mod db;
pub mod envelope;
pub mod http;
pub mod ids;
pub mod kafka;
pub mod log;
pub mod redis_store;
pub mod sealing;
pub mod time;

pub type Res<T> = Result<T, String>;

pub trait Context<T> {
    fn context(self, what: &str) -> Res<T>;
}

impl<T, E: std::fmt::Display> Context<T> for Result<T, E> {
    fn context(self, what: &str) -> Res<T> {
        self.map_err(|err| format!("{what}: {err}"))
    }
}

impl<T> Context<T> for Option<T> {
    fn context(self, what: &str) -> Res<T> {
        self.ok_or_else(|| what.to_string())
    }
}
