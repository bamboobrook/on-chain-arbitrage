# 纯链上套利策略发现报告

生成日期：2026-07-08  
项目目录：`/home/bumblebee/Project/on-chain-arbitrage`

## 0. 先给结论

这次先不继续补实盘执行，专注策略发现。

严格按你的条件筛选后，目前没有发现可以“稳定保证 20%+ 年化”的公开、可持续、不过拟合模型。原因很直接：纯链上套利是高度竞争的 MEV/清算/价差市场，收益来自短暂错价、清算折价、期限折价或流动性失衡，不能像固定收益产品那样承诺稳定保底。

但是，项目内已有候选数据里确实发现了 5 条通过历史回放门槛的纯链上策略，全部来自 Aave V3 历史清算事件回放。它们满足“纯链上、无需 CEX、历史样本年化超过 20%”这三个研究门槛，但只代表历史边际，不代表当前可持续收益，也不代表可以直接向用户承诺。

当前全量候选统计：

| 指标 | 数量 |
|---|---:|
| 扫描候选总数 | 4238 |
| 通过策略门槛 | 5 |
| 表面年化/收益口径超过 20% | 22 |
| 正收益但被证据/风控挡住 | 400 |
| 当前可宣称实盘可用 | 0 |

机器可读排序结果已保存为：

`data/strategy-discovery-ranked-candidates.json`

## 1. 策略证据分级

我把策略分为四级，避免被“表面 APY”误导。

| 等级 | 含义 | 当前策略 |
|---|---|---|
| S | 纯链上、无需 CEX、已有历史回放通过 20%+ 门槛 | Aave V3 清算回放 |
| A | 纯链上、机制明确、历史或当前数据有强信号，但需要补回放/报价/预言机验证 | Morpho Blue 清算、Spark/Euler 清算、Curve LLAMMA |
| B | 纯链上但非原子套利，偏期限/做市/持有收益，需要独立风险披露 | Pendle PT 到期收敛、LST 退出/折价收敛 |
| C | 纯链上原子套利，但当前扫描为负或竞争过强，只能作为机会型模块 | DEX 跨池/三角/费率层套利、Curve/Balancer 稳定池套利 |

## 2. 已通过门槛的 5 条策略

这些都是 Aave V3 Ethereum 历史清算回放策略。策略机制是：发现健康因子低于 1 的借款账户，偿还债务资产，按清算折价获得抵押资产，再在链上换回本金资产或结算为利润。

| 排名 | 策略 ID | 标的 | 历史年化净收益 | 胜率 | 样本数 | 中位净利润 |
|---:|---|---|---:|---:|---:|---:|
| 1 | `aave-replay-ethereum-usdt-wbtc` | USDT debt / WBTC collateral | 600.08% | 87.50% | 32 | $223.45 |
| 2 | `aave-replay-ethereum-usdc-wbtc` | USDC debt / WBTC collateral | 375.86% | 96.67% | 30 | $1,270.22 |
| 3 | `aave-replay-ethereum-dai-weth` | DAI debt / WETH collateral | 344.74% | 100.00% | 5 | $22,268.14 |
| 4 | `aave-replay-ethereum-usdt-weth` | USDT debt / WETH collateral | 264.01% | 70.59% | 17 | $52.62 |
| 5 | `aave-replay-ethereum-usdt-wsteth` | USDT debt / wstETH collateral | 204.38% | 80.00% | 5 | $59.40 |

判断：

- 这是当前最值得优先深挖的策略族。
- 它是真正的纯链上策略，不要求用户注册交易所。
- 资金来源可以是用户自有钱包资金、策略合约资金池、或链上闪电贷。
- 年化数字不能用于承诺收益，因为清算机会是离散事件，资本大部分时间可能空闲。
- 下一步不是补实盘，而是扩大历史回放窗口、链覆盖和压力测试。

下一步回测任务：

1. 将 Aave 回放从 Ethereum 扩到 Base、Arbitrum、Polygon，以及更长历史窗口。
2. 对每个债务/抵押组合做按区块历史价格重估，不使用当前价格替代历史价格。
3. 加入 gas、MEV 竞争、失败交易、滑点、抵押资产换回深度的保守成本。
4. 把“年化净收益”拆成：机会频率、单次 ROI、资本占用时间、最大可部署资金。
5. 只把样本数、胜率、月度分布都过关的组合列为 S 级。

## 3. 强信号但未通过的策略族

### 3.1 Morpho Blue 清算

证据：

- 当前数据中有 3766 条 Morpho 清算候选。
- 正收益但被挡住的候选有 279 条。
- 当前状态文件显示 `liquidatableCount=26`，但主要被链上 oracle 检查失败挡住。
- 历史事件回放里有 147 条满足历史稳定性但仍需当前可清算账户和 fork 模拟的信号。

为什么值得做：

- Morpho Blue 是孤立市场，市场参数固定，适合逐市场建模。
- 清算触发规则明确：LTV 达到或超过 LLTV，任何人都可清算。
- 相比 Aave，长尾市场更多，折价可能更大，但 oracle/流动性风险也更高。

