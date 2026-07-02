//! Block-level state replay.
//!
//! In production this pulls historical pool state from an archive RPC and the
//! ClickHouse pool_states table. For unit-testable, deterministic behavior we
//! expose a [`StateSource`] trait with two impls:
//! - [`StaticStateSource`] — in-memory, great for tests.
//! - [`RpcStateSource`] — fetches reserves/liquidity at a given block.
//!
//! The backtest driver walks blocks in order and hands each block's
//! [`MarketContext`] + state to the model's discover/quote/simulate.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use strategy_core::dex::PoolLiveState;
use strategy_core::types::{Address, MarketContext, PoolRef};

/// Source of pool live state at a given block.
pub trait StateSource: Send + Sync {
    fn state_at(&self, chain_id: u32, pool: &Address, block: u64) -> Result<PoolLiveState>;
}

/// In-memory state source keyed by (chain_id, pool, block).
#[derive(Debug, Clone, Default)]
pub struct StaticStateSource {
    pub states: HashMap<(u32, Address, u64), PoolLiveState>,
}

impl StaticStateSource {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn insert(&mut self, chain_id: u32, pool: Address, block: u64, state: PoolLiveState) {
        self.states.insert((chain_id, pool, block), state);
    }
}

impl StateSource for StaticStateSource {
    fn state_at(&self, chain_id: u32, pool: &Address, block: u64) -> Result<PoolLiveState> {
        self.states
            .get(&(chain_id, pool.clone(), block))
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("no state for chain {} pool {} block {}", chain_id, pool, block))
    }
}

/// A backtest's input configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestConfig {
    pub strategy_id: String,
    pub chain_id: u32,
    pub asset: Address,
    pub start_block: u64,
    pub end_block: u64,
    pub capital: String, // decimal string of base units
    pub cost_model: CostModelParams,
    pub params: serde_json::Value,
}

/// Cost-model parameters (see [`crate::cost_model`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostModelParams {
    /// Gas price stress multiplier (0.0 = none, 1.0 = +100%).
    #[serde(default)]
    pub gas_stress_pct: f64,
    /// Bribe stress multiplier.
    #[serde(default)]
    pub bribe_stress_pct: f64,
    /// Probability (0..1) a valid bundle gets included in a block.
    #[serde(default = "default_inclusion")]
    pub inclusion_rate: f64,
}

fn default_inclusion() -> f64 {
    0.7
}

impl Default for CostModelParams {
    fn default() -> Self {
        Self {
            gas_stress_pct: 0.0,
            bribe_stress_pct: 0.0,
            inclusion_rate: 0.7,
        }
    }
}

/// Build a per-block [`MarketContext`] for the given whitelisted pools.
pub fn build_market_context(chain_id: u32, block: u64, ts: u64, assets: Vec<Address>, pools: Vec<PoolRef>) -> MarketContext {
    MarketContext {
        chain_id,
        block_number: block,
        block_timestamp: ts,
        assets,
        pools,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use strategy_core::uint_ext::Uint;

    #[test]
    fn static_source_round_trip() {
        let mut s = StaticStateSource::new();
        let st = PoolLiveState::v2(Uint::from(100u64), Uint::from(100u64));
        s.insert(1, "0xp".into(), 10, st.clone());
        let got = s.state_at(1, &"0xp".into(), 10).unwrap();
        assert_eq!(got, st);
        assert!(s.state_at(1, &"0xp".into(), 11).is_err());
    }
}
