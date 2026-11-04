use crate::rng::{SharedStream, fast_rng};
use crate::sim::{Phase, PreparedRace, Sim};

const PILOT_CHUNKS: u64 = 8;
const PILOT_RUNS_PER_CHUNK: u32 = 64;
const MIN_SAMPLES: f64 = 32.0;
const PILOT_SEED: [u8; 32] = *b"ars-race-engine-hidden-pilot-crn";
const HIDDEN: usize = 3;
const OBSERVED: usize = 3;
const VARS: usize = HIDDEN + OBSERVED;

pub(crate) type Posterior = [(f64, f64); HIDDEN];

pub(crate) const PRIOR: Posterior = [(0.0, 1.0); HIDDEN];

#[derive(Debug, Clone, Copy)]
struct Moments {
    n: f64,
    sum: [f64; VARS],
    cross: [[f64; VARS]; VARS],
}

impl Default for Moments {
    fn default() -> Moments {
        Moments {
            n: 0.0,
            sum: [0.0; VARS],
            cross: [[0.0; VARS]; VARS],
        }
    }
}

impl Moments {
    fn add(&mut self, values: &[f64; VARS]) {
        self.n += 1.0;
        for (row, value) in values.iter().enumerate() {
            self.sum[row] += value;
            for (column, other) in values.iter().enumerate() {
                self.cross[row][column] += value * other;
            }
        }
    }

    fn merge(&mut self, other: &Moments) {
        self.n += other.n;
        for row in 0..VARS {
            self.sum[row] += other.sum[row];
            for column in 0..VARS {
                self.cross[row][column] += other.cross[row][column];
            }
        }
    }

    fn fit(&self) -> Option<Fit> {
        if self.n < MIN_SAMPLES {
            return None;
        }
        let mean: [f64; VARS] = std::array::from_fn(|index| self.sum[index] / self.n);
        let cov =
            |row: usize, column: usize| self.cross[row][column] / self.n - mean[row] * mean[column];
        let mut observed = [[0.0; OBSERVED]; OBSERVED];
        for (row, line) in observed.iter_mut().enumerate() {
            for (column, cell) in line.iter_mut().enumerate() {
                *cell = cov(HIDDEN + row, HIDDEN + column);
            }
            line[row] += 1e-9;
        }
        let mut weights = [[0.0; OBSERVED]; HIDDEN];
        let mut sd = [1.0; HIDDEN];
        for hidden in 0..HIDDEN {
            let variance = cov(hidden, hidden);
            if variance <= 1e-9 {
                sd[hidden] = 0.0;
                continue;
            }
            let target: [f64; OBSERVED] =
                std::array::from_fn(|column| cov(hidden, HIDDEN + column));
            let solved = solve(observed, target)?;
            let explained: f64 = solved.iter().zip(&target).map(|(w, c)| w * c).sum();
            weights[hidden] = solved;
            sd[hidden] = libm::sqrt((variance - explained).max(0.0));
        }
        Some(Fit { mean, weights, sd })
    }
}

fn solve(
    mut matrix: [[f64; OBSERVED]; OBSERVED],
    mut rhs: [f64; OBSERVED],
) -> Option<[f64; OBSERVED]> {
    for pivot in 0..OBSERVED {
        let best = (pivot..OBSERVED)
            .max_by(|a, b| matrix[*a][pivot].abs().total_cmp(&matrix[*b][pivot].abs()))?;
        if matrix[best][pivot].abs() < 1e-12 {
            return None;
        }
        matrix.swap(pivot, best);
        rhs.swap(pivot, best);
        let (upper, lower) = matrix.split_at_mut(pivot + 1);
        let lead = upper[pivot];
        for (offset, line) in lower.iter_mut().enumerate() {
            let factor = line[pivot] / lead[pivot];
            for (cell, top) in line.iter_mut().zip(lead).skip(pivot) {
                *cell -= factor * top;
            }
            rhs[pivot + 1 + offset] -= factor * rhs[pivot];
        }
    }
    let mut out = [0.0; OBSERVED];
    for row in (0..OBSERVED).rev() {
        let tail: f64 = (row + 1..OBSERVED)
            .map(|column| matrix[row][column] * out[column])
            .sum();
        out[row] = (rhs[row] - tail) / matrix[row][row];
    }
    out.iter().all(|value| value.is_finite()).then_some(out)
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Fit {
    mean: [f64; VARS],
    weights: [[f64; OBSERVED]; HIDDEN],
    sd: [f64; HIDDEN],
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct HiddenModel {
    entrants: usize,
    fits: Vec<Option<Fit>>,
}

fn standardise(value: f64, centre: f64, scale: f64) -> f64 {
    if scale > 0.0 {
        (value - centre) / scale
    } else {
        0.0
    }
}

impl HiddenModel {
    pub fn build(race: &PreparedRace) -> HiddenModel {
        let entrants = race.entrants.len();
        let pacing_sd = race.noise.pacing_error_sd;
        let chunks: Vec<Vec<Moments>> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..PILOT_CHUNKS)
                .map(|chunk| {
                    scope.spawn(move || {
                        let mut rng = fast_rng(PILOT_SEED);
                        rng.set_stream(chunk);
                        let mut moments: Vec<Moments> = Vec::new();
                        for _ in 0..PILOT_RUNS_PER_CHUNK {
                            let mut streams = SharedStream::new(&mut rng);
                            let mut sim = Sim::new(race, false);
                            sim.start(&mut streams);
                            while !sim.is_done() {
                                sim.step(&mut streams);
                                let base = sim.tick as usize * entrants;
                                if moments.len() < base + entrants {
                                    moments.resize(base + entrants, Moments::default());
                                }
                                for (index, runner) in sim.runners.iter().enumerate() {
                                    if runner.phase != Phase::Running {
                                        continue;
                                    }
                                    let entrant = &race.entrants[index];
                                    moments[base + index].add(&[
                                        standardise(runner.form, 1.0, entrant.form_sd),
                                        standardise(runner.pace, 0.0, entrant.pace_sd),
                                        standardise(runner.pacing_error, 1.0, pacing_sd),
                                        runner.dist,
                                        runner.speed,
                                        runner.stamina,
                                    ]);
                                }
                            }
                        }
                        moments
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap_or_default())
                .collect()
        });
        let mut total: Vec<Moments> = Vec::new();
        for chunk in &chunks {
            if total.len() < chunk.len() {
                total.resize(chunk.len(), Moments::default());
            }
            for (sum, part) in total.iter_mut().zip(chunk) {
                sum.merge(part);
            }
        }
        HiddenModel {
            entrants,
            fits: total.iter().map(Moments::fit).collect(),
        }
    }

    pub fn posterior(&self, index: usize, tick: u32, observed: [f64; OBSERVED]) -> Posterior {
        let slot = usize::try_from(tick)
            .ok()
            .and_then(|tick| tick.checked_mul(self.entrants))
            .and_then(|base| base.checked_add(index));
        let Some(fit) = slot.and_then(|slot| self.fits.get(slot)).copied().flatten() else {
            return PRIOR;
        };
        std::array::from_fn(|hidden| {
            let shift: f64 = (0..OBSERVED)
                .map(|column| {
                    fit.weights[hidden][column] * (observed[column] - fit.mean[HIDDEN + column])
                })
                .sum();
            (fit.mean[hidden] + shift, fit.sd[hidden])
        })
    }
}
