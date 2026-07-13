# 纯链上套利系统当前审计与补完计划

日期：2026-07-08

目录：`/home/bumblebee/Project/on-chain-arbitrage`

## 1. 结论先行

GLM 做出了有价值的基础工程，但没有完成用户最终目标。当前系统已经能搜索多个纯链上套利 family、生成 dry-run live plan、创建 blocked live run、在 fork 上演练亏损回滚或协议 gate；但还没有任何一个策略达到“当前可执行、钱包授权后可投入真实资金、fork 证明盈利”的 live-ready 标准。

最新机器证据：

```text
data/pure-arbitrage-search-overview.json
familyCount=9
artifactCount=34
candidateCount=4233
passingCount=5
liveReadyPassingCount=0
liveExecutionStatus=blocked
```

这 5 个 passing 只来自 Aave 历史 liquidation event replay，不是当前可执行策略。历史回放证明“过去发生过可盈利清算边缘”，不能证明“现在用户授权钱包即可稳定 20%+ 年化”。

必须坚持的产品口径：

- 纯链上、钱包授权、无 CEX 可以实现。
- 20%+ 只能作为历史回测和上线准入门槛，不能作为稳定保证收益。
- 实盘执行必须等当前机会、报价、fork simulation、executor transaction、gas 后利润和亏损回滚全部通过。
- 当前 live execution 必须保持 blocked。

## 2. GLM 已完成成果

GLM 和后续补丁已经形成了一个可继续推进的 monorepo：

- Web：有 `/candidates` 候选展示，能从 API 读取多个纯链上策略 family。
- API：能读取候选 artifact，生成 execution plan，创建 live-run，存储 preflight/fork simulation。
- Workers/DB：已加入 live strategy run、preflight、fork simulation 相关表和队列结构。
- 合约：已有 wallet atomic arbitrage executor、Aave V3 liquidation executor、Compound V3 liquidation executor、Morpho Blue liquidation executor，以及 Uniswap/Balancer/Curve/Aerodrome adapter 雏形。
- 搜索脚本：覆盖 DEX quote replay、Uniswap V3 fee tier、Curve stable、Balancer V2、Aave、Compound V3、Morpho Blue、Pendle PT。
- 回放脚本：Aave/Morpho/Compound liquidation historical replay 已有基础。
- 安全语义：亏损路线在 fork 上应 revert；清算类在 health factor/isLiquidatable/LTV gate 不通过时不构造实盘执行。

这些成果说明项目已经不是空壳，但它仍是“研究与受控演练平台”，不是“可放心开放资金的自动套利产品”。

## 3. 本轮补充内容

### 3.1 Aave 当前态扫描补强

`scripts/search-aave-liquidations.mjs` 已补充自适应 `eth_getLogs` 区间拆分：

- 遇到 RPC 返回 block range 太大、结果过多、timeout、response size 等错误时自动二分区间。
- 支持 `LIQ_ADAPTIVE_LOG_CHUNKS`、`LIQ_MIN_LOG_CHUNK_BLOCKS`。
- `scanState` 记录 `splitRangeCount`、`handledSplitRangeCount`、真实 scanned block count。

这解决了 Ethereum 免费 RPC “最大 10 block getLogs”导致 Aave 扫描直接跳过日志的问题。

### 3.2 Live opportunity refresh 编排

新增：

```text
scripts/refresh-live-opportunities.mjs
npm run refresh:live-opportunities
```

该命令按顺序执行：

1. Aave Ethereum current liquidation scan。
2. Aave Base current liquidation scan。
3. Aave Arbitrum current liquidation scan。
4. Compound V3 Ethereum current liquidation scan。
5. Morpho Blue Ethereum current liquidation scan。
6. `verify:live-fork-candidates`。
7. `search:pure-overview`。

输出：

```text
data/live-opportunity-refresh.json
```

最新结果：

```text
status=historical-threshold-met-live-blocked
taskCount=7
failedTaskCount=0
historicalPassingCount=5
liveReadyCount=0
requestedPassingCount=5
liveExecutionStatus=blocked
```

### 3.3 Live fork verification 扩展

`scripts/verify-live-fork-candidates.mjs` 已从只支持 Morpho 扩展为支持：

- Aave V3 liquidation candidates。
- Compound V3 liquidation candidates。
- Morpho Blue liquidation candidates。

它现在只把 gate pass 的当前候选送入 fork rehearsal。当前结果仍然是：

```text
verifiedCount=0
liveReadyCount=0
status=no-live-ready-fork-verified-candidates
```

这是正确结果，因为当前没有候选同时通过当前态 gate。

### 3.4 Live interface smoke 修复

`scripts/smoke-pure-live-interfaces.mjs` 已修复“当前 artifact 没候选时误失败”的问题。

