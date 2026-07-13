# Current On-chain Arbitrage Model Research - 2026-07-07

## Scope

This memo answers the user's original product question under three hard
constraints:

1. Pure on-chain execution: users should not need a centralized exchange
   account. They connect a wallet, approve on-chain contracts, and optionally
   deposit into a non-custodial vault/executor.
2. The target return gate is 20%+ annualized net return, but this must be an
   evidence gate, not a marketing promise.
3. Research must not stop after finding a single strategy family. The current
   implementation and scan design should support several model families in one
   system.

## Bottom Line

The model families exist. The latest Aave V3 liquidation event replay now has
five historical candidates above the evidence gate, but the evidence for a
stable, public, wallet-only, live-executable 20%+ annualized arbitrage product
still does not.

The project currently scans 9 pure on-chain families across 25 artifacts and
2713 candidates. The latest machine-readable overview reports:

```text
familyCount=9
artifactCount=25
candidateCount=2713
passingCount=5
liveReadyPassingCount=0
requestedPassingCount=5
status=found-at-least-five-passing-pure-on-chain-backtests
liveExecutionStatus=blocked
```

This is the correct product posture: expose candidate research, backtests,
fork simulations, and wallet preflight UX, while keeping live execution blocked
until current opportunities, executable calldata, fresh quotes, fork simulation,
and loss-revert gates pass.

## Public Model Families Reviewed

| Model family | Pure on-chain? | Wallet-only UX possible? | Production caveat |
|---|---:|---:|---|
| DEX-DEX exact-input arbitrage | Yes | Yes, through executor/vault approval | Extremely competitive; gas and builder tips often consume edge. |
| Uniswap V3 cross-fee flash arbitrage | Yes | Yes, through flash callback executor | Needs same-block pool state and revert-on-loss execution. |
| Curve/Balancer stable-pool arbitrage | Yes | Yes, through adapters | Usually tiny spreads; must model pool fees, slippage, gas, and pool-specific risk. |
| Aave V3 liquidations | Yes | Yes, through bot/executor approval | Event-driven and latency-sensitive; only valid when health factor is below 1. |
| Compound III liquidations | Yes | Yes, through Comet calls | `absorb` and discounted collateral purchase are gated by current liquidatability and reserves. |
| Morpho Blue liquidations | Yes | Yes, through market-specific liquidation calls | Requires market parameter recovery, oracle checks, LLTV math, and front-run handling. |
| Flashbots MEV-Share backrun arbitrage | Yes | Partly; backend/searcher infra required | Requires private bundle infra and competitive builder/user kickbacks. |
| CoW solver / intent surplus capture | Not a simple vault strategy | Not directly for retail users | This is an operator/solver competition, not a passive wallet-only APY product. |
| LP market-making / yield rotation | On-chain but not pure arbitrage | Yes | Can show 20%+ APY snapshots, but carries IL, emissions, and range/rebalance risk. |

## Source Notes

Ethereum.org's MEV documentation describes DEX arbitrage and liquidations as
well-known MEV opportunities, and says DEX arbitrage is highly competitive.
It also notes that searchers may pay a very large share of MEV revenue in gas
or priority fees when competing for inclusion:
https://ethereum.org/developers/docs/mev/

Flashbots MEV-Share documents a backrun arbitrage model where a contract
calculates trade parameters from on-chain state at execution time and reverts
if the opportunity is not profitable. Its fee guidance also warns that healthy
competition can push builder/user tips toward most of the net profit:
https://docs.flashbots.net/flashbots-mev-share/searchers/tutorials/flash-loan-arbitrage/simple-blind-arbitrage

Uniswap V3 documents both ordinary `exactInputSingle` swaps and flash swaps.
The flash flow withdraws token balances first, then requires repayment of the
borrowed amounts plus fees before the transaction completes:
https://developers.uniswap.org/docs/protocols/v3/guides/swapping/single-hop-swapping
https://developers.uniswap.org/docs/protocols/v3/guides/flash-swaps/getting-started
https://developers.uniswap.org/docs/protocols/v3/guides/flash-swaps/flash-callback

