# 链上套利系统完整审计与 GLM 执行计划

生成日期：2026-07-13  
项目目录：`/home/bumblebee/Project/on-chain-arbitrage`  
目标：先获得可信的纯链上套利策略证据，再完成扫描机、执行机、合约、服务和用户钱包闭环。

## 0. 必须先接受的结论

当前系统不能对用户承诺“稳定保证年化 20% 以上”。公开链上套利属于竞争性 MEV 市场，收益会随竞争、资金容量、gas、流动性和市场波动变化。正确产品口径只能是：

- 20% 是样本外、扣除全部成本后的内部准入门槛，不是保本或收益承诺。
- 前端必须展示回测区间、样本数、容量、压力测试、实盘观察期和风险，不得只展示 APY。
- 没有通过样本外回测、实时影子运行和小资金实盘的策略，不能开放给用户。
- 如果严格门槛下最终没有 5 个策略通过，必须如实输出 0-4 个，不能降低门槛凑数。

## 1. 当前系统审计结论

### 1.1 总体状态

当前项目是“研究/MVP + 合约骨架”，不是完整实盘系统。

| 项目 | 当前证据 | 结论 |
|---|---|---|
| 全量策略产物 | `pure-arbitrage-search-overview.json`：4,272 候选、5 passing、0 live-ready | 有研究产物，没有实盘策略 |
| 5 个 passing | 全部是 Aave V3 Ethereum 清算，分别为 USDT/WBTC、USDC/WBTC、DAI/WETH、USDT/WETH、USDT/wstETH | 是同一策略族的 5 个资产对，不是 5 个独立模型 |
| 机会 feed | 148 opportunities、0 actionable、148 blocked | 扫描器当前没有可交给执行器的机会 |
| Fork 验证 | verified=0、liveReady=0 | 没有候选通过真实 fork 全流程 |
| Executor | `idle-no-gate-pass-opportunities` | 未提交任何真实交易 |
| 用户自动化 session | 0 | 用户钱包到自动套利没有实际运行记录 |
| 部署 | 只有 Local Anvil broadcast | 无测试网/主网执行器和 Vault 部署记录 |
| 服务 | Postgres/Redis healthy，ClickHouse unhealthy；标准 3000/4000 未监听 | 数据服务部分运行，产品服务未运行 |
| 测试 | Rust 30/30；Solidity 47/47；7 个 TS 包直接 `tsc` 通过 | 基础质量尚可，但不证明策略盈利或实盘闭环 |
| 根级类型检查 | `npm run typecheck` 因 Turbo 找不到 package manager binary 失败 | 工具链/CI 仍需修复 |

所有核心策略和 live 数据最后生成于 2026-07-08，距本审计日已经 5 天，不满足实时交易要求。

### 1.2 Aave 5 个 passing 为什么不能当作稳定 20% 证据

现有 Aave 回放窗口约 34.72 天，样本数分别只有 32、30、5、17、5。主要问题：

1. `fetchTokenPrices()` 调用 `coins.llama.fi/prices/current`，用当前价格重估历史清算事件，存在历史价格泄漏。
2. 所有事件使用当前 `eth_gasPrice` 和固定 950,000 gas，而不是事件区块 gas、实际交易 receipt 和竞争成本。
3. 没有历史区块的抵押品退出路由 quote，默认拿到抵押品即可按现价卖出。
4. 未扣除 DEX swap fee、滑点、price impact、闪电贷 premium、builder tip、失败交易和 revert gas。
5. 默认把历史发生的全部清算都视为本机器人可捕获，没有竞争和 inclusion/capture rate 模型。
6. 年化公式为 `总事件利润 / 最大单笔资本 * 365 / 观察天数`，没有资本闲置、并发占用和机会冲突模型。
7. 准入门槛最低只有 5 个样本、60% 胜率、1 美元中位利润；没有训练/验证/测试切分，没有月度稳定性门槛。
8. 个别资产对存在极端离群值：例如 USDT/WETH 总利润主要受单笔约 58.8 万美元事件影响；USDT/wstETH 的平均单笔回报为巨额负值但仍可 passing。
9. 只按债务/抵押资产对分组，5 条记录仍属于同一 Aave 清算机制，不能算 5 个独立策略。

