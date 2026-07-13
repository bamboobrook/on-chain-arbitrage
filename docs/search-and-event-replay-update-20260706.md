# Search and Event Replay Update - 2026-07-06

## Bottom Line

Current search still does not support the claim that there are five pure on-chain arbitrage models that can guarantee or stably maintain 20%+ annualized return for public users.

The product should not promise fixed APY. The honest product shape is:

> A non-custodial on-chain strategy lab where users connect a wallet, approve on-chain contracts, and can run only strategies that pass replay evidence, fork simulation, gas/capacity checks, and live risk gates.

## 2026-07-07 Interface Update

The system now has a repeatable smoke for the pure on-chain live-run interface:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
npm run smoke:pure-live-interfaces
```

Latest result:

```text
caseCount=8
passedInterfaceCount=8
liveExecutionStatus=blocked
artifact=data/pure-live-interface-smoke.json
```

Four AMM/replay arbitrage interfaces and four liquidation interfaces now go
beyond a missing-calldata report:

- DEX quote replay: all-Uniswap-V3 direct route rehearsal plus executor
  rehearsal.
- Curve stable arbitrage: Uniswap V3 plus Curve 3pool mixed-route executor
  rehearsal.
- Balancer V2 arbitrage: Uniswap V3 plus Balancer V2 Vault mixed-route executor
  rehearsal.
- Uniswap V3 cross-fee replay: direct Uniswap V3 route rehearsal.
- Aave V3, Compound V3, Morpho current-state, and Morpho event-replay
  liquidation rows: protocol state fork gates.

For the all-Uniswap-V3 Base triangular route, the fork simulator:

- funds the test wallet on the Anvil fork by locating the ERC20 balance storage
  slot,
- refreshes same-block Uniswap V3 quotes,
- builds ERC20 `approve` and SwapRouter02 `exactInputSingle` calldata,
- executes all three swap hops, and
- measures final start-token PnL.
- deploys fork-only `StrategyExecutor` and `UniswapV3Adapter` contracts,
  whitelists the adapter, funds the executor, builds `execute(...)` calldata,
  and verifies the unprofitable route reverts atomically through the executor.

Latest DEX result:

```text
candidate=tri-base-usdc-weth-cbbtc-uniswapv3-uniswapv3-uniswapv3
forkMode=dex-direct-route-rehearsal
forkReason=dex-direct-route-net-loss
calls=6/6
netProfit=-8346342
totalGasUsed=597931
strategyExecutor.ethCallStatus=reverted
strategyExecutor.sendStatus=reverted
strategyExecutor.executeCalldataBytes=772
```

Latest Curve result:

```text
candidate=curve-eth-curve-fi-dai-usdc-usdt-usdt-dai-uniswapv3-to-curve3crv-100
forkMode=curve-mixed-route-rehearsal
forkReason=curve-mixed-route-net-loss-reverted
calls=0/0
netProfit=-620662
totalGasUsed=472709
adapters=UniswapV3Adapter,CurveStableSwapAdapter
strategyExecutor.sendStatus=reverted
strategyExecutor.executeCalldataBytes=612
```

Latest Balancer result:

```text
candidate=balancer-eth-wbtc-weth-uniswapv3-to-balancerv2-0-005
forkMode=balancer-mixed-route-rehearsal
forkReason=balancer-mixed-route-net-loss-reverted
calls=0/0
netProfit=-5359
totalGasUsed=395347
adapters=UniswapV3Adapter,BalancerV2VaultAdapter
strategyExecutor.sendStatus=reverted
strategyExecutor.executeCalldataBytes=612
```

Latest Aave result:

```text
candidate=liq-ethereum-e0ca60-usdt-weth
forkMode=aave-liquidation-gate-check
forkReason=aave-liquidation-health-factor-not-below-one
healthFactor=2.001475
```

Latest Compound V3 result:

```text
candidate=compound-v3-liq-ethereum-0dd50b-base-collateral
forkMode=compound-v3-liquidation-gate-check
forkReason=compound-v3-liquidation-account-not-liquidatable
isLiquidatable=false
```

Latest Morpho Blue result:

```text
candidate=morpho-blue-liq-ethereum-bcd16d-usdc-cbbtc
forkMode=morpho-blue-liquidation-gate-check
forkReason=morpho-blue-liquidation-ltv-below-lltv
ltv=0.4917
lltv=0.86
liquidatable=false
borrowAssets=171326646018963
maxBorrowAssets=299655881871576
```

This proves executable calldata can be produced and run for these AMM route
classes, but it also proves the tested routes are not profitable at the forked
blocks. The executor rehearsal proves the loss-reverting shape for DEX, Curve,
and Balancer routes, but the production path still needs deployed audited
contracts, monitoring, private routing policy, and fresh profitability gates
before any real wallet funds can be submitted.

For Aave, Compound V3, and Morpho Blue, the fork simulator now reads protocol
state from the fork before considering calldata construction. Aave reads
`getUserAccountData(address)` from the Aave V3 Pool and blocks when health
factor is not below 1. Compound reads `isLiquidatable(address)` from Comet and
blocks when the account is not liquidatable. Morpho reads `position`, `market`,
and oracle `price()` from the fork, recomputes LTV versus LLTV, and blocks when
the position is below the liquidation threshold. These are stronger than the
prior generic missing-calldata reports: they prove the current candidates are
not liquidatable at the checked block, independently of liquidation executor
wiring.

Covered families:

- DEX quote replay
- Curve stable arbitrage
- Balancer V2 arbitrage
- Aave V3 liquidations
- Compound V3 liquidations
- Morpho Blue liquidations

For each family, the smoke verifies `execution-plan -> live-runs ->
fork-simulation -> live-run readiness` using an injected wallet address and
capital input. The current smoke no longer relies on a generic missing-calldata
reason for any of the six families: AMM routes reach fork rehearsal and
liquidation routes reach protocol-specific fork gates.

This confirms the product interface is wired and audited for safe failure. It
does not prove profitability, and it does not enable real transaction
submission.

## Search Findings

| Model | Pure on-chain | User needs CEX | 20%+ stable/guaranteed | Current decision |
| --- | --- | --- | --- | --- |
| DEX-to-DEX flash arbitrage | yes | no | no | keep as future MEV/searcher module; not a public fixed-yield model |
| Aave/Balancer flash-loan arbitrage | yes | no | no | useful capital primitive, but edge must exist after fee, slippage, gas, and competition |
| Stablecoin/peg deviation arbitrage | yes | no | no | opportunistic, lumpy, capacity-limited |
| Lending liquidations | yes | no | no | real on-chain strategy class, but event-driven and cannot maintain fixed APY |
| Cross-chain/inventory arbitrage | partly | no | no | not atomic across chains; bridge, inventory, and finality risk |
| Concentrated LP market making | yes | no | no; not pure arbitrage | can show high observed fee APY, but carries IL and range/rebalance risk |

Relevant sources:

- Uniswap v3/v4 concentrated liquidity docs: in-range liquidity earns fees only while the position range spans the market price, and inactive positions stop accruing fees: https://docs.uniswap.org/concepts/protocol/concentrated-liquidity
- Uniswap fee docs: fees accrue pro-rata to active liquidity, and v3 positions must redeem fees separately: https://docs.uniswap.org/concepts/protocol/fees
- Uniswap v3 flash-swap guide: flash arbitrage depends on price-ratio differences and is affected by liquidity, slippage, gas, and volatility: https://docs.uniswap.org/contracts/v3/guides/flash-integrations/inheritance-constructors
- Aave V3 flash-loan docs: flash loans must be repaid with fees inside the same transaction or revert: https://aave.com/docs/aave-v3/guides/flash-loans
- Aave liquidation help: liquidation depends on health factor falling below 1 and is not a continuous yield source: https://aave.com/help/borrowing/liquidations
- Balancer V2 Vault API and batch swaps: `queryBatchSwap`/Vault settlement are the on-chain basis for the Balancer route scanner and rehearsal: https://docs-v2.balancer.fi/reference/contracts/apis/vault.html and https://docs-v2.balancer.fi/reference/swaps/batch-swaps.html
- Balancer V3 flash-loan docs: flash-loan execution is atomic and repayment/settlement must complete in the same transaction: https://docs.balancer.fi/concepts/vault/flash-loans.html
- Curve docs: StableSwap pools expose `get_dy`/`exchange`-style quote and swap surfaces used by the Curve route scanner and rehearsal: https://docs.curve.finance/
- Compound III liquidation docs: liquidations use `absorb`/collateral purchase mechanics and are event-driven rather than fixed APY: https://docs.compound.finance/liquidation/
- Morpho Blue docs: liquidation eligibility is governed by market parameters such as LLTV and current position state: https://docs.morpho.org/
- Flashbots simple-arbitrage repo explicitly says the public example is very unlikely to be profitable because many users can access it and it targets well-known opportunities: https://github.com/flashbots/simple-arbitrage
- DeFiLlama Yields API remains the current high-APY candidate source: https://yields.llama.fi/pools

## Implemented Today

Added a real on-chain event replay path for the best-developed live candidate:

- Candidate: `candidate-4-base-weth-usdc`
- Chain: Base
- Pool: Uniswap V3 WETH/USDC 0.05%
- Pool address: `0xd0b53d9277642d899df5c87a3966a349a798f224`
- Script: `scripts/replay-uniswap-v3-lp-fees.mjs`
- Artifact: `data/event-replay-candidate-4-base-weth-usdc.json`
- API endpoint: `GET /api/strategy-candidates/:id/event-replay`
- Live run response field: `event_replay_evidence`
- Readiness gate: `profitability-backtest`
- Frontend: `/candidates` live run panel now displays event replay evidence.

The replay pulls real `Swap` logs from Base RPC, decodes Uniswap V3 swap amounts, estimates pool fees, applies a hypothetical LP liquidity share, estimates position value versus hold value, subtracts gas assumptions, annualizes the result, and then applies strict evidence gates.

## Current Replay Artifact

Last generated artifact:

```text
generatedAt=2026-07-06T09:37:13.277Z
window=48270026..48270525
durationDays=0.0115509259
swapCount=166
grossFeeApyPct=104.4601
ilApyPct=-74.3404
gasApyPct=-1.8029
netApyPct=28.3168
gate=block
evidenceStatus=net-apy-observed-but-sample-too-short-or-thin
```

Interpretation:

- The short replay window estimated net APY above 20%.
- The sample is only about 16.6 minutes, so the system correctly blocks the profitability gate.
- This is LP event replay, not pure arbitrage replay.
- The result must not be marketed as stable or guaranteed yield.

## How To Run

Small verification window:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
REPLAY_BLOCKS=500 REPLAY_CHUNK_SIZE=100 node scripts/replay-uniswap-v3-lp-fees.mjs candidate-4-base-weth-usdc
```

