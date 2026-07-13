# Current Runbook

Created: 2026-07-03
Last updated: 2026-07-08

This runbook describes the current, verified state after the audit/fix pass.

## What Works Now

1. Low-level Rust tests pass.
2. Solidity vault/executor unit tests pass.
3. TypeScript checks pass for config, strategy models, API, workers, and web.
4. `scripts/search-high-apy-strategies.mjs` fetches DeFiLlama Yields and writes:
   - `data/strategy-candidates.json`
   - `docs/current-20apy-candidates.md`
5. API exposes:
   - `GET /api/strategy-candidates`
   - `GET /api/strategy-candidates/artifact`
   - `POST /api/strategy-candidates/:id/execution-plan`
   - `POST /api/strategy-candidates/:id/live-runs`
   - `GET /api/live/runs`
   - `GET /api/live/runs/:id`
   - `GET /api/live/runs/:id/preflight`
6. Web exposes:
   - `/candidates`: shows the 5 current 20%+ candidates.
   - `/candidates`: can prepare a dry-run live execution plan for each candidate.
   - `/candidates`: can create a live run request from an injected wallet address and capital input.
   - `/backtests/new`: accepts optional `candidateId`.
   - `/vaults/:id`: can build injected-wallet ERC20 approve + ERC-4626 deposit transactions for a registered vault.
7. Workers can convert queued `lp-market-making` / `yield-rotator` backtest runs into evidence-style metrics from the candidate snapshot.
8. Workers can preflight queued live run requests and mark unsafe/incomplete runs as `blocked` with explicit blockers, a structured `live_run_preflights` report, and a `risk_events` audit trail.
9. Uniswap V3 live preflight can produce a read-only mint parameter preview with tick range, token decimals, desired/min base-unit amounts, selector, deadline, and recipient.
10. Uniswap V3 live preflight can run `eth_estimateGas` for preview calls. Approval calls can be estimated before allowance exists; mint estimates are captured as blocked with the RPC revert reason until approvals, final quote, fork simulation, and risk gates pass.
11. Gas preflight now reads `eth_gasPrice`, resolves the native token USD price, computes per-call and total estimated gas cost in USD, and checks the result against the user-provided `maxGasUsd` risk limit.
12. The API exposes `POST /api/live/runs/:id/rerun-preflight` so a user can approve tokens, wait for confirmation, and explicitly queue a fresh read-only worker preflight. The web live-run panel exposes this as `Rerun preflight`.
13. Token price preflight now retries DeFiLlama price reads and has conservative fallbacks for common stablecoins, WETH/ETH, and BTC wrappers. These fallbacks are for preflight input generation only, not final execution quotes.
14. Worker preflight now includes a read-only `callSimulation` section. It runs `eth_call` for each preview call from the user wallet and captures pass/revert status plus revert reasons. This is not ordered fork simulation; approval state does not carry from one simulated call into the mint call.
15. Uniswap V3 mint preview now uses pool-aware range math: current `sqrtPriceX96`, integer TickMath, selected tick range, and the user's available token amounts are converted into liquidity and expected token consumption before min amounts are set.
16. `scripts/fork-simulate-live-run.mjs <runId>` starts an Anvil fork, impersonates the run wallet, applies the preview calls in order, and verifies approval state carries into the Uniswap V3 mint. The full live-run smoke now includes this ordered fork simulation unless `SMOKE_SKIP_FORK=1`.
17. API exposes `POST /api/live/runs/:id/fork-simulation`, which runs the same ordered Anvil fork simulation and returns `status`, `exitCode`, `summary`, optional parsed `details`, `stdout`, and `stderr`. The `/candidates` live-run panel exposes this as `Run fork simulation`.
18. Ordered fork simulation results are persisted in `live_run_fork_simulations` via migration `005_live_run_fork_simulations.sql`. `GET /api/live/runs/:id` returns `latest_fork_simulation`, so the `/candidates` panel can display the latest fork result after refresh.
19. `GET /api/live/runs/:id` also returns a derived `readiness` gate report. It shows which gates have passed and which still block real execution. A passed fork simulation is only one gate; the current Base WETH/USDC candidate remains blocked by missing real profitability replay, disabled production adapter execution, and lack of pure-arbitrage verification.
20. Pure on-chain arbitrage live-run requests now produce an explicit failed fork-simulation report when the plan is still dry-run only. The report is blocked with `reason=pure-on-chain-plan-needs-calldata` and includes the plan blockers plus fork requirements; it does not imply the strategy is executable or profitable.
21. `npm run smoke:pure-live-interfaces` verifies the dry-run live interface for eight runnable pure on-chain cases: DEX quote replay, Uniswap V3 cross-fee arbitrage, Curve stable arbitrage, Balancer V2 arbitrage, Aave V3 current-state liquidations, Compound V3 liquidations, Morpho Blue current-state liquidations, and Morpho Blue liquidation replay. The expected current result is eight interface passes with live execution still `blocked`.
22. DEX quote replay fork simulation now has a direct-route rehearsal path for all-Uniswap-V3 routes. On an Anvil fork it temporarily funds the run wallet with the start token, refreshes same-block Uniswap V3 quotes, builds ERC20 `approve` plus SwapRouter02 `exactInputSingle` calldata, sends each hop, and records final PnL. It also deploys `StrategyExecutor` plus `UniswapV3Adapter`, configures a rehearsal vault/adapter whitelist, injects principal into the executor, and proves the same route reverts through the loss-reverting executor path when it is unprofitable.
23. Curve stable and Balancer V2 arbitrage fork simulations now have mixed-route executor rehearsals. The simulator refreshes same-block Uniswap V3, Curve `get_dy`, or Balancer V2 Vault `queryBatchSwap` quotes, deploys fork-only `StrategyExecutor` plus the required adapters, funds the executor, builds `execute(...)` calldata, and verifies the unprofitable mixed routes revert atomically. Latest verified reasons are `curve-mixed-route-net-loss-reverted` and `balancer-mixed-route-net-loss-reverted`.
24. Aave V3 liquidation fork simulation now has a protocol gate check plus a flash-loan executor rehearsal report. The simulator starts an Ethereum fork, reads `getUserAccountData(address)` from the Aave V3 Pool for the candidate borrower, builds a 164-byte `liquidationCall(address,address,address,uint256,bool)` preview, deploys `AaveV3LiquidationExecutor`, builds a 420-byte `executeLiquidation(...)` preview, and blocks with `aave-liquidation-health-factor-not-below-one` / `withheld-health-factor-not-below-one` when the borrower is not liquidatable. Latest smoke saw `healthFactor=1.057251`, so both calldata previews are recorded but must not be submitted.
25. Compound V3 liquidation fork simulation now has a protocol gate check. The simulator starts an Ethereum fork, reads `isLiquidatable(address)` from the Comet contract for the candidate borrower, and blocks with `compound-v3-liquidation-account-not-liquidatable` when the account is not liquidatable. Latest smoke saw `isLiquidatable=false`, so no `absorb` / `buyCollateral` calldata should be built or submitted for that candidate.
26. Morpho Blue liquidation fork simulation now has a protocol gate check. The simulator starts an Ethereum fork, reads Morpho `position(bytes32,address)`, `market(bytes32)`, and oracle `price()`, recomputes borrow assets versus collateral value times LLTV, and blocks with `morpho-blue-liquidation-ltv-below-lltv` when the position is below threshold. Latest smoke saw `ltv=0.4917`, `lltv=0.86`, and `liquidatable=false`.
27. `/candidates` now shows an injected-wallet status panel. It reads `eth_accounts` / `eth_chainId`, listens for account and chain changes, exposes an explicit `Connect wallet` action, and keeps the displayed wallet in sync when plan/run actions call `eth_requestAccounts`.
28. Aave V3 liquidation watchlist is now wired end to end. `npm run watch:aave-liquidations` reads the current Aave scan and the historical replay artifact, maps the five historical gate-passing debt/collateral pairs to current borrowers, and writes `data/aave-liquidation-watchlist-ethereum.json`. The API exposes `GET /api/aave-liquidation-watchlist`, `/candidates` shows the panel, and workers can refresh it periodically unless `AAVE_WATCHER_DISABLED=1`.
29. Aave V3 liquidation execution plans now include a `liquidationCall(address,address,address,uint256,bool)` calldata preview when the current scan can estimate `debtToCover` in debt-token base units. The calldata is shown in `/candidates` and returned by `POST /api/aave-liquidation-candidates/:id/execution-plan`; it remains a pre-fork preview and must be regenerated at the execution block.
30. `AaveV3LiquidationExecutor` now has a targeted Foundry test suite. It proves a profitable mock Aave flash-loan liquidation pays profit, insufficient profit reverts atomically, non-pool callbacks are rejected, and unwhitelisted unwind targets are rejected.
31. `npm run smoke:aave-fork-calldata` verifies the Aave plan/run/fork path specifically: execution plan `liquidationCall` bytes, execution plan `executeLiquidation(...)` bytes, parsed fork `liquidationCall` preview, fork deployment of `AaveV3LiquidationExecutor`, fork executor calldata bytes, and the health-factor withholding flag all pass while live execution remains blocked.
32. `WalletAtomicArbitrageExecutor` now supports wallet-funded pure DEX routes. A connected wallet approves the start token, the executor pulls funds, routes only through whitelisted adapters, requires the route to close back into the start token, and reverts unless `minProfitAssets` is met. The DEX execution plan can resolve this executor from `WALLET_ATOMIC_ARB_EXECUTOR_ADDRESS`, `DEX_ARB_EXECUTOR_ADDRESS`, or `data/executor-deployments.json`.
33. DEX quote replay, Uniswap V3 fee-route, Curve stable, and Balancer V2 fork rehearsals now deploy `WalletAtomicArbitrageExecutor` on the fork, whitelist the needed adapter contracts, approve the start token from the connected wallet, and call `execute(...)`. Current routes still revert because same-block net profit is negative, which is the desired loss-reverting behavior.
34. The canonical Base DEX quote-replay candidate now exercises an Aerodrome
stable hop in fork rehearsal. The simulator refreshes same-block Uniswap V3
and Aerodrome Router quotes, deploys `AerodromeRouterAdapter`, whitelists it in
`WalletAtomicArbitrageExecutor`, and verifies the route reverts with
`aerodrome-mixed-route-net-loss-reverted` when it is unprofitable.
35. `CompoundV3LiquidationExecutor` now has a unit-tested wallet-funded
execution path. A connected wallet approves the Comet base asset, the executor
checks `isLiquidatable`, calls `absorb`, buys discounted collateral via
`buyCollateral`, unwinds through whitelisted DEX adapters, and reverts unless
the final base-asset profit floor is met.

