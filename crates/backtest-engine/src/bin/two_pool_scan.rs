//! OAL two-pool cross-fee-tier arbitrage scanner (EXACT quotes).
//!
//! For each historical block, quotes: USDC -> WETH in pool A (fee A), then
// Tool script: allow lint strictness for this CLI binary.
#![allow(dead_code, clippy::too_many_arguments, clippy::if_same_then_else)]
//! WETH -> USDC in pool B (fee B), both via the on-chain Quoter V2. Reports
//! the exact net edge after pool fees, and how often it's positive, across
//! the requested capital sizes. This is the precise version of oal-backtest
//! (which used an approximate slippage model).
//!
//! Usage:
//!   two-pool-scan --rpc URL --token0 USDC --token1 WETH \
//!     --fee-a 100 --fee-b 500 --from N --to M --step S \
//!     --capitals "100000,1000000,10000000"

use alloy::primitives::{Address as AlloyAddress, Bytes, U256 as AlloyU256};
use alloy::providers::{Provider, ProviderBuilder, RootProvider};
use alloy::rpc::types::{BlockId, TransactionRequest};
use alloy::transports::http::{Client as HttpClient, Http};
use anyhow::{Context, Result};
use std::sync::Arc;

type HttpProvider = RootProvider<Http<HttpClient>>;
const QUOTER_V2: &str = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";

#[tokio::main]
async fn main() -> Result<()> {
    let cfg = parse_args()?;
    let provider = Arc::new(ProviderBuilder::new().on_http(cfg.rpc.parse().unwrap()));
    let quoter: AlloyAddress = QUOTER_V2.parse().unwrap();
    let fee_total_bps = (cfg.fee_a + cfg.fee_b) as f64 / 100.0;

    println!("=== OAL two-pool cross-fee scanner (exact Quoter quotes) ===");
    println!(
        "rpc: {}  token0={:?} token1={:?}  feeA={} feeB={} (total {:.1} bps)",
        mask(&cfg.rpc),
        cfg.t0,
        cfg.t1,
        cfg.fee_a,
        cfg.fee_b,
        fee_total_bps
    );
    println!(
        "blocks: {} .. {} step {}  capitals: {:?}",
        cfg.from, cfg.to, cfg.step, cfg.capitals
    );
    println!();

    // Collect blocks.
    let mut blocks = Vec::new();
    let mut b = cfg.from;
    while b <= cfg.to {
        blocks.push(b);
        b += cfg.step;
    }
    let total = blocks.len();
    println!("scanning {} blocks...", total);

    let sem = Arc::new(tokio::sync::Semaphore::new(cfg.concurrency));
    let mut handles = Vec::new();
    for block in blocks {
        let permit = sem.clone().acquire_owned().await.unwrap();
        let p = provider.clone();
        let t0 = cfg.t0;
        let t1 = cfg.t1;
        let fa = cfg.fee_a;
        let fb = cfg.fee_b;
        let caps = cfg.capitals.clone();
        let h = tokio::spawn(async move {
            let r = scan_block(&p, quoter, t0, t1, fa, fb, &caps, block).await;
            drop(permit);
            (block, r)
        });
        handles.push(h);
    }

    // Per-capital accumulators.
    let mut results: Vec<(u128, Vec<(u64, f64)>)> =
        cfg.capitals.iter().map(|&c| (c, Vec::new())).collect();
    let mut errors = 0u64;
    for h in handles {
        let (block, r) = h.await.unwrap();
        match r {
            Ok(edges) => {
                for (i, edge) in edges.into_iter().enumerate() {
                    results[i].1.push((block, edge));
                }
            }
            Err(_) => {
                errors += 1;
            }
        }
    }

    println!();
    println!(
        "=== results (exact Quoter quotes, net = gross - {:.1} bps pool fees) ===",
        fee_total_bps
    );
    println!("(NOTE: gas + bribe NOT yet subtracted; add them for realistic net)");
    println!();
    for (cap, mut edges) in results {
        edges.sort_by_key(|(b, _)| *b);
        let n = edges.len();
        if n == 0 {
            println!("capital {} (raw): no successful samples", cap);
            continue;
        }
        let mut profitable = 0usize;
        let mut sum_net = 0f64;
        let mut max_net = -1e9f64;
        let mut profit_blocks = Vec::new();
        for &(block, gross) in &edges {
            let net = gross - fee_total_bps;
            sum_net += net;
            if net > max_net {
                max_net = net;
            }
            if net > 0.0 {
                profitable += 1;
                profit_blocks.push((block, net));
            }
        }
        let cap_human = cap as f64 / 1e6;
        println!("capital {:.4} USDC ({} raw):", cap_human, cap);
        println!("  samples: {}  errors: {}", n, errors);
        println!("  mean net edge: {:.2} bps", sum_net / n as f64);
        println!("  max net edge:  {:.2} bps", max_net);
        println!(
            "  profitable (net>0): {} / {} ({:.2}%)",
            profitable,
            n,
            profitable as f64 / n as f64 * 100.0
        );
        if profitable > 0 {
            let total_net_bps: f64 = profit_blocks.iter().map(|(_, e)| *e).sum();
            // Annualized: assume capture every profitable block.
            let window_blocks = cfg.to - cfg.from;
            let secs = block_seconds(&cfg.rpc);
            let blocks_per_year = 365.0 * 86400.0 / secs;
            let rate = profitable as f64 / window_blocks as f64;
            let trades_per_year = rate * blocks_per_year;
            let avg_net = total_net_bps / profitable as f64;
            // per-trade USD profit = avg_net_bps/1e4 * cap_human
            let usd_per_trade = avg_net / 1e4 * cap_human;
            let annual_usd = usd_per_trade * trades_per_year;
            let annualized_pct = annual_usd / cap_human * 100.0;
            println!("  >>> IF captured every profitable block:");
            println!(
                "      trades/year: {:.0}  avg net/trade: {:.2} bps (${:.6})",
                trades_per_year, avg_net, usd_per_trade
            );
            println!(
                "      ANNUALIZED: {:.2}% on ${:.4}  (BEFORE gas+bribe, NOT guaranteed)",
                annualized_pct, cap_human
            );
        }
        println!();
    }
    println!(
        "DISCLAIMER: exact pool quotes only. Realistic execution subtracts gas (~${:.4}/tx),",
        cfg.gas_cost_usd()
    );
    println!("bribe (~30% of profit), inclusion probability (<100%), and competition.");
    Ok(())
}

