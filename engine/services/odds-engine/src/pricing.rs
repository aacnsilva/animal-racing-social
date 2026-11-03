use race_engine_core::ProbabilityTable;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarketKind {
    FinishPosition(u32),
    TopN(u32),
    Tricast,
    LeaderAtLap(u32),
}

impl MarketKind {
    pub fn parse(kind: &str, param: impl Fn(&str) -> Option<i64>) -> Result<MarketKind, String> {
        let positive = |name: &str| -> Result<u32, String> {
            param(name)
                .filter(|value| *value >= 1)
                .and_then(|value| u32::try_from(value).ok())
                .ok_or_else(|| format!("{kind} requires a positive params.{name}"))
        };
        match kind {
            "FINISH_POSITION" => Ok(MarketKind::FinishPosition(positive("position")?)),
            "TOP_N" => Ok(MarketKind::TopN(positive("n")?)),
            "TRICAST" => Ok(MarketKind::Tricast),
            "LEADER_AT_LAP" => Ok(MarketKind::LeaderAtLap(positive("lap")?)),
            other => Err(format!("unknown market type {other}")),
        }
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "numeric params saturate to i64 before range validation"
    )]
    pub fn from_json(kind: &str, params: &serde_json::Value) -> Result<MarketKind, String> {
        MarketKind::parse(kind, |name| match &params[name] {
            serde_json::Value::Number(number) => number.as_f64().map(|value| value as i64),
            serde_json::Value::String(text) => text.trim().parse().ok(),
            _ => None,
        })
    }

    pub fn probability(self, table: &ProbabilityTable, entrant: usize) -> f64 {
        match self {
            MarketKind::FinishPosition(position) => table.finish_position(entrant, position),
            MarketKind::TopN(n) => table.top_n(entrant, n),
            MarketKind::Tricast => table.win(entrant),
            MarketKind::LeaderAtLap(lap) => table.leader_at_lap(entrant, lap),
        }
    }
}

pub fn floor_probability(probability: f64, runs: u32) -> f64 {
    probability.max(0.5 / f64::from(runs.max(1))).min(1.0)
}

pub fn price(probability: f64, margin: f64) -> f64 {
    let raw = 1.0 / (probability * (1.0 + margin));
    let rounded = (raw * 100.0).round() / 100.0;
    rounded.clamp(1.01, 1000.0)
}

pub fn round_probability(probability: f64) -> f64 {
    (probability * 1_000_000.0).round() / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn price_formula_matches_contract() {
        assert_eq!(price(0.5, 0.05).to_bits(), 1.9_f64.to_bits());
        assert_eq!(price(0.25, 0.05).to_bits(), 3.81_f64.to_bits());
        assert_eq!(price(0.99, 0.05).to_bits(), 1.01_f64.to_bits());
        assert_eq!(price(0.00001, 0.05).to_bits(), 1000.0_f64.to_bits());
        assert_eq!(
            floor_probability(0.0, 2000).to_bits(),
            0.00025_f64.to_bits()
        );
        assert_eq!(floor_probability(0.3, 2000).to_bits(), 0.3_f64.to_bits());
    }

    #[test]
    fn market_kinds_parse() {
        let params = serde_json::json!({ "position": 2 });
        assert_eq!(
            MarketKind::from_json("FINISH_POSITION", &params),
            Ok(MarketKind::FinishPosition(2))
        );
        assert_eq!(
            MarketKind::from_json("TOP_N", &serde_json::json!({ "n": "3" })),
            Ok(MarketKind::TopN(3))
        );
        assert_eq!(
            MarketKind::from_json("TRICAST", &serde_json::json!({})),
            Ok(MarketKind::Tricast)
        );
        assert!(MarketKind::from_json("LEADER_AT_LAP", &serde_json::json!({})).is_err());
    }
}