Balancer V2 documents `batchSwap` and `queryBatchSwap`. `queryBatchSwap` is
useful for off-chain quoting via `eth_call`, and the actual transaction must
use explicit limits with slippage tolerance:
https://docs-v2.balancer.fi/reference/swaps/batch-swaps.html

Curve documents `get_dy` for quote estimation and `exchange` for execution in
StableSwap pools:
https://docs.curve.finance/stableswap-exchange/stableswap/pools/plain_pools/

Aave V3 documents `liquidationCall`, where a liquidator can repay debt and
receive discounted collateral only when the borrower's health factor is below 1.
Aave's user-facing liquidation guide also states liquidations are permissionless
but highly competitive:
https://aave.com/docs/aave-v3/smart-contracts/pool
https://aave.com/help/borrowing/liquidations

Compound III documents `isLiquidatable`, `absorb`, `buyCollateral`, and
`quoteCollateral` as the liquidation path:
https://docs.compound.finance/liquidation/

Morpho documents market parameters including `lltv`, market state accessors,
and `liquidate` for eligible borrower positions. The current implementation
also uses Morpho's official GraphQL `marketTransactions` index for historical
`Liquidation` rows, while keeping production eligibility tied to current
on-chain state and same-block fork simulation:
https://docs.morpho.org/get-started/resources/contracts/morpho/
https://docs.morpho.org/tools/offchain/api/morpho/
https://github.com/morpho-org/morpho-blue/blob/main/src/libraries/EventsLib.sol

CoW Protocol documents open solver competition and delegated intent execution.
This can capture arbitrage-like surplus, but it is an operator model rather
than a passive wallet-only strategy:
https://docs.cow.fi/cow-protocol/concepts/introduction/solvers
https://docs.cow.fi/cow-protocol/concepts/introduction/fair-combinatorial-auction

## Engineering Design Implications

The product should be framed as an on-chain strategy lab and execution system,
not as a guaranteed yield product.

Required gates before any user capital can be routed into live execution:

1. Historical replay shows 20%+ annualized net return after gas and slippage.
2. Out-of-sample replay preserves the edge without curve fitting.
3. Capacity tests show the strategy can absorb the user's capital without
   erasing the edge.
4. Fresh same-block quotes pass.
5. Fork simulation passes with real contract calls and loss-reverting executor
   logic.
6. Wallet balance, allowance, chain ID, and max-loss limits pass.
7. Production executor/adapters are deployed, audited, and whitelisted.
8. Live kill-switch, per-user caps, daily loss caps, and pause controls are
   active.

## Current Repo Fit

The repository already matches this posture:

- `/candidates` displays model families, evidence, run planning, and wallet
  preflight state.
- Users can connect an injected wallet; the page reads `eth_accounts` and
  `eth_chainId`, listens for account/chain changes, and can request approval
  transactions for preflight calls.
- The API and worker path can create blocked live-run requests with capital,
  route, quote, transaction preview, and fork-simulation state.
- The unified pure overview now separates historical evidence from live
  readiness: 5/5 historical Aave replay candidates pass, but 0/5 candidates are
  live-ready, so production execution remains blocked.
- Aave V3 now also has a current-opportunity watchlist that maps the five
  historical replay pairs back to current borrowers. The latest fast current
  scan checked 25 recent debt users across 6 reserves with 0 failed log ranges;
  the watchlist found 2 watch rows, 0 liquidatable rows, and 0 current
  profitability passes.
- Aave V3 execution plans now include a `liquidationCall` calldata preview when
  the current scan can estimate `debtToCover` in base units. This improves the
  live interface and fork-debug path, but it is still blocked until the borrower
  is actually liquidatable and the flash-loan/collateral-unwind executor passes
  same-block simulation.
