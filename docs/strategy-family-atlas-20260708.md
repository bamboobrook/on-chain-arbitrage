# 纯链上套利策略搜索图谱

生成日期：2026-07-08
项目目录：`/home/bumblebee/Project/on-chain-arbitrage`
范围：只做策略发现，不展开实盘执行层。

## 1. 硬结论

没有找到可以对用户承诺“稳定保证 20%+ 年化、不过拟合、当前可直接跑”的纯链上套利模型。这个结论需要保留在产品和文案里，不能因为历史 APY 好看就改口。

但已经找到了可继续深挖的策略队列：

- 当前唯一 S 级：Aave V3 清算套利历史事件回放。
- 当前最该新增回放器：Maker Clipper、Curve LLAMMA、Euler V2。
- 当前强信号但卡住：Morpho Blue，主要被 oracle 与退出路径 gate 挡住。
- 当前降级：普通 DEX 轮询套利、LP 高 APY 做市、跨链非原子价差。

当前项目计数：

| 指标 | 数量 |
|---|---:|
| 策略族数量 | 11 |
| 产物数量 | 36 |
| 候选数量 | 4,272 |
| 历史过线数量 | 5 |
| 当前实盘可宣称数量 | 0 |
| 排序候选行数 | 5,038 |
| 正收益但未过门槛 | 403 |
| oracle 失败候选 | 3,562 |

## 2. 策略优先级总表

| 排名 | 等级 | 策略 | 原子性/资金形态 | 当前状态 | 为什么这样排 |
|---:|---|---|---|---|---|
| 1 | S | Aave V3 清算套利 | 可原子化，闪电贷或用户授权资金均可 | 已找到历史过线样本，但还不能承诺稳定 20% 或当前可执行。 | 唯一已经在项目数据里通过历史门槛的纯链上策略族，应继续扩大历史窗口和链覆盖。 |
| 2 | A | Morpho Blue 孤立市场清算 | 可原子化，但 oracle 与退出路径必须逐市场适配 | 强信号，但当前 oracle gate 全部失败或未通过，不能列为通过策略。 | 孤立市场多、清算折价机制直接，长尾市场可能给出比 Aave 更高折价。 |
| 3 | A | Maker Clipper 荷兰拍卖套利 | 可通过 clipperCallee 模式原子购买并换回 DAI | 扫描器已落地，但最近一次被 RPC/DNS 阻塞；仍是 A 级待回放策略。 | 不是普通抢同一健康因子的清算，拍卖价格曲线给了更可量化的成交窗口。 |
| 4 | A | Curve crvUSD / LlamaLend LLAMMA 软清算套利 | 可原子化，但需要准确复现 AMM band 状态 | 未回测，但机制本身就是为外部套利者维护价格而设计。 | 这是“清算即 AMM 套利”，比普通 DEX 价差更结构化，且完全链上。 |
| 5 | A | Euler V2 反向荷兰式清算 | 可原子化，需适配 EVC/vault/account 结构 | 未回测，但协议机制与目标吻合，优先级高于普通 DEX 轮询。 | 折价不是固定的，深度不健康账户可能给出更好边际；适合在波动行情中搜索。 |
| 6 | B+ | Compound III absorb + discounted collateral buy | buyCollateral 可原子买入并退出；absorb 本身不直接给抵押品利润 | 机制真实，但现有扫描没有候选；低于 Maker/LLAMMA/Euler。 | 若市场 reserves 低于 target 且有折价 collateral，机会可纯链上捕获。 |
| 7 | B+ | Silo V3 / 孤立借贷市场清算 | 理论可原子化，但抵押品退出风险高 | 候选扩展池，不应先于 Maker/LLAMMA/Euler。 | 孤立市场数量多，可能补充 Morpho 类长尾机会。 |
| 8 | B | SparkLend 清算套利 | 可原子化 | 已集成，但目前不通过；作为低成本监控项保留。 | 复制 Aave 成本低，但机会密度目前弱。 |
| 9 | B | Pendle PT 到期收敛 | 非原子套利，资金占用到期或承担提前退出滑点 | 可做策略模块，但不能归为原子套利，也不能承诺稳定 20%。 | 适合补充“期限收敛”策略，风险披露必须独立。 |
| 10 | B- | Venus / BNB 链借贷清算 | 可原子化，但 BNB 链 MEV/节点质量/长尾抵押品风险要单独评估 | 扩展候选，不进第一批回放。 | 如果需要更大搜索范围，可作为 BNB 链清算机会池。 |
| 11 | C | 事件驱动 DEX backrun / 跨池套利 | 可原子化 | 普通扫描已证明不适合作为主线，保留事件驱动版本。 | 只有和清算/大额交易结合时才可能有边际，不能继续投入普通轮询。 |
| 12 | Reject | LP 高 APY 做市 | 非原子套利 | 从套利策略主线中排除，可另建做市策略模块。 | 容易用漂亮 APY 误导用户，不符合这轮“找套利模型”的目标。 |
| 13 | Reject | 跨链非原子价差套利 | 非原子 | 本轮排除。 | 桥风险和时间风险会掩盖策略真实边际。 |
| 14 | Reject | Sandwich / 对用户有害 MEV | 原子 | 伦理、合规和品牌风险太高，排除。 | 不是要给用户做的自动化套利产品。 |

