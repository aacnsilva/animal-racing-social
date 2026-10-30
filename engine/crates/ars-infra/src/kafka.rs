use std::time::Duration;

use ars_proto::Envelope;
use opentelemetry::propagation::{Extractor, Injector, TextMapPropagator};
use opentelemetry_sdk::propagation::TraceContextPropagator;
use rdkafka::ClientConfig;
use rdkafka::Message;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::message::{Header, Headers, OwnedHeaders};
use rdkafka::producer::{FutureProducer, FutureRecord};
use tracing::field::{Empty, display};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::{Context, Res};

pub const RACE_LIFECYCLE: &str = "race.lifecycle";
pub const RACE_COMMANDS: &str = "race.commands";
pub const RACE_TICKS: &str = "race.ticks";
pub const MARKET_EVENTS: &str = "market.events";

pub fn traced(event_type: &str) -> bool {
    !matches!(event_type, "RaceTick" | "PriceUpdated" | "LapCompleted")
}

struct HeaderWriter(Vec<(String, String)>);

impl Injector for HeaderWriter {
    fn set(&mut self, key: &str, value: String) {
        if !value.is_empty() {
            self.0.push((key.to_string(), value));
        }
    }
}

struct HeaderReader<'a, H>(&'a H);

impl<H: Headers> Extractor for HeaderReader<'_, H> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|header| header.key.eq_ignore_ascii_case(key))
            .and_then(|header| header.value)
            .and_then(|value| std::str::from_utf8(value).ok())
    }

    fn keys(&self) -> Vec<&str> {
        self.0.iter().map(|header| header.key).collect()
    }
}

pub fn inject_headers(context: &opentelemetry::Context) -> Option<OwnedHeaders> {
    let mut writer = HeaderWriter(Vec::new());
    TraceContextPropagator::new().inject_context(context, &mut writer);
    if writer.0.is_empty() {
        return None;
    }
    Some(
        writer
            .0
            .iter()
            .fold(OwnedHeaders::new_with_capacity(writer.0.len()), |headers, (key, value)| {
                headers.insert(Header { key, value: Some(value.as_str()) })
            }),
    )
}

pub fn extract_context<H: Headers>(headers: Option<&H>) -> opentelemetry::Context {
    match headers {
        Some(headers) => TraceContextPropagator::new().extract(&HeaderReader(headers)),
        None => opentelemetry::Context::new(),
    }
}

pub fn process_span<M: Message>(group: &str, message: &M, envelope: &Envelope) -> tracing::Span {
    let topic = message.topic();
    let event_type = crate::envelope::event_type(envelope);
    let span = tracing::info_span!(
        parent: None,
        "kafka.process",
        "otel.name" = %format!("process {topic} {event_type}"),
        "otel.kind" = "consumer",
        "otel.status_code" = Empty,
        "messaging.system" = "kafka",
        "messaging.operation.type" = "process",
        "messaging.destination.name" = topic,
        "messaging.consumer.group.name" = group,
        "messaging.message.id" = envelope.event_id.as_str(),
        "ars.race_id" = Empty,
        "ars.flow" = Empty,
        "race_class" = Empty,
    );
    if let Some(race_id) = envelope.payload.as_ref().and_then(crate::envelope::race_id) {
        span.record("ars.race_id", display(race_id));
    }
    let _ = span.set_parent(extract_context(message.headers()));
    span
}

pub fn record_processed(group: &str, topic: &str, event_type: &str, ok: bool, elapsed: Duration) {
    crate::telemetry::metrics::record_processed(group, topic, event_type, ok, elapsed);
}

#[derive(Clone)]
pub struct Producer {
    inner: FutureProducer,
}

impl Producer {
    pub fn new(brokers: &str, client_id: &str) -> Res<Producer> {
        let inner: FutureProducer = ClientConfig::new()
            .set("bootstrap.servers", brokers)
            .set("client.id", client_id)
            .set("acks", "all")
            .set("partitioner", "murmur2_random")
            .set("enable.idempotence", "true")
            .set("linger.ms", "2")
            .set("message.timeout.ms", "30000")
            .create()
            .context("create kafka producer")?;
        Ok(Producer { inner })
    }

    pub async fn publish(&self, topic: &str, key: &str, envelope: &Envelope) -> Res<()> {
        let bytes = crate::envelope::encode(envelope);
        let event_type = crate::envelope::event_type(envelope);
        if !traced(event_type) {
            return self.send(topic, key, &bytes, None, event_type).await;
        }
        let span = tracing::info_span!(
            "kafka.publish",
            "otel.name" = %format!("publish {topic} {event_type}"),
            "otel.kind" = "producer",
            "otel.status_code" = Empty,
            "messaging.system" = "kafka",
            "messaging.operation.type" = "send",
            "messaging.destination.name" = topic,
            "messaging.message.id" = envelope.event_id.as_str(),
            "ars.race_id" = Empty,
        );
        if let Some(race_id) = envelope.payload.as_ref().and_then(crate::envelope::race_id) {
            span.record("ars.race_id", display(race_id));
        }
        let headers = inject_headers(&span.context());
        crate::telemetry::traced(&span, self.send(topic, key, &bytes, headers, event_type)).await
    }