Longer research window, subject to RPC speed/rate limits:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
REPLAY_BLOCKS=300000 REPLAY_CHUNK_SIZE=100 node scripts/replay-uniswap-v3-lp-fees.mjs candidate-4-base-weth-usdc
```

Useful environment knobs:

- `REPLAY_BLOCKS`: number of latest blocks to scan.
- `REPLAY_FROM_BLOCK` / `REPLAY_TO_BLOCK`: explicit block window.
- `REPLAY_CHUNK_SIZE`: log-query chunk size; current RPC was slow above 100-500 blocks per chunk.
- `REPLAY_CAPITAL_USD`: hypothetical LP capital, default `10000`.
- `REPLAY_RANGE_WIDTH_TICKS`: fixed range around initial tick, default `600`.
- `REPLAY_MIN_DAYS_FOR_GATE`: minimum duration before profitability gate can pass, default `7`.
- `REPLAY_MIN_SWAPS_FOR_GATE`: minimum swap count before profitability gate can pass, default `100`.

## Verified Smoke

The full live smoke passed after this change:

```text
eventReplay=block replayNetApy=28.31681608460301 profitabilityGate=block
readiness=blocked blockers=3 forkGate=pass
forkSimulation=passed calls=3 totalGasUsed=534257 failedKind=none failedStatus=none failedError=none
```

Remaining blockers are intentionally still present:

- `profitability-backtest`: needs a longer, robust event replay before passing.
- `production-adapter`: live mint/rebalance execution remains disabled.
- `pure-arbitrage`: the current WETH/USDC candidate is LP market making, not pure arbitrage.

## Next Research Steps

1. Run 7-30 day replay windows on a faster archive RPC or batched log index.
2. Add independent Mint/Burn event replay so active liquidity and LP fee growth are reconstructed more exactly.
3. Add rebalancing simulations instead of a fixed tick range.
4. Add pure-arbitrage replay modules for DEX-DEX flash arbitrage, stablecoin peg arbitrage, and liquidation opportunities.
5. Add private orderflow / MEV relay integration only after replay and fork tests prove gas-positive opportunities.

## 2026-07-06 Pure DEX Arbitrage Scan

Added a separate pure on-chain DEX-DEX quote replay scanner:

```bash
npm run search:dex-arb
```

Direct command with explicit knobs:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
DEX_ARB_SAMPLE_COUNT=5 DEX_ARB_LOOKBACK_BLOCKS=1200 DEX_ARB_PAIR_LIMIT=10 \
  DEX_ARB_TRIANGLE_LIMIT=3 DEX_ARB_MAX_STRATEGIES=44 \
  node scripts/search-dex-arbitrage-candidates.mjs
```

