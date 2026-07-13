import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DATA_DIR = findDataDir();

function findDataDir(): string {
  const candidates = [resolve(process.cwd(), 'data'), resolve(process.cwd(), '../..', 'data')];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function dataPath(...parts: string[]): string {
  return resolve(DATA_DIR, ...parts);
}

export interface StrategyCandidate {
  id: string;
  poolId: string;
  chain: string;
  project: string;
  symbol: string;
  classification: string;
  isPureArbitrage: boolean;
  evidenceStatus: string;
  apyBase: number | null;
  apyBase7d: number | null;
  apyMean30d: number | null;
  apy: number | null;
  tvlUsd: number | null;
  stablecoin: boolean;
  ilRisk: string | null;
  exposure: string | null;
  underlyingTokens: string[];
  liveInterfaceStatus: string;
  riskNotes: string[];
  source: string;
}

export interface CandidateArtifact {
  generatedAt: string;
  source: string;
  methodology: Record<string, unknown>;
  candidates: StrategyCandidate[];
  evidenceBacktests: Array<{
    id: string;
    candidateId: string;
    strategyId: string;
    status: string;
    source: string;
    capturedAt: string;
    metrics: Record<string, unknown>;
    caveats: string[];
  }>;
}

export interface CandidateEventReplayArtifact {
  schemaVersion: number;
  generatedAt: string;
  candidateId: string;
  source: Record<string, unknown>;
  methodology: {
    classification?: string;
    isPureArbitrage?: boolean;
    minReplayDaysForGate?: number;
    minSwapCountForGate?: number;
    caveats?: string[];
    [key: string]: unknown;
  };
  window: {
    fromBlock: number;
    toBlock: number;
    startTimestamp: string;
    endTimestamp: string;
    durationDays: number;
    swapCount: number;
  };
  position: Record<string, unknown>;
  fees: Record<string, unknown>;
  metrics: {
    grossFeeApyPct?: number | null;
    impermanentLossUsd?: number | null;
    ilApyPct?: number | null;
    gasUsd?: number | null;
    gasApyPct?: number | null;
    netPnlUsd?: number | null;
    netApyPct?: number | null;
  };
  gate: {
    status: 'pass' | 'block' | string;
    evidenceStatus: string;
    minNetApyPct?: number;
    minReplayDaysForGate?: number;
    minSwapCountForGate?: number;
    reason?: string;
  };
  summary: Record<string, unknown>;
}

export interface DexArbitrageCandidate {
  id: string;
  chain: string;
  strategyType: string;
  isPureArbitrage: boolean;
  startToken: { symbol: string; address: string; decimals: number };
  midToken: { symbol: string; address: string; decimals: number };
  thirdToken?: { symbol: string; address: string; decimals: number };
  buyDex: string;
  sellDex: string;
  dexPath?: string[];
  tokenPath?: string[];
  amountIn: string;
  amountInHuman: string;
  metrics: Record<string, unknown>;
  gate: {
    status: 'pass' | 'block' | string;
    reason: string;
    minAnnualizedNetReturnPct?: number;
    minSamples?: number;
    minWinRatePct?: number;
  };
  liveInterface: Record<string, unknown>;
  samples: Array<Record<string, unknown>>;
}

export interface DexArbitrageArtifact {
  schemaVersion: number;
  generatedAt: string;
  source: Record<string, unknown>;
  methodology: Record<string, unknown>;
  summary: {
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  candidates: DexArbitrageCandidate[];
}

export interface DexArbitrageArtifacts {
  generatedAt: string;
  summary: {
    artifactCount: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  artifacts: DexArbitrageArtifact[];
  candidates: DexArbitrageCandidate[];
}

export type PendlePtArbitrageCandidate = DexArbitrageCandidate & {
  protocol?: string;
  noCexRequired?: boolean;
  atomicArbitrage?: boolean;
  market?: Record<string, unknown>;
  bestEstimate?: Record<string, unknown>;
};

export type PendlePtArbitrageArtifact = Omit<DexArbitrageArtifact, 'candidates'> & {
  candidates: PendlePtArbitrageCandidate[];
  summary: DexArbitrageArtifact['summary'] & {
    economicCandidateCount?: number;
  };
};

export type PendlePtArbitrageArtifacts = Omit<
  DexArbitrageArtifacts,
  'artifacts' | 'candidates'
> & {
  artifacts: PendlePtArbitrageArtifact[];
  candidates: PendlePtArbitrageCandidate[];
};

export type CurveStableArbitrageCandidate = DexArbitrageCandidate & {
  noCexRequired?: boolean;
};

export interface CurveStableArbitrageArtifact {
  schemaVersion: number;
  generatedAt: string;
  source: Record<string, unknown>;
  methodology: Record<string, unknown>;
  summary: {
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  candidates: CurveStableArbitrageCandidate[];
}

export interface CurveStableArbitrageArtifacts {
  generatedAt: string;
  summary: {
    artifactCount: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  artifacts: CurveStableArbitrageArtifact[];
  candidates: CurveStableArbitrageCandidate[];
}

export type BalancerArbitrageCandidate = DexArbitrageCandidate & {
  noCexRequired?: boolean;
  pool?: Record<string, unknown>;
};

export interface BalancerArbitrageArtifact {
  schemaVersion: number;
  generatedAt: string;
  source: Record<string, unknown>;
  methodology: Record<string, unknown>;
  summary: {
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  candidates: BalancerArbitrageCandidate[];
}

export interface BalancerArbitrageArtifacts {
  generatedAt: string;
  summary: {
    artifactCount: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  artifacts: BalancerArbitrageArtifact[];
  candidates: BalancerArbitrageCandidate[];
}

export type UniswapV3FeeArbitrageCandidate = DexArbitrageCandidate & {
  noCexRequired?: boolean;
};

export interface UniswapV3FeeArbitrageArtifact {
  schemaVersion: number;
  generatedAt: string;
  source: Record<string, unknown>;
  methodology: Record<string, unknown>;
  summary: {
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  candidates: UniswapV3FeeArbitrageCandidate[];
}

export interface UniswapV3FeeArbitrageArtifacts {
  generatedAt: string;
  summary: {
    artifactCount: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  artifacts: UniswapV3FeeArbitrageArtifact[];
  candidates: UniswapV3FeeArbitrageCandidate[];
}

export interface AaveLiquidationCandidate {
  id: string;
  chain: string;
  strategyType: string;
  isPureArbitrage: boolean;
  noCexRequired?: boolean;
  user: string;
  blockNumber?: number;
  account?: {
    totalCollateralBase: string;
    totalDebtBase: string;
    healthFactor: number;
    healthFactorRaw: string;
    currentLiquidationThreshold: number;
    ltv: number;
  };
  bestEstimate?: {
    collateralAsset: string;
    collateralSymbol: string;
    debtAsset: string;
    debtSymbol: string;
    debtToCover?: string | null;
    debtToCoverUsd: number;
    debtToCoverAmount?: string | null;
    debtToCoverBaseUnits?: string | null;
    debtToCoverSource?: string | null;
    seizedCollateralUsd?: number | null;
    seizedCollateralAmount?: string | null;
    seizedCollateralBaseUnits?: string | null;
    seizedCollateralSource?: string | null;
    liquidationBonusBps: number;
    grossProfitUsd: number;
    protocolFeeUsd: number;
    gasUsd: number;
    netProfitUsd: number;
    returnOnDebtPct: number;
  } | null;
  gate: {
    status: 'pass' | 'block' | string;
    reason: string;
    minNetProfitUsd?: number;
    minReturnOnDebtPct?: number;
  };
  liveInterface: Record<string, unknown>;
}

export interface AaveLiquidationArtifact {
  schemaVersion: number;
  generatedAt: string;
  source: Record<string, unknown>;
  methodology: Record<string, unknown>;
  summary: {
    reserveCount: number;
    discoveredDebtUsers: number;
    checkedDebtUsers: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  candidates: AaveLiquidationCandidate[];
}

export interface AaveLiquidationArtifacts {
  generatedAt: string;
  summary: {
    artifactCount: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  artifacts: AaveLiquidationArtifact[];
  candidates: AaveLiquidationCandidate[];
}

export interface CompoundV3LiquidationCandidate {
  id: string;
  chain: string;
  strategyType: string;
  isPureArbitrage: boolean;
  noCexRequired?: boolean;
  user: string;
  blockNumber?: number;
  account?: {
    isLiquidatable: boolean;
    borrowBalance: string;
    borrowBalanceHuman: string;
    collateralCount: number;
  };
  bestEstimate?: {
    collateralAsset: string;
    collateralSymbol: string;
    baseAsset: string;
    baseSymbol: string;
    baseAmount: string;
    baseAmountHuman: string;
    quotedCollateral: string;
    quotedCollateralHuman: string;
    baseCostUsd: number;
    collateralValueUsd: number;
    grossProfitUsd: number;
    gasUsd: number;
    netProfitUsd: number;
    returnOnBasePct: number;
  } | null;
  gate: {
    status: 'pass' | 'block' | string;
    reason: string;
    minNetProfitUsd?: number;
    minReturnOnBasePct?: number;
  };
  liveInterface: Record<string, unknown>;
}

export interface CompoundV3LiquidationArtifact {
  schemaVersion: number;
  generatedAt: string;
  source: Record<string, unknown>;
  methodology: Record<string, unknown>;
  summary: {
    discoveredAccounts: number;
    checkedAccounts: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  candidates: CompoundV3LiquidationCandidate[];
}

export interface CompoundV3LiquidationArtifacts {
  generatedAt: string;
  summary: {
    artifactCount: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  artifacts: CompoundV3LiquidationArtifact[];
  candidates: CompoundV3LiquidationCandidate[];
}

export interface MorphoBlueLiquidationCandidate {
  id: string;
  chain: string;
  strategyType: string;
  isPureArbitrage: boolean;
  noCexRequired?: boolean;
  user: string;
  marketId: string;
  marketParams: {
    loanToken: string;
    collateralToken: string;
    oracle: string;
    irm: string;
    lltv: string;
  };
  account?: {
    borrowAssets: string;
    borrowAssetsUsd: number;
    collateral: string;
    collateralUsd: number;
    ltv: number;
    lltv: number;
    liquidatable: boolean;
  };
  bestEstimate?: {
    loanAsset: string;
    loanSymbol: string;
    collateralAsset: string;
    collateralSymbol: string;
    borrowUsd: number;
    collateralUsd: number;
    lltv: number;
    ltv: number;
    liquidatable: boolean;
    liquidationIncentive: number;
    repayUsd: number;
    grossProfitUsd: number;
    gasUsd: number;
    netProfitUsd: number;
    returnOnRepayPct: number;
  } | null;
  gate: {
    status: 'pass' | 'block' | string;
    reason: string;
    minNetProfitUsd?: number;
    minReturnOnRepayPct?: number;
  };
  liveInterface: Record<string, unknown>;
}

export interface MorphoBlueLiquidationArtifact {
  schemaVersion: number;
  generatedAt: string;
  source: Record<string, unknown>;
  methodology: Record<string, unknown>;
  summary: {
    marketCount: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  candidates: MorphoBlueLiquidationCandidate[];
}

export interface MorphoBlueLiquidationArtifacts {
  generatedAt: string;
  summary: {
    artifactCount: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
  };
  artifacts: MorphoBlueLiquidationArtifact[];
  candidates: MorphoBlueLiquidationCandidate[];
}

export interface PureArbitrageFamilySummary {
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
  liveEndpointPrefix: string;
  executionPlanEndpointPrefix: string;
  topCandidates: Array<{
    id: string;
    chain: string;
    strategyType: string;
    gateStatus: string;
    gateReason: string;
    score: number | null;
  }>;
}

export interface PureArbitrageSearchOverview {
  generatedAt: string;
  objective: {
    requestedPassingStrategies: number;
    minAnnualizedNetReturnPct: number;
    pureOnChainOnly: true;
    noCexRequired: true;
  };
  summary: {
    familyCount: number;
    artifactCount: number;
    candidateCount: number;
    passingCount: number;
    requestedPassingCount: number;
    status: string;
    liveExecutionStatus: 'ready' | 'blocked';
    decision: string;
  };
  families: PureArbitrageFamilySummary[];
  blockers: string[];
}

export interface LiveOpportunityFeed {
  schemaVersion: number;
  generatedAt: string;
  architecture: Record<string, unknown>;
  policy: Record<string, unknown>;
  summary: {
    sourceCount: number;
    loadedSourceCount: number;
    opportunityCount: number;
    actionableCount: number;
    watchCount: number;
    blockedCount: number;
    status: string;
  };
  sources: Array<Record<string, unknown>>;
  opportunities: Array<Record<string, unknown>>;
}

export async function loadCandidateArtifact(): Promise<CandidateArtifact> {
  const p = dataPath('strategy-candidates.json');
  const raw = await readFile(p, 'utf8');
  return JSON.parse(raw) as CandidateArtifact;
}

export async function loadCandidates(): Promise<StrategyCandidate[]> {
  return (await loadCandidateArtifact()).candidates;
}

export async function loadLiveOpportunityFeed(): Promise<LiveOpportunityFeed> {
  const raw = await readFile(dataPath('live-opportunity-feed.json'), 'utf8');
  return JSON.parse(raw) as LiveOpportunityFeed;
}

export async function loadLiveForkVerification(): Promise<Record<string, unknown>> {
  const raw = await readFile(dataPath('live-fork-verification.json'), 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

export async function loadExecutorNodeStatus(): Promise<Record<string, unknown>> {
  const raw = await readFile(dataPath('executor-node-status.json'), 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

export async function loadCandidateEventReplay(
  candidateId: string,
): Promise<CandidateEventReplayArtifact | null> {
  try {
    const p = dataPath(`event-replay-${candidateId}.json`);
    const raw = await readFile(p, 'utf8');
    return JSON.parse(raw) as CandidateEventReplayArtifact;
  } catch {
    return null;
  }
}

export async function loadDexArbitrageArtifact(): Promise<DexArbitrageArtifact | null> {
  try {
    const p = dataPath('dex-arbitrage-candidates.json');
    const raw = await readFile(p, 'utf8');
    return JSON.parse(raw) as DexArbitrageArtifact;
  } catch {
    return null;
  }
}

export async function loadDexArbitrageArtifacts(): Promise<DexArbitrageArtifacts | null> {
  let filenames: string[] = [];
  try {
    filenames = (await readdir(DATA_DIR))
      .filter(
        (filename) =>
          filename === 'dex-arbitrage-candidates.json' ||
          /^dex-arbitrage-candidates-[a-z0-9-]+\.json$/i.test(filename),
      )
      .sort();
  } catch {
    filenames = [];
  }
  const artifacts: DexArbitrageArtifact[] = [];
  for (const filename of filenames) {
    try {
      const raw = await readFile(dataPath(filename), 'utf8');
      artifacts.push(JSON.parse(raw) as DexArbitrageArtifact);
    } catch {
      // Invalid/missing chain artifacts are ignored; rerun search:dex-arb for that chain.
    }
  }
  if (!artifacts.length) return null;
  const candidates = artifacts.flatMap((artifact) => artifact.candidates);
  const passingCount = candidates.filter((candidate) => candidate.gate.status === 'pass').length;
  const requestedPassingCount = Math.max(
    5,
    ...artifacts.map((artifact) => artifact.summary.requestedPassingCount ?? 5),
  );
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      artifactCount: artifacts.length,
      candidateCount: candidates.length,
      passingCount,
      requestedPassingCount,
      status:
        passingCount >= requestedPassingCount
          ? 'found-at-least-five-passing-quote-backtests'
          : 'did-not-find-five-passing-quote-backtests',
    },
    artifacts,
    candidates,
  };
}

export async function loadCurveStableArbitrageArtifacts(): Promise<CurveStableArbitrageArtifacts | null> {
  let filenames: string[] = [];
  try {
    filenames = (await readdir(DATA_DIR))
      .filter(
        (filename) =>
          filename === 'curve-stable-arbitrage-candidates.json' ||
          /^curve-stable-arbitrage-candidates-[a-z0-9-]+\.json$/i.test(filename),
      )
      .sort();
  } catch {
    filenames = [];
  }
  const artifacts: CurveStableArbitrageArtifact[] = [];
  for (const filename of filenames) {
    try {
      const raw = await readFile(dataPath(filename), 'utf8');
      artifacts.push(JSON.parse(raw) as CurveStableArbitrageArtifact);
    } catch {
      // Invalid/missing Curve artifacts are ignored; rerun search:curve-stable-arb.
    }
  }
  if (!artifacts.length) return null;
  const candidates = artifacts.flatMap((artifact) => artifact.candidates);
  const passingCount = candidates.filter((candidate) => candidate.gate.status === 'pass').length;
  const requestedPassingCount = Math.max(
    5,
    ...artifacts.map((artifact) => artifact.summary.requestedPassingCount ?? 5),
  );
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      artifactCount: artifacts.length,
      candidateCount: candidates.length,
      passingCount,
      requestedPassingCount,
      status:
        passingCount >= requestedPassingCount
          ? 'found-at-least-five-passing-curve-stable-arbitrage-backtests'
          : 'did-not-find-five-passing-curve-stable-arbitrage-backtests',
    },
    artifacts,
    candidates,
  };
}

export async function loadBalancerArbitrageArtifacts(): Promise<BalancerArbitrageArtifacts | null> {
  let filenames: string[] = [];
  try {
    filenames = (await readdir(DATA_DIR))
      .filter(
        (filename) =>
          filename === 'balancer-arbitrage-candidates.json' ||
          /^balancer-arbitrage-candidates-[a-z0-9-]+\.json$/i.test(filename),
      )
      .sort();
  } catch {
    filenames = [];
  }
  const artifacts: BalancerArbitrageArtifact[] = [];
  for (const filename of filenames) {
    try {
      const raw = await readFile(dataPath(filename), 'utf8');
      artifacts.push(JSON.parse(raw) as BalancerArbitrageArtifact);
    } catch {
      // Invalid/missing Balancer artifacts are ignored; rerun search:balancer-arb.
    }
  }
  if (!artifacts.length) return null;
  const candidates = artifacts.flatMap((artifact) => artifact.candidates);
  const passingCount = candidates.filter((candidate) => candidate.gate.status === 'pass').length;
  const requestedPassingCount = Math.max(
    5,
    ...artifacts.map((artifact) => artifact.summary.requestedPassingCount ?? 5),
  );
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      artifactCount: artifacts.length,
      candidateCount: candidates.length,
      passingCount,
      requestedPassingCount,
      status:
        passingCount >= requestedPassingCount
          ? 'found-at-least-five-passing-balancer-arbitrage-backtests'
          : 'did-not-find-five-passing-balancer-arbitrage-backtests',
    },
    artifacts,
    candidates,
  };
}

export async function loadUniswapV3FeeArbitrageArtifacts(): Promise<UniswapV3FeeArbitrageArtifacts | null> {
  let filenames: string[] = [];
  try {
    filenames = (await readdir(DATA_DIR))
      .filter(
        (filename) =>
          filename === 'uniswap-v3-fee-arbitrage-candidates.json' ||
          /^uniswap-v3-fee-arbitrage-candidates-[a-z0-9-]+\.json$/i.test(filename),
      )
      .sort();
  } catch {
    filenames = [];
  }
  const artifacts: UniswapV3FeeArbitrageArtifact[] = [];
  for (const filename of filenames) {
    try {
      const raw = await readFile(dataPath(filename), 'utf8');
      artifacts.push(JSON.parse(raw) as UniswapV3FeeArbitrageArtifact);
    } catch {
      // Invalid/missing Uniswap V3 fee artifacts are ignored; rerun search:uniswap-v3-fee-arb.
    }
  }
  if (!artifacts.length) return null;
  const candidates = artifacts.flatMap((artifact) => artifact.candidates);
  const passingCount = candidates.filter((candidate) => candidate.gate.status === 'pass').length;
  const requestedPassingCount = Math.max(
    5,
    ...artifacts.map((artifact) => artifact.summary.requestedPassingCount ?? 5),
  );
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      artifactCount: artifacts.length,
      candidateCount: candidates.length,
      passingCount,
      requestedPassingCount,
      status:
        passingCount >= requestedPassingCount
          ? 'found-at-least-five-passing-uniswap-v3-fee-arbitrage-backtests'
          : 'did-not-find-five-passing-uniswap-v3-fee-arbitrage-backtests',
    },
    artifacts,
    candidates,
  };
}

export async function loadPendlePtArbitrageArtifacts(): Promise<PendlePtArbitrageArtifacts | null> {
  let filenames: string[] = [];
  try {
    filenames = (await readdir(DATA_DIR))
      .filter(
        (filename) =>
          filename === 'pendle-pt-arbitrage-candidates.json' ||
          /^pendle-pt-arbitrage-candidates-[a-z0-9-]+\.json$/i.test(filename),
      )
      .sort();
  } catch {
    filenames = [];
  }
  const artifacts: PendlePtArbitrageArtifact[] = [];
  for (const filename of filenames) {
    try {
      const raw = await readFile(dataPath(filename), 'utf8');
      artifacts.push(JSON.parse(raw) as PendlePtArbitrageArtifact);
    } catch {
      // Invalid/missing Pendle artifacts are ignored; rerun search:pendle-pt-arb.
    }
  }
  if (!artifacts.length) return null;
  const candidates = artifacts.flatMap((artifact) => artifact.candidates);
  const passingCount = candidates.filter((candidate) => candidate.gate.status === 'pass').length;
  const requestedPassingCount = Math.max(
    5,
    ...artifacts.map((artifact) => artifact.summary.requestedPassingCount ?? 5),
  );
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      artifactCount: artifacts.length,
      candidateCount: candidates.length,
      passingCount,
      requestedPassingCount,
      status:
        passingCount >= requestedPassingCount
          ? 'found-at-least-five-passing-pendle-pt-carry-candidates'
          : 'did-not-find-five-passing-pendle-pt-carry-candidates',
    },
    artifacts,
    candidates,
  };
}

export async function loadAaveLiquidationArtifacts(): Promise<AaveLiquidationArtifacts | null> {
  let filenames: string[] = [];
  try {
    filenames = (await readdir(DATA_DIR))
      .filter(
        (filename) =>
          filename === 'aave-liquidation-candidates.json' ||
          /^aave-liquidation-candidates-[a-z0-9-]+\.json$/i.test(filename),
      )
      .sort();
  } catch {
    filenames = [];
  }
  const artifacts: AaveLiquidationArtifact[] = [];
  for (const filename of filenames) {
    try {
      const raw = await readFile(dataPath(filename), 'utf8');
      artifacts.push(JSON.parse(raw) as AaveLiquidationArtifact);
    } catch {
      // Invalid/missing chain artifacts are ignored; rerun search:liquidations for that chain.
    }
  }
  if (!artifacts.length) return null;
  const candidates = artifacts.flatMap((artifact) => artifact.candidates);
  const passingCount = candidates.filter((candidate) => candidate.gate.status === 'pass').length;
  const requestedPassingCount = Math.max(
    5,
    ...artifacts.map((artifact) => artifact.summary.requestedPassingCount ?? 5),
  );
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      artifactCount: artifacts.length,
      candidateCount: candidates.length,
      passingCount,
      requestedPassingCount,
      status:
        passingCount >= requestedPassingCount
          ? 'found-at-least-five-passing-liquidation-opportunities'
          : 'did-not-find-five-passing-liquidation-opportunities',
    },
    artifacts,
    candidates,
  };
}

export async function loadAaveLiquidationReplayArtifacts(): Promise<AaveLiquidationArtifacts | null> {
  let filenames: string[] = [];
  try {
    filenames = (await readdir(DATA_DIR))
      .filter(
        (filename) =>
          filename === 'aave-liquidation-event-replay-candidates.json' ||
          /^aave-liquidation-event-replay-candidates-[a-z0-9-]+\.json$/i.test(filename),
      )
      .sort();
  } catch {
    filenames = [];
  }
  const artifacts: AaveLiquidationArtifact[] = [];
  for (const filename of filenames) {
    try {
      const raw = await readFile(dataPath(filename), 'utf8');
      artifacts.push(JSON.parse(raw) as AaveLiquidationArtifact);
    } catch {
      // Invalid/missing event replay artifacts are ignored; rerun replay:aave-liquidations.
    }
  }
  if (!artifacts.length) return null;
  const candidates = artifacts.flatMap((artifact) => artifact.candidates);
  const passingCount = candidates.filter((candidate) => candidate.gate.status === 'pass').length;
  const requestedPassingCount = Math.max(
    5,
    ...artifacts.map((artifact) => artifact.summary.requestedPassingCount ?? 5),
  );
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      artifactCount: artifacts.length,
      candidateCount: candidates.length,
      passingCount,
      requestedPassingCount,
      status:
        passingCount >= requestedPassingCount
          ? 'found-at-least-five-passing-aave-liquidation-event-replays'
          : 'did-not-find-five-passing-aave-liquidation-event-replays',
    },
    artifacts,
    candidates,
  };
}

export async function loadCompoundV3LiquidationArtifacts(): Promise<CompoundV3LiquidationArtifacts | null> {
  let filenames: string[] = [];
  try {
    filenames = (await readdir(DATA_DIR))
      .filter(
        (filename) =>
          filename === 'compound-v3-liquidation-candidates.json' ||
          /^compound-v3-liquidation-candidates-[a-z0-9-]+\.json$/i.test(filename),
      )
      .sort();
  } catch {
    filenames = [];
  }
  const artifacts: CompoundV3LiquidationArtifact[] = [];
  for (const filename of filenames) {
    try {
      const raw = await readFile(dataPath(filename), 'utf8');
      artifacts.push(JSON.parse(raw) as CompoundV3LiquidationArtifact);
    } catch {
      // Invalid/missing chain artifacts are ignored; rerun search:compound-liquidations.
    }
  }
  if (!artifacts.length) return null;
  const candidates = artifacts.flatMap((artifact) => artifact.candidates);
  const passingCount = candidates.filter((candidate) => candidate.gate.status === 'pass').length;
  const requestedPassingCount = Math.max(
    5,
    ...artifacts.map((artifact) => artifact.summary.requestedPassingCount ?? 5),
  );
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      artifactCount: artifacts.length,
      candidateCount: candidates.length,
      passingCount,
      requestedPassingCount,
      status:
        passingCount >= requestedPassingCount
          ? 'found-at-least-five-passing-compound-v3-liquidation-opportunities'
          : 'did-not-find-five-passing-compound-v3-liquidation-opportunities',
    },
    artifacts,
    candidates,
  };
}

export async function loadMorphoBlueLiquidationArtifacts(): Promise<MorphoBlueLiquidationArtifacts | null> {
  let filenames: string[] = [];
  try {
    filenames = (await readdir(DATA_DIR))
      .filter(
        (filename) =>
          filename === 'morpho-blue-liquidation-candidates.json' ||
          /^morpho-blue-liquidation(?:-event-replay)?-candidates-[a-z0-9-]+\.json$/i.test(filename),
      )
      .sort();
  } catch {
    filenames = [];
  }
  const artifacts: MorphoBlueLiquidationArtifact[] = [];
  for (const filename of filenames) {
    try {
      const raw = await readFile(dataPath(filename), 'utf8');
      artifacts.push(JSON.parse(raw) as MorphoBlueLiquidationArtifact);
    } catch {
      // Invalid/missing chain artifacts are ignored; rerun search:morpho-liquidations.
    }
  }
  if (!artifacts.length) return null;
  const candidates = artifacts.flatMap((artifact) => artifact.candidates);
  const passingCount = candidates.filter((candidate) => candidate.gate.status === 'pass').length;
  const requestedPassingCount = Math.max(
    5,
    ...artifacts.map((artifact) => artifact.summary.requestedPassingCount ?? 5),
  );
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      artifactCount: artifacts.length,
      candidateCount: candidates.length,
      passingCount,
      requestedPassingCount,
      status:
        passingCount >= requestedPassingCount
          ? 'found-at-least-five-passing-morpho-blue-liquidation-opportunities'
          : 'did-not-find-five-passing-morpho-blue-liquidation-opportunities',
    },
    artifacts,
    candidates,
  };
}

