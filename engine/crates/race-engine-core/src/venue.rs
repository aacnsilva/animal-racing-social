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
                let radius = spec.radius.ok_or_else(|| EngineError::InvalidVenue("curve without radius".into()))?;
                let angle = spec.angle.ok_or_else(|| EngineError::InvalidVenue("curve without angle".into()))?;
                if radius <= 0.0 || angle <= 0.0 {
                    return Err(EngineError::InvalidVenue("curve radius/angle must be positive".into()));
                }
                Ok(radius * angle * core::f64::consts::PI / 180.0)
            }
            "STRAIGHT" | "UPHILL" | "DOWNHILL" => {
                let length = spec.length.ok_or_else(|| EngineError::InvalidVenue(format!("{} without length", spec.kind)))?;
                if length <= 0.0 {
                    return Err(EngineError::InvalidVenue("segment length must be positive".into()));
                }
                Ok(length)
            }
            other => Err(EngineError::InvalidVenue(format!("unknown segment type {other}"))),
        }
    }

    pub fn validate(&self) -> Result<(), EngineError> {
        if self.segments.is_empty() {
            return Err(EngineError::InvalidVenue("no segments".into()));
        }
        if !(self.lap_length.is_finite() && self.lap_length > 0.0) {
            return Err(EngineError::InvalidVenue("lapLength must be positive".into()));
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
    pub radius: f64,
    pub speed_factor: f64,
    pub speed_cap: f64,
    pub drain_factor: f64,
    pub stumble_factor: f64,
}

#[derive(Debug, Clone)]
pub(crate) struct Track {
    pub lap_length: f64,
    pub laps: u32,
    pub length: f64,
    pub segments: Vec<TrackSegment>,
    pub average_drain_factor: f64,
    pub surface_affinity: f64,
}

impl Track {
    pub fn build(venue: &Venue, laps: u32, species: &SpeciesParams, params: &EngineParams) -> Result<Track, EngineError> {
        venue.validate()?;
        let surface_grip = params
            .surfaces
            .get(&venue.surface)
            .ok_or_else(|| EngineError::InvalidVenue(format!("unknown surface {}", venue.surface)))?
            .grip;
        let surface_affinity = *species
            .surface_affinity
            .get(&venue.surface)
            .ok_or_else(|| EngineError::InvalidVenue(format!("no surface affinity for {}", venue.surface)))?;
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
        let mut position = 0.0;
        let mut weighted_drain = 0.0;
        for (index, spec) in venue.segments.iter().enumerate() {
            let length = raw_lengths[index] * scale;
            position += length;
            let grade = spec.grade.unwrap_or(0.0).abs();
            let radius = spec.radius.unwrap_or(0.0);
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
                radius: if matches!(kind, SegmentKind::Curve | SegmentKind::TightCurve) { radius } else { 0.0 },
                speed_factor: surface_affinity * affinity * grade_speed,
                speed_cap,
                drain_factor,
                stumble_factor: surface_stumble * species.segment_stumble[kind.key()],
            });
        }
        if let Some(last) = segments.last_mut() {
            last.end = venue.lap_length;
        }
        Ok(Track {
            lap_length: venue.lap_length,
            laps,
            length: venue.lap_length * laps as f64,
            segments,
            average_drain_factor: weighted_drain / venue.lap_length,
            surface_affinity,
        })
    }

    #[inline]
    pub fn segment_end(&self, lap: u32, index: usize) -> f64 {
        lap as f64 * self.lap_length + self.segments[index].end
    }

    pub fn locate(&self, dist: f64) -> (u32, usize) {
        let lap = libm::floor(dist / self.lap_length).max(0.0) as u32;
        let mut index = 0;
        while index + 1 < self.segments.len() && dist >= self.segment_end(lap, index) {
            index += 1;
        }
        (lap, index)
    }

    #[inline]
    pub fn advance_cursor(&self, lap: &mut u32, index: &mut usize, end: &mut f64, dist: f64) {
        while dist >= *end {
            *index += 1;
            if *index == self.segments.len() {
                *index = 0;
                *lap += 1;
            }
            *end = self.segment_end(*lap, *index);
        }
    }

    #[inline]
    pub fn segment_ahead(&self, lap: u32, index: usize, end: f64, dist: f64) -> &TrackSegment {
        if dist < end {
            return &self.segments[index];
        }
        let (mut lap, mut index, mut end) = (lap, index, end);
        self.advance_cursor(&mut lap, &mut index, &mut end, dist);
        &self.segments[index]
    }
}

pub fn parse_venues(text: &str) -> Result<Vec<Venue>, EngineError> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|err| EngineError::InvalidVenue(format!("not valid JSON: {err}")))?;
    let list = match value {
        serde_json::Value::Array(items) => items,
        object @ serde_json::Value::Object(_) => vec![object],
        _ => return Err(EngineError::InvalidVenue("expected an array or an object".into())),
    };
    list.into_iter()
        .map(|item| serde_json::from_value::<Venue>(item).map_err(|err| EngineError::InvalidVenue(err.to_string())))
        .collect()
}