For Arbitrum:

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
DEX_ARB_CHAIN=arbitrum DEX_ARB_SAMPLE_COUNT=3 DEX_ARB_LOOKBACK_BLOCKS=600 \
  DEX_ARB_PAIR_LIMIT=9 DEX_ARB_TRIANGLE_LIMIT=1 DEX_ARB_MAX_STRATEGIES=26 \
  node scripts/search-dex-arbitrage-candidates.mjs
```

The scanner currently compares Base Uniswap V3 vs Aerodrome and Arbitrum
Uniswap V3 vs Sushi V2 for both same-token round trips and triangular paths. It
uses historical `eth_call` quotes at sampled blocks and estimates gas before
deciding whether a candidate passes.

Current artifact:

```text
data/dex-arbitrage-candidates.json
candidateCount=44
triangularCount=24
passingCount=0
status=did-not-find-five-passing-quote-backtests

data/dex-arbitrage-candidates-arbitrum.json
candidateCount=26
triangularCount=8
passingCount=0
status=did-not-find-five-passing-quote-backtests

aggregate API
artifactCount=2
candidateCount=70
triangularCount=32
passingCount=0
```

Top current candidates were all negative after gas. Example output:

```text
tri-base-usdc-weth-cbbtc-uniswapv3-uniswapv3-uniswapv3 gate=block samples=5/5 win=0.00 annualized=-1959.41 medianNetUsd=-1.378734
arb-base-usdc-weth-uniswapv3-to-aerodrome gate=block samples=5/5 win=0.00 annualized=-4473.39 medianNetUsd=-2.506154
arb-base-weth-usdc-aerodrome-to-uniswapv3 gate=block samples=5/5 win=0.00 annualized=-4824.03 medianNetUsd=-4.733375
```

New API/frontend integration:

- `GET /api/dex-arbitrage-candidates/artifact`
- `GET /api/dex-arbitrage-candidates/artifacts`
- `GET /api/dex-arbitrage-candidates`
- `/candidates` now has a separate "Pure DEX arbitrage scan" table, backed by the aggregate multi-chain endpoint.

Important interpretation:

- This is the first true pure-arbitrage scan layer.
- It did not find five passing 20%+ strategies.
- The result strengthens the conclusion that public DEX-DEX arbitrage is highly competitive and cannot be promised as stable wallet-only yield.
- Live execution remains disabled for these candidates until atomic two-leg/three-leg adapters and fork simulation are implemented.

## 2026-07-06 Pure DEX Execution Plan Layer

Added a dry-run execution plan endpoint for quote-replayed DEX arbitrage
candidates:

- `POST /api/dex-arbitrage-candidates/:id/execution-plan`

The endpoint does not create a live run and does not return ready-to-send swap
calldata. It returns a blocked or pre-deployment execution plan containing:

- token path and DEX path
- required router contracts
- required adapter contracts
- start-token approval template
- atomic executor dependency
- risk limits
- fork simulation requirements
- quote replay gate evidence
- explicit blockers

Frontend integration:

- `/candidates` now adds `Live plan` to each pure DEX arbitrage scan row.
- The pure DEX plan renders separately from LP/yield live plans.
- `Fork sim` is intentionally disabled for DEX rows until the quote replay gate
  passes and the atomic route simulator is wired.

Verified smoke:

```text
POST /api/dex-arbitrage-candidates/tri-base-usdc-weth-cbbtc-uniswapv3-uniswapv3-uniswapv3/execution-plan
statusCode=200
plan.status=blocked
gate=block
blockedBy=5
routers=3
adapters=3
executor=null
```

Current interpretation:

- The system can now explain how a pure DEX candidate would be routed and what
  must be deployed/verified before live execution.
- The selected smoke candidate remains blocked because the quote replay gate did
  not pass and `DEX_ARB_EXECUTOR_ADDRESS` is not configured.
- This keeps the product honest: wallet-only UX is visible, but live public
  DEX arbitrage is not presented as stable 20%+ APY.

## 2026-07-06 Multi-Chain + Notional Sweep Update

Expanded `scripts/search-dex-arbitrage-candidates.mjs` beyond the original
Base/Arbitrum scan:

- Ethereum: Uniswap V3 vs Sushi V2.
- Polygon: Uniswap V3 vs QuickSwap V2.
- Polygon gas is now valued with WMATIC instead of ETH.
- DEX artifacts are now auto-aggregated by reading all
  `data/dex-arbitrage-candidates*.json` files.
- Added `DEX_ARB_AMOUNT_MULTIPLIERS` so a route can be quote-replayed at
  multiple input sizes and keep the best notional.

Commands run:

```bash
DEX_ARB_CHAIN=polygon DEX_ARB_SAMPLE_COUNT=3 DEX_ARB_LOOKBACK_BLOCKS=900 \
  DEX_ARB_PAIR_LIMIT=6 DEX_ARB_TRIANGLE_LIMIT=0 DEX_ARB_MAX_STRATEGIES=12 \
  DEX_ARB_AMOUNT_MULTIPLIERS=0.1,0.5,1,2,5,10 \
  npm run search:dex-arb

