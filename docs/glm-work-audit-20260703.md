# GLM Work Audit and Gap List

Date: 2026-07-03

## 2026-07-07 Continuation Audit

The project has moved well beyond the original GLM skeleton, but the user's
actual objective is still not complete.

Current machine-readable status:

```text
data/pure-arbitrage-search-overview.json
familyCount=8
artifactCount=24
candidateCount=2593
passingCount=0
requestedPassingCount=5
liveExecutionStatus=blocked
```

What is now materially better:

- The app has a `/candidates` surface for pure on-chain search families.
- The API can aggregate artifacts and create dry-run execution plans.
- Users can submit wallet + capital live-run requests, but they are persisted
  as `blocked` until gates pass.
- Fork simulation exists for DEX, Uniswap V3 fee, Curve, Balancer, Aave,
  Compound V3, Morpho current-state, and Morpho historical replay candidates.
- `npm run smoke:pure-live-interfaces` now verifies 8/8 live-interface cases.
- Morpho Blue liquidation evidence was expanded from a small current-state scan
  to 1310 targeted current position candidates plus 992 historical liquidation
  replay candidates.

Most important new evidence:

```text
data/morpho-blue-liquidation-event-replay-candidates-ethereum.json
marketCount=163
candidateCount=992
passingCount=0
historicalStabilityPassedButLiveBlockedCount=147
historicalStabilityPassedButLiveBlockedMarketCount=11
durationDays=62.70
```

Interpretation: Morpho now has more than five historically attractive
liquidation markets in the replay layer, but these are not live-runnable
strategies yet. They remain blocked because the system has not found current
liquidatable borrowers that are economically meaningful after gas and that pass
same-block fork simulation plus collateral unwind checks. The targeted current
scan did find one technically liquidatable USDC/WETH borrower, but the debt is
only about 0.00058 USD and estimated net profit is about -20 USD after gas.
The fork interface now reports this precise condition as
`morpho-blue-liquidation-profitability-gate-blocked`, so the live path blocks
for profitability rather than pretending that calldata alone is the blocker.
The new `morpho-blue-liquidation-watchlist-ethereum.json` artifact narrows
current monitoring to 10 borrowers in historically stable markets
(`liquidatable=1`, `nearLiquidation=4`, `watch=5`), all still blocked by current
profitability or threshold gates.

Hard gaps that still contradict completion:

1. No pure on-chain strategy currently passes the 5-strategy / 20%+ / stable
   evidence gate.
2. Live execution must remain blocked; the current system correctly refuses to
   route user funds.
3. Liquidation strategies still need a current opportunity detector plus
   production liquidation/collateral-unwind adapters.
4. DEX/Curve/Balancer/Uniswap V3 fee routes are still after-gas negative under
   fork rehearsal.
5. The product must not present historical liquidation replay as guaranteed APY
   or as immediately available user yield.

Next best engineering work:

1. Build a current-opportunity Morpho watcher seeded by the 11 historically
   stable markets, then fork-simulate current borrowers before each live run.
2. Add DEX collateral-unwind quoting for Morpho liquidation candidates.
3. Add private transaction/bundle submission support for liquidation execution
   only after fork profit is positive.
4. Continue widening liquidation event history through paid/archive RPC or
   protocol-indexed APIs.
5. Keep the live UI blocked until a candidate passes both historical and
   current-state gates.

## Executive Summary

GLM created a useful monorepo skeleton and several tested low-level modules, but it did not finish the product requested by the user.

The most important factual finding is:

- The repo's own `docs/arbitrage-search-results.md` says no public-RPC-reachable pure on-chain arbitrage strategy was found with gas-positive, capacity-meaningful 20%+ annualized return.
- The later `docs/high-apy-strategies.md` pivots from arbitrage to LP / market-making / yield pools. Those can be valid on-chain candidates, but they are not pure arbitrage and carry impermanent-loss, peg, liquidity, and protocol risk.

Therefore the system must keep two concepts separate:

1. Pure arbitrage models: atomic AMM, MEV backrun, liquidation, cross-chain inventory.
2. On-chain 20%+ candidates: LP / market-making / yield strategies whose APY is observable on-chain, but is not guaranteed and is not risk-free arbitrage.

## Verified Working Pieces

Commands run on the WSL server:

