use serde::{Deserialize, Serialize};

use crate::error::EngineError;
use crate::params::{EngineParams, SpeciesParams};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Venue {
    pub id: String,
    pub version: u32,
    #[serde(default)]
    pub name: String,
    pub class: String,
    pub surface: String,
    #[serde(default = "default_lanes")]
    pub lanes: u32,
    pub lap_length: f64,
    pub laps_range: [u32; 2],
    pub segments: Vec<SegmentSpec>,
}

fn default_lanes() -> u32 {
    10
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SegmentSpec {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub length: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub radius: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub angle: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grade: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegmentKind {
    Straight,
    Curve,
    TightCurve,
    Uphill,
    Downhill,
}

impl SegmentKind {
    pub fn key(self) -> &'static str {
        match self {
            SegmentKind::Straight => "STRAIGHT",
            SegmentKind::Curve => "CURVE",
            SegmentKind::TightCurve => "TIGHT_CURVE",
            SegmentKind::Uphill => "UPHILL",
            SegmentKind::Downhill => "DOWNHILL",
        }
    }
}

impl Venue {
    pub fn segment_length(spec: &SegmentSpec) -> Result<f64, EngineError> {
        match spec.kind.as_str() {
            "CURVE" => {
                let radius = spec
                    .radius
                    .ok_or_else(|| EngineError::InvalidVenue("curve without radius".into()))?;
                let angle = spec
                    .angle
                    .ok_or_else(|| EngineError::InvalidVenue("curve without angle".into()))?;
                if radius <= 0.0 || angle <= 0.0 {
                    return Err(EngineError::InvalidVenue(
                        "curve radius/angle must be positive".into(),
                    ));
                }
                Ok(radius * angle * core::f64::consts::PI / 180.0)
            }
            "STRAIGHT" | "UPHILL" | "DOWNHILL" => {
                let length = spec.length.ok_or_else(|| {
                    EngineError::InvalidVenue(format!("{} without length", spec.kind))
                })?;
                if length <= 0.0 {
                    return Err(EngineError::InvalidVenue(
                        "segment length must be positive".into(),
                    ));
                }
                Ok(length)
            }
            other => Err(EngineError::InvalidVenue(format!(
                "unknown segment type {other}"
            ))),
        }
    }

    pub fn validate(&self) -> Result<(), EngineError> {
        if self.segments.is_empty() {
            return Err(EngineError::InvalidVenue("no segments".into()));
        }
        if !(self.lap_length.is_finite() && self.lap_length > 0.0) {
            return Err(EngineError::InvalidVenue(
                "lapLength must be positive".into(),
            ));
        }
        if self.lanes == 0 || self.lanes > 20 {
            return Err(EngineError::InvalidVenue("lanes out of range".into()));
        }
        if self.laps_range[0] == 0 || self.laps_range[1] < self.laps_range[0] {
            return Err(EngineError::InvalidVenue("lapsRange invalid".into()));
        }
        for spec in &self.segments {
            Venue::segment_length(spec)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct TrackSegment {
    pub end: f64,
    pub speed_factor: f64,
    pub speed_cap: f64,
    pub drain_factor: f64,
    pub stumble_factor: f64,
}

#[derive(Debug, Clone)]
pub(crate) struct LaneLayout {
    pub ends: Vec<f64>,
    pub lap_length: f64,
    pub start: f64,
}

#[derive(Debug, Clone)]
pub(crate) struct Track {
    pub lap_length: f64,
    pub laps: u32,
    pub length: f64,
    pub segments: Vec<TrackSegment>,
    pub lanes: Vec<LaneLayout>,
    pub average_drain_factor: f64,
    pub surface_affinity: f64,
}

impl Track {
    pub fn build(
        venue: &Venue,
        laps: u32,
        species: &SpeciesParams,
        params: &EngineParams,
    ) -> Result<Track, EngineError> {
        venue.validate()?;
        let surface_grip = params
            .surfaces
            .get(&venue.surface)
            .ok_or_else(|| EngineError::InvalidVenue(format!("unknown surface {}", venue.surface)))?
            .grip;
        let surface_affinity = *species
            .surface_affinity
            .get(&venue.surface)
            .ok_or_else(|| {
                EngineError::InvalidVenue(format!("no surface affinity for {}", venue.surface))
            })?;
        let surface_drain = species.surface_stamina_drain[&venue.surface];
        let surface_stumble = species.surface_stumble[&venue.surface];
        let physics = &params.physics;
        let mut raw_lengths = Vec::with_capacity(venue.segments.len());
        let mut raw_total = 0.0;
        for spec in &venue.segments {
            let length = Venue::segment_length(spec)?;
            raw_lengths.push(length);
            raw_total += length;
        }
        let scale = venue.lap_length / raw_total;
        let mut segments = Vec::with_capacity(venue.segments.len());
        let mut turns = Vec::with_capacity(venue.segments.len());
        let mut position = 0.0;
        let mut weighted_drain = 0.0;
        for (index, spec) in venue.segments.iter().enumerate() {
            let length = raw_lengths[index] * scale;
            position += length;
            let grade = spec.grade.unwrap_or(0.0).abs();
            let radius = spec.radius.unwrap_or(0.0);
            turns.push(if spec.kind == "CURVE" {
                spec.angle.unwrap_or(0.0).to_radians()
            } else {
                0.0
            });
            let kind = match spec.kind.as_str() {
                "CURVE" if radius < physics.tight_curve_radius => SegmentKind::TightCurve,
                "CURVE" => SegmentKind::Curve,
                "UPHILL" => SegmentKind::Uphill,
                "DOWNHILL" => SegmentKind::Downhill,
                _ => SegmentKind::Straight,
            };
            let affinity = species.segment_affinity[kind.key()];
            let (grade_speed, grade_drain) = match kind {
                SegmentKind::Uphill => (
                    1.0 - physics.uphill_speed_loss_per_grade * grade,
                    1.0 + physics.uphill_drain_per_grade * grade,
                ),
                SegmentKind::Downhill => (
                    1.0 + physics.downhill_speed_gain_per_grade * grade,
                    (1.0 - physics.downhill_drain_per_grade * grade).max(0.2),
                ),
                _ => (1.0, 1.0),
            };
            let speed_cap = match kind {
                SegmentKind::Curve | SegmentKind::TightCurve => {
                    libm::sqrt(species.lateral_grip * surface_grip * radius)
                }
                _ => f64::INFINITY,
            };
            let drain_factor = surface_drain * grade_drain;
            weighted_drain += drain_factor * length;
            segments.push(TrackSegment {
                end: position,
                speed_factor: surface_affinity * affinity * grade_speed,
                speed_cap,
                drain_factor,
                stumble_factor: surface_stumble * species.segment_stumble[kind.key()],
            });
        }
        if let Some(last) = segments.last_mut() {
            last.end = venue.lap_length;
        }
        let lanes = LaneLayout::build_all(venue.lanes, laps, physics.lane_width, &segments, &turns);
        Ok(Track {
            lap_length: venue.lap_length,
            laps,
            length: venue.lap_length * f64::from(laps),
            segments,
            lanes,
            average_drain_factor: weighted_drain / venue.lap_length,
            surface_affinity,
        })
    }

    pub fn lane(&self, lane: u32) -> &LaneLayout {
        &self.lanes[lane as usize - 1]
    }
}

impl LaneLayout {
    fn build_all(
        lanes: u32,
        laps: u32,
        lane_width: f64,
        segments: &[TrackSegment],
        turns: &[f64],
    ) -> Vec<LaneLayout> {
        let total_turn: f64 = turns.iter().sum();
        let inner_lap = segments.last().map_or(0.0, |segment| segment.end);
        (0..lanes)
            .map(|lane| {
                let offset = f64::from(lane) * lane_width;
                let mut previous = 0.0;
                let mut lane_end = 0.0;
                let mut ends: Vec<f64> = segments
                    .iter()
                    .zip(turns)
                    .map(|(segment, turn)| {
                        lane_end += segment.end - previous + offset * turn;
                        previous = segment.end;
                        lane_end
                    })
                    .collect();
                let lap_length = inner_lap + offset * total_turn;
                if let Some(last) = ends.last_mut() {
                    *last = lap_length;
                }
                LaneLayout {
                    ends,
                    lap_length,
                    start: f64::from(laps) * offset * total_turn,
                }
            })
            .collect()
    }

    #[inline]
    pub fn segment_end(&self, lap: u32, index: usize) -> f64 {
        f64::from(lap) * self.lap_length + self.ends[index]
    }

    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "lap index is clamped non-negative and bounded by the lap count"
    )]
    pub fn locate(&self, position: f64) -> (u32, usize) {
        let lap = libm::floor(position / self.lap_length).max(0.0) as u32;
        let mut index = 0;
        while index + 1 < self.ends.len() && position >= self.segment_end(lap, index) {
            index += 1;
        }
        (lap, index)
    }

    #[inline]
    pub fn advance_cursor(&self, lap: &mut u32, index: &mut usize, end: &mut f64, position: f64) {
        while position >= *end {
            *index += 1;
            if *index == self.ends.len() {
                *index = 0;
                *lap += 1;
            }
            *end = self.segment_end(*lap, *index);
        }
    }

    #[inline]
    pub fn segment_ahead(&self, lap: u32, index: usize, end: f64, position: f64) -> usize {
        if position < end {
            return index;
        }
        let (mut lap, mut index, mut end) = (lap, index, end);
        self.advance_cursor(&mut lap, &mut index, &mut end, position);
        index
    }
}

pub fn parse_venues(text: &str) -> Result<Vec<Venue>, EngineError> {
    let value: serde_json::Value = serde_json::from_str(text)
        .map_err(|err| EngineError::InvalidVenue(format!("not valid JSON: {err}")))?;
    let list = match value {
        serde_json::Value::Array(items) => items,
        object @ serde_json::Value::Object(_) => vec![object],
        _ => {
            return Err(EngineError::InvalidVenue(
                "expected an array or an object".into(),
            ));
        }
    };
    list.into_iter()
        .map(|item| {
            serde_json::from_value::<Venue>(item)
                .map_err(|err| EngineError::InvalidVenue(err.to_string()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{Track, parse_venues};

    const VENUES_JSON: &str = include_str!("../../../../shared/venues.json");

    #[test]
    fn every_lane_races_the_same_distance_to_a_shared_finish() {
        let loaded = crate::default_params().expect("params");
        let params = &loaded.params;
        let width = params.physics.lane_width;
        for venue in parse_venues(VENUES_JSON).expect("venues") {
            let laps = venue.laps_range[1];
            let species = &params.species["HORSE"];
            let track = Track::build(&venue, laps, species, params).expect("track");
            let inner = track.lane(1);
            assert!(inner.start.abs() < 1e-9);
            assert!((inner.lap_length - track.lap_length).abs() < 1e-9);
            for lane in 1..=venue.lanes {
                let layout = track.lane(lane);
                let offset = f64::from(lane - 1) * width;
                let extra = offset * core::f64::consts::TAU;
                assert!((layout.lap_length - (track.lap_length + extra)).abs() < 1e-6);
                let finish = layout.start + track.length;
                let laps_in_lane = finish / layout.lap_length;
                assert!(
                    (laps_in_lane - f64::from(laps)).abs() < 1e-9,
                    "{} lane {lane} does not finish on the line",
                    venue.id
                );
                assert!(layout.ends.windows(2).all(|pair| pair[1] > pair[0]));
            }
        }
    }
}