async fn scan_block(
    provider: &HttpProvider,
    quoter: AlloyAddress,
    t0: AlloyAddress,
    t1: AlloyAddress,
    fee_a: u32,
    fee_b: u32,
    capitals: &[u128],
    block: u64,
) -> Result<Vec<f64>> {
    let bid = BlockId::from(block);
    let mut out = Vec::with_capacity(capitals.len());
    for &cap in capitals {
        // USDC -> WETH in pool A (fee_a)
        let weth = quote(provider, quoter, t0, t1, cap, fee_a, bid)
            .await
            .with_context(|| format!("leg1 @ {}", block))?;
        // WETH -> USDC in pool B (fee_b)
        let usdc_back = quote(provider, quoter, t1, t0, weth, fee_b, bid)
            .await
            .with_context(|| format!("leg2 @ {}", block))?;
        // gross edge bps = (back/cap - 1) * 10000
        let edge = if cap == 0 {
            0.0
        } else {
            let back = strategy_core::uint_ext::Uint::from(usdc_back);
            let c = strategy_core::uint_ext::Uint::from(cap);
            let ratio = (back * strategy_core::uint_ext::Uint::from(10_000u64)) / c;
            ratio.to::<u64>() as f64 - 10_000.0
        };
        out.push(edge);
    }
    Ok(out)
}

fn alloy_u256_to_u256(_v: AlloyU256) -> strategy_core::uint_ext::Uint {
    // unused after refactor; kept to silence import in some toolchains
    strategy_core::uint_ext::Uint::ZERO
}