最新 smoke 结果：

```text
data/pure-live-interface-smoke.json
caseCount=8
exercisedInterfaceCount=7
skippedNoCandidateCount=1
liveExecutionStatus=blocked
```

实际演练结果：

- DEX quote replay：fork 上净亏，正确阻断。
- Uniswap V3 fee arbitrage：fork 上净亏，正确阻断。
- Curve stable arbitrage：fork 上净亏，正确阻断。
- Balancer V2 arbitrage：fork 上净亏，正确阻断。
- Aave V3 liquidation：health factor 不低于 1，正确阻断。
- Compound V3 liquidation：当前 artifact 没候选，记录 `skipped-no-candidate`。
- Morpho Blue current：profitability/oracle gate 阻断。
- Morpho Blue replay：当前 LTV 未越过 LLTV，正确阻断。

### 3.5 生产执行 gate 和前端发送入口

`apps/api/src/routes.ts` 里的 `production-adapter` readiness gate 已从永久 hard-block 改为可配置 gate：

- 默认仍然阻断真实交易提交。
- 只有设置 `LIVE_EXECUTION_ENABLED=1` 后，才会评估生产执行条件。
- 即使开关打开，也必须同时满足 transaction preview ready、有非 approval 的策略交易、存在 executor/target、ordered fork simulation passed。

`apps/web/src/app/candidates/page.tsx` 已补上前端执行按钮状态机：

- approval 交易仍可从 transaction preview 发送。
- 非 approval 策略执行交易默认显示 `Locked`。
- 只有 `readiness.status=ready` 且最新 fork simulation `status=passed` 时，才显示 `Send execution`。
- 发送前会切换到 run 对应 chain，并校验当前钱包地址与 live run 钱包一致。

这一步没有放开当前实盘执行；它只是把未来 live-ready 候选出现后的产品路径补完整。

## 4. 最新搜索结果

### 4.1 Overview

```text
families=9
artifacts=34
candidates=4233
historicalPassing=5/5
liveReady=0/5
```

### 4.2 Aave V3 current

Ethereum：

```text
reserveCount=8
discoveredDebtUsers=26
candidateCount=22
passingCount=0
topCandidate=liq-ethereum-d2ac55-usdc-wbtc
topHealthFactor=1.552455
reason=health factor is not below 1
```

Base：

```text
reserveCount=5
discoveredDebtUsers=3
candidateCount=3
passingCount=0
topCandidate=liq-base-6fa5f5-weth-cbeth
topHealthFactor=1.033616
reason=health factor is not below 1
```

Arbitrum：

```text
reserveCount=5
discoveredDebtUsers=0
candidateCount=0
passingCount=0
```

Interpretation：Base 有一个接近清算线的账户，但 HF 仍高于 1，不能清算。

### 4.3 Compound V3 current

```text
discoveredAccounts=0
candidateCount=0
passingCount=0
```

Interpretation：当前搜索窗口内没有可测试账户。接口 smoke 已改为 skip，而不是误判失败。

### 4.4 Morpho Blue current

```text
marketCount=60
candidateCount=2774
liquidatableCount=26
nearLiquidationCount=99
passingCount=0
```

Top apparent opportunities 被 on-chain oracle gate 阻断：

```text
reason=on-chain oracle price check failed: eth_call: execution reverted
```

Interpretation：Morpho API 数据中存在看似高利润机会，但链上 oracle 无法读价时不能执行。这个 gate 必须保留。

## 5. 实盘上线门槛

一个策略不能因为 historical APY 或 replay 通过就上线。必须同时满足：

1. `gate.status=pass`，且 gate 使用当前 block 数据。
2. 候选不依赖 CEX，不要求用户注册交易所。
3. 用户资金路径仅为钱包授权、approve、deposit 或 executor funding。
4. 所需合约已部署并记录在 `data/executor-deployments.json` 或环境变量。
5. 同 block fork simulation 成功。
6. executor transaction status 为 `passed`。
7. DEX/collateral unwind quote 成功。
8. 交易后余额覆盖本金、gas、slippage 和 `minProfit`。
9. 亏损或 quote 不足时必须 revert。
10. UI/API 不提供真实 submit 入口，直到 `liveReadyCount >= requestedPassingCount`。

## 6. 前后端系统最终形态

### Frontend

主要页面：

- `/candidates`：展示 strategy families、candidate count、passing count、live-ready count、blocked reason。
- `/candidates/:id`：展示回测、样本外、fork simulation、risk limits、required approvals。
- `/live-runs`：展示每个钱包 live run 的 plan、preflight、fork report、readiness gates。
- `/vaults/:id`：只对 live-ready strategy 开放 deposit/withdraw；否则显示 blocked gate。

用户流程：

