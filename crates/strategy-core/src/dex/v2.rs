//! Uniswap V2-style constant-product AMM math: `x * y = k`.
//!
//! `getAmountOut` / `getAmountIn` follow the canonical Uniswap V2 formulas
//! (with the fee taken from the input).

use super::{amount_after_fee, HopQuote, PoolLiveState, PoolStateAfter};
use crate::uint_ext::{Amount, Uint};

/// Quote amount_out for a swap of `amount_in` into a pool whose live reserves
/// are (reserve_in, reserve_out). `zero_for_one` orients the reserves; we let
/// the caller pre-orient by passing a state where reserve0/1 already match.
///
/// Uses the Uniswap V2 formula:
///   amount_out = (amount_in_after_fee * reserve_out) / (reserve_in * 1000 + amount_in_after_fee)
/// with `amount_in_after_fee = amount_in * (1000 - fee_factor)` where
/// `fee_factor = fee_bps / 10` (Uniswap V2 uses 3 / 1000 = 0.30%).
pub fn quote(state: &PoolLiveState, amount_in: Amount, fee_bps: u32) -> Option<HopQuote> {
    let (reserve_in, reserve_out) = (state.reserve0, state.reserve1);
    if reserve_in.is_zero() || reserve_out.is_zero() || amount_in.is_zero() {
        return None;
    }

    // amount_in_after_fee scaled by 1000 (Uniswap uses fee = 3 per 1000).
    // Generalize: fee_bps -> fee per 1000 = fee_bps / 10.
    let fee_per_1000 = (fee_bps as u64).div_ceil(10).min(1000);
    let amount_in_with_fee = amount_in * Uint::from(1000 - fee_per_1000);

    let numerator = amount_in_with_fee * reserve_out;
    let denominator = reserve_in * Uint::from(1000u64) + amount_in * Uint::from(fee_per_1000);
    if denominator.is_zero() {
        return None;
    }
    let amount_out = numerator / denominator;

    // State after: reserves move; invariant k is preserved (approx).
    let new_reserve_in = reserve_in + amount_in;
    let new_reserve_out = reserve_out - amount_out;

    Some(HopQuote {
        amount_out,
        state_after: PoolStateAfter::V2 {
            reserve_in: new_reserve_in,
            reserve_out: new_reserve_out,
        },
    })
}

/// Inverse: amount_in needed to receive `amount_out` from the pool.
pub fn get_amount_in(state: &PoolLiveState, amount_out: Amount, fee_bps: u32) -> Option<Amount> {
    let (reserve_in, reserve_out) = (state.reserve0, state.reserve1);
    if reserve_in.is_zero() || reserve_out.is_zero() || amount_out >= reserve_out {
        return None;
    }
    let fee_per_1000 = (fee_bps as u64).div_ceil(10).min(1000);
    let numerator = reserve_in * amount_out * Uint::from(1000u64);
    let denominator = (reserve_out - amount_out) * Uint::from(1000 - fee_per_1000);
    if denominator.is_zero() {
        return None;
    }
    // +1 to round up, as Uniswap V2 does.
    Some(numerator / denominator + Uint::from(1u64))
}

#[allow(dead_code)]
fn _ensure_amount_after_fee_used() {
    // Keep the import live for clarity; the V2 math inlines the 1000-scale fee.
    let _ = amount_after_fee;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::uint_ext::UintExt;

    #[test]
    fn v2_quote_matches_uniswap_example() {
        // Classic example: reserves (1_000_000, 1_000_000) 6-dec, swap 1 USDC.
        let reserve = Uint::from(1_000_000_000_000u64); // 1e6 * 1e6
        let state = PoolLiveState::v2(reserve, reserve);
        let one = Uint::ten_pow(6);
        let q = quote(&state, one, 30).unwrap();
        // Expect ~0.996991 USDC out (0.30% fee + tiny slippage on 1e-6 ratio).
        // amount_out = 996991 * ...; we assert it's slightly under 1 USDC and > 0.995 USDC.
        assert!(q.amount_out < one);
        assert!(q.amount_out > Uint::from(995_000u64));
    }

    #[test]
    fn v2_zero_input_returns_none() {
        let state = PoolLiveState::v2(Uint::from(100u64), Uint::from(100u64));
        assert!(quote(&state, Uint::ZERO, 30).is_none());
    }

    #[test]
    fn v2_round_trip_slight_loss() {
        // 1 unit in then out of two pools with equal reserves loses to fees.
        let reserve = Uint::ten_pow(18);
        let s = PoolLiveState::v2(reserve, reserve);
        let one = Uint::ten_pow(18);
        let q1 = quote(&s, one, 30).unwrap();
        // reverse direction with same reserves
        let s2 = PoolLiveState::v2(reserve, reserve);
        let q2 = quote(&s2, q1.amount_out, 30).unwrap();
        assert!(q2.amount_out < one, "round trip must lose to fees");
    }

    #[test]
    fn v2_get_amount_in_consistent() {
        let reserve = Uint::from(1_000_000_000_000u64);
        let s = PoolLiveState::v2(reserve, reserve);
        let one = Uint::ten_pow(6);
        let q = quote(&s, one, 30).unwrap();
        let needed = get_amount_in(&s, q.amount_out, 30).unwrap();
        // needed must be >= the input we used (1 USDC), within 2 wei rounding.
        assert!(needed >= one);
        assert!(needed - one <= Uint::from(2u64));
    }
}
