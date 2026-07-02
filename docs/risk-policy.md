# Risk Policy

> ⚠️ This is a research/MVP build, **not audited**. Nothing here is legal or investment advice. If you plan to open this to public users and charge fees, engage a qualified crypto-securities lawyer in your target jurisdiction first (see design §15).

This document defines (a) what risk controls the system enforces, (b) the kill-switch rules, and (c) the gate a strategy must pass before being surfaced as a candidate to users.

## 1. Product-level principles

1. **Non-custodial, minimal custody.** Assets live in transparent `ArbVault` contracts. Users hold shares and can exit at any time (subject to a withdrawal queue if the strategy holds async positions).
2. **No return promises.** The product may show: *target APY*, *historical backtest APY (with window + cost model)*, *live rolling APY*. It must **never** show "guaranteed", "stable 20%+", "capital-protected", or "risk-free arbitrage".
3. **Public, parametrized strategies.** Parameters and strategy code are public; admin actions go through timelock.
4. **Verifiable on-chain record.** Every trade is traceable from opportunity → simulation → execution → on-chain event.

## 2. On-chain risk controls (enforced by `RiskManager` + `StrategyController`)

| Control | Default | Where |
|---|---|---|
| Max loss per single execution | configurable | `RiskManager` |
| Max cumulative loss per day (per strategy) | configurable | `RiskManager` |
| Max single-token exposure | configurable | `RiskManager` |
| Max single-DEX exposure | configurable | `RiskManager` |
| Allowed chain IDs | Base, Arbitrum | `RiskManager` |
| Token blacklist (fee-on-transfer, rebasing, sanction) | deny by default | `RiskManager` |
| Pool blacklist | configurable | `RiskManager` |
| Executor whitelist | only registered executors | `StrategyController` |
| Min profit per route (`minProfitAssets`) | must cover gas*3 + bribe + margin | `StrategyExecutor` calldata |
| Emergency pause | guardian / multisig / auto | `ArbVault`, `StrategyController` |

## 3. Kill-switch (auto-pause) triggers

The `risk-worker` pauses a strategy/vault when **any** of the following holds:

1. A single execution's realized loss exceeds the per-tx threshold.
2. Cumulative daily loss exceeds the daily threshold.
3. Simulation passes but on-chain execution fails more than `N` times in a row.
4. A whitelisted DEX/pool shows a price or oracle deviation beyond tolerance.
5. RPC latency / finality drift exceeds threshold.
6. Vault share price jumps discontinuously (possible accounting/attack).
7. A token transfer behaves abnormally (unexpected fee / revert / balance drift).
8. Manual pause by admin/guardian.

Pause is a first-class event (`risk_events` row + SSE broadcast on `/stream/risk-events`); resume requires explicit admin action.

## 4. Strategy admission gate (before showing "target 20%+")

A strategy may be labeled **"target 20%+"** in the UI **only if all** hold:

- Out-of-sample annualized return **> 20%** (walk-forward test windows).
- Out-of-sample annualized return **> 10%** under **+50% cost stress** (gas/bribe doubled).
- Live rolling 30-day net return **> 0** (small-capital paper/live run).
- Max drawdown within the strategy's declared risk-class band.
- No single token or pool contributes **> 30%** of net profit.
- Capacity curve reaches the product's minimum TVL.

If any condition fails, the UI must show the honest numbers without the "target 20%+" tag. The label is **never** "guaranteed 20%+".

## 5. Backtest anti-overfit requirements

Every backtest must include (enforced by `crates/backtest-engine`):

- **Walk-forward validation**: e.g. 30-day train / 7-day test.
- **Purged split**: avoid leakage between adjacent blocks.
- **Out-of-sample-only leaderboard**.
- **Parameter stability heatmap**: no single-peak overfitting.
- **Capacity curve**: 1k → 5k → 10k → 50k → 100k → 500k USDC.
- **Cost stress**: +25% / +50% / +100% gas & bribe.
- **Inclusion stress**: 30% / 50% / 70% success rates.
- **Market-regime split**: bull / bear / chop / high-vol / low-vol.
- **Live paper trading**: ≥ 14 days small/no capital before any live capital.

A backtest built only from price K-lines is **invalid** and must not be used for admission.

## 6. Categories that must NOT be marketed as "risk-free arbitrage"

- **Cross-chain inventory arbitrage** (Model F): non-atomic, bridge + inventory + finality risk.
- **Yield rotation** (Model G): not arbitrage; carry risk from subsidies/leverage/tail risk.
- **Liquidation** (Model D): has slippage, oracle-race, competition risk.
- **Peg / LST / stable** (Model E): peg-break, redemption-pause, liquidity risk.

The UI must label these distinctly from atomic DEX arbitrage.

## 7. Compliance posture (non-exhaustive)

Opening user deposits + automated yield likely touches: investment-product, investment-adviser, pooled-investment, custody, commodities/securities, and marketing concerns. Mitigations encoded in the product:

- Non-custodial / minimal custody.
- No return promises.
- Public parameters + strategies.
- Timelocked admin.
- Clear risk disclosures (hard-coded in UI text; see `packages/ui` disclaimers).
- Verifiable on-chain records.
- Geo-restrictions pending legal review before any public launch.

**This list is not legal advice. Engage counsel before launch.**
