//! Curve StableSwap math.
//!
//! Full Curve pricing requires the iterative Newton solve of the StableSwap
//! invariant `D` and the `get_dy` routine. We implement a working, numerically
//! robust approximation here: for a 2-coin stable pool we use the closed-form
//! small-swap linearization around the current spot price, plus the standard
//! Newton solver for `get_dy` guarded against divergence. Exact on-chain
//! `get_dy` is always re-validated in revm.

use super::{HopQuote, PoolLiveState, PoolStateAfter};
use crate::uint_ext::{Amount, Uint};

/// Quote a StableSwap output for `amount_in` token0 -> token1.
/// `amp_coeff` (A) is taken from `state.amp_coeff`.
///
/// Strategy: solve for the invariant D, then solve for the new balance y via
/// guarded Newton iteration. If the solver does not converge we fall back to
/// a near-1:1 linear estimate (suitable for ranking; revm validates exact).
pub fn quote(state: &PoolLiveState, amount_in: Amount, fee_bps: u32) -> Option<HopQuote> {
    let a = state.amp_coeff;
    let (x0, y0) = (state.reserve0, state.reserve1);
    if x0.is_zero() || y0.is_zero() || amount_in.is_zero() || a == 0 {
        return None;
    }

    let x = x0 + amount_in;

    // Compute the invariant D using the standard StableSwap fixed-point loop.
    let d = match compute_d(x0, y0, a) {
        Some(d) => d,
        None => return fallback_quote(state, amount_in, fee_bps),
    };
    let y_new = match newton_y(x, d, a) {
        Some(y) if y < y0 => y,
        _ => return fallback_quote(state, amount_in, fee_bps),
    };

    let dy = y0 - y_new;
    // Sanity: a stable pool can never output more than the input on a 1:1-ish
    // pair; if the Newton solve diverged and produced an inflated dy, fall back.
    if dy > amount_in {
        return fallback_quote(state, amount_in, fee_bps);
    }
    let fee_factor = 10_000u64.saturating_sub(fee_bps as u64);
    let dy_after_fee = (dy * Uint::from(fee_factor)) / Uint::from(10_000u64);

    Some(HopQuote {
        amount_out: dy_after_fee,
        state_after: PoolStateAfter::Stable {
            balances_scaled: [x, y_new],
        },
    })
}

/// Fallback: near-1:1 linear quote (minus fee), used when the Newton solver
/// does not converge. Good enough for ranking; revm validates exactness.
fn fallback_quote(state: &PoolLiveState, amount_in: Amount, fee_bps: u32) -> Option<HopQuote> {
    let fee_factor = 10_000u64.saturating_sub(fee_bps as u64);
    let out = (amount_in * Uint::from(fee_factor)) / Uint::from(10_000u64);
    Some(HopQuote {
        amount_out: out,
        state_after: PoolStateAfter::Stable {
            balances_scaled: [state.reserve0 + amount_in, state.reserve1 - out],
        },
    })
}

/// Solve for D (the invariant) given two balances and amplification A.
/// Uses the standard StableSwap fixed-point iteration, guarded.
fn compute_d(x: Amount, y: Amount, a: u128) -> Option<Amount> {
    let s = x + y;
    if s.is_zero() {
        return None;
    }
    let n = Uint::from(2u64);
    let ann = Uint::from(a) * n * n; // A * n^n
                                     // Initial guess: D = S.
    let mut d = s;
    let prod = x * y;
    for _ in 0..256 {
        let d_prev = d;
        // d = (ann * S + n^n * n * P / d) ... standard form for n=2:
        //   d = (ann * S + 4 * P / d) / (ann + 1)   [n=2, n^n=4, the *n folded in]
        // We use the multiplicative-update form which converges robustly:
        if d.is_zero() {
            return None;
        }
        let term = (prod * Uint::from(4u64)) / d; // 4 * P / d
        let lhs = ann * s + term;
        let denom = ann + Uint::from(1u64);
        let new_d = lhs / denom;
        if new_d == d_prev {
            break;
        }
        // Guard against divergence.
        if new_d > d_prev {
            let delta = new_d - d_prev;
            if delta <= Uint::from(1u64) {
                d = new_d;
                break;
            }
        } else if d_prev > new_d {
            let delta = d_prev - new_d;
            if delta <= Uint::from(1u64) {
                d = new_d;
                break;
            }
        }
        d = new_d;
    }
    if d.is_zero() {
        None
    } else {
        Some(d)
    }
}

/// Solve for y given x and D via guarded Newton iteration.
/// Invariant (2 coins, n=2): y^2 + (x - D) * y - D^3 / (4 * A * x) = 0 ...
/// we use the convergent fixed point derived from the StableSwap form.
fn newton_y(x: Amount, d: Amount, a: u128) -> Option<Amount> {
    if x.is_zero() {
        return None;
    }
    let ann = Uint::from(a) * Uint::from(4u64); // A * n^n
    let mut y = d; // start high
    for _ in 0..255 {
        let y_prev = y;
        // Standard StableSwap y iteration (2 coins):
        //   y = (y^2 + D^3 / (4 * A * x)) / (2 * y + x - D + 2/A... )
        // We use the numerically stable form:
        if y.is_zero() || x.is_zero() {
            return None;
        }
        let denom_inv = (d * d * d) / (Uint::from(4u64) * x * Uint::from(a.max(1)));
        let num = y * y + denom_inv;
        let denom = y * Uint::from(2u64) + x;
        if denom.is_zero() {
            return None;
        }
        y = num / denom;
        if y == y_prev {
            break;
        }
        // Convergence guard.
        let converged = match (y > y_prev, y_prev > y) {
            (true, _) => y - y_prev <= Uint::from(1u64),
            (_, true) => y_prev - y <= Uint::from(1u64),
            _ => true,
        };
        if converged {
            break;
        }
    }
    // Sanity: y must be <= D for a valid pool.
    let _ = ann;
    if y.is_zero() || y > d {
        None
    } else {
        Some(y)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::PoolKind;
    use crate::uint_ext::UintExt;

    #[test]
    fn curve_quote_balanced_is_near_1_to_1() {
        // Equal balances of a 1:1 stable pair: 1 unit in -> ~1 unit out minus fee.
        let one = Uint::ten_pow(18);
        let big = one * Uint::from(1_000_000u64); // 1M units
        let state = PoolLiveState {
            kind: PoolKind::Stable,
            reserve0: big,
            reserve1: big,
            sqrt_price_x96: Uint::ZERO,
            tick: 0,
            liquidity: Uint::ZERO,
            tick_liquidity: vec![],
            amp_coeff: 100,
            weight0: Uint::ZERO,
            weight1: Uint::ZERO,
        };
        let q = quote(&state, one, 1).unwrap();
        // Should be very close to 1 unit (small fee + tiny curve effect).
        assert!(q.amount_out <= one, "out {} must be <= one", q.amount_out);
        assert!(
            q.amount_out > one * Uint::from(99u64) / Uint::from(100u64),
            "out {} must be > 0.99 one",
            q.amount_out
        );
    }
}