DEX_ARB_CHAIN=ethereum DEX_ARB_SAMPLE_COUNT=2 DEX_ARB_LOOKBACK_BLOCKS=300 \
  DEX_ARB_PAIR_LIMIT=5 DEX_ARB_TRIANGLE_LIMIT=1 DEX_ARB_MAX_STRATEGIES=14 \
  npm run search:dex-arb
```

Latest aggregate:

```text
artifactCount=4
candidateCount=96
passingCount=0
requestedPassingCount=5
status=did-not-find-five-passing-quote-backtests
```

Latest per-chain artifacts:

```text
Base       candidates=44 passing=0
Arbitrum   candidates=26 passing=0
Polygon    candidates=12 passing=0
Ethereum   candidates=14 passing=0
```

The Polygon notional sweep reduced losses on some stable routes, but still did
not produce positive net-after-gas samples:

```text
arb-polygon-usdt-usdc-uniswapv3-to-quickswapv2 gate=block samples=3/3 win=0.00 annualized=-4432.19 medianNetUsd=-0.253096
arb-polygon-usdc-usdt-quickswapv2-to-uniswapv3 gate=block samples=3/3 win=0.00 annualized=-4432.60 medianNetUsd=-0.253340
```

API smoke after this change:

```text
GET /api/dex-arbitrage-candidates/artifacts
artifactCount=4 candidateCount=96 passingCount=0

POST /api/dex-arbitrage-candidates/:id/execution-plan
planStatus=blocked
strategyId=atomic-amm
```

Added a blocked pure DEX live-run request path:

- `POST /api/dex-arbitrage-candidates/:id/live-runs`
- Inserts a `live_strategy_runs` row with `status=blocked`.
- Uses existing DB strategy id `atomic-amm`.
- Does not enqueue execution and does not submit transactions.

Smoke result:

```text
statusCode=201
status=blocked
strategy_id=atomic-amm
blocked_by=7
```

Interpretation: the wallet-only service path is more complete now for pure DEX
candidates, but every live route remains blocked because the evidence gate has
not passed and production DEX adapters/fork workers are still not enabled.

## 2026-07-06 Aave V3 Liquidation Scan

Added a second pure on-chain arbitrage family:

- `scripts/search-aave-liquidations.mjs`
- `npm run search:liquidations`
- `GET /api/aave-liquidation-candidates/artifacts`
- `GET /api/aave-liquidation-candidates`
- `/candidates` now displays an "Aave V3 liquidation scan" panel.

The scanner uses only chain data:

1. Reads Aave V3 reserves from the Pool contract.
2. Reads aToken, stable debt token, and variable debt token addresses.
3. Scans recent debt-token `Transfer` logs to discover borrower addresses.
4. Calls `getUserAccountData(address)` for each borrower.
5. Reads aToken and debt-token balances per reserve.
6. Estimates liquidation bonus, protocol fee, gas cost, and net profit.
7. Blocks unless `healthFactor < 1` and net profit gates pass.

Commands run:

```bash
LIQ_CHAIN=base LIQ_LOOKBACK_BLOCKS=500 LIQ_LOG_CHUNK_BLOCKS=10 \
  LIQ_USER_LIMIT=50 LIQ_RESERVE_SYMBOLS=USDC,WETH,USDbC,cbETH,wstETH \
  npm run search:liquidations

LIQ_CHAIN=arbitrum LIQ_LOOKBACK_BLOCKS=100 LIQ_LOG_CHUNK_BLOCKS=10 \
  LIQ_USER_LIMIT=20 LIQ_RESERVE_SYMBOLS=USDC,WETH,WBTC,USDT,ARB \
  npm run search:liquidations
```

RPC note: the configured Base/Arbitrum RPC is on a free tier that limits
`eth_getLogs` to 10-block ranges, so `LIQ_LOG_CHUNK_BLOCKS=10` is required.

Latest result:

```text
Base       discoveredDebtUsers=5 candidates=5 passing=0
Arbitrum   discoveredDebtUsers=1 candidates=1 passing=0
Ethereum   discoveredDebtUsers=4 candidates=4 passing=0
Polygon    discoveredDebtUsers=0 candidates=0 passing=0
Aggregate  artifactCount=4 candidateCount=10 passingCount=0
```

Representative candidates:

```text
liq-base-5d55be-usdc-weth gate=block hf=1.373751 netUsd=243.6908 reason=health factor 1.373751 is not below 1
liq-arbitrum-fd7cc9-usdc-weth gate=block hf=1.504545 netUsd=22.4467 reason=health factor 1.504545 is not below 1
liq-ethereum-e0ca60-usdt-weth gate=block hf=2.042366 netUsd=3012.3277 reason=health factor 2.042366 is not below 1
```

Interpretation:

- These are genuine pure on-chain liquidation-arbitrage candidates, not LP yield.
- None are executable because Aave only permits liquidation when health factor is below 1.
- Some accounts would be profitable if liquidatable, but the protocol gate blocks them.
- A production path still needs a flash-loan liquidation adapter, collateral unwind route,
  and same-block fork simulation.

## 2026-07-06 Aave Liquidation Execution Plan Layer

Added dry-run execution and blocked run-request paths for liquidation candidates:

- `POST /api/aave-liquidation-candidates/:id/execution-plan`
- `POST /api/aave-liquidation-candidates/:id/live-runs`
- `/candidates` now has `Live plan` and `Create run request` actions for Aave
  liquidation rows.

The execution plan includes:

- borrower address and latest health factor evidence
- Aave V3 Pool address
- selected debt/collateral pair
- flash-loan step
- `liquidationCall` step
- collateral unwind / repayment step
- debt-asset approval requirement
- risk limits
- preflight checks
- fork simulation requirements
- explicit blockers

Verified smoke:

```text
POST /api/aave-liquidation-candidates/:id/execution-plan
planStatus=blocked
planStrategyId=atomic-amm
healthFactor=1.5045446305403838
blockers=6

