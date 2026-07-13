# 双机器链上机会扫描/执行 Runbook

日期：2026-07-08

目标：把系统从“手工跑搜索脚本”推进为“两台机器分工”：

- Scanner 机器：持续扫链上机会，标准化输出机会流。
- Executor 机器：只消费 gate-pass 机会，重新 fork 验证，满足生产 gate 后才提交交易。

当前结论仍然是：系统已经能持续发现和分类机会，但当前没有可执行的 gate-pass 机会，执行机状态为 idle，不会下单。

## 1. 新增命令

```bash
npm run build:market-depth
npm run build:live-opportunity-feed
npm run node:scanner
npm run node:executor
```

脚本文件：

```text
scripts/build-live-opportunity-feed.mjs
scripts/build-market-depth-snapshots.mjs
scripts/run-arbitrage-node.mjs
```

Worker 入口也支持角色：

```bash
WORKER_ROLE=scanner npm --prefix apps/workers run dev
WORKER_ROLE=executor npm --prefix apps/workers run dev
WORKER_ROLE=all npm --prefix apps/workers run dev
```

默认 `WORKER_ROLE=all`，兼容原来的单机开发模式。

## 2. Scanner 机器

职责：

1. 周期性运行当前态搜索。
2. 刷新 Aave / Compound / Morpho / DEX artifact。
3. 生成标准化机会流。
4. 只发布机会，不持有执行私钥。

单轮测试：

```bash
ARB_NODE_ONCE=1 npm run node:scanner
```

持续运行：

```bash
ARB_NODE_ID=scanner-1 \
SCANNER_INTERVAL_MS=120000 \
npm run node:scanner
```

快速只用已有 artifact 刷新 feed：

```bash
LIVE_REFRESH_SKIP_SEARCH=1 ARB_NODE_ONCE=1 npm run node:scanner
```

输出：

```text
data/live-opportunity-feed.json
data/scanner-node-status.json
```

最新验证结果：

```text
liveOpportunityFeed=no-gate-pass-opportunities
opportunities=147
actionable=0
watch=25
```

## 3. Executor 机器

职责：

1. 读取 scanner feed。
2. 只对 `executorAction=fork-verify-now` 的机会重新做 fork verification。
3. 检查 same-block quote、gas、滑点、容量、时效、loss-revert。
4. 只有 production gate 全部通过后才允许提交。

单轮测试：

```bash
ARB_NODE_ONCE=1 npm run node:executor
```

持续运行：

```bash
ARB_NODE_ID=executor-1 \
EXECUTOR_INTERVAL_MS=30000 \
npm run node:executor
```

输出：

```text
data/live-fork-verification.json
data/executor-node-status.json
```

带资金输入的单轮测试：

```bash
EXECUTOR_CAPITAL_USD=1000 ARB_NODE_ONCE=1 npm run node:executor
```

`data/executor-node-status.json` 会输出逐机会 `decision.opportunityDecisions[]`，每条包含：

```text
recommendedCapitalUsd
capitalRequiredUsd
capacityUsd
estimatedNetProfitUsd
returnPct
gasUsd
priceImpactBps
quoteAgeMs
blockingChecks
waitingChecks
checks[]
```

执行机只会在以下层级全部通过后才进入提交候选：

1. scanner gate/action：必须是 gate pass 且 `executorAction=fork-verify-now`。
2. 资金/容量：`EXECUTOR_CAPITAL_USD` 或 API 输入资金必须覆盖 required notional，并且 `capacityUsd > 0`。
3. 经济性：net profit、return、gas、price-impact/slippage 必须过配置阈值。
4. 时效：quote artifact 不能超过 `maxQuoteAgeMs`。
5. fork：对应 candidate 必须有 live-ready same-block fork verification。
6. 生产开关：`LIVE_EXECUTION_ENABLED=1`、signer、private relay/bundle gate 必须满足。

当前执行机状态：

```text
status=idle-no-gate-pass-opportunities
reason=scanner feed has no gate-pass opportunities
liveReady=0
```

