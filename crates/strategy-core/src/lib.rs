//! strategy-core
//!
//! Shared types, DEX pricing math and cyclic-arbitrage graph search used by
//! both the backtest engine and the live opportunity workers.
//!
//! Three layers:
//! - [`types`] — canonical `Opportunity`, `Quote`, `ExecutionPlan`, ... mirroring
//!   the TypeScript `StrategyModel` interface (`docs/model-interface.md`).
//! - [`dex`]   — AMM math: V2 constant product, V3 tick liquidity, Curve
//!   StableSwap, Balancer weighted pools.
//! - [`graph`] — negative-log-weight graph with a modified Bellman-Ford that
//!   detects positive-return cycles (cyclic arbitrage).
#![deny(unsafe_code)]
// Many helpers under dex/ are retained for the future exact-tick / fixed-point
// implementations; allow dead code there during MVP.
#![allow(dead_code, clippy::too_many_arguments, clippy::needless_range_loop)]

pub mod dex;
pub mod graph;
pub mod types;
pub mod uint_ext;

pub use types::*;