因此，这 5 条只能标记为 `research lead`，现有 `gate=pass` 应改名为 `historical-screen-pass-v1`，不能出现在用户可运行列表中。

### 1.3 其他策略族状态

| 策略族 | 当前状态 | 下一步判断 |
|---|---|---|
| Morpho Blue 清算 | 2,777 当前候选、22 liquidatable；22/22 oracle 诊断失败；0 passing | 强信号，但数据解码/oracle/退出路径尚未可信 |
| Maker Clipper | 扫描器已创建，但 RPC/DNS hard timeout；0 events | 不能排除，先修 archive RPC 后做拍卖回放 |
| Curve LLAMMA/LlamaLend | 只有研究图谱，无回放器 | 高优先级新增策略 |
| Euler V2 清算 | 只有研究图谱，无索引/回放器 | 高优先级新增策略 |
| Compound III | 当前回放 0 events、0 passing | 修复事件窗口与多 Comet 市场枚举后再判断 |
| SparkLend | 1 个历史候选、0 passing | 低成本监控，不优先投入 |
| Pendle PT | 75 候选、3 economic、0 passing | 是期限收敛/持有收益，不是原子套利，必须单独分类 |
| 普通 DEX/Curve/Balancer/Uni fee-tier | 当前扫描均 0 passing | 降级为事件驱动 backrun，不继续普通轮询 |
| LP/高 APY 池 | 有高 APY 候选 | 做市/激励策略，不得混入纯套利列表 |

### 1.4 实盘代码的关键缺口

1. `startOpportunityWorker()` 给模型的 `assets` 和 `pools` 是空数组，注册模型无法从真实市场上下文发现机会。
2. 正式策略注册表里 `liquidation` 仍是 paused phase 2；Aave/Morpho/Maker/LLAMMA/Euler 没有正式模型插件。
3. 当前 active 模型包含 LP market making 和 yield rotator，它们不是纯套利。
4. `BaseStrategyModel.quote()` 未实现；`simulate()` 返回 placeholder；`buildTx()` 返回 zero address + demo JSON calldata。
5. simulation worker 只把 DB 状态改为 `simulated`，没有运行 revm/Anvil 全交易模拟。
6. execution worker 只把“交易对象”写 Redis 并把 DB 标记为 submitted/executed，没有签名、relay submit、receipt、reorg 和 PnL 核对。
7. API 的各策略 execution plan 明确是 `dry-run`，Aave/Compound/Morpho/DEX live worker 均未启用。
8. live preflight 固定加入 `fork simulation service is not wired` 和 `production adapter execution is disabled` blocker，因此任何 live run 都不可能真正进入提交状态。
9. 前端可发 ERC20 approve 和 ERC-4626 deposit，但 deposit 后没有已验证的 Vault -> StrategyController -> Executor 资金分配闭环。
10. 没有主网合约地址；`EXECUTOR_PRIVATE_KEY`、`LIVE_EXECUTION_ENABLED` 和所有 executor address 均缺失。
11. API/Web/workers 未作为受管服务运行；ClickHouse unhealthy；RPC 曾出现 DNS timeout。
12. `.env.example` 缺少当前 Ethereum 策略所需的 `RPC_ETHEREUM_URL`，同时保留危险的默认 admin key/private key 示例。

## 2. “稳定年化 20%”的正确获取方法

### 2.1 统一策略准入定义

只有同时满足以下条件的策略才能称为 `admitted`：

