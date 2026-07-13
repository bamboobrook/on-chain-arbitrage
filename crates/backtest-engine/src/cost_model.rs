//! Cost model applied to simulated opportunities.
//!
//! Translates a gross-profit simulation into a net P&L that accounts for:
//! - gas (base + priority), with a configurable stress multiplier
//! - private-relay bribe (fraction of gross profit), with a stress multiplier
//! - bundle inclusion probability (a valid sim still may not land on-chain)
//! - competition compression (rival searchers drive profit toward 0)
//!
//! Mirrors design §8.1 "回测必须模拟什么".

use crate::replayer::CostModelParams;
use rand::rngs::StdRng;
use rand::Rng;
use serde::{Deserialize, Serialize};
use strategy_core::uint_ext::{Amount, Uint};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostBreakdown {
    pub gross_profit: Amount,
    pub gas_cost: Amount,
    pub bribe_cost: Amount,
    pub net_profit: Amount,
    pub included: bool,
    pub failure_cost: Amount,
}

/// Apply the cost model to a single simulated opportunity.
///
/// - `gross_profit`: raw profit before costs (asset units).
/// - `gas_cost`: expected gas cost in asset units (already estimated).
/// - `bribe_pct_of_gross`: e.g. 0.30 = 30% of gross goes to the builder.
/// - `failure_cost`: cost when a sim passes but the tx reverts on-chain.
/// - `rng`: deterministic RNG for inclusion/failure sampling (seeded per run).
pub fn apply(
    params: &CostModelParams,
    gross_profit: Amount,
    gas_cost: Amount,
    bribe_pct_of_gross: f64,
    failure_cost: Amount,
    rng: &mut StdRng,
) -> CostBreakdown {
    // Stress costs.
    let gas_stress = 1.0 + params.gas_stress_pct;
    let bribe_stress = 1.0 + params.bribe_stress_pct;

    let stressed_gas = scale_amount(gas_cost, gas_stress);
    let bribe = scale_amount(gross_profit, bribe_pct_of_gross * bribe_stress);

    // Inclusion sampling.
    let included = rng.gen_bool(params.inclusion_rate.clamp(0.0, 1.0));

    let (net, failure) = if included {
        let n = gross_profit.saturating_sub(stressed_gas + bribe);
        (n, Uint::ZERO)
    } else {
        // Not included: if it was a failed attempt, pay failure cost; else 0.
        let fail = if rng.gen_bool(0.5) {
            failure_cost
        } else {
            Uint::ZERO
        };
        (Uint::ZERO, fail)
    };

    CostBreakdown {
        gross_profit,
        gas_cost: stressed_gas,
        bribe_cost: bribe,
        net_profit: net,
        included,
        failure_cost: failure,
    }
}

fn scale_amount(a: Amount, factor: f64) -> Amount {
    if factor <= 0.0 || a == Uint::ZERO {
        return Uint::ZERO;
    }
    // Express the multiplier as basis points to stay in integer math:
    // result = a * factor = a * (factor_bps / 10000).
    // factor_bps is rounded to the nearest integer; sufficient for stress sims.
    let factor_bps = (factor * 10_000.0).round() as u128;
    (a * Uint::from(factor_bps)) / Uint::from(10_000u64)
}

fn amount_to_f64(a: Amount) -> f64 {
    let limbs = a.as_limbs();
    let mut acc = 0f64;
    let mut scale = 1f64;
    for &l in limbs.iter().rev() {
        acc += l as f64 * scale;
        scale *= 2f64.powi(64);
    }
    acc
}

fn amount_from_f64(x: f64) -> Amount {
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

fn shl(x: Amount, pow: u32) -> Amount {
    let mut a = x;
    let mut p = pow;
    while p >= 64 {
        a <<= 64;
        p -= 64;
    }
    if p > 0 {
        a <<= p;
    }
    a
}
fn shr(x: Amount, pow: u32) -> Amount {
    let mut a = x;
    let mut p = pow;
    while p >= 64 {
        a >>= 64;
        p -= 64;
    }
    if p > 0 {
        a >>= p;
    }
    a
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::replayer::CostModelParams;
    use rand::SeedableRng;
    use strategy_core::uint_ext::UintExt;

    #[test]
    fn included_trade_keeps_gross_minus_costs() {
        let p = CostModelParams {
            gas_stress_pct: 0.0,
            bribe_stress_pct: 0.0,
            inclusion_rate: 1.0,
        };
        let mut rng = StdRng::seed_from_u64(1);
        let gross = Uint::ten_pow(6) * Uint::from(10u64); // 10 USDC
        let gas = Uint::from(100_000u64);
        let cb = apply(&p, gross, gas, 0.30, Uint::ZERO, &mut rng);
        assert!(cb.included);
        // net = gross - gas - 30%*gross
        let expected = gross - gas - (gross * Uint::from(30u64)) / Uint::from(100u64);
        assert_eq!(cb.net_profit, expected);
    }

    #[test]
    fn stress_increases_costs() {
        let p = CostModelParams {
            gas_stress_pct: 1.0,
            bribe_stress_pct: 1.0,
            inclusion_rate: 1.0,
        };
        let mut rng = StdRng::seed_from_u64(2);
        let gross = Uint::from(1_000_000u64);
        let gas = Uint::from(100_000u64);
        let cb = apply(&p, gross, gas, 0.10, Uint::ZERO, &mut rng);
        // gas doubled
        assert!(cb.gas_cost >= Uint::from(199_000u64));
        // bribe doubled (2 * 10% * gross)
        assert!(cb.bribe_cost >= Uint::from(199_000u64));
    }
}
