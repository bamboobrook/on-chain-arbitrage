#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');
const docsDir = resolve(root, 'docs');

const generatedAt = new Date().toISOString();
const reportDate = '2026-07-08';
const reportSlugDate = '20260708';

async function readJson(relativePath, fallback = null) {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    return { readError: error.message };
  }
}

function compactNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'n/a';
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function pct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'n/a';
  return `${Number(value).toFixed(2)}%`;
}

const overview = await readJson('data/pure-arbitrage-search-overview.json', {});
const ranked = await readJson('data/strategy-discovery-ranked-candidates.json', {});
const aaveReplay = await readJson('data/aave-liquidation-event-replay-candidates-ethereum.json', {});
const aaveCurrent = await readJson('data/aave-liquidation-candidates-ethereum.json', {});
const aaveWatch = await readJson('data/aave-liquidation-watchlist-analysis-ethereum.json', {});
const morphoReplay = await readJson('data/morpho-blue-liquidation-event-replay-candidates-ethereum.json', {});
const morphoCurrent = await readJson('data/morpho-blue-liquidation-candidates-ethereum.json', {});
const morphoWatch = await readJson('data/morpho-blue-liquidation-watchlist-ethereum.json', {});
const morphoOracle = await readJson('data/morpho-blue-oracle-diagnostics-ethereum.json', {});
const sparkReplay = await readJson('data/aave-liquidation-event-replay-candidates-spark-ethereum.json', {});
const compoundReplay = await readJson('data/compound-v3-liquidation-candidates-event-replay-ethereum.json', {});
const pendle = await readJson('data/pendle-pt-arbitrage-candidates.json', {});
const curve = await readJson('data/curve-stable-arbitrage-candidates-ethereum.json', {});
const balancer = await readJson('data/balancer-arbitrage-candidates-ethereum.json', {});
const uniFee = await readJson('data/uniswap-v3-fee-arbitrage-candidates-ethereum.json', {});
const makerClipper = await readJson('data/maker-clipper-auction-candidates-ethereum.json', {});

const familyMetrics = new Map(
  (ranked.families ?? []).map((family) => [family.family, family]),
);

const sources = [
  {
    name: 'Aave V3 Pool liquidationCall / flashLoan',
    url: 'https://aave.com/docs/aave-v3/smart-contracts/pool',
  },
  {
    name: 'Morpho Blue liquidation and LLTV trigger',
    url: 'https://docs.morpho.org/build/borrow/concepts/liquidation/',
  },
  {
    name: 'Euler liquidation health score and reverse Dutch discount',
    url: 'https://docs.euler.finance/user-guide/liquidation/',
  },
  {
    name: 'Maker Liquidation 2.0 Dog / Clipper auctions',
    url: 'https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation',
  },
  {
    name: 'Curve crvUSD LLAMMA explainer',
    url: 'https://docs.curve.finance/developer/crvusd/llamma-explainer/',
  },
  {
    name: 'Curve Lending isolated Controller / LLAMMA / Vault markets',
    url: 'https://docs.curve.finance/developer/lending/overview/',
  },
  {
    name: 'Compound III liquidation, absorb and buyCollateral',
    url: 'https://docs.compound.finance/liquidation/',
  },
  {
    name: 'SparkLend liquidations',
    url: 'https://docs.spark.fi/dev/sparklend/features/liquidations',
  },
  {
    name: 'Pendle PT yield tokenization',
    url: 'https://docs.pendle.finance/pendle-v2/ProtocolMechanics/YieldTokenization/PT',
  },
  {
    name: 'Silo V3 liquidation overview',
    url: 'https://docs.silo.finance/docs/users/core-concepts/silo/liquidation/',
  },
  {
    name: 'Venus liquidation developer guide',
    url: 'https://docs-v4.venus.io/guides/liquidation',
  },
];

