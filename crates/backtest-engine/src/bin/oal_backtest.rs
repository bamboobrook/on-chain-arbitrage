//! OAL backtest binary — cross-pool atomic arbitrage.
//!
//! Scans historical blocks for the price spread between two Uniswap V3 pools
// Tool script: allow lint strictness for this CLI binary.
#![allow(
    dead_code,
    clippy::too_many_arguments,
    clippy::if_same_then_else,
    clippy::collapsible_else_if,
    clippy::needless_pass_by_value
)]
//! on the same token pair (e.g. USDC/WETH 0.05% vs 0.30%) and computes the
//! net profit of an atomic arbitrage: buy the cheaper pool, sell the dearer
//! one, in a single transaction. Applies gas + bribe costs.
//!
//! This is the simplest *profitable-possible* atomic-arb shape. The real
//! system uses strategy-core's graph search across many pools; this binary
//! validates the data + pricing + cost pipeline with honest numbers.
//!
//! Usage:
//!   oal-backtest --rpc <URL> \
//!     --pool-a <0.05% pool> --pool-b <0.30% pool> \
//!     --from <BLOCK> --to <BLOCK> --step <N> \
//!     --capital <USDC_BASE_UNITS> [--bribe-pct 0.3] [--gas-price-gwei 0.1]
//!
//! Defaults: Arbitrum USDC/WETH pools, 1000 USDC capital.

use anyhow::Result;
use backtest_engine::replayer::RpcStateSource;
use strategy_core::uint_ext::{Amount, Uint};

#[derive(Debug)]
struct Args {
    rpc: String,
    pool_a: String, // cheaper (buy side)
    pool_b: String, // dearer (sell side)
    from: u64,
    to: u64,
    step: u64,
    capital: Amount,
    bribe_pct: f64,
    gas_units: u64,
    gas_price_gwei: f64,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let args = parse_args()?;

    println!("=== OAL cross-pool arbitrage backtest ===");
    println!("rpc:    {}", mask(&args.rpc));
    println!("poolA:  {} (buy side)", args.pool_a);
    println!("poolB:  {} (sell side)", args.pool_b);
    println!(
        "blocks: {} .. {} step {} ({} samples)",
        args.from,
        args.to,
        args.step,
        (args.to - args.from) / args.step
    );
    println!("capital: {} USDC base units (6 dec)", args.capital);
    println!(
        "costs:   bribe {:.0}% of gross, gas {} @ {:.4} gwei",
        args.bribe_pct * 100.0,
        args.gas_units,
        args.gas_price_gwei
    );
    println!();

    let src = RpcStateSource::new(&args.rpc);
    let pool_a = args.pool_a.clone();
    let pool_b = args.pool_b.clone();

    let mut total_gross_profit = 0f64; // in USDC
    let mut total_gas = 0f64;
    let mut total_bribe = 0f64;
    let mut total_net = 0f64;
    let mut samples = 0u64;
    let mut opportunities = 0u64; // blocks where gross > 0 before fees
    let mut profitable = 0u64; // blocks where net > 0 after fees
    let mut max_edge_bps = 0f64;
    let mut equity: Vec<(u64, f64)> = Vec::new();

    let gas_cost_usdc = (args.gas_units as f64) * args.gas_price_gwei * 1e-9 * ETH_PRICE_USD;

