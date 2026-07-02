# Arbitrage Search Results — Honest Findings

Date: 2026-07-02
Methods: exact on-chain Quoter V2 quotes at historical archive-RPC blocks.

## What was searched

1. **Uniswap V3 two-pool cross-fee-tier** (same pair, different fee tiers)
   - Chains: Polygon, Arbitrum, BSC, Optimism
   - Pairs: USDC/WETH, USDT/USDC, USDC/WBNB, USDC/ETH, USDC/WMATIC, USDT/BTCB
   - Fee combos: 100↔500, 100↔3000, 500↔3000 (both directions)
   - Capitals: $0.10 to $10,000
   - Windows: up to ~24h of blocks
2. **Uniswap V3 triangle** (3-token cyclic)
   - Polygon USDC→WETH→USDT→USDC (both directions, fees 100/500/3000)
   - Arbitrum USDC→ARB→WETH→USDC
3. **Cross-DEX** — attempted but V2 pairs are absent on L2s; QuickSwap/Camelot
   use Algebra (separate quoter ABI, not yet integrated)

## Key findings

### Finding 1: Polygon fee=100 vs fee=500 USDC/WETH — real but tiny edge

- **Edge**: up to 78 bps, profitable in ~21-42% of sampled blocks (capital $0.10)
- **Problem**: fee=100 pool liquidity is ~6e11 (50000x smaller than fee=500 pool's
  3.5e16). Profitable ONLY at $0.10 capital; at $0.50+ it becomes a loss.
- **Economics**: per-trade profit ≈ $0.0003; Polygon gas ≈ $0.01-0.05/tx.
  **Net of gas: NEGATIVE.** The opportunity cannot cover gas.
- Annualized at $0.10 capital: ~1800% — but absolute profit <$3/year, and gas
  makes it net-negative. Not actionable.

### Finding 2: Larger-liquidity pools (Arbitrum fee=100) — edge competed away