当前不能算通过：

- 很多候选使用长尾抵押品，oracle 调用失败或价格可信度不足。
- 部分历史回放使用当前价格近似历史价格，必须改为按事件区块重估。
- 必须证明清算后抵押品能在链上卖出，而不是只账面盈利。

回测任务：

1. 修复/补全 Morpho oracle 适配器。
2. 按 marketId 聚合历史清算事件，计算 30/60/90 天收益分布。
3. 对每个抵押品做链上退出路径：Curve、Uniswap、Balancer、Pendle、原生赎回。
4. 将长尾资产分为可卖出、只能持有、不可碰三类。

### 3.2 Spark / Euler / Maker 清算与拍卖

这类还没有在当前数据里形成完整候选池，但机制符合纯链上套利。

Spark：

- 机制接近 Aave，健康因子低于 1 时可调用 `liquidationCall()`。
- 若 HF 在 0.95 到 1 之间，最多清算 50%；HF 小于等于 0.95 时可到 100%。
- 适合复用 Aave 回放框架。

Euler V2：

- 使用 health score，低于 1 可被清算。
- 清算折价随账户健康程度变化，类似反向荷兰拍。
- 优点是定价机制更连续；缺点是 vault/子账户/控制器结构更复杂。

Maker：

- Liquidation 2.0 使用 Dutch auction。
- 策略不是“抢健康因子低于 1 的账户”，而是监控拍卖价格相对链上退出价格是否足够低。
- 需要拍卖事件回放，而不是普通借贷账户扫描。

回测任务：

1. Spark：直接复用 Aave 扫描器，替换 Pool 地址和参数。
2. Euler：建立 vault/account/health score 索引。
3. Maker：回放 `Clipper` 拍卖，按拍卖价格曲线、gas、退出 DEX 深度计算可获利窗口。

### 3.3 Curve crvUSD / LlamaLend / LLAMMA 软清算套利

这是一个值得单独建模的策略族，不是传统一次性清算。Curve LLAMMA 会在抵押物价格进入清算区间时，将抵押物和 crvUSD 在 bands 内连续转换；外部套利者通过和 LLAMMA 交易，使其价格跟随外部市场。

为什么值得做：

- 纯链上。
- 机制自带可套利 AMM。
- 可以基于 bands、oracle price、Curve router quote 做事件回放。
- 可能在剧烈行情或 crvUSD 偏离时产生较稳定的结构性机会。

当前不能算通过：

- 项目内还没有 LLAMMA 回放器。
- 需要准确复现 band 状态、oracle 价格、LLAMMA swap、外部退出路径。

回测任务：

1. 建立 crvUSD/LlamaLend market 列表。
2. 对每个 AMM 拉取 bands、active band、oracle price、pool balances。
3. 回放 Swap/TokenExchange 事件，比较 LLAMMA quote 与 Curve/Uniswap/Balancer 外部 quote。
4. 只计算同一交易内可完成的净利润。

### 3.4 Pendle PT 到期收敛

Pendle PT 是本金代币，到期后可按 1:1 赎回 accounting asset。买入折价 PT 并持有到期，本质是固定收益/期限收敛，不是同区块原子套利。

当前数据：

- `pendle-pt-arbitrage-candidates.json` 有 75 条候选。
- 3 条是 economic candidate。
- 例如 `jrUSDat` implied APY 29.84%、`STRCx` implied APY 23.67%，但都被挡住，因为还没有历史 PT 价格回放、退出流动性压力测试、router quote 和 fork 验证。

判断：

- 纯链上、用户只连钱包可以做。
- 但它不是原子套利，资金要占用到期或承担提前退出滑点。
- 只能作为 B 级“期限收敛策略”，不能混在套利策略里宣称稳定 20%。

回测任务：

1. 拉取 Pendle market 历史 implied APY、PT price、liquidity。
2. 分别测试持有到期、提前退出、止损退出三种路径。
3. 对 RWA、points、稳定币、LST 市场分桶，不混用风险。
4. 使用 Pendle 自身条款里的风险口径：显示 APY 是市场价格隐含收益，不等于保证收益。

## 4. 当前不优先的策略族

### 4.1 普通 DEX 跨池/三角/费率层套利

当前项目内扫描结果：

| 策略族 | 候选数 | 通过数 | 结果 |
|---|---:|---:|---|
| DEX-DEX exact input | 98 | 0 | 全部被 gas/slippage/深度挡住 |
| 三角套利 | 26 | 0 | 全部净负 |
| Uniswap V3 跨 fee tier | 168 | 0 | 全部净负 |
| Curve stableswap | 16 | 0 | 全部净负 |
| Balancer V2 | 12 | 0 | 全部净负 |

判断：

- 这类策略是纯链上、可原子执行，但竞争最激烈。
- 适合作为“机会型补充”，不适合作为主收益来源。
- 重点应该从定时扫描转成事件驱动：大额 swap、预言机更新、稳定币脱锚、清算后 backrun。

### 4.2 LP 高 APY 做市

