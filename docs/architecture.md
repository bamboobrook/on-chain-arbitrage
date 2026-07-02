# Architecture

This document expands on the system design in [`design.md`](./design.md) §4–§9 and describes how the repository implements it.

## 1. Two-language split: why Rust + TypeScript

| Concern | Where | Why |
|---|---|---|
| DEX math (V2/V3/Curve/Balancer quoting), cyclic graph search, revm fork simulation, cost modeling, tx building | Rust (`crates/`) | CPU-bound, hot loops, parallelizable (rayon). Single canonical implementation shared by backtest + live. |
| API gateway, workers orchestration, web UI, wallet interaction, queue management | TypeScript (`apps/`, `packages/`) | Rich async I/O ecosystem, wallet libraries (wagmi/viem), fast UI iteration. |

### Bridge: napi-rs

`crates/napi` compiles selected Rust functions into a Node native addon consumed by `packages/sdk`:

```
crates/strategy-core   ─┐
crates/backtest-engine ─┼─►  crates/napi  ─►  @oal/sdk (TS)  ─►  apps/*
crates/execution-router─┘                  (native .node binary)
```

This avoids duplicating DEX math or simulation logic in two languages. The TS `StrategyModel` interface (see [`model-interface.md`](./model-interface.md)) is the single contract every model implements; the Rust cores are the performance engine behind it.

For heavy long-running jobs (large backtests), the Rust binaries can also run as standalone CLIs / sidecars instead of in-process.

## 2. Data flow

### 2.1 Indexing (continuous)

```
Archive RPC ──► indexer-worker ──► ClickHouse(swaps, pool_states, pool_events)
                             └──► Postgres(vaults, strategies, executions)
                             └──► Timescale(share_price_ts, pnl_ts, metrics_ts)
```

The indexer tracks new blocks, swaps, mint/burn, oracle updates and liquidation events for whitelisted pools. Pool state is materialized in ClickHouse for both the opportunity workers and the backtest engine.

### 2.2 Opportunity → simulation → execution (per block / per event)

```
opportunity-worker (model.discover)
   └─► opportunity queue (Redis/BullMQ)
         └─► simulation-worker (revm/Anvil fork sim)
               └─► risk-worker (limits check)
                     └─► execution-worker (build tx, private submit)
                           └─► accounting-worker (parse events, update PnL)
```

Every step emits DB rows so any live trade can be traced end-to-end: `opportunity → execution → on-chain events → accounting → share price`.

### 2.3 Backtest (on demand)

```
POST /api/backtests
   └─► backtest-engine (Rust)
         ├─ load historical pool state (ClickHouse / archive RPC)
         ├─ per block: model.discover → quote → revm sim
         ├─ apply cost model (gas/bribe/failure/inclusion/competition)
         ├─ walk-forward + capacity + cost-stress
         └─ emit manifest + metrics + equity curve
```

## 3. Contract layer

See `contracts/src/`. The on-chain layer is deliberately minimal and defensive:

- **`ArbVault`** (ERC-4626): user funds in/out, shares, performance fee, emergency pause.
- **`StrategyController`**: maps vault↔strategy, enforces capital caps, daily-loss caps, executor whitelist.
- **`StrategyExecutor`**: executes whitelisted routes only; verifies `minProfitAssets`; repays vault principal + profit; reverts if profit below threshold.
- **`FlashLoanAdapter`**: Aave V3 / Balancer Vault / Uniswap flash-swap callbacks.
- **`DexAdapter`**: V2/V3/Curve/Balancer swap wrappers.
- **`RiskManager`**: per-tx and per-day loss caps, per-token/per-DEX exposure, allowed chains, blacklist, dynamic pause.
- **`Accounting`**: realized profit / fee ledger with events for the indexer.
- **`TimelockController`**: parameter changes; multisig for fast pause.

Security rules from design §5.2 are enforced in code: whitelisted adapters only, no arbitrary `call`, SafeERC20, before/after balance checks, profit judged by final asset balance (not oracle), rejection of fee-on-transfer / rebasing / blacklist tokens, `minProfitAssets` in calldata.

## 4. Worker topology

| Worker | Trigger | Output |
|---|---|---|
| `indexer-worker` | new block / log | pool state rows |
| `opportunity-worker` | new block | candidate opportunities queue |
| `simulation-worker` | queued opportunity | simulation result + trace |
| `execution-worker` | risk-approved sim | submitted tx / bundle |
| `risk-worker` | continuous | risk events, pauses |
| `accounting-worker` | new tx receipt | PnL, share price, fees |

All workers are BullMQ consumers on Redis with graceful shutdown, health checks and concurrency control.

## 5. Networks (MVP)

| Chain | Chain ID | Role |
|---|---|---|
| Base | 8453 | Primary low-cost venue |
| Arbitrum | 42161 | Secondary, deep DeFi liquidity |
| Anvil (local) | 31337 | All dev/demo flows |

Ethereum mainnet, Optimism, Polygon, BNB Chain are future extensions (see `packages/config`).
