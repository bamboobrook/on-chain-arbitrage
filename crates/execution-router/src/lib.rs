//! execution-router
//!
//! Transaction construction, nonce/gas management and private-relay
//! multiplexing. Consumes approved [`strategy_core::ExecutionPlan`]s and
//! submits them (privately) to EVM chains.
#![deny(unsafe_code)]

pub mod gas_oracle;
pub mod lifecycle;
pub mod nonce_tracker;
pub mod relays;
pub mod tx_builder;

pub use gas_oracle::*;
pub use lifecycle::*;
pub use nonce_tracker::*;
pub use relays::*;
pub use tx_builder::*;
