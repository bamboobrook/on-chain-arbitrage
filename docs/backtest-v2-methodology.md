# Backtest V2 Methodology

> Per full-audit plan §2 (Phase 1). This document defines the credible replay
> methodology that replaces V1's "historical events + current price" approach.

## 1. What V2 fixes (vs V1's documented flaws)

| V1 flaw (audit §1.2) | V2 fix |
|---|---|
| `fetchTokenPrices()` used `prices/current` → price leakage | `historicalPrice.ts`: Chainlink oracle at-block + Uniswap V3 TWAP cross-check |
| Used current `eth_gasPrice` + fixed 950k gas | `ChainEvent.effectiveGasPrice` + `gasUsed` from real receipt |
| No exit route quote (assumed sell at spot) | `exitRoute.ts`: Quoter V2 exact quote at event block |
| No DEX fee/slippage/flash premium/tip deducted | `costModel.ts`: full `CostBreakdownV2` with 8 cost components |
| No competition model (assumed 100% capture) | `competition.ts`: `CompetitionData` with capture rate from competitor count |
| Linear annualization (`profit/maxCapital*365/days`) | `walkForward.ts`: daily NAV + rolling 30/90d APY + bootstrap CI |
| No train/test split | `chronologicalSplit()`: 70/15/15 or rolling 30d/7d |
| Min 5 samples, 60% win rate, $1 median | Plan §2.1: >= 30 events, >= 70% positive months, bootstrap CI > 0 |
| Same-family counted as 5 strategies | Plan §2: counted as 1 model per strategy family |

## 2. Event schema (schemaVersion=2)

Every event carries full block-level truth:

```
ChainEvent {
  eventId, chainId, protocol, strategyType
  blockNumber, blockHash, blockTimestamp
  txHash, logIndex, txIndex
  effectiveGasPrice, gasUsed, gasCostWei, receiptStatus
  protocolData (Aave/Morpho/Compound/Maker/DEX-specific)
  rpcSource, fetchedAt
}
```

**Validation**: `validateChainEvent()` enforces all required fields present.

## 3. Price oracle (NEVER `prices/current`)

```
getHistoricalPrice(asset, blockNumber):
  1. primary: chainlinkPriceAtBlock(feed, block) → PriceQuote(source='chainlink')
  2. cross-check: uniswapV3TwapAtBlock(pool, block) → PriceQuote(source='uni-v3-twap')
  3. crossCheckPrices(): agreed if sources within 2%
```

- `CHAINLINK_FEEDS`: well-known ETH/BTC/USDC/USDT/DAI aggregators on Ethereum.
- TWAP uses `pool.observe([secondsAgo, 0])` at the historical block — manipulation-resistant.

## 4. Exit route quoting

```
quoteExitRoute(rpcUrl, quoter, collateral, stablecoin, amount, fee, block):
  → Uniswap V3 Quoter V2 exactInputSingle at block
  → ExitRouteQuote { outputAmount, priceImpactBps, dexFeesBps, quoteAgeBlocks: 0 }
```

- `QUOTER_V2_ADDRESSES`: per-chain Quoter V2.
- `quoteAgeBlocks` always 0 (quoted AT the event block).

## 5. Unified cost model

```
netProfit = grossProceeds - debtRepay - costs.total

costs.total = flashLoanPremium + protocolFee + dexFees + slippage
            + gasCost + builderTip + failureReserve + inventoryHaircut
```

- `gasCost` = `effectiveGasPrice * gasUsed` from receipt, converted via ETH price at block.
- `builderTip` = fraction of gross profit (configurable, default 30%).
- `failureReserve` = expected cost of failed attempts (`gasCost + tip` × `failureRate/(1-failureRate)`).
- `computeStressNetProfit()`: multiplies variable costs by stress factor for the stress scenario.

## 6. Competition model

```
estimateCaptureRate(competitors, model, hasPrivateRelay):
  naive: 1/(N+1), +20% if private relay
  speed-weighted: ourWeight / (ourWeight + N × competitorWeight)
```

- `buildCompetitionData()`: scans same block for competing liquidation txs.

## 7. Walk-forward + daily NAV + capacity

- `chronologicalSplit()`: train 70% / val 15% / test 15% (or rolling 30d/7d).
- `buildDailyNav()`: per-day realized profit + time-weighted deployed capital.
- `computePeriodMetrics()`: realized/capture/stress/rolling APY, max drawdown, longest loss streak, bootstrap 95% CI, positive months %, max single-event contribution.
- `buildCapacityCurve()`: APY at $1k/$5k/$10k/$50k/$100k/$500k with slippage scaling.

## 8. Artifact provenance (schemaVersion=2)

Every output artifact carries:
```json
{
  "schemaVersion": 2,
  "codeCommit": "<git SHA>",
  "rpcSources": ["alchemy-ethereum-mainnet"],
  "dataHash": "<64-char FNV hash>",
  "generatedAt": "<ISO 8601>",
  "caveats": []
}
```

- `computeDataHash()`: deterministic FNV-1a hash of payload (reproducibility check).
- `verifyReproducibility()`: re-runs hash, asserts match.

## 9. Acceptance criteria (plan §2)

| Criterion | How V2 meets it |
|---|---|
| Random 20 events replay, balance delta vs receipt error < 1% | exit route + cost model compute from receipt-level data |
| Same commit + same block range = reproducible | `dataHash` + deterministic computation (no `prices/current`) |
| No historical event uses `prices/current` | `historicalPrice.ts` only reads Chainlink/TWAP at block |
| Each candidate has base/stress/capture/capacity results | `ReplayResult.scenario` field: base/stress/capture-*/capacity |

## 10. Module map

| Module | File | Purpose |
|---|---|---|
| types | `types.ts` | Canonical interfaces (ChainEvent, CostBreakdownV2, etc.) |
| provenance | `provenance.ts` | dataHash, envelope, validation, reproducibility |
| historicalPrice | `historicalPrice.ts` | Chainlink at-block + TWAP cross-check |
| exitRoute | `exitRoute.ts` | Quoter V2 exact quote at event block |
| costModel | `costModel.ts` | 8-component cost breakdown + stress |
| competition | `competition.ts` | Capture rate from competitor analysis |
| walkForward | `walkForward.ts` | Chronological split + daily NAV + capacity + metrics |