    let mut block = args.from;
    while block <= args.to {
        let (sa, _ta, la) = match src.v3_state_at(&pool_a, block).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("  block {}: poolA read failed: {}", block, e);
                block += args.step;
                continue;
            }
        };
        let (sb, _tb, lb) = match src.v3_state_at(&pool_b, block).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("  block {}: poolB read failed: {}", block, e);
                block += args.step;
                continue;
            }
        };
        if la.is_zero() || lb.is_zero() {
            block += args.step;
            continue;
        }
        samples += 1;

        // Compute the edge between the two pools in INTEGER bps. The two sqrtP
        // values are ~3e24 and differ by <1%, so f64 ratio loses all precision.
        // edge_bps = (max/min - 1) * 10000, via integer division with headroom.
        if sa.is_zero() || sb.is_zero() {
            block += args.step;
            continue;
        }
        let (larger, smaller, a_is_cheap) = if sa >= sb {
            (sa, sb, true)
        } else {
            (sb, sa, false)
        };
        // ratio scaled to 1e8: larger/smaller * 1e8, computed exactly in U256.
        let ratio_e8 = (larger * Uint::from(100_000_000u64)) / smaller;
        // edge in bps = ratio_e8/1e4 - 10000 (since ratio_e8 = ratio*1e8, ratio*1e4 = ratio_e8/1e4)
        let ratio_e4 = ratio_e8 / Uint::from(10_000u64);
        let edge_bps = ratio_e4.to::<u64>().saturating_sub(10_000) as f64;
        let direction = if a_is_cheap { "A->B" } else { "B->A" };
        if edge_bps > max_edge_bps {
            max_edge_bps = edge_bps;
        }

        // Pool fees: both pools charge on the swapped notional.
        let fee_bps = fee_bps_of(&pool_a) + fee_bps_of(&pool_b);

        // Gross profit (USDC), price-edge based, before fees and slippage.
        let capital_usdc = to_f64(args.capital) / 1e6; // 6-dec USDC -> human
        let price_edge = edge_bps / 10_000.0;
        let gross_before_fees = capital_usdc * price_edge;
        let fees = capital_usdc * (fee_bps as f64 / 10_000.0);
        let gross = gross_before_fees - fees;

        if gross > 0.0 {
            opportunities += 1;
        }

        // Apply slippage penalty proportional to (capital / liquidity).
        // V3 slippage grows ~linearly with trade size vs active liquidity for
        // small trades. We use a conservative linear model:
        //   slippage_fraction = k * capital_usdc / liquidity_usdc
        // with k=2 (both pools). liquidity in USD is approx liquidity_raw * price.
        // We estimate price from sqrtP via f64 (price magnitude, not the tiny
        // ratio — magnitude precision is fine for slippage sizing).
        let price_usd = v3_price_usdc_per_weth(sa); // WETH price in USD (approx)
        let liq_a_usdc = to_f64(la) * price_usd / 1e18;
        let liq_b_usdc = to_f64(lb) * price_usd / 1e18;
        let slippage = if liq_a_usdc > 0.0 && liq_b_usdc > 0.0 {
            (2.0 * (capital_usdc / liq_a_usdc.min(liq_b_usdc).max(1.0))).min(0.95)
        } else {
            0.5
        }; // conservative cap
        let gross_after_slip = gross * (1.0 - slippage);

        // Only execute if gross_after_slip > 0 (no rational arb would run a
        // guaranteed-loss trade). When unprofitable, the opportunity is
        // observed but not taken; net contribution is 0 (no gas spent).

        // Cost model: gas + bribe, only if we actually execute.
        let (net, gas, bribe) = if gross_after_slip > 0.0 {
            let gas = gas_cost_usdc;
            let bribe = gross_after_slip * args.bribe_pct;
            (gross_after_slip - gas - bribe, gas, bribe)
        } else {
            (0.0, 0.0, 0.0) // opportunity observed, not executed
        };

        total_gross_profit += gross_after_slip;
        total_gas += gas;
        total_bribe += bribe;
        total_net += net;
        if net > 0.0 {
            profitable += 1;
        }
        equity.push((block, total_net));

        if samples.is_multiple_of(20) || gross_after_slip > 0.0 {
            println!(
                "  block {:>10} edge {:6.1}bps dir {} gross ${:+.4} slip {:.1}% net ${:+.4}",
                block,
                edge_bps,
                direction,
                gross_after_slip,
                slippage * 100.0,
                net
            );
        }
        block += args.step;
    }

    println!();
    println!("=== summary ===");
    println!("samples:            {}", samples);
    println!(
        "opportunities (>0): {} ({:.1}%)",
        opportunities,
        pct(opportunities, samples)
    );
    println!(
        "profitable (net>0): {} ({:.1}%)",
        profitable,
        pct(profitable, samples)
    );
    println!("max edge seen:      {:.1} bps", max_edge_bps);
    println!("total gross profit: ${:.4}", total_gross_profit);
    println!("total gas cost:     ${:.4}", total_gas);
    println!("total bribe:        ${:.4}", total_bribe);
    println!("total NET profit:   ${:.4}", total_net);

    let capital_usdc = to_f64(args.capital) / 1e6;
    let window_blocks = args.to.saturating_sub(args.from);
    let days = (window_blocks as f64) * 0.25 / 86400.0; // Arbitrum 0.25s/block
    let annualized = if capital_usdc > 0.0 && days > 0.0 {
        (total_net / capital_usdc) * (365.0 / days) * 100.0
    } else {
        0.0
    };
    println!();
    println!(
        "annualized return:  {:.2}%  (capital ${:.0}, window {:.2} days)",
        annualized, capital_usdc, days
    );
    println!();
    println!("DISCLAIMER:");
    println!("  - These numbers are a historical sample, NOT a guarantee of future returns.");
    println!("  - Arbitrage profits are competed away; live execution will be lower.");
    println!("  - Slippage model is conservative-linear; real slippage may differ.");
    println!("  - Inclusion probability not applied here (assumes 100% landed).");
    println!("  - A 20%+ annualized figure would need out-of-sample + live validation");
    println!("    per docs/risk-policy.md before any 'target 20%+' label.");
    Ok(())
}