const families = [
  {
    rank: 1,
    tier: 'S',
    id: 'aave-v3-liquidation-event-replay',
    strategy: 'Aave V3 清算套利',
    model: '健康因子跌破 1 后偿还债务、折价拿抵押品、链上换回本金或目标资产。',
    pureOnchain: true,
    walletOnly: true,
    atomicity: '可原子化，闪电贷或用户授权资金均可',
    evidence: [
      `Ethereum 历史清算回放 passing=${compactNumber(aaveReplay.summary?.passingCount ?? aaveReplay.passingCount)} / candidates=${compactNumber(aaveReplay.summary?.candidateCount ?? aaveReplay.candidateCount)}`,
      `总览 passing=${compactNumber(overview.summary?.passingCount ?? overview.passingCount)}，当前 live-ready=0`,
      `当前 watchlist 资金容量约 $${compactNumber(aaveWatch.summary?.totalDebtToCoverUsd ?? aaveWatch.totalDebtToCoverUsd)}，但当前 liquidatable=0`,
    ],
    status: '已找到历史过线样本，但还不能承诺稳定 20% 或当前可执行。',
    whyPriority: '唯一已经在项目数据里通过历史门槛的纯链上策略族，应继续扩大历史窗口和链覆盖。',
    backtestNext: [
      'Ethereum 回放窗口从 120k blocks 扩到多月或全年，按月份分桶。',
      'Base / Arbitrum / Polygon 用同一口径回放，不只做当前账户扫描。',
      '按事件区块重估债务、抵押、DEX 退出价格，禁止用当前价格替代历史价格。',
      '加入 gas、flashloan premium、MEV bribe、失败率和最大可成交深度。',
    ],
    rejectIf: '月度分布集中在单次暴利、退出路径小于清算规模、或样本数不足。',
    sources: [sources[0].url],
  },
  {
    rank: 2,
    tier: 'A',
    id: 'morpho-blue-liquidation',
    strategy: 'Morpho Blue 孤立市场清算',
    model: 'LTV >= LLTV 时 direct liquidation；清算人偿还 loan asset 并折价获得 collateral。',
    pureOnchain: true,
    walletOnly: true,
    atomicity: '可原子化，但 oracle 与退出路径必须逐市场适配',
    evidence: [
      `历史回放候选=${compactNumber(morphoReplay.summary?.candidateCount ?? morphoReplay.candidateCount)}，历史稳定但 live blocked=${compactNumber(morphoReplay.summary?.historicalStabilityPassedButLiveBlockedCount ?? morphoReplay.historicalStabilityPassedButLiveBlockedCount)}`,
      `当前候选=${compactNumber(morphoCurrent.summary?.candidateCount ?? morphoCurrent.candidateCount)}，liquidatable=${compactNumber(morphoCurrent.summary?.liquidatableCount ?? morphoCurrent.liquidatableCount)}`,
      `oracle 诊断 passed=${compactNumber(morphoOracle.summary?.passedOracleCount ?? morphoOracle.passedOracleCount)} / diagnosed=${compactNumber(morphoOracle.summary?.diagnosedMarketCount ?? morphoOracle.diagnosedMarketCount)}`,
    ],
    status: '强信号，但当前 oracle gate 全部失败或未通过，不能列为通过策略。',
    whyPriority: '孤立市场多、清算折价机制直接，长尾市场可能给出比 Aave 更高折价。',
    backtestNext: [
      '先只保留 oracle 可读、抵押品可卖出的 marketId，剔除 oracle-reverting 市场。',
      '按 marketId 聚合历史 liquidation 事件，做 30/60/90 天收益分布。',
      '为每种 collateral 建退出路由：Curve、Uniswap、Balancer、Pendle、原生 redeem。',
      '对每个市场记录 LLTV、LIF、oracle、loan asset、collateral asset 和可成交容量。',
    ],
    rejectIf: 'oracle 不能稳定读、抵押品没有链上退出深度、或盈利来自不可卖出长尾资产。',
    sources: [sources[1].url],
  },
  {
    rank: 3,
    tier: 'A',
    id: 'maker-clipper-dutch-auction',
    strategy: 'Maker Clipper 荷兰拍卖套利',
    model: '监控 Clipper active auctions，当 auction price 低于链上退出 quote 时 take collateral。',
    pureOnchain: true,
    walletOnly: true,
    atomicity: '可通过 clipperCallee 模式原子购买并换回 DAI',
    evidence: [
      '官方 Liquidation 2.0 明确 Dog.bark 启动拍卖、Clipper.take 购买抵押品。',
      '价格由 Abacus/Clipper 参数随时间下降，天然适合历史事件回放。',
      `项目内已新增 Maker Clipper 扫描器；当前状态=${makerClipper.summary?.status ?? 'not-run'}，auctionCount=${compactNumber(makerClipper.summary?.auctionCount ?? 0)}，eventCount=${compactNumber(makerClipper.summary?.eventCount ?? 0)}`,
      makerClipper.summary?.status === 'rpc-blocked-maker-clipper-scan'
        ? '最近一次运行被 Ethereum RPC/DNS 超时挡住，不能据此排除该策略。'
        : '策略仍需 auction curve + DEX exit quote 回放后才能判断盈利。',
    ],
    status:
      makerClipper.summary?.status === 'rpc-blocked-maker-clipper-scan'
        ? '扫描器已落地，但最近一次被 RPC/DNS 阻塞；仍是 A 级待回放策略。'
        : '扫描器已落地，仍需利润回放；机制高度契合纯链上套利。',
    whyPriority: '不是普通抢同一健康因子的清算，拍卖价格曲线给了更可量化的成交窗口。',
    backtestNext: [
      '收集每个 ilk 的 Clipper 地址、calc、buf、tail、cusp、chip、tip。',
      '回放 kick / take / redo 事件，重建 auction price 与剩余 lot/tab。',
      '在每个 auction block 计算 collateral -> DAI 的链上退出 quote。',
      '只记录 auction price + gas + bribe + slippage 后仍为正的窗口长度和容量。',
    ],
    rejectIf: '过去 6-12 个月有效拍卖太少、成交窗口短到无法竞争、或 DAI 退出路径不足。',
    sources: [sources[3].url],
  },
  {
    rank: 4,
    tier: 'A',
    id: 'curve-crvusd-llamma-arbitrage',
    strategy: 'Curve crvUSD / LlamaLend LLAMMA 软清算套利',
    model: '比较 LLAMMA get_p / price_oracle / 外部 DEX quote，在 band rebalance 中做反向交易。',
    pureOnchain: true,
    walletOnly: true,
    atomicity: '可原子化，但需要准确复现 AMM band 状态',
    evidence: [
      'Curve 文档明确 LLAMMA 会通过 AMM 价格差制造套利激励。',
      'LlamaLend 每个市场有独立 Controller、LLAMMA、Vault，适合逐市场建模。',
      '项目内尚无 LLAMMA 回放器，属于新增高优先级策略族。',
    ],
    status: '未回测，但机制本身就是为外部套利者维护价格而设计。',
    whyPriority: '这是“清算即 AMM 套利”，比普通 DEX 价差更结构化，且完全链上。',
    backtestNext: [
      '枚举 crvUSD 与 LlamaLend markets，保存 controller、amm、vault、collateral、borrowable。',
      '读取 active_band、price_oracle、get_p、get_amount_for_price 和 band balances。',
      '回放 AMM exchange 事件，比较 LLAMMA quote 与 Curve Router / Uniswap / Balancer 外部 quote。',
      '按 oracle 大幅变动区块做事件驱动扫描，不做普通轮询。',
    ],
    rejectIf: 'band 内可交易量太小、外部退出路由滑点吞掉价差、或 quote 与实际 swap 差异过大。',
    sources: [sources[4].url, sources[5].url],
  },
  {
    rank: 5,
    tier: 'A',
    id: 'euler-v2-liquidation',
    strategy: 'Euler V2 反向荷兰式清算',
    model: 'health score <= 1 时清算；折价随账户不健康程度扩大。',
    pureOnchain: true,
    walletOnly: true,
    atomicity: '可原子化，需适配 EVC/vault/account 结构',
    evidence: [
      '官方文档说明 health score <= 1 可清算，且 discount 随低于 1 的程度扩大。',
      'Euler 提供开源 liquidation bot，可作为索引/事件结构参考。',
      '项目内尚未建立 Euler V2 账户索引。',
    ],
    status: '未回测，但协议机制与目标吻合，优先级高于普通 DEX 轮询。',
    whyPriority: '折价不是固定的，深度不健康账户可能给出更好边际；适合在波动行情中搜索。',
    backtestNext: [
      '拉取 Euler vault 列表、oracle、collateral factor、borrow positions。',
      '建立 EVC account -> vault -> debt/collateral 索引。',
      '回放 liquidate 事件与健康分数变化，估算折价、容量和退出路径。',
      '先限制在主流抵押品/借款资产，再扩到长尾。',
    ],
    rejectIf: '账户发现成本过高、实际折价被 MEV 竞争抹平、或 vault 退出路径不稳定。',
    sources: [sources[2].url],
  },
  {
    rank: 6,
    tier: 'B+',
    id: 'compound-iii-discounted-collateral',
    strategy: 'Compound III absorb + discounted collateral buy',
    model: '账户被 absorb 后，协议出售抵押品补 reserves，buyCollateral 按治理折价买入。',
    pureOnchain: true,
    walletOnly: true,
    atomicity: 'buyCollateral 可原子买入并退出；absorb 本身不直接给抵押品利润',
    evidence: [
      `项目内 Compound III 回放 eventCount=${compactNumber(compoundReplay.summary?.eventCount ?? compoundReplay.eventCount)}，passing=0`,
      '官方机制支持 absorb 与 buyCollateral 两步，但取决于协议 reserves 与可售 collateral。',
    ],
    status: '机制真实，但现有扫描没有候选；低于 Maker/LLAMMA/Euler。',
    whyPriority: '若市场 reserves 低于 target 且有折价 collateral，机会可纯链上捕获。',
    backtestNext: [
      '按 Comet 市场读取 targetReserves、getReserves、getCollateralReserves。',
      '监听 AbsorbCollateral / BuyCollateral 相关事件，重建可售抵押品库存。',
      '比较 quoteCollateral 与外部 DEX quote。',
    ],
    rejectIf: '长期无可售 collateral，或折价小于 gas+slippage+竞争成本。',
    sources: [sources[6].url],
  },
  {
    rank: 7,
    tier: 'B+',
    id: 'silo-v3-isolated-liquidation',
    strategy: 'Silo V3 / 孤立借贷市场清算',
    model: '孤立市场下 permissionless liquidation；长尾抵押品可能给出高折价。',
    pureOnchain: true,
    walletOnly: true,
    atomicity: '理论可原子化，但抵押品退出风险高',
    evidence: [
      '官方资料显示 Silo V3 清算是 permissionless，并有 collateral-sale liquidation 模式。',
      '项目内尚无 Silo 索引与回放。',
    ],
    status: '候选扩展池，不应先于 Maker/LLAMMA/Euler。',
    whyPriority: '孤立市场数量多，可能补充 Morpho 类长尾机会。',
    backtestNext: [
      '从 factory/repository 事件枚举 markets。',
      '只保留有链上深度的 debt/collateral 组合。',
      '回放 borrow/liquidation 事件，估算清算折价与退出路径。',
    ],
    rejectIf: '抵押品只有小池流动性、oracle 风险高、或 liquidation fee 主要给 lenders 而非 liquidator。',
    sources: [sources[9].url],
  },
  {
    rank: 8,
    tier: 'B',
    id: 'sparklend-liquidation',
    strategy: 'SparkLend 清算套利',
    model: 'Aave-like liquidationCall，复用 Aave 框架。',
    pureOnchain: true,
    walletOnly: true,
    atomicity: '可原子化',
    evidence: [
      `项目内 Spark 历史回放 passing=${compactNumber(sparkReplay.summary?.passingCount ?? sparkReplay.passingCount)} / candidates=${compactNumber(sparkReplay.summary?.candidateCount ?? sparkReplay.candidateCount)}`,
      '当前扫描只有少量候选，尚未形成可用收益证据。',
    ],
    status: '已集成，但目前不通过；作为低成本监控项保留。',
    whyPriority: '复制 Aave 成本低，但机会密度目前弱。',
    backtestNext: ['扩大历史窗口即可，不要为 Spark 单独消耗过多工程时间。'],
    rejectIf: '扩大窗口后仍样本稀疏或净利润为负。',
    sources: [sources[7].url],
  },
  {
    rank: 9,
    tier: 'B',
    id: 'pendle-pt-fixed-yield-convergence',
    strategy: 'Pendle PT 到期收敛',
    model: '折价买入 PT，持有到期按 accounting asset 赎回，或提前在链上退出。',
    pureOnchain: true,
    walletOnly: true,
    atomicity: '非原子套利，资金占用到期或承担提前退出滑点',
    evidence: [
      `项目内 Pendle candidates=${compactNumber(pendle.summary?.candidateCount ?? pendle.candidateCount)}，economic=${compactNumber(pendle.summary?.economicCandidateCount ?? pendle.economicCandidateCount)}，passing=0`,
      'PT 机制纯链上，但 APY 是市场隐含收益，不是保本收益。',
    ],
    status: '可做策略模块，但不能归为原子套利，也不能承诺稳定 20%。',
    whyPriority: '适合补充“期限收敛”策略，风险披露必须独立。',
    backtestNext: [
      '拉取 PT 历史价格、implied APY、liquidity、maturity。',
      '分别回测持有到期、提前退出、止损退出。',
      '按 RWA / stable / LST / points 市场分桶。',
    ],
    rejectIf: 'APY 主要来自积分、长尾信用风险、或退出深度不足。',
    sources: [sources[8].url],
  },
  {
    rank: 10,
    tier: 'B-',
    id: 'venus-and-bnb-lending-liquidation',
    strategy: 'Venus / BNB 链借贷清算',
    model: '类 Compound/Aave 清算，repay debt 后 seize collateral。',
    pureOnchain: true,
    walletOnly: true,
    atomicity: '可原子化，但 BNB 链 MEV/节点质量/长尾抵押品风险要单独评估',
    evidence: [
      '官方开发者 guide 面向自动化 liquidator。',
      '项目内尚无 Venus 回放；由于链与资产风险，排在 Silo 之后。',
    ],
    status: '扩展候选，不进第一批回放。',
    whyPriority: '如果需要更大搜索范围，可作为 BNB 链清算机会池。',
    backtestNext: [
      '先枚举核心池和主流抵押品，不碰低深度治理币。',
      '回放 liquidation 事件并计算链上退出深度。',
    ],
    rejectIf: '坏账/预言机/低深度资产占主要收益来源。',
    sources: [sources[10].url],
  },
  {
    rank: 11,
    tier: 'C',
    id: 'event-driven-dex-backrun',
    strategy: '事件驱动 DEX backrun / 跨池套利',
    model: '只在大额 swap、清算卖压、oracle 更新后计算负环，不做周期轮询。',
    pureOnchain: true,
    walletOnly: true,
    atomicity: '可原子化',
    evidence: [
      `当前 Curve stable candidates=${compactNumber(curve.summary?.candidateCount ?? curve.candidateCount)} passing=0`,
      `Balancer candidates=${compactNumber(balancer.summary?.candidateCount ?? balancer.candidateCount)} passing=0`,
      `Uniswap V3 fee-tier candidates=${compactNumber(uniFee.summary?.candidateCount ?? uniFee.candidateCount)} passing=0`,
    ],
    status: '普通扫描已证明不适合作为主线，保留事件驱动版本。',
    whyPriority: '只有和清算/大额交易结合时才可能有边际，不能继续投入普通轮询。',
    backtestNext: [
      '监听大额 swap 和清算事件后 N 个区块内的价差收敛。',
      '按 path capacity 和 gas/bribe 过滤，不输出小额纸面利润。',
    ],
    rejectIf: '不含明确事件触发、只靠定时轮询发现价差。',
    sources: [
      'https://developers.uniswap.org/docs/protocols/v3/guides/flash-swaps/final-contract',
      'https://docs.balancer.fi/concepts/vault/flash-loans.html',
      'https://docs.curve.finance/developer/amm/router/curve-router-ng',
    ],
  },
  {
    rank: 12,
    tier: 'Reject',
    id: 'lp-apy-market-making',
    strategy: 'LP 高 APY 做市',
    model: '提供流动性赚交易费/激励，不是套利。',
    pureOnchain: true,
    walletOnly: true,
    atomicity: '非原子套利',
    evidence: [
      '项目内有表面高 APY 池，但已有报告指出样本短、不是套利、无常损失不可忽略。',
    ],
    status: '从套利策略主线中排除，可另建做市策略模块。',
    whyPriority: '容易用漂亮 APY 误导用户，不符合这轮“找套利模型”的目标。',
    backtestNext: ['若以后做，需要完整 IL、区间再平衡、激励衰减回测。'],
    rejectIf: '任何时候都不应混入“纯套利 20%+”策略池。',
    sources: [],
  },
  {
    rank: 13,
    tier: 'Reject',
    id: 'cross-chain-non-atomic-arbitrage',
    strategy: '跨链非原子价差套利',
    model: '桥接资产跨链卖出，依赖桥时间、桥安全和价格变化。',
    pureOnchain: false,
    walletOnly: true,
    atomicity: '非原子',
    evidence: [
      '虽然可以只用钱包，但不是同一链上原子套利，风险模型完全不同。',
    ],
    status: '本轮排除。',
    whyPriority: '桥风险和时间风险会掩盖策略真实边际。',
    backtestNext: ['除非用户明确接受桥风险，否则不进入套利主线。'],
    rejectIf: '需要等待桥确认或中心化托管。',
    sources: [],
  },
  {
    rank: 14,
    tier: 'Reject',
    id: 'sandwich-or-user-harmful-mev',
    strategy: 'Sandwich / 对用户有害 MEV',
    model: '夹击用户交易获利。',
    pureOnchain: true,
    walletOnly: false,
    atomicity: '原子',
    evidence: ['可获利但不适合作为面向用户开放的产品策略。'],
    status: '伦理、合规和品牌风险太高，排除。',
    whyPriority: '不是要给用户做的自动化套利产品。',
    backtestNext: ['不做。'],
    rejectIf: '任何主动伤害普通用户成交价格的模型。',
    sources: [],
  },
];