## 4. 生产执行开关

默认不允许真实交易提交。

只有在以下条件同时满足时，执行机/前端才进入可提交状态：

1. Scanner feed 出现 `executorAction=fork-verify-now`。
2. `verify:live-fork-candidates` 产生 `liveReadyCount > 0`。
3. API readiness 中所有 block gate 清零。
4. `LIVE_EXECUTION_ENABLED=1`。
5. 签名模式明确配置，例如未来的 `EXECUTOR_PRIVATE_KEY`、硬件签名器或托管在前端的钱包确认。
6. 私有 relay / bundle 策略配置完成，避免公开 mempool 抢跑。

生产开关示例：

```bash
LIVE_EXECUTION_ENABLED=1 \
EXECUTOR_PRIVATE_RELAY_REQUIRED=1 \
EXECUTOR_WALLET_MODE=external-signer \
npm run node:executor
```

注意：当前仍没有 live-ready 机会，因此即使打开开关也不会下单。

## 5. Opportunity Feed 字段

`data/live-opportunity-feed.json` 每条机会包含：

```text
id
familyKey
chain
strategyType
gate.status / gate.reason
executorAction
ttlSeconds
staleAfter
economics.estimatedNetProfitUsd
economics.returnPct
economics.capitalRequiredUsd
economics.capacityUsd
economics.gasUsd
economics.protocolFeeUsd
economics.slippageBudgetBps
market.route
market.volume24hUsd
market.poolLiquidityUsd
market.priceImpactBps
market.priceImpactBpsSource
market.capacitySource
market.capacityCurve[]
market.uniswapV3DepthCapacityUsd
market.uniswapV3DepthStatus
market.routePools[].uniswapV3Depth
timing.maxQuoteAgeMs
timing.maxInclusionDelayMs
timing.observedLatencyMs
riskNotes
```

这些字段用于执行机判断：

- 资金容量：`capitalRequiredUsd` / `capacityUsd`
- DEX 容量曲线：`market.capacityCurve[]`，由 artifact 里的 `testedAmountMultipliers` 派生；`capacityUsd` 取 gate=pass 且 median net profit 为正的最大测试金额，没有通过点时为 0。
- 交易量/深度：`volume24hUsd` / `poolLiquidityUsd`。`npm run build:market-depth` 会生成 `data/market-depth-snapshots.json`，当前可用 RPC 读取 Uniswap V3 / Aerodrome / Curve 池 token balance，并使用 Balancer artifact/API total liquidity；24h volume 通过 DEX Screener pair API 补充，未覆盖的 route 仍保持 null 并阻断生产执行。
- 滑点：`slippageBudgetBps` / `priceImpactBps`；没有显式 price impact 时，用样本 gross/net return 生成 proxy，并写入 `priceImpactBpsSource`。
- 手续费：`gasUsd` / `protocolFeeUsd` / future relay tip；DEX 类会从 quote samples 补 median/mean gas。
- 交易时效：`ttlSeconds` / `maxQuoteAgeMs` / `maxInclusionDelayMs` / `timing.observedLatencyMs`

注意：DEX `capacityCurve[]` 是“报价回放容量代理”，不是完整池深度，也不是可稳定吃下的成交量承诺。执行前仍必须重新读取池状态、重算滑点和 gas，并通过 same-block fork simulation。

`poolLiquidityUsd` 也是筛选输入，不等价于 Uniswap V3 tick-level 可成交深度。当前已为 Uniswap V3 route pool 读取 `slot0`、active liquidity、tick spacing、附近 initialized ticks，并用已加载 tick 区间估算 exact-input 可承载输入额，写入 `routePools[].uniswapV3Depth` 和 route-level `market.uniswapV3DepthCapacityUsd`。executor/API decision 中已有 `uniswap-v3-tick-state` 与 `uniswap-v3-depth-capacity` 两道 gate；但这仍只覆盖已加载 tick 范围，不替代执行前的同区块报价、完整 swap simulation 和 fork verification。DEX Screener volume 是外部 indexer 视角，覆盖有缺口，也可能滞后当前区块。

