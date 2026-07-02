//! backtest-engine
//!
//! Block-level replay, revm/Anvil simulation and anti-overfit backtesting for
//! arbitrage strategies. Driven by `strategy-core` math + types.
#![deny(unsafe_code)]
#![allow(dead_code)]

pub mod cost_model;
pub mod metrics;
pub mod replayer;
pub mod simulator;
pub mod walk_forward;

pub use cost_model::*;
pub use metrics::*;
pub use replayer::*;
pub use simulator::*;
pub use walk_forward::*;