- `pureOnchain=true`：不需要 CEX/KYC/中心化托管，不依赖 CEX 成交。
- 收益机制清晰：清算折价、拍卖折价、AMM 结构价差或期限收敛必须分开分类。
- 使用历史区块真实状态：oracle、pool reserves/ticks、gas、receipt、route quote 均来自事件区块。
- 扣除全部成本：协议费、flashloan、DEX fee、滑点、price impact、gas、bribe、失败交易、重试和库存处置。
- 样本外净 APY >= 20%，不是训练集或全样本内数字。
- 12 个月滚动窗口或协议可用历史中，最差滚动 90 天 APY >= 20%；若历史不足，不能使用“稳定”字样。
- 95% bootstrap 下界 > 0，且压力成本情景下净 APY >= 10%。
- 至少 30 个独立事件；主推策略要求 >= 50 个。极少事件策略必须覆盖 >= 12 个月。
- 至少 70% 自然月为正，单一事件贡献不得超过总利润 20%。
- 最大回撤、最长亏损期、机会空窗期均有明确数据。
- 明确容量曲线：$1k、$5k、$10k、$50k、$100k、$500k 下分别回测，超过容量自动拒绝资金。
- 影子运行 >= 14 天且 >= 30 次可执行信号；小资金实盘 >= 30 天后才允许用户使用。

这些门槛可能导致 0 个策略通过，这是正确结果。

### 2.2 回测必须使用的净收益公式

单次机会：

`netProfit = exitProceeds - debtRepay - protocolFee - flashFee - dexFees - gas - builderTip - failureReserve - inventoryHaircut`

组合期间收益：

`periodReturn = realizedNetProfit / timeWeightedDeployedCapital`

年化必须从按日净值序列计算，不能用“总利润 / 最大单笔资本 / 短窗口”简单线性放大。还要同时报告：

- realized APY
- capture-adjusted APY（按 10%/25%/50% 捕获率）
- capacity-adjusted APY
- stressed APY
- rolling 30/90/180-day APY
- 置信区间和最大回撤

### 2.3 第一批搜索顺序

GLM 按以下顺序工作，不得先做 UI 美化：

1. Aave V3 清算回放 V2：修正现有唯一强证据。
2. Morpho Blue 清算：修 oracle 类型和抵押品退出路径。
3. Maker Clipper 荷兰拍卖：重建拍卖曲线与 take 盈利窗口。
4. Curve crvUSD/LlamaLend LLAMMA：回放 band 状态和外部 AMM 价差。
5. Euler V2 反向荷兰清算：建立 EVC/vault/account 索引。
6. Compound III discounted collateral：枚举全部 Comet，回放 absorb/buyCollateral。
7. 事件驱动 DEX backrun：只在大额 swap、清算卖压、oracle update 后扫描。

Pendle PT、LST 赎回收敛可以作为非原子策略单独研究，但不能用于凑“5 个套利模型”。

## 3. GLM 分阶段执行计划

## Phase 0：冻结基线和恢复可重复构建（P0）

任务：

- 新建工作分支，将当前大量未提交文件分类提交；不得删除现有用户改动。
- 安装/启用 Corepack + pnpm 10.18.0，修复非登录 SSH PATH。
- 统一 `make verify`：依次执行 7 包 TypeScript、Rust workspace、Foundry、JSON schema checks。
- 修复 ClickHouse healthcheck；确认 Postgres/Redis/ClickHouse 全部 healthy。
- 新增 API `/health/live`、`/health/ready`；ready 必须检查 DB、Redis、RPC、ClickHouse。
- 用 systemd 或 Docker Compose 管理 API、Web、scanner workers、executor workers，禁止手工临时进程。
- 为每条链配置至少 2 个 RPC，加入 latency/error/chain-head 监控和自动切换。
- 修复 WSL DNS；Maker 扫描的 `rpc-blocked` 必须可自动恢复重试。
- 补齐 `.env.example`，包含 Ethereum RPC、executor signer、relay、部署地址、live kill switch。
- 禁止默认 `ADMIN_API_KEY=change-me-in-production` 和示例私钥进入非本地环境。

验收：

