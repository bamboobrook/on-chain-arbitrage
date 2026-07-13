import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  AaveLiquidationCandidate,
  CompoundV3LiquidationCandidate,
  DexArbitrageCandidate,
  MorphoBlueLiquidationCandidate,
  StrategyCandidate,
} from './candidates.js';

export interface ExecutionPlanRequest {
  walletAddress?: string;
  capital?: string;
  maxSlippageBps?: number;
  maxGasUsd?: number;
}

export interface LiveRunRequest extends ExecutionPlanRequest {
  autoStart?: boolean;
}

export interface CandidateExecutionPlan {
  id: string;
  candidateId: string;
  generatedAt: string;
  mode: 'dry-run';
  status: 'template-ready' | 'needs-adapter' | 'unsupported';
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
  approvals: ApprovalPlan[];
  transactions: TransactionPlan[];
  riskLimits: RiskLimit[];
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

export interface DexArbitrageExecutionPlan {
  id: string;
  candidateId: string;
  generatedAt: string;
  mode: 'dry-run';
  status: 'blocked' | 'needs-deployment' | 'fork-simulation-required';
  strategyId: 'atomic-amm';
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
  approvals: ApprovalPlan[];
  transactions: TransactionPlan[];
  riskLimits: RiskLimit[];
  preflightChecks: string[];
  forkSimulation: {
    required: true;
    status: 'blocked' | 'required';
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

export interface AaveLiquidationExecutionPlan {
  id: string;
  candidateId: string;
  generatedAt: string;
  mode: 'dry-run';
  status: 'blocked' | 'needs-deployment' | 'fork-simulation-required';
  strategyId: 'atomic-amm';
  chainId: number | null;
  chain: string;
  strategyType: 'aave-v3-liquidation-arbitrage';
  capital: string;
  borrower: string;
  liquidation: {
    pool: string | null;
    debtAsset: string | null;
    debtSymbol: string | null;
    collateralAsset: string | null;
    collateralSymbol: string | null;
    debtToCoverUsd: number | null;
    debtToCover: string | null;
    debtToCoverSource: string | null;
    seizedCollateralUsd: number | null;
    seizedCollateralAmount: string | null;
    seizedCollateralBaseUnits: string | null;
    seizedCollateralSource: string | null;
    receiveAToken: false;
    liquidationCallSelector: string;
  };
  executor: {
    role: string;
    address: string | null;
    verification: string;
  };
  approvals: ApprovalPlan[];
  transactions: TransactionPlan[];
  riskLimits: RiskLimit[];
  preflightChecks: string[];
  forkSimulation: {
    required: true;
    status: 'blocked' | 'required';
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

export interface CompoundV3LiquidationExecutionPlan {
  id: string;
  candidateId: string;
  generatedAt: string;
  mode: 'dry-run';
  status: 'blocked' | 'needs-deployment' | 'fork-simulation-required';
  strategyId: 'atomic-amm';
  chainId: number | null;
  chain: string;
  strategyType: 'compound-v3-liquidation-arbitrage';
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
  approvals: ApprovalPlan[];
  transactions: TransactionPlan[];
  riskLimits: RiskLimit[];
  preflightChecks: string[];
  forkSimulation: {
    required: true;
    status: 'blocked' | 'required';
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

export interface MorphoBlueLiquidationExecutionPlan {
  id: string;
  candidateId: string;
  generatedAt: string;
  mode: 'dry-run';
  status: 'blocked' | 'needs-deployment' | 'fork-simulation-required';
  strategyId: 'atomic-amm';
  chainId: number | null;
  chain: string;
  strategyType: 'morpho-blue-liquidation-arbitrage';
  capital: string;
  borrower: string;
  liquidation: {
    morpho: string | null;
    marketId: string;
    marketParams: MorphoBlueLiquidationCandidate['marketParams'];
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
  approvals: ApprovalPlan[];
  transactions: TransactionPlan[];
  riskLimits: RiskLimit[];
  preflightChecks: string[];
  forkSimulation: {
    required: true;
    status: 'blocked' | 'required';
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

export interface LiveRunRecord {
  id: string;
  candidate_id: string;
  strategy_id: string;
  status: string;
  chain_id: number | null;
  wallet_address: string | null;
  capital: string;
  plan:
    | CandidateExecutionPlan
    | DexArbitrageExecutionPlan
    | AaveLiquidationExecutionPlan
    | CompoundV3LiquidationExecutionPlan
    | MorphoBlueLiquidationExecutionPlan;
  risk_limits: unknown;
  blocked_by: string[];
  last_error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  stopped_at: string | null;
}

export interface ApprovalPlan {
  token: string;
  spender: string | null;
  amount: string;
  reason: string;
}

export interface TransactionPlan {
  label: string;
  to: string | null;
  value: string;
  method: string;
  selector: string | null;
  calldataStatus: 'template-only' | 'quote-required' | 'ready-after-quote' | 'fork-gated';
  calldata?: string | null;
  calldataBytes?: number | null;
  params: Record<string, unknown>;
  notes: string[];
}

export interface RiskLimit {
  key: string;
  value: string | number;
  unit?: string;
}

const CHAIN_IDS: Record<string, number> = {
  Ethereum: 1,
  Base: 8453,
  Arbitrum: 42161,
  Optimism: 10,
  Polygon: 137,
  BNB: 56,
};

const UNISWAP_V3_POSITION_MANAGERS: Record<number, string> = {
  1: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  8453: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
};

const AERODROME_SLIPSTREAM_POSITION_MANAGERS: Record<number, string> = {
  8453: '0x827922686190790b37229fd06084350E74485b72',
};

const UNISWAP_V3_MINT_SELECTOR = '0x88316456';
const UNISWAP_V3_INCREASE_LIQUIDITY_SELECTOR = '0x219f5d17';
const SLIPSTREAM_MINT_SELECTOR = '0xb5007d1f';
const CURVE_ADD_LIQUIDITY_2_SELECTOR = '0x0b4c7e4d';
const ERC20_APPROVE_SELECTOR = '0x095ea7b3';
const AAVE_V3_LIQUIDATION_CALL_SELECTOR = '0x00a718a9';
const AAVE_V3_FLASH_LOAN_SIMPLE_SELECTOR = '0x42b0b77c';
const AAVE_V3_EXECUTE_LIQUIDATION_SELECTOR = '0xb6b5f0e7';
const COMPOUND_V3_ABSORB_SELECTOR = '0xc3cecfd2';
const COMPOUND_V3_BUY_COLLATERAL_SELECTOR = '0xe4e6e779';
const MORPHO_BLUE_LIQUIDATE_SELECTOR = '0xd8eabcb8';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

interface ExecutorDeploymentRecord {
  address?: string | null;
  chainId?: number | string | null;
  chain?: string | null;
  contract?: string | null;
  aavePool?: string | null;
  comet?: string | null;
  morpho?: string | null;
  verified?: boolean | string | null;
  txHash?: string | null;
  blockNumber?: number | string | null;
}

interface ExecutorDeploymentManifest {
  schemaVersion?: number;
  generatedAt?: string;
  deployments?: Record<string, Record<string, ExecutorDeploymentRecord> | ExecutorDeploymentRecord>;
  chains?: Record<string, Record<string, ExecutorDeploymentRecord> | ExecutorDeploymentRecord>;
  executors?: Record<string, Record<string, ExecutorDeploymentRecord> | ExecutorDeploymentRecord>;
}

function isAddress(value: unknown): value is string {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value ?? ''));
}

function stripHex(value: string): string {
  return value.replace(/^0x/i, '');
}

function encodeAbiAddress(value: string | null | undefined): string | null {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
  return stripHex(value).toLowerCase().padStart(64, '0');
}

function encodeAbiUint(value: string | number | bigint | null | undefined): string | null {
  if (value == null || value === '') return null;
  try {
    const n = BigInt(value);
    if (n < 0n) return null;
    return n.toString(16).padStart(64, '0');
  } catch {
    return null;
  }
}

function encodeAbiBool(value: boolean): string {
  return (value ? 1n : 0n).toString(16).padStart(64, '0');
}

function encodeAbiBytes(value: string | null | undefined): string | null {
  const normalized = value ?? '0x';
  if (!/^0x[0-9a-fA-F]*$/.test(normalized) || stripHex(normalized).length % 2 !== 0) {
    return null;
  }
  const clean = stripHex(normalized).toLowerCase();
  const byteLength = clean.length / 2;
  const paddedLength = Math.ceil(clean.length / 64) * 64;
  return `${encodeAbiUint(byteLength)}${clean.padEnd(paddedLength, '0')}`;
}

function buildAaveLiquidationCallCalldata(
  collateralAsset: string | null,
  debtAsset: string | null,
  user: string,
  debtToCover: string | null,
  receiveAToken: boolean,
): string | null {
  const words = [
    encodeAbiAddress(collateralAsset),
    encodeAbiAddress(debtAsset),
    encodeAbiAddress(user),
    encodeAbiUint(debtToCover),
    encodeAbiBool(receiveAToken),
  ];
  if (!words.every((word): word is string => word != null)) return null;
  return `${AAVE_V3_LIQUIDATION_CALL_SELECTOR}${words.join('')}`;
}

function buildAaveExecutorLiquidationCalldata(params: {
  debtAsset: string | null;
  debtToCover: string | null;
  collateralAsset: string | null;
  borrower: string;
  receiveAToken: boolean;
  unwindTarget?: string | null;
  unwindCalldata?: string | null;
  minDebtAssetOut?: string | number | bigint | null;
  minProfit?: string | number | bigint | null;
  beneficiary?: string | null;
}): string | null {
  const unwindTarget = params.unwindTarget ?? ZERO_ADDRESS;
  const beneficiary = params.beneficiary ?? ZERO_ADDRESS;
  const unwindCalldata = params.unwindCalldata ?? '0x';
  const topWords = [
    encodeAbiAddress(params.debtAsset),
    encodeAbiUint(params.debtToCover),
    encodeAbiUint(96),
  ];
  const tupleHead = [
    encodeAbiAddress(params.collateralAsset),
    encodeAbiAddress(params.borrower),
    encodeAbiUint(params.debtToCover),
    encodeAbiBool(params.receiveAToken),
    encodeAbiAddress(unwindTarget),
    encodeAbiUint(9 * 32),
    encodeAbiUint(params.minDebtAssetOut ?? 0),
    encodeAbiUint(params.minProfit ?? 0),
    encodeAbiAddress(beneficiary),
  ];
  const encodedBytes = encodeAbiBytes(unwindCalldata);
  const words = [...topWords, ...tupleHead, encodedBytes];
  if (!words.every((word): word is string => word != null)) return null;
  return `${AAVE_V3_EXECUTE_LIQUIDATION_SELECTOR}${words.join('')}`;
}

const AAVE_V3_POOLS: Record<number, string> = {
  1: '0x87870Bca3F3fD6335C3F4cE8392D69350B4fA4E2',
  8453: '0xA238Dd80C259a72e81d7e4664a9801593f98d1c5',
  42161: '0x794a61358D6845594F94dC1dB02A252b5b4814aD',
  137: '0x794a61358D6845594F94dC1dB02A252b5b4814aD',
};

const COMPOUND_V3_COMETS: Record<number, string> = {
  1: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
};

const MORPHO_BLUE_CONTRACTS: Record<number, string> = {
  1: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
  8453: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
};

const DEX_ROUTER_CONTRACTS: Record<number, Record<string, string>> = {
  1: {
    'uniswap-v3': '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    'sushiswap-v2': '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
    'curve-3pool': '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7',
    'balancer-v2': '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  },
  8453: {
    'uniswap-v3': '0x2626664c2603336E57B271c5C0b26F421741e481',
    aerodrome: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  },
  42161: {
    'uniswap-v3': '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    'sushiswap-v2': '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506',
  },
  10: {
    'uniswap-v3': '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    'sushiswap-v2': '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506',
  },
  137: {
    'uniswap-v3': '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    'quickswap-v2': '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
  },
  56: {
    'uniswap-v3': '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2',
    'pancakeswap-v2': '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  },
};

const DEX_ADAPTER_REQUIREMENTS: Record<string, string> = {
  'uniswap-v3': 'UniswapV3Adapter',
  aerodrome: 'UniversalDexAdapter or dedicated Aerodrome adapter',
  'sushiswap-v2': 'UniswapV2Adapter',
  'quickswap-v2': 'UniswapV2Adapter',
  'pancakeswap-v2': 'UniswapV2Adapter',
  'curve-3pool': 'CurveStableSwapAdapter',
  'balancer-v2': 'BalancerV2VaultAdapter',
};

export function buildCandidateExecutionPlan(
  candidate: StrategyCandidate,
  request: ExecutionPlanRequest,
): CandidateExecutionPlan {
  const chainId = CHAIN_IDS[candidate.chain] ?? null;
  const capital = request.capital ?? '0';
  const protocol = candidate.project.toLowerCase();

  if (protocol.includes('uniswap-v3')) {
    return buildUniswapV3Plan(candidate, chainId, capital, request);
  }
  if (protocol.includes('aerodrome-slipstream')) {
    return buildSlipstreamPlan(candidate, chainId, capital, request);
  }
  if (protocol.includes('curve')) {
    return buildCurvePlan(candidate, chainId, capital, request);
  }

  return basePlan(candidate, chainId, capital, request, {
    adapter: 'unsupported',
    status: 'unsupported',
    role: 'adapter',
    address: null,
    verification: 'no live adapter template exists for this protocol yet',
    approvals: [],
    transactions: [],
    blockedBy: [`unsupported protocol ${candidate.project}`],
  });
}

export function buildDexArbitrageExecutionPlan(
  candidate: DexArbitrageCandidate,
  request: ExecutionPlanRequest,
): DexArbitrageExecutionPlan {
  const chainId = CHAIN_IDS[candidate.chain] ?? null;
  const capital = request.capital ?? candidate.amountIn;
  const tokenPath = buildDexTokenPath(candidate);
  const dexPath = buildDexPath(candidate);
  const executorAddress = readConfiguredWalletAtomicArbitrageExecutorAddress(chainId);
  const requiredRouters = dexPath.map((dex) => {
    const address = chainId == null ? null : (DEX_ROUTER_CONTRACTS[chainId]?.[dex] ?? null);
    return {
      dex,
      address,
      verification: address
        ? 'canonical router or pool address from the scan profile; verify on block explorer before production'
        : 'router or pool address is missing from the execution profile',
    };
  });
  const requiredAdapters = dexPath.map((dex) => ({
    dex,
    adapter: DEX_ADAPTER_REQUIREMENTS[dex] ?? 'adapter required',
    status: DEX_ADAPTER_REQUIREMENTS[dex]
      ? 'contract must be deployed, whitelisted, and fork-tested'
      : 'not implemented',
  }));
  const missingRouters = requiredRouters
    .filter((router) => !router.address)
    .map((router) => router.dex);
  const gatePassed = candidate.gate.status === 'pass';
  const blockedBy = buildDexArbitrageBlockers(candidate, executorAddress, missingRouters);
  const status: DexArbitrageExecutionPlan['status'] = !gatePassed
    ? 'blocked'
    : !executorAddress || missingRouters.length
      ? 'needs-deployment'
      : 'fork-simulation-required';

  return {
    id: `dex-plan-${candidate.id}`,
    candidateId: candidate.id,
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    status,
    strategyId: 'atomic-amm',
    chainId,
    chain: candidate.chain,
    strategyType: candidate.strategyType,
    capital,
    route: {
      tokenPath,
      dexPath,
      amountIn: candidate.amountIn,
      amountInHuman: candidate.amountInHuman,
    },
    executor: {
      role: 'WalletAtomicArbitrageExecutor atomic arbitrage entrypoint',
      address: executorAddress,
      verification: executorAddress
        ? 'configured through env override or data/executor-deployments.json; must be verified and audited before live use'
        : 'no deployed wallet atomic arbitrage executor configured for this chain',
    },
    requiredRouters,
    requiredAdapters,
    approvals: [
      {
        token: candidate.startToken.address,
        spender: executorAddress,
        amount: candidate.amountIn,
        reason:
          'the wallet atomic executor must pull the start token from the connected wallet before the route can run',
      },
    ],
    transactions: [
      {
        label: 'Approve start token to atomic arbitrage executor',
        to: candidate.startToken.address,
        value: '0',
        method: 'approve(address,uint256)',
        selector: ERC20_APPROVE_SELECTOR,
        calldataStatus: 'template-only',
        params: {
          spender: executorAddress ?? 'executor-deployment-required',
          amount: candidate.amountIn,
          token: candidate.startToken.symbol,
        },
        notes: [
          'Only approve after the executor address is deployed, verified, and matched to the fork-tested plan.',
        ],
      },
      {
        label: 'Execute atomic DEX arbitrage route',
        to: executorAddress,
        value: '0',
        method: 'WalletAtomicArbitrageExecutor.execute((address,uint256,(address,address,address,address,uint256)[],uint256,uint256,address))',
        selector: null,
        calldataStatus: 'quote-required',
        params: {
          chainId,
          tokenPath,
          dexPath,
          amountIn: candidate.amountIn,
          amountInHuman: candidate.amountInHuman,
          minProfitUsd: 'must be positive after gas and slippage at the current block',
          maxSlippageBps: request.maxSlippageBps ?? 30,
          maxGasUsd: request.maxGasUsd ?? 25,
          routers: requiredRouters,
          adapters: requiredAdapters,
        },
        notes: [
          'The route must be executed atomically with revert-on-loss behavior.',
          'Calldata remains locked until a fresh quote and fork simulation pass for the same block window.',
        ],
      },
    ],
    riskLimits: buildDexArbitrageRiskLimits(candidate, request),
    preflightChecks: buildDexArbitragePreflightChecks(candidate),
    forkSimulation: {
      required: true,
      status: gatePassed ? 'required' : 'blocked',
      requirements: [
        'fresh multi-DEX quote at the current block',
        'gas estimate using the same wallet, token allowance, and executor address',
        'fork simulation proving atomic revert on negative profit',
        'adapter whitelist and router addresses must match the generated execution plan',
      ],
    },
    blockedBy,
    evidence: {
      isPureArbitrage: candidate.isPureArbitrage,
      gate: candidate.gate,
      metrics: candidate.metrics,
      sampleCount: Number(candidate.metrics.sampleCount ?? 0),
      attemptedSamples: Number(candidate.metrics.attemptedSamples ?? candidate.samples.length),
    },
    warnings: [
      'This is a dry-run execution plan, not a signed transaction.',
      'The scan did not find guaranteed or stable 20% APY; public DEX arbitrage edge can disappear immediately.',
      'Production use requires audited contracts, private transaction routing where appropriate, and loss-reverting execution.',
    ],
  };
}

export function buildAaveLiquidationExecutionPlan(
  candidate: AaveLiquidationCandidate,
  request: ExecutionPlanRequest,
): AaveLiquidationExecutionPlan {
  const chainId = CHAIN_IDS[candidate.chain] ?? null;
  const pool = chainId == null ? null : (AAVE_V3_POOLS[chainId] ?? null);
  const executorAddress = readConfiguredAaveLiquidationExecutorAddress(chainId, pool);
  const best = candidate.bestEstimate ?? null;
  const gatePassed = candidate.gate.status === 'pass';
  const blockedBy = buildAaveLiquidationBlockers(candidate, pool, executorAddress);
  const status: AaveLiquidationExecutionPlan['status'] = !gatePassed
    ? 'blocked'
    : !pool || !executorAddress
      ? 'needs-deployment'
      : 'fork-simulation-required';
  const debtAsset = best?.debtAsset ?? null;
  const collateralAsset = best?.collateralAsset ?? null;
  const debtToCover = best?.debtToCoverBaseUnits ?? best?.debtToCover ?? null;
  const seizedCollateralBaseUnits = best?.seizedCollateralBaseUnits ?? null;
  const liquidationCallCalldata = buildAaveLiquidationCallCalldata(
    collateralAsset,
    debtAsset,
    candidate.user,
    debtToCover,
    false,
  );
  const liquidationCallCalldataBytes =
    liquidationCallCalldata == null ? null : (liquidationCallCalldata.length - 2) / 2;
  const liquidationCalldataStatus: TransactionPlan['calldataStatus'] =
    liquidationCallCalldata == null ? 'quote-required' : 'ready-after-quote';
  const executorCalldata = buildAaveExecutorLiquidationCalldata({
    debtAsset,
    debtToCover,
    collateralAsset,
    borrower: candidate.user,
    receiveAToken: false,
    unwindTarget: ZERO_ADDRESS,
    unwindCalldata: '0x',
    minDebtAssetOut: 0,
    minProfit: 0,
    beneficiary: request.walletAddress ?? ZERO_ADDRESS,
  });
  const executorCalldataBytes = executorCalldata == null ? null : (executorCalldata.length - 2) / 2;
  const executorCalldataStatus: TransactionPlan['calldataStatus'] =
    executorCalldata == null ? 'quote-required' : 'fork-gated';

  return {
    id: `aave-liq-plan-${candidate.id}`,
    candidateId: candidate.id,
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    status,
    strategyId: 'atomic-amm',
    chainId,
    chain: candidate.chain,
    strategyType: 'aave-v3-liquidation-arbitrage',
    capital: request.capital ?? '0',
    borrower: candidate.user,
    liquidation: {
      pool,
      debtAsset,
      debtSymbol: best?.debtSymbol ?? null,
      collateralAsset,
      collateralSymbol: best?.collateralSymbol ?? null,
      debtToCoverUsd: best?.debtToCoverUsd ?? null,
      debtToCover,
      debtToCoverSource: best?.debtToCoverSource ?? null,
      seizedCollateralUsd: best?.seizedCollateralUsd ?? null,
      seizedCollateralAmount: best?.seizedCollateralAmount ?? null,
      seizedCollateralBaseUnits,
      seizedCollateralSource: best?.seizedCollateralSource ?? null,
      receiveAToken: false,
      liquidationCallSelector: AAVE_V3_LIQUIDATION_CALL_SELECTOR,
    },
    executor: {
      role: 'Flash-loan liquidation executor',
      address: executorAddress,
      verification: executorAddress
        ? 'configured through env override or data/executor-deployments.json; must be verified and fork-tested before production'
        : 'no Aave liquidation executor configured through env or data/executor-deployments.json for this chain',
    },
    approvals: debtAsset
      ? [
          {
            token: debtAsset,
            spender: pool,
            amount: 'quote-required',
            reason:
              'Aave V3 Pool must pull debt asset from the liquidation executor during liquidationCall',
          },
        ]
      : [],
    transactions: [
      {
        label: 'Execute Aave flash-loan liquidation',
        to: executorAddress,
        value: '0',
        method:
          'executeLiquidation(address,uint256,(address,address,uint256,bool,address,bytes,uint256,uint256,address))',
        selector: AAVE_V3_EXECUTE_LIQUIDATION_SELECTOR,
        calldataStatus: executorCalldataStatus,
        calldata: null,
        calldataBytes: executorCalldataBytes,
        params: {
          executor: executorAddress ?? 'executor-deployment-required',
          aavePool: pool ?? 'pool-required',
          debtAsset: debtAsset ?? 'debt-asset-required',
          debtToCover: debtToCover ?? 'same-block debtToCover quote required',
          collateralAsset: collateralAsset ?? 'collateral-asset-required',
          borrower: candidate.user,
          receiveAToken: false,
          unwindTarget: 'same-block whitelisted unwind target required',
          unwindCalldata: 'same-block collateral unwind calldata required',
          estimatedCollateralAmountIn:
            seizedCollateralBaseUnits ?? 'same-block seized collateral quote required',
          estimatedCollateralAmountSource:
            best?.seizedCollateralSource ?? 'same-block seized collateral quote required',
          minDebtAssetOut: 'same-block debt-asset output quote required',
          minProfit: 'same-block profit floor in debt-asset base units required',
          beneficiary: request.walletAddress ?? 'connected wallet required',
        },
        notes: [
          'This is the user-facing entrypoint; it wraps Aave flashLoanSimple, liquidationCall, collateral unwind, repayment, and profit transfer.',
          executorCalldata
            ? 'ABI encoding has been sanity-checked, but user-submittable calldata is withheld until the health-factor, unwind, and profit gates pass on the same fork block.'
            : 'Executor calldata is withheld until debtToCover and token fields are available.',
          'Do not submit while health factor is not below 1 or collateral unwind is not fork-simulated.',
        ],
      },
      {
        label: 'Flash-borrow debt asset',
        to: pool,
        value: '0',
        method: 'flashLoanSimple(address,address,uint256,bytes,uint16)',
        selector: AAVE_V3_FLASH_LOAN_SIMPLE_SELECTOR,
        calldataStatus: 'quote-required',
        params: {
          receiverAddress: executorAddress ?? 'executor-deployment-required',
          asset: debtAsset ?? 'debt-asset-required',
          amount: debtToCover ?? 'same-block debtToCover quote required',
          params: 'encoded liquidation and collateral unwind route',
          referralCode: 0,
        },
        notes: [
          'Internal call made by AaveV3LiquidationExecutor; users should not submit this pool call directly.',
        ],
      },
      {
        label: 'Liquidate unhealthy Aave V3 account',
        to: pool,
        value: '0',
        method: 'liquidationCall(address,address,address,uint256,bool)',
        selector: AAVE_V3_LIQUIDATION_CALL_SELECTOR,
        calldataStatus: liquidationCalldataStatus,
        calldata: liquidationCallCalldata,
        calldataBytes: liquidationCallCalldataBytes,
        params: {
          collateralAsset: collateralAsset ?? 'collateral-asset-required',
          debtAsset: debtAsset ?? 'debt-asset-required',
          user: candidate.user,
          debtToCover: debtToCover ?? 'same-block quote required',
          debtToCoverSource: best?.debtToCoverSource ?? 'same-block quote required',
          receiveAToken: false,
        },
        notes: [
          'Aave will revert unless borrower health factor is below 1 at execution block.',
          liquidationCallCalldata
            ? 'Calldata preview is based on the scan estimate and must be regenerated at the execution block.'
            : 'Calldata is withheld until debtToCover is quoted in base units.',
          'The seized collateral must be unwound back into debt asset or another approved settlement asset.',
        ],
      },
      {
        label: 'Unwind seized collateral and repay flash loan',
        to: executorAddress,
        value: '0',
        method: 'executor-specific collateral swap and flash-loan repayment',
        selector: null,
        calldataStatus: 'quote-required',
        params: {
          collateralAsset: collateralAsset ?? 'collateral-asset-required',
          debtAsset: debtAsset ?? 'debt-asset-required',
          minNetProfitUsd: request.maxGasUsd == null ? 'positive-after-gas' : `positive after max gas ${request.maxGasUsd} USD`,
          maxSlippageBps: request.maxSlippageBps ?? 30,
        },
        notes: [
          'Collateral unwind route must be sourced from a live DEX quote and fork-simulated in the same block window.',
        ],
      },
    ],
    riskLimits: buildAaveLiquidationRiskLimits(candidate, request),
    preflightChecks: buildAaveLiquidationPreflightChecks(candidate),
    forkSimulation: {
      required: true,
      status: gatePassed ? 'required' : 'blocked',
      requirements: [
        'refresh borrower health factor immediately before signing',
        'quote exact debtToCover and collateral seize amount from Aave reserve state',
        'quote collateral unwind route and gas at the same block',
        'simulate flash loan, liquidationCall, collateral unwind, and loan repayment on a fork',
        'prove the executor reverts if health factor recovers or net profit is negative',
      ],
    },
    blockedBy,
    evidence: {
      isPureArbitrage: candidate.isPureArbitrage,
      gate: candidate.gate,
      healthFactor: candidate.account?.healthFactor ?? null,
      bestEstimate: best,
    },
    warnings: [
      'This is a dry-run liquidation execution plan, not a signed transaction.',
      'Liquidation opportunities can disappear before public transactions land.',
      'Production use requires audited flash-loan callback, collateral unwind, and loss-reverting execution.',
    ],
  };
}

export function buildCompoundV3LiquidationExecutionPlan(
  candidate: CompoundV3LiquidationCandidate,
  request: ExecutionPlanRequest,
): CompoundV3LiquidationExecutionPlan {
  const chainId = CHAIN_IDS[candidate.chain] ?? null;
  const comet = chainId == null ? null : (COMPOUND_V3_COMETS[chainId] ?? null);
  const executorAddress = readConfiguredCompoundV3LiquidationExecutorAddress(chainId, comet);
  const best = candidate.bestEstimate ?? null;
  const gatePassed = candidate.gate.status === 'pass';
  const blockedBy = buildCompoundV3LiquidationBlockers(candidate, comet, executorAddress);
  const status: CompoundV3LiquidationExecutionPlan['status'] = !gatePassed
    ? 'blocked'
    : !comet || !executorAddress
      ? 'needs-deployment'
      : 'fork-simulation-required';

  return {
    id: `compound-v3-liq-plan-${candidate.id}`,
    candidateId: candidate.id,
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    status,
    strategyId: 'atomic-amm',
    chainId,
    chain: candidate.chain,
    strategyType: 'compound-v3-liquidation-arbitrage',
    capital: request.capital ?? '0',
    borrower: candidate.user,
    liquidation: {
      comet,
      baseAsset: best?.baseAsset ?? null,
      baseSymbol: best?.baseSymbol ?? null,
      collateralAsset: best?.collateralAsset ?? null,
      collateralSymbol: best?.collateralSymbol ?? null,
      baseAmount: best?.baseAmount ?? null,
      baseAmountHuman: best?.baseAmountHuman ?? null,
      quotedCollateral: best?.quotedCollateral ?? null,
      quotedCollateralHuman: best?.quotedCollateralHuman ?? null,
      absorbSelector: COMPOUND_V3_ABSORB_SELECTOR,
      buyCollateralSelector: COMPOUND_V3_BUY_COLLATERAL_SELECTOR,
    },
    executor: {
      role: 'Compound V3 liquidation and collateral-unwind executor',
      address: executorAddress,
      verification: executorAddress
        ? 'configured through DEX_ARB_EXECUTOR_ADDRESS; must be verified and fork-tested before production'
        : 'no Compound liquidation executor configured for this API process',
    },
    approvals: best?.baseAsset
      ? [
          {
            token: best.baseAsset,
            spender: comet,
            amount: best.baseAmount ?? 'quote-required',
            reason: 'Compound V3 Comet pulls base asset during buyCollateral',
          },
        ]
      : [],
    transactions: [
      {
        label: 'Source base asset',
        to: executorAddress,
        value: '0',
        method: 'executor-specific flash loan or prefunded capital path',
        selector: null,
        calldataStatus: 'quote-required',
        params: {
          baseAsset: best?.baseAsset ?? 'base-asset-required',
          baseAmount: best?.baseAmount ?? 'same-block quote required',
          capitalMode: 'wallet capital, vault balance, or flash-loan path must be selected',
        },
        notes: [
          'The final executor must prove base funding and repayment/settlement in one transaction.',
        ],
      },
      {
        label: 'Absorb liquidatable Compound V3 account',
        to: comet,
        value: '0',
        method: 'absorb(address,address[])',
        selector: COMPOUND_V3_ABSORB_SELECTOR,
        calldataStatus: 'quote-required',
        params: {
          absorber: executorAddress ?? 'executor-deployment-required',
          accounts: [candidate.user],
        },
        notes: [
          'Comet will revert or produce no opportunity unless the account is liquidatable at the execution block.',
        ],
      },
      {
        label: 'Buy discounted collateral from Comet reserves',
        to: comet,
        value: '0',
        method: 'buyCollateral(address,uint256,uint256,address)',
        selector: COMPOUND_V3_BUY_COLLATERAL_SELECTOR,
        calldataStatus: 'quote-required',
        params: {
          asset: best?.collateralAsset ?? 'collateral-asset-required',
          minAmount: best?.quotedCollateral ?? 'same-block quote required',
          baseAmount: best?.baseAmount ?? 'same-block quote required',
          recipient: executorAddress ?? 'executor-deployment-required',
        },
        notes: [
          'The scanner only passes candidates when current reserves are already below target.',
          'The quoted collateral must fit the borrower collateral balance and same-block Comet state.',
        ],
      },
      {
        label: 'Unwind collateral and settle profit',
        to: executorAddress,
        value: '0',
        method: 'executor-specific collateral swap and settlement',
        selector: null,
        calldataStatus: 'quote-required',
        params: {
          collateralAsset: best?.collateralAsset ?? 'collateral-asset-required',
          baseAsset: best?.baseAsset ?? 'base-asset-required',
          maxSlippageBps: request.maxSlippageBps ?? 30,
          minNetProfitUsd:
            request.maxGasUsd == null ? 'positive-after-gas' : `positive after max gas ${request.maxGasUsd} USD`,
        },
        notes: [
          'Collateral unwind route must be quoted from live DEX liquidity and simulated in the same block window.',
        ],
      },
    ],
    riskLimits: buildCompoundV3LiquidationRiskLimits(candidate, request),
    preflightChecks: buildCompoundV3LiquidationPreflightChecks(candidate),
    forkSimulation: {
      required: true,
      status: gatePassed ? 'required' : 'blocked',
      requirements: [
        'refresh Comet isLiquidatable, borrowBalanceOf, and collateralBalanceOf at execution block',
        'refresh Comet getReserves, targetReserves, and quoteCollateral at the same block',
        'quote collateral unwind route and gas at the same block',
        'simulate absorb, buyCollateral, collateral unwind, and settlement on a fork',
        'prove the executor reverts if the account is no longer liquidatable or net profit is negative',
      ],
    },
    blockedBy,
    evidence: {
      isPureArbitrage: candidate.isPureArbitrage,
      gate: candidate.gate,
      isLiquidatable: candidate.account?.isLiquidatable ?? null,
      borrowBalanceHuman: candidate.account?.borrowBalanceHuman ?? null,
      bestEstimate: best,
    },
    warnings: [
      'This is a dry-run Compound V3 liquidation execution plan, not a signed transaction.',
      'Liquidation and discounted collateral opportunities can disappear before a public transaction lands.',
      'Production use requires audited Comet liquidation, collateral unwind, and loss-reverting execution.',
    ],
  };
}

export function buildMorphoBlueLiquidationExecutionPlan(
  candidate: MorphoBlueLiquidationCandidate,
  request: ExecutionPlanRequest,
): MorphoBlueLiquidationExecutionPlan {
  const chainId = CHAIN_IDS[candidate.chain] ?? null;
  const morpho = chainId == null ? null : (MORPHO_BLUE_CONTRACTS[chainId] ?? null);
  const executorAddress = readConfiguredMorphoBlueLiquidationExecutorAddress(chainId, morpho);
  const best = candidate.bestEstimate ?? null;
  const gatePassed = candidate.gate.status === 'pass';
  const blockedBy = buildMorphoBlueLiquidationBlockers(candidate, morpho, executorAddress);
  const status: MorphoBlueLiquidationExecutionPlan['status'] = !gatePassed
    ? 'blocked'
    : !morpho || !executorAddress
      ? 'needs-deployment'
      : 'fork-simulation-required';

  return {
    id: `morpho-blue-liq-plan-${candidate.id}`,
    candidateId: candidate.id,
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    status,
    strategyId: 'atomic-amm',
    chainId,
    chain: candidate.chain,
    strategyType: 'morpho-blue-liquidation-arbitrage',
    capital: request.capital ?? '0',
    borrower: candidate.user,
    liquidation: {
      morpho,
      marketId: candidate.marketId,
      marketParams: candidate.marketParams,
      loanAsset: best?.loanAsset ?? candidate.marketParams.loanToken,
      loanSymbol: best?.loanSymbol ?? null,
      collateralAsset: best?.collateralAsset ?? candidate.marketParams.collateralToken,
      collateralSymbol: best?.collateralSymbol ?? null,
      repayUsd: best?.repayUsd ?? null,
      liquidationSelector: MORPHO_BLUE_LIQUIDATE_SELECTOR,
    },
    executor: {
      role: 'Morpho Blue liquidation and collateral-unwind executor',
      address: executorAddress,
      verification: executorAddress
        ? 'configured through env override or data/executor-deployments.json; must be verified and fork-tested before production'
        : 'no Morpho liquidation executor configured through env or data/executor-deployments.json for this chain',
    },
    approvals: [
      {
        token: best?.loanAsset ?? candidate.marketParams.loanToken,
        spender: morpho,
        amount: 'quote-required',
        reason: 'Morpho pulls loan asset from the executor when repaidShares is used during liquidation',
      },
    ],
    transactions: [
      {
        label: 'Source loan asset',
        to: executorAddress,
        value: '0',
        method: 'executor-specific flash loan or prefunded capital path',
        selector: null,
        calldataStatus: 'quote-required',
        params: {
          loanAsset: best?.loanAsset ?? candidate.marketParams.loanToken,
          repayUsd: best?.repayUsd ?? 'same-block quote required',
          capitalMode: 'wallet capital, vault balance, or flash-loan path must be selected',
        },
        notes: [
          'The final executor must prove loan-asset funding and profit settlement in one transaction.',
        ],
      },
      {
        label: 'Liquidate Morpho Blue borrower',
        to: morpho,
        value: '0',
        method: 'liquidate((address,address,address,address,uint256),address,uint256,uint256,bytes)',
        selector: MORPHO_BLUE_LIQUIDATE_SELECTOR,
        calldataStatus: 'quote-required',
        params: {
          marketParams: candidate.marketParams,
          borrower: candidate.user,
          seizedAssets: 'same-block quote required',
          repaidShares: 'same-block quote required',
          data: 'encoded callback/unwind parameters if flash liquidity is used',
        },
        notes: [
          'Morpho will revert unless the borrower is liquidatable at the execution block.',
          'Use either seizedAssets or repaidShares according to the audited executor path.',
        ],
      },
      {
        label: 'Unwind seized collateral and settle profit',
        to: executorAddress,
        value: '0',
        method: 'executor-specific collateral swap and settlement',
        selector: null,
        calldataStatus: 'quote-required',
        params: {
          collateralAsset: best?.collateralAsset ?? candidate.marketParams.collateralToken,
          loanAsset: best?.loanAsset ?? candidate.marketParams.loanToken,
          maxSlippageBps: request.maxSlippageBps ?? 30,
          minNetProfitUsd:
            request.maxGasUsd == null ? 'positive-after-gas' : `positive after max gas ${request.maxGasUsd} USD`,
        },
        notes: [
          'Collateral unwind route must be quoted from live DEX liquidity and simulated in the same block window.',
        ],
      },
    ],
    riskLimits: buildMorphoBlueLiquidationRiskLimits(candidate, request),
    preflightChecks: buildMorphoBlueLiquidationPreflightChecks(candidate),
    forkSimulation: {
      required: true,
      status: gatePassed ? 'required' : 'blocked',
      requirements: [
        'refresh Morpho position and market state at execution block',
        'refresh oracle price, LLTV, LTV, and liquidation incentive at the same block',
        'quote collateral unwind route and gas at the same block',
        'simulate liquidate, collateral unwind, funding repayment, and settlement on a fork',
        'prove the executor reverts if the position is no longer liquidatable or net profit is negative',
      ],
    },
    blockedBy,
    evidence: {
      isPureArbitrage: candidate.isPureArbitrage,
      gate: candidate.gate,
      liquidatable: candidate.account?.liquidatable ?? null,
      ltv: candidate.account?.ltv ?? null,
      lltv: candidate.account?.lltv ?? null,
      bestEstimate: best,
    },
    warnings: [
      'This is a dry-run Morpho Blue liquidation execution plan, not a signed transaction.',
      'Liquidation opportunities can disappear before public transactions land.',
      'Production use requires audited Morpho callbacks, collateral unwind, and loss-reverting execution.',
    ],
  };
}

function buildUniswapV3Plan(
  candidate: StrategyCandidate,
  chainId: number | null,
  capital: string,
  request: ExecutionPlanRequest,
): CandidateExecutionPlan {
  const positionManager = chainId == null ? null : (UNISWAP_V3_POSITION_MANAGERS[chainId] ?? null);
  const [token0, token1] = candidate.underlyingTokens;
  const wallet = request.walletAddress ?? 'wallet-address-required';
  const blockedBy = commonBlockedBy(candidate, positionManager).concat([
    'quote engine must convert the capital input into exact token0/token1 desired amounts',
    'pool fee tier and current tick must be confirmed from the canonical factory before calldata is signed',
    'tick range must be selected by the strategy and checked against current volatility',
  ]);

  return basePlan(candidate, chainId, capital, request, {
    adapter: 'uniswap-v3-npm',
    status: positionManager ? 'template-ready' : 'needs-adapter',
    role: 'Uniswap V3 NonfungiblePositionManager',
    address: positionManager,
    verification: positionManager
      ? 'canonical deployment address; verify on block explorer before production'
      : 'missing position manager address for this chain',
    approvals: approvalsFor(candidate.underlyingTokens, positionManager),
    transactions: [
      {
        label: 'Mint new concentrated liquidity NFT',
        to: positionManager,
        value: '0',
        method:
          'mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))',
        selector: UNISWAP_V3_MINT_SELECTOR,
        calldataStatus: 'quote-required',
        params: {
          token0: token0 ?? 'token0-required',
          token1: token1 ?? 'token1-required',
          fee: inferUniswapFeeTierPips(candidate) ?? 'pool-fee-required',
          tickLower: 'strategy-range-required',
          tickUpper: 'strategy-range-required',
          amount0Desired: 'quote-required',
          amount1Desired: 'quote-required',
          amount0Min: `slippage-derived, max ${request.maxSlippageBps ?? 50} bps`,
          amount1Min: `slippage-derived, max ${request.maxSlippageBps ?? 50} bps`,
          recipient: wallet,
          deadline: 'now + 600 seconds',
        },
        notes: [
          'This is the first live transaction template for opening a position.',
          'For existing position NFTs, use increaseLiquidity after tokenId discovery.',
        ],
      },
      {
        label: 'Increase liquidity on an existing NFT',
        to: positionManager,
        value: '0',
        method: 'increaseLiquidity((uint256,uint256,uint256,uint256,uint256,uint256))',
        selector: UNISWAP_V3_INCREASE_LIQUIDITY_SELECTOR,
        calldataStatus: 'quote-required',
        params: {
          tokenId: 'existing-position-token-id-required',
          amount0Desired: 'quote-required',
          amount1Desired: 'quote-required',
          amount0Min: `slippage-derived, max ${request.maxSlippageBps ?? 50} bps`,
          amount1Min: `slippage-derived, max ${request.maxSlippageBps ?? 50} bps`,
          deadline: 'now + 600 seconds',
        },
        notes: ['Use only after the wallet or vault already owns a compatible position NFT.'],
      },
    ],
    blockedBy,
  });
}

function buildSlipstreamPlan(
  candidate: StrategyCandidate,
  chainId: number | null,
  capital: string,
  request: ExecutionPlanRequest,
): CandidateExecutionPlan {
  const positionManager =
    chainId == null ? null : (AERODROME_SLIPSTREAM_POSITION_MANAGERS[chainId] ?? null);
  const [token0, token1] = candidate.underlyingTokens;
  const wallet = request.walletAddress ?? 'wallet-address-required';
  const blockedBy = commonBlockedBy(candidate, positionManager).concat([
    'Slipstream pool tick spacing and current price must be read from Aerodrome factory/pool contracts',
    'calldata must be encoded with the deployed Slipstream ABI before enabling wallet submission',
    'optional gauge staking must be modelled separately if rewards are included in the APY source',
  ]);

  return basePlan(candidate, chainId, capital, request, {
    adapter: 'aerodrome-slipstream-npm',
    status: positionManager ? 'template-ready' : 'needs-adapter',
    role: 'Aerodrome Slipstream NonfungiblePositionManager',
    address: positionManager,
    verification: positionManager
      ? 'Aerodrome published contract address; verify on BaseScan before production'
      : 'missing Slipstream position manager address for this chain',
    approvals: approvalsFor(candidate.underlyingTokens, positionManager),
    transactions: [
      {
        label: 'Mint new Slipstream concentrated liquidity NFT',
        to: positionManager,
        value: '0',
        method:
          'mint((address,address,int24,int24,int24,uint256,uint256,uint256,uint256,address,uint256,uint160))',
        selector: SLIPSTREAM_MINT_SELECTOR,
        calldataStatus: 'quote-required',
        params: {
          token0: token0 ?? 'token0-required',
          token1: token1 ?? 'token1-required',
          tickSpacing: 'pool-tick-spacing-required',
          tickLower: 'strategy-range-required',
          tickUpper: 'strategy-range-required',
          amount0Desired: 'quote-required',
          amount1Desired: 'quote-required',
          amount0Min: `slippage-derived, max ${request.maxSlippageBps ?? 50} bps`,
          amount1Min: `slippage-derived, max ${request.maxSlippageBps ?? 50} bps`,
          recipient: wallet,
          deadline: 'now + 600 seconds',
          sqrtPriceX96: 'pool-current-price-or-init-price-required',
        },
        notes: [
          'Slipstream is Uniswap-V3-like but uses tick spacing rather than a fee-tier field.',
          'Gauge deposit/claim flows are intentionally separate from this position mint plan.',
        ],
      },
    ],
    blockedBy,
  });
}

function buildCurvePlan(
  candidate: StrategyCandidate,
  chainId: number | null,
  capital: string,
  request: ExecutionPlanRequest,
): CandidateExecutionPlan {
  const poolAddress = null;
  return basePlan(candidate, chainId, capital, request, {
    adapter: 'curve-stable-lp',
    status: 'needs-adapter',
    role: 'Curve pool',
    address: poolAddress,
    verification: 'pool address must be resolved from Curve registry before live use',
    approvals: approvalsFor(candidate.underlyingTokens, poolAddress),
    transactions: [
      {
        label: 'Add liquidity to Curve stable pool',
        to: poolAddress,
        value: '0',
        method: 'add_liquidity(uint256[2],uint256)',
        selector: CURVE_ADD_LIQUIDITY_2_SELECTOR,
        calldataStatus: 'quote-required',
        params: {
          amounts: 'quote-required',
          minMintAmount: `slippage-derived, max ${request.maxSlippageBps ?? 50} bps`,
        },
        notes: ['Pool coin count and ABI variant must be confirmed before calldata encoding.'],
      },
    ],
    blockedBy: commonBlockedBy(candidate, poolAddress).concat([
      'Curve registry lookup is not implemented in this MVP',
      'pool coin count and add_liquidity ABI variant must be selected per pool',
    ]),
  });
}

function basePlan(
  candidate: StrategyCandidate,
  chainId: number | null,
  capital: string,
  request: ExecutionPlanRequest,
  detail: {
    adapter: string;
    status: CandidateExecutionPlan['status'];
    role: string;
    address: string | null;
    verification: string;
    approvals: ApprovalPlan[];
    transactions: TransactionPlan[];
    blockedBy: string[];
  },
): CandidateExecutionPlan {
  return {
    id: `plan-${candidate.id}`,
    candidateId: candidate.id,
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    status: detail.status,
    chainId,
    chain: candidate.chain,
    protocol: candidate.project,
    adapter: detail.adapter,
    strategyId: candidate.classification.includes('lp') ? 'lp-market-making' : 'yield-rotator',
    capital,
    targetContract: {
      role: detail.role,
      address: detail.address,
      verification: detail.verification,
    },
    approvals: detail.approvals,
    transactions: detail.transactions,
    riskLimits: buildRiskLimits(candidate, request),
    preflightChecks: buildPreflightChecks(candidate),
    blockedBy: detail.blockedBy,
    evidence: {
      source: candidate.source,
      poolId: candidate.poolId,
      apyBase: candidate.apyBase,
      apyBase7d: candidate.apyBase7d,
      apyMean30d: candidate.apyMean30d,
      tvlUsd: candidate.tvlUsd,
      isPureArbitrage: candidate.isPureArbitrage,
    },
    warnings: buildWarnings(candidate),
  };
}

function approvalsFor(tokens: string[], spender: string | null): ApprovalPlan[] {
  return tokens.map((token) => ({
    token,
    spender,
    amount: 'quote-required',
    reason: 'position manager must pull both pool assets from the wallet or vault',
  }));
}

function commonBlockedBy(candidate: StrategyCandidate, target: string | null): string[] {
  const blocked = [
    'production execution is disabled until the adapter is integration-tested on a fork',
    'wallet/vault balances and allowances must be checked immediately before signing',
  ];
  if (!target) blocked.push('target contract address is missing for this chain/protocol');
  if (!candidate.underlyingTokens.length)
    blocked.push('candidate has no underlying token addresses');
  if (!candidate.isPureArbitrage)
    blocked.push('candidate is not pure arbitrage and cannot be marketed as guaranteed yield');
  return blocked;
}

function buildRiskLimits(candidate: StrategyCandidate, request: ExecutionPlanRequest): RiskLimit[] {
  const tvlUsd = candidate.tvlUsd ?? 0;
  const maxPositionUsd = tvlUsd > 0 ? Math.max(1000, Math.floor(tvlUsd * 0.005)) : 'tvl-required';
  return [
    { key: 'maxSlippageBps', value: request.maxSlippageBps ?? 50, unit: 'bps' },
    { key: 'maxGasUsd', value: request.maxGasUsd ?? 25, unit: 'USD' },
    { key: 'maxPositionUsd', value: maxPositionUsd, unit: 'USD' },
    { key: 'minConservativeApy', value: 20, unit: 'percent' },
    { key: 'maxTvlShareBps', value: 50, unit: 'bps' },
    { key: 'rebalanceCooldown', value: 3600, unit: 'seconds' },
  ];
}

function buildPreflightChecks(candidate: StrategyCandidate): string[] {
  return [
    `Refresh DeFiLlama evidence for ${candidate.poolId} before accepting deposits`,
    'Read pool slot0/current tick and liquidity from archive RPC',
    'Resolve token decimals, symbols, balances, and allowances on-chain',
    'Quote token split, min amounts, gas, and price impact with the current block state',
    'Reject if conservative APY, TVL, volume, or IL-risk filters no longer pass',
    'Simulate calldata on a fork and require revert-on-loss behavior before live signing',
  ];
}

function buildWarnings(candidate: StrategyCandidate): string[] {
  return [
    'This is a dry-run execution plan, not a signed transaction.',
    'The current system does not guarantee 20% APY or any fixed return.',
    ...candidate.riskNotes,
  ];
}

function inferUniswapFeeTierPips(candidate: StrategyCandidate): number | null {
  if (candidate.chain === 'Base' && candidate.symbol.toUpperCase() === 'WETH-USDC') return 500;
  return null;
}

function buildDexTokenPath(candidate: DexArbitrageCandidate): string[] {
  if (candidate.tokenPath?.length) return candidate.tokenPath;
  const path = [candidate.startToken.symbol, candidate.midToken.symbol];
  if (candidate.thirdToken) path.push(candidate.thirdToken.symbol);
  path.push(candidate.startToken.symbol);
  return path;
}

function buildDexPath(candidate: DexArbitrageCandidate): string[] {
  if (candidate.dexPath?.length) return candidate.dexPath;
  return [candidate.buyDex, candidate.sellDex].filter(Boolean);
}

function readConfiguredWalletAtomicArbitrageExecutorAddress(chainId: number | null): string | null {
  const envValue = [
    process.env.WALLET_ATOMIC_ARB_EXECUTOR_ADDRESS?.trim(),
    process.env.DEX_ARB_EXECUTOR_ADDRESS?.trim(),
  ].find(isAddress);
  if (envValue) return envValue;
  const record = deploymentRecordFor(
    readExecutorDeploymentManifest(),
    chainId,
    'walletAtomicArbitrageExecutor',
  );
  if (!record || !isAddress(record.address)) return null;
  return record.address;
}

function deploymentManifestPath(): string {
  return (
    process.env.EXECUTOR_DEPLOYMENTS_PATH?.trim() ||
    resolve(process.cwd(), 'data', 'executor-deployments.json')
  );
}

function readExecutorDeploymentManifest(): ExecutorDeploymentManifest | null {
  const path = deploymentManifestPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ExecutorDeploymentManifest;
  } catch {
    return null;
  }
}

function deploymentRecordFor(
  manifest: ExecutorDeploymentManifest | null,
  chainId: number | null,
  key: string,
): ExecutorDeploymentRecord | null {
  if (!manifest || chainId == null) return null;
  const chainKey = String(chainId);
  const sections = [manifest.deployments, manifest.chains, manifest.executors];
  for (const section of sections) {
    const byChain = section?.[chainKey];
    if (!byChain) continue;
    if ('address' in byChain) return byChain as ExecutorDeploymentRecord;
    const record = (byChain as Record<string, ExecutorDeploymentRecord>)[key];
    if (record) return record;
  }
  return null;
}

function readConfiguredAaveLiquidationExecutorAddress(
  chainId: number | null,
  pool: string | null,
): string | null {
  const envValue = [
    process.env.AAVE_LIQUIDATION_EXECUTOR_ADDRESS?.trim(),
    process.env.DEX_ARB_EXECUTOR_ADDRESS?.trim(),
  ].find(isAddress);
  if (envValue) return envValue;
  const record = deploymentRecordFor(
    readExecutorDeploymentManifest(),
    chainId,
    'aaveV3LiquidationExecutor',
  );
  if (!record || !isAddress(record.address)) return null;
  if (pool && isAddress(record.aavePool) && record.aavePool.toLowerCase() !== pool.toLowerCase()) {
    return null;
  }
  return record.address;
}

function readConfiguredCompoundV3LiquidationExecutorAddress(
  chainId: number | null,
  comet: string | null,
): string | null {
  const envValue = [
    process.env.COMPOUND_V3_LIQUIDATION_EXECUTOR_ADDRESS?.trim(),
    process.env.DEX_ARB_EXECUTOR_ADDRESS?.trim(),
  ].find(isAddress);
  if (envValue) return envValue;
  const record = deploymentRecordFor(
    readExecutorDeploymentManifest(),
    chainId,
    'compoundV3LiquidationExecutor',
  );
  if (!record || !isAddress(record.address)) return null;
  if (comet && isAddress(record.comet) && record.comet.toLowerCase() !== comet.toLowerCase()) {
    return null;
  }
  return record.address;
}

function readConfiguredMorphoBlueLiquidationExecutorAddress(
  chainId: number | null,
  morpho: string | null,
): string | null {
  const envValue = [
    process.env.MORPHO_BLUE_LIQUIDATION_EXECUTOR_ADDRESS?.trim(),
    process.env.DEX_ARB_EXECUTOR_ADDRESS?.trim(),
  ].find(isAddress);
  if (envValue) return envValue;
  const record = deploymentRecordFor(
    readExecutorDeploymentManifest(),
    chainId,
    'morphoBlueLiquidationExecutor',
  );
  if (!record || !isAddress(record.address)) return null;
  if (morpho && isAddress(record.morpho) && record.morpho.toLowerCase() !== morpho.toLowerCase()) {
    return null;
  }
  return record.address;
}

function buildDexArbitrageBlockers(
  candidate: DexArbitrageCandidate,
  executorAddress: string | null,
  missingRouters: string[],
): string[] {
  const blocked = [
    'production execution is disabled until the atomic arbitrage executor is deployed, verified, and audited',
    'wallet balances and allowances must be checked at the same block used for the quote',
    'fresh quotes must still clear profit after gas, slippage, and MEV protection costs',
  ];
  if (!candidate.isPureArbitrage) blocked.push('candidate is not marked as pure arbitrage');
  if (candidate.gate.status !== 'pass') {
    blocked.push(`quote replay gate is ${candidate.gate.status}: ${candidate.gate.reason}`);
  }
  if (!executorAddress) {
    blocked.push(
      'WALLET_ATOMIC_ARB_EXECUTOR_ADDRESS, DEX_ARB_EXECUTOR_ADDRESS, or data/executor-deployments.json walletAtomicArbitrageExecutor is not configured',
    );
  }
  if (missingRouters.length) {
    blocked.push(`missing router or pool addresses for ${missingRouters.join(', ')}`);
  }
  return blocked;
}

function buildDexArbitrageRiskLimits(
  candidate: DexArbitrageCandidate,
  request: ExecutionPlanRequest,
): RiskLimit[] {
  return [
    { key: 'maxSlippageBps', value: request.maxSlippageBps ?? 30, unit: 'bps' },
    { key: 'maxGasUsd', value: request.maxGasUsd ?? 25, unit: 'USD' },
    { key: 'minAnnualizedNetReturn', value: 20, unit: 'percent' },
    { key: 'minNetProfitUsd', value: 'positive-after-gas', unit: 'USD' },
    { key: 'minSamples', value: candidate.gate.minSamples ?? 5 },
    { key: 'minWinRatePct', value: candidate.gate.minWinRatePct ?? 80, unit: 'percent' },
  ];
}

function buildDexArbitragePreflightChecks(candidate: DexArbitrageCandidate): string[] {
  return [
    `Refresh quote replay for ${candidate.id} at the current block`,
    'Resolve every token decimal and router address from chain state or audited config',
    'Estimate gas for approval and atomic execution using the connected wallet',
    'Reject unless expected output exceeds input plus gas and slippage buffers',
    'Simulate the full route on a fork and require revert-on-loss behavior',
    'Reject unless the route still passes after private relay or MEV-protection assumptions',
  ];
}

function buildAaveLiquidationBlockers(
  candidate: AaveLiquidationCandidate,
  pool: string | null,
  executorAddress: string | null,
): string[] {
  const blocked = [
    'production execution is disabled until the flash-loan liquidation executor is deployed, verified, and audited',
    'borrower health factor must be refreshed at the execution block',
    'collateral unwind quote and gas estimate must be generated immediately before signing',
  ];
  if (!candidate.isPureArbitrage) blocked.push('candidate is not marked as pure arbitrage');
  if (!pool) blocked.push('Aave V3 Pool address is missing for this chain');
  if (!executorAddress) {
    blocked.push(
      'AAVE_LIQUIDATION_EXECUTOR_ADDRESS, DEX_ARB_EXECUTOR_ADDRESS, or data/executor-deployments.json Aave executor is not configured',
    );
  }
  if (candidate.gate.status !== 'pass') {
    blocked.push(`liquidation gate is ${candidate.gate.status}: ${candidate.gate.reason}`);
  }
  if ((candidate.account?.healthFactor ?? Infinity) >= 1) {
    blocked.push(`borrower health factor ${candidate.account?.healthFactor ?? 'n/a'} is not below 1`);
  }
  if (!candidate.bestEstimate) blocked.push('no priced debt/collateral liquidation estimate is available');
  return blocked;
}

function buildAaveLiquidationRiskLimits(
  candidate: AaveLiquidationCandidate,
  request: ExecutionPlanRequest,
): RiskLimit[] {
  return [
    { key: 'maxSlippageBps', value: request.maxSlippageBps ?? 30, unit: 'bps' },
    { key: 'maxGasUsd', value: request.maxGasUsd ?? 25, unit: 'USD' },
    {
      key: 'minNetProfitUsd',
      value: candidate.gate.minNetProfitUsd ?? 5,
      unit: 'USD',
    },
    {
      key: 'minReturnOnDebtPct',
      value: candidate.gate.minReturnOnDebtPct ?? 0.1,
      unit: 'percent',
    },
    { key: 'maxHealthFactor', value: 0.999999 },
    { key: 'receiveAToken', value: 'false' },
  ];
}

function buildAaveLiquidationPreflightChecks(candidate: AaveLiquidationCandidate): string[] {
  return [
    `Refresh Aave V3 borrower account data for ${candidate.user}`,
    'Reject unless healthFactor is below 1 at the execution block',
    'Read debt token and aToken balances for the selected debt/collateral pair',
    'Quote Aave liquidation amount, liquidation bonus, protocol fee, and close factor',
    'Quote collateral unwind route back to debt asset or settlement asset',
    'Simulate flash loan, liquidationCall, collateral swap, repayment, and net profit on a fork',
  ];
}

function buildCompoundV3LiquidationBlockers(
  candidate: CompoundV3LiquidationCandidate,
  comet: string | null,
  executorAddress: string | null,
): string[] {
  const blocked = [
    'production execution is disabled until the Compound liquidation executor is deployed, verified, and audited',
    'Comet liquidatability and reserves must be refreshed at the execution block',
    'collateral unwind quote and gas estimate must be generated immediately before signing',
  ];
  if (!candidate.isPureArbitrage) blocked.push('candidate is not marked as pure arbitrage');
  if (!comet) blocked.push('Compound V3 Comet address is missing for this chain');
  if (!executorAddress) {
    blocked.push(
      'COMPOUND_V3_LIQUIDATION_EXECUTOR_ADDRESS, DEX_ARB_EXECUTOR_ADDRESS, or data/executor-deployments.json compoundV3LiquidationExecutor is not configured',
    );
  }
  if (candidate.gate.status !== 'pass') {
    blocked.push(`compound liquidation gate is ${candidate.gate.status}: ${candidate.gate.reason}`);
  }
  if (!candidate.account?.isLiquidatable) blocked.push('account is not currently liquidatable');
  if (!candidate.bestEstimate) blocked.push('no priced base/collateral buyCollateral estimate is available');
  return blocked;
}

function buildCompoundV3LiquidationRiskLimits(
  candidate: CompoundV3LiquidationCandidate,
  request: ExecutionPlanRequest,
): RiskLimit[] {
  return [
    { key: 'maxSlippageBps', value: request.maxSlippageBps ?? 30, unit: 'bps' },
    { key: 'maxGasUsd', value: request.maxGasUsd ?? 25, unit: 'USD' },
    {
      key: 'minNetProfitUsd',
      value: candidate.gate.minNetProfitUsd ?? 5,
      unit: 'USD',
    },
    {
      key: 'minReturnOnBasePct',
      value: candidate.gate.minReturnOnBasePct ?? 0.1,
      unit: 'percent',
    },
    { key: 'requiresLiquidatableAccount', value: 'true' },
    { key: 'requiresReservesBelowTarget', value: 'true' },
  ];
}

function buildCompoundV3LiquidationPreflightChecks(
  candidate: CompoundV3LiquidationCandidate,
): string[] {
  return [
    `Refresh Compound V3 account state for ${candidate.user}`,
    'Reject unless isLiquidatable(account) is true at the execution block',
    'Read borrowBalanceOf, collateralBalanceOf, getReserves, and targetReserves',
    'Quote buyCollateral for the selected base amount and collateral asset',
    'Quote collateral unwind route back to base asset or settlement asset',
    'Simulate absorb, buyCollateral, collateral swap, settlement, and net profit on a fork',
  ];
}

function buildMorphoBlueLiquidationBlockers(
  candidate: MorphoBlueLiquidationCandidate,
  morpho: string | null,
  executorAddress: string | null,
): string[] {
  const blocked = [
    'production execution is disabled until the Morpho liquidation executor is deployed, verified, and audited',
    'Morpho position, oracle, and market state must be refreshed at the execution block',
    'collateral unwind quote and gas estimate must be generated immediately before signing',
  ];
  if (!candidate.isPureArbitrage) blocked.push('candidate is not marked as pure arbitrage');
  if (!morpho) blocked.push('Morpho Blue contract address is missing for this chain');
  if (!executorAddress) {
    blocked.push(
      'MORPHO_BLUE_LIQUIDATION_EXECUTOR_ADDRESS, DEX_ARB_EXECUTOR_ADDRESS, or data/executor-deployments.json morphoBlueLiquidationExecutor is not configured',
    );
  }
  if (candidate.gate.status !== 'pass') {
    blocked.push(`morpho liquidation gate is ${candidate.gate.status}: ${candidate.gate.reason}`);
  }
  if (!candidate.account?.liquidatable) blocked.push('position is not currently liquidatable');
  if (!candidate.bestEstimate) blocked.push('no priced Morpho liquidation estimate is available');
  return blocked;
}

function buildMorphoBlueLiquidationRiskLimits(
  candidate: MorphoBlueLiquidationCandidate,
  request: ExecutionPlanRequest,
): RiskLimit[] {
  return [
    { key: 'maxSlippageBps', value: request.maxSlippageBps ?? 30, unit: 'bps' },
    { key: 'maxGasUsd', value: request.maxGasUsd ?? 25, unit: 'USD' },
    {
      key: 'minNetProfitUsd',
      value: candidate.gate.minNetProfitUsd ?? 5,
      unit: 'USD',
    },
    {
      key: 'minReturnOnRepayPct',
      value: candidate.gate.minReturnOnRepayPct ?? 0.1,
      unit: 'percent',
    },
    { key: 'requiresLiquidatablePosition', value: 'true' },
    { key: 'ltvMustExceedLltv', value: 'true' },
  ];
}

function buildMorphoBlueLiquidationPreflightChecks(
  candidate: MorphoBlueLiquidationCandidate,
): string[] {
  return [
    `Refresh Morpho Blue position for ${candidate.user}`,
    'Reject unless position LTV is at or above market LLTV at the execution block',
    'Read market total borrow/supply shares and user position from Morpho',
    'Recompute liquidation incentive and liquidation sizing from audited Morpho math',
    'Quote collateral unwind route back to loan asset or settlement asset',
    'Simulate liquidate, collateral swap, repayment, and net profit on a fork',
  ];
}
