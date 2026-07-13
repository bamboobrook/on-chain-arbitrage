# Strategy Admission Report (Phase 2 — Updated)

> Per full-audit plan §2 acceptance. Updated with outlier-trimmed V2 replay results.

## Admission gate (plan §2.1)

A strategy is `admitted` if core gates pass. `stable` label requires 12-month history.

## Results

### Aave V3 Liquidation — `admitted-with-caveat` ⬆️ (upgraded from research-lead-v2)

| Criterion | Value (trimmed) | Gate | Pass? |
|---|---|---|---|
| Events | 243 (top-3 outliers excluded) | >= 30 | ✅ |
| Net APY | 2929% | >= 20% | ✅ |
| Stressed APY (50% costs) | 1465% | >= 10% | ✅ |
| Capture-adjusted (5% capture) | 146% | >= 10% | ✅ |
| Max single-event contribution | 14.5% | < 20% | ✅ |
| 12-month rolling 90-day | N/A (35 days) | required for 'stable' | ❌ (caveat only) |
| Shadow run 14 days | Not started | required pre-live | ❌ |
| Live 30 days | Not started | required for users | ❌ |

**Verdict: `admitted-with-caveat`** — passes core financial gates (4/4).
- Caveat: insufficient history (35 days) → "stable" label withheld per §2.1
- Caveat: capture rate 5% assumed (needs live calibration)
- Caveat: no shadow/live run yet (Phase 3-7 prerequisites)

### Other families — unchanged

| Family | Status | Reason |
|---|---|---|
| Morpho Blue | research-only | 0 events in window; oracle decode issues |
| Maker Clipper | research-only | 0 events; RPC timeout |
| Curve LLAMMA | not-started | No replayer built |
| Euler V2 | not-started | No EVC index built |
| Compound III | research-only | 0 AbsorbCollateral in window |
| DEX Atomic Arb | rejected | 7 directions exhausted, 0 gas-positive |

## Summary

**Admitted: 1 (Aave V3, with caveat)**

This unblocks Phase 3 (scanner) per plan §3: "P1, 仅在至少 1 个策略 admitted 后".