1. Connect wallet。
2. 输入 capital、max slippage、max gas。
3. 生成 dry-run plan。
4. 查看 approvals 和风险限制。
5. 系统刷新 current opportunity。
6. fork simulation pass 后才允许提交。
7. 用户签名 approve/execute 或 deposit。
8. 交易失败时 revert，不消耗策略本金。

### Backend/API

必需接口：

- `GET /api/*-candidates`
- `POST /api/*-candidates/:id/execution-plan`
- `POST /api/*-candidates/:id/live-runs`
- `POST /api/live/runs/:id/fork-simulation`
- `GET /api/live/runs/:id`
- `GET /api/live/opportunities`
- `POST /api/admin/strategies/:id/pause`

后台任务：

- `refresh:live-opportunities`：当前机会刷新。
- `verify:live-fork-candidates`：live-ready 证明。
- `smoke:pure-live-interfaces`：接口和阻断语义回归。
- `search:pure-overview`：全局研究汇总。

### Contracts

上线前每个 executor 需要：

- Foundry unit tests。
- Fork tests。
- Adapter whitelist。
- Profit floor。
- Token allowance reset/limit。
- No arbitrary external target unless whitelisted。
- Emergency pause。
- Deployment record。

## 7. 还差什么

距离用户最终目标仍差以下硬项：

1. 当前 live-ready 策略数量是 `0/5`，不是 `5/5`。
2. 5 个 historical passing 不是 5 个当前可执行策略。
3. Aave/Morpho/Compound 清算机会需要继续监控，机会出现时必须立即 fork 证明。
4. DEX/Curve/Balancer/Uniswap fee 当前 replay 都是 gas 后负收益，不能上线。
5. Compound 当前 artifact 可能为 0 候选，搜索窗口和事件来源还需要扩大。
6. 需要付费/archive RPC 或协议索引 API，才能把历史回测和当前状态覆盖做得更扎实。
7. 需要私有交易/bundle 发送，降低清算和 DEX 套利被抢跑概率。
8. 前端真实钱包签名/submit 只能在 live-ready gate 打开后启用。

