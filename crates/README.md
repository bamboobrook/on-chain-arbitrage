# Rust Cores

High-performance engines shared by backtest and live execution. The single source of truth for pricing and simulation; the TS apps orchestrate.

| Crate | Responsibility |
|---|---|
| `strategy-core` | Canonical types + DEX math (V2 constant product, V3 local-liquidity approximation, Curve StableSwap guarded Newton, Balancer weighted) + cyclic-arbitrage graph search (negative-log weights, modified Bellman-Ford with simple-cycle validation). |
| `backtest-engine` | Block-level state replay, revm/Anvil-style simulation trait + MathSimulator, cost model (gas/bribe stress, inclusion sampling, failure cost), anti-overfit (walk-forward, capacity curve), metrics (equity curve, drawdown, annualized return, Sharpe, daily PnL). |
| `execution-router` | Tx construction, nonce tracker, EIP-1559 gas oracle, private-relay multiplexer (Flashbots/Beaverbuild/Titan/RPC + DemoRelay for Anvil), tx lifecycle state machine. |

## Build & test

```bash
cargo build --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

## Bridge to TS

A future `crates/napi` (napi-rs) will expose the hot functions to `packages/sdk`. For the MVP the worker delegates heavy work via the API gateway which calls these crates' binaries / functions.

## Notes on precision

- V2 math is exact (integer constant product).
- V3 uses a locally-linear approximation around the active tick for discovery/ranking; exact tick-by-tick stepping and on-chain `swap` are re-validated via revm/Anvil fork simulation (`backtest-engine::simulator`).
- Curve uses guarded Newton with a near-1:1 fallback; Balancer weighted uses a fixed-point Taylor power for the general case and the exact constant-product path for equal weights.
