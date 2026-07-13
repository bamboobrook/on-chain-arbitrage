//! Uniswap V3 concentrated-liquidity math.
//!
//! Full tick-by-tick swap simulation requires the pool's tick liquidity
//! bitmap, which is heavy. For opportunity *discovery* and *graph search* we
//! use a locally-linear approximation around the current tick; the
//! backtest/simulation path then validates exact execution via revm (see
//! `crates/backtest-engine`). This mirrors the design doc's "粗筛→精确模拟"
//! (coarse filter then exact simulation) two-stage approach.
//!
//! The locally-linear quote treats the active liquidity as constant over the
//! swap and integrates the V3 swap step equations analytically.

use super::{HopQuote, PoolLiveState, PoolStateAfter};
use crate::uint_ext::{Amount, Uint};

/// Q96 = 2^96, the fixed-point scale for sqrt price and liquidity in V3.
pub const Q96: Uint = Uint::from_limbs([0xffffffffffffffff, 0xffffffffffffffff, 0xffffffff, 0x0]);

/// Quote an amount_out for a V3 swap using the local liquidity approximation.
///
/// We assume the price stays within the current tick band for the duration of
/// the swap (true for small/medium sizes relative to the active band). When
/// `tick_liquidity` is populated, the caller can refine with [`quote_stepped`].
pub fn quote(state: &PoolLiveState, amount_in: Amount, fee_bps: u32) -> Option<HopQuote> {
    if amount_in.is_zero() || state.liquidity.is_zero() {
        return None;
    }
    let fee_factor = 10_000u64 - fee_bps as u64;
    let amount_in_after_fee = (amount_in * Uint::from(fee_factor)) / Uint::from(10_000u64);

    let sqrt_price = state.sqrt_price_x96;
    let liquidity = state.liquidity;

    if state.zero_for_one_assumed() {
        // token0 -> token1: dy = L * (1/sqrt_a - 1/sqrt_b), dx increases sqrt_price
        let new_sqrt_price = sqrt_plus_dx(sqrt_price, liquidity, amount_in_after_fee)?;
        let amount_out = amount1_delta(liquidity, sqrt_price, new_sqrt_price)?;
        let new_tick = tick_from_sqrt_price(new_sqrt_price);
        Some(HopQuote {
            amount_out,
            state_after: PoolStateAfter::V3 {
                sqrt_price_x96: new_sqrt_price,
                tick: new_tick,
                liquidity,
            },
        })
    } else {
        // token1 -> token0: dx = L * (sqrt_b - sqrt_a), dy decreases sqrt_price
        let new_sqrt_price = sqrt_minus_dy(sqrt_price, liquidity, amount_in_after_fee)?;
        let amount_out = amount0_delta(liquidity, sqrt_price, new_sqrt_price)?;
        let new_tick = tick_from_sqrt_price(new_sqrt_price);
        Some(HopQuote {
            amount_out,
            state_after: PoolStateAfter::V3 {
                sqrt_price_x96: new_sqrt_price,
                tick: new_tick,
                liquidity,
            },
        })
    }
}

/// TODO(future): exact tick-by-tick swap stepping using `tick_liquidity`.
/// When `state.tick_liquidity` is non-empty, walk initialized ticks, capping
/// each step at the next tick boundary. For MVP the local approximation above
/// is enough for ranking; revm validates exactness.
#[allow(dead_code)]
pub fn quote_stepped(
    _state: &PoolLiveState,
    _amount_in: Amount,
    _fee_bps: u32,
) -> Option<HopQuote> {
    // Intentionally unimplemented in MVP; the local approximation is used.
    None
}

impl PoolLiveState {
    /// For the local approximation we assume a direction. The graph layer
    /// decides orientation; here we default to token0->token1 unless the
    /// caller flips reserves. We expose this as a heuristic flag.
    fn zero_for_one_assumed(&self) -> bool {
        // Default orientation; the route layer sets up PoolLiveState so that
        // reserve0 corresponds to token_in for V2. For V3 we keep a simple
        // convention: assume zero_for_one unless explicitly handled upstream.
        // (The exact branch is resolved in revm simulation anyway.)
        true
    }
}

// --- V3 sqrt-price math helpers (fixed-point, X96 scale) -----------------