- `make verify` 一条命令全绿。
- 服务重启后自动恢复；3000/4000 和两类 worker 均有健康状态。
- ClickHouse healthy。
- RPC 故障演练时 scanner 自动切备用，executor 自动停单。

产物：`docs/evidence/phase-0-foundation.json`、`docs/evidence/phase-0-foundation.md`。

## Phase 1：重建可信回测数据层（P0）

任务：

- 为每个事件保存 blockNumber、blockHash、timestamp、txHash、logIndex、receipt、effectiveGasPrice。
- 建历史价格接口：优先协议 oracle at block，再用链上 TWAP/DEX quote 交叉验证。
- 建历史退出路由接口：在事件区块 fork 上对不同 amount 做 exact quote/simulation。
- 建统一成本模型：flash premium、protocol fee、DEX fee、slippage、price impact、gas、tip、失败率。
- 建竞争模型：观察真实 liquidator/searcher 地址、同区块竞争交易、成功捕获率。
- 建 walk-forward：train/validation/test，测试区间不得用于参数选择。
- 建按日 NAV、资本占用和容量曲线，替换当前线性年化公式。
- 所有 artifact 增加 `schemaVersion=2`、data hash、code commit、RPC source、coverage、caveats。

验收：

- 随机抽取 20 个历史事件，回放资产变化与链上 receipt 的误差 < 1%。
- 同一 commit、同一 block range 重跑结果可复现。
- 禁止任何历史事件使用 `prices/current`。
- 每个 passing 候选都有 base/stress/capture/capacity 四组结果。

产物：`data/backtest-v2/*`、`docs/backtest-v2-methodology.md`、`docs/evidence/historical-replay-reconciliation.json`。

## Phase 2：逐策略寻找 >=20% 样本外候选（P0）

### 2A Aave V3

- 覆盖 Ethereum、Base、Arbitrum、Polygon，至少 12 个月或协议全部可用历史。
- 用事件区块 Aave oracle 和真实抵押品退出 fork quote。
- 加 liquidation protocol fee、flash fee、真实 gas/tip、失败率和 capture rate。
- 按 debt/collateral/chain 分桶，但策略计数仍按“Aave 清算”一个模型计。
- 输出月度、滚动 90 天、离群事件贡献、容量曲线。

### 2B Morpho Blue

- 识别 oracle 类型，不再对所有 market 使用同一种 selector。
- 修复出现 25,974 LTV 等明显解码异常；异常 market 必须 fail closed。
- 建 market whitelist：oracle 可读、collateral 可卖、loan asset 可结算。
- 对 13 个历史强信号 market 做事件区块回放。
- 长尾 collateral 增加流动性 haircut 和无法退出 gate。

### 2C Maker Clipper

- RPC 恢复后动态读取 Chainlog 的 `MCD_CLIP_*`。
- 回放 Kick/Take/Redo，读取 calc/buf/tail/cusp/chip/tip。
- 每个区块重建 auction price，并模拟 collateral -> DAI。
- 报告盈利窗口长度、容量、实际 keeper 竞争和 missed opportunity。

### 2D Curve LLAMMA/LlamaLend

- 枚举 controller/amm/vault/collateral/borrowable。
- 保存 active_band、price_oracle、get_p、band balances。
- 回放 oracle 大幅变化和 exchange 事件；与 Curve Router/Uni/Balancer 外部 quote 比较。
- 只统计同一交易可闭合的净利润。

### 2E Euler V2

- 建 EVC account -> controller -> vault -> debt/collateral 索引。
- 回放 health score <= 1、discount、liquidate 和退出路径。
- 先限制主流资产，长尾市场必须单独风险分组。

### 2F Compound III

- 枚举全部 Comet 市场，读取 targetReserves/getReserves/collateralReserves。
- 回放 AbsorbCollateral/BuyCollateral，比较 quoteCollateral 和外部退出 quote。

验收：