POST /api/aave-liquidation-candidates/:id/live-runs
statusCode=201
runStatus=blocked
runStrategyId=atomic-amm
runBlockers=8
```

Interpretation: the wallet/capital/run-record interface now exists for Aave
liquidations too, but live execution remains blocked because current candidates
are not liquidatable and the flash-loan liquidation executor is not deployed or
fork-tested.

## 2026-07-07 Curve Stablecoin Arbitrage Scan

Added a third pure on-chain arbitrage family:

- `scripts/search-curve-stable-arbitrage.mjs`
- `npm run search:curve-stable-arb`
- `GET /api/curve-stable-arbitrage-candidates/artifacts`
- `GET /api/curve-stable-arbitrage-candidates`
- `POST /api/curve-stable-arbitrage-candidates/:id/execution-plan`
- `POST /api/curve-stable-arbitrage-candidates/:id/live-runs`
- `/candidates` now displays a separate "Curve stable arbitrage scan" panel.

The scanner now discovers Ethereum USD stable pools from the Curve API, then
quote-replays Curve stable-pool routes against Uniswap V3 using historical
`eth_call` samples. It checks both route orders:

1. Curve pool first, then Uniswap V3 back to the start token.
2. Uniswap V3 first, then Curve pool back to the start token.

Command run:

```bash
CURVE_ARB_SAMPLE_COUNT=2 CURVE_ARB_LOOKBACK_BLOCKS=240 \
  CURVE_ARB_POOL_LIMIT=3 CURVE_ARB_PAIR_LIMIT=12 \
  CURVE_ARB_MAX_STRATEGIES=16 CURVE_ARB_AMOUNT_MULTIPLIERS=0.1 \
  npm run search:curve-stable-arb
```

Latest result:

```text
data/curve-stable-arbitrage-candidates-ethereum.json
candidateCount=16
passingCount=0
requestedPassingCount=5
status=did-not-find-five-passing-curve-stable-arbitrage-backtests
```

Best current candidates were still negative after gas:

```text
curve-eth-curve-fi-dai-usdc-usdt-usdt-dai-uniswapv3-to-curve3crv-100 gate=block samples=2/2 win=0.00 annualized=-517.61 medianNetUsd=-0.059055
curve-eth-curve-fi-dai-usdc-usdt-dai-usdt-curve3crv-to-uniswapv3-100 gate=block samples=2/2 win=0.00 annualized=-517.43 medianNetUsd=-0.059061
curve-eth-curve-fi-frax-usdc-usdc-frax-curvecrvfrax-to-uniswapv3-100 gate=block samples=2/2 win=0.00 annualized=-742.72 medianNetUsd=-0.084783
```

API smoke:

```text
GET /api/curve-stable-arbitrage-candidates/artifacts
artifactCount=1 candidateCount=16 passingCount=0

POST /api/curve-stable-arbitrage-candidates/:id/execution-plan
planStatus=blocked
strategyId=atomic-amm
gate=block
dexPath=uniswap-v3,curve-3pool
adapters=UniswapV3Adapter,CurveStableSwapAdapter

POST /api/curve-stable-arbitrage-candidates/:id/live-runs
statusCode=201
status=blocked
strategy_id=atomic-amm
blocked_by=7
```

Interpretation:

- This is a genuine no-CEX, pure on-chain stablecoin arbitrage scan.
- The latest artifact covers Curve 3pool plus FRAX/USDC routes discovered from
  the Curve API.
- It still found 0 passing 20%+ after-gas candidates.
- Live execution remains blocked until a candidate passes replay, the Curve
  route is covered by same-block revert-on-loss simulation, and verified
  adapters/executor are deployed and registered.

## 2026-07-07 Balancer V2 Arbitrage Scan

Added a fourth pure on-chain arbitrage family:

- `scripts/search-balancer-arbitrage-candidates.mjs`
- `npm run search:balancer-arb`
- `GET /api/balancer-arbitrage-candidates/artifacts`
- `GET /api/balancer-arbitrage-candidates`
- `POST /api/balancer-arbitrage-candidates/:id/execution-plan`
- `POST /api/balancer-arbitrage-candidates/:id/live-runs`
- `/candidates` now displays a separate "Balancer arbitrage scan" panel.

The scanner discovers Balancer V2 mainnet two-token pools through the Balancer
API, filters to liquid tokens with clear secondary markets by default, then
quote-replays both route orders:

1. Balancer V2 Vault `queryBatchSwap`, then Uniswap V3 back to the start token.
2. Uniswap V3, then Balancer V2 Vault `queryBatchSwap` back to the start token.

Command run:

```bash
BALANCER_ARB_SAMPLE_COUNT=2 BALANCER_ARB_LOOKBACK_BLOCKS=300 \
  BALANCER_ARB_PAIR_LIMIT=10 BALANCER_ARB_MAX_STRATEGIES=12 \
  BALANCER_ARB_AMOUNT_MULTIPLIERS=0.1,1 \
  npm run search:balancer-arb
```

Latest result:

```text
data/balancer-arbitrage-candidates-ethereum.json
candidateCount=12
passingCount=0
requestedPassingCount=5
status=did-not-find-five-passing-balancer-arbitrage-backtests
```

Representative candidates were still negative after gas:

```text
balancer-eth-wbtc-weth-uniswapv3-to-balancerv2-0-005 gate=block samples=2/2 win=0.00 annualized=-2966.18 medianNetUsd=-1.083512
balancer-eth-wbtc-weth-balancerv2-to-uniswapv3-0-005 gate=block samples=2/2 win=0.00 annualized=-3378.78 medianNetUsd=-1.234228
balancer-eth-bal-weth-balancerv2-to-uniswapv3-50 gate=block samples=2/2 win=0.00 annualized=-685574.38 medianNetUsd=-3.684053
```

API smoke:

```text
GET /api/balancer-arbitrage-candidates/artifacts
artifactCount=1 candidateCount=12 passingCount=0

