pub mod ars {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/ars.v1.rs"));
    }
}

pub use ars::v1::*;