const firstBatch = families
  .filter((family) => ['S', 'A'].includes(family.tier))
  .map((family) => family.id);

const output = {
  generatedAt,
  reportDate,
  scope: 'strategy-discovery-only',
  hardConclusion: {
    stableGuaranteed20ApyFound: false,
    liveReadyStrategies: 0,
    historicalPassingFamilyCount: 1,
    historicalPassingCandidateCount: overview.summary?.passingCount ?? overview.passingCount ?? null,
    note:
      '没有发现可以稳定保证 20%+ 年化、不过拟合且当前可直接开放给用户的纯链上套利模型。已找到可继续扩展回测的策略家族。',
  },
  currentProjectCounts: {
    familyCount: overview.summary?.familyCount ?? overview.familyCount ?? null,
    artifactCount: overview.summary?.artifactCount ?? overview.artifactCount ?? null,
    candidateCount: overview.summary?.candidateCount ?? overview.candidateCount ?? null,
    passingCount: overview.summary?.passingCount ?? overview.passingCount ?? null,
    liveReadyPassingCount:
      overview.summary?.liveReadyPassingCount ?? overview.liveReadyPassingCount ?? null,
    rankedRows: ranked.summary?.counts?.rows ?? ranked.counts?.rows ?? null,
    rankedProfitable: ranked.summary?.counts?.profitable ?? ranked.counts?.profitable ?? null,
    rankedOracleFailed: ranked.summary?.counts?.oracleFailed ?? ranked.counts?.oracleFailed ?? null,
  },
  firstBatch,
  families,
  sources,
};

