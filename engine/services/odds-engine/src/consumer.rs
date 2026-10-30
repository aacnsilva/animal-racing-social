use std::time::{Duration, SystemTime};

use ars_infra::kafka::{MARKET_EVENTS, RACE_LIFECYCLE, RACE_TICKS};
use ars_infra::{Res, log};
use ars_proto::envelope::Payload;
use ars_proto::{EntrantInfo, Envelope, RaceTick};
use race_engine_core::{EntrantState, RevealedEntrant};
use rdkafka::Message;
use rdkafka::consumer::Consumer;

use crate::pricing::MarketKind;
use crate::registry::{Market, MarketStatus, RaceInfo};
use crate::state::Shared;

pub async fn run(app: Shared, brokers: &str) -> Res<()> {
    let consumer = ars_infra::kafka::consumer(brokers, "odds-engine", &[RACE_LIFECYCLE, MARKET_EVENTS, RACE_TICKS], "latest")?;
    log::info("consuming race.lifecycle, market.events, race.ticks as group odds-engine");
    loop {
        let message = match consumer.recv().await {
            Ok(message) => message,
            Err(err) => {
                log::warn(format!("kafka receive error: {err}"));
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
        };
        if let Some(bytes) = message.payload() {
            match ars_infra::envelope::decode(bytes) {
                Ok(envelope) => handle(&app, envelope),
                Err(err) => log::warn(format!("skipping undecodable message on {}: {err}", message.topic())),
            }
        }
        if let Err(err) = consumer.store_offset_from_message(&message) {
            log::warn(format!("store offset failed: {err}"));
        }
    }
}

fn race_info(entrants: &[EntrantInfo], scheduled: &ars_proto::RaceScheduled) -> Option<RaceInfo> {
    let entrants = ars_infra::convert::entrants_from_proto(entrants).ok()?;
    Some(RaceInfo {
        species: scheduled.species.clone(),
        venue_id: scheduled.venue_id.clone(),
        venue_version: scheduled.venue_version,
        laps: scheduled.laps,
        engine_version: scheduled.engine_version.clone(),
        entrants,
    })
}

fn age_ms(envelope: &Envelope) -> i64 {
    match ars_infra::time::parse_rfc3339(&envelope.occurred_at) {
        Some(occurred) => match SystemTime::now().duration_since(occurred) {
            Ok(age) => age.as_millis() as i64,
            Err(_) => 0,
        },
        None => 0,
    }
}

fn handle(app: &Shared, envelope: Envelope) {
    let age = age_ms(&envelope);
    let Some(payload) = envelope.payload else { return };
    let Ok(mut registry) = app.registry.lock() else { return };
    match payload {
        Payload::RaceScheduled(scheduled) => {
            if let Some(info) = race_info(&scheduled.entrants, &scheduled) {
                let entry = registry.races.entry(scheduled.race_id).or_default();
                entry.info = Some(info);
                entry.prepared = None;
            } else {
                log::warn(format!("race {}: RaceScheduled with invalid entrants", scheduled.race_id));
            }
        }
        Payload::RaceFinished(finished) => registry.drop_race(finished.race_id),
        Payload::RaceCancelled(cancelled) => registry.drop_race(cancelled.race_id),
        Payload::MarketOpened(opened) => {
            let params = serde_json::to_value(&opened.params).unwrap_or_default();
            match MarketKind::from_json(&opened.r#type, &params) {
                Ok(kind) => {
                    let previous = registry.markets.get(&opened.market_id).map(|market| market.price_version).unwrap_or(0);
                    registry.markets.insert(
                        opened.market_id,
                        Market {
                            market_id: opened.market_id,
                            race_id: opened.race_id,
                            kind,
                            status: MarketStatus::Open,
                            selections: opened
                                .selections
                                .iter()
                                .map(|selection| (selection.selection_id, selection.entrant_id.clone()))
                                .collect(),
                            price_version: opened.price_version.max(previous),
                        },
                    );
                    registry.races.entry(opened.race_id).or_default();
                }
                Err(err) => log::warn(format!("market {}: {err}", opened.market_id)),
            }
        }
        Payload::PriceUpdated(updated) => {
            if let Some(market) = registry.markets.get_mut(&updated.market_id) {
                market.price_version = market.price_version.max(updated.price_version);
            }
        }
        Payload::MarketSuspended(suspended) => {
            if let Some(market) = registry.markets.get_mut(&suspended.market_id) {
                market.status = MarketStatus::Suspended;
            }
        }
        Payload::MarketResumed(resumed) => {
            if let Some(market) = registry.markets.get_mut(&resumed.market_id) {
                market.status = MarketStatus::Open;
                market.price_version = market.price_version.max(resumed.price_version);
            }
        }
        Payload::MarketClosed(closed) => {
            registry.markets.remove(&closed.market_id);
        }
        Payload::MarketResulted(resulted) => {
            registry.markets.remove(&resulted.market_id);
        }
        Payload::MarketVoided(voided) => {
            registry.markets.remove(&voided.market_id);
        }
        Payload::LapCompleted(lap) => {
            if let Some(entry) = registry.races.get_mut(&lap.race_id) {
                entry.live.record_lap(lap.lap, &lap.leader_entrant_id);
            }
        }
        Payload::RaceTick(tick) => {
            let race_id = tick.race_id;
            let should_price = apply_tick(&mut registry, &tick) && age <= app.settings.stale_ms;
            let has_markets = registry.markets.values().any(|market| market.race_id == race_id && market.kind != MarketKind::Tricast);
            drop(registry);
            if should_price && has_markets {
                crate::live::request(app, race_id);
            }
        }
        _ => {}
    }
}

fn apply_tick(registry: &mut crate::registry::Registry, tick: &RaceTick) -> bool {
    let entry = registry.races.entry(tick.race_id).or_default();
    if entry.live.tick.is_some_and(|known| known >= tick.tick) {
        return false;
    }
    let mut significant = false;
    for event in &tick.events {
        match event.r#type.as_str() {
            "LAP" => {
                if let (Some(lap), Some(id)) = (event.lap, &event.id) {
                    entry.live.record_lap(lap, id);
                }
                significant = true;
            }
            "FALSE_START" => {
                if let Some(id) = &event.id {
                    entry.live.false_starters.insert(id.clone());
                }
                significant = true;
            }
            "STUMBLE" | "REFUSED_TO_RUN" | "PULLED_UP" | "PHOTO_FINISH" => significant = true,
            _ => {}
        }
    }
    entry.live.tick = Some(tick.tick);
    entry.live.entrants = tick
        .entrants
        .iter()
        .map(|entrant| RevealedEntrant {
            id: entrant.id.clone(),
            dist: entrant.dist,
            lane: entrant.lane,
            speed: entrant.speed,
            stamina_pct: entrant.stamina_pct,
            state: EntrantState::parse(&entrant.state).unwrap_or(EntrantState::Running),
            pos: entrant.pos,
            false_start: false,
        })
        .collect();
    (tick.tick.is_multiple_of(2) || significant) && !entry.live.finished()
}
