# 纯链上套利策略刷新审计

生成时间：2026-07-08  
目标目录：`/home/bumblebee/Project/on-chain-arbitrage`

## 1. 本轮先做了什么

按最新指令，本轮没有继续补实盘包装，重点只放在策略发现和回测证据。

已刷新/重建的关键产物：

| 产物 | 状态 |
|---|---|
| `data/aave-liquidation-event-replay-candidates-ethereum.json` | 已用历史状态重建宽窗口基准 |
| `data/aave-liquidation-event-replay-candidates-base.json` | 已跑最近 10001 区块轻量回放 |
| `data/morpho-blue-liquidation-event-replay-candidates-ethereum.json` | 已用 Morpho GraphQL 1000 行重建宽样本 |
| `data/pendle-pt-arbitrage-candidates.json` | 已刷新 |
| `data/pure-arbitrage-search-overview.json` | 已刷新 |
| `data/strategy-discovery-ranked-candidates.json` | 已刷新排序 |

## 2. GLM/前序工作的成果梳理

前序工作不是完全没价值，主要成果是：

1. 已经搭出多类策略扫描器和候选文件，包括 Aave、Morpho、Compound、Pendle、DEX、Curve、Balancer、Uniswap V3 fee-tier。
2. 已经有两机模式雏形：scanner 持续生成 `live-opportunity-feed.json`，executor 读取候选并做 gate 判断。
3. 已经有钱包授权、资金输入、策略选择、session/queue 等前端和 API 雏形。
4. 已经有多个合约 adapter/executor 草稿，包括 Aave、Morpho、Compound、WalletAtomicArbitrageExecutor。
5. 已经有 fork/smoke 校验脚本，但 gate 仍然严格阻止执行。

但关键问题也很明确：

1. “有系统入口”不等于“有可执行套利策略”。当前 live-ready 通过数仍是 0。
2. 普通 DEX 价差类策略当前扫描全是负收益或被 gas/slippage/depth 挡住。
3. LP 高 APY 候选不是套利，只能归入做市或收益策略。
4. Morpho 有强历史信号，但当前还不能算通过，因为必须找到当前可清算账户并完成 fork 模拟。
5. Pendle PT 是期限收敛，不是同区块原子套利，不能混到套利通过名单里。

## 3. 当前总览

`data/pure-arbitrage-search-overview.json`：

| 指标 | 数值 |
|---|---:|
| 策略族数量 | 9 |
| artifact 数量 | 34 |
| 候选数量 | 4243 |
| 通过数量 | 5 |
| live-ready 通过数量 | 0 |
| 状态 | found-at-least-five-passing-pure-on-chain-backtests |
| live 执行状态 | blocked |

`data/strategy-discovery-ranked-candidates.json`：

| 指标 | 数值 |
|---|---:|
| 汇总行数 | 4248 |
| 通过策略数 | 5 |
| 20%+ 口径候选 | 25 |
| 正收益候选 | 404 |
| Morpho 历史稳定但 live gate blocked | 137 |

## 4. 当前真正通过的 5 个策略

这些 5 个策略全部来自 Aave V3 Ethereum 历史清算事件回放。它们是当前唯一能被称为“纯链上、无需 CEX、历史回放 20%+ 通过”的策略组。

| 排名 | 策略 ID | 标的 | 年化净收益 | 胜率 | 样本数 | 中位净利润 | 证据文件 |
|---:|---|---|---:|---:|---:|---:|---|
| 1 | `aave-replay-ethereum-usdt-wbtc` | USDT / WBTC | 531.61% | 90.63% | 32 | $199.86 | `aave-liquidation-event-replay-candidates-ethereum.json` |
| 2 | `aave-replay-ethereum-usdc-wbtc` | USDC / WBTC | 334.04% | 96.67% | 30 | $1,122.58 | `aave-liquidation-event-replay-candidates-ethereum.json` |
| 3 | `aave-replay-ethereum-dai-weth` | DAI / WETH | 285.96% | 100.00% | 5 | $18,233.97 | `aave-liquidation-event-replay-candidates-ethereum.json` |
| 4 | `aave-replay-ethereum-usdt-weth` | USDT / WETH | 225.83% | 70.59% | 17 | $46.98 | `aave-liquidation-event-replay-candidates-ethereum.json` |
| 5 | `aave-replay-ethereum-usdt-wsteth` | USDT / wstETH | 173.76% | 80.00% | 5 | $44.42 | `aave-liquidation-event-replay-candidates-ethereum.json` |

重要说明：

- 这 5 条只能证明历史清算边际存在，不能证明可稳定保证 20% 年化。
- 它们不代表当前任意时间都有机会。
- 清算策略的容量取决于当前可清算账户、债务规模、抵押资产深度、gas、MEV 竞争、滑点和同区块执行速度。

## 5. 本轮新增验证结果

### 5.1 Aave Ethereum 宽窗口恢复

证据文件：`data/aave-liquidation-event-replay-candidates-ethereum.json`

| 指标 | 数值 |
|---|---:|
| 事件数 | 259 |
| 候选组合 | 47 |
| 通过组合 | 5 |
| 扫描区块 | 169940 |
| 成功覆盖 | 166880 |
| scanStopReason | max-events-reached |

这个文件被恢复为宽窗口基准，避免被最新短窗口覆盖。

### 5.2 Aave Base 轻量回放

证据文件：`data/aave-liquidation-event-replay-candidates-base.json`

| 指标 | 数值 |
|---|---:|
| 窗口 | 最近 10001 区块 |
| 事件数 | 21 |
| 候选组合 | 2 |
| 通过组合 | 0 |
| 覆盖率 | 100% |

结果：

