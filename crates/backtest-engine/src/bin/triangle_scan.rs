//! OAL triangle arbitrage scanner.
//!
//! Scans historical blocks for profitable 3-token cyclic arbitrage
// Tool scripts: allow dead code + style lints that clippy -D warnings flags.
#![allow(
    dead_code,
    clippy::too_many_arguments,
    clippy::if_same_then_else,
    clippy::needless_pass_by_value
)]

//! (continued)
//! (e.g. USDC -> WETH -> USDT -> USDC) using the Uniswap V3 Quoter V2 at each
//! block. Reports the edge distribution and how often it exceeds total fees.
//!
//! This is the honest "does a real arb exist in history" probe. It uses the
//! on-chain Quoter so the quotes are exact (tick-level), not approximated.
//!
//! Usage:
//!   triangle-scan --rpc <URL> --quoter <ADDR> \
//!     --token-a <USDC> --token-b <WETH> --token-c <USDT> \
//!     --fee 500 --capital <UNITS> --from <BLOCK> --to <BLOCK> --step <N> \
//!     [--concurrency 8]
//!
//! Prints per-block edge and a final distribution + net-profitable count.

use alloy::primitives::{Address as AlloyAddress, Bytes, U256 as AlloyU256};
use alloy::providers::{Provider, ProviderBuilder, RootProvider};
use alloy::rpc::types::{BlockId, TransactionRequest};
use alloy::transports::http::{Client as HttpClient, Http};
use anyhow::{Context, Result};
use std::sync::Arc;
use strategy_core::uint_ext::Uint;

type HttpProvider = RootProvider<Http<HttpClient>>;

/// Uniswap V3 Quoter V2 address (same on most chains that have UniV3).
const QUOTER_V2: &str = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";

struct Triangle {
    a: AlloyAddress,
    b: AlloyAddress,
    c: AlloyAddress,
    fee: u32,    // default fee for all legs
    fee_ab: u32, // leg-specific fees (0 => use `fee`)
    fee_bc: u32,
    fee_ca: u32,
}