## 6. Live Monitor

新增 API：

```text
GET /api/live/opportunity-feed
GET /api/live/executor-status
GET /api/live/execution-decision?capitalUsd=1000
GET /api/live/automation-sessions
POST /api/live/automation-sessions
POST /api/live/automation-sessions/:id/stop
GET /api/live/execution-queue
```

Web 页面：

```text
/live
```

现在会展示：

- Automation 面板：连接 injected wallet、输入 USD capital、选择 strategy family、用 `personal_sign` 记录自动运行授权意图。
- Automation session 列表：显示最近 session，并提供 Stop 控制；stopped session 不会进入 active execution queue。
- Scanner feed summary。
- actionable / watch / blocked 数量。
- 每条机会的 action、route、net、capacity、capacity curve、gas、slippage、price-impact proxy、sample latency、TTL、gate reason。
- Executor decision 面板：输入 USD capital 后展示 pre-fork ready、submit ready、建议资金和阻断检查。
- DB opportunities / executions 原始表。

`POST /api/live/automation-sessions` 会保存：

```text
walletAddress
walletChainId
capitalUsd
strategyFamilies[]
authorization.message
authorization.signature
decisionSummary
selectedPreForkReadyCount
selectedSubmitReadyCount
selectedTop[]
```

API 创建 session 时会记录用户授权意图和当时的 executor decision snapshot；Executor 机器每轮运行后会重新读取 `data/live-automation-sessions.json`，按 session 的 `capitalUsd` 和 `strategyFamilies[]` 复评当前 scanner feed / fork verification / production gates，并更新：

```text
status
reason
decisionSummary
selectedOpportunityCount
selectedPreForkReadyCount
selectedSubmitReadyCount
selectedTop[]
lastEvaluatedAt
```

如果没有 submit-ready 机会，状态会保持 `scanning-no-gate-pass-opportunities`、`blocked-no-submit-ready-opportunity` 或类似阻断状态，不会提交交易。

`POST /api/live/automation-sessions/:id/stop` 会把 session 标记为 `stopped`，记录 `stoppedAt` 和 reason。Executor 会保留 stopped session 记录用于审计，但 active queue 只消费 `status !== stopped` 的 session。

Executor 机器还会写出 `data/live-execution-queue.json`，API 通过 `GET /api/live/execution-queue` 暴露。队列中的每个 task 都来自 active automation session，动作只会是：

```text
wait-scanner
fork-verify
submit
blocked
```

只有当 session 中某个候选 `submitReady=true` 时才会出现 `submit` task。当前没有 live-ready 机会，因此队列不会给出提交任务。

Executor 同轮还会消费该队列并写出 `data/live-execution-queue-results.json`。消费语义：

```text
wait-scanner -> handledStatus=waiting
fork-verify -> handledStatus=queued-for-fork-verification
submit -> handledStatus=submit-ready-not-sent 或 blocked-production-gates
blocked -> handledStatus=blocked
```

当前 queue consumer 仍不会直接广播交易；`submit` task 只有在 production、signer、private relay 等 gate 全部满足时才会进入 `submit-ready-not-sent`，后续才能接入真实发送适配器。

运行时验证：

