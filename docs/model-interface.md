# Strategy Model Interface

Every arbitrage model plugs into backtesting, simulation and live execution through one interface. This document is the canonical spec (mirrors design §6) and the onboarding guide for adding a new strategy.

## 1. The interface (TypeScript)

```ts
export interface StrategyModel {
  /** Stable unique id, e.g. "atomic-amm-v1". */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Semantic version of the model logic. */
  version: string;
  /** Chain ids this model can run on. */
  supportedChains: number[];
  /** Vault asset addresses this model accepts (e.g. USDC, WETH). */
  supportedAssets: `0x${string}`[];
  /** How the model gets its capital. */
  capitalMode: 'flash-loan' | 'vault-capital' | 'inventory';
  /** UI risk classification. */
  riskClass: 'low' | 'medium' | 'high' | 'experimental';

  /** Scan the market and emit candidate opportunities. */
  discover(ctx: MarketContext): Promise<Opportunity[]>;
  /** Price an opportunity precisely for a given capital size. */
  quote(input: Opportunity, capital: bigint): Promise<Quote>;
  /** Simulate a full execution plan on a fork (revm/Anvil). */
  simulate(input: ExecutionPlan): Promise<SimulationResult>;
  /** Build the on-chain transaction request for an approved plan. */
  buildTx(input: ExecutionPlan): Promise<TransactionRequest>;
  /** Score a simulation result (used for ranking + admission). */
  score(result: SimulationResult): StrategyScore;
}
```

The Rust-side equivalent lives in `crates/strategy-core::types`. The napi bridge keeps them in sync.

## 2. Canonical types

### `Opportunity`

| Field | Type | Meaning |
|---|---|---|
| `chainId` | number | Chain where the opportunity exists |
| `blockNumber` | bigint | Block at which it was observed |
| `modelId` | string | Owning model |
| `assetIn` | address | Entry asset |
| `capitalRequired` | bigint | Capital needed |
| `expectedProfit` | bigint | Gross expected profit (assets) |
| `expectedGas` | bigint | Gas estimate |
| `expectedBribe` | bigint | Bribe estimate |
| `netProfit` | bigint | Profit after costs |
| `route` / `pools` | Route / PoolRef[] | Execution path |
| `confidence` | number | 0..1 model confidence |
| `ttlBlocks` | number | How many blocks this stays valid |
| `riskFlags` | RiskFlag[] | E.g. long-tail token, thin liquidity |

### `Quote`

`amountIn`, `amountOut`, `minAmountOut`, `priceImpact`, `liquidityUsed`, `costBreakdown { gas, bribe, fee }`.

### `ExecutionPlan`

`opportunityId`, `route`, `capital { source, amount, flashLoanProvider? }`, `minProfitAssets`, `deadline`, `maxGasCost`.

### `SimulationResult`

`success`, `blockNumber`, `gasUsed`, `balanceDeltas` (per token), `trace`, `failureReason?`, `netProfit`.

### `StrategyScore`

`netProfit`, `score` (0..1), `confidence`, `capacityFit`, `riskAdjustedReturn`.

## 3. Model lifecycle (all models must satisfy)

1. **Deterministic replay** — given the same block state + manifest, `discover → quote → simulate` produces the same result.
2. **Failure reason output** — every failed sim/quote emits a structured reason.
3. **No live execution before sim passes** — the execution worker only acts on approved sims.
4. **Individually pausable** — each model can be paused independently via the registry.

## 4. Models in this repo

| Id | Name | Phase | Capital mode |
|---|---|---|---|
| `atomic-amm` | Atomic AMM Arbitrage (Model A) | MVP | flash-loan / vault-capital |
| `mev-backrun` | MEV-Share Backrun (Model B) | MVP | flash-loan / vault-capital |
| `peg-lst` | Peg / LST / Stable (Model E) | MVP (small size) | vault-capital |
| `solver-spread` | Solver Spread Capture (Model C) | phase 2 | inventory |
| `liquidation` | Liquidation Arbitrage (Model D) | phase 2 | flash-loan / vault-capital |
| `crosschain-inventory` | Cross-chain Inventory (Model F) | phase 3 | multi-chain inventory |
| `yield-rotator` | Yield Rotator (Model G) | MVP (cash mgmt, labeled "not arbitrage") | vault-capital |

## 5. Adding a new model

1. Create `packages/strategy-models/src/models/<your-model>.ts` implementing `StrategyModel`.
2. Register it in `packages/strategy-models/src/registry.ts`.
3. Add any DEX/pool quoting math to `crates/strategy-core` if it's hot-path (then expose via napi). Keep TS thin.
4. Add contract adapters in `contracts/src/adapters/` if the model needs a new swap venue.
5. Add tests: deterministic replay test, fuzz test on quote math, fork sim test on the target chain.
6. Add a backtest template (`packages/config`) with Conservative/Balanced/Aggressive defaults.
7. Pass the admission gate in [`risk-policy.md`](./risk-policy.md) §4 before any "target 20%+" label.