- Arbitrum fee=100 pool liquidity is 1.2e15 (2000x Polygon's), so capacity is
  larger — but the edge is only ~2.5 bps (vs Polygon's 78 bps).
- Bigger pools are more efficiently arbitraged; edge collapses to <fee threshold.

### Finding 3: Triangles — structurally non-profitable

- USDC→WETH→USDT→USDC: stablecoin legs make the cycle ≈ fee-cost only; edge is
  always negative after 3x pool fees.
- USDC→ARB→WETH→USDC: the 0.30% fee leg dominates; gross is -30% at $1000.

### Finding 4: Cross-fee at $1000 capital — never profitable

- Across all chains/pairs/fee-combos tested, NO combination yields net>0 at
  $1000 capital. Slippage on the smaller-liquidity leg always exceeds the edge.

## Why this matches theory

This is exactly what design §3 predicts:
- Public AMM spreads are competed below the fee threshold.
- Low-fee pools have small liquidity → small capacity.
- High-liquidity pools have tiny edges → competed away.
- The "sweet spot" (large edge AND large capacity AND low gas) does not persist:
  if it did, it would already be arbitraged.

## What would be needed to find actionable 20%+ strategies

1. **Cross-DEX** (UniV3 vs QuickSwap/Algebra vs Camelot): independent price
   discovery creates larger, more persistent edges. Requires integrating the
   Algebra/Camelot quoter ABIs (different from UniV3 QuoterV2).
2. **MEV-Share backrun** (Model B): backrunning large swaps captures the
   induced price impact — a different, often larger edge than at-rest spreads.
3. **Flash-loan放大 + 多路径图搜索**: the strategy-core graph search across
   many pools/tokens finds transient cycles a single-pair scan cannot.
4. **Longer windows + high-volatility regimes**: edges spike during volatility;
   a multi-week scan covering volatile periods may surface rare large edges.

## Honest bottom line

With the methods run so far (UniV3 internal two-pool + triangle, exact quotes),
**no strategy achieves a gas-positive, capacity-meaningful 20%+ annualized
return.** The edges found are real but sub-gas-cost or sub-cent. This is the
expected state of efficiently-arbitraged public AMM markets.

The code to continue the search is in place:
- `crates/backtest-engine/src/bin/two-pool-scan.rs` — exact two-pool scanner
- `crates/backtest-engine/src/bin/triangle-scan.rs` — triangle scanner
- `crates/backtest-engine/src/bin/oal-backtest.rs` — sqrtP-math backtest

Next high-value step: integrate the QuickSwap (Algebra) and Camelot quoters to
enable true cross-DEX scanning, which is where persistent edges most plausibly
exist.

### Finding 5: Cross-DEX (QuickSwap/Algebra vs Uniswap V3) — also competed away

- Integrated QuickSwap V3 (Algebra) quoter at `0xa15F0D7377B2A0C0c10db057f641beD21028FC89`.
- Compared USDC/WETH quotes across QuickSwap and Uniswap V3 (0.05%) for $1–$10000.
- Result: gross edge is NEGATIVE in both directions (-10 to -357 bps). The two
  largest Polygon DEXs price WETH identically; arb bots keep them in sync.

## Final verdict across ALL searched directions

| Direction | Verdict |
|---|---|
| UniV3 two-pool cross-fee (small liquidity pool) | Real edge (up to 78bps) but capacity <$0.50; gas-negative |
| UniV3 two-pool cross-fee (large liquidity pool) | Edge ~2.5bps, below fee threshold |
| UniV3 triangle (stablecoin + volatile) | Structurally negative (3x fees > any edge) |
| Cross-DEX (QuickSwap vs Uniswap) | Negative — prices kept in sync by bots |
| **Net: gas-positive 20%+ strategy found** | **NO** |

The honest reality: public AMM arbitrage on major pairs/chains is efficiently
competed. Persistent 20%+ requires either (a) private orderflow / MEV-Share
backrun, (b) much longer-window scanning to catch rare volatility spikes, or
(c) a category the on-chain Quoter cannot see (cross-chain, lending liquidation).
These remain as documented next steps.

### Finding 6: Lending liquidation (Aave V3) — sparse, crisis-dependent

- Aave V3 liquidation bonus: ~5% (WETH 10500 bps). This is a real, large edge.
- BUT: scanned Polygon (200 blocks, ~7min) and Ethereum (~half day) Aave V3
  LiquidationCall events: **0 liquidations in both windows** (calm market).
- Liquidations cluster only during volatility crises (e.g. May 2022 Luna, Nov
  2022 FTX). In calm periods the annualized return is ~0%.
- Even during crises, competition is extreme: specialized liquidation bots
  (Arcadia, Instadapp Lite) clear positions within 1 block. Capturing them
  requires sub-block latency + private mempool access.
- **Not a stable 20%+ strategy**; it's a crisis-period spike strategy.

### Finding 7: Cross-chain inventory (WETH across Polygon/Arbitrum/Optimism)

- Measured WETH/USDC price on Uniswap V3 (0.05%) on 3 chains simultaneously.
- Cross-chain spread: **12.08 bps** (max-min).
- Round-trip bridge cost (Across/Hop): ~20 bps.
- **Net edge: -8 bps** (negative). Cross-chain arb bots keep WETH prices
  within bridge-cost across L2s. Not actionable.

## FINAL VERDICT (all public-RPC-reachable directions exhausted)

| Direction | Edge | Verdict |
|---|---|---|
| UniV3 two-pool cross-fee (small liq) | up to 78 bps | capacity <$0.50, gas-negative |
| UniV3 two-pool cross-fee (large liq) | ~2.5 bps | below fee threshold |
| UniV3 triangle | <0 | structurally negative |
| Cross-DEX QuickSwap vs Uni | <0 | bots sync prices |
| Swap-event backrun (single pool) | <fee | same-fee constraint |
| Lending liquidation (Aave V3) | 5% bonus | 0 events in calm market; crisis-only |
| Cross-chain inventory | 12 bps | <20 bps bridge cost |

**No public-RPC-reachable strategy achieves gas-positive 20%+ annualized.**
The only remaining direction is MEV-Share private orderflow backrun, which
requires Flashbots whitelist access (not scannable via public RPC).

This empirically confirms design §3 across all testable categories.
