'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../providers';
import { ASSETS } from '@oal/config';
import { Disclaimer } from '@oal/ui';

interface Candidate {
  id: string;
  chain: string;
  project: string;
  symbol: string;
  classification: string;
  isPureArbitrage: boolean;
  apyBase: number | null;
  apyBase7d: number | null;
  apyMean30d: number | null;
  tvlUsd: number | null;
  liveInterfaceStatus: string;
}

interface ExecutionPlan {
  id: string;
  candidateId: string;
  generatedAt: string;
  mode: string;
  status: string;
  chainId: number | null;
  chain: string;
  protocol: string;
  adapter: string;
  strategyId: string;
  capital: string;
  targetContract: {
    role: string;
    address: string | null;
    verification: string;
  };
  approvals: Array<{
    token: string;
    spender: string | null;
    amount: string;
    reason: string;
  }>;
  transactions: Array<{
    label: string;
    to: string | null;
    value: string;
    method: string;
    selector: string | null;
    calldataStatus: string;
    calldata?: string | null;
    calldataBytes?: number | null;
    params: Record<string, unknown>;
    notes: string[];
  }>;
  riskLimits: Array<{
    key: string;
    value: string | number;
    unit?: string;
  }>;
  preflightChecks: string[];
  blockedBy: string[];
  evidence: {
    source: string;
    poolId: string;
    apyBase: number | null;
    apyBase7d: number | null;
    apyMean30d: number | null;
    tvlUsd: number | null;
    isPureArbitrage: boolean;
  };
  warnings: string[];
}

interface LiveRun {
  id: string;
  candidate_id: string;
  strategy_id: string;
  status: string;
  chain_id: number | null;
  wallet_address: string | null;
  capital: string;
  blocked_by: string[];
  last_error: string | null;
  latest_preflight?: PreflightReport | null;
  latest_fork_simulation?: ForkSimulationResult | null;
  event_replay_evidence?: CandidateEventReplayArtifact | null;
  readiness?: LiveRunReadiness | null;
}

interface LiveRunReadiness {
  status: string;
  generatedAt: string;
  gates: Array<{
    key: string;
    status: string;
    message: string;
  }>;
  blockers: string[];
}

interface ForkSimulationResult {
  runId: string;
  status: string;
  exitCode: number | null;
  summary: string | null;
  details?: ForkSimulationDetails;
  stdout: string;
  stderr: string;
}

interface ForkSimulationDetails {
  forkSimulation?: string;
  reason?: string;
  planStatus?: string;
  strategyType?: string;
  candidateId?: string;
  blockers?: string[];
  requirements?: string[];
}

interface CandidateEventReplayArtifact {
  generatedAt: string;
  candidateId: string;
  source: {
    chain?: string;
    rpcEnvVar?: string;
    poolAddress?: string;
  };
  methodology: {
    classification?: string;
    capitalUsd?: number;
    rangeWidthTicks?: number;
    minReplayDaysForGate?: number;
    minSwapCountForGate?: number;
    caveats?: string[];
  };
  window: {
    fromBlock: number;
    toBlock: number;
    startTimestamp: string;
    endTimestamp: string;
    durationDays: number;
    swapCount: number;
  };
  position: {
    tickLower?: number;
    tickUpper?: number;
    startPriceToken1PerToken0?: number;
    endPriceToken1PerToken0?: number;
    priceChangePct?: number;
    investedUsd?: number;
  };
  fees: {
    inRangeSwaps?: number;
    inRangeSwapPct?: number;
    positionFeeUsdAtEndPrice?: number;
  };
  metrics: {
    grossFeeApyPct?: number | null;
    ilApyPct?: number | null;
    gasApyPct?: number | null;
    netPnlUsd?: number | null;
    netApyPct?: number | null;
  };
  gate: {
    status: string;
    evidenceStatus: string;
    minNetApyPct?: number;
    reason?: string;
  };
}