- 每个策略族输出独立 artifact，不按资产对虚增策略数量。
- `strategy-admission-report.json` 明确 admitted/rejected/research-only。
- admitted 必须通过第 2.1 节所有门槛。
- 目标是搜索至少 5 个独立策略；不是强制伪造 5 个 admitted。

产物：`data/strategy-admission-report.json`、`docs/strategy-admission-report.md`。

## Phase 3：扫描机完整化（P1，仅在至少 1 个策略 admitted 后）

任务：

- 将研究脚本改为常驻事件驱动服务，按链维护 finalized/latest/pending 状态。
- scanner 只输出标准 `OpportunityEnvelope`：
  - strategyId/version/codeHash
  - chainId/blockNumber/blockHash/observedAt
  - route/calldata template/amount curve
  - gross/net/cost breakdown
  - minProfit/maxGas/maxSlippage/capacity
  - ttl/quoteAge/deadline
  - evidenceHash
- 使用 Redis Streams/BullMQ 持久化；必须有 idempotency key、ack、retry 和 dead-letter queue。
- Scanner 与 executor 分机部署，mTLS/HMAC 签名 feed；executor 不信任 scanner 的利润结论。
- Aave/Morpho/Maker/LLAMMA/Euler 分别使用事件订阅和账户 watchlist，不做低效全量轮询。
- 每次 head/reorg 更新都撤销过期机会。

验收：

- 连续 72 小时运行，无漏块、无重复机会、reorg 可恢复。
- 机会从事件到 feed 的 p95 延迟满足链级 SLA。
- 断 Redis/RPC/网络时不产生 submit-ready 假机会。

## Phase 4：执行机完整化（P1）

任务：

- 删除 placeholder simulation 和 zero-address demo `buildTx()`。
- executor 收到机会后重新读取链上状态、重新报价、重新计算容量和净利润。
- 完整 fork/pending-state 模拟：funding/flashloan -> protocol action -> unwind -> repay -> profit payout。
- 模拟必须验证 balance delta、gas、allowance、nonce、deadline、minProfit 和 revert reason。
- 只在全部 gate pass 后签名；专用 executor EOA 或 MPC，不接触用户私钥。
- 同时提交多个 private relay/builder；实现 bundle status、replacement、cancel、nonce lock。
- receipt 后按 token delta 核算 realized PnL；reorg 后回滚状态。
- 失败交易进入原因分类，不得把“写 Redis”标记为 executed。
- 全局 kill switch、策略 kill switch、链 kill switch、日亏损/连续失败熔断。

验收：

- 真实 mainnet fork 上 100 个历史机会端到端复现，余额和 PnL 对账一致。
- 对 stale quote、低利润、超 gas、错误 oracle、错误 nonce、relay failure 全部 fail closed。
- 本地/测试网至少 100 次自动提交生命周期测试无重复 nonce。

## Phase 5：用户钱包与资金闭环（P1）

推荐采用 Vault 模式，而不是要求用户为每笔套利签名：

`用户钱包 -> approve/deposit ERC-4626 Vault -> StrategyController 配额 -> 白名单 Executor -> 收益回 Vault -> 用户 redeem`

任务：

- 明确 Vault 与每个策略的资产、链和容量上限；禁止跨策略隐式挪用。
- 用户“开始策略”必须包含链上 allocation/permission 交易，不能只插入 `live_strategy_runs` DB 行。
- Executor 只能触发受限策略函数，不能任意转出 Vault 资产。
- minProfit、deadline、route whitelist、adapter whitelist、daily loss、max exposure 全部链上/链下双重检查。
- 前端流程：连接钱包 -> 切链 -> 查看策略证据/容量 -> 输入金额 -> approve -> deposit -> allocate -> 启动 -> 停止 -> withdraw。
- 显示实际已部署资本、剩余容量、已实现收益、未实现风险、策略暂停原因。
- 不显示“保证 APY”；展示样本外 APY 区间、实盘 APY、数据更新时间。

验收：

