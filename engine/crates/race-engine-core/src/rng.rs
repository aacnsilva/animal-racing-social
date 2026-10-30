use rand_chacha::{ChaCha8Rng, ChaCha20Rng};
use rand_core::{Rng, SeedableRng};

pub struct Stream<R: Rng> {
    rng: R,
    spare_normal: Option<f64>,
}

const UNIT_SCALE: f64 = 1.0 / 9_007_199_254_740_992.0;

impl<R: Rng> Stream<R> {
    pub fn new(rng: R) -> Stream<R> {
        Stream { rng, spare_normal: None }
    }

    #[inline]
    pub fn uniform(&mut self) -> f64 {
        (self.rng.next_u64() >> 11) as f64 * UNIT_SCALE
    }

    #[inline]
    pub fn below(&mut self, bound: u32) -> u32 {
        if bound <= 1 {
            return 0;
        }
        (self.rng.next_u64() % bound as u64) as u32
    }

    #[inline]
    pub fn normal(&mut self) -> f64 {
        if let Some(value) = self.spare_normal.take() {
            return value;
        }
        loop {
            let first = 2.0 * self.uniform() - 1.0;
            let second = 2.0 * self.uniform() - 1.0;
            let radius_squared = first * first + second * second;
            if radius_squared > 0.0 && radius_squared < 1.0 {
                let factor = libm::sqrt(-2.0 * libm::log(radius_squared) / radius_squared);
                self.spare_normal = Some(second * factor);
                return first * factor;
            }
        }
    }

    #[inline]
    pub fn exponential(&mut self) -> f64 {
        -libm::log(1.0 - self.uniform())
    }
}

pub(crate) trait Streams {
    type Source: Rng;
    fn entrant(&mut self, index: usize) -> &mut Stream<Self::Source>;
    fn incident(&mut self) -> &mut Stream<Self::Source>;
}

pub(crate) struct SeededStreams {
    incident: Stream<ChaCha20Rng>,
    entrants: Vec<Stream<ChaCha20Rng>>,
}

impl SeededStreams {
    pub fn new(seed: &[u8; 32], entrant_count: usize) -> SeededStreams {
        let mut incident_rng = ChaCha20Rng::from_seed(*seed);
        incident_rng.set_stream(0);
        let entrants = (0..entrant_count)
            .map(|index| {
                let mut rng = ChaCha20Rng::from_seed(*seed);
                rng.set_stream(index as u64 + 1);
                Stream::new(rng)
            })
            .collect();
        SeededStreams { incident: Stream::new(incident_rng), entrants }
    }
}

impl Streams for SeededStreams {
    type Source = ChaCha20Rng;

    #[inline]
    fn entrant(&mut self, index: usize) -> &mut Stream<ChaCha20Rng> {
        &mut self.entrants[index]
    }

    #[inline]
    fn incident(&mut self) -> &mut Stream<ChaCha20Rng> {
        &mut self.incident
    }
}

pub struct SharedStream<R: Rng> {
    stream: Stream<R>,
}

impl<R: Rng> SharedStream<R> {
    pub fn new(rng: R) -> SharedStream<R> {
        SharedStream { stream: Stream::new(rng) }
    }
}

impl<R: Rng> Streams for SharedStream<R> {
    type Source = R;

    #[inline]
    fn entrant(&mut self, _index: usize) -> &mut Stream<R> {
        &mut self.stream
    }

    #[inline]
    fn incident(&mut self) -> &mut Stream<R> {
        &mut self.stream
    }
}

pub fn fast_rng(seed: [u8; 32]) -> ChaCha8Rng {
    ChaCha8Rng::from_seed(seed)
}
