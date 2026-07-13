/**
 * Backtest V2 canonical types — the credible replay data layer.
 *
 * Per full-audit plan §2 (Phase 1): every event must carry block-level truth
 * (blockNumber/blockHash/timestamp/txHash/logIndex/receipt/effectiveGasPrice),
 * use event-block oracle prices (NEVER `prices/current`), fork-quote exit
 * routes, apply the full cost model, model competition, and produce
 * walk-forward + daily-NAV + capacity results.
 *
 * schemaVersion=2 on all artifacts produced by this layer.
 */

// ---------------------------------------------------------------------------
// Envelope — every artifact file starts with this provenance block.
// ---------------------------------------------------------------------------

export interface ArtifactEnvelope {
  schemaVersion: 2;
  artifactType: string;
  generatedAt: string; // ISO 8601
  codeCommit: string; // git SHA that generated this
  rpcSources: string[]; // RPC endpoint identifiers (e.g. 'alchemy-ethereum-mainnet')
  blockRange?: { from: number; to: number };
  coverageDays?: number;
  dataHash: string; // sha256 of the payload (post-generation, pre-envelope)
  caveats: string[];
}

// ---------------------------------------------------------------------------
// Event — a single historical liquidation/arbitrage opportunity, with full
// block-level provenance. Replaces V1's sparse candidate format.
// ---------------------------------------------------------------------------

export interface ChainEvent {
  // --- identity ---
  eventId: string; // deterministic: chainId:blockNumber:logIndex
  chainId: number;
  protocol: 'aave-v3' | 'morpho-blue' | 'compound-v3' | 'maker-clipper' | 'curve-llamma' | 'euler-v2' | 'dex-arb';
  strategyType: 'liquidation' | 'atomic-amm-arb' | 'backrun';

  // --- block-level truth (REQUIRED, never synthesized) ---
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number; // unix seconds, from block header
  txHash: string;
  logIndex: number;
  txIndex: number;

  // --- receipt-level truth ---
  effectiveGasPrice: string; // wei, decimal string
  gasUsed: number;
  gasCostWei: string; // effectiveGasPrice * gasUsed
  receiptStatus: 'success' | 'reverted';

  // --- protocol-specific payload ---
  protocolData: ProtocolEventData;

  // --- provenance ---
  rpcSource: string;
  fetchedAt: string; // ISO 8601
}

export type ProtocolEventData =
  | AaveLiquidationData
  | MorphoLiquidationData
  | CompoundAbsorbData
  | MakerAuctionData
  | DexArbData;

export interface AaveLiquidationData {
  user: string;
  collateralAsset: string;
  debtAsset: string;
  debtToCover: string; // base units
  liquidatedCollateralAmount: string; // base units
  liquidator: string; // who actually executed
  // oracle prices AT EVENT BLOCK (not current)
  collateralPriceSource: string; // e.g. 'aave-priceOracle@block'
  collateralPriceUsd: string; // USD per unit, at blockTimestamp
  debtPriceUsd: string;
  liquidationBonusBps: number; // protocol param, e.g. 10500 = 5% bonus
  protocolFeeBps: number;
}

export interface MorphoLiquidationData {
  market: string;
  borrower: string;
  collateralAsset: string;
  loanAsset: string;
  oracleType: 'chainlink' | 'custom' | 'unknown';
  seizureAmount: string;
  repayAmount: string;
  liquidator: string;
}

export interface CompoundAbsorbData {
  comet: string;
  absorber: string;
  assetAbsorbed: string;
  collateralAbsorbed: string;
  quotePriceUsd: string;
}

export interface MakerAuctionData {
  ilk: string;
  auctionId: number;
  kickBlock: number;
  takeBlock: number;
  tab: string; // DAI owed
  lot: string; // collateral
  price: string; // auction price at take
}

export interface DexArbData {
  route: string[]; // pool addresses
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  pools: string[];
}

// ---------------------------------------------------------------------------
// Exit route quote — the proceeds of unwinding the collateral, quoted ON THE
// EVENT BLOCK via fork simulation (not spot/current).
// ---------------------------------------------------------------------------

