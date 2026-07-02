//! EIP-1559 gas oracle.
//!
//! Converts a recent `eth_feeHistory` (or our own rolling observation) into
//! `max_fee_per_gas` / `max_priority_fee_per_gas` for submission.

use serde::{Deserialize, Serialize};
use strategy_core::uint_ext::Uint;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeeEstimate {
    pub max_fee_per_gas: Uint,
    pub max_priority_fee_per_gas: Uint,
    pub base_fee_per_gas: Uint,
}

/// Compute EIP-1559 fees from the latest base fee and a priority-fee policy.
///
/// - `base_fee`: latest base fee (wei).
/// - `priority_tip_pct`: priority fee as a fraction of base fee (e.g. 0.10).
/// - `headroom_pct`: extra headroom on max fee (e.g. 0.20).
pub fn estimate(base_fee: Uint, priority_tip_pct: f64, headroom_pct: f64) -> FeeEstimate {
    let priority = scale(base_fee, priority_tip_pct.max(0.0));
    // max_fee = (base_fee + priority) * (1 + headroom) -- ensures it covers next blocks.
    let base_plus_tip = base_fee.saturating_add(priority);
    let max_fee = scale(base_plus_tip, 1.0 + headroom_pct).max(base_plus_tip);
    FeeEstimate {
        max_fee_per_gas: max_fee,
        max_priority_fee_per_gas: priority,
        base_fee_per_gas: base_fee,
    }
}

fn scale(x: Uint, f: f64) -> Uint {
    if f <= 0.0 {
        return Uint::ZERO;
    }
    let xf = to_f64(x);
    from_f64(xf * f)
}

fn to_f64(x: Uint) -> f64 {
    let limbs = x.as_limbs();
    let mut acc = 0f64;
    let mut scale = 1f64;
    for &l in limbs.iter().rev() {
        acc += l as f64 * scale;
        scale *= 2f64.powi(64);
    }
    acc
}

fn from_f64(x: f64) -> Uint {
    if x.is_nan() || x.is_infinite() || x <= 0.0 {
        return Uint::ZERO;
    }
    let bits = x.to_bits();
    let mantissa = ((bits & ((1u64 << 52) - 1)) | (1u64 << 52)) as u128;
    let raw_exp = (bits >> 52 & 0x7ff) as i32 - 1023 - 52;
    let m = Uint::from(mantissa);
    if raw_exp >= 0 {
        shl(m, raw_exp as u32)
    } else {
        shr(m, (-raw_exp) as u32)
    }
}

fn shl(x: Uint, pow: u32) -> Uint {
    let mut a = x;
    let mut p = pow;
    while p >= 64 {
        a = a << 64;
        p -= 64;
    }
    if p > 0 { a = a << p; }
    a
}
fn shr(x: Uint, pow: u32) -> Uint {
    let mut a = x;
    let mut p = pow;
    while p >= 64 {
        a = a >> 64;
        p -= 64;
    }
    if p > 0 { a = a >> p; }
    a
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn max_fee_covers_base_plus_tip_with_headroom() {
        let base = Uint::from(10_000_000_000u64); // 10 gwei
        let est = estimate(base, 0.10, 0.20);
        assert!(est.max_priority_fee_per_gas > Uint::ZERO);
        assert!(est.max_fee_per_gas > base);
        // max_fee >= base + priority
        assert!(est.max_fee_per_gas >= base.saturating_add(est.max_priority_fee_per_gas));
    }
}