interface DexArbitrageArtifact {
  generatedAt: string;
  summary: {
    artifactCount?: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  methodology: {
    caveats?: string[];
  };
  candidates: DexArbitrageCandidate[];
}

interface AaveLiquidationArtifact {
  generatedAt: string;
  summary: {
    artifactCount?: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  candidates: AaveLiquidationCandidate[];
}

interface CompoundV3LiquidationArtifact {
  generatedAt: string;
  summary: {
    artifactCount?: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  candidates: CompoundV3LiquidationCandidate[];
}

interface MorphoBlueLiquidationArtifact {
  generatedAt: string;
  summary: {
    artifactCount?: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  candidates: MorphoBlueLiquidationCandidate[];
}

interface MorphoBlueLiquidationWatchlist {
  generatedAt: string;
  summary: {
    historicallyStableMarketCount: number;
    watchCandidateCount: number;
    liquidatableCount: number;
    nearLiquidationCount: number;
    watchCount: number;
    passingCurrentProfitabilityCount: number;
    requestedPassingCount: number;
    liveExecutionStatus: string;
    status: string;
  };
  watchlist: MorphoBlueLiquidationWatchlistItem[];
}

interface AaveLiquidationWatchlist {
  generatedAt: string;
  summary: {
    historicallyStablePairCount: number;
    watchCandidateCount: number;
    liquidatableCount: number;
    nearLiquidationCount: number;
    watchCount: number;
    passingCurrentProfitabilityCount: number;
    requestedPassingCount: number;
    liveExecutionStatus: string;
    status: string;
  };
  watchlist: AaveLiquidationWatchlistItem[];
}

interface AaveLiquidationWatchlistItem {
  id: string;
  currentCandidateId?: string;
  bestEstimateMatchesHistoricalPair?: boolean;
  chain: string;
  strategyType: string;
  user: string;
  symbols?: {
    debt?: string;
    collateral?: string;
  };
  currentState?: {
    riskCategory: string;
    healthFactor: number | null;
    debtToCoverUsd: number | null;
    netProfitUsd: number | null;
    returnOnDebtPct: number | null;
  };
  profitability?: {
    gate: {
      status: string;
      reason: string;
    };
    bestEstimate?: {
      debtSymbol: string;
      collateralSymbol: string;
      debtToCoverUsd: number;
      netProfitUsd: number;
      returnOnDebtPct: number;
      gasUsd: number;
    } | null;
  };
  historicalPair?: {
    pairKey: string;
    debtSymbol: string;
    collateralSymbol: string;
    sampleCount: number;
    maxAnnualizedNetReturnPct: number;
    maxWinRatePct: number;
    maxMedianNetProfitUsd: number;
    exampleCandidateId?: string;
  };
  liveInterface?: {
    status: string;
    reason: string;
    nextRequiredGate?: string;
  };
}

interface MorphoBlueLiquidationWatchlistItem {
  id: string;
  chain: string;
  strategyType: string;
  user: string;
  marketId: string;
  symbols?: {
    loan?: string;
    collateral?: string;
  };
  currentState?: {
    riskCategory: string;
    ltv: number;
    lltv: number;
    liquidatable: boolean;
    liquidationGapUsd: number;
    distanceToLiquidationPct: number;
    borrowUsd: number;
    collateralUsd: number;
  };
  profitability?: {
    gate: {
      status: string;
      reason: string;
      minNetProfitUsd?: number;
      minReturnOnRepayPct?: number;
    };
    bestEstimate?: {
      loanSymbol: string;
      collateralSymbol: string;
      repayUsd: number;
      netProfitUsd: number;
      returnOnRepayPct: number;
      gasUsd: number;
    } | null;
  };
  historicalMarket?: {
    marketId: string;
    chain: string;
    loanSymbol: string;
    collateralSymbol: string;
    eventCount: number;
    maxAnnualizedNetReturnPct: number;
    totalHistoricalNetProfitUsd: number;
    maxEventNetProfitUsd: number;
    replayWindowDays: number;
    exampleCandidateId?: string;
    exampleTransactionHash?: string;
  };
  liveInterface?: {
    status: string;
    reason: string;
    nextRequiredGate?: string;
  };
}

interface PureArbitrageOverview {
  generatedAt: string;
  objective: {
    requestedPassingStrategies: number;
    minAnnualizedNetReturnPct: number;
    pureOnChainOnly: boolean;
    noCexRequired: boolean;
  };
  summary: {
    familyCount: number;
    artifactCount: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
    liveExecutionStatus: string;
    decision: string;
  };
  families: Array<{
    key: string;
    label: string;
    strategyClass: string;
    artifactCount: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
    endpoint: string;
    runCommand: string;
    topCandidates: Array<{
      id: string;
      chain: string;
      strategyType: string;
      gateStatus: string;
      gateReason: string;
      score: number | null;
    }>;
  }>;
  blockers: string[];
}

interface AaveLiquidationCandidate {
  id: string;
  chain: string;
  strategyType: string;
  user: string;
  account?: {
    healthFactor: number;
    totalDebtBase: string;
    totalCollateralBase: string;
  };
  bestEstimate?: {
    debtSymbol: string;
    collateralSymbol: string;
    netProfitUsd: number;
    returnOnDebtPct: number;
    gasUsd: number;
  } | null;
  gate: {
    status: string;
    reason: string;
  };
}

interface CompoundV3LiquidationCandidate {
  id: string;
  chain: string;
  strategyType: string;
  user: string;
  account?: {
    isLiquidatable: boolean;
    borrowBalanceHuman: string;
    collateralCount: number;
  };
  bestEstimate?: {
    baseSymbol: string;
    collateralSymbol: string;
    baseAmountHuman: string;
    quotedCollateralHuman: string;
    netProfitUsd: number;
    returnOnBasePct: number;
    gasUsd: number;
  } | null;
  gate: {
    status: string;
    reason: string;
  };
}

interface MorphoBlueLiquidationCandidate {
  id: string;
  chain: string;
  strategyType: string;
  user: string;
  marketId: string;
  account?: {
    borrowAssetsUsd: number;
    collateralUsd: number;
    ltv: number;
    lltv: number;
    liquidatable: boolean;
  };
  bestEstimate?: {
    loanSymbol: string;
    collateralSymbol: string;
    repayUsd: number;
    netProfitUsd: number;
    returnOnRepayPct: number;
    gasUsd: number;
  } | null;
  gate: {
    status: string;
    reason: string;
  };
}

interface DexArbitrageCandidate {
  id: string;
  chain: string;
  strategyType: string;
  isPureArbitrage: boolean;
  startToken: { symbol: string; address: string; decimals: number };
  midToken: { symbol: string; address: string; decimals: number };
  thirdToken?: { symbol: string; address: string; decimals: number };
  tokenPath?: string[];
  buyDex: string;
  sellDex: string;
  dexPath?: string[];
  amountInHuman: string;
  metrics: {
    sampleCount?: number;
    attemptedSamples?: number;
    netWinRatePct?: number;
    meanAnnualizedNetReturnPct?: number;
    medianNetProfitUsd?: number;
    netProfitUsd?: { mean?: number | null; median?: number | null };
    annualizedNetReturnPct?: { mean?: number | null; median?: number | null };
  };
  gate: {
    status: string;
    reason: string;
  };
  liveInterface: {
    status?: string;
    productionStatus?: string;
  };
}

interface AaveLiquidationExecutionPlan {
  id: string;
  candidateId: string;
  generatedAt: string;
  mode: string;
  status: string;
  strategyId: string;
  chainId: number | null;
  chain: string;
  strategyType: string;
  capital: string;
  borrower: string;
  liquidation: {
    pool: string | null;
    debtAsset: string | null;
    debtSymbol: string | null;
    collateralAsset: string | null;
    collateralSymbol: string | null;
    debtToCoverUsd: number | null;
    receiveAToken: boolean;
    liquidationCallSelector: string;
  };
  executor: {
    role: string;
    address: string | null;
    verification: string;
  };
  approvals: Array<{
    token: string;
    spender: string | null;
    amount: string;
    reason: string;
  }>;
  transactions: Array<{
    label: string;
    to: string | null;
    value: string;
    method: string;
    selector: string | null;
    calldataStatus: string;
    calldata?: string | null;
    calldataBytes?: number | null;
    params: Record<string, unknown>;
    notes: string[];
  }>;
  riskLimits: Array<{
    key: string;
    value: string | number;
    unit?: string;
  }>;
  preflightChecks: string[];
  forkSimulation: {
    required: boolean;
    status: string;
    requirements: string[];
  };
  blockedBy: string[];
  evidence: {
    isPureArbitrage: boolean;
    gate: AaveLiquidationCandidate['gate'];
    healthFactor: number | null;
    bestEstimate: AaveLiquidationCandidate['bestEstimate'] | null;
  };
  warnings: string[];
}

interface CompoundV3LiquidationExecutionPlan {
  id: string;
  candidateId: string;
  generatedAt: string;
  mode: string;
  status: string;
  strategyId: string;
  chainId: number | null;
  chain: string;
  strategyType: string;
  capital: string;
  borrower: string;
  liquidation: {
    comet: string | null;
    baseAsset: string | null;
    baseSymbol: string | null;
    collateralAsset: string | null;
    collateralSymbol: string | null;
    baseAmount: string | null;
    baseAmountHuman: string | null;
    quotedCollateral: string | null;
    quotedCollateralHuman: string | null;
    absorbSelector: string;
    buyCollateralSelector: string;
  };
  executor: {
    role: string;
    address: string | null;
    verification: string;
  };
  approvals: Array<{
    token: string;
    spender: string | null;
    amount: string;
    reason: string;
  }>;
  transactions: Array<{
    label: string;
    to: string | null;
    value: string;
    method: string;
    selector: string | null;
    calldataStatus: string;
    calldata?: string | null;
    calldataBytes?: number | null;
    params: Record<string, unknown>;
    notes: string[];
  }>;
  riskLimits: Array<{
    key: string;
    value: string | number;
    unit?: string;
  }>;
  preflightChecks: string[];
  forkSimulation: {
    required: boolean;
    status: string;
    requirements: string[];
  };
  blockedBy: string[];
  evidence: {
    isPureArbitrage: boolean;
    gate: CompoundV3LiquidationCandidate['gate'];
    isLiquidatable: boolean | null;
    borrowBalanceHuman: string | null;
    bestEstimate: CompoundV3LiquidationCandidate['bestEstimate'] | null;
  };
  warnings: string[];
}

interface MorphoBlueLiquidationExecutionPlan {
  id: string;
  candidateId: string;
  generatedAt: string;
  mode: string;
  status: string;
  strategyId: string;
  chainId: number | null;
  chain: string;
  strategyType: string;
  capital: string;
  borrower: string;
  liquidation: {
    morpho: string | null;
    marketId: string;
    marketParams: Record<string, string>;
    loanAsset: string | null;
    loanSymbol: string | null;
    collateralAsset: string | null;
    collateralSymbol: string | null;
    repayUsd: number | null;
    liquidationSelector: string;
  };
  executor: {
    role: string;
    address: string | null;
    verification: string;
  };
  approvals: Array<{
    token: string;
    spender: string | null;
    amount: string;
    reason: string;
  }>;
  transactions: Array<{
    label: string;
    to: string | null;
    value: string;
    method: string;
    selector: string | null;
    calldataStatus: string;
    calldata?: string | null;
    calldataBytes?: number | null;
    params: Record<string, unknown>;
    notes: string[];
  }>;
  riskLimits: Array<{
    key: string;
    value: string | number;
    unit?: string;
  }>;
  preflightChecks: string[];
  forkSimulation: {
    required: boolean;
    status: string;
    requirements: string[];
  };
  blockedBy: string[];
  evidence: {
    isPureArbitrage: boolean;
    gate: MorphoBlueLiquidationCandidate['gate'];
    liquidatable: boolean | null;
    ltv: number | null;
    lltv: number | null;
    bestEstimate: MorphoBlueLiquidationCandidate['bestEstimate'] | null;
  };
  warnings: string[];
}

interface DexArbitrageExecutionPlan {
  id: string;
  candidateId: string;
  generatedAt: string;
  mode: string;
  status: string;
  strategyId: string;
  chainId: number | null;
  chain: string;
  strategyType: string;
  capital: string;
  route: {
    tokenPath: string[];
    dexPath: string[];
    amountIn: string;
    amountInHuman: string;
  };
  executor: {
    role: string;
    address: string | null;
    verification: string;
  };
  requiredRouters: Array<{
    dex: string;
    address: string | null;
    verification: string;
  }>;
  requiredAdapters: Array<{
    dex: string;
    adapter: string;
    status: string;
  }>;
  approvals: Array<{
    token: string;
    spender: string | null;
    amount: string;
    reason: string;
  }>;
  transactions: Array<{
    label: string;
    to: string | null;
    value: string;
    method: string;
    selector: string | null;
    calldataStatus: string;
    calldata?: string | null;
    calldataBytes?: number | null;
    params: Record<string, unknown>;
    notes: string[];
  }>;
  riskLimits: Array<{
    key: string;
    value: string | number;
    unit?: string;
  }>;
  preflightChecks: string[];
  forkSimulation: {
    required: boolean;
    status: string;
    requirements: string[];
  };
  blockedBy: string[];
  evidence: {
    isPureArbitrage: boolean;
    gate: DexArbitrageCandidate['gate'];
    metrics: DexArbitrageCandidate['metrics'];
    sampleCount: number;
    attemptedSamples: number;
  };
  warnings: string[];
}

interface PreflightReport {
  status: string;
  checks: Array<{
    key: string;
    status: string;
    message: string;
  }>;
  quote: {
    status: string;
    capital: string;
    source?: string;
    prices?: Array<{
      coin: string;
      token: string;
      symbol: string;
      priceUsd: number;
      desiredAmount: string;
      minAmount: string;
      usdShare: number;
    }>;
    requiredInputs: string[];
    error?: string;
  };
  poolState: {
    status: string;
    protocol: string | null;
    poolAddress: string | null;
    fee: number | null;
    sqrtPriceX96?: string;
    tick?: number;
    liquidity?: string;
    rpcEnvVar?: string;
    requiredInputs: string[];
    error?: string;
  };
  mintPreview?: {
    status: string;
    protocol: string | null;
    selector: string | null;
    method: string | null;
    target: string | null;
    recipient: string | null;
    fee: number | null;
    tickSpacing: number | null;
    tickLower?: number;
    tickUpper?: number;
    deadline?: number;
    token0?: MintPreviewTokenAmount;
    token1?: MintPreviewTokenAmount;
    requiredInputs: string[];
    warnings: string[];
    error?: string;
  };
  transactionPreview?: {
    status: string;
    calls: TransactionPreviewCall[];
    requiredInputs: string[];
    warnings: string[];
    error?: string;
  };
  gasPreflight?: {
    status: string;
    wallet: string | null;
    rpcEnvVar?: string;
    calls: GasPreflightCall[];
    totalGasLimit?: string;
    gasPriceWei?: string;
    gasPriceHex?: string;
    gasPriceSource?: string;
    nativeTokenSymbol?: string;
    nativeTokenPriceUsd?: number;
    nativeTokenPriceSource?: string;
    estimatedCostUsd?: number;
    maxGasUsd?: number;
    maxGasOk?: boolean;
    costError?: string;
    requiredInputs: string[];
    warnings: string[];
    error?: string;
  };
  callSimulation?: {
    status: string;
    wallet: string | null;
    rpcEnvVar?: string;
    calls: CallSimulationResult[];
    requiredInputs: string[];
    warnings: string[];
    error?: string;
  };
  walletPreflight?: {
    status: string;
    wallet: string | null;
    spender: string | null;
    rpcEnvVar?: string;
    tokens: WalletPreflightToken[];
    requiredInputs: string[];
    warnings: string[];
    error?: string;
  };
  execution: {
    adapter: string | null;
    target: string | null;
    transactionCount: number;
    calldataReady: boolean;
    forkSimulationReady: boolean;
  };
  nextActions: string[];
  blockers: string[];
}

interface MintPreviewTokenAmount {
  token: string;
  symbol: string;
  decimals: number;
  decimalsSource: string;
  desiredAmount: string;
  minAmount: string;
  desiredBaseUnits: string;
  minBaseUnits: string;
}

interface TransactionPreviewCall {
  label: string;
  kind: string;
  to: string;
  value: string;
  selector: string;
  method: string;
  calldata: string;
  calldataBytes: number;
  params: Record<string, string | number | null>;
  warnings: string[];
}

interface GasPreflightCall {
  label: string;
  kind: string;
  to: string;
  selector: string;
  status: string;
  gasLimit?: string;
  gasLimitHex?: string;
  estimatedCostUsd?: number;
  error?: string;
  warnings: string[];
}

interface CallSimulationResult {
  label: string;
  kind: string;
  to: string;
  selector: string;
  status: string;
  returnBytes?: number;
  returnDataPreview?: string;
  error?: string;
  warnings: string[];
}

interface WalletPreflightToken {
  token: string;
  symbol: string;
  requiredBaseUnits: string;
  balanceBaseUnits?: string;
  allowanceBaseUnits?: string;
  balanceOk?: boolean;
  allowanceOk?: boolean;
  approvalRequiredBaseUnits?: string;
  errors: string[];
}

const CHAIN_ID: Record<string, number> = {
  Base: 8453,
  Arbitrum: 42161,
  Ethereum: 1,
  Optimism: 10,
  Polygon: 137,
  BNB: 56,
};

const CHAIN_HEX: Record<number, `0x${string}`> = {
  1: '0x1',
  8453: '0x2105',
  42161: '0xa4b1',
  10: '0xa',
  137: '0x89',
  56: '0x38',
};

interface WalletState {
  status: 'checking' | 'unavailable' | 'disconnected' | 'connecting' | 'connected';
  address: string | null;
  chainId: string | null;
  error: string | null;
}

export default function CandidatesPage() {
  const [capital, setCapital] = useState('10000000000');
  const [maxSlippageBps, setMaxSlippageBps] = useState('50');
  const [maxGasUsd, setMaxGasUsd] = useState('25');
  const [plan, setPlan] = useState<ExecutionPlan>();
  const [dexArbPlan, setDexArbPlan] = useState<DexArbitrageExecutionPlan>();
  const [liquidationPlan, setLiquidationPlan] = useState<AaveLiquidationExecutionPlan>();
  const [compoundLiquidationPlan, setCompoundLiquidationPlan] =
    useState<CompoundV3LiquidationExecutionPlan>();
  const [morphoLiquidationPlan, setMorphoLiquidationPlan] =
    useState<MorphoBlueLiquidationExecutionPlan>();
  const [liveRun, setLiveRun] = useState<LiveRun>();
  const [walletTx, setWalletTx] = useState<string>();
  const [wallet, setWallet] = useState<WalletState>({
    status: 'checking',
    address: null,
    chainId: null,
    error: null,
  });

  useEffect(() => {
    if (!window.ethereum) {
      setWallet({
        status: 'unavailable',
        address: null,
        chainId: null,
        error: 'No injected wallet found',
      });
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      try {
        const [accounts, chainId] = await Promise.all([
          window.ethereum?.request({ method: 'eth_accounts' }) as Promise<string[]>,
          window.ethereum?.request({ method: 'eth_chainId' }) as Promise<string>,
        ]);
        if (cancelled) return;
        const address = accounts?.[0] ?? null;
        setWallet({
          status: address ? 'connected' : 'disconnected',
          address,
          chainId: chainId ?? null,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setWallet({
          status: 'disconnected',
          address: null,
          chainId: null,
          error: (err as Error).message,
        });
      }
    };
    const handleAccountsChanged = (accounts: unknown) => {
      const next = Array.isArray(accounts) ? String(accounts[0] ?? '') : '';
      setWallet((current) => ({
        ...current,
        status: next ? 'connected' : 'disconnected',
        address: next || null,
        error: null,
      }));
    };
    const handleChainChanged = (chainId: unknown) => {
      setWallet((current) => ({
        ...current,
        chainId: typeof chainId === 'string' ? chainId : current.chainId,
      }));
    };
    const handleWalletConnected = (event: Event) => {
      const detail = (event as CustomEvent<{ address?: string; chainId?: string }>).detail;
      setWallet((current) => ({
        ...current,
        status: detail?.address ? 'connected' : current.status,
        address: detail?.address ?? current.address,
        chainId: detail?.chainId ?? current.chainId,
        error: null,
      }));
    };

    void refresh();
    window.ethereum.on?.('accountsChanged', handleAccountsChanged);
    window.ethereum.on?.('chainChanged', handleChainChanged);
    window.addEventListener('oal-wallet-connected', handleWalletConnected);

    return () => {
      cancelled = true;
      window.ethereum?.removeListener?.('accountsChanged', handleAccountsChanged);
      window.ethereum?.removeListener?.('chainChanged', handleChainChanged);
      window.removeEventListener('oal-wallet-connected', handleWalletConnected);
    };
  }, []);

  const connectWallet = async () => {
    setWallet((current) => ({ ...current, status: 'connecting', error: null }));
    try {
      const address = await requestWalletAddress();
      if (!address) throw new Error('No injected wallet found');
      const chainId = window.ethereum
        ? ((await window.ethereum.request({ method: 'eth_chainId' })) as string)
        : null;
      setWallet({ status: 'connected', address, chainId, error: null });
    } catch (err) {
      setWallet((current) => ({
        ...current,
        status: current.address ? 'connected' : 'disconnected',
        error: (err as Error).message,
      }));
    }
  };
  const [forkSimulation, setForkSimulation] = useState<ForkSimulationResult>();
  const { data, error, isLoading } = useQuery({
    queryKey: ['strategy-candidates'],
    queryFn: () => api<Candidate[]>('/api/strategy-candidates'),
  });
  const {
    data: pureOverview,
    error: pureOverviewError,
    isLoading: pureOverviewLoading,
  } = useQuery({
    queryKey: ['pure-arbitrage-overview'],
    queryFn: () => api<PureArbitrageOverview>('/api/pure-arbitrage/overview'),
    retry: false,
  });
  const {
    data: dexArbArtifact,
    error: dexArbError,
    isLoading: dexArbLoading,
  } = useQuery({
    queryKey: ['dex-arbitrage-candidates'],
    queryFn: () => api<DexArbitrageArtifact>('/api/dex-arbitrage-candidates/artifacts'),
    retry: false,
  });
  const {
    data: uniswapV3FeeArtifact,
    error: uniswapV3FeeError,
    isLoading: uniswapV3FeeLoading,
  } = useQuery({
    queryKey: ['uniswap-v3-fee-arbitrage-candidates'],
    queryFn: () => api<DexArbitrageArtifact>('/api/uniswap-v3-fee-arbitrage-candidates/artifacts'),
    retry: false,
  });
  const {
    data: curveStableArtifact,
    error: curveStableError,
    isLoading: curveStableLoading,
  } = useQuery({
    queryKey: ['curve-stable-arbitrage-candidates'],
    queryFn: () => api<DexArbitrageArtifact>('/api/curve-stable-arbitrage-candidates/artifacts'),
    retry: false,
  });
  const {
    data: balancerArtifact,
    error: balancerError,
    isLoading: balancerLoading,
  } = useQuery({
    queryKey: ['balancer-arbitrage-candidates'],
    queryFn: () => api<DexArbitrageArtifact>('/api/balancer-arbitrage-candidates/artifacts'),
    retry: false,
  });
  const {
    data: liquidationArtifact,
    error: liquidationError,
    isLoading: liquidationLoading,
  } = useQuery({
    queryKey: ['aave-liquidation-candidates'],
    queryFn: () => api<AaveLiquidationArtifact>('/api/aave-liquidation-candidates/artifacts'),
    retry: false,
  });
  const {
    data: liquidationReplayArtifact,
    error: liquidationReplayError,
    isLoading: liquidationReplayLoading,
  } = useQuery({
    queryKey: ['aave-liquidation-replay-candidates'],
    queryFn: () => api<AaveLiquidationArtifact>('/api/aave-liquidation-replay-candidates/artifacts'),
    retry: false,
  });
  const {
    data: aaveWatchlist,
    error: aaveWatchlistError,
    isLoading: aaveWatchlistLoading,
  } = useQuery({
    queryKey: ['aave-liquidation-watchlist'],
    queryFn: () => api<AaveLiquidationWatchlist>('/api/aave-liquidation-watchlist'),
    retry: false,
  });
  const {
    data: compoundLiquidationArtifact,
    error: compoundLiquidationError,
    isLoading: compoundLiquidationLoading,
  } = useQuery({
    queryKey: ['compound-v3-liquidation-candidates'],
    queryFn: () =>
      api<CompoundV3LiquidationArtifact>('/api/compound-v3-liquidation-candidates/artifacts'),
    retry: false,
  });
  const {
    data: morphoLiquidationArtifact,
    error: morphoLiquidationError,
    isLoading: morphoLiquidationLoading,
  } = useQuery({
    queryKey: ['morpho-blue-liquidation-candidates'],
    queryFn: () =>
      api<MorphoBlueLiquidationArtifact>('/api/morpho-blue-liquidation-candidates/artifacts'),
    retry: false,
  });
  const {
    data: morphoWatchlist,
    error: morphoWatchlistError,
    isLoading: morphoWatchlistLoading,
  } = useQuery({
    queryKey: ['morpho-blue-liquidation-watchlist'],
    queryFn: () => api<MorphoBlueLiquidationWatchlist>('/api/morpho-blue-liquidation-watchlist'),
    retry: false,
  });
  const createBacktest = useMutation({
    mutationFn: async (candidate: Candidate) => {
      const chainId = CHAIN_ID[candidate.chain] ?? 8453;
      const asset =
        ASSETS.find((a) => a.chainId === chainId && a.symbol === 'USDC') ??
        ASSETS.find((a) => a.symbol === 'USDC');
      if (!asset) throw new Error('USDC asset not configured');
      return api<{ id: string }>('/api/backtests', {
        method: 'POST',
        body: JSON.stringify({
          strategyId: candidate.classification.includes('lp')
            ? 'lp-market-making'
            : 'yield-rotator',
          chainId,
          asset: asset.address,
          startBlock: 0,
          endBlock: 0,
          capital,
          params: { candidateId: candidate.id },
          costModel: { evidenceSnapshot: true },
        }),
      });
    },
    onSuccess: (res) => {
      window.location.href = `/backtests/${res.id}`;
    },
  });
  const preparePlan = useMutation({
    mutationFn: async (candidate: Candidate) => {
      const walletAddress = await requestWalletAddress();
      return api<ExecutionPlan>(`/api/strategy-candidates/${candidate.id}/execution-plan`, {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          capital,
          maxSlippageBps: Number(maxSlippageBps),
          maxGasUsd: Number(maxGasUsd),
        }),
      });
    },
    onSuccess: (res) => setPlan(res),
  });
  const prepareDexArbPlan = useMutation({
    mutationFn: async (candidate: DexArbitrageCandidate) => {
      const walletAddress = await requestWalletAddress();
      return api<DexArbitrageExecutionPlan>(
        `/api/dex-arbitrage-candidates/${candidate.id}/execution-plan`,
        {
          method: 'POST',
          body: JSON.stringify({
            walletAddress,
            capital,
            maxSlippageBps: Number(maxSlippageBps),
            maxGasUsd: Number(maxGasUsd),
          }),
        },
      );
    },
    onSuccess: (res) => setDexArbPlan(res),
  });
  const startDexArbLiveRun = useMutation({
    mutationFn: async (candidate: DexArbitrageCandidate) => {
      const walletAddress = await requestWalletAddress();
      if (!walletAddress) throw new Error('Connect an injected wallet before creating a live run.');
      return api<LiveRun>(`/api/dex-arbitrage-candidates/${candidate.id}/live-runs`, {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          capital,
          maxSlippageBps: Number(maxSlippageBps),
          maxGasUsd: Number(maxGasUsd),
          autoStart: false,
        }),
      });
    },
    onSuccess: (res) => setLiveRun(res),
  });
  const prepareUniswapV3FeePlan = useMutation({
    mutationFn: async (candidate: DexArbitrageCandidate) => {
      const walletAddress = await requestWalletAddress();
      return api<DexArbitrageExecutionPlan>(
        `/api/uniswap-v3-fee-arbitrage-candidates/${candidate.id}/execution-plan`,
        {
          method: 'POST',
          body: JSON.stringify({
            walletAddress,
            capital,
            maxSlippageBps: Number(maxSlippageBps),
            maxGasUsd: Number(maxGasUsd),
          }),
        },
      );
    },
    onSuccess: (res) => setDexArbPlan(res),
  });
  const startUniswapV3FeeLiveRun = useMutation({
    mutationFn: async (candidate: DexArbitrageCandidate) => {
      const walletAddress = await requestWalletAddress();
      if (!walletAddress) throw new Error('Connect an injected wallet before creating a live run.');
      return api<LiveRun>(`/api/uniswap-v3-fee-arbitrage-candidates/${candidate.id}/live-runs`, {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          capital,
          maxSlippageBps: Number(maxSlippageBps),
          maxGasUsd: Number(maxGasUsd),
          autoStart: false,
        }),
      });
    },
    onSuccess: (res) => setLiveRun(res),
  });
  const prepareCurveStablePlan = useMutation({
    mutationFn: async (candidate: DexArbitrageCandidate) => {
      const walletAddress = await requestWalletAddress();
      return api<DexArbitrageExecutionPlan>(
        `/api/curve-stable-arbitrage-candidates/${candidate.id}/execution-plan`,
        {
          method: 'POST',
          body: JSON.stringify({
            walletAddress,
            capital,
            maxSlippageBps: Number(maxSlippageBps),
            maxGasUsd: Number(maxGasUsd),
          }),
        },
      );
    },
    onSuccess: (res) => setDexArbPlan(res),
  });
  const startCurveStableLiveRun = useMutation({
    mutationFn: async (candidate: DexArbitrageCandidate) => {
      const walletAddress = await requestWalletAddress();
      if (!walletAddress) throw new Error('Connect an injected wallet before creating a live run.');
      return api<LiveRun>(`/api/curve-stable-arbitrage-candidates/${candidate.id}/live-runs`, {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          capital,
          maxSlippageBps: Number(maxSlippageBps),
          maxGasUsd: Number(maxGasUsd),
          autoStart: false,
        }),
      });
    },
    onSuccess: (res) => setLiveRun(res),
  });
  const prepareBalancerPlan = useMutation({
    mutationFn: async (candidate: DexArbitrageCandidate) => {
      const walletAddress = await requestWalletAddress();
      return api<DexArbitrageExecutionPlan>(
        `/api/balancer-arbitrage-candidates/${candidate.id}/execution-plan`,
        {
          method: 'POST',
          body: JSON.stringify({
            walletAddress,
            capital,
            maxSlippageBps: Number(maxSlippageBps),
            maxGasUsd: Number(maxGasUsd),
          }),
        },
      );
    },
    onSuccess: (res) => setDexArbPlan(res),
  });
  const startBalancerLiveRun = useMutation({
    mutationFn: async (candidate: DexArbitrageCandidate) => {
      const walletAddress = await requestWalletAddress();
      if (!walletAddress) throw new Error('Connect an injected wallet before creating a live run.');
      return api<LiveRun>(`/api/balancer-arbitrage-candidates/${candidate.id}/live-runs`, {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          capital,
          maxSlippageBps: Number(maxSlippageBps),
          maxGasUsd: Number(maxGasUsd),
          autoStart: false,
        }),
      });
    },
    onSuccess: (res) => setLiveRun(res),
  });
  const prepareLiquidationPlan = useMutation({
    mutationFn: async (candidate: AaveLiquidationCandidate) => {
      const walletAddress = await requestWalletAddress();
      return api<AaveLiquidationExecutionPlan>(
        `/api/aave-liquidation-candidates/${candidate.id}/execution-plan`,
        {
          method: 'POST',
          body: JSON.stringify({
            walletAddress,
            capital,
            maxSlippageBps: Number(maxSlippageBps),
            maxGasUsd: Number(maxGasUsd),
          }),
        },
      );
    },
    onSuccess: (res) => setLiquidationPlan(res),
  });
  const startLiquidationLiveRun = useMutation({
    mutationFn: async (candidate: AaveLiquidationCandidate) => {
      const walletAddress = await requestWalletAddress();
      if (!walletAddress) throw new Error('Connect an injected wallet before creating a live run.');
      return api<LiveRun>(`/api/aave-liquidation-candidates/${candidate.id}/live-runs`, {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          capital,
          maxSlippageBps: Number(maxSlippageBps),
          maxGasUsd: Number(maxGasUsd),
          autoStart: false,
        }),
      });
    },
    onSuccess: (res) => setLiveRun(res),
  });
  const prepareLiquidationReplayPlan = useMutation({
    mutationFn: async (candidate: AaveLiquidationCandidate) => {
      const walletAddress = await requestWalletAddress();
      return api<AaveLiquidationExecutionPlan>(
        `/api/aave-liquidation-replay-candidates/${candidate.id}/execution-plan`,
        {
          method: 'POST',
          body: JSON.stringify({
            walletAddress,
            capital,
            maxSlippageBps: Number(maxSlippageBps),
            maxGasUsd: Number(maxGasUsd),
          }),
        },
      );
    },
    onSuccess: (res) => setLiquidationPlan(res),
  });
  const startLiquidationReplayLiveRun = useMutation({
    mutationFn: async (candidate: AaveLiquidationCandidate) => {
      const walletAddress = await requestWalletAddress();
      if (!walletAddress) throw new Error('Connect an injected wallet before creating a live run.');
      return api<LiveRun>(`/api/aave-liquidation-replay-candidates/${candidate.id}/live-runs`, {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          capital,
          maxSlippageBps: Number(maxSlippageBps),
          maxGasUsd: Number(maxGasUsd),
          autoStart: false,
        }),
      });
    },
    onSuccess: (res) => setLiveRun(res),
  });
  const prepareCompoundLiquidationPlan = useMutation({
    mutationFn: async (candidate: CompoundV3LiquidationCandidate) => {
      const walletAddress = await requestWalletAddress();
      return api<CompoundV3LiquidationExecutionPlan>(
        `/api/compound-v3-liquidation-candidates/${candidate.id}/execution-plan`,
        {
          method: 'POST',
          body: JSON.stringify({
            walletAddress,
            capital,
            maxSlippageBps: Number(maxSlippageBps),
            maxGasUsd: Number(maxGasUsd),
          }),
        },
      );
    },
    onSuccess: (res) => setCompoundLiquidationPlan(res),
  });
  const startCompoundLiquidationLiveRun = useMutation({
    mutationFn: async (candidate: CompoundV3LiquidationCandidate) => {
      const walletAddress = await requestWalletAddress();
      if (!walletAddress) throw new Error('Connect an injected wallet before creating a live run.');
      return api<LiveRun>(`/api/compound-v3-liquidation-candidates/${candidate.id}/live-runs`, {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          capital,
          maxSlippageBps: Number(maxSlippageBps),
          maxGasUsd: Number(maxGasUsd),
          autoStart: false,
        }),
      });
    },
    onSuccess: (res) => setLiveRun(res),
  });
  const prepareMorphoLiquidationPlan = useMutation({
    mutationFn: async (candidate: MorphoBlueLiquidationCandidate) => {
      const walletAddress = await requestWalletAddress();
      return api<MorphoBlueLiquidationExecutionPlan>(
        `/api/morpho-blue-liquidation-candidates/${candidate.id}/execution-plan`,
        {
          method: 'POST',
          body: JSON.stringify({
            walletAddress,
            capital,
            maxSlippageBps: Number(maxSlippageBps),
            maxGasUsd: Number(maxGasUsd),
          }),
        },
      );
    },
    onSuccess: (res) => setMorphoLiquidationPlan(res),
  });
  const startMorphoLiquidationLiveRun = useMutation({
    mutationFn: async (candidate: MorphoBlueLiquidationCandidate) => {
      const walletAddress = await requestWalletAddress();
      if (!walletAddress) throw new Error('Connect an injected wallet before creating a live run.');
      return api<LiveRun>(`/api/morpho-blue-liquidation-candidates/${candidate.id}/live-runs`, {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          capital,
          maxSlippageBps: Number(maxSlippageBps),
          maxGasUsd: Number(maxGasUsd),
          autoStart: false,
        }),
      });
    },
    onSuccess: (res) => setLiveRun(res),
  });
  const startLiveRun = useMutation({
    mutationFn: async (candidate: Candidate) => {
      const walletAddress = await requestWalletAddress();
      if (!walletAddress) throw new Error('Connect an injected wallet before creating a live run.');
      return api<LiveRun>(`/api/strategy-candidates/${candidate.id}/live-runs`, {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          capital,
          maxSlippageBps: Number(maxSlippageBps),
          maxGasUsd: Number(maxGasUsd),
          autoStart: true,
        }),
      });
    },
    onSuccess: (res) => setLiveRun(res),
  });
  const refreshLiveRun = useMutation({
    mutationFn: async (runId: string) => api<LiveRun>(`/api/live/runs/${runId}`),
    onSuccess: (res) => setLiveRun(res),
  });
  const rerunPreflight = useMutation({
    mutationFn: async (runId: string) =>
      api<LiveRun>(`/api/live/runs/${runId}/rerun-preflight`, { method: 'POST' }),
    onSuccess: (res) => setLiveRun(res),
  });
  const runForkSimulation = useMutation({
    mutationFn: async (runId: string) =>
      api<ForkSimulationResult>(`/api/live/runs/${runId}/fork-simulation`, { method: 'POST' }),
    onSuccess: (res) => setForkSimulation(res),
  });

  return (
    <div>
      <h1>20%+ On-Chain Candidates</h1>
      <p style={{ color: 'var(--text-dim)', lineHeight: 1.6 }}>
        These are DeFiLlama Yields candidates with observable 20%+ APY filters. They are not
        guaranteed and they are not pure arbitrage unless explicitly marked.
      </p>
      <Disclaimer />

      <WalletControl wallet={wallet} onConnect={connectWallet} />

      <PureArbitrageOverviewPanel
        overview={pureOverview}
        error={pureOverviewError as Error | null}
        isLoading={pureOverviewLoading}
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-row">
          <label>
            Capital for evidence backtest (base units)
            <input value={capital} onChange={(e) => setCapital(e.target.value)} />
          </label>
          <label>
            Max slippage (bps)
            <input value={maxSlippageBps} onChange={(e) => setMaxSlippageBps(e.target.value)} />
          </label>
          <label>
            Max gas (USD)
            <input value={maxGasUsd} onChange={(e) => setMaxGasUsd(e.target.value)} />
          </label>
        </div>
      </div>

      {isLoading && <div className="card">Loading candidates...</div>}
      {error && (
        <div className="card" style={{ color: 'var(--red)' }}>
          {(error as Error).message}
        </div>
      )}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Classification</th>
              <th>APY base</th>
              <th>7d</th>
              <th>30d mean</th>
              <th>TVL</th>
              <th>Interface</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.id}>
                <td>
                  <div>
                    {c.chain} · {c.project}
                  </div>
                  <div style={{ color: 'var(--text-dim)' }}>{c.symbol}</div>
                </td>
                <td>
                  <span className={`badge ${c.isPureArbitrage ? 'badge-active' : 'badge-paused'}`}>
                    {c.isPureArbitrage ? 'pure arbitrage' : c.classification}
                  </span>
                </td>
                <td>{fmt(c.apyBase)}%</td>
                <td>{fmt(c.apyBase7d)}%</td>
                <td>{fmt(c.apyMean30d)}%</td>
                <td>${Math.round(c.tvlUsd ?? 0).toLocaleString()}</td>
                <td>{c.liveInterfaceStatus}</td>
                <td>
                  <button
                    onClick={() => createBacktest.mutate(c)}
                    disabled={createBacktest.isPending}
                  >
                    Evidence backtest
                  </button>
                  <button
                    onClick={() => preparePlan.mutate(c)}
                    disabled={preparePlan.isPending}
                    style={{ marginLeft: 8 }}
                  >
                    Live plan
                  </button>
                  <button
                    onClick={() => startLiveRun.mutate(c)}
                    disabled={startLiveRun.isPending}
                    style={{ marginLeft: 8 }}
                  >
                    Start run
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DexArbitragePanel
        artifact={dexArbArtifact}
        error={dexArbError as Error | null}
        isLoading={dexArbLoading}
        title="Pure DEX arbitrage scan"
        description="Aggregated quote replay across Base, Arbitrum, Polygon, Ethereum, Optimism, and BNB DEX routes"
        loadingLabel="Loading DEX arbitrage scan..."
        caveatTitle="DEX scan caveats"
        onPreparePlan={(candidate) => prepareDexArbPlan.mutate(candidate)}
        preparingPlan={prepareDexArbPlan.isPending}
        onStartRun={(candidate) => startDexArbLiveRun.mutate(candidate)}
        startingRun={startDexArbLiveRun.isPending}
      />
      <DexArbitragePanel
        artifact={uniswapV3FeeArtifact}
        error={uniswapV3FeeError as Error | null}
        isLoading={uniswapV3FeeLoading}
        title="Uniswap V3 cross-fee arbitrage scan"
        description="Same token pair replay across Uniswap V3 fee tiers on Base, Arbitrum, Ethereum, Polygon, Optimism, and BNB"
        loadingLabel="Loading Uniswap V3 cross-fee arbitrage scan..."
        caveatTitle="Uniswap V3 fee scan caveats"
        onPreparePlan={(candidate) => prepareUniswapV3FeePlan.mutate(candidate)}
        preparingPlan={prepareUniswapV3FeePlan.isPending}
        onStartRun={(candidate) => startUniswapV3FeeLiveRun.mutate(candidate)}
        startingRun={startUniswapV3FeeLiveRun.isPending}
      />
      <DexArbitragePanel
        artifact={curveStableArtifact}
        error={curveStableError as Error | null}
        isLoading={curveStableLoading}
        title="Curve stable arbitrage scan"
        description="Ethereum Curve 3pool versus Uniswap V3 stablecoin quote replay"
        loadingLabel="Loading Curve stable arbitrage scan..."
        caveatTitle="Curve scan caveats"
        onPreparePlan={(candidate) => prepareCurveStablePlan.mutate(candidate)}
        preparingPlan={prepareCurveStablePlan.isPending}
        onStartRun={(candidate) => startCurveStableLiveRun.mutate(candidate)}
        startingRun={startCurveStableLiveRun.isPending}
      />
      <DexArbitragePanel
        artifact={balancerArtifact}
        error={balancerError as Error | null}
        isLoading={balancerLoading}
        title="Balancer arbitrage scan"
        description="Ethereum Balancer V2 Vault versus Uniswap V3 quote replay"
        loadingLabel="Loading Balancer arbitrage scan..."
        caveatTitle="Balancer scan caveats"
        onPreparePlan={(candidate) => prepareBalancerPlan.mutate(candidate)}
        preparingPlan={prepareBalancerPlan.isPending}
        onStartRun={(candidate) => startBalancerLiveRun.mutate(candidate)}
        startingRun={startBalancerLiveRun.isPending}
      />
      <AaveLiquidationPanel
        artifact={liquidationArtifact}
        error={liquidationError as Error | null}
        isLoading={liquidationLoading}
        title="Aave V3 liquidation current-state scan"
        description="Current borrower health-factor checks from recent debt-token activity"
        onPreparePlan={(candidate) => prepareLiquidationPlan.mutate(candidate)}
        preparingPlan={prepareLiquidationPlan.isPending}
        onStartRun={(candidate) => startLiquidationLiveRun.mutate(candidate)}
        startingRun={startLiquidationLiveRun.isPending}
      />
      <AaveLiquidationWatchlistPanel
        watchlist={aaveWatchlist}
        error={aaveWatchlistError as Error | null}
        isLoading={aaveWatchlistLoading}
        candidates={liquidationArtifact?.candidates ?? []}
        onPreparePlan={(candidate) => prepareLiquidationPlan.mutate(candidate)}
        preparingPlan={prepareLiquidationPlan.isPending}
        onStartRun={(candidate) => startLiquidationLiveRun.mutate(candidate)}
        startingRun={startLiquidationLiveRun.isPending}
      />
      <AaveLiquidationPanel
        artifact={liquidationReplayArtifact}
        error={liquidationReplayError as Error | null}
        isLoading={liquidationReplayLoading}
        title="Aave V3 liquidation event replay"
        description="Historical LiquidationCall replay grouped by debt/collateral pair"
        onPreparePlan={(candidate) => prepareLiquidationReplayPlan.mutate(candidate)}
        preparingPlan={prepareLiquidationReplayPlan.isPending}
        onStartRun={(candidate) => startLiquidationReplayLiveRun.mutate(candidate)}
        startingRun={startLiquidationReplayLiveRun.isPending}
      />
      <CompoundV3LiquidationPanel
        artifact={compoundLiquidationArtifact}
        error={compoundLiquidationError as Error | null}
        isLoading={compoundLiquidationLoading}
        onPreparePlan={(candidate) => prepareCompoundLiquidationPlan.mutate(candidate)}
        preparingPlan={prepareCompoundLiquidationPlan.isPending}
        onStartRun={(candidate) => startCompoundLiquidationLiveRun.mutate(candidate)}
        startingRun={startCompoundLiquidationLiveRun.isPending}
      />
      <MorphoBlueWatchlistPanel
        watchlist={morphoWatchlist}
        error={morphoWatchlistError as Error | null}
        isLoading={morphoWatchlistLoading}
        candidates={morphoLiquidationArtifact?.candidates ?? []}
        onPreparePlan={(candidate) => prepareMorphoLiquidationPlan.mutate(candidate)}
        preparingPlan={prepareMorphoLiquidationPlan.isPending}
        onStartRun={(candidate) => startMorphoLiquidationLiveRun.mutate(candidate)}
        startingRun={startMorphoLiquidationLiveRun.isPending}
      />
      <MorphoBlueLiquidationPanel
        artifact={morphoLiquidationArtifact}
        error={morphoLiquidationError as Error | null}
        isLoading={morphoLiquidationLoading}
        onPreparePlan={(candidate) => prepareMorphoLiquidationPlan.mutate(candidate)}
        preparingPlan={prepareMorphoLiquidationPlan.isPending}
        onStartRun={(candidate) => startMorphoLiquidationLiveRun.mutate(candidate)}
        startingRun={startMorphoLiquidationLiveRun.isPending}
      />
      {prepareDexArbPlan.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(prepareDexArbPlan.error as Error).message}
        </div>
      )}
      {startDexArbLiveRun.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(startDexArbLiveRun.error as Error).message}
        </div>
      )}
      {prepareUniswapV3FeePlan.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(prepareUniswapV3FeePlan.error as Error).message}
        </div>
      )}
      {startUniswapV3FeeLiveRun.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(startUniswapV3FeeLiveRun.error as Error).message}
        </div>
      )}
      {prepareCurveStablePlan.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(prepareCurveStablePlan.error as Error).message}
        </div>
      )}
      {startCurveStableLiveRun.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(startCurveStableLiveRun.error as Error).message}
        </div>
      )}
      {prepareBalancerPlan.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(prepareBalancerPlan.error as Error).message}
        </div>
      )}
      {startBalancerLiveRun.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(startBalancerLiveRun.error as Error).message}
        </div>
      )}
      {prepareLiquidationPlan.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(prepareLiquidationPlan.error as Error).message}
        </div>
      )}
      {startLiquidationLiveRun.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(startLiquidationLiveRun.error as Error).message}
        </div>
      )}
      {prepareLiquidationReplayPlan.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(prepareLiquidationReplayPlan.error as Error).message}
        </div>
      )}
      {startLiquidationReplayLiveRun.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(startLiquidationReplayLiveRun.error as Error).message}
        </div>
      )}
      {prepareCompoundLiquidationPlan.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(prepareCompoundLiquidationPlan.error as Error).message}
        </div>
      )}
      {startCompoundLiquidationLiveRun.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(startCompoundLiquidationLiveRun.error as Error).message}
        </div>
      )}
      {prepareMorphoLiquidationPlan.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(prepareMorphoLiquidationPlan.error as Error).message}
        </div>
      )}
      {startMorphoLiquidationLiveRun.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(startMorphoLiquidationLiveRun.error as Error).message}
        </div>
      )}
      {preparePlan.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(preparePlan.error as Error).message}
        </div>
      )}
      {startLiveRun.error && (
        <div className="card" style={{ color: 'var(--red)', marginTop: 16 }}>
          {(startLiveRun.error as Error).message}
        </div>
      )}
      {liveRun && (
        <LiveRunPanel
          run={liveRun}
          onRefresh={() => refreshLiveRun.mutate(liveRun.id)}
          onRerunPreflight={() => rerunPreflight.mutate(liveRun.id)}
          onForkSimulation={() => runForkSimulation.mutate(liveRun.id)}
          refreshing={refreshLiveRun.isPending}
          rerunning={rerunPreflight.isPending}
          forkSimulating={runForkSimulation.isPending}
          forkSimulation={forkSimulation}
          walletTx={walletTx}
          setWalletTx={setWalletTx}
        />
      )}
      {plan && <ExecutionPlanPanel plan={plan} />}
      {dexArbPlan && <DexArbitragePlanPanel plan={dexArbPlan} />}
      {liquidationPlan && <AaveLiquidationPlanPanel plan={liquidationPlan} />}
      {compoundLiquidationPlan && (
        <CompoundV3LiquidationPlanPanel plan={compoundLiquidationPlan} />
      )}
      {morphoLiquidationPlan && (
        <MorphoBlueLiquidationPlanPanel plan={morphoLiquidationPlan} />
      )}
    </div>
  );
}