async fn quote(
    provider: &HttpProvider,
    quoter: AlloyAddress,
    token_in: AlloyAddress,
    token_out: AlloyAddress,
    amount: u128,
    fee: u32,
    block: BlockId,
) -> Result<u128> {
    let mut data = Vec::new();
    data.extend_from_slice(&[0xc6, 0xa5, 0x02, 0x6a]);
    data.extend_from_slice(&[0u8; 12]);
    data.extend_from_slice(&token_in.into_array());
    data.extend_from_slice(&[0u8; 12]);
    data.extend_from_slice(&token_out.into_array());
    data.extend_from_slice(&AlloyU256::from(amount).to_be_bytes::<32>());
    let mut fw = [0u8; 32];
    fw[29] = (fee >> 16) as u8;
    fw[30] = (fee >> 8) as u8;
    fw[31] = fee as u8;
    data.extend_from_slice(&fw);
    data.extend_from_slice(&[0u8; 32]);
    let tx = TransactionRequest::default()
        .to(quoter)
        .input(Bytes::from(data).into());
    let res: Bytes = provider
        .call(&tx)
        .block(block)
        .await
        .map_err(|e| anyhow::anyhow!("quoter call: {}", e))?;
    let bytes = res.as_ref();
    if bytes.len() < 32 {
        anyhow::bail!("short");
    }
    Ok(AlloyU256::from_be_slice(&bytes[0..32]).to::<u128>())
}

struct Config {
    rpc: String,
    t0: AlloyAddress,
    t1: AlloyAddress,
    fee_a: u32,
    fee_b: u32,
    capitals: Vec<u128>,
    from: u64,
    to: u64,
    step: u64,
    concurrency: usize,
}

impl Config {
    fn gas_cost_usd(&self) -> f64 {
        0.05
    } // approx polygon gas in USD
}

fn block_seconds(rpc: &str) -> f64 {
    if rpc.contains("arb-mainnet") {
        0.25
    } else if rpc.contains("base-mainnet") || rpc.contains("opt-mainnet") {
        2.0
    } else if rpc.contains("polygon") {
        2.0
    } else if rpc.contains("bnb") {
        3.0
    } else {
        12.0
    }
}

fn mask(u: &str) -> String {
    if let Some(idx) = u.find("/v2/") {
        format!("{}***", &u[..idx + 4])
    } else {
        u.to_string()
    }
}

fn parse_args() -> Result<Config> {
    let mut rpc = String::new();
    let mut t0s = String::new();
    let mut t1s = String::new();
    let mut fee_a = 100u32;
    let mut fee_b = 500u32;
    let mut capitals_s = "100000,1000000,10000000".to_string();
    let mut from = 0u64;
    let mut to = 0u64;
    let mut step = 100u64;
    let mut concurrency = 12usize;
    let a: Vec<String> = std::env::args().collect();
    let mut i = 1;
    let next = |i: &mut usize| -> Result<String> {
        let v = a
            .get(*i + 1)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("missing"))?;
        *i += 2;
        Ok(v)
    };
    while i < a.len() {
        match a[i].as_str() {
            "--rpc" => rpc = next(&mut i)?,
            "--token0" => t0s = next(&mut i)?,
            "--token1" => t1s = next(&mut i)?,
            "--fee-a" => fee_a = next(&mut i)?.parse()?,
            "--fee-b" => fee_b = next(&mut i)?.parse()?,
            "--capitals" => capitals_s = next(&mut i)?,
            "--from" => from = next(&mut i)?.parse()?,
            "--to" => to = next(&mut i)?.parse()?,
            "--step" => step = next(&mut i)?.parse()?,
            "--concurrency" => concurrency = next(&mut i)?.parse()?,
            _ => {
                i += 1;
            }
        }
    }
    if rpc.is_empty() || from == 0 || to <= from {
        anyhow::bail!("usage: two-pool-scan --rpc URL --token0 A --token1 B --fee-a 100 --fee-b 500 --from N --to M");
    }
    let capitals: Vec<u128> = capitals_s
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();
    Ok(Config {
        rpc,
        t0: t0s.parse()?,
        t1: t1s.parse()?,
        fee_a,
        fee_b,
        capitals,
        from,
        to,
        step,
        concurrency,
    })
}
