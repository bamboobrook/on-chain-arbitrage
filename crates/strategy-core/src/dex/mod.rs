//! DEX pricing math.
//!
//! Each submodule implements a pure function that, given the pool's state and
//! an input amount, returns the output amount (and optionally the state after
//! the swap for chained quotes). No I/O here — callers fetch/simulate state.
//!
//! - [`v2`] constant product (Uniswap V2 family)
//! - [`v3`] concentrated liquidity / ticks (Uniswap V3)
//! - [`curve`] StableSwap (Curve)
//! - [`balancer`] weighted pools (Balancer)

pub mod balancer;
pub mod curve;
pub mod v2;
pub mod v3;

use crate::types::{PoolKind, PoolRef};
use crate::uint_ext::{Amount, Uint};

/// Generic quote result for a single hop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HopQuote {
    pub amount_out: Amount,
    /// New reserves/state after this swap (for chained simulation).
    pub state_after: PoolStateAfter,
}

/// Minimal post-swap state. For V2 we record new reserves; for V3 we record
/// the new tick + remaining liquidity cursor (consumed by the V3 stepper).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PoolStateAfter {
    V2 {
        reserve_in: Amount,
        reserve_out: Amount,
    },
    V3 {
        sqrt_price_x96: Amount,
        tick: i32,
        liquidity: Amount,
    },
    Stable {
        balances_scaled: [Amount; 2],
    },
    Weighted {
        balances_scaled: [Amount; 2],
    },
}

/// Dispatch a single-hop quote to the right math given the pool kind.
pub fn quote_hop(pool: &PoolRef, state: &PoolLiveState, amount_in: Amount) -> Option<HopQuote> {
    match pool.kind {
        PoolKind::V2 => v2::quote(state, amount_in, pool.fee_bps),
        PoolKind::V3 => v3::quote(state, amount_in, pool.fee_bps),
        PoolKind::Stable => curve::quote(state, amount_in, pool.fee_bps),
        PoolKind::Weighted => balancer::quote(state, amount_in, pool.fee_bps),
    }
}

/// The live state a pool needs for quoting. Only the relevant fields per kind
/// are populated; others are ignored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoolLiveState {
    pub kind: PoolKind,
    // V2 / Weighted / Stable:
    pub reserve0: Amount,
    pub reserve1: Amount,
    // V3:
    pub sqrt_price_x96: Amount,
    pub tick: i32,
    /// Active liquidity in units of L (X96).
    pub liquidity: Amount,
    /// Snapshot of tick liquidity for V3 stepping (tick -> net liquidity delta).
    /// For a pure quote we approximate with a flat band unless provided.
    pub tick_liquidity: Vec<TickLiquidity>,
    // Stable (Curve): amplification coefficient A (scaled).
    pub amp_coeff: u128,
    // Weighted (Balancer): normalized weights scaled to 1e18.
    pub weight0: Amount,
    pub weight1: Amount,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TickLiquidity {
    pub tick: i32,
    /// Net change in liquidity at this tick (signed magnitude).
    pub liquidity_net: Amount,
}

impl PoolLiveState {
    pub fn v2(reserve0: Amount, reserve1: Amount) -> Self {
        Self {
            kind: PoolKind::V2,
            reserve0,
            reserve1,
            sqrt_price_x96: Uint::ZERO,
            tick: 0,
            liquidity: Uint::ZERO,
            tick_liquidity: vec![],
            amp_coeff: 0,
            weight0: Uint::ZERO,
            weight1: Uint::ZERO,
        }
    }

    pub fn v3(sqrt_price_x96: Amount, tick: i32, liquidity: Amount) -> Self {
        Self {
            kind: PoolKind::V3,
            reserve0: Uint::ZERO,
            reserve1: Uint::ZERO,
            sqrt_price_x96,
            tick,
            liquidity,
            tick_liquidity: vec![],
            amp_coeff: 0,
            weight0: Uint::ZERO,
            weight1: Uint::ZERO,
        }
    }
}

/// Fee multiplier = (10000 - fee_bps) / 10000, applied to amount_in.
pub fn amount_after_fee(amount_in: Amount, fee_bps: u32) -> Amount {
    // amount_in * (10000 - fee_bps) / 10000
    let factor = 10_000u64.saturating_sub(fee_bps as u64);
    (amount_in * Uint::from(factor)) / Uint::from(10_000u64)
}
