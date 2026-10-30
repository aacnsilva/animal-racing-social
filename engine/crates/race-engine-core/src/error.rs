use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum EngineError {
    InvalidParams(String),
    InvalidVenue(String),
    InvalidInputs(String),
    InvalidScript(String),
}

impl fmt::Display for EngineError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineError::InvalidParams(detail) => write!(formatter, "invalid engine params: {detail}"),
            EngineError::InvalidVenue(detail) => write!(formatter, "invalid venue: {detail}"),
            EngineError::InvalidInputs(detail) => write!(formatter, "invalid race inputs: {detail}"),
            EngineError::InvalidScript(detail) => write!(formatter, "invalid script: {detail}"),
        }
    }
}

impl std::error::Error for EngineError {}