function fmt(v: number | null): string {
  return v == null ? 'n/a' : v.toFixed(2);
}

function formatUsd(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? 'n/a' : `$${v.toFixed(4)}`;
}

function formatPct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? 'n/a' : `${v.toFixed(2)}%`;
}

function formatCalldataPreview(calldata: string | null | undefined): string {
  if (!calldata) return 'n/a';
  if (calldata.length <= 98) return calldata;
  return `${calldata.slice(0, 66)}...${calldata.slice(-24)}`;
}

function PureArbitrageOverviewPanel({
  overview,
  error,
  isLoading,
}: {
  overview?: PureArbitrageOverview;
  error: Error | null;
  isLoading: boolean;
}) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>Pure on-chain search overview</h3>
          <div style={{ color: 'var(--text-dim)' }}>
            Evidence gate for the requested wallet-only 20%+ arbitrage target
          </div>
        </div>
        {overview ? (
          <span
            className={`badge ${
              overview.summary.liveExecutionStatus === 'ready' ? 'badge-active' : 'badge-paused'
            }`}
          >
            {overview.summary.liveExecutionStatus}
          </span>
        ) : null}
      </div>

      {isLoading && <div style={{ marginTop: 12 }}>Loading pure arbitrage overview...</div>}
      {error && (
        <div style={{ color: 'var(--red)', marginTop: 12 }}>
          {error.message}
        </div>
      )}
      {overview && (
        <>
          <div className="grid grid-4" style={{ marginTop: 16 }}>
            <div>
              <div className="label">Families</div>
              <div>{overview.summary.familyCount}</div>
            </div>
            <div>
              <div className="label">Artifacts</div>
              <div>{overview.summary.artifactCount}</div>
            </div>
            <div>
              <div className="label">Candidates</div>
              <div>{overview.summary.candidateCount}</div>
            </div>
            <div>
              <div className="label">Passing target</div>
              <div>
                {overview.summary.passingCount} / {overview.summary.requestedPassingCount}
              </div>
              <div style={{ color: 'var(--text-dim)' }}>
                min {overview.objective.minAnnualizedNetReturnPct}% after gates
              </div>
            </div>
          </div>

          <div style={{ color: 'var(--text-dim)', marginTop: 12 }}>
            {overview.summary.decision}
          </div>

          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Search family</th>
                <th>Artifacts</th>
                <th>Candidates</th>
                <th>Passing</th>
                <th>Status</th>
                <th>Best seen</th>
              </tr>
            </thead>
            <tbody>
              {overview.families.map((family) => {
                const best = family.topCandidates[0];
                return (
                  <tr key={family.key}>
                    <td>
                      <div>{family.label}</div>
                      <div style={{ color: 'var(--text-dim)' }}>{family.strategyClass}</div>
                    </td>
                    <td>{family.artifactCount}</td>
                    <td>{family.candidateCount}</td>
                    <td>
                      {family.passingCount} / {family.requestedPassingCount}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          family.passingCount >= family.requestedPassingCount
                            ? 'badge-active'
                            : 'badge-paused'
                        }`}
                      >
                        {family.status}
                      </span>
                    </td>
                    <td>
                      {best ? (
                        <>
                          <div>{best.id}</div>
                          <div style={{ color: 'var(--text-dim)' }}>
                            {best.gateStatus}: {best.gateReason}
                          </div>
                        </>
                      ) : (
                        <span style={{ color: 'var(--text-dim)' }}>no artifact</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: 16 }}>
            <ListBlock title="Current blockers" items={overview.blockers} />
          </div>
        </>
      )}
    </div>
  );
}

function WalletControl({
  wallet,
  onConnect,
}: {
  wallet: WalletState;
  onConnect: () => void;
}) {
  const statusLabel =
    wallet.status === 'connected'
      ? 'connected'
      : wallet.status === 'connecting' || wallet.status === 'checking'
        ? 'checking'
        : wallet.status === 'unavailable'
          ? 'no wallet'
          : 'disconnected';
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>Wallet</h3>
          <div style={{ color: 'var(--text-dim)' }}>
            {wallet.address
              ? `${short(wallet.address)}${wallet.chainId ? ` on ${wallet.chainId}` : ''}`
              : wallet.status === 'unavailable'
                ? 'Install or unlock an injected wallet to create live runs'
                : 'Connect an injected wallet before creating live runs'}
          </div>
          {wallet.error && (
            <div style={{ color: 'var(--red)', marginTop: 8 }}>{wallet.error}</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            className={`badge ${wallet.status === 'connected' ? 'badge-active' : 'badge-paused'}`}
          >
            {statusLabel}
          </span>
          <button
            onClick={onConnect}
            disabled={wallet.status === 'connecting' || wallet.status === 'unavailable'}
          >
            {wallet.status === 'connected' ? 'Reconnect' : 'Connect wallet'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DexArbitragePanel({
  artifact,
  error,
  isLoading,
  title,
  description,
  loadingLabel,
  caveatTitle,
  onPreparePlan,
  preparingPlan,
  onStartRun,
  startingRun,
}: {
  artifact?: DexArbitrageArtifact;
  error: Error | null;
  isLoading: boolean;
  title: string;
  description: string;
  loadingLabel: string;
  caveatTitle: string;
  onPreparePlan: (candidate: DexArbitrageCandidate) => void;
  preparingPlan: boolean;
  onStartRun: (candidate: DexArbitrageCandidate) => void;
  startingRun: boolean;
}) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>{title}</h3>
          <div style={{ color: 'var(--text-dim)' }}>{description}</div>
        </div>
        {artifact ? (
          <span
            className={`badge ${
              artifact.summary.passingCount >= artifact.summary.requestedPassingCount
                ? 'badge-active'
                : 'badge-paused'
            }`}
          >
            {artifact.summary.passingCount}/{artifact.summary.requestedPassingCount} passing
          </span>
        ) : null}
      </div>
      {isLoading && <div style={{ marginTop: 12 }}>{loadingLabel}</div>}
      {error && (
        <div style={{ color: 'var(--red)', marginTop: 12 }}>
          {error.message}
        </div>
      )}
      {artifact && (
        <>
          <div className="grid grid-3" style={{ marginTop: 16 }}>
            <div>
              <div className="label">Status</div>
              <div>{artifact.summary.status}</div>
            </div>
            <div>
              <div className="label">Candidates</div>
              <div>{artifact.summary.candidateCount}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                {artifact.summary.artifactCount ?? 1} chain artifacts
              </div>
            </div>
            <div>
              <div className="label">Passing</div>
              <div>
                {artifact.summary.passingCount} / {artifact.summary.requestedPassingCount}
              </div>
              <div style={{ color: 'var(--text-dim)' }}>net of gas quote replay</div>
            </div>
          </div>
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Route</th>
                <th>Samples</th>
                <th>Win rate</th>
                <th>Annualized net</th>
                <th>Median net</th>
                <th>Gate</th>
                <th>Live interface</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {artifact.candidates.slice(0, 10).map((candidate) => (
                <tr key={candidate.id}>
                  <td>
                    <div>
                      {candidate.tokenPath?.join(' / ') ??
                        `${candidate.startToken.symbol} / ${candidate.midToken.symbol}`}
                    </div>
                    <div style={{ color: 'var(--text-dim)' }}>{candidate.strategyType}</div>
                  </td>
                  <td>
                    <div>
                      {candidate.dexPath?.join(' -> ') ??
                        `${candidate.buyDex} -> ${candidate.sellDex}`}
                    </div>
                    <div style={{ color: 'var(--text-dim)' }}>
                      input {candidate.amountInHuman} {candidate.startToken.symbol}
                    </div>
                  </td>
                  <td>
                    {candidate.metrics.sampleCount ?? 0}/{candidate.metrics.attemptedSamples ?? 0}
                  </td>
                  <td>{formatPct(candidate.metrics.netWinRatePct)}</td>
                  <td>
                    {formatPct(
                      candidate.metrics.meanAnnualizedNetReturnPct ??
                        candidate.metrics.annualizedNetReturnPct?.mean ??
                        null,
                    )}
                  </td>
                  <td>
                    {formatUsd(
                      candidate.metrics.medianNetProfitUsd ??
                        candidate.metrics.netProfitUsd?.median ??
                        null,
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        candidate.gate.status === 'pass' ? 'badge-active' : 'badge-paused'
                      }`}
                    >
                      {candidate.gate.status}
                    </span>
                    <div style={{ color: 'var(--text-dim)' }}>{candidate.gate.reason}</div>
                  </td>
                  <td>
                    <div>{candidate.liveInterface.status ?? 'not configured'}</div>
                    <div style={{ color: 'var(--text-dim)' }}>
                      {candidate.liveInterface.productionStatus ?? 'production blocked'}
                    </div>
                  </td>
                  <td>
                    <button onClick={() => onPreparePlan(candidate)} disabled={preparingPlan}>
                      Live plan
                    </button>
                    <button
                      onClick={() => onStartRun(candidate)}
                      disabled={startingRun}
                      title="Creates a blocked run request; execution remains dry-run until gates pass"
                      style={{ marginLeft: 8 }}
                    >
                      Create run request
                    </button>
                    <button
                      disabled
                      title={
                        candidate.gate.status === 'pass'
                          ? 'Fork simulation endpoint is not wired for DEX routes yet'
                          : 'Quote replay gate must pass before fork simulation'
                      }
                      style={{ marginLeft: 8 }}
                    >
                      Fork sim
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {artifact.methodology.caveats?.length ? (
            <div style={{ marginTop: 16 }}>
              <ListBlock title={caveatTitle} items={artifact.methodology.caveats} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function AaveLiquidationWatchlistPanel({
  watchlist,
  error,
  isLoading,
  candidates,
  onPreparePlan,
  preparingPlan,
  onStartRun,
  startingRun,
}: {
  watchlist?: AaveLiquidationWatchlist;
  error: Error | null;
  isLoading: boolean;
  candidates: AaveLiquidationCandidate[];
  onPreparePlan: (candidate: AaveLiquidationCandidate) => void;
  preparingPlan: boolean;
  onStartRun: (candidate: AaveLiquidationCandidate) => void;
  startingRun: boolean;
}) {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>Aave V3 liquidation watchlist</h3>
          <div style={{ color: 'var(--text-dim)' }}>
            Historical replay pairs mapped to current borrower health-factor gates
          </div>
        </div>
        {watchlist ? (
          <span
            className={`badge ${
              watchlist.summary.passingCurrentProfitabilityCount >=
              watchlist.summary.requestedPassingCount
                ? 'badge-active'
                : 'badge-paused'
            }`}
          >
            {watchlist.summary.passingCurrentProfitabilityCount}/
            {watchlist.summary.requestedPassingCount} current pass
          </span>
        ) : null}
      </div>
      {isLoading && <div style={{ marginTop: 12 }}>Loading Aave watchlist...</div>}
      {error && <div style={{ color: 'var(--red)', marginTop: 12 }}>{error.message}</div>}
      {watchlist && (
        <>
          <div className="grid grid-3" style={{ marginTop: 16 }}>
            <div>
              <div className="label">Status</div>
              <div>{watchlist.summary.status}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                live {watchlist.summary.liveExecutionStatus}
              </div>
            </div>
            <div>
              <div className="label">Current borrowers</div>
              <div>{watchlist.summary.watchCandidateCount}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                {watchlist.summary.liquidatableCount} liquidatable ·{' '}
                {watchlist.summary.nearLiquidationCount} near
              </div>
            </div>
            <div>
              <div className="label">Historical pairs</div>
              <div>{watchlist.summary.historicallyStablePairCount}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                {watchlist.summary.watchCount} active watch rows
              </div>
            </div>
          </div>
          {watchlist.watchlist.length === 0 ? (
            <div style={{ marginTop: 12, color: 'var(--text-dim)' }}>
              No Aave watchlist rows in the current artifact.
            </div>
          ) : (
            <table style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Pair</th>
                  <th>Health factor</th>
                  <th>Historical replay</th>
                  <th>Current net</th>
                  <th>Live gate</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {watchlist.watchlist.slice(0, 10).map((item) => {
                  const candidate =
                    item.bestEstimateMatchesHistoricalPair === true
                      ? candidateById.get(item.currentCandidateId ?? item.id)
                      : undefined;
                  const current = item.currentState;
                  const gate = item.profitability?.gate;
                  const estimate = item.profitability?.bestEstimate;
                  const historical = item.historicalPair;
                  const pair =
                    item.symbols?.debt && item.symbols?.collateral
                      ? `${item.symbols.debt} -> ${item.symbols.collateral}`
                      : historical
                        ? `${historical.debtSymbol} -> ${historical.collateralSymbol}`
                        : 'pair n/a';

                  return (
                    <tr key={item.id}>
                      <td>
                        <code>{short(item.user)}</code>
                        <div style={{ color: 'var(--text-dim)' }}>{item.strategyType}</div>
                      </td>
                      <td>{pair}</td>
                      <td>
                        <span
                          className={`badge ${
                            current?.riskCategory === 'liquidatable'
                              ? 'badge-active'
                              : 'badge-paused'
                          }`}
                        >
                          {current?.riskCategory ?? 'n/a'}
                        </span>
                        <div style={{ color: 'var(--text-dim)' }}>
                          HF {current?.healthFactor?.toFixed?.(6) ?? 'n/a'}
                        </div>
                      </td>
                      <td>
                        {formatPct(historical?.maxAnnualizedNetReturnPct)}
                        <div style={{ color: 'var(--text-dim)' }}>
                          {historical
                            ? `${historical.sampleCount} samples · win ${formatPct(
                                historical.maxWinRatePct,
                              )}`
                            : 'no replay evidence'}
                        </div>
                      </td>
                      <td>
                        {formatUsd(estimate?.netProfitUsd ?? current?.netProfitUsd)}
                        <div style={{ color: 'var(--text-dim)' }}>
                          return{' '}
                          {formatPct(estimate?.returnOnDebtPct ?? current?.returnOnDebtPct)} ·
                          debt {formatUsd(estimate?.debtToCoverUsd ?? current?.debtToCoverUsd)}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            gate?.status === 'pass' ? 'badge-active' : 'badge-paused'
                          }`}
                        >
                          {gate?.status ?? 'n/a'}
                        </span>
                        <div style={{ color: 'var(--text-dim)' }}>
                          {item.liveInterface?.nextRequiredGate ?? gate?.reason ?? 'n/a'}
                        </div>
                      </td>
                      <td>
                        <button
                          onClick={() => candidate && onPreparePlan(candidate)}
                          disabled={preparingPlan || !candidate}
                        >
                          Live plan
                        </button>
                        <button
                          onClick={() => candidate && onStartRun(candidate)}
                          disabled={startingRun || !candidate}
                          title="Creates a blocked run request; execution remains dry-run until gates pass"
                          style={{ marginLeft: 8 }}
                        >
                          Create run request
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function AaveLiquidationPanel({
  artifact,
  error,
  isLoading,
  title = 'Aave V3 liquidation scan',
  description = 'Pure on-chain liquidation opportunities from recent debt-token activity',
  onPreparePlan,
  preparingPlan,
  onStartRun,
  startingRun,
}: {
  artifact?: AaveLiquidationArtifact;
  error: Error | null;
  isLoading: boolean;
  title?: string;
  description?: string;
  onPreparePlan: (candidate: AaveLiquidationCandidate) => void;
  preparingPlan: boolean;
  onStartRun: (candidate: AaveLiquidationCandidate) => void;
  startingRun: boolean;
}) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>{title}</h3>
          <div style={{ color: 'var(--text-dim)' }}>{description}</div>
        </div>
        {artifact ? (
          <span
            className={`badge ${
              artifact.summary.passingCount >= artifact.summary.requestedPassingCount
                ? 'badge-active'
                : 'badge-paused'
            }`}
          >
            {artifact.summary.passingCount}/{artifact.summary.requestedPassingCount} passing
          </span>
        ) : null}
      </div>
      {isLoading && <div style={{ marginTop: 12 }}>Loading liquidation scan...</div>}
      {error && <div style={{ color: 'var(--red)', marginTop: 12 }}>{error.message}</div>}
      {artifact && (
        <>
          <div className="grid grid-3" style={{ marginTop: 16 }}>
            <div>
              <div className="label">Status</div>
              <div>{artifact.summary.status}</div>
            </div>
            <div>
              <div className="label">Candidates</div>
              <div>{artifact.summary.candidateCount}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                {artifact.summary.artifactCount ?? 1} chain artifacts
              </div>
            </div>
            <div>
              <div className="label">Passing</div>
              <div>
                {artifact.summary.passingCount} / {artifact.summary.requestedPassingCount}
              </div>
              <div style={{ color: 'var(--text-dim)' }}>health factor and net-profit gated</div>
            </div>
          </div>
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>User</th>
                <th>Chain</th>
                <th>Health factor</th>
                <th>Route</th>
                <th>Net profit</th>
                <th>Return</th>
                <th>Gate</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {artifact.candidates.slice(0, 10).map((candidate) => (
                <tr key={candidate.id}>
                  <td>
                    <code>{short(candidate.user)}</code>
                    <div style={{ color: 'var(--text-dim)' }}>{candidate.strategyType}</div>
                  </td>
                  <td>{candidate.chain}</td>
                  <td>{candidate.account?.healthFactor?.toFixed(6) ?? 'n/a'}</td>
                  <td>
                    {candidate.bestEstimate
                      ? `${candidate.bestEstimate.debtSymbol} -> ${candidate.bestEstimate.collateralSymbol}`
                      : 'no priced pair'}
                    <div style={{ color: 'var(--text-dim)' }}>
                      gas {formatUsd(candidate.bestEstimate?.gasUsd)}
                    </div>
                  </td>
                  <td>{formatUsd(candidate.bestEstimate?.netProfitUsd)}</td>
                  <td>{formatPct(candidate.bestEstimate?.returnOnDebtPct)}</td>
                  <td>
                    <span
                      className={`badge ${
                        candidate.gate.status === 'pass' ? 'badge-active' : 'badge-paused'
                      }`}
                    >
                      {candidate.gate.status}
                    </span>
                    <div style={{ color: 'var(--text-dim)' }}>{candidate.gate.reason}</div>
                  </td>
                  <td>
                    <button onClick={() => onPreparePlan(candidate)} disabled={preparingPlan}>
                      Live plan
                    </button>
                    <button
                      onClick={() => onStartRun(candidate)}
                      disabled={startingRun}
                      title="Creates a blocked run request; execution remains dry-run until gates pass"
                      style={{ marginLeft: 8 }}
                    >
                      Create run request
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function CompoundV3LiquidationPanel({
  artifact,
  error,
  isLoading,
  onPreparePlan,
  preparingPlan,
  onStartRun,
  startingRun,
}: {
  artifact?: CompoundV3LiquidationArtifact;
  error: Error | null;
  isLoading: boolean;
  onPreparePlan: (candidate: CompoundV3LiquidationCandidate) => void;
  preparingPlan: boolean;
  onStartRun: (candidate: CompoundV3LiquidationCandidate) => void;
  startingRun: boolean;
}) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>Compound V3 liquidation scan</h3>
          <div style={{ color: 'var(--text-dim)' }}>
            Pure on-chain Comet absorb and buyCollateral opportunities
          </div>
        </div>
        {artifact ? (
          <span
            className={`badge ${
              artifact.summary.passingCount >= artifact.summary.requestedPassingCount
                ? 'badge-active'
                : 'badge-paused'
            }`}
          >
            {artifact.summary.passingCount}/{artifact.summary.requestedPassingCount} passing
          </span>
        ) : null}
      </div>
      {isLoading && <div style={{ marginTop: 12 }}>Loading Compound liquidation scan...</div>}
      {error && <div style={{ color: 'var(--red)', marginTop: 12 }}>{error.message}</div>}
      {artifact && (
        <>
          <div className="grid grid-3" style={{ marginTop: 16 }}>
            <div>
              <div className="label">Status</div>
              <div>{artifact.summary.status}</div>
            </div>
            <div>
              <div className="label">Candidates</div>
              <div>{artifact.summary.candidateCount}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                {artifact.summary.artifactCount ?? 1} chain artifacts
              </div>
            </div>
            <div>
              <div className="label">Passing</div>
              <div>
                {artifact.summary.passingCount} / {artifact.summary.requestedPassingCount}
              </div>
              <div style={{ color: 'var(--text-dim)' }}>Comet state and net-profit gated</div>
            </div>
          </div>
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>User</th>
                <th>Chain</th>
                <th>Liquidatable</th>
                <th>Borrow</th>
                <th>Route</th>
                <th>Net profit</th>
                <th>Return</th>
                <th>Gate</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {artifact.candidates.slice(0, 10).map((candidate) => (
                <tr key={candidate.id}>
                  <td>
                    <code>{short(candidate.user)}</code>
                    <div style={{ color: 'var(--text-dim)' }}>{candidate.strategyType}</div>
                  </td>
                  <td>{candidate.chain}</td>
                  <td>{candidate.account?.isLiquidatable ? 'yes' : 'no'}</td>
                  <td>
                    {candidate.account?.borrowBalanceHuman ?? 'n/a'}
                    <div style={{ color: 'var(--text-dim)' }}>
                      {candidate.account?.collateralCount ?? 0} collateral assets
                    </div>
                  </td>
                  <td>
                    {candidate.bestEstimate
                      ? `${candidate.bestEstimate.baseSymbol} -> ${candidate.bestEstimate.collateralSymbol}`
                      : 'no executable quote'}
                    <div style={{ color: 'var(--text-dim)' }}>
                      gas {formatUsd(candidate.bestEstimate?.gasUsd)}
                    </div>
                  </td>
                  <td>{formatUsd(candidate.bestEstimate?.netProfitUsd)}</td>
                  <td>{formatPct(candidate.bestEstimate?.returnOnBasePct)}</td>
                  <td>
                    <span
                      className={`badge ${
                        candidate.gate.status === 'pass' ? 'badge-active' : 'badge-paused'
                      }`}
                    >
                      {candidate.gate.status}
                    </span>
                    <div style={{ color: 'var(--text-dim)' }}>{candidate.gate.reason}</div>
                  </td>
                  <td>
                    <button onClick={() => onPreparePlan(candidate)} disabled={preparingPlan}>
                      Live plan
                    </button>
                    <button
                      onClick={() => onStartRun(candidate)}
                      disabled={startingRun}
                      title="Creates a blocked run request; execution remains dry-run until gates pass"
                      style={{ marginLeft: 8 }}
                    >
                      Create run request
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function MorphoBlueLiquidationPanel({
  artifact,
  error,
  isLoading,
  onPreparePlan,
  preparingPlan,
  onStartRun,
  startingRun,
}: {
  artifact?: MorphoBlueLiquidationArtifact;
  error: Error | null;
  isLoading: boolean;
  onPreparePlan: (candidate: MorphoBlueLiquidationCandidate) => void;
  preparingPlan: boolean;
  onStartRun: (candidate: MorphoBlueLiquidationCandidate) => void;
  startingRun: boolean;
}) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>Morpho Blue liquidation scan</h3>
          <div style={{ color: 'var(--text-dim)' }}>
            Pure on-chain Morpho liquidation and collateral unwind opportunities
          </div>
        </div>
        {artifact ? (
          <span
            className={`badge ${
              artifact.summary.passingCount >= artifact.summary.requestedPassingCount
                ? 'badge-active'
                : 'badge-paused'
            }`}
          >
            {artifact.summary.passingCount}/{artifact.summary.requestedPassingCount} passing
          </span>
        ) : null}
      </div>
      {isLoading && <div style={{ marginTop: 12 }}>Loading Morpho liquidation scan...</div>}
      {error && <div style={{ color: 'var(--red)', marginTop: 12 }}>{error.message}</div>}
      {artifact && (
        <>
          <div className="grid grid-3" style={{ marginTop: 16 }}>
            <div>
              <div className="label">Status</div>
              <div>{artifact.summary.status}</div>
            </div>
            <div>
              <div className="label">Candidates</div>
              <div>{artifact.summary.candidateCount}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                {artifact.summary.artifactCount ?? 1} chain artifacts
              </div>
            </div>
            <div>
              <div className="label">Passing</div>
              <div>
                {artifact.summary.passingCount} / {artifact.summary.requestedPassingCount}
              </div>
              <div style={{ color: 'var(--text-dim)' }}>LTV and net-profit gated</div>
            </div>
          </div>
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>User</th>
                <th>Chain</th>
                <th>LTV / LLTV</th>
                <th>Borrow</th>
                <th>Route</th>
                <th>Net profit</th>
                <th>Return</th>
                <th>Gate</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {artifact.candidates.slice(0, 10).map((candidate) => (
                <tr key={candidate.id}>
                  <td>
                    <code>{short(candidate.user)}</code>
                    <div style={{ color: 'var(--text-dim)' }}>{candidate.strategyType}</div>
                  </td>
                  <td>{candidate.chain}</td>
                  <td>
                    {formatPct((candidate.account?.ltv ?? 0) * 100)} /{' '}
                    {formatPct((candidate.account?.lltv ?? 0) * 100)}
                    <div style={{ color: 'var(--text-dim)' }}>
                      liquidatable {candidate.account?.liquidatable ? 'yes' : 'no'}
                    </div>
                  </td>
                  <td>{formatUsd(candidate.account?.borrowAssetsUsd)}</td>
                  <td>
                    {candidate.bestEstimate
                      ? `${candidate.bestEstimate.loanSymbol} -> ${candidate.bestEstimate.collateralSymbol}`
                      : 'no executable quote'}
                    <div style={{ color: 'var(--text-dim)' }}>
                      gas {formatUsd(candidate.bestEstimate?.gasUsd)}
                    </div>
                  </td>
                  <td>{formatUsd(candidate.bestEstimate?.netProfitUsd)}</td>
                  <td>{formatPct(candidate.bestEstimate?.returnOnRepayPct)}</td>
                  <td>
                    <span
                      className={`badge ${
                        candidate.gate.status === 'pass' ? 'badge-active' : 'badge-paused'
                      }`}
                    >
                      {candidate.gate.status}
                    </span>
                    <div style={{ color: 'var(--text-dim)' }}>{candidate.gate.reason}</div>
                  </td>
                  <td>
                    <button onClick={() => onPreparePlan(candidate)} disabled={preparingPlan}>
                      Live plan
                    </button>
                    <button
                      onClick={() => onStartRun(candidate)}
                      disabled={startingRun}
                      title="Creates a blocked run request; execution remains dry-run until gates pass"
                      style={{ marginLeft: 8 }}
                    >
                      Create run request
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function MorphoBlueWatchlistPanel({
  watchlist,
  error,
  isLoading,
  candidates,
  onPreparePlan,
  preparingPlan,
  onStartRun,
  startingRun,
}: {
  watchlist?: MorphoBlueLiquidationWatchlist;
  error: Error | null;
  isLoading: boolean;
  candidates: MorphoBlueLiquidationCandidate[];
  onPreparePlan: (candidate: MorphoBlueLiquidationCandidate) => void;
  preparingPlan: boolean;
  onStartRun: (candidate: MorphoBlueLiquidationCandidate) => void;
  startingRun: boolean;
}) {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>Morpho Blue liquidation watchlist</h3>
          <div style={{ color: 'var(--text-dim)' }}>
            Historical replay markets with current liquidation and profitability gates
          </div>
        </div>
        {watchlist ? (
          <span
            className={`badge ${
              watchlist.summary.passingCurrentProfitabilityCount >=
              watchlist.summary.requestedPassingCount
                ? 'badge-active'
                : 'badge-paused'
            }`}
          >
            {watchlist.summary.passingCurrentProfitabilityCount}/
            {watchlist.summary.requestedPassingCount} current pass
          </span>
        ) : null}
      </div>
      {isLoading && <div style={{ marginTop: 12 }}>Loading Morpho watchlist...</div>}
      {error && <div style={{ color: 'var(--red)', marginTop: 12 }}>{error.message}</div>}
      {watchlist && (
        <>
          <div className="grid grid-3" style={{ marginTop: 16 }}>
            <div>
              <div className="label">Status</div>
              <div>{watchlist.summary.status}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                live {watchlist.summary.liveExecutionStatus}
              </div>
            </div>
            <div>
              <div className="label">Current accounts</div>
              <div>{watchlist.summary.watchCandidateCount}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                {watchlist.summary.liquidatableCount} liquidatable ·{' '}
                {watchlist.summary.nearLiquidationCount} near
              </div>
            </div>
            <div>
              <div className="label">Historical markets</div>
              <div>{watchlist.summary.historicallyStableMarketCount}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                {watchlist.summary.watchCount} active watch rows
              </div>
            </div>
          </div>
          {watchlist.watchlist.length === 0 ? (
            <div style={{ marginTop: 12, color: 'var(--text-dim)' }}>
              No Morpho watchlist rows in the current artifact.
            </div>
          ) : (
            <table style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Market</th>
                  <th>Current risk</th>
                  <th>Borrow / collateral</th>
                  <th>Historical replay</th>
                  <th>Current net</th>
                  <th>Live gate</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {watchlist.watchlist.slice(0, 10).map((item) => {
                  const candidate = candidateById.get(item.id);
                  const current = item.currentState;
                  const estimate = item.profitability?.bestEstimate;
                  const gate = item.profitability?.gate;
                  const historical = item.historicalMarket;
                  const pair =
                    item.symbols?.loan && item.symbols?.collateral
                      ? `${item.symbols.loan} -> ${item.symbols.collateral}`
                      : historical
                        ? `${historical.loanSymbol} -> ${historical.collateralSymbol}`
                        : 'market pair n/a';

                  return (
                    <tr key={item.id}>
                      <td>
                        <code>{short(item.user)}</code>
                        <div style={{ color: 'var(--text-dim)' }}>{item.strategyType}</div>
                      </td>
                      <td>
                        <div>{pair}</div>
                        <code>{short(item.marketId)}</code>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            current?.liquidatable ? 'badge-active' : 'badge-paused'
                          }`}
                        >
                          {current?.riskCategory ?? 'n/a'}
                        </span>
                        <div style={{ color: 'var(--text-dim)' }}>
                          LTV {formatPct(current ? current.ltv * 100 : null)} / LLTV{' '}
                          {formatPct(current ? current.lltv * 100 : null)}
                        </div>
                      </td>
                      <td>
                        {formatUsd(current?.borrowUsd)}
                        <div style={{ color: 'var(--text-dim)' }}>
                          collateral {formatUsd(current?.collateralUsd)}
                        </div>
                      </td>
                      <td>
                        {formatPct(historical?.maxAnnualizedNetReturnPct)}
                        <div style={{ color: 'var(--text-dim)' }}>
                          {historical
                            ? `${historical.eventCount} events over ${historical.replayWindowDays.toFixed(
                                1,
                              )}d`
                            : 'no replay evidence'}
                        </div>
                      </td>
                      <td>
                        {formatUsd(estimate?.netProfitUsd)}
                        <div style={{ color: 'var(--text-dim)' }}>
                          return {formatPct(estimate?.returnOnRepayPct)} · gas{' '}
                          {formatUsd(estimate?.gasUsd)}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            gate?.status === 'pass' ? 'badge-active' : 'badge-paused'
                          }`}
                        >
                          {gate?.status ?? 'n/a'}
                        </span>
                        <div style={{ color: 'var(--text-dim)' }}>
                          {item.liveInterface?.nextRequiredGate ?? gate?.reason ?? 'n/a'}
                        </div>
                      </td>
                      <td>
                        <button
                          onClick={() => candidate && onPreparePlan(candidate)}
                          disabled={preparingPlan || !candidate}
                        >
                          Live plan
                        </button>
                        <button
                          onClick={() => candidate && onStartRun(candidate)}
                          disabled={startingRun || !candidate}
                          title="Creates a blocked run request; execution remains dry-run until gates pass"
                          style={{ marginLeft: 8 }}
                        >
                          Create run request
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function ExecutionPlanPanel({ plan }: { plan: ExecutionPlan }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>Dry-run live execution plan</h3>
          <div style={{ color: 'var(--text-dim)' }}>
            {plan.candidateId} · chain {plan.chainId ?? 'n/a'} · {plan.adapter}
          </div>
        </div>
        <span
          className={`badge ${plan.status === 'template-ready' ? 'badge-active' : 'badge-paused'}`}
        >
          {plan.status}
        </span>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <div>
          <div className="label">Target</div>
          <div>{plan.targetContract.role}</div>
          <code>{plan.targetContract.address ?? 'address required'}</code>
        </div>
        <div>
          <div className="label">Evidence</div>
          <div>
            7d {fmt(plan.evidence.apyBase7d)}% · 30d {fmt(plan.evidence.apyMean30d)}%
          </div>
          <div style={{ color: 'var(--text-dim)' }}>
            ${Math.round(plan.evidence.tvlUsd ?? 0).toLocaleString()} TVL
          </div>
        </div>
        <div>
          <div className="label">Capital</div>
          <div>{plan.capital}</div>
          <div style={{ color: 'var(--text-dim)' }}>{plan.mode}</div>
        </div>
      </div>

      <h4>Approvals</h4>
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th>Spender</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {plan.approvals.map((approval) => (
            <tr key={`${approval.token}-${approval.spender ?? 'none'}`}>
              <td>
                <code>{short(approval.token)}</code>
              </td>
              <td>
                <code>{approval.spender ? short(approval.spender) : 'spender required'}</code>
              </td>
              <td>{approval.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Transactions</h4>
      {plan.transactions.map((tx) => (
        <div
          key={tx.label}
          style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}
        >
          <div style={{ fontWeight: 700 }}>{tx.label}</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            to <code>{tx.to ? short(tx.to) : 'contract required'}</code> · selector{' '}
            <code>{tx.selector ?? 'n/a'}</code> · {tx.calldataStatus}
            {tx.calldataBytes ? ` · ${tx.calldataBytes} bytes` : ''}
          </div>
          {tx.calldata ? (
            <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4 }}>
              calldata <code>{formatCalldataPreview(tx.calldata)}</code>
            </div>
          ) : null}
          <pre style={{ overflowX: 'auto', marginBottom: 0 }}>
            {JSON.stringify(tx.params, null, 2)}
          </pre>
        </div>
      ))}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <ListBlock
          title="Risk limits"
          items={plan.riskLimits.map((r) => `${r.key}: ${r.value}${r.unit ? ` ${r.unit}` : ''}`)}
        />
        <ListBlock title="Blocked by" items={plan.blockedBy} />
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <ListBlock title="Preflight checks" items={plan.preflightChecks} />
        <ListBlock title="Warnings" items={plan.warnings} />
      </div>
    </div>
  );
}

function DexArbitragePlanPanel({ plan }: { plan: DexArbitrageExecutionPlan }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>Pure DEX arbitrage execution plan</h3>
          <div style={{ color: 'var(--text-dim)' }}>
            {plan.candidateId} · chain {plan.chainId ?? 'n/a'} · {plan.strategyType}
          </div>
        </div>
        <span className={`badge ${plan.status === 'blocked' ? 'badge-paused' : 'badge-active'}`}>
          {plan.status}
        </span>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <div>
          <div className="label">Route</div>
          <div>{plan.route.tokenPath.join(' / ')}</div>
          <div style={{ color: 'var(--text-dim)' }}>{plan.route.dexPath.join(' -> ')}</div>
        </div>
        <div>
          <div className="label">Input</div>
          <div>
            {plan.route.amountInHuman} · {plan.route.amountIn}
          </div>
          <div style={{ color: 'var(--text-dim)' }}>{plan.capital} requested capital</div>
        </div>
        <div>
          <div className="label">Gate</div>
          <span
            className={`badge ${
              plan.evidence.gate.status === 'pass' ? 'badge-active' : 'badge-paused'
            }`}
          >
            {plan.evidence.gate.status}
          </span>
          <div style={{ color: 'var(--text-dim)' }}>{plan.evidence.gate.reason}</div>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <div>
          <div className="label">Executor</div>
          <div>{plan.executor.role}</div>
          <code>{plan.executor.address ? short(plan.executor.address) : 'deployment required'}</code>
        </div>
        <div>
          <div className="label">Evidence samples</div>
          <div>
            {plan.evidence.sampleCount}/{plan.evidence.attemptedSamples}
          </div>
          <div style={{ color: 'var(--text-dim)' }}>
            win rate {formatPct(plan.evidence.metrics.netWinRatePct)}
          </div>
        </div>
        <div>
          <div className="label">Annualized net</div>
          <div>
            {formatPct(
              plan.evidence.metrics.meanAnnualizedNetReturnPct ??
                plan.evidence.metrics.annualizedNetReturnPct?.mean ??
                null,
            )}
          </div>
          <div style={{ color: 'var(--text-dim)' }}>
            median {formatUsd(plan.evidence.metrics.medianNetProfitUsd ?? null)}
          </div>
        </div>
      </div>

      <h4>Routers and adapters</h4>
      <table>
        <thead>
          <tr>
            <th>DEX</th>
            <th>Router</th>
            <th>Adapter</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {plan.requiredRouters.map((router) => {
            const adapter = plan.requiredAdapters.find((item) => item.dex === router.dex);
            return (
              <tr key={router.dex}>
                <td>{router.dex}</td>
                <td>
                  <code>{router.address ? short(router.address) : 'router required'}</code>
                </td>
                <td>{adapter?.adapter ?? 'adapter required'}</td>
                <td>{adapter?.status ?? router.verification}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h4>Approvals</h4>
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th>Spender</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {plan.approvals.map((approval) => (
            <tr key={`${approval.token}-${approval.spender ?? 'none'}`}>
              <td>
                <code>{short(approval.token)}</code>
              </td>
              <td>
                <code>{approval.spender ? short(approval.spender) : 'executor required'}</code>
              </td>
              <td>{approval.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Transactions</h4>
      {plan.transactions.map((tx) => (
        <div
          key={tx.label}
          style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}
        >
          <div style={{ fontWeight: 700 }}>{tx.label}</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            to <code>{tx.to ? short(tx.to) : 'contract required'}</code> · selector{' '}
            <code>{tx.selector ?? 'n/a'}</code> · {tx.calldataStatus}
            {tx.calldataBytes ? ` · ${tx.calldataBytes} bytes` : ''}
          </div>
          {tx.calldata ? (
            <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4 }}>
              calldata <code>{formatCalldataPreview(tx.calldata)}</code>
            </div>
          ) : null}
          <pre style={{ overflowX: 'auto', marginBottom: 0 }}>
            {JSON.stringify(tx.params, null, 2)}
          </pre>
        </div>
      ))}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <ListBlock
          title="Risk limits"
          items={plan.riskLimits.map((r) => `${r.key}: ${r.value}${r.unit ? ` ${r.unit}` : ''}`)}
        />
        <ListBlock title="Blocked by" items={plan.blockedBy} />
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <ListBlock title="Fork simulation requirements" items={plan.forkSimulation.requirements} />
        <ListBlock title="Preflight checks" items={plan.preflightChecks} />
      </div>

      <div style={{ marginTop: 16 }}>
        <ListBlock title="Warnings" items={plan.warnings} />
      </div>
    </div>
  );
}

function AaveLiquidationPlanPanel({ plan }: { plan: AaveLiquidationExecutionPlan }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>Aave liquidation execution plan</h3>
          <div style={{ color: 'var(--text-dim)' }}>
            {plan.candidateId} · chain {plan.chainId ?? 'n/a'} · {plan.strategyId}
          </div>
        </div>
        <span className={`badge ${plan.status === 'blocked' ? 'badge-paused' : 'badge-active'}`}>
          {plan.status}
        </span>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <div>
          <div className="label">Borrower</div>
          <code>{short(plan.borrower)}</code>
          <div style={{ color: 'var(--text-dim)' }}>
            HF {plan.evidence.healthFactor?.toFixed(6) ?? 'n/a'}
          </div>
        </div>
        <div>
          <div className="label">Liquidation pair</div>
          <div>
            {plan.liquidation.debtSymbol ?? 'debt'} {'->'}{' '}
            {plan.liquidation.collateralSymbol ?? 'collateral'}
          </div>
          <div style={{ color: 'var(--text-dim)' }}>
            debt cover {formatUsd(plan.liquidation.debtToCoverUsd)}
          </div>
        </div>
        <div>
          <div className="label">Gate</div>
          <span
            className={`badge ${
              plan.evidence.gate.status === 'pass' ? 'badge-active' : 'badge-paused'
            }`}
          >
            {plan.evidence.gate.status}
          </span>
          <div style={{ color: 'var(--text-dim)' }}>{plan.evidence.gate.reason}</div>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <div>
          <div className="label">Aave Pool</div>
          <code>{plan.liquidation.pool ? short(plan.liquidation.pool) : 'pool required'}</code>
        </div>
        <div>
          <div className="label">Executor</div>
          <div>{plan.executor.role}</div>
          <code>{plan.executor.address ? short(plan.executor.address) : 'deployment required'}</code>
        </div>
        <div>
          <div className="label">Estimated net</div>
          <div>{formatUsd(plan.evidence.bestEstimate?.netProfitUsd)}</div>
          <div style={{ color: 'var(--text-dim)' }}>
            return {formatPct(plan.evidence.bestEstimate?.returnOnDebtPct)}
          </div>
        </div>
      </div>

      <h4>Approvals</h4>
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th>Spender</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {plan.approvals.map((approval) => (
            <tr key={`${approval.token}-${approval.spender ?? 'none'}`}>
              <td>
                <code>{short(approval.token)}</code>
              </td>
              <td>
                <code>{approval.spender ? short(approval.spender) : 'spender required'}</code>
              </td>
              <td>{approval.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Transactions</h4>
      {plan.transactions.map((tx) => (
        <div
          key={tx.label}
          style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}
        >
          <div style={{ fontWeight: 700 }}>{tx.label}</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            to <code>{tx.to ? short(tx.to) : 'contract required'}</code> · selector{' '}
            <code>{tx.selector ?? 'n/a'}</code> · {tx.calldataStatus}
            {tx.calldataBytes ? ` · ${tx.calldataBytes} bytes` : ''}
          </div>
          {tx.calldata ? (
            <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4 }}>
              calldata <code>{formatCalldataPreview(tx.calldata)}</code>
            </div>
          ) : null}
          <pre style={{ overflowX: 'auto', marginBottom: 0 }}>
            {JSON.stringify(tx.params, null, 2)}
          </pre>
        </div>
      ))}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <ListBlock
          title="Risk limits"
          items={plan.riskLimits.map((r) => `${r.key}: ${r.value}${r.unit ? ` ${r.unit}` : ''}`)}
        />
        <ListBlock title="Blocked by" items={plan.blockedBy} />
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <ListBlock title="Fork simulation requirements" items={plan.forkSimulation.requirements} />
        <ListBlock title="Preflight checks" items={plan.preflightChecks} />
      </div>

      <div style={{ marginTop: 16 }}>
        <ListBlock title="Warnings" items={plan.warnings} />
      </div>
    </div>
  );
}

function CompoundV3LiquidationPlanPanel({
  plan,
}: {
  plan: CompoundV3LiquidationExecutionPlan;
}) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>Compound V3 liquidation execution plan</h3>
          <div style={{ color: 'var(--text-dim)' }}>
            {plan.candidateId} · chain {plan.chainId ?? 'n/a'} · {plan.strategyId}
          </div>
        </div>
        <span className={`badge ${plan.status === 'blocked' ? 'badge-paused' : 'badge-active'}`}>
          {plan.status}
        </span>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <div>
          <div className="label">Borrower</div>
          <code>{short(plan.borrower)}</code>
          <div style={{ color: 'var(--text-dim)' }}>
            liquidatable {plan.evidence.isLiquidatable ? 'yes' : 'no'}
          </div>
        </div>
        <div>
          <div className="label">Buy collateral</div>
          <div>
            {plan.liquidation.baseSymbol ?? 'base'} {'->'}{' '}
            {plan.liquidation.collateralSymbol ?? 'collateral'}
          </div>
          <div style={{ color: 'var(--text-dim)' }}>
            {plan.liquidation.baseAmountHuman ?? 'quote required'} base in
          </div>
        </div>
        <div>
          <div className="label">Gate</div>
          <span
            className={`badge ${
              plan.evidence.gate.status === 'pass' ? 'badge-active' : 'badge-paused'
            }`}
          >
            {plan.evidence.gate.status}
          </span>
          <div style={{ color: 'var(--text-dim)' }}>{plan.evidence.gate.reason}</div>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <div>
          <div className="label">Comet</div>
          <code>{plan.liquidation.comet ? short(plan.liquidation.comet) : 'comet required'}</code>
        </div>
        <div>
          <div className="label">Executor</div>
          <div>{plan.executor.role}</div>
          <code>{plan.executor.address ? short(plan.executor.address) : 'deployment required'}</code>
        </div>
        <div>
          <div className="label">Estimated net</div>
          <div>{formatUsd(plan.evidence.bestEstimate?.netProfitUsd)}</div>
          <div style={{ color: 'var(--text-dim)' }}>
            return {formatPct(plan.evidence.bestEstimate?.returnOnBasePct)}
          </div>
        </div>
      </div>

      <h4>Approvals</h4>
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th>Spender</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {plan.approvals.map((approval) => (
            <tr key={`${approval.token}-${approval.spender ?? 'none'}`}>
              <td>
                <code>{short(approval.token)}</code>
              </td>
              <td>
                <code>{approval.spender ? short(approval.spender) : 'spender required'}</code>
              </td>
              <td>{approval.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Transactions</h4>
      {plan.transactions.map((tx) => (
        <div
          key={tx.label}
          style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}
        >
          <div style={{ fontWeight: 700 }}>{tx.label}</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            to <code>{tx.to ? short(tx.to) : 'contract required'}</code> · selector{' '}
            <code>{tx.selector ?? 'n/a'}</code> · {tx.calldataStatus}
          </div>
          <pre style={{ overflowX: 'auto', marginBottom: 0 }}>
            {JSON.stringify(tx.params, null, 2)}
          </pre>
        </div>
      ))}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <ListBlock
          title="Risk limits"
          items={plan.riskLimits.map((r) => `${r.key}: ${r.value}${r.unit ? ` ${r.unit}` : ''}`)}
        />
        <ListBlock title="Blocked by" items={plan.blockedBy} />
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <ListBlock title="Fork simulation requirements" items={plan.forkSimulation.requirements} />
        <ListBlock title="Preflight checks" items={plan.preflightChecks} />
      </div>

      <div style={{ marginTop: 16 }}>
        <ListBlock title="Warnings" items={plan.warnings} />
      </div>
    </div>
  );
}

function MorphoBlueLiquidationPlanPanel({ plan }: { plan: MorphoBlueLiquidationExecutionPlan }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>Morpho Blue liquidation execution plan</h3>
          <div style={{ color: 'var(--text-dim)' }}>
            {plan.candidateId} · chain {plan.chainId ?? 'n/a'} · {plan.strategyId}
          </div>
        </div>
        <span className={`badge ${plan.status === 'blocked' ? 'badge-paused' : 'badge-active'}`}>
          {plan.status}
        </span>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <div>
          <div className="label">Borrower</div>
          <code>{short(plan.borrower)}</code>
          <div style={{ color: 'var(--text-dim)' }}>
            liquidatable {plan.evidence.liquidatable ? 'yes' : 'no'}
          </div>
        </div>
        <div>
          <div className="label">Liquidation pair</div>
          <div>
            {plan.liquidation.loanSymbol ?? 'loan'} {'->'}{' '}
            {plan.liquidation.collateralSymbol ?? 'collateral'}
          </div>
          <div style={{ color: 'var(--text-dim)' }}>
            repay {formatUsd(plan.liquidation.repayUsd)}
          </div>
        </div>
        <div>
          <div className="label">Gate</div>
          <span
            className={`badge ${
              plan.evidence.gate.status === 'pass' ? 'badge-active' : 'badge-paused'
            }`}
          >
            {plan.evidence.gate.status}
          </span>
          <div style={{ color: 'var(--text-dim)' }}>{plan.evidence.gate.reason}</div>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <div>
          <div className="label">Morpho</div>
          <code>{plan.liquidation.morpho ? short(plan.liquidation.morpho) : 'contract required'}</code>
        </div>
        <div>
          <div className="label">Executor</div>
          <div>{plan.executor.role}</div>
          <code>{plan.executor.address ? short(plan.executor.address) : 'deployment required'}</code>
        </div>
        <div>
          <div className="label">Estimated net</div>
          <div>{formatUsd(plan.evidence.bestEstimate?.netProfitUsd)}</div>
          <div style={{ color: 'var(--text-dim)' }}>
            LTV {formatPct((plan.evidence.ltv ?? 0) * 100)} / LLTV{' '}
            {formatPct((plan.evidence.lltv ?? 0) * 100)}
          </div>
        </div>
      </div>

      <h4>Approvals</h4>
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th>Spender</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {plan.approvals.map((approval) => (
            <tr key={`${approval.token}-${approval.spender ?? 'none'}`}>
              <td>
                <code>{short(approval.token)}</code>
              </td>
              <td>
                <code>{approval.spender ? short(approval.spender) : 'spender required'}</code>
              </td>
              <td>{approval.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Transactions</h4>
      {plan.transactions.map((tx) => (
        <div
          key={tx.label}
          style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}
        >
          <div style={{ fontWeight: 700 }}>{tx.label}</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            to <code>{tx.to ? short(tx.to) : 'contract required'}</code> · selector{' '}
            <code>{tx.selector ?? 'n/a'}</code> · {tx.calldataStatus}
          </div>
          <pre style={{ overflowX: 'auto', marginBottom: 0 }}>
            {JSON.stringify(tx.params, null, 2)}
          </pre>
        </div>
      ))}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <ListBlock
          title="Risk limits"
          items={plan.riskLimits.map((r) => `${r.key}: ${r.value}${r.unit ? ` ${r.unit}` : ''}`)}
        />
        <ListBlock title="Blocked by" items={plan.blockedBy} />
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <ListBlock title="Fork simulation requirements" items={plan.forkSimulation.requirements} />
        <ListBlock title="Preflight checks" items={plan.preflightChecks} />
      </div>

      <div style={{ marginTop: 16 }}>
        <ListBlock title="Warnings" items={plan.warnings} />
      </div>
    </div>
  );
}

function LiveRunPanel({
  run,
  onRefresh,
  onRerunPreflight,
  onForkSimulation,
  refreshing,
  rerunning,
  forkSimulating,
  forkSimulation,
  walletTx,
  setWalletTx,
}: {
  run: LiveRun;
  onRefresh: () => void;
  onRerunPreflight: () => void;
  onForkSimulation: () => void;
  refreshing: boolean;
  rerunning: boolean;
  forkSimulating: boolean;
  forkSimulation?: ForkSimulationResult;
  walletTx?: string;
  setWalletTx: (message: string | undefined) => void;
}) {
  const preflight = run.latest_preflight ?? null;
  const latestForkSimulation = forkSimulation ?? run.latest_fork_simulation ?? undefined;
  const forkDetails = latestForkSimulation?.details;
  const forkBlockers = forkDetails?.blockers ?? [];
  const forkRequirements = forkDetails?.requirements ?? [];
  const readiness = run.readiness ?? null;
  const eventReplay = run.event_replay_evidence ?? null;
  const mintPreview = preflight?.mintPreview ?? emptyMintPreview();
  const transactionPreview = preflight?.transactionPreview ?? emptyTransactionPreview();
  const gasPreflight = preflight?.gasPreflight ?? emptyGasPreflight();
  const callSimulation = preflight?.callSimulation ?? emptyCallSimulation();
  const walletPreflight = preflight?.walletPreflight ?? emptyWalletPreflight();
  const executionReady = readiness?.status === 'ready' && latestForkSimulation?.status === 'passed';
  const executionLockedReason =
    readiness?.status !== 'ready'
      ? 'All readiness gates must pass before sending strategy execution'
      : latestForkSimulation?.status !== 'passed'
        ? 'Ordered fork simulation must pass before sending strategy execution'
        : 'Execution is ready';
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>Live run request</h3>
          <div style={{ color: 'var(--text-dim)' }}>
            {run.candidate_id} · {run.strategy_id} · chain {run.chain_id ?? 'n/a'}
          </div>
        </div>
        <span className={`badge ${run.status === 'running' ? 'badge-active' : 'badge-paused'}`}>
          {run.status}
        </span>
      </div>
      <div className="form-row" style={{ marginTop: 12 }}>
        <button onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh run'}
        </button>
        <button onClick={onRerunPreflight} disabled={rerunning} style={{ marginLeft: 8 }}>
          {rerunning ? 'Queueing...' : 'Rerun preflight'}
        </button>
        <button onClick={onForkSimulation} disabled={forkSimulating} style={{ marginLeft: 8 }}>
          {forkSimulating ? 'Simulating...' : 'Run fork simulation'}
        </button>
      </div>
      {walletTx && (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 8 }}>{walletTx}</div>
      )}
      {latestForkSimulation && (
        <div style={{ marginTop: 12 }}>
          <div className="grid grid-3">
            <div>
              <div className="label">Fork simulation</div>
              <span
                className={`badge ${
                  latestForkSimulation.status === 'passed' ? 'badge-active' : 'badge-paused'
                }`}
              >
                {latestForkSimulation.status}
              </span>
            </div>
            <div>
              <div className="label">Exit code</div>
              <div>{latestForkSimulation.exitCode ?? 'n/a'}</div>
            </div>
            <div>
              <div className="label">Summary</div>
              <div style={{ color: 'var(--text-dim)' }}>
                {latestForkSimulation.summary ?? 'summary pending'}
              </div>
            </div>
          </div>
          <pre style={{ marginTop: 12, overflowX: 'auto', maxHeight: 240 }}>
            {latestForkSimulation.stdout || latestForkSimulation.stderr}
          </pre>
          {forkDetails && (
            <div style={{ marginTop: 12 }}>
              <div className="grid grid-3">
                <div>
                  <div className="label">Blocked reason</div>
                  <div style={{ color: 'var(--text-dim)' }}>
                    {forkDetails.reason ?? forkDetails.forkSimulation ?? 'n/a'}
                  </div>
                </div>
                <div>
                  <div className="label">Plan status</div>
                  <div>{forkDetails.planStatus ?? 'n/a'}</div>
                </div>
                <div>
                  <div className="label">Strategy type</div>
                  <div style={{ color: 'var(--text-dim)' }}>
                    {forkDetails.strategyType ?? 'n/a'}
                  </div>
                </div>
              </div>
              {forkBlockers.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="label">Fork blockers</div>
                  <ul>
                    {forkBlockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </div>
              )}
              {forkRequirements.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="label">Fork requirements</div>
                  <ul>
                    {forkRequirements.map((requirement) => (
                      <li key={requirement}>{requirement}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {readiness && (
        <div style={{ marginTop: 16 }}>
          <div className="grid grid-3">
            <div>
              <div className="label">Execution readiness</div>
              <span
                className={`badge ${
                  readiness.status === 'ready' ? 'badge-active' : 'badge-paused'
                }`}
              >
                {readiness.status}
              </span>
            </div>
            <div>
              <div className="label">Blocking gates</div>
              <div>{readiness.blockers.length}</div>
            </div>
            <div>
              <div className="label">Generated</div>
              <div style={{ color: 'var(--text-dim)' }}>{readiness.generatedAt}</div>
            </div>
          </div>
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Gate</th>
                <th>Status</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {readiness.gates.map((gate) => (
                <tr key={gate.key}>
                  <td>{gate.key}</td>
                  <td>
                    <span
                      className={`badge ${
                        gate.status === 'pass' ? 'badge-active' : 'badge-paused'
                      }`}
                    >
                      {gate.status}
                    </span>
                  </td>
                  <td>{gate.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {eventReplay && (
        <div style={{ marginTop: 16 }}>
          <h4>Event replay evidence</h4>
          <div className="grid grid-3">
            <div>
              <div className="label">Profitability gate</div>
              <span
                className={`badge ${
                  eventReplay.gate.status === 'pass' ? 'badge-active' : 'badge-paused'
                }`}
              >
                {eventReplay.gate.status}
              </span>
              <div style={{ color: 'var(--text-dim)' }}>{eventReplay.gate.evidenceStatus}</div>
            </div>
            <div>
              <div className="label">Window</div>
              <div>
                {eventReplay.window.swapCount} swaps · {eventReplay.window.durationDays.toFixed(4)}
                d
              </div>
              <div style={{ color: 'var(--text-dim)' }}>
                blocks {eventReplay.window.fromBlock}..{eventReplay.window.toBlock}
              </div>
            </div>
            <div>
              <div className="label">Pool</div>
              <code>
                {eventReplay.source.poolAddress
                  ? short(eventReplay.source.poolAddress)
                  : 'pool required'}
              </code>
              <div style={{ color: 'var(--text-dim)' }}>{eventReplay.source.rpcEnvVar ?? ''}</div>
            </div>
          </div>
          <div className="grid grid-3" style={{ marginTop: 12 }}>
            <div>
              <div className="label">Net APY / PnL</div>
              <div>{formatPct(eventReplay.metrics.netApyPct)}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                {formatUsd(eventReplay.metrics.netPnlUsd)}
              </div>
            </div>
            <div>
              <div className="label">Fee / IL APY</div>
              <div>{formatPct(eventReplay.metrics.grossFeeApyPct)}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                IL {formatPct(eventReplay.metrics.ilApyPct)}
              </div>
            </div>
            <div>
              <div className="label">Position</div>
              <div>
                {eventReplay.position.tickLower ?? 'n/a'} ..{' '}
                {eventReplay.position.tickUpper ?? 'n/a'}
              </div>
              <div style={{ color: 'var(--text-dim)' }}>
                in range {formatPct(eventReplay.fees.inRangeSwapPct)}
              </div>
            </div>
          </div>
          <div className="grid grid-3" style={{ marginTop: 12 }}>
            <div>
              <div className="label">Start / end price</div>
              <div>
                {eventReplay.position.startPriceToken1PerToken0?.toFixed(2) ?? 'n/a'}
                {' -> '}
                {eventReplay.position.endPriceToken1PerToken0?.toFixed(2) ?? 'n/a'}
              </div>
              <div style={{ color: 'var(--text-dim)' }}>
                change {formatPct(eventReplay.position.priceChangePct)}
              </div>
            </div>
            <div>
              <div className="label">Fees earned</div>
              <div>{formatUsd(eventReplay.fees.positionFeeUsdAtEndPrice)}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                gas APY {formatPct(eventReplay.metrics.gasApyPct)}
              </div>
            </div>
            <div>
              <div className="label">Generated</div>
              <div style={{ color: 'var(--text-dim)' }}>{eventReplay.generatedAt}</div>
            </div>
          </div>
          {eventReplay.methodology.caveats?.length ? (
            <div style={{ marginTop: 16 }}>
              <ListBlock title="Replay caveats" items={eventReplay.methodology.caveats} />
            </div>
          ) : null}
        </div>
      )}
      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <div>
          <div className="label">Run ID</div>
          <code>{run.id}</code>
        </div>
        <div>
          <div className="label">Wallet</div>
          <code>{run.wallet_address ? short(run.wallet_address) : 'n/a'}</code>
        </div>
        <div>
          <div className="label">Capital</div>
          <div>{run.capital}</div>
        </div>
      </div>
      {(run.blocked_by?.length || run.last_error) && (
        <div style={{ marginTop: 16 }}>
          <ListBlock
            title="Current blockers"
            items={
              run.blocked_by?.length
                ? run.blocked_by
                : [run.last_error ?? 'pending worker preflight']
            }
          />
        </div>
      )}
      {preflight && (
        <div style={{ marginTop: 16 }}>
          <h4>Preflight report</h4>
          <div className="grid grid-3">
            <div>
              <div className="label">Quote</div>
              <div>{preflight.quote.status}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                {preflight.quote.capital}
                {preflight.quote.source ? ` · ${preflight.quote.source}` : ''}
              </div>
            </div>
            <div>
              <div className="label">Execution</div>
              <div>{preflight.execution.adapter ?? 'adapter required'}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                calldata {preflight.execution.calldataReady ? 'ready' : 'missing'} · fork{' '}
                {preflight.execution.forkSimulationReady ? 'ready' : 'missing'}
              </div>
            </div>
            <div>
              <div className="label">Transactions</div>
              <div>{preflight.execution.transactionCount}</div>
              <code>
                {preflight.execution.target ? short(preflight.execution.target) : 'target required'}
              </code>
            </div>
          </div>
          <div className="grid grid-3" style={{ marginTop: 12 }}>
            <div>
              <div className="label">Pool state</div>
              <div>{preflight.poolState.status}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                {preflight.poolState.protocol ?? 'protocol required'} · fee{' '}
                {preflight.poolState.fee ?? 'n/a'}
              </div>
            </div>
            <div>
              <div className="label">Pool</div>
              <code>
                {preflight.poolState.poolAddress
                  ? short(preflight.poolState.poolAddress)
                  : 'pool resolver required'}
              </code>
              <div style={{ color: 'var(--text-dim)' }}>{preflight.poolState.rpcEnvVar ?? ''}</div>
            </div>
            <div>
              <div className="label">Tick / Liquidity</div>
              <div>{preflight.poolState.tick ?? 'n/a'}</div>
              <div style={{ color: 'var(--text-dim)' }}>
                {preflight.poolState.liquidity ?? 'liquidity required'}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <h4>Mint parameter preview</h4>
            <div className="grid grid-3">
              <div>
                <div className="label">Status</div>
                <div>{mintPreview.status}</div>
                <div style={{ color: 'var(--text-dim)' }}>
                  fee {mintPreview.fee ?? 'n/a'} · spacing {mintPreview.tickSpacing ?? 'n/a'}
                </div>
              </div>
              <div>
                <div className="label">Tick range</div>
                <div>
                  {mintPreview.tickLower ?? 'n/a'} .. {mintPreview.tickUpper ?? 'n/a'}
                </div>
                <div style={{ color: 'var(--text-dim)' }}>
                  deadline {mintPreview.deadline ?? 'n/a'}
                </div>
              </div>
              <div>
                <div className="label">Target</div>
                <code>{mintPreview.target ? short(mintPreview.target) : 'target required'}</code>
                <div style={{ color: 'var(--text-dim)' }}>
                  selector <code>{mintPreview.selector ?? 'n/a'}</code>
                </div>
              </div>
            </div>
            <div className="grid grid-2" style={{ marginTop: 12 }}>
              <div>
                <div className="label">Recipient</div>
                <code>
                  {mintPreview.recipient ? short(mintPreview.recipient) : 'recipient required'}
                </code>
              </div>
              <div>
                <div className="label">Method</div>
                <code>{mintPreview.method ?? 'method required'}</code>
              </div>
            </div>
            {mintPreview.token0 && mintPreview.token1 ? (
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Decimals</th>
                    <th>Desired</th>
                    <th>Desired base units</th>
                    <th>Min base units</th>
                  </tr>
                </thead>
                <tbody>
                  {[mintPreview.token0, mintPreview.token1].map((token) => (
                    <tr key={token.token}>
                      <td>
                        {token.symbol} <code>{short(token.token)}</code>
                      </td>
                      <td>
                        {token.decimals} ({token.decimalsSource})
                      </td>
                      <td>
                        {token.desiredAmount} / min {token.minAmount}
                      </td>
                      <td>{token.desiredBaseUnits}</td>
                      <td>{token.minBaseUnits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {mintPreview.error && (
              <div style={{ color: 'var(--red)', marginTop: 12 }}>{mintPreview.error}</div>
            )}
          </div>
          <div style={{ marginTop: 16 }}>
            <h4>Transaction preview</h4>
            <div className="grid grid-3">
              <div>
                <div className="label">Status</div>
                <div>{transactionPreview.status}</div>
              </div>
              <div>
                <div className="label">Calls</div>
                <div>{transactionPreview.calls.length}</div>
              </div>
              <div>
                <div className="label">Readiness</div>
                <div style={{ color: 'var(--text-dim)' }}>
                  fork {preflight.execution.forkSimulationReady ? 'ready' : 'missing'}
                </div>
              </div>
            </div>
            {transactionPreview.calls.length ? (
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Call</th>
                    <th>To</th>
                    <th>Selector</th>
                    <th>Bytes</th>
                    <th>Calldata</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {transactionPreview.calls.map((call) => (
                    <tr key={`${call.kind}-${call.to}-${call.selector}`}>
                      <td>
                        <div>{call.label}</div>
                        <div style={{ color: 'var(--text-dim)' }}>{call.method}</div>
                      </td>
                      <td>
                        <code>{short(call.to)}</code>
                      </td>
                      <td>
                        <code>{call.selector}</code>
                      </td>
                      <td>{call.calldataBytes}</td>
                      <td>
                        <code>{shortCalldata(call.calldata)}</code>
                      </td>
                      <td>
                        {call.kind === 'approval' ? (
                          <button
                            onClick={() =>
                              void sendPreviewCall(run, call, setWalletTx).then(() => onRefresh())
                            }
                          >
                            Send approve
                          </button>
                        ) : executionReady ? (
                          <button
                            onClick={() =>
                              void sendPreviewCall(run, call, setWalletTx, true).then(() =>
                                onRefresh(),
                              )
                            }
                            title="Submits the fork-verified strategy transaction from the connected wallet"
                          >
                            Send execution
                          </button>
                        ) : (
                          <button
                            disabled
                            title={executionLockedReason}
                          >
                            Locked
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {transactionPreview.error && (
              <div style={{ color: 'var(--red)', marginTop: 12 }}>{transactionPreview.error}</div>
            )}
          </div>
          <div style={{ marginTop: 16 }}>
            <h4>Gas preflight</h4>
            <div className="grid grid-3">
              <div>
                <div className="label">Status</div>
                <div>{gasPreflight.status}</div>
                <div style={{ color: 'var(--text-dim)' }}>{gasPreflight.rpcEnvVar ?? ''}</div>
              </div>
              <div>
                <div className="label">Wallet</div>
                <code>{gasPreflight.wallet ? short(gasPreflight.wallet) : 'wallet required'}</code>
              </div>
              <div>
                <div className="label">Total gas</div>
                <div>{gasPreflight.totalGasLimit ?? 'n/a'}</div>
                <div style={{ color: 'var(--text-dim)' }}>latest-block estimate</div>
              </div>
            </div>
            <div className="grid grid-3" style={{ marginTop: 12 }}>
              <div>
                <div className="label">Estimated gas cost</div>
                <div>{formatUsd(gasPreflight.estimatedCostUsd)}</div>
                <div style={{ color: 'var(--text-dim)' }}>
                  max {formatUsd(gasPreflight.maxGasUsd)}
                </div>
              </div>
              <div>
                <div className="label">Max gas gate</div>
                <span
                  className={`badge ${
                    gasPreflight.maxGasOk === true ? 'badge-active' : 'badge-paused'
                  }`}
                >
                  {gasPreflight.maxGasOk == null
                    ? 'pending'
                    : gasPreflight.maxGasOk
                      ? 'within limit'
                      : 'over limit'}
                </span>
                {gasPreflight.costError ? (
                  <div style={{ color: 'var(--red)', marginTop: 4 }}>{gasPreflight.costError}</div>
                ) : null}
              </div>
              <div>
                <div className="label">Gas price / native</div>
                <div>{gasPreflight.gasPriceWei ?? 'n/a'} wei</div>
                <div style={{ color: 'var(--text-dim)' }}>
                  {gasPreflight.nativeTokenSymbol ?? 'native'}{' '}
                  {formatUsd(gasPreflight.nativeTokenPriceUsd)}
                </div>
              </div>
            </div>
            {gasPreflight.calls.length ? (
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Call</th>
                    <th>Status</th>
                    <th>Gas limit</th>
                    <th>Cost</th>
                    <th>Failure reason</th>
                  </tr>
                </thead>
                <tbody>
                  {gasPreflight.calls.map((call) => (
                    <tr key={`${call.kind}-${call.to}-${call.selector}-gas`}>
                      <td>
                        <div>{call.label}</div>
                        <div style={{ color: 'var(--text-dim)' }}>
                          {call.kind} · <code>{call.selector}</code>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            call.status === 'estimated' ? 'badge-active' : 'badge-paused'
                          }`}
                        >
                          {call.status}
                        </span>
                      </td>
                      <td>
                        {call.gasLimit ?? 'n/a'}
                        {call.gasLimitHex ? (
                          <div style={{ color: 'var(--text-dim)' }}>
                            <code>{call.gasLimitHex}</code>
                          </div>
                        ) : null}
                      </td>
                      <td>{formatUsd(call.estimatedCostUsd)}</td>
                      <td style={{ color: call.error ? 'var(--red)' : 'var(--text-dim)' }}>
                        {call.error ?? 'none'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {gasPreflight.error && (
              <div style={{ color: 'var(--red)', marginTop: 12 }}>{gasPreflight.error}</div>
            )}
          </div>
          <div style={{ marginTop: 16 }}>
            <h4>Read-only call simulation</h4>
            <div className="grid grid-3">
              <div>
                <div className="label">Status</div>
                <div>{callSimulation.status}</div>
                <div style={{ color: 'var(--text-dim)' }}>{callSimulation.rpcEnvVar ?? ''}</div>
              </div>
              <div>
                <div className="label">Wallet</div>
                <code>
                  {callSimulation.wallet ? short(callSimulation.wallet) : 'wallet required'}
                </code>
              </div>
              <div>
                <div className="label">Calls</div>
                <div>{callSimulation.calls.length}</div>
                <div style={{ color: 'var(--text-dim)' }}>eth_call latest block</div>
              </div>
            </div>
            {callSimulation.calls.length ? (
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Call</th>
                    <th>Status</th>
                    <th>Return</th>
                    <th>Failure reason</th>
                  </tr>
                </thead>
                <tbody>
                  {callSimulation.calls.map((call) => (
                    <tr key={`${call.kind}-${call.to}-${call.selector}-sim`}>
                      <td>
                        <div>{call.label}</div>
                        <div style={{ color: 'var(--text-dim)' }}>
                          {call.kind} · <code>{call.selector}</code>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            call.status === 'passed' ? 'badge-active' : 'badge-paused'
                          }`}
                        >
                          {call.status}
                        </span>
                      </td>
                      <td>
                        {call.returnBytes == null ? 'n/a' : `${call.returnBytes} bytes`}
                        {call.returnDataPreview ? (
                          <div style={{ color: 'var(--text-dim)' }}>
                            <code>{call.returnDataPreview}</code>
                          </div>
                        ) : null}
                      </td>
                      <td style={{ color: call.error ? 'var(--red)' : 'var(--text-dim)' }}>
                        {call.error ?? 'none'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {callSimulation.error && (
              <div style={{ color: 'var(--red)', marginTop: 12 }}>{callSimulation.error}</div>
            )}
          </div>
          <div style={{ marginTop: 16 }}>
            <h4>Wallet preflight</h4>
            <div className="grid grid-3">
              <div>
                <div className="label">Status</div>
                <div>{walletPreflight.status}</div>
                <div style={{ color: 'var(--text-dim)' }}>{walletPreflight.rpcEnvVar ?? ''}</div>
              </div>
              <div>
                <div className="label">Wallet</div>
                <code>
                  {walletPreflight.wallet ? short(walletPreflight.wallet) : 'wallet required'}
                </code>
              </div>
              <div>
                <div className="label">Spender</div>
                <code>
                  {walletPreflight.spender ? short(walletPreflight.spender) : 'spender required'}
                </code>
              </div>
            </div>
            {walletPreflight.tokens.length ? (
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Required</th>
                    <th>Balance</th>
                    <th>Allowance</th>
                    <th>Approval gap</th>
                  </tr>
                </thead>
                <tbody>
                  {walletPreflight.tokens.map((token) => (
                    <tr key={token.token}>
                      <td>
                        {token.symbol} <code>{short(token.token)}</code>
                      </td>
                      <td>{token.requiredBaseUnits}</td>
                      <td>
                        <span
                          className={`badge ${token.balanceOk ? 'badge-active' : 'badge-paused'}`}
                        >
                          {token.balanceOk ? 'ok' : 'insufficient'}
                        </span>{' '}
                        {token.balanceBaseUnits ?? 'n/a'}
                      </td>
                      <td>
                        <span
                          className={`badge ${token.allowanceOk ? 'badge-active' : 'badge-paused'}`}
                        >
                          {token.allowanceOk ? 'ok' : 'approve'}
                        </span>{' '}
                        {token.allowanceBaseUnits ?? 'n/a'}
                      </td>
                      <td>{token.approvalRequiredBaseUnits ?? 'n/a'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {walletPreflight.error && (
              <div style={{ color: 'var(--red)', marginTop: 12 }}>{walletPreflight.error}</div>
            )}
          </div>
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Check</th>
                <th>Status</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {preflight.checks.map((check) => (
                <tr key={check.key}>
                  <td>{check.key}</td>
                  <td>
                    <span
                      className={`badge ${check.status === 'pass' ? 'badge-active' : 'badge-paused'}`}
                    >
                      {check.status}
                    </span>
                  </td>
                  <td>{check.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preflight.quote.prices?.length ? (
            <table style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Price USD</th>
                  <th>Desired</th>
                  <th>Min</th>
                  <th>USD share</th>
                </tr>
              </thead>
              <tbody>
                {preflight.quote.prices.map((price) => (
                  <tr key={price.coin}>
                    <td>
                      {price.symbol} <code>{short(price.token)}</code>
                    </td>
                    <td>
                      {price.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                    </td>
                    <td>{price.desiredAmount}</td>
                    <td>{price.minAmount}</td>
                    <td>
                      ${price.usdShare.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {preflight.quote.error && (
            <div style={{ color: 'var(--red)', marginTop: 12 }}>{preflight.quote.error}</div>
          )}
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <ListBlock
              title="Required quote inputs"
              items={[
                ...preflight.quote.requiredInputs,
                ...preflight.poolState.requiredInputs,
                ...mintPreview.requiredInputs,
                ...transactionPreview.requiredInputs,
                ...walletPreflight.requiredInputs,
              ]}
            />
            <ListBlock title="Next actions" items={preflight.nextActions} />
          </div>
          {walletPreflight.warnings.length ? (
            <div style={{ marginTop: 16 }}>
              <ListBlock title="Wallet preflight warnings" items={walletPreflight.warnings} />
            </div>
          ) : null}
          {transactionPreview.warnings.length ? (
            <div style={{ marginTop: 16 }}>
              <ListBlock title="Transaction preview warnings" items={transactionPreview.warnings} />
            </div>
          ) : null}
          {mintPreview.warnings.length ? (
            <div style={{ marginTop: 16 }}>
              <ListBlock title="Mint preview warnings" items={mintPreview.warnings} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 style={{ marginTop: 0 }}>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function emptyMintPreview(): NonNullable<PreflightReport['mintPreview']> {
  return {
    status: 'missing',
    protocol: null,
    selector: null,
    method: null,
    target: null,
    recipient: null,
    fee: null,
    tickSpacing: null,
    requiredInputs: ['mint preview report'],
    warnings: [],
    error: 'latest preflight was generated before mint preview support',
  };
}

function emptyTransactionPreview(): NonNullable<PreflightReport['transactionPreview']> {
  return {
    status: 'missing',
    calls: [],
    requiredInputs: ['transaction preview report'],
    warnings: [],
    error: 'latest preflight was generated before transaction preview support',
  };
}

function emptyGasPreflight(): NonNullable<PreflightReport['gasPreflight']> {
  return {
    status: 'missing',
    wallet: null,
    calls: [],
    requiredInputs: ['gas preflight report'],
    warnings: [],
    error: 'latest preflight was generated before gas preflight support',
  };
}

function emptyCallSimulation(): NonNullable<PreflightReport['callSimulation']> {
  return {
    status: 'missing',
    wallet: null,
    calls: [],
    requiredInputs: ['call simulation report'],
    warnings: [],
    error: 'latest preflight was generated before call simulation support',
  };
}

function emptyWalletPreflight(): NonNullable<PreflightReport['walletPreflight']> {
  return {
    status: 'missing',
    wallet: null,
    spender: null,
    tokens: [],
    requiredInputs: ['wallet preflight report'],
    warnings: [],
    error: 'latest preflight was generated before wallet preflight support',
  };
}

async function sendPreviewCall(
  run: LiveRun,
  call: TransactionPreviewCall,
  setWalletTx: (message: string | undefined) => void,
  allowExecution = false,
): Promise<void> {
  if (!window.ethereum) {
    setWalletTx('No injected wallet found.');
    return;
  }
  if (call.kind !== 'approval' && !allowExecution) {
    setWalletTx('This call is locked until fork simulation and risk gates pass.');
    return;
  }
  setWalletTx(`Preparing ${call.label}...`);
  try {
    await ensureWalletChain(run.chain_id);
    const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
    const from = accounts[0];
    if (!from) throw new Error('wallet returned no account');
    if (run.wallet_address && from.toLowerCase() !== run.wallet_address.toLowerCase()) {
      throw new Error(
        `connected wallet ${short(from)} does not match run wallet ${short(run.wallet_address)}`,
      );
    }
    const hash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [
        {
          from,
          to: normalizeAddress(call.to),
          value: call.value === '0' ? '0x0' : `0x${BigInt(call.value).toString(16)}`,
          data: call.calldata as `0x${string}`,
        },
      ],
    });
    setWalletTx(
      `${call.label} submitted: ${String(hash)}. After confirmation, rerun preflight.`,
    );
  } catch (err) {
    setWalletTx((err as Error).message);
  }
}

async function ensureWalletChain(chainId: number | null): Promise<void> {
  if (!window.ethereum || chainId == null) return;
  const expected = CHAIN_HEX[chainId];
  if (!expected) return;
  const current = (await window.ethereum.request({ method: 'eth_chainId' })) as string;
  if (current.toLowerCase() === expected.toLowerCase()) return;
  await window.ethereum.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: expected }],
  });
  window.dispatchEvent(new CustomEvent('oal-wallet-connected', { detail: { chainId: expected } }));
}

async function requestWalletAddress(): Promise<string | undefined> {
  if (!window.ethereum) return undefined;
  const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
  const address = accounts[0];
  if (address) {
    const chainId = (await window.ethereum.request({ method: 'eth_chainId' }).catch(() => null)) as
      | string
      | null;
    window.dispatchEvent(new CustomEvent('oal-wallet-connected', { detail: { address, chainId } }));
  }
  return address;
}

function short(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function shortCalldata(value: string): string {
  if (value.length <= 42) return value;
  return `${value.slice(0, 18)}...${value.slice(-16)}`;
}

function normalizeAddress(addr: string): `0x${string}` {
  if (addr.startsWith('\\x')) return `0x${addr.slice(2)}`;
  return addr as `0x${string}`;
}

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown[] }): Promise<unknown>;
      on?(event: string, listener: (...args: unknown[]) => void): void;
      removeListener?(event: string, listener: (...args: unknown[]) => void): void;
    };
  }
}
