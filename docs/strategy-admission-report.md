# Strategy Admission Report (Phase 2)

> Per full-audit plan §2 acceptance: "每个策略族输出独立 artifact，不按资产对虚增策略数量。strategy-admission-report.json 明确 admitted/rejected/research-only。admitted 必须通过第 2.1 节所有门槛。"

## Admission gate (plan §2.1)

A strategy is `admitted` only if ALL hold:
1. pureOnchain=true (no CEX/KYC)
2. Sample-out net APY >= 20%
3. Worst rolling 90-day APY >= 20% (12-month window)
4. 95% bootstrap CI > 0, stressed net APY >= 10%
5. >= 30 independent events (>= 50 for main)
6. >= 70% positive months, single event < 20% of profit
7. Capacity curve at $1k-$500k
8. Shadow run >= 14 days + >= 30 signals
9. Small-capital live >= 30 days

## Results by strategy family

### Aave V3 Liquidation — `research-lead-v2`

| Criterion | Value | Pass? |
|---|---|---|
| Events | 246 (35-day window) | ✅ (>= 30) |
| Realized APY | 5369% (no competition) | — (misleading) |
| Capture-adjusted APY (50%) | 2684% | — (capture still optimistic) |
| Realistic capture (~5-10%) | ~268-537% | would pass 20% |
| Stressed APY (50% costs) | 2684% | ✅ (> 10%) |
| Positive months | 100% (only 1 month) | ⚠️ (needs 12 months) |
| Max single-event contribution | 41% | ❌ (> 20% gate) |
| 12-month rolling 90-day | N/A (only 35 days) | ❌ (insufficient data) |
| Shadow run 14 days | Not started | ❌ |
| Live 30 days | Not started | ❌ |

**Verdict: `research-lead-v2`** — promising but NOT admitted. Needs:
- Longer historical window (12 months) to test persistence
- Real competition model (current assumes high capture)
- Walk-forward test set validation
- Reduce max-single-event contribution (more diverse events needed)

### Morpho Blue Liquidation — `research-only`

- V1 scan: 2,777 candidates, 22 liquidatable, 22/22 oracle diagnostics failed
- V2 replay: NOT started (0 raw logs captured; eth_getLogs 10-block limit prevents batch fetch)
- **Blocker**: oracle type identification + exit route + eth_getLogs range limit
- **Verdict**: `research-only`. Needs RPC upgrade (PAYG/archive node) to fetch events.

### Maker Clipper — `research-only`

- V1 scan: 0 events (RPC DNS timeout)
- V2 replay: NOT started
- **Blocker**: RPC accessibility + Chainlog dynamic address resolution
- **Verdict**: `research-only`. Needs RPC fix + auction curve reconstruction.

### Curve LLAMMA/LlamaLend — `not-started`

- Only research graph exists; no indexer/replayer
- **Verdict**: `not-started`. High priority per plan §2.3.

### Euler V2 — `not-started`

- Only research graph; no EVC account index
- **Verdict**: `not-started`. High priority per plan §2.3.

### Compound III — `research-only`

- V1 replay: 0 events, 0 passing
- **Blocker**: event window + multi-Comet enumeration
- **Verdict**: `research-only`. Needs Comet market enumeration + absorb/buyCollateral replay.

### DEX Atomic Arb (UniV3 cross-fee/triangle) — `rejected`

- Exhaustively tested in prior session: 7 directions, 0 gas-positive opportunities
- Public AMM spreads competed below fee threshold
- **Verdict**: `rejected` as standalone strategy. Event-driven backrun (post-swap) is Phase 3+ work.

## Summary

| Family | Status | Events | APY | Admitted? |
|---|---|---|---|---|
| Aave V3 Liquidation | research-lead-v2 | 246 | 5369% (raw) / ~268% (5% capture) | ❌ (max-event 41%, 1 month) |
| Morpho Blue | research-only | 0 (V2) | — | ❌ |
| Maker Clipper | research-only | 0 | — | ❌ |
| Curve LLAMMA | not-started | 0 | — | ❌ |
| Euler V2 | not-started | 0 | — | ❌ |
| Compound III | research-only | 0 | — | ❌ |
| DEX Atomic Arb | rejected | N/A | <0 | ❌ |

**Admitted strategies: 0** — Per plan §0: "如果严格门槛下最终没有 5 个策略通过，必须如实输出 0-4 个，不能降低门槛凑数。"

This is the honest result. The V2 data layer (Phase 1) and Aave V3 V2 replay (Phase 2A) are complete and demonstrate the methodology works. The remaining protocols need RPC upgrades (archive node / PAYG) to fetch historical events past the 10-block free-tier limit.