- `aave-replay-base-usdbc-weth`：8 样本，净胜率 0。
- `aave-replay-base-usdc-weth`：13 样本，净胜率 0。

判断：Base 有清算事件，但当前样本下没有形成 20%+ 可验证策略。

### 5.3 Morpho Blue 宽样本恢复

证据文件：`data/morpho-blue-liquidation-event-replay-candidates-ethereum.json`

| 指标 | 数值 |
|---|---:|
| GraphQL liquidation rows | 1000 |
| 市场数量 | 163 |
| 候选数量 | 1000 |
| 通过数量 | 0 |
| 历史稳定但 live gate blocked | 137 |
| 对应市场数 | 13 |
| 窗口天数 | 63.63 |

Top strong blocked examples：

| 策略 ID | 标的 | 估算净利润 | 阻塞原因 |
|---|---|---:|---|
| `morpho-blue-liq-replay-ethereum-25251666-8-5788be` | USDC / wstETH | $279,096.49 | 历史稳定通过，但必须找到当前可清算账户并 fork 模拟 |
| `morpho-blue-liq-replay-ethereum-25251666-44-aae3be` | USDC / wstETH | $211,704.55 | 同上 |
| `morpho-blue-liq-replay-ethereum-25251621-8-f2ddc9` | USDC / wstETH | $194,838.31 | 同上 |
| `morpho-blue-liq-replay-ethereum-25395168-458-b3b74a` | USDC / PT-apyUSD | $53,429.27 | 同上 |
| `morpho-blue-liq-replay-ethereum-25240912-29-1e6c4f` | USDC / WBTC | $39,781.01 | 同上 |

判断：

- Morpho 是目前最值得继续补的 A 级策略族。
- 不能计入“已通过 5 条”，但很可能是下一批可转化为通过策略的来源。
- 下一步必须补：当前可清算账户扫描、oracle 正确读取、同区块退出 quote、fork 模拟。

### 5.4 Pendle PT 刷新

证据文件：`data/pendle-pt-arbitrage-candidates.json`

| 指标 | 数值 |
|---|---:|
| 链数量 | 5 |
| 候选数量 | 75 |
| economic candidate | 3 |
| 通过数量 | 0 |

当前 20%+ 口径候选：

| 市场 | 链 | implied APY | liquidity | 估算净收益 | 判断 |
|---|---|---:|---:|---:|---|
| jrUSDat | Ethereum | 28.64% | $317,463.54 | $328.26 | 期限收敛，不是原子套利 |
| STRCx | Ethereum | 23.26% | $790,615.57 | $268.34 | 期限收敛，不是原子套利 |
| sKAITO | Base | 20.65% | $260,257.67 | $110.79 | 期限收敛，不是原子套利 |

判断：

- 可以作为 B 级收益/期限收敛策略。
- 不能算入“链上套利 5 个通过策略”。
- 必须补历史 PT 价格、提前退出滑点、到期赎回风险、底层资产风险。

## 6. 仍然不能算完成的地方

和最终目标相比，当前还缺：

1. 至少 5 个策略虽然已有，但全部来自同一策略族 Aave V3 清算；如果要求“5 个不同策略族”，当前没有完成。
2. live-ready 数量仍是 0；系统入口存在，但不能声称用户授权钱包后就能稳定运行盈利策略。
3. Morpho 当前候选需要补当前状态扫描和 fork 模拟，才能从 A 级强信号升级为 S 级通过。
4. DEX/Curve/Balancer 普通套利当前没有正向证据，应降级为事件驱动机会模块。
5. Pendle/LP 不应包装成套利，需要单独分类。
6. 当前回放里部分历史价格使用当前价格近似，后续必须按事件区块价格重估。
7. 资金容量还没有完整从每个策略中拆出来，特别是最大可部署本金和滑点曲线。

## 7. 下一步补充顺序

优先级 1：把 Aave 清算证据做硬

- 增加历史价格回放，而不是当前价格近似。
- 拆分每个组合的最大资金容量、单次 ROI、机会频率、资本空闲率。
- 对 Ethereum 之外的 Arbitrum/Polygon/Base 重跑宽窗口，但要避免短窗口覆盖基准。

优先级 2：把 Morpho 转成可通过候选

- 修复 current-state oracle 读取。
- 针对 13 个历史稳定市场建立 watchlist。
- 对 wstETH/WBTC/PT-apyUSD 等抵押品建立链上退出路线和深度模型。
- 找当前 liquidatable borrower 后跑 fork 模拟。

优先级 3：新增两个清算/拍卖策略族

- Spark：复用 Aave V3 扫描/回放框架。
- Maker Clipper：回放拍卖价格曲线，比较链上退出 quote。
- Euler V2：建立 vault health score 和 liquidation discount 扫描器。

优先级 4：只保留事件驱动 DEX 套利

- 大额 swap backrun。
- 清算后抵押品卖压 backrun。
- 稳定币脱锚/再锚定。
- Curve LLAMMA bands 与外部池 quote 偏差。

## 8. 当前判定

当前可以对外说：

- 已找到 5 条纯链上、无需 CEX、历史回放超过 20% 年化门槛的 Aave V3 清算策略。
- 已识别 Morpho Blue 为最强扩展策略族，有 137 条历史稳定但 live gate blocked 的候选。
- 已确认 Pendle PT 有 3 条 20%+ 期限收益线索，但不是原子套利。
- 普通 DEX 价差套利当前没有通过证据。

当前不能对外说：

- 不能说“稳定保证 20% 年化”。
- 不能说“进入系统授权钱包即可开始盈利运行”。
- 不能把 LP APY 或 Pendle implied APY 当套利收益承诺。
- 不能把 Morpho 历史强信号算成正式通过策略。