## 8. 常用命令

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
npm run refresh:live-opportunities
npm run smoke:pure-live-interfaces
npm run verify:live-fork-candidates
npm run search:pure-overview
npm --prefix apps/api run typecheck
```

更深的 Aave Base 搜索示例：

```bash
LIVE_REFRESH_AAVE_BASE_LOOKBACK_BLOCKS=5000 \
LIVE_REFRESH_AAVE_BASE_MAX_LOG_REQUESTS=800 \
npm run refresh:live-opportunities
```

更深的 Morpho 搜索示例：

```bash
MORPHO_LIQ_MARKET_LIMIT=100 \
MORPHO_LIQ_POSITION_LIMIT=150 \
MORPHO_LIQ_POSITION_PAGES=2 \
npm run search:morpho-liquidations
```

## 9. 资料依据

官方/主来源：

- Aave Pool / liquidationCall: https://aave.com/docs/developers/smart-contracts/pool
- Aave liquidations: https://aave.com/docs/developers/liquidations
- Compound III liquidations: https://docs.compound.finance/liquidation/
- Morpho contracts and liquidation docs: https://docs.morpho.org/
- Uniswap V3 flash integrations: https://docs.uniswap.org/contracts/v3/guides/flash-integrations/inheritance-constructors
- Balancer flash loans: https://docs.balancer.fi/concepts/vault/flash-loans.html
- Curve Stableswap docs: https://docs.curve.finance/
- Pendle docs: https://docs.pendle.finance/

## 10. 当前任务状态

本轮已补齐：

- Aave 自适应日志扫描。
- Live refresh 编排脚本。
- Aave/Compound/Morpho fork verification 候选入口。
- Smoke 无候选跳过语义。
- 后端生产执行 readiness gate 从永久阻断改为 `LIVE_EXECUTION_ENABLED=1` 控制的严格 gate。
- 前端补齐 fork-ready 后的 `Send execution` 发送入口，当前 blocked 候选仍锁定。
- 新增双机器 scanner/executor 模式，见 `docs/two-machine-scanner-executor-runbook-20260708.md`。
- 新增 `data/live-opportunity-feed.json` 标准化机会流，包含容量、滑点、gas、时效和执行机动作。
- DEX 类机会已从 `testedAmountMultipliers` 派生 `market.capacityCurve[]`，并从 quote samples 补充 gas、latency 和 price-impact proxy；这仍是报价回放容量代理，不是完整池深度/成交量证明。
- 新增 `data/market-depth-snapshots.json`：可从 RPC 读取部分 Uniswap V3 / Aerodrome / Curve 池 token balance，并使用 Balancer artifact/API total liquidity；24h volume 通过 DEX Screener pair API 补充，feed 会合并 `market.poolLiquidityUsd`、`market.volume24hUsd`、source 和 route pools。
- 新增 `/api/live/opportunity-feed` 和 `/live` 页面 feed 展示。
- 新增执行机资金感知决策：`EXECUTOR_CAPITAL_USD=... npm run node:executor` 会在 `data/executor-node-status.json` 输出逐机会 sizing/gating；`GET /api/live/execution-decision?capitalUsd=...` 可供前端按用户输入资金即时评估。
- 执行机新增 `pool-liquidity` 和 `volume-24h` gate；DEX Screener 未覆盖或任一 route 腿缺失 volume 时，会明确作为生产阻断项。
- route 聚合口径已改成保守模式：任一腿缺失 liquidity/volume，则整条机会对应字段为 null，不能用单腿数据误放行。
- Uniswap V3 route pool 已新增 tick-state snapshot：读取 `slot0`、active liquidity、tick spacing 和附近 initialized ticks，并在执行机/API decision 中加入 `uniswap-v3-tick-state` gate。
- Uniswap V3 route pool 已新增 loaded-range exact-input depth estimator：用已加载 initialized ticks 估算 `routePools[].uniswapV3Depth.capacityUsd`，feed 聚合为 `market.uniswapV3DepthCapacityUsd`，执行机/API decision 加入 `uniswap-v3-depth-capacity` gate。
- `/live` 已新增 Automation 面板：用户可以连接 injected wallet、输入资金、选择 strategy family、用 `personal_sign` 记录自动运行授权意图。
- API 新增 `GET/POST /api/live/automation-sessions`：保存 wallet/capital/strategy/signature 和当前 executor decision snapshot；没有 submit-ready 机会时返回 `blocked-no-submit-ready-opportunity`，不会提交交易。
- Executor 机器已接入 automation session lifecycle：每轮 `npm run node:executor` 会读取 `data/live-automation-sessions.json`，按 session 的资金和策略选择复评 scanner feed、fork verification、depth/capacity/return/freshness/production gates，并更新 session 的状态、阻断原因、ready counts 和 `selectedTop[]`。
- Executor 机器新增 `data/live-execution-queue.json`：把 active automation sessions 转换成 `wait-scanner`、`fork-verify`、`submit` 或 `blocked` task；API 新增 `GET /api/live/execution-queue`，`/live` 页面会展示队列计数和前几条 task。
- Executor 机器新增 `data/live-execution-queue-results.json`：同轮消费 queue，写出每条 task 的 `handledStatus`。当前 `submit` task 仍不会广播交易，只会在 production/signer/relay 等 gate 满足时进入 `submit-ready-not-sent`，等待真实发送适配器接入。
- Automation session 已新增停止控制：`POST /api/live/automation-sessions/:id/stop` 和 `/live` Stop 按钮会把 session 标记为 `stopped`；executor 保留 stopped 记录用于审计，但 active queue 不再消费。
- 最新 refresh/smoke/typecheck/overview 验证。

本轮缩小样本验证：

```text
marketDepthSnapshots=18
liquidityKnown=14
volumeKnown=13
uniswapV3Pools=27
uniswapV3DepthReady=18
feedOpportunityCount=147
feedActionableCount=0
executorStatus=idle-no-gate-pass-opportunities
executorUniDepthRequired=15
executorUniDepthReady=3
automationPostStatus=blocked-no-submit-ready-opportunity
automationSelectedOpportunityCount=69
automationSelectedSubmitReadyCount=0
executorAutomationSessionSmoke=scanning-no-gate-pass-opportunities
executorAutomationSessionCountAfterCleanup=0
executionQueueSmokeStatus=waiting-for-scanner-opportunities
executionQueueSmokeTaskCount=5
executionQueueSmokeSubmitTaskCount=0
queueConsumerSmokeWaitingCount=5
queueConsumerSmokeSubmitReadyNotSentCount=0
stopSessionSmokeStatus=stopped
stopSessionQueueActiveCount=0
executionQueueAfterCleanup=idle-no-active-sessions
smokeCaseCount=8
smokeLiveExecutionStatus=blocked
```

仍未完成：

- 未找到 5 个当前 live-ready 策略。
- 未能证明稳定 20%+ 年化。
- 实盘钱包提交仍必须 blocked。
- 24h volume 仍需自建/subgraph/indexer 做低延迟、可审计补强；Uniswap V3 已有 loaded tick-range depth estimator，但仍缺完整池范围 swap simulation、同区块 quote 重算和 bundle/fork 后的生产提交闭环。

这不是包装问题，而是资金安全边界。下一步应该继续跑当前态 watcher，并在出现 gate pass 候选时立即执行 fork executor simulation。