    async fn send(&self, topic: &str, key: &str, bytes: &[u8], headers: Option<OwnedHeaders>, event_type: &str) -> Res<()> {
        let mut attempt = 0;
        loop {
            let mut record = FutureRecord::to(topic).key(key).payload(bytes);
            if let Some(headers) = &headers {
                record = record.headers(headers.clone());
            }
            match self.inner.send(record, Duration::from_secs(10)).await {
                Ok(_) => return Ok(()),
                Err((err, _)) => {
                    attempt += 1;
                    if attempt >= 3 {
                        return Err(format!("publish {event_type} to {topic} failed: {err}"));
                    }
                    tokio::time::sleep(Duration::from_millis(200 * attempt)).await;
                }
            }
        }
    }

    pub async fn publish_payload(&self, topic: &str, key: &str, payload: ars_proto::envelope::Payload) -> Res<()> {
        let envelope = crate::envelope::build(payload);
        self.publish(topic, key, &envelope).await
    }
}

pub fn consumer(brokers: &str, group: &str, topics: &[&str], offset_reset: &str) -> Res<StreamConsumer> {
    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", brokers)
        .set("group.id", group)
        .set("enable.auto.commit", "true")
        .set("enable.auto.offset.store", "false")
        .set("auto.offset.reset", offset_reset)
        .set("session.timeout.ms", "10000")
        .set("max.poll.interval.ms", "300000")
        .create()
        .context("create kafka consumer")?;
    consumer.subscribe(topics).context("subscribe")?;
    Ok(consumer)
}

#[cfg(test)]
mod tests {
    use opentelemetry::trace::{SpanContext, TraceContextExt, TraceFlags, TraceId, TraceState, Tracer, TracerProvider};
    use opentelemetry_sdk::trace::SdkTracerProvider;

    use super::*;

    #[test]
    fn trace_context_round_trips_through_kafka_headers() {
        let provider = SdkTracerProvider::builder().build();
        let tracer = provider.tracer("test");
        let span = tracer.start("publish race.lifecycle RaceStarted");
        let context = opentelemetry::Context::current_with_span(span);
        let sent = context.span().span_context().clone();
        let headers = inject_headers(&context).expect("headers");
        assert_eq!(headers.count(), 1);
        let traceparent = headers.get(0);
        assert_eq!(traceparent.key, "traceparent");
        let value = std::str::from_utf8(traceparent.value.expect("value")).expect("utf8");
        assert_eq!(value, format!("00-{}-{}-01", sent.trace_id(), sent.span_id()));
        let received = extract_context(Some(&headers));
        let received = received.span().span_context().clone();
        assert!(received.is_remote());
        assert_eq!(received.trace_id(), sent.trace_id());
        assert_eq!(received.span_id(), sent.span_id());
        assert!(received.is_sampled());
    }

    #[test]
    fn tracestate_is_carried_when_present() {
        let state: TraceState = "ars=1".parse().expect("tracestate");
        let span_context = SpanContext::new(
            TraceId::from(0x4bf9_2f35_77b3_4da6_a3ce_929d_0e0e_4736),
            opentelemetry::trace::SpanId::from(0x00f0_67aa_0ba9_02b7),
            TraceFlags::SAMPLED,
            false,
            state,
        );
        let context = opentelemetry::Context::new().with_remote_span_context(span_context);
        let headers = inject_headers(&context).expect("headers");
        let keys: Vec<&str> = headers.iter().map(|header| header.key).collect();
        assert_eq!(keys, ["traceparent", "tracestate"]);
        let received = extract_context(Some(&headers));
        assert_eq!(received.span().span_context().trace_state().header(), "ars=1");
        assert_eq!(format!("{}", received.span().span_context().trace_id()), "4bf92f3577b34da6a3ce929d0e0e4736");
    }

    #[test]
    fn no_headers_without_a_valid_context() {
        assert!(inject_headers(&opentelemetry::Context::new()).is_none());
        let missing: Option<&OwnedHeaders> = None;
        assert!(!extract_context(missing).span().span_context().is_valid());
        assert!(!traced("RaceTick") && !traced("PriceUpdated") && !traced("LapCompleted"));
        assert!(traced("RaceStarted") && traced("GenerateScript"));
    }
}