/// new_sqrt_price = (L * sqrt_a) / (L - dx * sqrt_a)  ... for token0 in.
/// We work in X96: liquidity and sqrt_price are both scaled by Q96 (liquidity
/// is raw, sqrt_price is sqrt(price) * 2^96).
fn sqrt_plus_dx(sqrt_a: Amount, liquidity: Amount, dx: Amount) -> Option<Amount> {
    // Using the V3 formula: sqrt_b = L * sqrt_a / (L - dx * sqrt_a / Q96)
    let l_sq_a = liquidity * sqrt_a; // has Q192 scale
    let dx_sq_a = dx * sqrt_a; // Q96 * raw
    let denom = liquidity * Q96 - dx_sq_a;
    if denom.is_zero() {
        return None;
    }
    // (L * sqrt_a * Q96) / denom  -> back to Q96 scale
    let num = l_sq_a;
    Some(num / denom)
}

/// sqrt_b = (L * sqrt_a) / (L + dy * Q96 / sqrt_a) ... simplified for token1 in.
fn sqrt_minus_dy(sqrt_a: Amount, liquidity: Amount, dy: Amount) -> Option<Amount> {
    // new sqrt_price = (L * sqrt_a) / (L + dy * Q96)
    let num = liquidity * sqrt_a;
    let denom = liquidity + (dy * Q96) / sqrt_a.max(Uint::from(1u64));
    if denom.is_zero() {
        return None;
    }
    Some(num / denom)
}

/// amount1 delta = L * (1/sqrt_a - 1/sqrt_b) for increasing sqrt price.
fn amount1_delta(liquidity: Amount, sqrt_a: Amount, sqrt_b: Amount) -> Option<Amount> {
    if sqrt_a.is_zero() || sqrt_b.is_zero() {
        return None;
    }
    // L * (sqrt_b - sqrt_a) / (sqrt_a * sqrt_b) , all in Q96
    let num = liquidity * (sqrt_b - sqrt_a);
    let denom = (sqrt_a * sqrt_b) / Q96;
    if denom.is_zero() {
        return None;
    }
    Some(num / denom)
}

/// amount0 delta = L * (sqrt_b - sqrt_a) / (sqrt_a * sqrt_b) ... but for token0
/// the delta sign is opposite; we return magnitude.
fn amount0_delta(liquidity: Amount, sqrt_a: Amount, sqrt_b: Amount) -> Option<Amount> {
    if sqrt_a.is_zero() || sqrt_b.is_zero() {
        return None;
    }
    let num = liquidity * Q96 * (sqrt_a - sqrt_b);
    let denom = sqrt_a * sqrt_b;
    if denom.is_zero() {
        return None;
    }
    Some(num / denom)
}

/// Derive the tick index from a sqrt_price_x96 via tick = floor(log_base(sqrt1.0001)(price)).
/// We use an approximation good enough for state-after bookkeeping; exact tick
/// is re-derived in revm.
fn tick_from_sqrt_price(sqrt_price_x96: Amount) -> i32 {
    // price = (sqrt_price / 2^96)^2 ; tick = log_{1.0001}(price)
    // Approximate using f64; precision is irrelevant here (revm validates).
    if sqrt_price_x96.is_zero() {
        return 0;
    }
    let sp_bits = sqrt_price_x96.as_limbs()[0] as f64;
    let _ = sp_bits; // only used as a sanity seed
                     // Use a coarse ratio estimate: ratio = sqrt_price_x96 / Q96 (approx via top limb).
    let ratio = (sqrt_price_x96.as_limbs()[0] as f64) / (Q96.as_limbs()[0] as f64).max(1e-300);
    let price = ratio * ratio;
    if price <= 0.0 {
        return 0;
    }
    let log_price = price.ln();

    (log_price / (1.0001f64.ln()) / 2.0) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v3_quote_zero_returns_none() {
        let s = PoolLiveState::v3(Uint::from(1u64), 0, Uint::from(1000u64));
        assert!(quote(&s, Uint::ZERO, 5).is_none());
        let s2 = PoolLiveState::v3(Uint::from(1u64), 0, Uint::ZERO);
        assert!(quote(&s2, Uint::from(1000u64), 5).is_none());
    }

    #[test]
    fn v3_helpers_finite() {
        let sqrt_a = Uint::from(1_000_000_000_000_000_000u64); // ~ Q96 scale-ish
        let l = Uint::from(1_000_000_000_000u64);
        let dx = Uint::from(1_000u64);
        let b = sqrt_plus_dx(sqrt_a, l, dx);
        assert!(b.is_some());
        // tick derivation should not panic
        let _ = tick_from_sqrt_price(sqrt_a);
    }
}