- 新钱包从 0 开始可完成 deposit/allocate/start/stop/redeem 全链上流程。
- 刷新浏览器、服务重启后状态由链上和 DB 正确恢复。
- 策略暂停时用户始终可按规则赎回。

## Phase 6：合约部署与安全（P1/P2）

任务：

- 为 Aave/Morpho/Compound/Maker/LLAMMA/Euler 分别完成真实地址 fork 集成测试。
- 增加 fuzz/invariant：本金不可丢、非授权不可执行、利润下限、回调来源、allowance 清理、重入、fee-on-transfer。
- 明确升级策略；优先不可升级核心 + timelock 参数管理。
- multisig 持有 admin/guardian；executor 只有触发权限。
- 测试网部署并保存 manifest/code hash/verified source。
- 独立安全审计后才允许主网；部署后做 explorer verification。

验收：

- 0 high/critical 未解决审计项。
- 每条支持链有 deployment manifest、verified source、角色清单和 emergency runbook。

## Phase 7：上线阶梯（不可跳级）

1. Research：只生成回测，0 真实资金。
2. Shadow：实时扫描和 fork 模拟，不提交，至少 14 天/30 信号。
3. Testnet/Anvil：完整自动生命周期 100 次。
4. Mainnet canary：开发者自有 $100-$500，单策略，30 天。
5. Mainnet limited：按容量最多 10%，再运行 30 天。
6. Public beta：只有 admitted + canary 通过的策略可展示，单用户/全局容量限制。
7. Scale：每次扩容不超过前一档 2 倍，重新验证滑点、捕获率和 APY。

任何阶段出现以下情况立即退回：

- rolling 30-day APY < 20%
- 实盘 capture rate 低于回测压力假设
- 连续 3 次异常 revert/nonce/relay 故障
- 单日亏损超过策略预算
- oracle、RPC、索引或对账不一致

## 4. GLM 每次提交必须附带的证据

GLM 不能只回复“完成”，每项任务必须同时提交：

- 修改文件列表和 commit hash。
- 精确运行命令、exit code、测试摘要。
- 机器可读 JSON artifact。
- 数据区间、block hash、RPC 来源、代码版本。
- 已知 caveats 和未完成项。
- 对应验收标准逐条 pass/fail。
- 不得把 mock、dry-run、当前价格回放、写 Redis、DB 状态更新描述为实盘成功。

## 5. 推荐的 GLM 执行顺序

严格顺序：

1. Phase 0 工具链/服务/RPC。
2. Phase 1 回测 V2 数据层。
3. Aave V2 重跑并撤销现有虚高 `gate=pass`。
4. Morpho oracle/exit 修复。
5. Maker、LLAMMA、Euler 回放器。
6. 生成策略准入报告；至少 1 个 admitted 后才能开始 Phase 3。
7. Scanner 常驻化。
8. Executor 真实模拟/签名/relay/receipt。
9. Vault 资金闭环和前端。
10. 安全审计与分阶段上线。

不要先继续补 UI，也不要先打开 `LIVE_EXECUTION_ENABLED`。当前最重要的工作是把回测从“历史事件 + 当前价格的筛选器”升级为“事件区块可执行净收益回放器”。

## 6. 最终完成定义

只有以下全部成立，项目才算完成：

- 至少 5 个独立纯链上策略通过统一样本外准入门槛；若未找到，系统必须如实显示实际数量。
- 每个 admitted 策略都有实时 scanner、标准 opportunity feed、fork verifier、真实 executor 和部署 manifest。
- 用户连接钱包、输入资金、链上授权/存入、启动、停止、赎回全流程通过 E2E。
- 两台机器连续运行 30 天，机会、提交、receipt、PnL、容量和失败原因可对账。
- 主网 canary 30 天结果符合回测压力区间。
- 合约完成独立审计，服务有监控、告警、备份、密钥管理和 kill switch。
- 用户界面和文档不承诺稳定/保证 20%，只展示可验证的历史和实盘区间。

在这些条件满足前，项目状态必须保持 `research / pre-production / live-disabled`。