const ETH_PRICE_USD: f64 = 1625.0; // approximate; real impl reads from an oracle

fn v3_price_usdc_per_weth(sqrt_p: Uint) -> f64 {
    // price = (sqrtP / 2^96)^2 ; token0=WETH(18), token1=USDC(6)
    // human USDC/WETH = raw * 10^(18-6)
    let sp = to_f64(sqrt_p);
    let q96 = 2f64.powi(96);
    let raw = (sp / q96).powi(2);
    raw * 10f64.powi(12)
}

fn fee_bps_of(pool: &str) -> u32 {
    // Arbitrum USDC/WETH pools: 0xC696...=0.05% (5bps), 0xc473...=0.30% (30bps)
    let p = pool.to_ascii_lowercase();
    if p.contains("c6962004") {
        5
    } else if p.contains("c473e2ae") {
        30
    } else {
        30
    } // default assume 0.30%
}

fn to_f64(a: Amount) -> f64 {
    // ruint limbs are little-endian: limbs[0] is the least significant.
    let limbs = a.as_limbs();
    let mut acc = 0f64;
    let mut s = 1f64;
    for &l in limbs.iter() {
        acc += l as f64 * s;
        s *= 2f64.powi(64);
    }
    acc
}

fn pct(x: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        x as f64 / total as f64 * 100.0
    }
}

fn mask(u: &str) -> String {
    // show host only, hide key
    if let Some(idx) = u.find("/v2/") {
        let (head, _) = u.split_at(idx + 4);
        format!("{}***", head)
    } else {
        u.to_string()
    }
}

fn parse_args() -> Result<Args> {
    let rpc =
        std::env::var("RPC_ARBITRUM_URL").unwrap_or_else(|_| "http://127.0.0.1:8545".to_string());
    let pool_a = "0xC6962004f452bE9203591991D15f6b388e09E8D0".to_string();
    let pool_b = "0xc473e2aEE3441BF9240Be85eb122aBB059A3B57c".to_string();
    let mut from = 0u64;
    let mut to = 0u64;
    let mut step = 1200u64; // ~5 min
    let mut capital_s = "1000000000".to_string(); // 1000 USDC
    let mut bribe_pct = 0.30;
    let mut gas_units = 250_000; // cross-pool arb is 2 swaps
    let mut gas_price_gwei = 0.1;

    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--rpc" => {
                i += 1;
                if i < args.len() {
                    /* override rpc */
                    let _ = &args[i];
                }
                i += 0;
            }
            "--pool-a" => {
                i += 1;
                if i < args.len() { /* override */ }
            }
            _ => {}
        }
        i += 1;
    }
    // Re-parse properly (the loop above was a stub; redo cleanly)
    let mut i = 1;
    let mut rpc_v = rpc.clone();
    let mut pa = pool_a.clone();
    let mut pb = pool_b.clone();
    while i < args.len() {
        match args[i].as_str() {
            "--rpc" => {
                rpc_v = args.get(i + 1).cloned().unwrap_or(rpc_v);
                i += 2;
            }
            "--pool-a" => {
                pa = args.get(i + 1).cloned().unwrap_or(pa);
                i += 2;
            }
            "--pool-b" => {
                pb = args.get(i + 1).cloned().unwrap_or(pb);
                i += 2;
            }
            "--from" => {
                from = args.get(i + 1).and_then(|s| s.parse().ok()).unwrap_or(from);
                i += 2;
            }
            "--to" => {
                to = args.get(i + 1).and_then(|s| s.parse().ok()).unwrap_or(to);
                i += 2;
            }
            "--step" => {
                step = args.get(i + 1).and_then(|s| s.parse().ok()).unwrap_or(step);
                i += 2;
            }
            "--capital" => {
                capital_s = args.get(i + 1).cloned().unwrap_or(capital_s);
                i += 2;
            }
            "--bribe-pct" => {
                bribe_pct = args
                    .get(i + 1)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(bribe_pct);
                i += 2;
            }
            "--gas-units" => {
                gas_units = args
                    .get(i + 1)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(gas_units);
                i += 2;
            }
            "--gas-price-gwei" => {
                gas_price_gwei = args
                    .get(i + 1)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(gas_price_gwei);
                i += 2;
            }
            _ => {
                i += 1;
            }
        }
    }

    if from == 0 || to == 0 || to <= from {
        anyhow::bail!("must provide --from and --to blocks (to > from)");
    }
    let capital = Uint::from_str_radix(&capital_s, 10)
        .map_err(|e| anyhow::anyhow!("bad capital {}: {}", capital_s, e))?;

    Ok(Args {
        rpc: rpc_v,
        pool_a: pa,
        pool_b: pb,
        from,
        to,
        step,
        capital,
        bribe_pct,
        gas_units,
        gas_price_gwei,
    })
}