function mdList(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

function familyTableRows() {
  return families
    .map((family) =>
      [
        family.rank,
        family.tier,
        family.strategy,
        family.atomicity,
        family.status,
        family.whyPriority,
      ]
        .map((value) => String(value).replaceAll('\n', ' '))
        .join(' | '),
    )
    .map((line) => `| ${line} |`)
    .join('\n');
}

function buildMarkdown() {
  const counts = output.currentProjectCounts;
  const firstBatchNames = families
    .filter((family) => firstBatch.includes(family.id))
    .map((family) => `${family.rank}. ${family.strategy}`)
    .join('\n');

  return `# 纯链上套利策略搜索图谱

生成日期：${reportDate}
项目目录：\`/home/bumblebee/Project/on-chain-arbitrage\`
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
| 策略族数量 | ${compactNumber(counts.familyCount)} |
| 产物数量 | ${compactNumber(counts.artifactCount)} |
| 候选数量 | ${compactNumber(counts.candidateCount)} |
| 历史过线数量 | ${compactNumber(counts.passingCount)} |
| 当前实盘可宣称数量 | ${compactNumber(counts.liveReadyPassingCount)} |
| 排序候选行数 | ${compactNumber(counts.rankedRows)} |
| 正收益但未过门槛 | ${compactNumber(counts.rankedProfitable)} |
| oracle 失败候选 | ${compactNumber(counts.rankedOracleFailed)} |

## 2. 策略优先级总表

| 排名 | 等级 | 策略 | 原子性/资金形态 | 当前状态 | 为什么这样排 |
|---:|---|---|---|---|---|
${familyTableRows()}

## 3. 第一批只做这些策略

${firstBatchNames}

这一批的共同点是：纯链上、无需 CEX、收益来源不是 LP 激励幻觉，而是清算折价、拍卖折价或 LLAMMA 结构性价差。

## 4. 逐策略回测要求

${families
  .map(
    (family) => `### ${family.rank}. ${family.strategy}（${family.tier}）

模型：${family.model}

当前证据：
${mdList(family.evidence)}

下一步回测：
${mdList(family.backtestNext)}

淘汰条件：${family.rejectIf}
`,
  )
  .join('\n')}

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

${sources.map((source) => `- ${source.name}: ${source.url}`).join('\n')}
`;
}

await mkdir(dataDir, { recursive: true });
await mkdir(docsDir, { recursive: true });

const outJson = resolve(dataDir, 'strategy-family-atlas.json');
const outMd = resolve(docsDir, `strategy-family-atlas-${reportSlugDate}.md`);

await writeFile(outJson, `${JSON.stringify(output, null, 2)}\n`);
await writeFile(outMd, buildMarkdown());

console.log(
  JSON.stringify(
    {
      generatedAt,
      outJson,
      outMd,
      familyCount: families.length,
      firstBatch,
      stableGuaranteed20ApyFound: false,
    },
    null,
    2,
  ),
);
