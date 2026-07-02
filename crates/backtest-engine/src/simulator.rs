//! revm / Anvil simulation driver.
//!
//! In production the simulation worker spins up a revm fork at the target
//! block and executes the [`ExecutionPlan`], returning balance deltas + gas +
//! success. For unit-testable behavior we expose a [`Simulator`] trait and a
//! pure-Rust [`MathSimulator`] that chains [`strategy_core::dex`] quotes to
//! approximate the on-chain result. The exact fork simulation lives behind
//! `ForkSimulator` (revm) — wired when an archive RPC is available.

use anyhow::Result;
use strategy_core::dex::{quote_hop, PoolLiveState};
use strategy_core::types::{
    Address, BalanceDelta, CapitalSource, ExecutionPlan, SimulationResult,
};

/// A simulation backend.
pub trait Simulator {
    fn simulate(&self, plan: &ExecutionPlan) -> Result<SimulationResult>;
}

/// Approximate simulator: chains DEX math quotes per hop. Good enough for
/// fast ranking and graph validation; NOT a substitute for revm exactness.
pub struct MathSimulator {
    pub states: Box<dyn Fn(u32, &Address) -> Option<PoolLiveState> + Send + Sync>,
}

impl MathSimulator {
    pub fn new(states: impl Fn(u32, &Address) -> Option<PoolLiveState> + Send + Sync + 'static) -> Self {
        Self { states: Box::new(states) }
    }
}

impl Simulator for MathSimulator {
    fn simulate(&self, plan: &ExecutionPlan) -> Result<SimulationResult> {
        let mut amount_in = plan.capital.amount;
        let start_asset = amount_in;
        let mut gas_total: u64 = 0;
        let mut failed: Option<String> = None;

        for hop in &plan.route.hops {
            let state = match (self.states)(plan.chain_id, &hop.pool.address) {
                Some(s) => s,
                None => {
                    failed = Some(format!("missing state for pool {}", hop.pool.address));
                    break;
                }
            };
            match quote_hop(&hop.pool, &state, amount_in) {
                Some(q) => {
                    amount_in = q.amount_out;
                    gas_total += 65_000; // rough per-hop gas
                }
                None => {
                    failed = Some(format!("quote failed at pool {}", hop.pool.address));
                    break;
                }
            }
        }

        let success = failed.is_none();
        // Flash-loan premium: 0.09% for Aave, 0 for others. Vault capital: 0.
        let premium = premium(plan.capital.source, start_asset);
        let net_profit = if success {
            if amount_in > start_asset + premium {
                amount_in - start_asset - premium
            } else {
                strategy_core::uint_ext::Uint::ZERO
            }
        } else {
            strategy_core::uint_ext::Uint::ZERO
        };

        Ok(SimulationResult {
            success,
            chain_id: plan.chain_id,
            block_number: 0, // filled by caller
            gas_used: gas_total,
            balance_deltas: vec![BalanceDelta {
                token: plan
                    .route
                    .entry_token()
                    .cloned()
                    .unwrap_or_default(),
                delta: net_profit,
                positive: net_profit > strategy_core::uint_ext::Uint::ZERO,
            }],
            net_profit,
            failure_reason: failed,
            trace_uri: None,
        })
    }
}

fn premium(source: CapitalSource, principal: strategy_core::uint_ext::Uint) -> strategy_core::uint_ext::Uint {
    use strategy_core::uint_ext::Uint;
    match source {
        CapitalSource::FlashLoanAave => {
            // 0.09% premium, rounded up.
            (principal * Uint::from(9u64)) / Uint::from(10_000u64) + Uint::from(1u64)
        }
        CapitalSource::FlashLoanBalancer => Uint::ZERO, // Balancer V2 flash loans are free
        CapitalSource::FlashSwapUniswapV2 => (principal * Uint::from(30u64)) / Uint::from(10_000u64), // 0.3%
        CapitalSource::FlashSwapUniswapV3 => Uint::ZERO,
        CapitalSource::VaultCapital => Uint::ZERO,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use strategy_core::types::{Capital, Hop, PoolKind, PoolRef, Route, Dex};
    use strategy_core::uint_ext::{Uint, UintExt};

    fn mk_plan() -> ExecutionPlan {
        let pool = PoolRef {
            chain_id: 1,
            address: "0xp".into(),
            dex: Dex::UniswapV2,
            kind: PoolKind::V2,
            token0: "0xA".into(),
            token1: "0xB".into(),
            fee_bps: 30,
            tick_spacing: 0,
            extra: serde_json::Value::Null,
        };
        ExecutionPlan {
            opportunity_id: "opp1".into(),
            chain_id: 1,
            route: Route {
                hops: vec![
                    Hop {
                        pool: pool.clone(),
                        token_in: "0xA".into(),
                        token_out: "0xB".into(),
                        zero_for_one: true,
                    },
                    Hop {
                        pool: PoolRef { token0: "0xB".into(), token1: "0xA".into(), ..pool },
                        token_in: "0xB".into(),
                        token_out: "0xA".into(),
                        zero_for_one: true,
                    },
                ],
            },
            capital: Capital {
                source: CapitalSource::VaultCapital,
                amount: Uint::ten_pow(18),
                premium: Uint::ZERO,
            },
            min_profit_assets: Uint::ZERO,
            deadline: 0,
            max_gas_cost: Uint::ZERO,
        }
    }

    #[test]
    fn math_simulator_routes_through_quotes() {
        let plan = mk_plan();
        let sim = MathSimulator::new(|_c, _p| {
            // Equal pools -> round trip loses to fees -> net_profit 0.
            Some(PoolLiveState::v2(
                Uint::ten_pow(18) * Uint::from(1_000u64),
                Uint::ten_pow(18) * Uint::from(1_000u64),
            ))
        });
        let res = sim.simulate(&plan).unwrap();
        assert!(res.success);
        assert_eq!(res.net_profit, strategy_core::uint_ext::Uint::ZERO);
    }
}