impl Triangle {
    fn fee_ab(&self) -> u32 {
        if self.fee_ab != 0 {
            self.fee_ab
        } else {
            self.fee
        }
    }
    fn fee_bc(&self) -> u32 {
        if self.fee_bc != 0 {
            self.fee_bc
        } else {
            self.fee
        }
    }
    fn fee_ca(&self) -> u32 {
        if self.fee_ca != 0 {
            self.fee_ca
        } else {
            self.fee
        }
    }
    fn total_fee_bps(&self) -> f64 {
        (self.fee_ab() + self.fee_bc() + self.fee_ca()) as f64 / 100.0
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let cfg = parse_args()?;
    println!("=== OAL triangle scanner ===");
    println!("rpc: {}", mask(&cfg.rpc));
    println!(
        "triangle: {:?} -> {:?} -> {:?} -> {:?}",
        cfg.t.a, cfg.t.b, cfg.t.c, cfg.t.a
    );
    println!(
        "fee: {} bps/leg, capital: {} (raw)",
        cfg.t.fee / 100,
        cfg.capital
    );
    println!(
        "blocks: {} .. {} step {} (concurrency {})",
        cfg.from, cfg.to, cfg.step, cfg.concurrency
    );
    println!();

    let provider = Arc::new(ProviderBuilder::new().on_http(cfg.rpc.parse().unwrap()));
    let quoter: AlloyAddress = QUOTER_V2.parse().unwrap();

    // Build the block list to scan.
    let mut blocks = Vec::new();
    let mut b = cfg.from;
    while b <= cfg.to {
        blocks.push(b);
        b += cfg.step;
    }
    let total = blocks.len();
    println!("scanning {} blocks...", total);

    // Scan with bounded concurrency.
    let sem = Arc::new(tokio::sync::Semaphore::new(cfg.concurrency));
    let mut handles = Vec::new();
    for block in blocks {
        let permit = sem.clone().acquire_owned().await.unwrap();
        let p = provider.clone();
        let t = cfg.t.clone();
        let cap = cfg.capital;
        let h = tokio::spawn(async move {
            let r = scan_block(&p, quoter, &t, cap, block).await;
            drop(permit);
            (block, r)
        });
        handles.push(h);
    }

    let mut edges: Vec<(u64, f64)> = Vec::new(); // (block, edge_bps)
    let mut errors = 0u64;
    for h in handles {
        let (block, r) = h.await.unwrap();
        match r {
            Ok(edge) => {
                edges.push((block, edge));
            }
            Err(e) => {
                if cfg.verbose {
                    // Print the full error chain (causes) for diagnosis.
                    let mut chain = vec![e.to_string()];
                    let mut src = e.source();
                    while let Some(s) = src {
                        chain.push(s.to_string());
                        src = s.source();
                    }
                    eprintln!("  block {}: {}", block, chain.join(" :: caused by: "));
                }
                errors += 1;
            }
        }
    }

    edges.sort_by_key(|(b, _)| *b);

    // Total fee across the three legs (may differ per leg).
    let total_fee_bps = cfg.t.total_fee_bps();

    let mut profitable = 0usize;
    let mut sum_edge = 0f64;
    let mut max_edge = 0f64;
    let mut positive_after_fee: Vec<(u64, f64)> = Vec::new();
    for &(block, edge) in &edges {
        sum_edge += edge;
        if edge > max_edge {
            max_edge = edge;
        }
        let net = edge - total_fee_bps;
        if net > 0.0 {
            profitable += 1;
            positive_after_fee.push((block, net));
        }
        if cfg.verbose || net > 0.0 {
            println!(
                "  block {:>10}: gross {:8.2} bps, net {:8.2} bps {}",
                block,
                edge,
                net,
                if net > 0.0 { "*** PROFITABLE" } else { "" }
            );
        }
    }

    let n = edges.len();
    println!();
    println!("=== summary ===");
    println!("blocks scanned: {} (errors: {})", n, errors);
    println!(
        "total fee: {:.1} bps (legs {}/{}/{})",
        total_fee_bps,
        cfg.t.fee_ab(),
        cfg.t.fee_bc(),
        cfg.t.fee_ca()
    );
    if n > 0 {
        println!("mean gross edge: {:.2} bps", sum_edge / n as f64);
        println!("max gross edge:  {:.2} bps", max_edge);
        let pct = profitable as f64 / n as f64 * 100.0;
        println!("profitable (net>0): {} / {} ({:.2}%)", profitable, n, pct);
        if profitable > 0 {
            let total_net_bps: f64 = positive_after_fee.iter().map(|(_, e)| *e).sum();
            println!("sum of profitable net edges: {:.2} bps", total_net_bps);
            // Annualized: assume we capture every profitable block.
            // net_return = total_net_bps/1e4 * capital_per_trade. Trades/year.
            let window_blocks = cfg.to - cfg.from;
            let profitable_rate = profitable as f64 / window_blocks as f64; // per block
                                                                            // Arbitrum 0.25s, Polygon/Ethereum 12s/2s. Approx blocks/year:
            let secs_per_block = block_seconds(&cfg.rpc);
            let blocks_per_year = (365.0 * 86400.0) / secs_per_block;
            let trades_per_year = profitable_rate * blocks_per_year;
            // each trade profit = total_net_bps/n_profitable * capital (if uniform)
            let avg_net_bps = total_net_bps / profitable as f64;
            let annualized = (avg_net_bps / 1e4) * trades_per_year * 100.0;
            println!();
            println!(
                "IF we captured every profitable block with ${:.0} each:",
                cfg.capital_human
            );
            println!("  trades/year: {:.0}", trades_per_year);
            println!("  avg net/trade: {:.2} bps", avg_net_bps);
            println!(
                "  annualized return: {:.2}%  (CAPITAL {}, NOT guaranteed)",
                annualized, cfg.capital_human
            );
        }
    }
    println!();
    println!("NOTE: gross edge from on-chain Quoter at sampled blocks. Net = gross - 3xfee.");
    println!("Realistic execution adds slippage (larger capital), bribe, gas, inclusion <100%.");
    Ok(())
}

async fn scan_block(
    provider: &HttpProvider,
    quoter: AlloyAddress,
    t: &Triangle,
    capital: u128,
    block: u64,
) -> Result<f64> {
    let bid = BlockId::from(block);
    // leg1: a->b
    let out1 = quote(provider, quoter, t.a, t.b, capital, t.fee_ab(), bid)
        .await
        .with_context(|| format!("leg1 a->b fee={} @ {}", t.fee_ab(), block))?;
    // leg2: b->c
    let out2 = quote(provider, quoter, t.b, t.c, out1, t.fee_bc(), bid)
        .await
        .with_context(|| format!("leg2 b->c fee={} @ {}", t.fee_bc(), block))?;
    // leg3: c->a
    let out3 = quote(provider, quoter, t.c, t.a, out2, t.fee_ca(), bid)
        .await
        .with_context(|| format!("leg3 c->a fee={} @ {}", t.fee_ca(), block))?;
    // edge in bps = (out3/capital - 1) * 10000
    if capital == 0 {
        return Ok(0.0);
    }
    let out_u = Uint::from(out3);
    let cap_u = Uint::from(capital);
    let ratio_bps = (out_u * Uint::from(10_000u64)) / cap_u;
    let edge = ratio_bps.to::<u64>() as f64 - 10_000.0;
    Ok(edge)
}

/// Call QuoterV2.quoteExactInputSingle((tokenIn,tokenOut,amountIn,fee,sqrtPriceLimitX96))
/// selector = 0xc6a5026a
async fn quote(
    provider: &HttpProvider,
    quoter: AlloyAddress,
    token_in: AlloyAddress,
    token_out: AlloyAddress,
    amount: u128,
    fee: u32,
    block: BlockId,
) -> Result<u128> {
    // Encode the call: selector + tuple fields INLINE (single-arg tuple has no
    // offset word). Matches cast's encoding:
    //   selector + tokenIn + tokenOut + amountIn + fee + sqrtPriceLimitX96
    let mut data = Vec::new();
    data.extend_from_slice(&[0xc6, 0xa5, 0x02, 0x6a]); // quoteExactInputSingle selector
                                                       // tokenIn (address, right-aligned in 32 bytes: 12 zero bytes + 20 addr bytes)
    data.extend_from_slice(&[0u8; 12]);
    data.extend_from_slice(&token_in.into_array());
    // tokenOut
    data.extend_from_slice(&[0u8; 12]);
    data.extend_from_slice(&token_out.into_array());
    // amountIn (uint256)
    let amt = AlloyU256::from(amount);
    data.extend_from_slice(&amt.to_be_bytes::<32>());
    // fee (uint24) right-aligned in 32 bytes
    data.extend_from_slice(&{
        let mut w = [0u8; 32];
        w[29] = (fee >> 16) as u8;
        w[30] = (fee >> 8) as u8;
        w[31] = fee as u8;
        w
    });
    // sqrtPriceLimitX96 = 0
    data.extend_from_slice(&[0u8; 32]);

    let tx = TransactionRequest::default()
        .to(quoter)
        .input(Bytes::from(data).into());
    let res: Bytes = provider
        .call(&tx)
        .block(block)
        .await
        .map_err(|e| anyhow::anyhow!("quoter call failed: {}", e))?;
    // returns uint256 amountOut
    let bytes = res.as_ref();
    if bytes.len() < 32 {
        anyhow::bail!("quoter returned short: {} bytes", bytes.len());
    }
    let out = AlloyU256::from_be_slice(&bytes[0..32]);
    // downcast to u128 (amounts fit)
    Ok(out.to::<u128>())
}

impl Triangle {
    fn clone(&self) -> Self {
        Triangle {
            a: self.a,
            b: self.b,
            c: self.c,
            fee: self.fee,
            fee_ab: self.fee_ab,
            fee_bc: self.fee_bc,
            fee_ca: self.fee_ca,
        }
    }
}

fn block_seconds(rpc: &str) -> f64 {
    if rpc.contains("arb-mainnet") {
        0.25
    } else if rpc.contains("opt-mainnet") {
        2.0
    } else if rpc.contains("base-mainnet") {
        2.0
    } else if rpc.contains("polygon-mainnet") {
        2.0
    } else if rpc.contains("bnb-mainnet") {
        3.0
    } else {
        12.0
    } // ethereum
}

fn mask(u: &str) -> String {
    if let Some(idx) = u.find("/v2/") {
        u.split_at(idx + 4).0.to_string() + "***"
    } else {
        u.to_string()
    }
}

struct Config {
    rpc: String,
    quoter: String,
    t: Triangle,
    capital: u128,
    capital_human: f64,
    from: u64,
    to: u64,
    step: u64,
    concurrency: usize,
    verbose: bool,
}

fn parse_args() -> Result<Config> {
    let mut rpc = std::env::var("RPC_ARBITRUM_URL").unwrap_or_default();
    let mut quoter = QUOTER_V2.to_string();
    let mut ta = String::new();
    let mut tb = String::new();
    let mut tc = String::new();
    let mut fee: u32 = 500;
    let mut fee_ab: u32 = 0;
    let mut fee_bc: u32 = 0;
    let mut fee_ca: u32 = 0;
    let mut capital: u128 = 1_000_000_000; // 1000 USDC (6 dec)
    let mut capital_human: f64 = 1000.0;
    let mut from: u64 = 0;
    let mut to: u64 = 0;
    let mut step: u64 = 100;
    let mut concurrency: usize = 8;
    let mut verbose = false;

    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i < args.len() {
        let v = args[i].as_str();
        let next = || -> Result<String> {
            args.get(i + 1)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("missing value for {}", v))
        };
        match v {
            "--rpc" => {
                rpc = next()?;
                i += 2;
            }
            "--quoter" => {
                quoter = next()?;
                i += 2;
            }
            "--token-a" => {
                ta = next()?;
                i += 2;
            }
            "--token-b" => {
                tb = next()?;
                i += 2;
            }
            "--token-c" => {
                tc = next()?;
                i += 2;
            }
            "--fee" => {
                fee = next()?.parse()?;
                i += 2;
            }
            "--fee-ab" => {
                fee_ab = next()?.parse()?;
                i += 2;
            }
            "--fee-bc" => {
                fee_bc = next()?.parse()?;
                i += 2;
            }
            "--fee-ca" => {
                fee_ca = next()?.parse()?;
                i += 2;
            }
            "--capital" => {
                capital = next()?.parse()?;
                i += 2;
            }
            "--capital-human" => {
                capital_human = next()?.parse()?;
                i += 2;
            }
            "--from" => {
                from = next()?.parse()?;
                i += 2;
            }
            "--to" => {
                to = next()?.parse()?;
                i += 2;
            }
            "--step" => {
                step = next()?.parse()?;
                i += 2;
            }
            "--concurrency" => {
                concurrency = next()?.parse()?;
                i += 2;
            }
            "--verbose" | "-v" => {
                verbose = true;
                i += 1;
            }
            _ => {
                i += 1;
            }
        }
    }

    if rpc.is_empty() || ta.is_empty() || tb.is_empty() || tc.is_empty() || from == 0 || to <= from
    {
        anyhow::bail!("usage: triangle-scan --rpc URL --token-a A --token-b B --token-c C --from N --to M [--fee 500 --capital 1000000000]");
    }

    let a: AlloyAddress = ta.parse()?;
    let b: AlloyAddress = tb.parse()?;
    let c: AlloyAddress = tc.parse()?;

    Ok(Config {
        rpc,
        quoter,
        t: Triangle {
            a,
            b,
            c,
            fee,
            fee_ab,
            fee_bc,
            fee_ca,
        },
        capital,
        capital_human,
        from,
        to,
        step,
        concurrency,
        verbose,
    })
}