## Important Limitation

Historical pure-arbitrage evidence and live readiness are now separate gates.
The latest Aave V3 liquidation event replay has five historical candidates
above the 20%+ annualized evidence gate, but none are live-ready. They are
historical liquidation events, not current executable opportunities. Production
execution remains blocked until current liquidatable borrowers, real calldata,
fresh quotes, fork simulation, and loss-reverting settlement pass.

The non-arbitrage LP / market-making / yield candidates still carry IL, range,
gas, protocol, peg, and liquidity risks and must not be mixed into the pure
arbitrage gate.

## Latest Expanded Pure-Arbitrage Search

Verified on 2026-07-08:

```text
families=9
artifacts=34
candidates=2789
historicalEvidencePassing=5/5
liveReady=0/5
liveExecutionStatus=blocked
```

Current interpretation:

1. The five passing rows are still historical Aave V3 liquidation replay events.
2. No current public DEX/Curve/Balancer/Uniswap-fee route has passed the 20%+
   annualized after-gas gate with stable samples.
3. Wallet-funded execution is represented in fork rehearsals, but the same-block
   profitability gate remains negative for the public routes tested so far.

Latest expanded amount sweeps:

```text
data/dex-arbitrage-candidates-base-two-leg-amount-sweep.json
candidateCount=20
passingCount=0
top=arb-base-weth-cbeth-uniswapv3-to-aerodrome
selectedAmountMultiplier=0.005
medianNetUsd=-0.0147417

data/uniswap-v3-fee-arbitrage-candidates-base.json
candidateCount=60
passingCount=0
top=uni-v3-fee-base-weth-cbeth-500-to-100
selectedAmountMultiplier=0.05
medianNetUsd=-0.036045
```

The full Base DEX triangle scan timed out at 600 seconds before writing a new
artifact. Use the DEX search batching controls instead of a monolithic run:

```bash
DEX_ARB_CHAIN=base \
DEX_ARB_SAMPLE_COUNT=3 \
DEX_ARB_LOOKBACK_BLOCKS=600 \
DEX_ARB_PAIR_LIMIT=0 \
DEX_ARB_TRIANGLE_OFFSET=0 \
DEX_ARB_TRIANGLE_LIMIT=1 \
DEX_ARB_TRIANGULAR_DEX_PATH_OFFSET=0 \
DEX_ARB_TRIANGULAR_DEX_PATH_LIMIT=1 \
DEX_ARB_MAX_STRATEGIES=60 \
DEX_ARB_OUTPUT_SUFFIX=base-triangles-0-path-0 \
npm run search:dex-arb
```

For follow-up batches, increment `DEX_ARB_TRIANGLE_OFFSET` for token-path
chunks and `DEX_ARB_TRIANGULAR_DEX_PATH_OFFSET` for DEX-path chunks. Use a
distinct `DEX_ARB_OUTPUT_SUFFIX` or explicit `DEX_ARB_OUT` so exploratory scans
do not overwrite canonical artifacts.

Follow-up Base triangle batch result:

```text
tokenPath=USDC->WETH->cbBTC->USDC
artifacts=data/dex-arbitrage-candidates-base-triangles-0-path-{0..7}.json
candidateCount=8
passingCount=0
best=tri-base-usdc-weth-cbbtc-aerodrome-uniswapv3-uniswapv3
bestMedianNetUsd=-0.034417
bestSelectedAmountMultiplier=0.01
allNetWinRatePct=0.00
```

`scripts/fork-simulate-live-run.mjs` now discovers split DEX, Curve, Balancer,
and Uniswap-fee artifacts dynamically from `data/`, so fork smoke can use the
newly generated chunk files. The DEX quote-replay smoke currently uses
`data/dex-arbitrage-candidates-base-triangles-0-path-0.json`, an all-Uniswap V3
triangle route that the fork simulator can rehearse directly. The canonical
Base two-leg artifact remains useful research evidence, but its current top
route includes Aerodrome; Aerodrome direct fork quote/rehearsal support is still
not wired in `fork-simulate-live-run.mjs`.

After these eight extra artifacts, the overview is:

```text
families=9
artifacts=34
candidates=2789
historicalEvidencePassing=5/5
liveReady=0/5
liveExecutionStatus=blocked
```

## Refresh Current Candidates

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
node scripts/search-high-apy-strategies.mjs
```

Expected output includes 5 candidates and writes `data/strategy-candidates.json`.

## Validate

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
./node_modules/.bin/tsc -p packages/config/tsconfig.json --noEmit
./node_modules/.bin/tsc -p packages/strategy-models/tsconfig.json --noEmit
./node_modules/.bin/tsc -p apps/api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p apps/workers/tsconfig.json --noEmit
./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit

export PATH=$HOME/.cargo/bin:$HOME/.foundry/bin:$PATH
cargo test --workspace
cd contracts && forge test -vv
```

## Start The Stack

The dev databases must be running first:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
docker compose -f infra/docker-compose.yml up -d
bash infra/scripts/migrate.sh up
bash infra/scripts/migrate.sh seed
# If psql is not installed on the host, use the Node fallback after migrations:
node scripts/seed-reference-data.mjs
```

If the host does not have `psql`, apply Postgres migrations with the Node fallback:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
node scripts/migrate-postgres.mjs
```

Run workers, API, and web in separate shells:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
apps/workers/node_modules/.bin/tsx apps/workers/src/index.ts
```

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
apps/api/node_modules/.bin/tsx apps/api/src/server.ts
```

```bash
cd /home/bumblebee/Project/on-chain-arbitrage/apps/web
node_modules/.bin/next dev -p 3000
```

Open:

```text
http://localhost:3000/candidates
```

## Execution Plan Smoke Test

The live execution plan endpoint is a dry-run planner. It does not sign or send
transactions. It returns adapter type, approvals, target contract, transaction
method/selectors, risk limits, and blockers that must be cleared before live
capital is allowed.

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
API_PORT=4018 apps/api/node_modules/.bin/tsx apps/api/src/server.ts
```

In another shell:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
node - <<'NODE'
const ids = require('./data/strategy-candidates.json').candidates.map((c) => c.id);
const base = 'http://127.0.0.1:4018';
(async () => {
  for (const id of ids) {
    const res = await fetch(`${base}/api/strategy-candidates/${id}/execution-plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        walletAddress: '0x000000000000000000000000000000000000dEaD',
        capital: '10000000000',
        maxSlippageBps: 50,
        maxGasUsd: 25,
      }),
    });
    const plan = await res.json();
    console.log(id, plan.status, plan.adapter, plan.targetContract.address);
  }
})();
NODE
```

Expected current output:

```text
candidate-1-base-usdc-cbbtc template-ready aerodrome-slipstream-npm 0x827922686190790b37229fd06084350E74485b72
candidate-2-ethereum-serv-weth template-ready uniswap-v3-npm 0xC36442b4a4522E871399CD717aBDD847Ab11FE88
candidate-3-ethereum-wtao-usdc template-ready uniswap-v3-npm 0xC36442b4a4522E871399CD717aBDD847Ab11FE88
candidate-4-base-weth-usdc template-ready uniswap-v3-npm 0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1
candidate-5-base-eurc-usdc template-ready aerodrome-slipstream-npm 0x827922686190790b37229fd06084350E74485b72
```

## Live Run Smoke Test

The live run endpoint persists a user-created run request. It does not submit
capital on-chain. The worker preflight currently blocks runs until quote engine,
fork simulation, and production adapters are wired.

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
node scripts/migrate-postgres.mjs

API_PORT=4020 apps/api/node_modules/.bin/tsx apps/api/src/server.ts
```

In another shell:

```bash
curl -sS http://127.0.0.1:4020/api/strategy-candidates/candidate-4-base-weth-usdc/live-runs \
  -H 'content-type: application/json' \
  -d '{"walletAddress":"0x000000000000000000000000000000000000dEaD","capital":"10000000000","maxSlippageBps":50,"maxGasUsd":25,"autoStart":true}'
```