```bash
export PATH=$HOME/.cargo/bin:$HOME/.foundry/bin:$PATH
cd /home/bumblebee/Project/on-chain-arbitrage
cargo test --workspace
```

Result:

- `strategy-core`: 15 tests passed.
- `backtest-engine`: 7 tests passed.
- `execution-router`: 8 tests passed.

```bash
export PATH=$HOME/.cargo/bin:$HOME/.foundry/bin:$PATH
cd /home/bumblebee/Project/on-chain-arbitrage/contracts
forge test -vv
```

Result:

- `ArbVault.t.sol`: 7 tests passed.
- `StrategyExecutor.t.sol`: 4 tests passed.

Direct TypeScript checks also passed with the repo-local `tsc` binary:

```bash
./node_modules/.bin/tsc -p packages/sdk/tsconfig.json --noEmit
./node_modules/.bin/tsc -p packages/strategy-models/tsconfig.json --noEmit
./node_modules/.bin/tsc -p apps/api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p apps/workers/tsconfig.json --noEmit
./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit
```

The WSL server can reach DeFiLlama:

```bash
node -e 'fetch("https://yields.llama.fi/pools").then(r=>console.log(r.status))'
```

Result: `200`.

## Major Gaps

### 1. No five verified pure arbitrage strategies

The repo searched public AMM spreads, triangles, cross-DEX, liquidation windows, cross-chain inventory, and prediction-market snapshots. The documented result is no gas-positive, capacity-meaningful, stable 20%+ pure arbitrage strategy.

This is not a code bug; it is a market reality. The product should not claim otherwise.

### 2. Backtest worker writes placeholder results

`apps/workers/src/workers/queueWorkers.ts` marks backtests as done with:

```json
{
  "totalNetProfit": "0",
  "tradeCount": 0,
  "annualizedReturnPct": 0,
  "note": "placeholder until backtest-engine binary is wired"
}
```

This is not a real backtest.

### 3. API backtest creation does not enqueue work

`POST /api/backtests` inserts a `backtest_runs` row but does not add a BullMQ `backtest` job. Unless a separate manual job is created, the run stays queued.

### 4. Strategy models are mostly interface stubs

`BaseStrategyModel.quote()` throws `not implemented`.

`BaseStrategyModel.simulate()` always returns `success: false`.

`BaseStrategyModel.buildTx()` returns a demo transaction to address zero.

The specific models are therefore not live execution ready.

### 5. Indexer is a heartbeat, not a market-data indexer

`indexerWorker.ts` polls latest block and writes a marker. It does not decode swaps, pool states, liquidation events, or MEV orderflow.

### 6. Web wallet flow was placeholder-only

`apps/web/src/app/vaults/[id]/page.tsx` showed deposit and withdraw buttons, but only wrote text such as "deposit requires a connected wallet". It did not connect a wallet or send approve/deposit transactions.

### 7. Contract execution path is incomplete for real capital routing

`StrategyExecutor.execute()` assumes the principal is already in the executor:

```solidity
require(balStart >= req.principal, "StrategyExecutor: principal not present");
```

There is no audited vault-to-executor allocation flow yet. Tests fund the executor directly.

### 8. High APY strategy document is not wired into the app

The five high-APY LP/yield candidates in `docs/high-apy-strategies.md` were not available through API, frontend, workers, or a reproducible search script.

### 9. Runtime environment is inconsistent

The server has Rust and Foundry under:

```text
~/.cargo/bin
~/.foundry/bin
```

but non-login SSH commands do not include them in `PATH`. System Node is v18.19.1 and `pnpm` is not globally available, though the repo has `node_modules`.

## Patch Direction

The next patches should make the project honest and incrementally usable:

1. Add a reproducible DeFiLlama candidate search script.
2. Commit the current candidate snapshot and evidence backtest artifact.
3. Expose candidates via API and frontend.
4. Label each candidate as `pure-arbitrage`, `lp-market-making`, or `yield`.
5. Add live-interface status per candidate, so users can see whether execution is paper, local Anvil, or mainnet-ready.
6. Make wallet approve/deposit work for registered ERC-4626 vaults via injected `window.ethereum`.
7. Replace README completion claims with evidence-backed statuses.

The full user objective remains larger: a production-grade wallet-to-running-strategy product. The current repo is not there yet.
