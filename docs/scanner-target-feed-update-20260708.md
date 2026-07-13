# Scanner Target Feed Update

生成时间：2026-07-08  
项目目录：`/home/bumblebee/Project/on-chain-arbitrage`

## 1. 本轮补了什么

更新脚本：

`scripts/build-live-opportunity-feed.mjs`

新增输出字段：

`scannerTargets`

目的：

- `opportunities` 仍然代表 executor 可评估的标准化机会。
- `scannerTargets` 代表 scanner 应持续监控但不能直接执行的目标。
- executor 仍只看 gate-pass opportunities；scannerTargets 默认 `executorEligible=false`，不会进入下单队列。

## 2. 当前 live feed 结果

证据文件：

`data/live-opportunity-feed.json`

| 指标 | 数值 |
|---|---:|
| normalized opportunities | 150 |
| actionable opportunities | 0 |
| ordinary watch opportunities | 28 |
| scanner targets | 23 |
| scanner liquidatable targets | 4 |
| scanner oracle-blocked targets | 16 |
| status | no-gate-pass-opportunities |

## 3. scannerTargets 来源

当前接入两个来源：

| 来源 | 文件 | 数量/状态 |
|---|---|---|
| Aave watchlist analysis | `data/aave-liquidation-watchlist-analysis-ethereum.json` | 7 个目标 |
| Morpho watchlist | `data/morpho-blue-liquidation-watchlist-ethereum.json` | 16 个目标 |

### Aave scanner targets

来自 5 个历史通过 Aave 组合与当前账户扫描的交集。

当前最重要的聚合指标：

- 7 个 watch entries。
- 3 个历史稳定组合：USDT/WETH、USDC/WBTC、USDT/WBTC。
- 合计 debt-to-cover capacity 约 `$654,661`。
- 合计估算净利润约 `$29,458`。
- 最近目标 HF 为 `1.119363`，还没有进入 HF < 1 的可清算状态。

### Morpho scanner targets

来自历史稳定市场与当前风险仓位。

当前状态：

- 16 个 watchlist targets。
- 4 个 liquidatable。
- 但 oracle diagnostics 显示 22 个诊断市场里 0 个 oracle `price()` 通过。
- 因此所有 Morpho liquidatable targets 都保持 `block-until-oracle-price-passes`。

## 4. executor 安全验证

已运行 executor 节点检查：

`executorStatus=idle-no-gate-pass-opportunities`

结果：

- `liveReady=0`
- 没有 gate-pass opportunities。
- scannerTargets 没有让 executor 放行任何交易。

## 5. 两机职责

scanner 机器：

1. 刷新 current scan / replay / watchlist。
2. 生成 `data/live-opportunity-feed.json`。
3. 对 `scannerTargets` 做高频监控。
4. 只有目标跨过触发线并重新生成 gate-pass opportunity 后，才交给 executor。

executor 机器：

1. 只消费 `opportunities` 中 `executorAction=fork-verify-now` 的条目。
2. 重新检查资本、容量、gas、slippage、quote freshness、fork simulation。
3. 生产环境仍需 `LIVE_EXECUTION_ENABLED=true`、signer/relay 配置、loss-revert gate。
4. 不消费 `scannerTargets` 直接下单。

## 6. 当前结论

本轮让两机模型更清楚：

- scanner 现在能看到“该盯什么”。
- executor 仍然只在真正 gate-pass 时行动。
- 当前 live-ready 仍为 0，不应开始真实交易。

