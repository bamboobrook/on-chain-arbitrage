# SparkLend 清算策略接入与回测审计

生成时间：2026-07-08  
项目目录：`/home/bumblebee/Project/on-chain-arbitrage`

## 1. 本轮新增能力

新增 SparkLend 作为独立策略族，而不是继续混在 Aave 统计里。

修改文件：

- `scripts/replay-aave-liquidation-events.mjs`
- `scripts/search-aave-liquidations.mjs`
- `scripts/run-pure-arbitrage-search.mjs`
- `package.json`

新增 npm 命令：

- `npm run replay:spark-liquidations`
- `npm run search:spark-liquidations`

SparkLend Pool：

`0xC13e21B648A5Ee794902342038FF3aDAB66BE987`

来源：

- https://docs.spark.fi/dev/deployments
- https://github.com/sparkdotfi/spark-address-registry

## 2. Spark 历史回放结果

证据文件：

`data/aave-liquidation-event-replay-candidates-spark-ethereum.json`

| 指标 | 数值 |
|---|---:|
| 协议 | SparkLend |
| Pool | `0xC13e21B648A5Ee794902342038FF3aDAB66BE987` |
| 回放窗口 | 60000 blocks |
| 事件数 | 2 |
| 候选组合 | 1 |
| 通过组合 | 0 |
| 成功扫描区块 | 4871 |
| 失败区块 | 130 |
| 主要 RPC 错误 | `Unexpected end of JSON input` |

候选：

| 策略 | 标的 | 样本 | 年化净收益 | 中位净利润 | gate |
|---|---|---:|---:|---:|---|
| `spark-replay-spark-ethereum-dai-weth` | DAI / WETH | 1 | -0.0964% | -$0.2202 | insufficient historical liquidation samples |

判断：

- SparkLend 清算机制接入成功，能读 reserve、扫 `LiquidationCall`、解码候选。
- 但当前回放窗口事件太少，不足以形成 20%+ 策略证据。
- 这条策略族暂时是“已接入、未通过”，不能算入 5 个通过策略。

## 3. Spark 当前状态扫描结果

证据文件：

`data/aave-liquidation-candidates-spark-ethereum.json`

| 指标 | 数值 |
|---|---:|
| reserve 数量 | 8 |
| 近期债务用户 | 1 |
| 候选数 | 1 |
| passing | 0 |
| 扫描区块 | 8000 |
| failed ranges | 0 |

当前候选：

| 策略 | 标的 | HF | 估算净收益 | gate |
|---|---|---:|---:|---|
| `liq-spark-ethereum-ba3d12-dai-weth` | DAI / WETH | 2.475607 | $1,127.68 | health factor is not below 1 |

判断：

- 当前候选账面清算收益为正，但健康因子远高于 1，不能清算。
- 它可以进入低优先级观察，但不能进入执行队列。

## 4. 总览变化

`data/pure-arbitrage-search-overview.json` 已刷新：

| 指标 | 数值 |
|---|---:|
| 策略族 | 11 |
| artifact | 36 |
| 候选 | 5033 |
| 通过 | 5 |
| live-ready | 0 |

`data/strategy-discovery-ranked-candidates.json` 已刷新：

| 指标 | 数值 |
|---|---:|
| rows | 5038 |
| passing | 5 |
| 20%+ 口径候选 | 25 |
| profitable | 403 |
| Morpho oracle failed | 3562 |

Spark family 统计：

| family | rows | passing | 说明 |
|---|---:|---:|---|
| `spark-liquidation-arbitrage` | 1 | 0 | 当前 HF 不达标 |
| `spark-liquidation-event-replay` | 1 | 0 | 历史样本不足 |

## 5. 当前结论

SparkLend 值得保留为清算策略族，因为机制和 Aave 类似，纯链上、无需 CEX、接口已接通。

但当前不能算通过策略，原因是：

1. 历史清算样本不足。
2. 当前唯一候选健康因子远高于 1。
3. RPC 对部分日志范围返回截断 JSON，宽窗口扫描需要更稳的 RPC 或分段持久化重试。

下一步如果继续 Spark：

1. 使用更稳定的 Ethereum archive/RPC。
2. 将 Spark 回放改成 resume 模式，分段跑更长历史。
3. 扩大 reserve list，但仍优先稳定资产和高流动抵押品。
4. 只在 HF < 1 且 fork simulation 通过后才进入执行。