Start workers briefly:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
apps/workers/node_modules/.bin/tsx apps/workers/src/index.ts
```

Verified on 2026-07-03:

```text
created | 7b8f41e8-2060-4e99-b8d5-0c82b412d5db | queued | candidate-4-base-weth-usdc | uniswap-v3-npm
7b8f41e8-2060-4e99-b8d5-0c82b412d5db | candidate-4-base-weth-usdc | blocked | blockers=10
risk_events=1
```

Structured preflight report smoke also passed:

```text
run=d2d78e21-2856-482a-aabc-730fbb149d3c candidate=candidate-1-base-usdc-cbbtc status=blocked blockers=11
preflight=blocked checks=7 quote=missing calldataReady=false
api-run=d2d78e21-2856-482a-aabc-730fbb149d3c status=blocked latestPreflight=true
api-preflight=blocked checks=7 quote=missing
```

Price-driven partial quote smoke also passed. The worker now uses DeFiLlama
token prices to split user capital across LP tokens and compute desired/min
amounts. It still blocks execution until pool-state quote, gas estimate, and
fork simulation are wired.

```text
run=4433f5e6-4ed9-4d78-b1da-1ce7619f2a9a candidate=candidate-5-base-eurc-usdc status=blocked blockers=10
preflight=blocked checks=7 quote=partial prices=2
EURC price=1.1450724942731076 desired=2183.2678826 min=2175.62644502
USDC price=0.9998525401773796 desired=2500.36870393 min=2491.61741346
required=current tick and liquidity|price impact|gas estimate
api-run=4433f5e6-4ed9-4d78-b1da-1ce7619f2a9a status=blocked quote=partial prices=2
```

Uniswap V3 pool-state resolver smoke also passed for the Base WETH/USDC
candidate. The worker resolves the pool from the canonical factory and reads
`slot0` + `liquidity` over `RPC_BASE_URL`.

```text
run=b70cc54f-7049-4d9a-a7e1-de79e1d7d9ea candidate=candidate-4-base-weth-usdc status=blocked blockers=10
quote=partial prices=2
poolState=ready pool=0xd0b53d9277642d899df5c87a3966a349a798f224 fee=500 tick=-201837 liquidity=893280586952902821
required=price impact|gas estimate
api-run=b70cc54f-7049-4d9a-a7e1-de79e1d7d9ea status=blocked poolState=ready pool=0xd0b53d9277642d899df5c87a3966a349a798f224 tick=-201837
```

Uniswap V3 mint parameter preview smoke also passed for the Base WETH/USDC
candidate. The worker now uses the price-driven token split, pool tick, fee tier,
and configured token decimals to produce a read-only `mintPreview`. This is not
signed calldata and still blocks execution.

```text
run=da0bbf60-4912-4c08-9a7e-9fae5f460b6e status=blocked blockers=10
preflight=blocked checks=9 quote=partial poolState=ready mintPreview=ready
pool=0xd0b53d9277642d899df5c87a3966a349a798f224 fee=500 tick=-201855
ticks=-202460..-201250 spacing=10
selector=0x88316456 recipient=0x000000000000000000000000000000000000dead
WETH decimals=18/config desired=2916173150000000103 min=2901592280000000024
USDC decimals=6/config desired=5000815029 min=4975810954
```

Uniswap V3 transaction preview smoke also passed for the Base WETH/USDC
candidate. The worker now derives two ERC20 `approve` calldata previews and one
Uniswap V3 `mint` calldata preview from `mintPreview`. This is still inspection
data only; the run remains `blocked`.

```text
run=434bdd88-2e74-4a3a-8703-77be070a31c8 status=blocked blockers=10
preflight=blocked checks=10 quote=partial poolState=ready mintPreview=ready transactionPreview=ready
calls=3
approval|Approve WETH|selector=0x095ea7b3|bytes=68
approval|Approve USDC|selector=0x095ea7b3|bytes=68
position-mint|Mint Uniswap V3 position|selector=0x88316456|bytes=356
```

Wallet balance/allowance preflight smoke also passed. The worker now reads
`balanceOf(wallet)` and `allowance(wallet, positionManager)` for the previewed
LP tokens. The smoke wallet had enough WETH/USDC balance but zero allowance, so
the run correctly returned `needs-approval`.

```text
run=aa6f5c15-657d-4f39-8960-409ffdaadb05 status=blocked blockers=10
preflight=blocked checks=11 quote=partial poolState=ready mintPreview=ready transactionPreview=ready walletPreflight=needs-approval
walletTokens=2
WETH|required=2914949969999999890|balance=4000730097722157130|balanceOk=true|allowance=0|allowanceOk=false|approvalGap=2914949969999999890
USDC|required=5000638956|balance=25650912228|balanceOk=true|allowance=0|allowanceOk=false|approvalGap=5000638956
```

Gas preflight smoke also passed. The worker now runs `eth_estimateGas` for the
preview calls and stores per-call status in `gasPreflight`. It also reads
`eth_gasPrice`, resolves the native token USD price, computes gas cost in USD,
and evaluates the user-provided `maxGasUsd` gate. In the verified Base WETH/USDC
run, both approval calls estimated successfully and the mint call was correctly
blocked because allowance was still zero.

```text
run=98214557-8522-4115-92b6-20b170961d29 status=blocked blockers=10
preflight=blocked checks=13 quote=partial poolState=ready mintPreview=ready transactionPreview=ready gasPreflight=partial walletPreflight=needs-approval
calls=3
approval|Approve WETH|selector=0x095ea7b3|bytes=68
approval|Approve USDC|selector=0x095ea7b3|bytes=68
position-mint|Mint Uniswap V3 position|selector=0x88316456|bytes=356
gasCalls=3 totalGas=102701 gasCostUsd=0.00109223 maxGasUsd=25 maxGasOk=true gasPriceWei=6000000 native=ETH:1772.4954861927301
gas|approval|Approve WETH|status=estimated|gas=46437|costUsd=0.00049386|error=none
gas|approval|Approve USDC|status=estimated|gas=56264|costUsd=0.00059837|error=none
gas|position-mint|Mint Uniswap V3 position|status=blocked|gas=n/a|costUsd=n/a|error=execution reverted: STF
walletPreflight=needs-approval
```

Read-only call simulation smoke also passed. The two approval calls passed
`eth_call`, while the mint call correctly reverted because allowance was still
zero. This is a useful pre-fork gate, not a replacement for ordered fork
simulation.

```text
preflight=blocked checks=14 quote=partial poolState=ready mintPreview=ready transactionPreview=ready gasPreflight=partial callSimulation=partial walletPreflight=needs-approval
simCalls=3 status=partial
sim|approval|Approve WETH|status=passed|returnBytes=32|error=none
sim|approval|Approve USDC|status=passed|returnBytes=32|error=none
sim|position-mint|Mint Uniswap V3 position|status=reverted|returnBytes=n/a|error=execution reverted: STF
```

The smoke also verified the approval-after-confirmation loop can be re-queued:

```text
rerun=0273410f-a8aa-47d9-8076-cc5b8f4b8b9e status=queued blockers=1
```

Ordered fork simulation smoke also passed for the Base WETH/USDC Uniswap V3
candidate after replacing the original price-only 50/50 token split with
pool-aware mint amount math. The script impersonates the run wallet on an Anvil
fork, executes the two approvals, and then executes the Uniswap V3 mint in the
same fork state.

```text
fork=ready run=e77dbf94-1399-4871-b220-24451b0ccdcf chain=8453 wallet=0x000000000000000000000000000000000000dead block=48268907 calls=3
fork|approval|Approve WETH|status=passed|estimate=46055|gasUsed=46055
fork|approval|Approve USDC|status=passed|estimate=55843|gasUsed=55461
fork|position-mint|Mint Uniswap V3 position|status=passed|estimate=437485|gasUsed=432685
forkSimulation=passed calls=3 totalGasUsed=534201 failedKind=none failedStatus=none failedError=none
```

The API-triggered fork simulation path also passed:

```text
forkApi=9a890b5d-6809-45cb-ac74-e65185c15372 status=passed exitCode=0 summary=forkSimulation=passed calls=3 totalGasUsed=534189 failedKind=none failedStatus=none failedError=none
forkApiOut|fork|approval|Approve WETH|status=passed|estimate=46055|gasUsed=46055
forkApiOut|fork|approval|Approve USDC|status=passed|estimate=55843|gasUsed=55461
forkApiOut|fork|position-mint|Mint Uniswap V3 position|status=passed|estimate=437473|gasUsed=432673
```

Fork simulation persistence smoke also passed:

```text
forkApi=1cd02cdf-c5b3-4c98-9ead-4b49a661e521 status=passed exitCode=0 summary=forkSimulation=passed calls=3 totalGasUsed=538979 failedKind=none failedStatus=none failedError=none
persistedFork=passed summary=forkSimulation=passed calls=3 totalGasUsed=538979 failedKind=none failedStatus=none failedError=none
```

Execution-readiness gate smoke also passed. The ordered fork gate is now marked
`pass`, while the overall live run remains `blocked` because real profitability
replay, production adapter execution, and pure-arbitrage verification are still
not complete.

```text
readiness=blocked blockers=3 forkGate=pass
```

The `/candidates` live run panel can now send approval preview calls from an
injected wallet. Only `approval` calls expose a `Send approve` action. The
Uniswap V3 `mint` call remains locked until final quote, fork simulation, and
risk gates are wired.

## 2026-07-06 Event Replay Update

Implemented the first real on-chain event replay path for the best-developed
candidate, `candidate-4-base-weth-usdc`.

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
REPLAY_BLOCKS=500 REPLAY_CHUNK_SIZE=100 node scripts/replay-uniswap-v3-lp-fees.mjs candidate-4-base-weth-usdc
```

Latest generated artifact:

```text
data/event-replay-candidate-4-base-weth-usdc.json
durationDays=0.0115509259
swapCount=166
grossFeeApyPct=104.4601
ilApyPct=-74.3404
gasApyPct=-1.8029
netApyPct=28.3168
gate=block
evidenceStatus=net-apy-observed-but-sample-too-short-or-thin
```

The profitability gate remains blocked even though the short-window annualized
net APY is above 20%, because the replay sample is only about 16.6 minutes. This
is intentional: short windows are not stable evidence and must not be marketed as
guaranteed yield.

New API/frontend integration:

- `GET /api/strategy-candidates/:id/event-replay`
- `GET /api/live/runs/:id` includes `event_replay_evidence`
- `readiness.gates[]` now derives `profitability-backtest` from the event replay artifact
- `/candidates` live run panel displays replay window, fees, IL, gas, net APY, and caveats

Latest full smoke:

```text
eventReplay=block replayNetApy=28.31681608460301 profitabilityGate=block
readiness=blocked blockers=3 forkGate=pass
forkSimulation=passed calls=3 totalGasUsed=534257 failedKind=none failedStatus=none failedError=none
```

Current RPC performance note: Base `eth_getLogs` against the configured Alchemy
endpoint was slow for this hot pool. `REPLAY_CHUNK_SIZE=100` completed
reliably; larger windows should run asynchronously or against a faster archive
RPC/indexer.

## 2026-07-06 Pure DEX Arbitrage Scan