当前 `strategy-candidates.json` 有 5 个表面高 APY 候选：

| 候选 | 项目 | 链 | APY | 判断 |
|---|---|---|---:|---|
| USDC-CBBTC | Aerodrome Slipstream | Base | 438.70% | 做市，不是套利 |
| WTAO-USDC | Uniswap V3 | Ethereum | 116.62% | 做市，不是套利 |
| SERV-WETH | Uniswap V3 | Ethereum | 87.36% | 做市，不是套利 |
| WETH-USDC | Uniswap V3 | Base | 77.67% | 做市，不是套利 |
| EURC-USDC | Aerodrome Slipstream | Base | 53.55% | 做市，不是套利 |

已有 WETH-USDC 事件回放显示短窗口净 APY 28.32%，但窗口只有约 16.6 分钟，样本太短，且它不是纯套利。

判断：

- 这类可以做成“链上做市策略”模块，但不应该算在套利模型里。
- 无常损失、再平衡成本、区间选择、激励衰减会让 APY 很不稳定。

## 5. 推荐策略路线

第一优先级：清算套利

- Aave V3：已有 5 条历史通过，是当前主线。
- Spark：与 Aave 接近，复制框架成本低。
- Morpho Blue：信号强，但需要 oracle/退出路径补严。
- Euler V2：机制值得扩展，先建索引。
- Maker Clipper：以拍卖事件回放为核心。

第二优先级：结构性链上折价

- Curve LLAMMA / LlamaLend：软清算 AMM 套利。
- Pendle PT：期限收敛，不按原子套利口径宣传。
- LST/LRT 折价收敛：只接受链上赎回或链上退出路径，不接 CEX。

第三优先级：事件驱动 DEX 套利

- 大额 swap 后 backrun。
- 清算后抵押资产卖压 backrun。
- 稳定币脱锚/再锚定。
- Curve/Balancer/Uniswap 间同资产 quote 偏离。

暂不作为主线：

- 普通周期扫描 DEX 价差。
- 只看 DeFiLlama APY 的 LP 做市。
- 需要 CEX 或中心化赎回/KYC 的稳定币套利。
- 跨链非原子套利，除非明确接受桥风险和时间风险。

## 6. 下一步只做策略发现的工作清单

1. Aave 回放加宽：扩大区块窗口、补 Base/Arbitrum/Polygon、按历史价格重估。
2. Spark 扫描器：复用 Aave 架构，先拿到历史清算候选。
3. Morpho 修正：oracle adapter、marketId 分组、历史事件按区块价格重放。
4. Curve LLAMMA 原型：先做单市场 quote replay，确认是否有 20%+ 级别机会。
5. Maker Clipper 原型：拍卖事件回放，计算拍卖价格低于链上退出价格的窗口。
6. Pendle PT 回放：至少 30/60/90 天历史价格，不再只看单点 implied APY。
7. DEX 策略降级：只保留事件驱动，不再浪费主线资源做普通轮询扫描。

## 7. 外部资料来源

- Aave V3 Pool：`liquidationCall()`、flash loans、health factor liquidation 条件  
  https://aave.com/docs/aave-v3/smart-contracts/pool  
  https://aave.com/help/borrowing/liquidations

- Morpho Blue：LTV/LLTV、liquidate、flash loans、Blue SDK  
  https://docs.morpho.org/build/borrow/concepts/liquidation  
  https://docs.morpho.org/build/borrow/concepts/ltv/  
  https://docs.morpho.org/get-started/resources/contracts/morpho/  
  https://docs.morpho.org/learn/concepts/flashloans/

- Spark Liquidations  
  https://docs.spark.fi/dev/sparklend/features/liquidations

- Euler Liquidations  
  https://docs.euler.finance/user-guide/liquidation/

- Maker Liquidation 2.0 / Clipper auctions  
  https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation

- Uniswap V3 flash swaps  
  https://developers.uniswap.org/docs/protocols/v3/guides/flash-swaps/final-contract

- Balancer V3 flash loans  
  https://docs.balancer.fi/concepts/vault/flash-loans.html

- Curve Router / LLAMMA  
  https://docs.curve.finance/developer/amm/router/curve-router-ng  
  https://docs.curve.finance/developer/crvusd/llamma-explainer  
  https://docs.curve.finance/developer/lending/overview

- Pendle PT / APY  
  https://docs.pendle.finance/pendle-v2/ProtocolMechanics/YieldTokenization/PT  
  https://docs.pendle.finance/pendle-v2/ProtocolMechanics/PendleMarketAPYCalculation  
  https://docs.pendle.finance/pendle-v2/TermsOfUse

- Flashbots MEV-Share / atomic arbitrage reference  
  https://docs.flashbots.net/flashbots-mev-share/searchers/tutorials/flash-loan-arbitrage/introduction  
  https://docs.flashbots.net/flashbots-mev-share/searchers/tutorials/flash-loan-arbitrage/simple-blind-arbitrage  
  https://docs.flashbots.net/flashbots-mev-share/searchers/understanding-bundles