POST /api/balancer-arbitrage-candidates/:id/execution-plan
planStatus=blocked
strategyId=atomic-amm
gate=block
dexPath=uniswap-v3,balancer-v2
adapters=UniswapV3Adapter,BalancerV2VaultAdapter

POST /api/balancer-arbitrage-candidates/:id/live-runs
statusCode=201
status=blocked
strategy_id=atomic-amm
blocked_by=7
```

Current pure on-chain aggregate evidence:

```text
DEX quote replay      artifacts=6 candidates=120 passing=0
Uniswap V3 fee arb    artifacts=6 candidates=132 passing=0
Aave liquidations     artifacts=4 candidates=10 passing=0
Aave event replay     artifacts=2 candidates=0 passing=0
Curve stable arb      artifacts=1 candidates=16 passing=0
Balancer V2 arb       artifacts=1 candidates=12 passing=0
Compound V3 liq       artifacts=2 candidates=1 passing=0
Morpho Blue liq       artifacts=2 candidates=2302 passing=0
Total pure on-chain   artifacts=24 candidates=2593 passing=0
```

Interpretation: Balancer, Uniswap V3 cross-fee scanning, and Aave event replay
expand the pure on-chain search surface. The later Uniswap V3 refresh added
Ethereum, Polygon, Optimism, and BNB artifacts, but the family still has 0 passing candidates.
Morpho was later extended with an official GraphQL-indexed liquidation history
artifact, but this still has 0 passing candidates.
They still do not produce five stable 20%+ after-gas strategies. Balancer live execution
must remain blocked until a candidate passes replay, the Balancer route is
covered by same-block revert-on-loss simulation, and verified adapters/executor
are deployed and registered.

## 2026-07-07 Aave Liquidation Event Replay

Added an eighth pure on-chain evidence family:

- `scripts/replay-aave-liquidation-events.mjs`
- `npm run replay:aave-liquidations`
- `GET /api/aave-liquidation-replay-candidates/artifacts`
- `GET /api/aave-liquidation-replay-candidates`
- `POST /api/aave-liquidation-replay-candidates/:id/execution-plan`
- `POST /api/aave-liquidation-replay-candidates/:id/live-runs`
- `data/aave-liquidation-event-replay-candidates-base.json`
- `data/aave-liquidation-event-replay-candidates-ethereum.json`

The replay reads real Aave V3 `LiquidationCall` logs, groups them by
debt/collateral pair, estimates gas-adjusted event PnL, and gates each pair by
historical sample count, net win rate, annualized net return, and median net
profit. This is different from the current-state liquidation scanner: it is a
historical evidence layer for the liquidation model.

The current RPC provider limits `eth_getLogs` to 10 blocks per request on the
free tier, so the script now supports resumable chunked log scanning through
`AAVE_REPLAY_RESUME=1`; state is stored in
`data/aave-liquidation-replay-state-<chain>.json`. Latest RPC-limited replay:

```text
Base      events=0 candidates=0 passing=0 scannedBlocks=400 nextEndBlock=48310484
Ethereum  events=0 candidates=0 passing=0
```

Interpretation: the replay infrastructure exists and is API/UI-visible, but the
sampled windows do not yet contain liquidation events. The Base replay can now
continue incrementally with the same `AAVE_REPLAY_TO_BLOCK`; a wider replay is
still faster with a paid/archive RPC, a protocol indexer, or an external event
data source.

## 2026-07-07 Uniswap V3 Cross-Fee Arbitrage Scan

Added a seventh pure on-chain search family:

- `scripts/search-uniswap-v3-fee-arbitrage.mjs`
- `npm run search:uniswap-v3-fee-arb`
- `GET /api/uniswap-v3-fee-arbitrage-candidates/artifacts`
- `GET /api/uniswap-v3-fee-arbitrage-candidates`
- `POST /api/uniswap-v3-fee-arbitrage-candidates/:id/execution-plan`
- `POST /api/uniswap-v3-fee-arbitrage-candidates/:id/live-runs`
- `data/uniswap-v3-fee-arbitrage-candidates-base.json`
- `data/uniswap-v3-fee-arbitrage-candidates-arbitrum.json`

The scan compares the same token pair across Uniswap V3 fee tiers, e.g.
`USDC -> WETH` through one fee tier and `WETH -> USDC` through another. It is
pure on-chain and wallet-only compatible because the execution template remains
an atomic two-hop Uniswap V3 route with revert-on-loss requirements.

Latest results:

```text
Base      candidates=24 passing=0
Arbitrum  candidates=12 passing=0
Total     candidates=36 passing=0
```

The Base top candidate was `uni-v3-fee-base-usdc-weth-500-to-100`; it still had
0% net win rate across the sampled blocks and therefore stayed blocked. The
pure live interface smoke now includes this family and verifies:

```text
pureLive|uniswap-v3-fee-arb|plan=blocked|fork=failed|reason=dex-direct-route-net-loss
```

## 2026-07-07 Compound V3 Liquidation Scan

Added a fifth pure on-chain search family:

- `scripts/search-compound-v3-liquidations.mjs`
- `npm run search:compound-liquidations`
- `GET /api/compound-v3-liquidation-candidates/artifacts`
- `GET /api/compound-v3-liquidation-candidates`
- `POST /api/compound-v3-liquidation-candidates/:id/execution-plan`
- `POST /api/compound-v3-liquidation-candidates/:id/live-runs`
- `data/compound-v3-liquidation-candidates-ethereum.json`
- included in `GET /api/pure-arbitrage/overview`
- `/candidates` now displays a separate "Compound V3 liquidation scan" panel.

The scanner targets Compound V3 Comet markets. It discovers recent active
accounts from Comet `Supply`, `Withdraw`, and `Transfer` events, checks
`isLiquidatable(address)`, reads `borrowBalanceOf` and `collateralBalanceOf`,
then uses `quoteCollateral` to estimate whether discounted collateral can be
bought after `absorb`.

Command run:

```bash
COMP_LIQ_LOOKBACK_BLOCKS=50 COMP_LIQ_LOG_CHUNK_BLOCKS=10 \
  COMP_LIQ_ACCOUNT_LIMIT=5 COMP_LIQ_BASE_AMOUNTS=10 \
  npm run search:compound-liquidations