Run the pure on-chain DEX-DEX quote replay scanner:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
npm run search:dex-arb
```

Or with explicit scan scope:

```bash
DEX_ARB_SAMPLE_COUNT=5 DEX_ARB_LOOKBACK_BLOCKS=1200 DEX_ARB_PAIR_LIMIT=10 \
  DEX_ARB_TRIANGLE_LIMIT=3 DEX_ARB_MAX_STRATEGIES=44 \
  node scripts/search-dex-arbitrage-candidates.mjs

DEX_ARB_CHAIN=arbitrum DEX_ARB_SAMPLE_COUNT=3 DEX_ARB_LOOKBACK_BLOCKS=600 \
  DEX_ARB_PAIR_LIMIT=9 DEX_ARB_TRIANGLE_LIMIT=1 DEX_ARB_MAX_STRATEGIES=26 \
  node scripts/search-dex-arbitrage-candidates.mjs
```

Latest result:

```text
dexArbCandidates=did-not-find-five-passing-quote-backtests
total=44
passing=0
artifact=/home/bumblebee/Project/on-chain-arbitrage/data/dex-arbitrage-candidates.json

dexArbCandidates=did-not-find-five-passing-quote-backtests
total=26
passing=0
artifact=/home/bumblebee/Project/on-chain-arbitrage/data/dex-arbitrage-candidates-arbitrum.json
```

The Base artifact contains 20 two-leg candidates and 24 triangular candidates.
The Arbitrum artifact contains 18 two-leg candidates and 8 triangular
candidates. Best current paths were still negative after gas:

```text
tri-base-usdc-weth-cbbtc-uniswapv3-uniswapv3-uniswapv3 gate=block samples=5/5 win=0.00 annualized=-1959.41 medianNetUsd=-1.378734
arb-base-usdc-weth-uniswapv3-to-aerodrome gate=block samples=5/5 win=0.00 annualized=-4473.39 medianNetUsd=-2.506154
```

API check:

```text
dexArbMultiApi=ok artifacts=4 candidates=96 passing=0 status=did-not-find-five-passing-quote-backtests
```

The `/candidates` page now displays this scan separately from the DeFiLlama
yield candidates. This is intentional: pure arbitrage candidates and LP/yield
candidates must not be mixed.

### Pure arbitrage overview

The API also exposes a single aggregate gate for all pure on-chain search
families:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
npm run search:pure-overview
```

This writes:

```text
data/pure-arbitrage-search-overview.json
```

By default the command only aggregates existing artifacts and does not overwrite
scan results. To execute scan tasks before writing the overview:

```bash
PURE_ARB_RUN_SCANS=1 npm run search:pure-overview
```

Restrict a run with `PURE_ARB_FAMILIES=<key>`, for example:

```bash
PURE_ARB_RUN_SCANS=1 PURE_ARB_FAMILIES=curve-stable,balancer-v2 npm run search:pure-overview
```

```bash
curl -s http://localhost:4000/api/pure-arbitrage/overview
```

Latest smoke:

```text
familyCount=9
artifactCount=25
candidateCount=2749
passingCount=5
liveReadyPassingCount=0
requestedPassingCount=5
status=found-at-least-five-passing-pure-on-chain-backtests
liveExecutionStatus=blocked
```

The `/candidates` page displays this overview above the individual scan panels.
It is the current machine-readable answer to whether the requested "5 pure
on-chain 20%+ strategies" gate has been met. The historical evidence gate is
now met, but live execution is still blocked because none of the passing
candidates has current opportunity detection, executable calldata, fresh quote,
fork simulation, and loss-reverting settlement all passing.

### Pure live interface smoke

Run the non-custodial live-interface smoke:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
npm run smoke:pure-live-interfaces
```

This command starts a temporary API, applies migrations, selects one candidate
from each live-interface family, and verifies:

- `POST /execution-plan` returns a pure-arbitrage dry-run plan.
- `POST /live-runs` persists a user wallet + capital request as `blocked`.
- `POST /api/live/runs/:id/fork-simulation` stores a structured failed report
  with the expected profitability or protocol gate reason.
- `GET /api/live/runs/:id` returns the persisted fork report and readiness gate.

Latest smoke artifact:

```text
data/pure-live-interface-smoke.json
caseCount=8
passedInterfaceCount=8
liveExecutionStatus=blocked
```

### Aave fork calldata smoke

Run the targeted Aave fork calldata report smoke:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
npm run smoke:aave-fork-calldata
```

This command starts a temporary API, creates a blocked Aave live run, triggers
`POST /api/live/runs/:id/fork-simulation`, and verifies that the fork report
contains:

- `liquidationCall.selector=0x00a718a9`
- `liquidationCallCalldataBytes=164`
- a `calldataPreview`
- `calldataStatus=withheld-health-factor-not-below-one` when HF is not below 1
- `AaveV3LiquidationExecutor` deploys on the fork
- `executeLiquidationCalldataBytes=420`
- `executorCalldataStatus=withheld-health-factor-not-below-one` when HF is not below 1

Latest smoke artifact:

```text
data/aave-fork-calldata-smoke.json
candidateId=liq-ethereum-07cc49-gho-wbtc
reason=aave-liquidation-health-factor-not-below-one
healthFactor=1.411926
forkCalldataStatus=withheld-health-factor-not-below-one
forkCalldataBytes=164
planExecutorCalldataBytes=420
executorDeploymentStatus=passed
executorCollateralUnwindQuoteStatus=no-route
executorCalldataStatus=withheld-health-factor-not-below-one
executorCalldataBytes=420
liveExecutionStatus=blocked
```

Latest per-case readiness remains blocked:

```text
dex-quote-replay: dex-direct-route-net-loss
uniswap-v3-fee-arb: dex-direct-route-net-loss
curve-stable-arb: curve-mixed-route-net-loss-reverted
balancer-v2-arb: balancer-mixed-route-net-loss-reverted
aave-v3-liquidations: aave-liquidation-health-factor-not-below-one
compound-v3-liquidations: compound-v3-liquidation-account-not-liquidatable
morpho-blue-liquidations: morpho-blue-liquidation-profitability-gate-blocked
morpho-blue-liquidation-replay: morpho-blue-liquidation-ltv-below-lltv
```

Latest DEX direct-route fork rehearsal:

```text
candidate=tri-base-usdc-weth-cbbtc-uniswapv3-uniswapv3-uniswapv3
mode=dex-direct-route-rehearsal
forkReason=dex-direct-route-net-loss
calls=6/6
netProfit=-7515280
totalGasUsed=645281
strategyExecutor.ethCallStatus=reverted
strategyExecutor.sendStatus=reverted
strategyExecutor.sendGasUsed=588376
strategyExecutor.executeCalldataBytes=772
```

The six calls were three ERC20 approvals plus three Uniswap V3 SwapRouter02
swaps. The route executed on the fork but lost start-token units, so the system
correctly kept the run blocked. The `StrategyExecutor` rehearsal deployed fresh
fork-only contracts and reverted the route atomically, which is the desired
loss-reverting behavior. This still is not production-ready because the
production path must use deployed, audited, monitored contracts and pass fresh
profitability gates.

This is a product-interface verification only. It does not prove live
profitability and does not unlock real transaction submission.

### Pure DEX execution plan

After generating DEX arbitrage artifacts, request a dry-run execution plan:

```bash
curl -s -X POST http://localhost:4000/api/dex-arbitrage-candidates/tri-base-usdc-weth-cbbtc-uniswapv3-uniswapv3-uniswapv3/execution-plan \
  -H 'content-type: application/json' \
  -d '{"capital":"1000000000","maxSlippageBps":30,"maxGasUsd":25}'
```

The plan includes token path, DEX path, router addresses, adapter requirements,
approval template, atomic executor dependency, risk limits, fork simulation
requirements, and blockers. It deliberately does not return ready-to-send swap
calldata while the quote replay gate is blocked.

The scanner now supports multiple chain profiles:

```bash
DEX_ARB_CHAIN=base npm run search:dex-arb
DEX_ARB_CHAIN=arbitrum npm run search:dex-arb
DEX_ARB_CHAIN=polygon npm run search:dex-arb
DEX_ARB_CHAIN=ethereum npm run search:dex-arb
```

Use notional sweep when a route may be gas-negative at the default amount but
positive at a different input size:

```bash
DEX_ARB_CHAIN=polygon DEX_ARB_AMOUNT_MULTIPLIERS=0.1,0.5,1,2,5,10 npm run search:dex-arb
```

The aggregate API automatically reads all
`data/dex-arbitrage-candidates*.json` artifacts. Latest aggregate:

```text
artifactCount=4
candidateCount=96
passingCount=0
requestedPassingCount=5
status=did-not-find-five-passing-quote-backtests
```

Latest smoke:

```text
statusCode=200
plan.status=blocked
gate=block
blockedBy=5
routers=3
adapters=3
executor=null
```

To unblock a pure DEX route for live testing, all of the following must be true:

1. The candidate's quote replay `gate.status` is `pass`.
2. `DEX_ARB_EXECUTOR_ADDRESS` points to a verified deployment.
3. Required routers and adapters are deployed/registered for the target chain.
4. Fresh quote, gas preflight, wallet balance/allowance check, and fork simulation pass at the same block window.
5. The executor reverts on loss after gas and slippage.

Contract adapter note: see `docs/contract-adapter-audit-20260706.md`. The V3
callback-validation and V2 pair-funding P0s have source-level fixes and focused
unit tests. Fork smokes now cover Base Uniswap V3 WETH/USDC, Arbitrum Uniswap
V3 USDC/WETH, Polygon QuickSwap V2 USDC/WETH, Arbitrum Sushi V2 USDC/WETH,
Ethereum Curve 3pool DAI/USDC, and Ethereum Balancer 80BAL/20WETH WETH/BAL.
Curve and Balancer swap adapters now exist and pass focused unit/fork smoke
coverage. These adapters still remain production blockers until fee-aware quote
parity, multi-hop loss-revert forks, deployment, and external review are
complete. The V2 fee model is still fixed at the classic 30 bps path and needs
quote/execution parity before live routing.