## 3. 第一批只做这些策略

1. Aave V3 清算套利
2. Morpho Blue 孤立市场清算
3. Maker Clipper 荷兰拍卖套利
4. Curve crvUSD / LlamaLend LLAMMA 软清算套利
5. Euler V2 反向荷兰式清算

这一批的共同点是：纯链上、无需 CEX、收益来源不是 LP 激励幻觉，而是清算折价、拍卖折价或 LLAMMA 结构性价差。

## 4. 逐策略回测要求

### 1. Aave V3 清算套利（S）

模型：健康因子跌破 1 后偿还债务、折价拿抵押品、链上换回本金或目标资产。

当前证据：
- Ethereum 历史清算回放 passing=5 / candidates=47
- 总览 passing=5，当前 live-ready=0
- 当前 watchlist 资金容量约 $654,661.41，但当前 liquidatable=0

下一步回测：
- Ethereum 回放窗口从 120k blocks 扩到多月或全年，按月份分桶。
- Base / Arbitrum / Polygon 用同一口径回放，不只做当前账户扫描。
- 按事件区块重估债务、抵押、DEX 退出价格，禁止用当前价格替代历史价格。
- 加入 gas、flashloan premium、MEV bribe、失败率和最大可成交深度。

淘汰条件：月度分布集中在单次暴利、退出路径小于清算规模、或样本数不足。

### 2. Morpho Blue 孤立市场清算（A）

模型：LTV >= LLTV 时 direct liquidation；清算人偿还 loan asset 并折价获得 collateral。

当前证据：
- 历史回放候选=1,000，历史稳定但 live blocked=137
- 当前候选=2,777，liquidatable=22
- oracle 诊断 passed=0 / diagnosed=22

下一步回测：
- 先只保留 oracle 可读、抵押品可卖出的 marketId，剔除 oracle-reverting 市场。
- 按 marketId 聚合历史 liquidation 事件，做 30/60/90 天收益分布。
- 为每种 collateral 建退出路由：Curve、Uniswap、Balancer、Pendle、原生 redeem。
- 对每个市场记录 LLTV、LIF、oracle、loan asset、collateral asset 和可成交容量。

淘汰条件：oracle 不能稳定读、抵押品没有链上退出深度、或盈利来自不可卖出长尾资产。

### 3. Maker Clipper 荷兰拍卖套利（A）

模型：监控 Clipper active auctions，当 auction price 低于链上退出 quote 时 take collateral。

当前证据：
- 官方 Liquidation 2.0 明确 Dog.bark 启动拍卖、Clipper.take 购买抵押品。
- 价格由 Abacus/Clipper 参数随时间下降，天然适合历史事件回放。
- 项目内已新增 Maker Clipper 扫描器；当前状态=rpc-blocked-maker-clipper-scan，auctionCount=0，eventCount=0
- 最近一次运行被 Ethereum RPC/DNS 超时挡住，不能据此排除该策略。

下一步回测：
- 收集每个 ilk 的 Clipper 地址、calc、buf、tail、cusp、chip、tip。
- 回放 kick / take / redo 事件，重建 auction price 与剩余 lot/tab。
- 在每个 auction block 计算 collateral -> DAI 的链上退出 quote。
- 只记录 auction price + gas + bribe + slippage 后仍为正的窗口长度和容量。

淘汰条件：过去 6-12 个月有效拍卖太少、成交窗口短到无法竞争、或 DAI 退出路径不足。

### 4. Curve crvUSD / LlamaLend LLAMMA 软清算套利（A）

