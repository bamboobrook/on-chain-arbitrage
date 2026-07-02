/**
 * @oal/sdk types — canonical TypeScript types mirroring the Rust cores
 * (crates/strategy-core/src/types.rs) and docs/model-interface.md.
 *
 * Amounts are decimal strings to preserve precision across the wire.
 */

export type Address = `0x${string}`;
export type Hash = `0x${string}`;
export type Amount = string;

export type DexId =
  | 'uniswap-v2' | 'uniswap-v3' | 'uniswap-v4'
  | 'curve' | 'balancer'
  | 'aerodrome' | 'velodrome' | 'camelot' | 'maverick' | 'other';

export type PoolKind = 'v2' | 'v3' | 'stable' | 'weighted';

export type CapitalMode = 'flash-loan' | 'vault-capital' | 'inventory';
export type RiskClass = 'low' | 'medium' | 'high' | 'experimental';

export interface PoolRef {
  chainId: number;
  address: Address;
  dex: DexId;
  kind: PoolKind;
  token0: Address;
  token1: Address;
  feeBps: number;
  tickSpacing?: number;
  extra?: Record<string, unknown>;
}

export interface Hop {
  pool: PoolRef;
  tokenIn: Address;
  tokenOut: Address;
  zeroForOne: boolean;
}

export interface Route {
  hops: Hop[];
}

export type RiskFlag =
  | 'long-tail-token' | 'thin-liquidity' | 'fee-on-transfer'
  | 'rebasing' | 'blacklistable' | 'high-slippage' | 'stale-state';

export type OpportunityStatus =
  | 'discovered' | 'quoted' | 'simulated' | 'approved' | 'rejected' | 'expired' | 'executed';

export interface Opportunity {
  id: string;
  strategyId: string;
  chainId: number;
  blockNumber: number;
  assetIn: Address;
  capitalRequired: Amount;
  expectedProfit: Amount;
  expectedGas: number;
  expectedBribe: Amount;
  netProfit: Amount;
  route: Route;
  confidence: number;
  ttlBlocks: number;
  riskFlags: RiskFlag[];
  status: OpportunityStatus;
}

export interface CostBreakdown {
  gas: Amount;
  bribe: Amount;
  fee: Amount;
}

export interface Quote {
  amountIn: Amount;
  amountOut: Amount;
  minAmountOut: Amount;
  priceImpactBps: number;
  liquidityUsed: Amount;
  gas: number;
  costBreakdown: CostBreakdown;
}

export type CapitalSource =
  | 'vault-capital' | 'flash-loan-aave' | 'flash-loan-balancer'
  | 'flash-swap-uniswap-v2' | 'flash-swap-uniswap-v3';

export interface Capital {
  source: CapitalSource;
  amount: Amount;
  premium: Amount;
}

export interface ExecutionPlan {
  opportunityId: string;
  chainId: number;
  route: Route;
  capital: Capital;
  minProfitAssets: Amount;
  deadline: number;
  maxGasCost: Amount;
}

export interface BalanceDelta {
  token: Address;
  delta: Amount;
  positive: boolean;
}

export interface SimulationResult {
  success: boolean;
  chainId: number;
  blockNumber: number;
  gasUsed: number;
  balanceDeltas: BalanceDelta[];
  netProfit: Amount;
  failureReason?: string;
  traceUri?: string;
}

export interface StrategyScore {
  netProfit: Amount;
  score: number;
  confidence: number;
  capacityFit: number;
  riskAdjustedReturn: number;
}

export interface MarketContext {
  chainId: number;
  blockNumber: number;
  blockTimestamp: number;
  assets: Address[];
  pools: PoolRef[];
}

// ---------------------------------------------------------------------------
// API DTOs
// ---------------------------------------------------------------------------

export interface StrategyDTO {
  id: string;
  name: string;
  version: string;
  modelType: string;
  riskClass: RiskClass;
  status: 'active' | 'paused' | 'retired';
}

export interface VaultDTO {
  id: string;
  chainId: number;
  address: Address;
  assetAddress: Address;
  strategyId: string;
  status: 'active' | 'paused' | 'withdrawal-only';
  tvl: Amount;
  sharePrice: number;
}

export interface BacktestRunDTO {
  id: string;
  strategyId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  chainId: number;
  asset: Address;
  startBlock: number;
  endBlock: number;
  capital: Amount;
  costModel: CostModelParams;
  metrics?: BacktestMetrics;
  artifactUri?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface CostModelParams {
  gasStressPct?: number;
  bribeStressPct?: number;
  inclusionRate?: number;
}

export interface BacktestMetrics {
  totalNetProfit: Amount;
  tradeCount: number;
  winningTrades: number;
  winRate: number;
  maxDrawdown: number;
  annualizedReturnPct: number;
  sharpe: number;
  equityCurve: { block: number; equity: Amount }[];
  dailyPnl: { day: string; pnl: Amount }[];
}

export interface ExecutionDTO {
  id: string;
  opportunityId?: string;
  vaultId?: string;
  chainId: number;
  txHash?: Hash;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed' | 'expired';
  grossProfit: Amount;
  gasCost: Amount;
  bribeCost: Amount;
  netProfit: Amount;
  blockNumber?: number;
  createdAt: string;
  confirmedAt?: string;
}

export interface RiskEventDTO {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  scope: string;
  scopeId?: string;
  message: string;
  createdAt: string;
}
