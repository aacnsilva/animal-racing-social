use std::sync::OnceLock;

static SERVICE: OnceLock<String> = OnceLock::new();

pub fn init(service: &str) {
    let _ = SERVICE.set(service.to_string());
}

fn write(level: &str, message: &str) {
    let service = SERVICE.get().map(String::as_str).unwrap_or("engine");
    eprintln!("{} {level} {service} {message}", crate::time::now_rfc3339());
}

pub fn info(message: impl AsRef<str>) {
    write("INFO", message.as_ref());
}

pub fn warn(message: impl AsRef<str>) {
    write("WARN", message.as_ref());
}

pub fn error(message: impl AsRef<str>) {
    write("ERROR", message.as_ref());
}

pub fn exit_on_signal() {
    tokio::spawn(async {
        let mut terminate = match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(stream) => stream,
            Err(err) => {
                warn(format!("cannot install SIGTERM handler: {err}"));
                return;
            }
        };
        tokio::select! {
            _ = terminate.recv() => info("SIGTERM received; exiting"),
            _ = tokio::signal::ctrl_c() => info("SIGINT received; exiting"),
        }
        std::process::exit(0);
    });
}