```text
MARKET_DEPTH_MAX_PER_ARTIFACT=3 npm run build:market-depth
marketDepthSnapshots=18
liquidityKnown=14
volumeKnown=13
uniswapV3Pools=27
uniswapV3DepthReady=18

npm run build:live-opportunity-feed
opportunityCount=147
actionableCount=0
watchCount=25

EXECUTOR_CAPITAL_USD=1000 EXECUTOR_DECISION_MAX_OUTPUT=200 ARB_NODE_ONCE=1 npm run node:executor
executorStatus=idle-no-gate-pass-opportunities
preForkReadyCount=0
submitReadyCount=0
uniDepthRequired=15
uniDepthReady=3

GET /api/live/automation-sessions
sessionCount=0

POST /api/live/automation-sessions
status=blocked-no-submit-ready-opportunity
selectedOpportunityCount=69
selectedSubmitReadyCount=0

ARB_NODE_ONCE=1 npm run node:executor
automationSessionSmoke=scanning-no-gate-pass-opportunities
automationSelectedOpportunityCount=69
automationSelectedSubmitReadyCount=0
executionQueueSmokeStatus=waiting-for-scanner-opportunities
executionQueueSmokeTaskCount=5
executionQueueSmokeSubmitTaskCount=0
queueConsumerSmokeWaitingCount=5
queueConsumerSmokeSubmitReadyNotSentCount=0
stopSessionSmokeStatus=stopped
stopSessionQueueActiveCount=0
executionQueueAfterCleanup=idle-no-active-sessions
automationSessionCountAfterCleanup=0

npm run smoke:pure-live-interfaces
caseCount=8
exercisedInterfaceCount=7
skippedNoCandidateCount=1
liveExecutionStatus=blocked
```

## 7. 部署建议

Scanner 机器：

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
WORKER_ROLE=scanner npm --prefix apps/workers run dev
ARB_NODE_ID=scanner-1 npm run node:scanner
```

Executor 机器：

```bash
cd /home/bumblebee/Project/on-chain-arbitrage
WORKER_ROLE=executor npm --prefix apps/workers run dev
ARB_NODE_ID=executor-1 npm run node:executor
```

两台机器共享：

- 同一个 Postgres。
- 同一个 Redis。
- 同一份或同步后的 `data/live-opportunity-feed.json`。
- 相同 RPC 配置。

执行机额外需要：

- 更低延迟 RPC。
- 私有 relay / builder 通道。
- 受控 signer。
- 更严格 `LIVE_EXECUTION_ENABLED` 运维审批。

## 8. 当前缺口

已经补齐：

- 两机器角色命令。
- Scanner feed。
- Executor decision status。
- Live Monitor 展示。
- API feed endpoint。
- API execution-decision endpoint，可用 `capitalUsd` 即时评估资金/容量/滑点/费用/时效/fork/生产 gate。
- 容量、滑点、费用、时效字段结构。
- DEX 类 `testedAmountMultipliers` 容量曲线、样本 gas、样本 latency、price-impact proxy 映射。
- Market-depth snapshot artifact；当前 skip-search refresh 会运行 fork verification、overview、market-depth、feed。
- DEX Screener pair API 24h volume enrichment；route 上任一池缺失 volume 时整条机会 `volume24hUsd=null`，执行机 `volume-24h` gate 会阻断。
- Uniswap V3 tick-state snapshot：`routePools[].uniswapV3State` 包含 current tick、tick spacing、active liquidity 和附近 initialized ticks；执行机要求 Uniswap V3 route 的 tick state 可读。
- Uniswap V3 loaded-range depth snapshot：`routePools[].uniswapV3Depth` 用当前 tick、active liquidity 和已加载 initialized ticks 估算 exact-input 容量；执行机要求该容量覆盖建议资金。

仍未完成：

- 当前没有 gate-pass 机会。
- 24h volume 已有 DEX Screener 补充，但还不是全覆盖；仍需自建/indexer/subgraph 作为低延迟和可审计数据源。
- Uniswap V3 已有 loaded tick-range exact-input 容量估算；仍缺完整池范围 swap simulation、同区块 quote 重算和 bundle/fork 后的生产提交闭环。
- Curve/Balancer 当前仍缺 multiplier 曲线。
- 执行机真实交易提交仍需 signer 和 private relay 配置。
- 仍需更低延迟、更高配额 RPC 才能把机会发现从分钟级推进到秒级。

下一步优先级：

1. 给 DEX/Curve/Balancer scanner 增加真实池深度和容量曲线。
2. 给 scanner 增加短周期 quote refresh，目标 `maxQuoteAgeMs <= 2500`。
3. 给 executor 增加 private relay/bundle 提交适配器。
4. 持续监控 Aave/Morpho near-liquidation watch rows，一旦 gate pass 立即 fork verify。
