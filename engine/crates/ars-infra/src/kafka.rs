use std::time::Duration;

use ars_proto::Envelope;
use rdkafka::ClientConfig;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::producer::{FutureProducer, FutureRecord};

use crate::{Context, Res};

pub const RACE_LIFECYCLE: &str = "race.lifecycle";
pub const RACE_COMMANDS: &str = "race.commands";
pub const RACE_TICKS: &str = "race.ticks";
pub const MARKET_EVENTS: &str = "market.events";

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
        let mut attempt = 0;
        loop {
            let record = FutureRecord::to(topic).key(key).payload(&bytes);
            match self.inner.send(record, Duration::from_secs(10)).await {
                Ok(_) => return Ok(()),
                Err((err, _)) => {
                    attempt += 1;
                    if attempt >= 3 {
                        return Err(format!("publish {} to {topic} failed: {err}", envelope.r#type));
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