Adapter verification commands:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage/contracts
/home/bumblebee/.foundry/bin/forge test -vv

RUN_FORK_TESTS=1 /home/bumblebee/.foundry/bin/forge test --match-contract AdapterBaseForkTest -vv
```

Latest result:

```text
25 tests passed, 0 failed, 0 skipped
6 fork adapter smoke tests passed, 0 failed, 0 skipped
```

### Pure DEX blocked run request

The UI can now create a pure DEX live-run request from the scan table. The API is:

```bash
curl -s -X POST http://localhost:4000/api/dex-arbitrage-candidates/<candidate-id>/live-runs \
  -H 'content-type: application/json' \
  -d '{"walletAddress":"0x0000000000000000000000000000000000000001","capital":"1000000000","maxSlippageBps":30,"maxGasUsd":25}'
```

Current behavior is intentionally blocked:

```text
statusCode=201
status=blocked
strategy_id=atomic-amm
blocked_by=7
```

Running `POST /api/live/runs/:id/fork-simulation` on this dry-run plan stores a
structured failed report instead of throwing a generic transaction-preview
error. Expected summary:

```text
forkSimulation=blocked reason=pure-on-chain-plan-needs-calldata ...
```

This verifies the wallet/capital/run-record interface without pretending that a
failed quote-replay candidate is live-tradable.

## Curve Stablecoin Arbitrage Scan

Run a pure on-chain Curve stable-pool versus Uniswap V3 quote replay scan. By
default the scanner discovers Ethereum USD pools through the Curve API and falls
back to 3pool if the API is unavailable:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
CURVE_ARB_SAMPLE_COUNT=2 CURVE_ARB_LOOKBACK_BLOCKS=240 \
  CURVE_ARB_POOL_LIMIT=3 CURVE_ARB_PAIR_LIMIT=12 \
  CURVE_ARB_MAX_STRATEGIES=16 CURVE_ARB_AMOUNT_MULTIPLIERS=0.1 \
  npm run search:curve-stable-arb
```

Latest result:

```text
artifact=curve-stable-arbitrage-candidates-ethereum.json
candidateCount=16
passingCount=0
requestedPassingCount=5
status=did-not-find-five-passing-curve-stable-arbitrage-backtests
```

Latest aggregate API:

```text
GET /api/curve-stable-arbitrage-candidates/artifacts
artifactCount=1
candidateCount=16
passingCount=0
requestedPassingCount=5
status=did-not-find-five-passing-curve-stable-arbitrage-backtests
```

Request a dry-run Curve stable arbitrage plan:

```bash
curl -s -X POST http://localhost:4000/api/curve-stable-arbitrage-candidates/<candidate-id>/execution-plan \
  -H 'content-type: application/json' \
  -d '{"capital":"100000000","maxSlippageBps":30,"maxGasUsd":25}'
```

Create a blocked run request:

```bash
curl -s -X POST http://localhost:4000/api/curve-stable-arbitrage-candidates/<candidate-id>/live-runs \
  -H 'content-type: application/json' \
  -d '{"walletAddress":"0x0000000000000000000000000000000000000001","capital":"100000000","maxSlippageBps":30,"maxGasUsd":25}'
```

Latest smoke:

```text
planStatus=blocked
strategyId=atomic-amm
gate=block
dexPath=uniswap-v3,curve-3pool
adapters=UniswapV3Adapter,CurveStableSwapAdapter

runStatusCode=201
runStatus=blocked
runStrategyId=atomic-amm
runBlockers=7
```

The `/candidates` page displays this scan separately from generic DEX quote
replay and Aave liquidations. Live execution remains blocked until at least one
route passes replay, the Curve route is covered by same-block revert-on-loss
simulation, and the verified adapters/executor are deployed and registered.

## Balancer V2 Arbitrage Scan

Run a pure on-chain Balancer V2 Vault versus Uniswap V3 quote replay scan:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
BALANCER_ARB_SAMPLE_COUNT=2 BALANCER_ARB_LOOKBACK_BLOCKS=300 \
  BALANCER_ARB_PAIR_LIMIT=10 BALANCER_ARB_MAX_STRATEGIES=12 \
  BALANCER_ARB_AMOUNT_MULTIPLIERS=0.1,1 \
  npm run search:balancer-arb
```

Latest result:

```text
artifact=balancer-arbitrage-candidates-ethereum.json
candidateCount=12
passingCount=0
requestedPassingCount=5
status=did-not-find-five-passing-balancer-arbitrage-backtests
```

Latest aggregate API:

```text
GET /api/balancer-arbitrage-candidates/artifacts
artifactCount=1
candidateCount=12
passingCount=0
requestedPassingCount=5
status=did-not-find-five-passing-balancer-arbitrage-backtests
```

Request a dry-run Balancer arbitrage plan:

```bash
curl -s -X POST http://localhost:4000/api/balancer-arbitrage-candidates/<candidate-id>/execution-plan \
  -H 'content-type: application/json' \
  -d '{"capital":"500000","maxSlippageBps":30,"maxGasUsd":25}'
```

Create a blocked run request:

```bash
curl -s -X POST http://localhost:4000/api/balancer-arbitrage-candidates/<candidate-id>/live-runs \
  -H 'content-type: application/json' \
  -d '{"walletAddress":"0x0000000000000000000000000000000000000001","capital":"500000","maxSlippageBps":30,"maxGasUsd":25}'
```

Latest smoke:

```text
planStatus=blocked
strategyId=atomic-amm
gate=block
dexPath=uniswap-v3,balancer-v2
adapters=UniswapV3Adapter,BalancerV2VaultAdapter

runStatusCode=201
runStatus=blocked
runStrategyId=atomic-amm
runBlockers=7
```

The `/candidates` page displays this scan separately from generic DEX quote
replay, Curve stable arbitrage, and Aave liquidations. Live execution remains
blocked until at least one route passes replay, the Balancer route is covered
by same-block revert-on-loss simulation, and the verified adapters/executor are
deployed and registered.

## Aave V3 Liquidation Scan

Run a pure on-chain liquidation scan:

```bash
LIQ_CHAIN=base LIQ_LOOKBACK_BLOCKS=500 LIQ_LOG_CHUNK_BLOCKS=10 \
  LIQ_USER_LIMIT=50 LIQ_RESERVE_SYMBOLS=USDC,WETH,USDbC,cbETH,wstETH \
  npm run search:liquidations

LIQ_CHAIN=arbitrum LIQ_LOOKBACK_BLOCKS=100 LIQ_LOG_CHUNK_BLOCKS=10 \
  LIQ_USER_LIMIT=20 LIQ_RESERVE_SYMBOLS=USDC,WETH,WBTC,USDT,ARB \
  npm run search:liquidations

LIQ_CHAIN=ethereum LIQ_LOOKBACK_BLOCKS=80 LIQ_LOG_CHUNK_BLOCKS=10 \
  LIQ_USER_LIMIT=20 LIQ_RESERVE_SYMBOLS=USDC,WETH,WBTC,USDT,DAI \
  npm run search:liquidations

LIQ_CHAIN=polygon LIQ_LOOKBACK_BLOCKS=100 LIQ_LOG_CHUNK_BLOCKS=10 \
  LIQ_USER_LIMIT=20 LIQ_RESERVE_SYMBOLS=USDC,WETH,WBTC,USDT,WMATIC \
  npm run search:liquidations
```

The current RPC requires `LIQ_LOG_CHUNK_BLOCKS=10` for Base and Arbitrum
`eth_getLogs`.

Latest aggregate API:

```text
GET /api/aave-liquidation-candidates/artifacts
artifactCount=4
candidateCount=10
passingCount=0
requestedPassingCount=5
status=did-not-find-five-passing-liquidation-opportunities
```

Liquidation gates are intentionally strict:

1. Borrower `healthFactor` must be below 1.
2. Priced collateral/debt pair must exist.
3. Estimated net profit after gas must exceed the configured threshold.
4. Live execution still requires a flash-loan liquidation adapter, collateral
   unwind route, and same-block fork simulation.

### Aave liquidation execution plan

Request a dry-run liquidation plan:

```bash
curl -s -X POST http://localhost:4000/api/aave-liquidation-candidates/<candidate-id>/execution-plan \
  -H 'content-type: application/json' \
  -d '{"capital":"1000000000","maxSlippageBps":30,"maxGasUsd":25}'
```

Create a blocked run request:

```bash
curl -s -X POST http://localhost:4000/api/aave-liquidation-candidates/<candidate-id>/live-runs \
  -H 'content-type: application/json' \
  -d '{"walletAddress":"0x0000000000000000000000000000000000000001","capital":"1000000000","maxSlippageBps":30,"maxGasUsd":25}'
```

Latest smoke:

```text
planStatus=blocked
planStrategyId=atomic-amm
blockers=6

runStatusCode=201
runStatus=blocked
runStrategyId=atomic-amm
runBlockers=8
forkReason=aave-liquidation-health-factor-not-below-one
forkCalldataStatus=withheld-health-factor-not-below-one
forkCalldataBytes=164
```

## Aave V3 Liquidation Event Replay

Run the current Ethereum replay that produced the first 5 historical evidence
passes:

```bash
AAVE_REPLAY_CHAIN=ethereum \
  AAVE_REPLAY_TO_BLOCK=25480924 \
  AAVE_REPLAY_LOOKBACK_BLOCKS=250000 \
  AAVE_REPLAY_LOG_CHUNK_BLOCKS=5000 \
  AAVE_REPLAY_MAX_EVENTS=500 \
  AAVE_REPLAY_MAX_LOG_REQUESTS=1000 \
  AAVE_REPLAY_LOG_CONCURRENCY=1 \
  AAVE_REPLAY_RPC_RETRIES=6 \
  AAVE_REPLAY_RPC_RETRY_DELAY_MS=500 \
  AAVE_REPLAY_LOG_BATCH_DELAY_MS=120 \
  AAVE_REPLAY_RESUME=1 \
  AAVE_REPLAY_RETRY_FAILED=1 \
  npm run replay:aave-liquidations
