use ars_proto::Envelope;
use ars_proto::envelope::Payload;
use prost::Message;

use crate::Res;

pub fn payload_type(payload: &Payload) -> &'static str {
    match payload {
        Payload::RaceScheduled(_) => "RaceScheduled",
        Payload::RaceOpened(_) => "RaceOpened",
        Payload::RaceLocked(_) => "RaceLocked",
        Payload::RaceStarted(_) => "RaceStarted",
        Payload::ScriptSealed(_) => "ScriptSealed",
        Payload::ScriptFailed(_) => "ScriptFailed",
        Payload::RaceFinished(_) => "RaceFinished",
        Payload::RaceSettled(_) => "RaceSettled",
        Payload::RaceCancelled(_) => "RaceCancelled",
        Payload::GenerateScript(_) => "GenerateScript",
        Payload::ScheduleRace(_) => "ScheduleRace",
        Payload::CancelRace(_) => "CancelRace",
        Payload::MarketCommand(_) => "MarketCommand",
        Payload::RaceTick(_) => "RaceTick",
        Payload::LapCompleted(_) => "LapCompleted",
        Payload::MarketOpened(_) => "MarketOpened",
        Payload::PriceUpdated(_) => "PriceUpdated",
        Payload::MarketSuspended(_) => "MarketSuspended",
        Payload::MarketResumed(_) => "MarketResumed",
        Payload::MarketClosed(_) => "MarketClosed",
        Payload::MarketResulted(_) => "MarketResulted",
        Payload::MarketVoided(_) => "MarketVoided",
        Payload::BetRequested(_) => "BetRequested",
        Payload::ComboRequested(_) => "ComboRequested",
        Payload::CashOutRequested(_) => "CashOutRequested",
        Payload::BetAccepted(_) => "BetAccepted",
        Payload::BetRejected(_) => "BetRejected",
        Payload::LegSettled(_) => "LegSettled",
        Payload::BetSettled(_) => "BetSettled",
        Payload::BetCashedOut(_) => "BetCashedOut",
        Payload::CashOutRejected(_) => "CashOutRejected",
        Payload::LedgerEntryAppended(_) => "LedgerEntryAppended",
        Payload::AnimalRecruited(_) => "AnimalRecruited",
        Payload::AnimalAged(_) => "AnimalAged",
        Payload::AnimalRetired(_) => "AnimalRetired",
        Payload::SeasonStarted(_) => "SeasonStarted",
        Payload::SeasonEnding(_) => "SeasonEnding",
        Payload::SeasonEnded(_) => "SeasonEnded",
        Payload::LeaderboardMoved(_) => "LeaderboardMoved",
        Payload::NotificationCreated(_) => "NotificationCreated",
        Payload::AdminAudit(_) => "AdminAudit",
    }
}

pub fn build(payload: Payload) -> Envelope {
    Envelope {
        event_id: crate::ids::uuid_v4(),
        r#type: payload_type(&payload).to_string(),
        version: 1,
        occurred_at: crate::time::now_rfc3339(),
        payload: Some(payload),
    }
}

pub fn encode(envelope: &Envelope) -> Vec<u8> {
    envelope.encode_to_vec()
}

pub fn decode(bytes: &[u8]) -> Res<Envelope> {
    Envelope::decode(bytes).map_err(|err| format!("invalid envelope: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_round_trips_with_type_name() {
        let payload = Payload::ScriptSealed(ars_proto::ScriptSealed {
            race_id: 123,
            engine_version: "1.0.0".into(),
            seed_hash: "aa".into(),
            script_hash: "bb".into(),
        });
        let envelope = build(payload);
        assert_eq!(envelope.r#type, "ScriptSealed");
        assert_eq!(envelope.version, 1);
        assert!(envelope.occurred_at.ends_with('Z'));
        let decoded = decode(&encode(&envelope)).expect("decode");
        assert_eq!(decoded, envelope);
    }
}
