use crate::Res;

pub fn string(name: &str, default: &str) -> String {
    match std::env::var(name) {
        Ok(value) if !value.trim().is_empty() => value.trim().to_string(),
        _ => default.to_string(),
    }
}

pub fn required(name: &str) -> Res<String> {
    match std::env::var(name) {
        Ok(value) if !value.trim().is_empty() => Ok(value.trim().to_string()),
        _ => Err(format!("environment variable {name} is required")),
    }
}

pub fn number<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name).ok().and_then(|value| value.trim().parse().ok()).unwrap_or(default)
}

pub fn database_url() -> String {
    string("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/ars")
}

pub fn kafka_brokers() -> String {
    string("KAFKA_BROKERS", "kafka:9092")
}

pub fn redis_url() -> String {
    string("REDIS_URL", "redis://localhost:6379")
}