```

Latest Ethereum replay:

```text
artifact=aave-liquidation-event-replay-candidates-ethereum.json
toBlock=25480924
lookbackBlocks=250000
eventCount=259
candidateCount=47
passingCount=5
successfulCoveragePct=66.75
failedRangeCount=0
scanStopReason=max-log-requests-reached
status=found-at-least-five-passing-aave-liquidation-event-replays
```

Historical gate-passing pairs:

```text
aave-replay-ethereum-usdt-wbtc samples=32 annualized=600.08 win=87.50 medianNetUsd=223.45
aave-replay-ethereum-usdc-wbtc samples=30 annualized=375.86 win=96.67 medianNetUsd=1270.22
aave-replay-ethereum-dai-weth samples=5 annualized=344.74 win=100.00 medianNetUsd=22268.14
aave-replay-ethereum-usdt-weth samples=17 annualized=264.01 win=70.59 medianNetUsd=52.62
aave-replay-ethereum-usdt-wsteth samples=5 annualized=204.38 win=80.00 medianNetUsd=59.40
```

Interpretation: these pass historical replay gates only. Their
`liveInterface.status` is `historical-edge-needs-current-event-and-fork-simulation`
and `productionStatus` is
`not-enabled-until-current-event-detection-and-fork-simulation-pass`, so live
execution remains blocked.

Build the current Aave watchlist from the latest current scan and replay
artifact:

```bash
AAVE_WATCH_CHAIN=ethereum \
  AAVE_WATCH_HEALTH_FACTOR=1.10 \
  AAVE_WATCH_NEAR_HEALTH_FACTOR=1.03 \
  npm run watch:aave-liquidations
```

Latest Aave current scan used by the watchlist:

```text
artifact=aave-liquidation-candidates-ethereum.json
reserveCount=67
discoveredDebtUsers=2
checkedDebtUsers=2
logRequestCount=11
scannedBlockCount=101
failedRangeCount=0
candidateCount=2
passingCount=0
```

The current scan now stores `debtToCoverBaseUnits`, `debtToCoverSource`,
`seizedCollateralBaseUnits`, `seizedCollateralAmount`, and
`seizedCollateralSource` in `bestEstimate`. A blocked candidate can still
return calldata previews for operator/fork inspection:

```bash
id=$(jq -r '.candidates[0].id' data/aave-liquidation-candidates-ethereum.json)
curl -s -X POST "http://localhost:4000/api/aave-liquidation-candidates/$id/execution-plan" \
  -H 'content-type: application/json' \
  -d '{"capital":"1000000000","maxSlippageBps":30,"maxGasUsd":25}' \
  | jq '.transactions[] | select(.method=="liquidationCall(address,address,address,uint256,bool)") | {calldataStatus,calldataBytes,hasCalldata:(.calldata!=null),params}'
```

Latest verified result:

```text
calldataStatus=ready-after-quote
calldataBytes=164
hasCalldata=true
status=blocked
```

Latest Aave watchlist:

```text
artifact=aave-liquidation-watchlist-ethereum.json
historicallyStablePairCount=5
watchCandidateCount=2
liquidatableCount=0
nearLiquidationCount=0
watchCount=2
passingCurrentProfitabilityCount=0
liveExecutionStatus=blocked
```

Run a resumable Base `LiquidationCall` replay:

```bash
AAVE_REPLAY_CHAIN=base AAVE_REPLAY_RESUME=1 AAVE_REPLAY_TO_BLOCK=48310884 \
  AAVE_REPLAY_LOOKBACK_BLOCKS=5000 AAVE_REPLAY_LOG_CHUNK_BLOCKS=10 \
  AAVE_REPLAY_MAX_LOG_REQUESTS=20 AAVE_REPLAY_MAX_EVENTS=20 \
  AAVE_REPLAY_RPC_TIMEOUT_MS=8000 \
  npm run replay:aave-liquidations
```

Latest resumable Base probe:

```text
artifact=aave-liquidation-event-replay-candidates-base.json
eventCount=0
scannedBlockCount=400
nextEndBlock=48310484
scanComplete=false
candidateCount=0
passingCount=0
status=did-not-find-five-passing-aave-liquidation-event-replays
```

The resume state is written to `data/aave-liquidation-replay-state-base.json`.
Keep the same `AAVE_REPLAY_TO_BLOCK` and lookback to continue walking backward
through the sampled window without resetting prior ranges.

## Compound V3 Liquidation Scan

Run a conservative pure on-chain Compound V3 liquidation scan:

```bash
COMP_LIQ_CHAIN=ethereum COMP_LIQ_LOOKBACK_BLOCKS=50 \
  COMP_LIQ_LOG_CHUNK_BLOCKS=10 COMP_LIQ_ACCOUNT_LIMIT=5 \
  COMP_LIQ_BASE_AMOUNTS=10 npm run search:compound-liquidations
```

Latest result:

```text
artifact=compound-v3-liquidation-candidates-ethereum.json
candidateCount=1
passingCount=0
requestedPassingCount=5
status=did-not-find-five-passing-compound-v3-liquidation-opportunities
```

Run a resumable historical `AbsorbCollateral` event replay:

```bash
COMP_REPLAY_RESUME=1 COMP_REPLAY_TO_BLOCK=25479679 \
  COMP_REPLAY_LOOKBACK_BLOCKS=1000 COMP_REPLAY_LOG_CHUNK_BLOCKS=10 \
  COMP_REPLAY_MAX_LOG_REQUESTS=5 COMP_REPLAY_MAX_EVENTS=5 \
  COMP_REPLAY_RPC_TIMEOUT_MS=8000 \
  npm run replay:compound-liquidations
```

Latest resumable replay probe:

```text
artifact=compound-v3-liquidation-candidates-event-replay-ethereum.json
eventCount=0
scannedBlockCount=100
nextEndBlock=25479579
scanComplete=false
candidateCount=0
passingCount=0
status=did-not-find-five-passing-compound-v3-liquidation-event-replays
```

The resume state is written to
`data/compound-v3-liquidation-replay-state-ethereum.json`. Keep the same
`COMP_REPLAY_TO_BLOCK` and lookback while continuing the scan; each run advances
`nextEndBlock` backward without losing previously scanned ranges or events.

Latest API smoke:

```text
GET /api/compound-v3-liquidation-candidates/artifacts
candidateCount=1 passingCount=0

POST /api/compound-v3-liquidation-candidates/:id/execution-plan
planStatus=blocked
strategyType=compound-v3-liquidation-arbitrage
comet=0xc3d688B66703497DAA19211EEdff47f25384cdc3

POST /api/compound-v3-liquidation-candidates/:id/live-runs
runStatus=blocked
runStrategyId=atomic-amm
runBlockers=9
```

This scan uses the Compound V3 Comet current state: recent Comet events discover
accounts, `isLiquidatable` filters unsafe accounts, `borrowBalanceOf` and
`collateralBalanceOf` size the account, and `quoteCollateral` estimates whether
discounted collateral can be bought after `absorb`. The pass gate is
intentionally conservative: current base reserves must already be below target,
the quoted collateral must fit the account collateral balance, and estimated
profit after gas must clear the thresholds.

`CompoundV3LiquidationExecutor` is now implemented and unit-tested:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage/contracts
$HOME/.foundry/bin/forge test --match-contract CompoundV3LiquidationExecutorTest -vv
```

Latest result:

```text
CompoundV3LiquidationExecutorTest: 5 passed
```

The deployment entrypoint also compiles:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage/contracts
$HOME/.foundry/bin/forge build --contracts script/DeployCompoundV3LiquidationExecutor.s.sol
```

Record a deployed executor:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
COMPOUND_V3_LIQUIDATION_EXECUTOR_ADDRESS=<deployed executor> \
COMPOUND_V3_COMET=0xc3d688B66703497DAA19211EEdff47f25384cdc3 \
DEPLOY_CHAIN_ID=1 \
npm run record:compound-v3-executor-deployment
```

`apps/api/src/executionPlans.ts` resolves the Compound executor in this order:

```text
1. COMPOUND_V3_LIQUIDATION_EXECUTOR_ADDRESS
2. DEX_ARB_EXECUTOR_ADDRESS
3. data/executor-deployments.json deployments[chainId].compoundV3LiquidationExecutor
```

Live execution remains blocked until a current candidate passes
`isLiquidatable`, reserves, buy-collateral, collateral-unwind quote, and
same-block fork transaction gates. The current artifact has
`isLiquidatable=false`, so the executor must not be submitted yet.

Implementation note: `apps/api/src/candidates.ts` now resolves the repo `data`
directory from either the monorepo root or `apps/api`, so artifact endpoints
work when the API is started with `npm --prefix apps/api run dev`.

## Morpho Blue Liquidation Scan

Run a conservative pure on-chain Morpho Blue liquidation scan:

```bash
MORPHO_LIQ_MARKET_LIMIT=40 MORPHO_LIQ_POSITION_LIMIT=50 \
  MORPHO_LIQ_GAS_USD=20 npm run search:morpho-liquidations
```

For the 11 markets that passed the historical Morpho replay stability gate,
run the targeted current-opportunity scan:

```bash
ids=$(node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync('data/morpho-blue-liquidation-event-replay-candidates-ethereum.json','utf8')); const stable=j.candidates.filter(c=>String(c.gate.reason).includes('historical stability gates passed')); console.log([...new Set(stable.map(c=>c.marketId))].join(','));")
MORPHO_LIQ_CHAIN=ethereum MORPHO_LIQ_MARKET_IDS="$ids" \
  MORPHO_LIQ_POSITION_LIMIT=100 MORPHO_LIQ_POSITION_PAGES=2 \
  MORPHO_LIQ_GAS_USD=20 npm run search:morpho-liquidations
```