模型：比较 LLAMMA get_p / price_oracle / 外部 DEX quote，在 band rebalance 中做反向交易。

当前证据：
- Curve 文档明确 LLAMMA 会通过 AMM 价格差制造套利激励。
- LlamaLend 每个市场有独立 Controller、LLAMMA、Vault，适合逐市场建模。
- 项目内尚无 LLAMMA 回放器，属于新增高优先级策略族。

下一步回测：
- 枚举 crvUSD 与 LlamaLend markets，保存 controller、amm、vault、collateral、borrowable。
- 读取 active_band、price_oracle、get_p、get_amount_for_price 和 band balances。
- 回放 AMM exchange 事件，比较 LLAMMA quote 与 Curve Router / Uniswap / Balancer 外部 quote。
- 按 oracle 大幅变动区块做事件驱动扫描，不做普通轮询。

淘汰条件：band 内可交易量太小、外部退出路由滑点吞掉价差、或 quote 与实际 swap 差异过大。

### 5. Euler V2 反向荷兰式清算（A）

模型：health score <= 1 时清算；折价随账户不健康程度扩大。

当前证据：
- 官方文档说明 health score <= 1 可清算，且 discount 随低于 1 的程度扩大。
- Euler 提供开源 liquidation bot，可作为索引/事件结构参考。
- 项目内尚未建立 Euler V2 账户索引。

下一步回测：
- 拉取 Euler vault 列表、oracle、collateral factor、borrow positions。
- 建立 EVC account -> vault -> debt/collateral 索引。
- 回放 liquidate 事件与健康分数变化，估算折价、容量和退出路径。
- 先限制在主流抵押品/借款资产，再扩到长尾。

淘汰条件：账户发现成本过高、实际折价被 MEV 竞争抹平、或 vault 退出路径不稳定。

### 6. Compound III absorb + discounted collateral buy（B+）

模型：账户被 absorb 后，协议出售抵押品补 reserves，buyCollateral 按治理折价买入。

当前证据：
- 项目内 Compound III 回放 eventCount=0，passing=0
- 官方机制支持 absorb 与 buyCollateral 两步，但取决于协议 reserves 与可售 collateral。

下一步回测：
- 按 Comet 市场读取 targetReserves、getReserves、getCollateralReserves。
- 监听 AbsorbCollateral / BuyCollateral 相关事件，重建可售抵押品库存。
- 比较 quoteCollateral 与外部 DEX quote。

淘汰条件：长期无可售 collateral，或折价小于 gas+slippage+竞争成本。

### 7. Silo V3 / 孤立借贷市场清算（B+）

模型：孤立市场下 permissionless liquidation；长尾抵押品可能给出高折价。

当前证据：
- 官方资料显示 Silo V3 清算是 permissionless，并有 collateral-sale liquidation 模式。
- 项目内尚无 Silo 索引与回放。

下一步回测：
- 从 factory/repository 事件枚举 markets。
- 只保留有链上深度的 debt/collateral 组合。
- 回放 borrow/liquidation 事件，估算清算折价与退出路径。

淘汰条件：抵押品只有小池流动性、oracle 风险高、或 liquidation fee 主要给 lenders 而非 liquidator。

### 8. SparkLend 清算套利（B）

模型：Aave-like liquidationCall，复用 Aave 框架。

当前证据：
- 项目内 Spark 历史回放 passing=0 / candidates=1
- 当前扫描只有少量候选，尚未形成可用收益证据。

下一步回测：
- 扩大历史窗口即可，不要为 Spark 单独消耗过多工程时间。

淘汰条件：扩大窗口后仍样本稀疏或净利润为负。

### 9. Pendle PT 到期收敛（B）

模型：折价买入 PT，持有到期按 accounting asset 赎回，或提前在链上退出。

当前证据：
- 项目内 Pendle candidates=75，economic=3，passing=0
- PT 机制纯链上，但 APY 是市场隐含收益，不是保本收益。

下一步回测：
- 拉取 PT 历史价格、implied APY、liquidity、maturity。
- 分别回测持有到期、提前退出、止损退出。
- 按 RWA / stable / LST / points 市场分桶。

淘汰条件：APY 主要来自积分、长尾信用风险、或退出深度不足。

### 10. Venus / BNB 链借贷清算（B-）

模型：类 Compound/Aave 清算，repay debt 后 seize collateral。

当前证据：
- 官方开发者 guide 面向自动化 liquidator。
- 项目内尚无 Venus 回放；由于链与资产风险，排在 Silo 之后。