export interface ExitRouteQuote {
  eventId: string;
  method: 'uniswap-v3-quoter' | 'fork-sim' | 'curve-exchange' | 'direct-sell';
  blockNumber: number;
  inputAsset: string;
  inputAmount: string; // base units
  outputAsset: string; // typically a stablecoin
  outputAmount: string; // base units
  priceImpactBps: number;
  dexFeesBps: number;
  quoteAgeBlocks: number; // how many blocks between event and quote (should be 0)
  rpcSource: string;
}

// ---------------------------------------------------------------------------
// Unified cost model — all costs in USD for comparability.
// ---------------------------------------------------------------------------

export interface CostBreakdownV2 {
  flashLoanPremium: number; // USD
  protocolFee: number; // USD (e.g. Aave liquidation fee)
  dexFees: number; // USD
  slippage: number; // USD (price impact on exit route)
  gasCost: number; // USD (effectiveGasPrice * gasUsed * ethPrice)
  builderTip: number; // USD (bribe)
  failureReserve: number; // USD (expected cost of failed attempts)
  inventoryHaircut: number; // USD (haircut for holding collateral before exit)
  total: number; // sum of above
}

// ---------------------------------------------------------------------------
// Competition model — how many liquidators competed, who won, capture rate.
// ---------------------------------------------------------------------------

export interface CompetitionData {
  eventId: string;
  blockNumber: number;
  sameBlockCompetitors: number; // other liquidation txs for same user in same block
  winnerAddress: string; // who captured it
  winnerTxHash: string;
  // capture rate model: P(we win | N competitors). 1/N for naive, tunable.
  estimatedCaptureRate: number; // 0..1
  competitorAddresses: string[];
}

// ---------------------------------------------------------------------------
// Per-event net profit — the executable result.
// ---------------------------------------------------------------------------

export interface EventNetProfit {
  eventId: string;
  grossProceeds: number; // USD from exit route quote
  debtRepay: number; // USD
  costs: CostBreakdownV2;
  netProfit: number; // grossProceeds - debtRepay - costs.total
  netProfitUsd: number;
  capitalRequired: number; // USD (debt to cover or collateral to buy)
  returnOnCapital: number; // netProfit / capitalRequired
}

// ---------------------------------------------------------------------------
// Capacity curve — net APY at different capital sizes.
// ---------------------------------------------------------------------------

export interface CapacityPoint {
  capitalUsd: number;
  netProfitUsd: number;
  estimatedApy: number; // annualized
  slippageAdjusted: boolean;
}

export interface CapacityCurve {
  eventId?: string; // per-event, or undefined for aggregate
  points: CapacityPoint[];
}

// ---------------------------------------------------------------------------
// Walk-forward split — train/validation/test, test never used for param tuning.
// ---------------------------------------------------------------------------

export interface WalkForwardSplit {
  trainEvents: string[]; // event IDs
  validationEvents: string[];
  testEvents: string[];
  trainDays: number;
  testDays: number;
  method: 'chronological-70-15-15' | 'rolling-30d-train-7d-test';
}

// ---------------------------------------------------------------------------
// Daily NAV — replaces linear annualization with day-by-day equity curve.
// ---------------------------------------------------------------------------

export interface DailyNavPoint {
  date: string; // YYYY-MM-DD
  deployedCapital: number; // USD time-weighted
  realizedNetProfit: number; // USD
  cumulativeNav: number; // running total
  eventCount: number;
}

export interface PeriodMetrics {
  realizedApy: number;
  captureAdjustedApy: number; // at 10%/25%/50% capture
  capacityAdjustedApy: number;
  stressedApy: number; // +50% costs
  rolling30dApy: number | null;
  rolling90dApy: number | null;
  maxDrawdown: number;
  longestLossStreakDays: number;
  bootstrapCILower95: number; // 95% CI lower bound
  positiveMonthsPct: number;
  maxSingleEventContributionPct: number;
}

// ---------------------------------------------------------------------------
// Full replay result — one artifact per (strategy, chain, scenario).
// ---------------------------------------------------------------------------

export interface ReplayResult {
  envelope: ArtifactEnvelope;
  strategyId: string;
  chainId: number;
  scenario: 'base' | 'stress' | 'capture-10' | 'capture-25' | 'capture-50' | 'capacity';
  events: EventNetProfit[];
  dailyNav: DailyNavPoint[];
  capacityCurve: CapacityCurve;
  metrics: PeriodMetrics;
  walkForward?: WalkForwardSplit;
}