export async function loadMorphoBlueLiquidationWatchlist(): Promise<Record<string, unknown> | null> {
  const candidates = [
    'morpho-blue-liquidation-watchlist-ethereum.json',
    'morpho-blue-liquidation-watchlist-base.json',
  ];
  for (const filename of candidates) {
    try {
      const raw = await readFile(dataPath(filename), 'utf8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Try the next chain-specific watchlist.
    }
  }
  return null;
}

export async function loadAaveLiquidationWatchlist(): Promise<Record<string, unknown> | null> {
  const candidates = [
    'aave-liquidation-watchlist-ethereum.json',
    'aave-liquidation-watchlist-base.json',
    'aave-liquidation-watchlist-arbitrum.json',
    'aave-liquidation-watchlist-polygon.json',
  ];
  for (const filename of candidates) {
    try {
      const raw = await readFile(dataPath(filename), 'utf8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Try the next chain-specific watchlist.
    }
  }
  return null;
}

export async function loadPureArbitrageSearchOverview(): Promise<PureArbitrageSearchOverview> {
  const [
    dex,
    liquidations,
    aaveLiquidationReplay,
    curveStable,
    compoundLiquidations,
    morphoLiquidations,
    balancer,
    uniswapV3Fee,
    pendlePt,
  ] =
    await Promise.all([
      loadDexArbitrageArtifacts(),
      loadAaveLiquidationArtifacts(),
      loadAaveLiquidationReplayArtifacts(),
      loadCurveStableArbitrageArtifacts(),
      loadCompoundV3LiquidationArtifacts(),
      loadMorphoBlueLiquidationArtifacts(),
      loadBalancerArbitrageArtifacts(),
      loadUniswapV3FeeArbitrageArtifacts(),
      loadPendlePtArbitrageArtifacts(),
    ]);
  const families = [
    buildFamilySummary({
      key: 'dex-quote-replay',
      label: 'DEX quote replay',
      strategyClass: 'atomic AMM / DEX-to-DEX arbitrage',
      artifacts: dex,
      endpoint: '/api/dex-arbitrage-candidates/artifacts',
      runCommand: 'DEX_ARB_CHAIN=<chain> npm run search:dex-arb',
      liveEndpointPrefix: '/api/dex-arbitrage-candidates',
      executionPlanEndpointPrefix: '/api/dex-arbitrage-candidates',
    }),
    buildFamilySummary({
      key: 'aave-liquidations',
      label: 'Aave V3 liquidations',
      strategyClass: 'lending liquidation arbitrage',
      artifacts: liquidations,
      endpoint: '/api/aave-liquidation-candidates/artifacts',
      runCommand: 'LIQ_CHAIN=<chain> npm run search:liquidations',
      liveEndpointPrefix: '/api/aave-liquidation-candidates',
      executionPlanEndpointPrefix: '/api/aave-liquidation-candidates',
    }),
    buildFamilySummary({
      key: 'aave-liquidation-replay',
      label: 'Aave V3 liquidation event replay',
      strategyClass: 'historical lending liquidation event replay',
      artifacts: aaveLiquidationReplay,
      endpoint: '/api/aave-liquidation-replay-candidates/artifacts',
      runCommand: 'AAVE_REPLAY_CHAIN=<chain> npm run replay:aave-liquidations',
      liveEndpointPrefix: '/api/aave-liquidation-replay-candidates',
      executionPlanEndpointPrefix: '/api/aave-liquidation-replay-candidates',
    }),
    buildFamilySummary({
      key: 'curve-stable-arb',
      label: 'Curve stable arbitrage',
      strategyClass: 'Curve stable pool / Uniswap V3 arbitrage',
      artifacts: curveStable,
      endpoint: '/api/curve-stable-arbitrage-candidates/artifacts',
      runCommand: 'npm run search:curve-stable-arb',
      liveEndpointPrefix: '/api/curve-stable-arbitrage-candidates',
      executionPlanEndpointPrefix: '/api/curve-stable-arbitrage-candidates',
    }),
    buildFamilySummary({
      key: 'compound-v3-liquidations',
      label: 'Compound V3 liquidations',
      strategyClass: 'lending liquidation arbitrage',
      artifacts: compoundLiquidations,
      endpoint: '/api/pure-arbitrage/overview',
      runCommand: 'COMP_LIQ_CHAIN=ethereum npm run search:compound-liquidations',
      liveEndpointPrefix: '/api/pure-arbitrage/overview',
      executionPlanEndpointPrefix: '/api/pure-arbitrage/overview',
    }),
    buildFamilySummary({
      key: 'morpho-blue-liquidations',
      label: 'Morpho Blue liquidations',
      strategyClass: 'lending liquidation arbitrage',
      artifacts: morphoLiquidations,
      endpoint: '/api/pure-arbitrage/overview',
      runCommand: 'MORPHO_LIQ_CHAIN=ethereum npm run search:morpho-liquidations',
      liveEndpointPrefix: '/api/pure-arbitrage/overview',
      executionPlanEndpointPrefix: '/api/pure-arbitrage/overview',
    }),
    buildFamilySummary({
      key: 'balancer-v2-arb',
      label: 'Balancer V2 arbitrage',
      strategyClass: 'Balancer V2 Vault / Uniswap V3 arbitrage',
      artifacts: balancer,
      endpoint: '/api/balancer-arbitrage-candidates/artifacts',
      runCommand: 'npm run search:balancer-arb',
      liveEndpointPrefix: '/api/balancer-arbitrage-candidates',
      executionPlanEndpointPrefix: '/api/balancer-arbitrage-candidates',
    }),
    buildFamilySummary({
      key: 'uniswap-v3-fee-arb',
      label: 'Uniswap V3 cross-fee arbitrage',
      strategyClass: 'Uniswap V3 same-pair cross-fee-tier arbitrage',
      artifacts: uniswapV3Fee,
      endpoint: '/api/uniswap-v3-fee-arbitrage-candidates/artifacts',
      runCommand: 'UNI_FEE_ARB_CHAIN=<chain> npm run search:uniswap-v3-fee-arb',
      liveEndpointPrefix: '/api/uniswap-v3-fee-arbitrage-candidates',
      executionPlanEndpointPrefix: '/api/uniswap-v3-fee-arbitrage-candidates',
    }),
    buildFamilySummary({
      key: 'pendle-pt-arb',
      label: 'Pendle PT fixed-yield convergence',
      strategyClass: 'Pendle PT carry / maturity convergence',
      artifacts: pendlePt,
      endpoint: '/api/pendle-pt-arbitrage-candidates/artifacts',
      runCommand: 'npm run search:pendle-pt-arb',
      liveEndpointPrefix: '/api/pendle-pt-arbitrage-candidates',
      executionPlanEndpointPrefix: '/api/pendle-pt-arbitrage-candidates',
    }),
  ];
  const requestedPassingCount = 5;
  const artifactCount = families.reduce((sum, family) => sum + family.artifactCount, 0);
  const candidateCount = families.reduce((sum, family) => sum + family.candidateCount, 0);
  const passingCount = families.reduce((sum, family) => sum + family.passingCount, 0);
  const liveExecutionStatus = passingCount >= requestedPassingCount ? 'ready' : 'blocked';
  const blockers = buildOverviewBlockers(families, requestedPassingCount, passingCount);
  return {
    generatedAt: new Date().toISOString(),
    objective: {
      requestedPassingStrategies: requestedPassingCount,
      minAnnualizedNetReturnPct: 20,
      pureOnChainOnly: true,
      noCexRequired: true,
    },
    summary: {
      familyCount: families.length,
      artifactCount,
      candidateCount,
      passingCount,
      requestedPassingCount,
      status:
        passingCount >= requestedPassingCount
          ? 'found-at-least-five-passing-pure-on-chain-backtests'
          : 'did-not-find-five-passing-pure-on-chain-backtests',
      liveExecutionStatus,
      decision:
        liveExecutionStatus === 'ready'
          ? 'candidate evidence threshold met; each route still requires fresh quote, fork simulation, and adapter gates'
          : 'keep live execution blocked; current evidence does not support five stable 20%+ pure on-chain strategies',
    },
    families,
    blockers,
  };
}

function buildFamilySummary({
  key,
  label,
  strategyClass,
  artifacts,
  endpoint,
  runCommand,
  liveEndpointPrefix,
  executionPlanEndpointPrefix,
}: {
  key: string;
  label: string;
  strategyClass: string;
  artifacts:
    | DexArbitrageArtifacts
    | AaveLiquidationArtifacts
    | CurveStableArbitrageArtifacts
    | CompoundV3LiquidationArtifacts
    | MorphoBlueLiquidationArtifacts
    | BalancerArbitrageArtifacts
    | UniswapV3FeeArbitrageArtifacts
    | null;
  endpoint: string;
  runCommand: string;
  liveEndpointPrefix: string;
  executionPlanEndpointPrefix: string;
}): PureArbitrageFamilySummary {
  const candidates = artifacts?.candidates ?? [];
  return {
    key,
    label,
    strategyClass,
    artifactCount: artifacts?.summary.artifactCount ?? 0,
    candidateCount: artifacts?.summary.candidateCount ?? 0,
    passingCount: artifacts?.summary.passingCount ?? 0,
    requestedPassingCount: artifacts?.summary.requestedPassingCount ?? 5,
    status: artifacts?.summary.status ?? 'artifact-missing',
    endpoint,
    runCommand,
    liveEndpointPrefix,
    executionPlanEndpointPrefix,
    topCandidates: candidates
      .map((candidate) => ({
        id: candidate.id,
        chain: candidate.chain,
        strategyType: candidate.strategyType,
        gateStatus: candidate.gate.status,
        gateReason: candidate.gate.reason,
        score: candidateScore(candidate),
      }))
      .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
      .slice(0, 5),
  };
}

function candidateScore(
  candidate:
    | DexArbitrageCandidate
    | AaveLiquidationCandidate
    | CompoundV3LiquidationCandidate
    | MorphoBlueLiquidationCandidate
    | UniswapV3FeeArbitrageCandidate,
): number | null {
  const metrics = 'metrics' in candidate ? candidate.metrics : undefined;
  const medianNetProfitUsd = readNestedNumber(metrics, ['medianNetProfitUsd']);
  if (medianNetProfitUsd != null) return medianNetProfitUsd;
  const nestedMedian = readNestedNumber(metrics, ['netProfitUsd', 'median']);
  if (nestedMedian != null) return nestedMedian;
  const bestEstimate = 'bestEstimate' in candidate ? candidate.bestEstimate : undefined;
  if (bestEstimate && Number.isFinite(bestEstimate.netProfitUsd)) return bestEstimate.netProfitUsd;
  return null;
}

function readNestedNumber(value: unknown, path: string[]): number | null {
  let current: unknown = value;
  for (const part of path) {
    if (!current || typeof current !== 'object' || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : null;
}

function buildOverviewBlockers(
  families: PureArbitrageFamilySummary[],
  requestedPassingCount: number,
  passingCount: number,
): string[] {
  const blockers = [];
  if (passingCount < requestedPassingCount) {
    blockers.push(
      `only ${passingCount}/${requestedPassingCount} pure on-chain candidates currently pass evidence gates`,
    );
  }
  for (const family of families) {
    if (!family.artifactCount) {
      blockers.push(`${family.label} artifact is missing; run ${family.runCommand}`);
    } else if (!family.passingCount) {
      blockers.push(`${family.label} has ${family.candidateCount} candidates but 0 passing gates`);
    }
  }
  blockers.push('production adapters and same-block fork simulations remain required before any route can run');
  blockers.push('the system must not advertise guaranteed or stable 20%+ APY from the current evidence');
  return blockers;
}