下一步回测：
- 先枚举核心池和主流抵押品，不碰低深度治理币。
- 回放 liquidation 事件并计算链上退出深度。

淘汰条件：坏账/预言机/低深度资产占主要收益来源。

### 11. 事件驱动 DEX backrun / 跨池套利（C）

模型：只在大额 swap、清算卖压、oracle 更新后计算负环，不做周期轮询。

当前证据：
- 当前 Curve stable candidates=16 passing=0
- Balancer candidates=12 passing=0
- Uniswap V3 fee-tier candidates=24 passing=0

下一步回测：
- 监听大额 swap 和清算事件后 N 个区块内的价差收敛。
- 按 path capacity 和 gas/bribe 过滤，不输出小额纸面利润。

淘汰条件：不含明确事件触发、只靠定时轮询发现价差。

### 12. LP 高 APY 做市（Reject）

模型：提供流动性赚交易费/激励，不是套利。

当前证据：
- 项目内有表面高 APY 池，但已有报告指出样本短、不是套利、无常损失不可忽略。

下一步回测：
- 若以后做，需要完整 IL、区间再平衡、激励衰减回测。

淘汰条件：任何时候都不应混入“纯套利 20%+”策略池。

### 13. 跨链非原子价差套利（Reject）

模型：桥接资产跨链卖出，依赖桥时间、桥安全和价格变化。

当前证据：
- 虽然可以只用钱包，但不是同一链上原子套利，风险模型完全不同。

下一步回测：
- 除非用户明确接受桥风险，否则不进入套利主线。

淘汰条件：需要等待桥确认或中心化托管。

### 14. Sandwich / 对用户有害 MEV（Reject）

模型：夹击用户交易获利。

当前证据：
- 可获利但不适合作为面向用户开放的产品策略。

下一步回测：
- 不做。

淘汰条件：任何主动伤害普通用户成交价格的模型。


## 5. 统一过线门槛

任何策略要进入“可展示给用户选择”的候选池，至少要同时满足：

- 纯链上：不需要 CEX 账号，不依赖中心化报价成交。
- 可解释收益来源：清算折价、拍卖折价、AMM 结构价差、期限收敛必须分开标注。
- 样本足够：不能只靠 1-2 次大行情或单次暴利。
- 时间分布：按月/周分桶后仍有机会，而不是集中在一个事件。
- 容量真实：按可成交深度和滑点限制最大投入资金。
- 成本保守：gas、flashloan premium、MEV bribe、失败交易、oracle 延迟都要扣。
- 退出路径真实：拿到的抵押品必须能在链上卖出、赎回或结算。
- 不承诺稳定收益：历史 APY 只能是回测指标，不是保证收益。

## 6. 明确暂不投入

- 普通 DEX 定时轮询价差：现有扫描结果显示 Curve、Balancer、Uniswap V3 fee-tier 都没有过线。
- LP 高 APY 做市：不是套利，必须单独作为做市产品研究。
- 跨链非原子套利：桥风险和时间风险不符合这轮纯链上原子套利目标。
- Sandwich 或主动伤害用户的 MEV：不适合作为对外开放产品策略。

## 7. 外部资料来源

- Aave V3 Pool liquidationCall / flashLoan: https://aave.com/docs/aave-v3/smart-contracts/pool
- Morpho Blue liquidation and LLTV trigger: https://docs.morpho.org/build/borrow/concepts/liquidation/
- Euler liquidation health score and reverse Dutch discount: https://docs.euler.finance/user-guide/liquidation/
- Maker Liquidation 2.0 Dog / Clipper auctions: https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation
- Curve crvUSD LLAMMA explainer: https://docs.curve.finance/developer/crvusd/llamma-explainer/
- Curve Lending isolated Controller / LLAMMA / Vault markets: https://docs.curve.finance/developer/lending/overview/
- Compound III liquidation, absorb and buyCollateral: https://docs.compound.finance/liquidation/
- SparkLend liquidations: https://docs.spark.fi/dev/sparklend/features/liquidations
- Pendle PT yield tokenization: https://docs.pendle.finance/pendle-v2/ProtocolMechanics/YieldTokenization/PT
- Silo V3 liquidation overview: https://docs.silo.finance/docs/users/core-concepts/silo/liquidation/
- Venus liquidation developer guide: https://docs-v4.venus.io/guides/liquidation