```

Latest result:

```text
data/compound-v3-liquidation-candidates-ethereum.json
candidateCount=1
passingCount=0
requestedPassingCount=5
status=did-not-find-five-passing-compound-v3-liquidation-opportunities
```

API smoke:

```text
GET /api/compound-v3-liquidation-candidates/artifacts
artifact candidateCount=1 passingCount=0

POST /api/compound-v3-liquidation-candidates/:id/execution-plan
planStatus=blocked
strategyType=compound-v3-liquidation-arbitrage
blockedBy=7
comet=0xc3d688B66703497DAA19211EEdff47f25384cdc3

POST /api/compound-v3-liquidation-candidates/:id/live-runs
runStatus=blocked
runStrategyId=atomic-amm
blockedBy=9
```

Interpretation: Compound V3 expands the liquidation search surface beyond Aave,
but the latest conservative scan still found 0 passing opportunities. It also
does not prove recurring APY; it is a current-state liquidation opportunity
scanner that must remain gated by same-block fork simulation and a production
liquidation/unwind adapter.

## 2026-07-07 Morpho Blue Liquidation Scan

Added a sixth pure on-chain search family:

- `scripts/search-morpho-blue-liquidations.mjs`
- `npm run search:morpho-liquidations`
- `GET /api/morpho-blue-liquidation-candidates/artifacts`
- `GET /api/morpho-blue-liquidation-candidates`
- `POST /api/morpho-blue-liquidation-candidates/:id/execution-plan`
- `POST /api/morpho-blue-liquidation-candidates/:id/live-runs`
- `data/morpho-blue-liquidation-candidates-ethereum.json`
- included in `GET /api/pure-arbitrage/overview`
- `/candidates` now displays a separate "Morpho Blue liquidation scan" panel.

The scanner uses Morpho's official GraphQL API for market and position
discovery, then gates candidates using current LTV versus LLTV, a conservative
liquidation incentive estimate, gas, and minimum net profit thresholds. Live
plans are constrained to the on-chain Morpho Blue `liquidate` interface.

Command run:

```bash
MORPHO_LIQ_MARKET_LIMIT=4 MORPHO_LIQ_POSITION_LIMIT=10 \
  MORPHO_LIQ_GAS_USD=20 npm run search:morpho-liquidations
```

Latest result:

```text
data/morpho-blue-liquidation-candidates-ethereum.json
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

API smoke:

```text
GET /api/morpho-blue-liquidation-candidates/artifacts
artifact candidateCount=2302 passingCount=0

POST /api/morpho-blue-liquidation-candidates/:id/execution-plan
planStatus=blocked
strategyType=morpho-blue-liquidation-arbitrage
blockedBy=6
morpho=0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb

POST /api/morpho-blue-liquidation-candidates/:id/live-runs
runStatus=blocked
runStrategyId=atomic-amm
blockedBy=8
```

Interpretation: Morpho expands the pure on-chain liquidation search surface,
but the latest targeted current scan still found 0 passing opportunities. It
did find one currently liquidatable USDC/WETH borrower, but the debt is only
about 0.00058 USD and the estimated net profit is about -20 USD after gas. It
also does not prove recurring APY; it is a current-state liquidation scanner
that must remain gated by same-block fork simulation and a production
liquidation/unwind adapter.

Fork smoke now distinguishes this case from missing calldata: the current
liquidatable-but-uneconomic Morpho row fails with
`morpho-blue-liquidation-profitability-gate-blocked`, while replay rows whose
borrower is no longer liquidatable still fail with
`morpho-blue-liquidation-ltv-below-lltv`.

Added a current opportunity watchlist artifact and API:

- `scripts/build-morpho-blue-liquidation-watchlist.mjs`
- `npm run watch:morpho-liquidations`
- `data/morpho-blue-liquidation-watchlist-ethereum.json`
- `GET /api/morpho-blue-liquidation-watchlist`

Latest watchlist result:

```text
historicallyStableMarketCount=11
watchCandidateCount=10
liquidatableCount=1
nearLiquidationCount=4
watchCount=5
passingCurrentProfitabilityCount=0
liveExecutionStatus=blocked
```

Interpretation: the system now has a compact feed for a future Morpho watcher
worker, but it still found 0 currently profitable candidates.

## 2026-07-07 Morpho Blue Liquidation Event Replay

Added Morpho Blue historical liquidation replay evidence:

- `scripts/replay-morpho-blue-liquidation-events.mjs`
- `npm run replay:morpho-liquidations`
- `data/morpho-blue-liquidation-event-replay-candidates-ethereum.json`
- `data/morpho-blue-liquidation-replay-state-ethereum.json`
- included in `GET /api/morpho-blue-liquidation-candidates/artifacts`
- included in `GET /api/pure-arbitrage/overview`

The replay has two data paths:

1. RPC `eth_getLogs` over Morpho Blue `Liquidate(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)`.
2. Morpho official GraphQL `marketTransactions` filtered to `type_in: [Liquidation]`.

The RPC path is kept as the chain-native replay/check path, but the current RPC
provider limits `eth_getLogs` to 10 blocks per request. The GraphQL path is
therefore used as an official indexed history source to avoid stopping at an
empty 10-block sample.

Latest result:

```text
data/morpho-blue-liquidation-event-replay-candidates-ethereum.json
marketCount=163
candidateCount=992
passingCount=0
requestedPassingCount=5
graphqlRowCount=992
graphqlCandidateCount=992
rpcCandidateCount=0
coveredFromBlock=25030242
toBlock=25479931
durationDays=62.70
historicalStabilityPassedButLiveBlockedCount=147
historicalStabilityPassedButLiveBlockedMarketCount=11
status=did-not-find-five-passing-morpho-blue-liquidation-event-replay-opportunities
```

Top replayed events include positive historical estimates, for example one
large event with estimated `repayUsd=2028936.2237` and `netUsd=332554.2808`.
147 replayed events across 11 markets pass the historical stability gate, but
they still remain blocked because a current liquidatable borrower must be found
and fork-simulated before live execution can be enabled.

## 2026-07-07 Unified Pure-Arbitrage Overview