- Aave V3 fork simulation now preserves that distinction in a machine-readable
  report. The current Aave scan now records estimated seized collateral base
  units so the fork gate can attempt a collateral-to-debt unwind quote.
  `AaveV3LiquidationExecutor` has a targeted Foundry suite proving the
  flash-loan callback, liquidation, collateral unwind, repayment, profit
  transfer, and revert-on-loss behavior against mocks. The targeted smoke for
  `liq-ethereum-07cc49-gho-wbtc` now verifies both API plan previews and fork
  previews: a 164-byte `liquidationCall` and a 420-byte
  `executeLiquidation(...)`. The fork deployed the executor and attempted the
  collateral unwind quote, but the current WBTC->GHO Uniswap V3 unwind returned
  `no-route`; execution was also withheld because the forked borrower health
  factor was `1.411926`, returning `aave-liquidation-health-factor-not-below-one`.

## Recommended Next Searches

1. Add more L2/sidechain DEX profiles: Optimism, BNB Chain, Avalanche, and
   Gnosis, if reliable RPCs are available.
2. Expand Uniswap V3 cross-fee scanning beyond the current Base, Arbitrum,
   Ethereum, Polygon, Optimism, and BNB artifacts, especially for deeper pairs
   and additional L2 chains.
3. Turn liquidation scans into event-driven historical replay rather than only
   current-state snapshots. Morpho now has both an RPC `Liquidate` log replay
   path and a GraphQL-indexed liquidation history path; the latest artifact has
   992 historical rows across 163 markets over about 62.7 days. It found 147
   events across 11 markets that clear the historical stability gate. A targeted
   current scan over those 11 markets found one currently liquidatable borrower,
   but its debt is only about 0.00058 USD and estimated net profit is still about
   -20 USD after gas, so it remains blocked. A separate current-opportunity
   watchlist now tracks 10 borrowers in those historically stable markets:
   1 liquidatable, 4 near-liquidation, and 5 watch entries, with 0 passing
   current profitability gates. The worker process now includes a Morpho
   watchlist refresher that can rerun the current scan and watchlist build on a
   fixed interval, while preserving the same profitability and fork gates.
4. Continue Aave V3 liquidation event replay and live-gate work. The corrected
   replay scanner now supports newest-to-oldest scanning, failed-range retry,
   RPC retry/backoff, batch delay, and coverage-quality reporting. On Ethereum,
   a 250k-block lookback fixed at block 25480924 has scanned 169,940 blocks
   with 0 failed ranges, found 259 liquidation events, 47 candidates, and 5
   historical gate passes:
   `USDT/WBTC`, `USDC/WBTC`, `DAI/WETH`, `USDT/WETH`, and `USDT/wstETH`.
   Live execution is still blocked because these are historical events; the
   system still needs current liquidatable borrower detection for these pairs,
   execution-block `liquidationCall` calldata that is not withheld by the health
   factor gate, debt sourcing, collateral unwind quotes, full flash-loan fork
   simulation, and loss-reverting settlement.
   A current Aave watchlist is now wired at `/api/aave-liquidation-watchlist`
   and in `/candidates`; it uses newest-first debt-token scanning with a
   request budget so workers can refresh it periodically without exhausting RPC.
5. Scan Pendle PT fixed-yield convergence as a separate carry/convergence
   family. The first scan found 75 active Pendle markets across Ethereum,
   Arbitrum, Base, BNB, and HyperEVM, including 3 current economic candidates
   above 20% implied APY and 100k USD liquidity. All remain blocked because this
   is not same-block atomic arbitrage and still needs historical PT price
   replay, exit-liquidity stress, router quote, redemption path, and fork
   simulation before it can count toward the 5-strategy target.
6. Add a MEV-Share dry-run searcher that can consume event hints, simulate
   bundles, and record whether builder tips leave any net edge.
7. Keep LP/yield candidates in a separate non-arbitrage section so 20%+ APY
   snapshots never contaminate the pure-arbitrage evidence gate.

## Decision

Do not open real live execution for user funds yet. Historical evidence has
reached the 5-strategy admission target in Aave replay, but live readiness is
still 0/5. Continue converting the historical candidates into current-state
watchers and fork-gated transaction builders, and keep the public product copy
strict:

> 20%+ is a strategy admission target. It is not a guaranteed return.
