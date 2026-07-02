//! Block-level state replay.
//!
//! Two state sources:
//! - [`StaticStateSource`] — in-memory, for tests.
//! - [`RpcStateSource`] — fetches Uniswap V3 pool `slot0` + `liquidity` at a
//!   given block from an archive RPC via alloy. This is the real backtest
//!   data path; the driver walks blocks and queries state at each.

use anyhow::{Context, Result};
use alloy::primitives::{address, Address as AlloyAddress, Bytes};
use alloy::providers::{Provider, ProviderBuilder, RootProvider};
use alloy::rpc::types::BlockId;
use alloy::transports::http::{Client as HttpClient, Http};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use strategy_core::dex::PoolLiveState;
use strategy_core::types::{Address, MarketContext, PoolRef};
use strategy_core::uint_ext::Uint;

/// Concrete provider type returned by `on_http`.
type HttpProvider = RootProvider<Http<HttpClient>>;

/// Source of pool live state at a given block.
#[async_trait::async_trait]
pub trait StateSource: Send + Sync {
    async fn state_at(&self, chain_id: u32, pool: &Address, block: u64) -> Result<PoolLiveState>;
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

#[async_trait::async_trait]
impl StateSource for StaticStateSource {
    async fn state_at(&self, chain_id: u32, pool: &Address, block: u64) -> Result<PoolLiveState> {
        self.states
            .get(&(chain_id, pool.clone(), block))
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("no state for chain {} pool {} block {}", chain_id, pool, block))
    }
}

/// RPC-backed state source. Reads Uniswap V3 `slot0()` and `liquidity()` at a
/// given historical block. Requires an archive RPC endpoint.
pub struct RpcStateSource {
    provider: HttpProvider,
}

impl RpcStateSource {
    pub fn new(rpc_url: &str) -> Self {
        let provider = ProviderBuilder::new().on_http(rpc_url.parse().expect("valid rpc url"));
        Self { provider }
    }

    /// Read a Uniswap V3 pool's slot0 + liquidity at `block`.
    /// Returns (sqrtPriceX96, tick, liquidity).
    pub async fn v3_state_at(&self, pool: &str, block: u64) -> Result<(Uint, i32, Uint)> {
        let pool_addr: AlloyAddress = pool
            .parse()
            .map_err(|e| anyhow::anyhow!("bad pool address {}: {}", pool, e))?;
        let block_id = BlockId::from(block);

        // slot0() selector = 0x3850c7bd
        let slot0_tx = alloy::rpc::types::TransactionRequest::default()
            .to(pool_addr)
            .input(Bytes::from(vec![0x38, 0x50, 0xc7, 0xbd]).into());
        let slot0: Bytes = self
            .provider
            .call(&slot0_tx)
            .block(block_id)
            .await
            .with_context(|| format!("slot0 call failed for {} @ {}", pool, block))?;
        let bytes = slot0.as_ref();
        if bytes.len() < 64 {
            anyhow::bail!("slot0 returned too short: {} bytes", bytes.len());
        }
        let sqrt_p = Uint::from_be_slice(&bytes[12..32]);
        // tick is int24, right-aligned in the second 32-byte word (bytes 32..64).
        // The 3-byte value occupies bytes 61..64 (the low 3 bytes of word 2).
        let tick = ((bytes[61] as i32) << 16) | ((bytes[62] as i32) << 8) | (bytes[63] as i32);
        // sign-extend the 24-bit value (bit 23 is the sign bit)
        let tick = if tick & 0x800000 != 0 { tick | !0xFF_FFFF } else { tick };

        // liquidity() selector = 0x1a686502
        let liq_tx = alloy::rpc::types::TransactionRequest::default()
            .to(pool_addr)
            .input(Bytes::from(vec![0x1a, 0x68, 0x65, 0x02]).into());
        let liq: Bytes = self
            .provider
            .call(&liq_tx)
            .block(block_id)
            .await
            .context("liquidity call failed")?;
        let lbytes = liq.as_ref();
        let liquidity = if lbytes.len() >= 32 {
            Uint::from_be_slice(&lbytes[16..32])
        } else {
            Uint::ZERO
        };

        Ok((sqrt_p, tick, liquidity))
    }
}

#[async_trait::async_trait]
impl StateSource for RpcStateSource {
    async fn state_at(&self, _chain_id: u32, pool: &Address, block: u64) -> Result<PoolLiveState> {
        let (sqrt_p, tick, liq) = self.v3_state_at(pool, block).await?;
        Ok(PoolLiveState::v3(sqrt_p, tick, liq))
    }
}

// Silence unused import warning for the address! macro (kept for future pool constants).
#[allow(dead_code)]
fn _addr_anchor() -> AlloyAddress {
    address!("0000000000000000000000000000000000000000")
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
    #[serde(default)]
    pub gas_stress_pct: f64,
    #[serde(default)]
    pub bribe_stress_pct: f64,
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
pub fn build_market_context(
    chain_id: u32,
    block: u64,
    ts: u64,
    assets: Vec<Address>,
    pools: Vec<PoolRef>,
) -> MarketContext {
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

    #[tokio::test]
    async fn static_source_round_trip() {
        let mut s = StaticStateSource::new();
        let st = PoolLiveState::v2(Uint::from(100u64), Uint::from(100u64));
        s.insert(1, "0xp".into(), 10, st.clone());
        let got = s.state_at(1, &"0xp".into(), 10).await.unwrap();
        assert_eq!(got, st);
        assert!(s.state_at(1, &"0xp".into(), 11).await.is_err());
    }
}