2026-07-07 later refresh: Polygon DEX quote replay was rerun with a wider
notional sweep than the prior 12-candidate artifact. Optimism and BNB DEX
quote replay artifacts were then added using Uniswap V3 plus Sushi V2/Pancake
V2 router quotes. The updated DEX family now has 6 artifacts, 120 candidates,
and still 0 passing candidates. Morpho Blue liquidation replay was then added
using Morpho's official GraphQL liquidation transaction index plus a resumable
RPC log replay path. The unified overview now reports 2593 total
pure on-chain candidates and 0/5
passing.

Compound V3 was also extended with a historical `AbsorbCollateral` event replay
artifact:

- `scripts/replay-compound-v3-liquidation-events.mjs`
- `npm run replay:compound-liquidations`
- `data/compound-v3-liquidation-candidates-event-replay-ethereum.json`

The replay script now supports resumable chunked log scanning through
`COMP_REPLAY_RESUME=1`; state is stored in
`data/compound-v3-liquidation-replay-state-ethereum.json`. The latest probe
scanned 100 blocks in 10-block chunks, found 0 events, and left
`nextEndBlock=25479579` with `scanComplete=false`. This makes the current RPC
usable for incremental evidence collection, though a paid/archive RPC or
protocol indexer is still needed for fast deep history.

Added a single API and frontend summary that aggregates all pure on-chain search
families:

- `scripts/run-pure-arbitrage-search.mjs`
- `npm run search:pure-overview`
- `GET /api/pure-arbitrage/overview`
- `data/pure-arbitrage-search-overview.json`
- `/candidates` now shows a "Pure on-chain search overview" panel before the
  individual candidate tables.

The overview reports:

- requested target: 5 passing pure on-chain strategies
- minimum evidence threshold: 20% annualized net return
- artifact count, candidate count, and passing count
- per-family status, best observed candidate, and run command
- current blockers that keep live execution disabled

The script defaults to overview-only mode so it does not overwrite existing
scan artifacts. To execute scan tasks before writing the overview, run it with
`PURE_ARB_RUN_SCANS=1`. Use `PURE_ARB_FAMILIES=<key>` to restrict the run.

Smoke result:

```text
npm run search:pure-overview
artifact=data/pure-arbitrage-search-overview.json
familyCount=8
artifactCount=24
candidateCount=2593
passingCount=0
requestedPassingCount=5
status=did-not-find-five-passing-pure-on-chain-backtests
liveExecutionStatus=blocked

GET /api/pure-arbitrage/overview
candidateCount=2593
passingCount=0
liveExecutionStatus=blocked
```

Interpretation: the system now has a single machine-readable gate for the user's
main requirement. It explicitly keeps live execution blocked while the evidence
shows 0/5 passing pure on-chain strategies.

## 2026-07-06/07 Contract Adapter Source Fixes

Patched the two contract adapter issues recorded in
`docs/contract-adapter-audit-20260706.md`:

- `contracts/src/adapters/UniversalDexAdapter.sol`
  - V3 swap now reads `token0` / `token1` from the pool and rejects invalid
    token pairs.
  - V3 callback data now includes the expected pool.
  - `uniswapV3SwapCallback` now requires `msg.sender == pool`.
  - Owed input is derived from `amount0Delta` / `amount1Delta`, and mismatched
    callback amounts revert.
- `contracts/src/adapters/UniswapV2Adapter.sol`
  - V2 swap now reads `token0` / `token1` from the pair and rejects invalid
    token pairs.
  - The adapter now transfers `tokenIn` directly from the executor to the pair
    before calling `swap`.
  - The adapter returns actual recipient output after the pair swap.
- `contracts/src/adapters/CurveStableSwapAdapter.sol`
  - New adapter discovers Curve pool coin indexes from `coins(uint256)` /
    `coins(int128)`.
  - It quotes with `get_dy`, executes classic StableSwap `exchange`, and
    transfers actual tokenOut to the recipient.
- `contracts/src/adapters/BalancerV2VaultAdapter.sol`
  - New adapter derives `poolId` from the pool contract and executes Balancer V2
    Vault `GIVEN_IN` swaps.
  - It settles through the configured Vault and transfers actual tokenOut to the
    recipient.

Verification:

```text
git diff --check passed for the adapter files
static grep confirmed callback pool validation and direct pair funding
/home/bumblebee/.foundry/bin/forge test -vv
25 tests passed, 0 failed, 0 skipped

RUN_FORK_TESTS=1 /home/bumblebee/.foundry/bin/forge test --match-contract AdapterBaseForkTest -vv
6 tests passed, 0 failed, 0 skipped
```

New tests:

- `contracts/test/AdapterSecurity.t.sol`
  - V2 adapter funds pair before swap.
  - V2 adapter rejects invalid pair tokens.
  - V3 adapter rejects callback from non-pool.
  - V3 adapter rejects callback amount mismatch.
  - V3 adapter pays pool and transfers output.
  - Curve adapter discovers pool coins and transfers output.
  - Curve adapter rejects unknown pool tokens.
  - Balancer adapter uses poolId and Vault settlement.
- `contracts/test/AdapterBaseFork.t.sol`
  - Optional Base fork smoke for Uniswap V3 WETH/USDC 0.05%.
  - Optional Polygon fork smoke for QuickSwap V2 USDC/WETH.
  - Optional Arbitrum fork smoke for Sushi V2 USDC/WETH.
  - Optional Arbitrum fork smoke for Uniswap V3 USDC/WETH 0.05%.
  - Optional Ethereum fork smoke for Curve 3pool DAI/USDC.
  - Optional Ethereum fork smoke for Balancer 80BAL/20WETH WETH/BAL.

Interpretation: the obvious source-level P0 issues are fixed and covered by
unit tests. The fork smoke suite now covers Base Uniswap V3, Arbitrum Uniswap
V3, Polygon QuickSwap V2, Arbitrum Sushi V2, Ethereum Curve 3pool, and Ethereum
Balancer V2. Production adapter gates must still remain blocked until fee-aware
quote parity, multi-hop loss-revert forks, deployment, and external review are
complete.