Latest result:

```text
artifact=morpho-blue-liquidation-candidates-ethereum.json
marketCount=11
candidateCount=1310
passingCount=0
liquidatableCount=1
nearLiquidationCount=4
watchCount=5
highestLtv=1.086610
requestedPassingCount=5
status=did-not-find-five-passing-morpho-blue-liquidation-opportunities
```

Latest API smoke:

```text
GET /api/morpho-blue-liquidation-candidates/artifacts
candidateCount=2302 passingCount=0

POST /api/morpho-blue-liquidation-candidates/:id/execution-plan
planStatus=blocked
strategyType=morpho-blue-liquidation-arbitrage
morpho=0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb

POST /api/morpho-blue-liquidation-candidates/:id/live-runs
runStatus=blocked
runStrategyId=atomic-amm
runBlockers=8
```

This scan uses Morpho's official GraphQL API for market and position discovery,
then constrains live plans to the on-chain Morpho Blue `liquidate` interface.
The pass gate requires LTV at/above LLTV, estimated net profit after gas, and a
minimum return on repay. Live execution remains blocked until a candidate passes,
a Morpho liquidation adapter exists, collateral unwind is routed, and same-block
fork simulation passes.

Latest targeted scan note: one current USDC/WETH borrower is technically
liquidatable, and fork smoke reports
`morpho-blue-liquidation-profitability-gate-blocked`; the debt is only about
0.00058 USD and the estimated net profit is about -20 USD after gas. This is
useful opportunity-detection evidence, not a runnable strategy.

Build the current Morpho opportunity watchlist after the current scan and
historical replay artifacts exist:

```bash
npm run watch:morpho-liquidations
```

Latest watchlist:

```text
artifact=morpho-blue-liquidation-watchlist-ethereum.json
historicallyStableMarketCount=11
watchCandidateCount=10
liquidatableCount=1
nearLiquidationCount=4
watchCount=5
passingCurrentProfitabilityCount=0
liveExecutionStatus=blocked
```

API:

```text
GET /api/morpho-blue-liquidation-watchlist
```

The watchlist is the right feed for a future block-by-block worker: it narrows
the 1310 targeted current candidates to the 10 borrowers that are already
liquidatable, near liquidation, or worth lower-priority monitoring in markets
with historical replay edge. It still does not make any entry runnable until
current profitability, fork simulation, and collateral unwind gates pass.

### Morpho Blue liquidation replay

Run the Morpho historical liquidation replay:

```bash
MORPHO_REPLAY_CHAIN=ethereum MORPHO_REPLAY_GRAPHQL_FIRST=1000 \
  MORPHO_REPLAY_LOG_CHUNK_BLOCKS=10 MORPHO_REPLAY_MAX_LOG_REQUESTS=2 \
  npm run replay:morpho-liquidations
```

The replay combines Morpho official GraphQL `marketTransactions` rows filtered
to `Liquidation` with an RPC `eth_getLogs` path over the Morpho Blue
`Liquidate` event. The RPC provider currently limits log ranges to 10 blocks,
so keep `MORPHO_REPLAY_LOG_CHUNK_BLOCKS=10` unless using a paid/archive RPC.

Latest result:

```text
artifact=morpho-blue-liquidation-event-replay-candidates-ethereum.json
marketCount=163
candidateCount=992
passingCount=0
graphqlRowCount=992
durationDays=62.70
historicalStabilityPassedButLiveBlockedCount=147
historicalStabilityPassedButLiveBlockedMarketCount=11
status=did-not-find-five-passing-morpho-blue-liquidation-event-replay-opportunities
```

Interpretation: the replay found real historical Morpho liquidations, including
positive estimated event PnL. 147 events across 11 markets pass the historical
stability gate, but no current liquidatable borrower has passed same-block fork
simulation. It must remain blocked under the current-state live gate.

The workers process also starts a Morpho watchlist refresher unless
`MORPHO_WATCHER_DISABLED=1` is set. It reruns the current Morpho scan and
watchlist build on `MORPHO_WATCH_REFRESH_MS` intervals, defaults to Ethereum,
and writes `metrics_ts` rows under `scope_id=morpho-watchlist:<chain>`.
The Morpho fork gate now also records a `collateralUnwindQuote` field. For a
currently liquidatable borrower it attempts a Uniswap V3 quote from collateral
asset back to loan asset on the same fork block; if the borrower is not
liquidatable, the report records that the quote was not attempted.

### Aave V3 live-gate update, 2026-07-08 CST

The latest Aave current scan was expanded on Ethereum with the historically
passing replay pair assets only:

```bash
LIQ_CHAIN=ethereum \
LIQ_RESERVE_SYMBOLS=USDT,USDC,DAI,WBTC,WETH,wstETH \
LIQ_SCAN_DESCENDING=1 \
LIQ_LOOKBACK_BLOCKS=50000 \
LIQ_USER_LIMIT=80 \
LIQ_MAX_LOG_REQUESTS=600 \
LIQ_LOG_CHUNK_BLOCKS=10 \
LIQ_RPC_TIMEOUT_MS=20000 \
npm run search:liquidations
```

The RPC provider rejects `eth_getLogs` ranges above 10 blocks on the current
free tier, so keep `LIQ_LOG_CHUNK_BLOCKS=10` unless the RPC plan changes.

Latest current scan result:

```text
artifact=aave-liquidation-candidates-ethereum.json
discoveredDebtUsers=46
candidateCount=38
passingCount=0
status=did-not-find-five-passing-liquidation-opportunities
nearestTopCandidate=liq-ethereum-b8a451-weth-wsteth
nearestTopCandidateHealthFactor=1.057248
```

Latest watchlist with a wider monitor band:

```bash
AAVE_WATCH_CHAIN=ethereum \
AAVE_WATCH_NEAR_HEALTH_FACTOR=1.05 \
AAVE_WATCH_HEALTH_FACTOR=1.15 \
npm run watch:aave-liquidations
```

```text
artifact=aave-liquidation-watchlist-ethereum.json
stablePairs=5
watchCandidateCount=4
liquidatableCount=0
nearLiquidationCount=1
passingCurrentProfitabilityCount=0
closestHistoricalPair=USDT/WETH
closestHistoricalPairHealthFactor=1.039920
closestHistoricalPairEstimatedNetProfitUsd=438.2432
```

The Aave fork rehearsal now deploys `AaveV3LiquidationExecutor` before
collateral unwind route search, so executor deployment and unwind quote
failures are reported independently. The executor calldata is only built when
the unwind status is `quoted` or `not-required`; a `no-route` quote leaves
`executeLiquidationCalldataStatus=blocked-collateral-unwind-quote-required`.

`AAVE_UNWIND_RPC_TIMEOUT_MS` now defaults to 12000 ms. The previous 1500 ms
smoke setting produced false `no-route` results on LST collateral because
Uniswap V3 quoter calls timed out. With the new default, the latest Aave smoke
found a wstETH -> USDC -> WETH Uniswap V3 route and built executor calldata:

```text
candidateId=liq-ethereum-b8a451-weth-wsteth
executorDeploymentStatus=passed
executorCollateralUnwindQuoteStatus=quoted
executorCalldataStatus=withheld-health-factor-not-below-one
executorCalldataBytes=740
healthFactor=1.057247
```

Interpretation: this is closer to real wallet-only execution than the previous
state because deployment, quote, and calldata gates can pass for the current
top Aave candidate. Live execution still must remain blocked because the
account is not liquidatable yet. The next true unblock requires HF < 1 on a
current borrower, a fresh same-block unwind quote, fork simulation, and a
positive after-gas profit/loss-revert check.

Follow-up update: the Aave live monitor and fork gate now use the verified
mainnet-search parameters by default. `startAaveLiquidationWatchlistWorker`
runs the current Aave scan before rebuilding the watchlist with:

```text
LIQ_LOOKBACK_BLOCKS=50000
LIQ_LOG_CHUNK_BLOCKS=10
LIQ_MAX_LOG_REQUESTS=600
LIQ_USER_LIMIT=80
LIQ_RPC_TIMEOUT_MS=20000
AAVE_WATCH_NEAR_HEALTH_FACTOR=1.05
AAVE_WATCH_HEALTH_FACTOR=1.15
```

`scripts/run-pure-arbitrage-search.mjs` uses the same wider Ethereum Aave scan
when `PURE_ARB_RUN_SCANS=1`, so a full search run no longer overwrites the
current artifact with the older 80-block Ethereum scan.

The API fork-simulation timeout is now configurable through
`FORK_SIMULATION_TIMEOUT_MS` and defaults to 240000 ms. The fork script also
defaults to `AAVE_UNWIND_RPC_TIMEOUT_MS=12000` and
`AAVE_UNWIND_MAX_ROUTE_ATTEMPTS=8`, which is enough to find the current
wstETH -> USDC -> WETH quote without the API killing the child process at
120 seconds.

The Aave fork report now records a deeper executor gate:

```text
unwindTargetConfigResults=[]
executorForkSimulation.status=skipped-health-factor-not-below-one
```

While HF is above 1, the simulator intentionally does not send the executor
configuration transaction. When HF is below 1 and executable calldata exists,
the same fork path will whitelist the Uniswap unwind target, run
`eth_estimateGas`, run `eth_call`, then send the executor transaction on the
fork. Only if that transaction passes can the Aave fork report become
`status=passed`; otherwise live execution remains blocked.

The API execution plan also withholds user-submittable
`executeLiquidation(...)` calldata at the plan layer. Its transaction row now
uses `calldataStatus=fork-gated`, leaves `calldata=null`, and keeps only
`calldataBytes` as an ABI sanity check. The fork simulator still generates the
real executor calldata after same-block HF, unwind, and profit gates are
evaluated. This prevents the frontend from presenting placeholder unwind
fields as a real wallet transaction.

### Aave executor deployment registration

The repo now has a production deployment entrypoint for the tested Aave V3
flash-loan liquidation executor:

```bash
cd contracts
$HOME/.foundry/bin/forge script script/DeployAaveV3LiquidationExecutor.s.sol \
  --rpc-url "$RPC_ETHEREUM_URL" \
  --broadcast \
  --private-key "$PRIVATE_KEY" \
  --tc DeployAaveV3LiquidationExecutorScript
```

Optional deployment env:

```text
AAVE_POOL=<override pool address>
AAVE_EXECUTOR_ADMIN=<override admin address>
```

After deployment, record the executor in the API-readable manifest:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
AAVE_LIQUIDATION_EXECUTOR_ADDRESS=<deployed executor> \
DEPLOY_CHAIN_ID=1 \
AAVE_EXECUTOR_DEPLOY_TX_HASH=<tx hash> \
npm run record:aave-executor-deployment
```

The recorder writes `data/executor-deployments.json` by default, or the path in
`EXECUTOR_DEPLOYMENTS_PATH`. `apps/api/src/executionPlans.ts` resolves the Aave
executor in this order:

```text
1. AAVE_LIQUIDATION_EXECUTOR_ADDRESS
2. DEX_ARB_EXECUTOR_ADDRESS
3. data/executor-deployments.json deployments[chainId].aaveV3LiquidationExecutor
```

This only removes the deployment-address blocker. Live Aave liquidation still
remains blocked until the same-block health-factor, collateral unwind quote,
fork execution, and positive after-gas profit gates pass.

### Wallet atomic arbitrage executor deployment registration

DEX, Curve stable, Balancer V2, and Uniswap V3 fee-route strategies should use
the wallet-first atomic executor instead of the vault-oriented
`StrategyExecutor`. The wallet path is:

```text
connected wallet -> ERC20 approve -> WalletAtomicArbitrageExecutor.execute(...)
```

The executor pulls the start asset from the connected wallet, routes through
whitelisted adapters, requires the route to close back into the start asset,
and reverts atomically unless the result clears `minProfitAssets`.

Deploy the wallet executor and standard adapters:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage/contracts
$HOME/.foundry/bin/forge script script/DeployWalletAtomicArbitrageExecutor.s.sol \
  --rpc-url "$RPC_ETHEREUM_URL" \
  --broadcast \
  --private-key "$PRIVATE_KEY" \
  --tc DeployWalletAtomicArbitrageExecutorScript
```

Optional deployment env:

```text
WALLET_ARB_ADMIN=<override admin address>
BALANCER_VAULT=<Balancer V2 Vault address, if deploying Balancer adapter>
AERODROME_ROUTER=<Aerodrome Router address, e.g. Base 0xcF77...>
AERODROME_FACTORY=<Aerodrome default factory address>
```

After deployment, record the executor and adapter addresses:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
WALLET_ATOMIC_ARB_EXECUTOR_ADDRESS=<deployed wallet executor> \
UNISWAP_V2_ADAPTER_ADDRESS=<deployed adapter> \
UNISWAP_V3_ADAPTER_ADDRESS=<deployed adapter> \
CURVE_STABLE_SWAP_ADAPTER_ADDRESS=<deployed adapter> \
BALANCER_V2_VAULT_ADAPTER_ADDRESS=<deployed adapter, optional> \
AERODROME_STABLE_ADAPTER_ADDRESS=<deployed stable adapter, optional> \
AERODROME_VOLATILE_ADAPTER_ADDRESS=<deployed volatile adapter, optional> \
DEPLOY_CHAIN_ID=1 \
npm run record:wallet-arb-executor-deployment
```

The API DEX/Curve/Balancer execution plans resolve this wallet executor in this
order:

```text
1. WALLET_ATOMIC_ARB_EXECUTOR_ADDRESS
2. DEX_ARB_EXECUTOR_ADDRESS
3. data/executor-deployments.json deployments[chainId].walletAtomicArbitrageExecutor
```

This removes only the production deployment-address blocker for wallet-funded
atomic swap routes. It does not make a candidate live-ready by itself: fresh
same-block quote, calldata generation, fork simulation, adapter whitelist,
allowance/balance, private routing assumptions, and positive after-gas
loss-revert checks must still pass before a wallet transaction is shown or
auto-submitted.

Latest `npm run smoke:pure-live-interfaces` confirms the fork rehearsal mode:

```text
dex-quote-replay reason=aerodrome-mixed-route-net-loss-reverted send=reverted
uniswap-v3-fee-arb rehearsal=wallet-atomic-executor-rehearsal send=reverted
curve-stable-arb rehearsal=wallet-atomic-executor-rehearsal send=reverted
balancer-v2-arb rehearsal=wallet-atomic-executor-rehearsal send=reverted
```

Interpretation: the wallet-style execution path is now represented in fork
tests, including the canonical Base Uniswap V3 -> Aerodrome stable route, but
current public routes are still unprofitable and remain blocked.

### Pendle PT fixed-yield convergence

Run the Pendle carry/convergence scan:

```bash
npm run search:pendle-pt-arb
```

Latest result:

```text
artifact=pendle-pt-arbitrage-candidates.json
chainCount=5
candidateCount=75
economicCandidateCount=3
passingCount=0
status=did-not-find-five-passing-pendle-pt-carry-candidates
```

Interpretation: the scan found 3 current markets above 20% implied APY with at
least 100k USD liquidity, but they are not counted as passing pure arbitrage.
PT carry requires holding or exiting a position and must remain blocked until
historical PT price replay, exit-liquidity stress, Pendle router quote,
redemption path, and fork simulation are wired.

## User Flow

1. Open `/candidates`.
2. Pick a current 20%+ candidate.
3. Click `Evidence backtest`.
4. Workers pick up the queued backtest and write evidence metrics from `data/strategy-candidates.json`.
5. Click `Live plan` to prepare a dry-run adapter plan.
6. Inspect approvals, target contract, calldata template, risk limits, and blockers.
7. For pure DEX arbitrage scan rows, click `Live plan` to inspect the atomic-route plan; `Fork sim` remains disabled until the quote replay and deployment gates pass.
8. For Curve stable arbitrage scan rows, click `Live plan` to inspect the Curve/Uniswap atomic-route plan; execution remains blocked until replay, route-level fork simulation, and deployment gates pass.
9. For Balancer arbitrage scan rows, click `Live plan` to inspect the Balancer/Uniswap atomic-route plan; execution remains blocked until replay, route-level fork simulation, and deployment gates pass.
10. For Compound V3 liquidation scan rows, click `Live plan` to inspect the Comet absorb/buyCollateral plan; execution remains blocked until liquidatability, reserves, route-level fork simulation, and deployment gates pass.
11. For Morpho Blue liquidation scan rows, click `Live plan` to inspect the Morpho liquidate/collateral-unwind plan; execution remains blocked until LTV/LLTV, route-level fork simulation, and deployment gates pass.
12. Use the Morpho Blue liquidation watchlist panel to inspect historically stable markets with current liquidatable, near-liquidation, and watch borrowers.
13. Use `/api/pendle-pt-arbitrage-candidates/artifacts` to inspect Pendle PT carry/convergence candidates. They are read-only research artifacts today and do not have a live execution plan.
14. Click `Start run` to create a live run request for supported LP/yield candidates.
15. Workers preflight the run; current MVP shows quote, pool state, mint preview, transaction preview, and wallet balance/allowance status where available, then blocks it until quote/fork/live adapter gates are complete.
16. If wallet preflight says `needs-approval`, click `Send approve` for each approval call.
17. After wallet confirmation, click `Rerun preflight` so workers read the new allowance and re-estimate gas.
18. Open `/vaults`.
19. Open a registered ERC-4626 vault.
20. Enter amount in base units.
21. Click `Approve + Deposit`.
22. Wallet signs ERC20 `approve` and ERC-4626 `deposit`.

## What Still Needs Implementation

To reach the user's full target, the next engineering tasks are:

1. Deploy/register real vaults for Base/Ethereum candidate assets.
2. Replace the price-driven token split with a pool-aware price-impact quote.
3. Re-estimate gas after approvals/final quote and include mint/rebalance calls in max-gas gates.
4. Extend fork-simulation gates from LP preview calls to every pure DEX and
   liquidation execution path. Aave now has a tested flash-loan liquidation
   executor and fork deployment/calldata rehearsal, but still needs a current
   HF<1 borrower, collateral unwind quote, whitelisted unwind target, and
   positive after-gas debt-asset profit gate before live execution can unblock.
5. Build Uniswap V3 NonfungiblePositionManager adapter.
6. Build Aerodrome Slipstream adapter.
7. Build Curve adapter for stable LP positions.
8. Wire Compound V3 fork simulation to send the deployed
   `CompoundV3LiquidationExecutor` transaction when a current candidate is
   liquidatable and has a same-block collateral unwind route. The executor and
   deployment recorder exist; the current candidate is not liquidatable.
9. Build Morpho Blue liquidation adapter and collateral unwind transaction
   routing. The fork report can now attempt a collateral-to-loan quote, but the
   audited liquidate/callback calldata and loss-reverting settlement are still
   missing.
10. Add Pendle PT historical price replay, router quote, PT redemption/exit path, and fork simulation before considering PT carry as an executable model.
11. Convert mint/rebalance preview calldata into signed wallet/vault transaction builders after fork tests.
12. Replace live run `blocked` preflight with `ready/running` only after quote engine and fork simulation pass.
13. Add withdraw/redeem transaction builder in the web UI.
14. Replace evidence backtests with real swap-event replay for LP fee accrual.
15. Add live execution workers that mint/burn/rebalance LP positions.
16. Add risk manager integration for IL, range exits, max rebalance cost, max position size.
17. Add pure-arbitrage MEV-Share integration if private orderflow access becomes available.

The current overview has 9 strategy families, 34 artifacts, 2789 candidates,
5/5 historical evidence gates, and 0/5 live-ready gates. The repo is an honest
research/backtest/live-gate system with a reproducible candidate feed and
wallet path, not a production auto-arbitrage system yet.
