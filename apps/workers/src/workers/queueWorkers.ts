/**
 * opportunity/simulation/execution/backtest workers (BullMQ consumers) +
 * risk/accounting watchers.
 *
 * Each worker implements its main transformation; heavy math/chain I/O is
 * delegated to the Rust cores via the API gateway or direct binary calls.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ASSETS, CHAINS, STRATEGIES } from '@oal/config';
import { getModel } from '@oal/strategy-models';
import type { ExecutionPlan, Opportunity } from '@oal/sdk';
import { QUEUES, db, makeQueue, makeWorker, track, redis } from '../infra.js';
import { conservativeObservedApy, loadCandidateArtifact } from '../candidates.js';

interface BacktestRunRow {
  id: string;
  strategy_id: string;
  status: string;
  capital: string;
  params?: Record<string, unknown>;
}

interface LiveStrategyRunRow {
  id: string;
  candidate_id: string;
  strategy_id: string;
  status: string;
  chain_id: number | null;
  wallet_address: string | null;
  capital: string;
  plan?: {
    adapter?: string;
    targetContract?: { address?: string | null; role?: string };
    approvals?: Array<{ token: string; spender: string | null; amount: string }>;
    blockedBy?: string[];
    transactions?: Array<{
      label?: string;
      calldataStatus?: string;
      to?: string | null;
      selector?: string | null;
      method?: string;
      params?: Record<string, unknown>;
    }>;
    evidence?: { isPureArbitrage?: boolean; apyBase7d?: number | null; apyMean30d?: number | null };
    riskLimits?: Array<{ key: string; value: string | number; unit?: string }>;
  };
}

interface CandidateSnapshot {
  id: string;
  chain: string;
  project: string;
  symbol: string;
  underlyingTokens: string[];
}

interface ScriptRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface MorphoReplayCandidate {
  marketId?: string;
  bestEstimate?: {
    netProfitUsd?: number | null;
  } | null;
  replayMetrics?: {
    annualizedNetReturnPct?: number | null;
    marketEventCount?: number | null;
    replayWindowDays?: number | null;
    minAnnualizedNetReturnPct?: number | null;
    minMarketEventsForGate?: number | null;
    minReplayDaysForGate?: number | null;
  } | null;
}

interface MorphoReplayArtifact {
  candidates?: MorphoReplayCandidate[];
}

interface MorphoWatchlistArtifact {
  generatedAt?: string;
  summary?: {
    historicallyStableMarketCount?: number | null;
    watchCandidateCount?: number | null;
    liquidatableCount?: number | null;
    nearLiquidationCount?: number | null;
    watchCount?: number | null;
    passingCurrentProfitabilityCount?: number | null;
    requestedPassingCount?: number | null;
  };
}

interface AaveReplayCandidate {
  bestEstimate?: {
    debtSymbol?: string | null;
    collateralSymbol?: string | null;
  } | null;
  gate?: {
    status?: string | null;
  } | null;
}

interface AaveReplayArtifact {
  candidates?: AaveReplayCandidate[];
}

interface AaveWatchlistArtifact {
  generatedAt?: string;
  summary?: {
    historicallyStablePairCount?: number | null;
    watchCandidateCount?: number | null;
    liquidatableCount?: number | null;
    nearLiquidationCount?: number | null;
    watchCount?: number | null;
    passingCurrentProfitabilityCount?: number | null;
    requestedPassingCount?: number | null;
  };
}

interface TokenQuote {
  coin: string;
  token: string;
  symbol: string;
  priceUsd: number;
  desiredAmount: string;
  minAmount: string;
  usdShare: number;
}

interface TokenPrice {
  coin: string;
  symbol: string;
  priceUsd: number;
}

interface MintPreviewTokenAmount {
  token: string;
  symbol: string;
  decimals: number;
  decimalsSource: 'config' | 'erc20';
  desiredAmount: string;
  minAmount: string;
  desiredBaseUnits: string;
  minBaseUnits: string;
}

interface TransactionPreviewCall {
  label: string;
  kind: 'approval' | 'position-mint';
  to: string;
  value: string;
  selector: string;
  method: string;
  calldata: string;
  calldataBytes: number;
  params: Record<string, string | number | null>;
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

interface GasPreflightCall {
  label: string;
  kind: TransactionPreviewCall['kind'];
  to: string;
  selector: string;
  status: 'estimated' | 'blocked' | 'missing';
  gasLimit?: string;
  gasLimitHex?: string;
  estimatedCostUsd?: number;
  error?: string;
  warnings: string[];
}

interface CallSimulationResult {
  label: string;
  kind: TransactionPreviewCall['kind'];
  to: string;
  selector: string;
  status: 'passed' | 'reverted' | 'missing';
  returnBytes?: number;
  returnDataPreview?: string;
  error?: string;
  warnings: string[];
}

interface LiveRunPreflightReport {
  runId: string;
  candidateId: string;
  generatedAt: string;
  status: 'blocked' | 'passed';
  checks: Array<{
    key: string;
    status: 'pass' | 'warn' | 'block';
    message: string;
    evidence?: Record<string, unknown>;
  }>;
  quote: {
    status: 'missing' | 'partial' | 'ready';
    capital: string;
    source?: string;
    prices?: TokenQuote[];
    requiredInputs: string[];
    error?: string;
  };
  poolState: {
    status: 'missing' | 'ready' | 'unsupported';
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
  mintPreview: {
    status: 'missing' | 'ready' | 'unsupported';
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
  transactionPreview: {
    status: 'missing' | 'ready' | 'unsupported';
    calls: TransactionPreviewCall[];
    requiredInputs: string[];
    warnings: string[];
    error?: string;
  };
  gasPreflight: {
    status: 'missing' | 'partial' | 'ready' | 'blocked';
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
  callSimulation: {
    status: 'missing' | 'partial' | 'passed' | 'blocked';
    wallet: string | null;
    rpcEnvVar?: string;
    calls: CallSimulationResult[];
    requiredInputs: string[];
    warnings: string[];
    error?: string;
  };
  walletPreflight: {
    status: 'missing' | 'ready' | 'needs-approval' | 'blocked';
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

const UNISWAP_V3_FACTORIES: Record<number, string> = {
  1: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  8453: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
};

const CHAIN_RPC_ENV: Record<number, string> = {
  1: 'RPC_ETHEREUM_URL',
  8453: 'RPC_BASE_URL',
  42161: 'RPC_ARBITRUM_URL',
  10: 'RPC_OPTIMISM_URL',
  137: 'RPC_POLYGON_URL',
};

const NATIVE_TOKEN_PRICE_COINS: Record<number, string> = {
  1: 'coingecko:ethereum',
  8453: 'coingecko:ethereum',
  42161: 'coingecko:ethereum',
  10: 'coingecko:ethereum',
  137: 'coingecko:matic-network',
};

const NATIVE_TOKEN_SYMBOLS: Record<number, string> = {
  1: 'ETH',
  8453: 'ETH',
  42161: 'ETH',
  10: 'ETH',
  137: 'MATIC',
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const Q96 = 1n << 96n;
const Q32 = 1n << 32n;
const MAX_UINT256 = (1n << 256n) - 1n;
const ERC20_DECIMALS_SELECTOR = '0x313ce567';
const ERC20_APPROVE_SELECTOR = '0x095ea7b3';
const ERC20_BALANCE_OF_SELECTOR = '0x70a08231';
const ERC20_ALLOWANCE_SELECTOR = '0xdd62ed3e';
const UNISWAP_V3_MINT_SELECTOR = '0x88316456';
const UNISWAP_V3_TICK_SPACING: Record<number, number> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
};
const DEFAULT_UNISWAP_V3_RANGE_WIDTH_TICKS = 600;

// ---------------------------------------------------------------------------
// opportunity-worker: per block, ask each active model to discover opportunities.
// ---------------------------------------------------------------------------

export function startOpportunityWorker(): void {
  const q = makeQueue(QUEUES.opportunity);
  const w = track(
    makeWorker<{ chainId: number; blockNumber: number }>(
      QUEUES.opportunity,
      async (job) => {
        const { chainId, blockNumber } = job.data;
        for (const s of STRATEGIES.filter((x) => x.status === 'active' && x.phase === 1)) {
          const model = getModel(s.id);
          if (!model) continue;
          try {
            const ctx = {
              chainId,
              blockNumber,
              blockTimestamp: 0,
              assets: [],
              pools: [],
            };
            const opps = await model.discover(ctx);
            for (const opp of opps) {
              await persistOpportunity(opp);
              await makeQueue(QUEUES.simulation).add('sim', { opportunityId: opp.id });
            }
          } catch (err) {
            console.error(`[opportunity] model ${s.id} error:`, (err as Error).message);
          }
        }
      },
      2,
    ),
  );
  void w;
  void q;
}

async function persistOpportunity(opp: Opportunity): Promise<void> {
  await db(
    `INSERT INTO opportunities (id, strategy_id, chain_id, block_number, asset, gross_profit,
       gas_cost, bribe_cost, net_profit, confidence, route, status)
     VALUES ($1, $2, $3, $4, decode($5,'hex'), $6, $7, $8, $9, $10, $11, 'discovered')
     ON CONFLICT (id) DO NOTHING`,
    [
      opp.id,
      opp.strategyId,
      opp.chainId,
      opp.blockNumber,
      opp.assetIn.replace(/^0x/i, ''),
      opp.expectedProfit,
      opp.expectedGas,
      opp.expectedBribe,
      opp.netProfit,
      opp.confidence,
      JSON.stringify(opp.route),
    ],
  ).catch((e) => console.error('[opportunity] persist error', (e as Error).message));
}

// ---------------------------------------------------------------------------
// simulation-worker: run revm/Anvil fork sim on candidate opportunities.
// ---------------------------------------------------------------------------

export function startSimulationWorker(): void {
  track(
    makeWorker<{ opportunityId: string }>(
      QUEUES.simulation,
      async (job) => {
        const rows = await db('SELECT * FROM opportunities WHERE id = $1', [
          job.data.opportunityId,
        ]);
        if (!rows.length) return;
        const opp = rows[0];
        // Delegate to the Rust backtest-engine / Anvil fork via the API.
        // For MVP we record a simulated marker and forward to execution.
        const plan: ExecutionPlan = {
          opportunityId: opp.id,
          chainId: opp.chain_id,
          route: opp.route,
          capital: { source: 'vault-capital', amount: opp.capital_required ?? '0', premium: '0' },
          minProfitAssets: '0',
          deadline: Math.floor(Date.now() / 1000) + 300,
          maxGasCost: '0',
        };
        await db(`UPDATE opportunities SET status='simulated' WHERE id=$1`, [opp.id]);
        await makeQueue(QUEUES.execution).add('exec', { opportunityId: opp.id, plan });
      },
      2,
    ),
  );
}

// ---------------------------------------------------------------------------
// execution-worker: build tx, submit to private relays / local Anvil.
// ---------------------------------------------------------------------------

export function startExecutionWorker(): void {
  track(
    makeWorker<{ opportunityId: string; plan: ExecutionPlan }>(
      QUEUES.execution,
      async (job) => {
        const { opportunityId, plan } = job.data;
        const model = getModel(plan.opportunityId.split('-')[0] ?? '');
        if (!model) {
          await db(`UPDATE opportunities SET status='rejected' WHERE id=$1`, [opportunityId]);
          return;
        }
        try {
          const tx = await model.buildTx(plan);
          // Submit (Anvil demo relay or private relays in production).
          await redis.set(`tx:${opportunityId}`, JSON.stringify(tx), 'EX', 600);
          await db(
            `INSERT INTO executions (opportunity_id, chain_id, status, gross_profit, net_profit)
             VALUES ($1, $2, 'submitted', 0, 0) ON CONFLICT DO NOTHING`,
            [opportunityId, plan.chainId],
          );
          await db(`UPDATE opportunities SET status='executed' WHERE id=$1`, [opportunityId]);
        } catch (err) {
          await db(`UPDATE opportunities SET status='rejected' WHERE id=$1`, [opportunityId]);
          console.error('[execution] error', (err as Error).message);
        }
      },
      1,
    ),
  );
}

// ---------------------------------------------------------------------------
// backtest-worker: pick up queued backtest_runs and run the Rust engine.
// ---------------------------------------------------------------------------

export function startBacktestWorker(): void {
  void pollQueuedBacktests();
  void pollQueuedLiveRuns();
  if (process.env.MORPHO_WATCHER_DISABLED !== '1') {
    void startMorphoBlueWatchlistWorker();
  }
  if (process.env.AAVE_WATCHER_DISABLED !== '1') {
    void startAaveLiquidationWatchlistWorker();
  }
  track(
    makeWorker<{ runId: string }>(
      QUEUES.backtest,
      async (job) => {
        await processBacktestRun(job.data.runId);
      },
      1,
    ),
  );
}

async function pollQueuedLiveRuns(): Promise<void> {
  console.log('[live-runs] queued-run poller start');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const rows = await db<{ id: string }>(
        `SELECT id FROM live_strategy_runs WHERE status='queued' ORDER BY created_at LIMIT 5`,
      );
      for (const row of rows) {
        await processLiveStrategyRun(row.id);
      }
    } catch (err) {
      console.error('[live-runs] poller error', (err as Error).message);
    }
    await sleep(3000);
  }
}

async function processLiveStrategyRun(runId: string): Promise<void> {
  const rows = await db<LiveStrategyRunRow>(
    `UPDATE live_strategy_runs
     SET status='preflight', updated_at=now()
     WHERE id=$1 AND status='queued'
     RETURNING id, candidate_id, strategy_id, status, chain_id,
       CASE WHEN wallet_address IS NULL THEN NULL ELSE '0x' || encode(wallet_address, 'hex') END AS wallet_address,
       capital, plan`,
    [runId],
  );
  if (!rows.length) return;
  const run = rows[0];
  const report = await buildLiveRunPreflightReport(run);
  const blockers = report.blockers;
  await db(
    `INSERT INTO live_run_preflights (run_id, status, report)
     VALUES ($1, $2, $3)`,
    [run.id, report.status === 'passed' ? 'passed' : 'blocked', JSON.stringify(report)],
  );

  if (blockers.length) {
    await db(
      `UPDATE live_strategy_runs
       SET status='blocked', blocked_by=$1, last_error=$2, updated_at=now()
       WHERE id=$3`,
      [JSON.stringify(blockers), blockers[0], run.id],
    );
    await db(
      `INSERT INTO risk_events (severity, scope, scope_id, message, data)
       VALUES ('warning', 'strategy', $1, 'live run blocked by preflight', $2)`,
      [
        run.strategy_id,
        JSON.stringify({
          runId: run.id,
          candidateId: run.candidate_id,
          blockers,
          preflight: report,
        }),
      ],
    );
    return;
  }

  await db(
    `UPDATE live_strategy_runs
     SET status='ready', updated_at=now()
     WHERE id=$1`,
    [run.id],
  );
}

async function buildLiveRunPreflightReport(
  run: LiveStrategyRunRow,
): Promise<LiveRunPreflightReport> {
  const quote = await buildTokenQuote(run);
  const poolState = await resolvePoolState(run);
  const mintPreview = await buildMintPreview(run, quote, poolState);
  const transactionPreview = buildTransactionPreview(mintPreview);
  const walletPreflight = await buildWalletPreflight(run, mintPreview);
  const gasPreflight = await buildGasPreflight(run, transactionPreview, quote);
  const callSimulation = await buildCallSimulation(run, transactionPreview);
  const planBlockers = Array.isArray(run.plan?.blockedBy) ? run.plan.blockedBy : [];
  const quoteRequired = (run.plan?.transactions ?? []).some(
    (tx) => tx.calldataStatus === 'quote-required',
  );
  const calldataReady = (run.plan?.transactions ?? []).every(
    (tx) => tx.calldataStatus === 'ready-after-quote',
  );
  const checks: LiveRunPreflightReport['checks'] = [
    {
      key: 'chain',
      status: run.chain_id ? 'pass' : 'block',
      message: run.chain_id ? `chain ${run.chain_id} selected` : 'chain id is missing',
      evidence: { chainId: run.chain_id },
    },
    {
      key: 'adapter',
      status: run.plan?.adapter ? 'pass' : 'block',
      message: run.plan?.adapter ? `adapter ${run.plan.adapter} selected` : 'adapter is missing',
      evidence: { adapter: run.plan?.adapter ?? null },
    },
    {
      key: 'target-contract',
      status: run.plan?.targetContract?.address ? 'pass' : 'block',
      message: run.plan?.targetContract?.address
        ? `target ${run.plan.targetContract.address}`
        : 'target contract is missing',
      evidence: run.plan?.targetContract ?? {},
    },
    {
      key: 'approvals',
      status: (run.plan?.approvals ?? []).length ? 'warn' : 'block',
      message: (run.plan?.approvals ?? []).length
        ? 'approval templates are present but allowance checks are not wired'
        : 'approval templates are missing',
      evidence: { approvals: run.plan?.approvals ?? [] },
    },
    {
      key: 'pool-state',
      status: poolState.status === 'ready' ? 'pass' : 'block',
      message:
        poolState.status === 'ready'
          ? `pool ${poolState.poolAddress} tick ${poolState.tick}`
          : (poolState.error ?? 'pool-state resolver is missing'),
      evidence: poolState,
    },
    {
      key: 'quote',
      status: quote.status === 'partial' || !quoteRequired ? 'warn' : 'block',
      message:
        quote.status === 'partial'
          ? 'price-driven token split is available; pool-state quote is still required'
          : quoteRequired
            ? 'quote engine has not produced token split, min amounts, and final calldata'
            : 'transactions do not require a quote',
      evidence: quote,
    },
    {
      key: 'mint-preview',
      status: mintPreview.status === 'ready' ? 'pass' : 'warn',
      message:
        mintPreview.status === 'ready'
          ? `mint preview ready: ticks ${mintPreview.tickLower}..${mintPreview.tickUpper}`
          : (mintPreview.error ?? 'mint preview still requires quote, pool-state, or decimals'),
      evidence: mintPreview,
    },
    {
      key: 'transaction-preview',
      status: transactionPreview.status === 'ready' ? 'pass' : 'warn',
      message:
        transactionPreview.status === 'ready'
          ? `transaction preview ready: ${transactionPreview.calls.length} calls`
          : (transactionPreview.error ?? 'transaction preview requires mint params'),
      evidence: transactionPreview,
    },
    {
      key: 'gas-preflight',
      status:
        gasPreflight.status === 'ready'
          ? 'pass'
          : gasPreflight.status === 'partial'
            ? 'warn'
            : 'block',
      message:
        gasPreflight.status === 'ready'
          ? `gas estimate ready: ${gasPreflight.totalGasLimit ?? 'n/a'} total gas`
          : gasPreflight.status === 'partial'
            ? 'some preview calls have gas estimates; blocked calls require approvals or simulation'
            : (gasPreflight.error ?? 'gas estimate preflight is not ready'),
      evidence: gasPreflight,
    },
    {
      key: 'max-gas',
      status:
        gasPreflight.maxGasOk === true
          ? 'pass'
          : gasPreflight.maxGasOk === false
            ? 'block'
            : 'warn',
      message:
        gasPreflight.maxGasOk === true
          ? `estimated gas $${formatUsd(gasPreflight.estimatedCostUsd)} within max $${formatUsd(
              gasPreflight.maxGasUsd,
            )}`
          : gasPreflight.maxGasOk === false
            ? `estimated gas $${formatUsd(gasPreflight.estimatedCostUsd)} exceeds max $${formatUsd(
                gasPreflight.maxGasUsd,
              )}`
            : (gasPreflight.costError ?? 'gas USD cost is not available yet'),
      evidence: gasPreflight,
    },
    {
      key: 'call-simulation',
      status:
        callSimulation.status === 'passed'
          ? 'pass'
          : callSimulation.status === 'partial'
            ? 'warn'
            : 'block',
      message:
        callSimulation.status === 'passed'
          ? 'all preview calls passed read-only eth_call simulation'
          : callSimulation.status === 'partial'
            ? 'some preview calls passed read-only simulation; reverted calls require approvals or fork state'
            : (callSimulation.error ?? 'read-only call simulation is not ready'),
      evidence: callSimulation,
    },
    {
      key: 'wallet-preflight',
      status:
        walletPreflight.status === 'ready'
          ? 'pass'
          : walletPreflight.status === 'needs-approval'
            ? 'warn'
            : 'block',
      message:
        walletPreflight.status === 'ready'
          ? 'wallet balances and allowances are sufficient for previewed amounts'
          : walletPreflight.status === 'needs-approval'
            ? 'wallet has enough balance but needs ERC20 approval'
            : (walletPreflight.error ?? 'wallet balance/allowance preflight is not ready'),
      evidence: walletPreflight,
    },
    {
      key: 'fork-simulation',
      status: 'block',
      message: 'fork simulation service is not wired for this candidate run yet',
    },
    {
      key: 'pure-arbitrage',
      status: run.plan?.evidence?.isPureArbitrage === false ? 'warn' : 'pass',
      message:
        run.plan?.evidence?.isPureArbitrage === false
          ? 'candidate is not pure arbitrage; user-facing copy must not promise fixed yield'
          : 'candidate marked pure arbitrage',
      evidence: run.plan?.evidence ?? {},
    },
  ];
  const blockers = [
    ...planBlockers,
    'fork simulation service is not wired for this candidate run yet',
    'production adapter execution is disabled until integration tests pass',
  ];
  if (quoteRequired && quote.status !== 'partial') {
    blockers.push('quote engine has not produced final calldata amounts');
  }
  if (quoteRequired && quote.status === 'partial') {
    if (poolState.status !== 'ready') {
      blockers.push('pool-state quote has not confirmed current tick, liquidity, and price impact');
    } else {
      blockers.push('pool-state reader is ready; price-impact quote is still required');
    }
  }
  if (poolState.status !== 'ready') blockers.push(poolState.error ?? 'pool-state is not ready');
  if (walletPreflight.status === 'blocked') {
    blockers.push(walletPreflight.error ?? 'wallet balance preflight blocked this run');
  }
  if (walletPreflight.status === 'missing') {
    blockers.push(walletPreflight.error ?? 'wallet balance/allowance preflight is missing');
  }
  if (gasPreflight.status === 'missing' || gasPreflight.status === 'blocked') {
    blockers.push(gasPreflight.error ?? 'gas estimate preflight is not ready');
  }
  if (gasPreflight.maxGasOk === false) {
    blockers.push('estimated gas cost exceeds maxGasUsd risk limit');
  }
  if (callSimulation.status === 'missing' || callSimulation.status === 'blocked') {
    blockers.push(callSimulation.error ?? 'read-only call simulation is not ready');
  }
  if (run.plan?.evidence?.isPureArbitrage === false) {
    blockers.push('candidate is not pure arbitrage; user-facing copy must not promise fixed yield');
  }
  for (const check of checks) {
    if (check.status === 'block') blockers.push(check.message);
  }
  const uniqueBlockers = Array.from(new Set(blockers));
  return {
    runId: run.id,
    candidateId: run.candidate_id,
    generatedAt: new Date().toISOString(),
    status: uniqueBlockers.length ? 'blocked' : 'passed',
    checks,
    quote,
    poolState,
    mintPreview,
    transactionPreview,
    gasPreflight,
    callSimulation,
    walletPreflight,
    execution: {
      adapter: run.plan?.adapter ?? null,
      target: run.plan?.targetContract?.address ?? null,
      transactionCount: run.plan?.transactions?.length ?? 0,
      calldataReady,
      forkSimulationReady: false,
    },
    nextActions: [
      poolState.status === 'ready'
        ? 'implement price-impact quote from pool tick/liquidity'
        : 'wire archive RPC pool-state reader for this adapter',
      mintPreview.status === 'ready'
        ? 'encode and fork-simulate the previewed mint params before wallet submission'
        : 'resolve mint parameter preview from quote, pool state, and token decimals',
      transactionPreview.status === 'ready'
        ? 'estimate gas, check balances/allowances, and fork-simulate the previewed calls'
        : 'build transaction preview calldata from mint params',
      gasPreflight.status === 'ready'
        ? 'feed gas estimates into max-gas and fork-simulation risk gates'
        : gasPreflight.status === 'partial'
          ? 'rerun gas preflight after required approvals are confirmed'
          : 'estimate gas for previewed calldata',
      callSimulation.status === 'passed'
        ? 'replace read-only eth_call checks with ordered fork simulation'
        : callSimulation.status === 'partial'
          ? 'rerun call simulation after approvals are confirmed'
          : 'simulate previewed calldata with eth_call before fork simulation',
      walletPreflight.status === 'needs-approval'
        ? 'ask wallet to sign missing ERC20 approvals before simulation'
        : walletPreflight.status === 'ready'
          ? 'include wallet balance/allowance report in fork simulation'
          : 'read wallet ERC20 balances and allowances',
      'implement quote engine for token split and min amounts',
      'run fork simulation for generated calldata',
      'enable production adapter only after integration tests pass',
    ],
    blockers: uniqueBlockers,
  };
}

async function buildMintPreview(
  run: LiveStrategyRunRow,
  quote: LiveRunPreflightReport['quote'],
  poolState: LiveRunPreflightReport['poolState'],
): Promise<LiveRunPreflightReport['mintPreview']> {
  const artifact = await loadCandidateArtifact();
  const candidate = artifact?.candidates.find((c) => c.id === run.candidate_id) as
    CandidateSnapshot | undefined;
  const mintTx = (run.plan?.transactions ?? []).find(
    (tx) => tx.selector?.toLowerCase() === UNISWAP_V3_MINT_SELECTOR,
  );
  const base = {
    protocol: candidate?.project ?? null,
    selector: mintTx?.selector ?? UNISWAP_V3_MINT_SELECTOR,
    method: mintTx?.method ?? null,
    target: mintTx?.to ?? run.plan?.targetContract?.address ?? null,
    recipient: run.wallet_address ?? stringParam(mintTx?.params?.recipient) ?? null,
    fee: poolState.fee,
    tickSpacing: null,
    requiredInputs: ['quote prices', 'pool tick', 'token decimals'],
    warnings: [
      'preview is not signed calldata',
      'amounts are price-driven and must be replaced by a pool price-impact quote before execution',
    ],
  };
  if (!candidate || !run.chain_id) {
    return { status: 'missing', ...base, error: 'candidate or chain id is missing' };
  }
  if (!candidate.project.includes('uniswap-v3')) {
    return {
      status: 'unsupported',
      ...base,
      error: `${candidate.project} mint preview is not implemented yet`,
    };
  }
  if (quote.status !== 'partial' || !quote.prices?.length) {
    return { status: 'missing', ...base, error: 'price-driven token quote is missing' };
  }
  if (
    poolState.status !== 'ready' ||
    poolState.tick == null ||
    poolState.fee == null ||
    !poolState.sqrtPriceX96
  ) {
    return { status: 'missing', ...base, error: 'Uniswap V3 pool state is missing' };
  }

  const [token0, token1] = candidate.underlyingTokens;
  const quote0 = quote.prices.find((p) => sameAddress(p.token, token0));
  const quote1 = quote.prices.find((p) => sameAddress(p.token, token1));
  if (!token0 || !token1 || !quote0 || !quote1) {
    return { status: 'missing', ...base, error: 'token quote does not cover both pool assets' };
  }

  const [meta0, meta1] = await Promise.all([
    resolveTokenDecimals(run, token0),
    resolveTokenDecimals(run, token1),
  ]);
  const missingDecimals = [
    meta0.decimals == null ? token0 : null,
    meta1.decimals == null ? token1 : null,
  ].filter(Boolean);
  if (missingDecimals.length) {
    return {
      status: 'missing',
      ...base,
      error: `token decimals missing for ${missingDecimals.join(', ')}`,
    };
  }

  const tickSpacing = UNISWAP_V3_TICK_SPACING[poolState.fee] ?? 60;
  const tickLower = roundTickDown(
    poolState.tick - DEFAULT_UNISWAP_V3_RANGE_WIDTH_TICKS,
    tickSpacing,
  );
  const tickUpper = roundTickUp(poolState.tick + DEFAULT_UNISWAP_V3_RANGE_WIDTH_TICKS, tickSpacing);
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const maxSlippageBps = riskLimitNumber(run, 'maxSlippageBps', 50);
  const rawAmount0Desired = decimalToBaseUnits(quote0.desiredAmount, meta0.decimals as number);
  const rawAmount1Desired = decimalToBaseUnits(quote1.desiredAmount, meta1.decimals as number);
  const poolAwareAmounts = buildPoolAwareMintAmounts({
    sqrtPriceX96: poolState.sqrtPriceX96,
    tickLower,
    tickUpper,
    amount0Available: rawAmount0Desired,
    amount1Available: rawAmount1Desired,
    maxSlippageBps,
  });
  if (poolAwareAmounts.liquidity === '0') {
    return {
      status: 'missing',
      ...base,
      error: 'pool-aware mint amount preview produced zero liquidity',
    };
  }

  return {
    status: 'ready',
    ...base,
    method:
      mintTx?.method ??
      'mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))',
    fee: poolState.fee,
    tickSpacing,
    tickLower,
    tickUpper,
    deadline,
    token0: {
      token: token0,
      symbol: meta0.symbol ?? quote0.symbol,
      decimals: meta0.decimals as number,
      decimalsSource: meta0.source as 'config' | 'erc20',
      desiredAmount: baseUnitsToDecimalString(
        poolAwareAmounts.amount0Desired,
        meta0.decimals as number,
      ),
      minAmount: baseUnitsToDecimalString(poolAwareAmounts.amount0Min, meta0.decimals as number),
      desiredBaseUnits: poolAwareAmounts.amount0Desired,
      minBaseUnits: poolAwareAmounts.amount0Min,
    },
    token1: {
      token: token1,
      symbol: meta1.symbol ?? quote1.symbol,
      decimals: meta1.decimals as number,
      decimalsSource: meta1.source as 'config' | 'erc20',
      desiredAmount: baseUnitsToDecimalString(
        poolAwareAmounts.amount1Desired,
        meta1.decimals as number,
      ),
      minAmount: baseUnitsToDecimalString(poolAwareAmounts.amount1Min, meta1.decimals as number),
      desiredBaseUnits: poolAwareAmounts.amount1Desired,
      minBaseUnits: poolAwareAmounts.amount1Min,
    },
    requiredInputs: ['fork simulation', 'adapter integration'],
    warnings: [
      'amounts are pool-ratio adjusted from current tick and selected range',
      'this is still a preview; fork simulation must pass before execution',
    ],
  };
}

function buildTransactionPreview(
  mintPreview: LiveRunPreflightReport['mintPreview'],
): LiveRunPreflightReport['transactionPreview'] {
  if (mintPreview.status !== 'ready') {
    return {
      status: mintPreview.status === 'unsupported' ? 'unsupported' : 'missing',
      calls: [],
      requiredInputs: ['ready mint preview'],
      warnings: [],
      error: mintPreview.error ?? 'mint preview is not ready',
    };
  }
  if (
    !mintPreview.target ||
    !mintPreview.recipient ||
    !mintPreview.token0 ||
    !mintPreview.token1 ||
    mintPreview.fee == null ||
    mintPreview.tickLower == null ||
    mintPreview.tickUpper == null ||
    mintPreview.deadline == null
  ) {
    return {
      status: 'missing',
      calls: [],
      requiredInputs: ['target', 'recipient', 'token amounts', 'tick range', 'deadline'],
      warnings: [],
      error: 'mint preview is missing calldata inputs',
    };
  }

  const approvalWarnings = [
    'preview does not check current allowance',
    'wallet must inspect and sign approval before mint',
  ];
  const mintWarnings = [
    'preview calldata is not fork-simulated',
    'amounts are price-driven and must be replaced by a pool price-impact quote before execution',
  ];
  const calls: TransactionPreviewCall[] = [
    {
      label: `Approve ${mintPreview.token0.symbol}`,
      kind: 'approval',
      to: mintPreview.token0.token,
      value: '0',
      selector: ERC20_APPROVE_SELECTOR,
      method: 'approve(address,uint256)',
      calldata: encodeApproveCalldata(mintPreview.target, mintPreview.token0.desiredBaseUnits),
      calldataBytes: 4 + 32 * 2,
      params: {
        spender: mintPreview.target,
        amount: mintPreview.token0.desiredBaseUnits,
      },
      warnings: approvalWarnings,
    },
    {
      label: `Approve ${mintPreview.token1.symbol}`,
      kind: 'approval',
      to: mintPreview.token1.token,
      value: '0',
      selector: ERC20_APPROVE_SELECTOR,
      method: 'approve(address,uint256)',
      calldata: encodeApproveCalldata(mintPreview.target, mintPreview.token1.desiredBaseUnits),
      calldataBytes: 4 + 32 * 2,
      params: {
        spender: mintPreview.target,
        amount: mintPreview.token1.desiredBaseUnits,
      },
      warnings: approvalWarnings,
    },
    {
      label: 'Mint Uniswap V3 position',
      kind: 'position-mint',
      to: mintPreview.target,
      value: '0',
      selector: UNISWAP_V3_MINT_SELECTOR,
      method:
        mintPreview.method ??
        'mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))',
      calldata: encodeUniswapV3MintCalldata({
        token0: mintPreview.token0.token,
        token1: mintPreview.token1.token,
        fee: mintPreview.fee,
        tickLower: mintPreview.tickLower,
        tickUpper: mintPreview.tickUpper,
        amount0Desired: mintPreview.token0.desiredBaseUnits,
        amount1Desired: mintPreview.token1.desiredBaseUnits,
        amount0Min: mintPreview.token0.minBaseUnits,
        amount1Min: mintPreview.token1.minBaseUnits,
        recipient: mintPreview.recipient,
        deadline: mintPreview.deadline.toString(),
      }),
      calldataBytes: 4 + 32 * 11,
      params: {
        token0: mintPreview.token0.token,
        token1: mintPreview.token1.token,
        fee: mintPreview.fee,
        tickLower: mintPreview.tickLower,
        tickUpper: mintPreview.tickUpper,
        amount0Desired: mintPreview.token0.desiredBaseUnits,
        amount1Desired: mintPreview.token1.desiredBaseUnits,
        amount0Min: mintPreview.token0.minBaseUnits,
        amount1Min: mintPreview.token1.minBaseUnits,
        recipient: mintPreview.recipient,
        deadline: mintPreview.deadline,
      },
      warnings: mintWarnings,
    },
  ];

  return {
    status: 'ready',
    calls,
    requiredInputs: ['balance check', 'allowance check', 'gas estimate', 'fork simulation'],
    warnings: [
      'transaction preview is for inspection and simulation only',
      'API and worker still do not submit live capital',
    ],
  };
}

async function buildWalletPreflight(
  run: LiveStrategyRunRow,
  mintPreview: LiveRunPreflightReport['mintPreview'],
): Promise<LiveRunPreflightReport['walletPreflight']> {
  const wallet = run.wallet_address;
  const spender = mintPreview.target;
  const rpcEnvVar = run.chain_id == null ? undefined : CHAIN_RPC_ENV[run.chain_id];
  const rpcUrl = rpcEnvVar ? process.env[rpcEnvVar] : undefined;
  const base = {
    wallet,
    spender,
    rpcEnvVar,
    tokens: [],
    requiredInputs: ['wallet address', 'spender', 'token amounts', 'rpc url'],
    warnings: ['allowance checks are read-only and can change before execution'],
  };
  if (mintPreview.status !== 'ready') {
    return {
      status: 'missing',
      ...base,
      error: mintPreview.error ?? 'mint preview is not ready',
    };
  }
  if (!wallet || !spender || !mintPreview.token0 || !mintPreview.token1) {
    return {
      status: 'missing',
      ...base,
      error: 'wallet, spender, or token amounts are missing',
    };
  }
  if (!rpcUrl) {
    return {
      status: 'missing',
      ...base,
      error: 'rpc url is missing',
    };
  }

  const tokens = await Promise.all(
    [mintPreview.token0, mintPreview.token1].map(async (token) => {
      const errors: string[] = [];
      let balanceBaseUnits: string | undefined;
      let allowanceBaseUnits: string | undefined;
      try {
        balanceBaseUnits = BigInt(
          await ethCall(rpcUrl, token.token, encodeBalanceOfCalldata(wallet)),
        ).toString();
      } catch (err) {
        errors.push(`balanceOf failed: ${(err as Error).message}`);
      }
      try {
        allowanceBaseUnits = BigInt(
          await ethCall(rpcUrl, token.token, encodeAllowanceCalldata(wallet, spender)),
        ).toString();
      } catch (err) {
        errors.push(`allowance failed: ${(err as Error).message}`);
      }
      const required = BigInt(token.desiredBaseUnits);
      const balance = balanceBaseUnits == null ? undefined : BigInt(balanceBaseUnits);
      const allowance = allowanceBaseUnits == null ? undefined : BigInt(allowanceBaseUnits);
      const balanceOk = balance == null ? undefined : balance >= required;
      const allowanceOk = allowance == null ? undefined : allowance >= required;
      const approvalRequired =
        allowance == null || allowance >= required ? 0n : required - allowance;
      return {
        token: token.token,
        symbol: token.symbol,
        requiredBaseUnits: token.desiredBaseUnits,
        balanceBaseUnits,
        allowanceBaseUnits,
        balanceOk,
        allowanceOk,
        approvalRequiredBaseUnits: approvalRequired.toString(),
        errors,
      };
    }),
  );

  const hasReadError = tokens.some((token) => token.errors.length > 0);
  const hasInsufficientBalance = tokens.some((token) => token.balanceOk === false);
  const needsApproval = tokens.some((token) => token.allowanceOk === false);
  const status: LiveRunPreflightReport['walletPreflight']['status'] = hasReadError
    ? 'missing'
    : hasInsufficientBalance
      ? 'blocked'
      : needsApproval
        ? 'needs-approval'
        : 'ready';
  return {
    status,
    wallet,
    spender,
    rpcEnvVar,
    tokens,
    requiredInputs:
      status === 'ready'
        ? ['gas estimate', 'fork simulation']
        : ['sufficient balances and allowances'],
    warnings: [
      'wallet preflight is a latest-block snapshot',
      'amounts are still price-driven until pool-aware quote is implemented',
    ],
    error:
      status === 'blocked'
        ? 'wallet has insufficient token balance for previewed amounts'
        : status === 'missing'
          ? 'wallet balance/allowance preflight could not read all tokens'
          : undefined,
  };
}

async function buildGasPreflight(
  run: LiveStrategyRunRow,
  transactionPreview: LiveRunPreflightReport['transactionPreview'],
  quote: LiveRunPreflightReport['quote'],
): Promise<LiveRunPreflightReport['gasPreflight']> {
  const wallet = run.wallet_address;
  const rpcEnvVar = run.chain_id == null ? undefined : CHAIN_RPC_ENV[run.chain_id];
  const rpcUrl = rpcEnvVar ? process.env[rpcEnvVar] : undefined;
  const base = {
    wallet,
    rpcEnvVar,
    calls: [] as GasPreflightCall[],
    requiredInputs: ['wallet address', 'rpc url', 'transaction preview calldata'],
    warnings: ['gas estimates are latest-block snapshots and can change before execution'],
  };
  if (transactionPreview.status !== 'ready' || transactionPreview.calls.length === 0) {
    return {
      status: 'missing',
      ...base,
      error: transactionPreview.error ?? 'transaction preview is not ready',
    };
  }
  if (!wallet || !rpcUrl) {
    return {
      status: 'missing',
      ...base,
      error: !wallet ? 'wallet address is missing' : 'rpc url is missing',
    };
  }

  const maxGasUsd = riskLimitNumber(run, 'maxGasUsd', 25);
  const gasCost = await resolveGasCostInputs(run, rpcUrl, quote);
  const calls = await Promise.all(
    transactionPreview.calls.map(async (call) => {
      const warnings = [...call.warnings];
      try {
        const gasHex = await ethEstimateGas(rpcUrl, {
          from: wallet,
          to: call.to,
          value: call.value,
          data: call.calldata,
        });
        const gasLimit = BigInt(gasHex).toString();
        const estimatedCostUsd = estimateGasCostUsd(gasLimit, gasCost);
        return {
          label: call.label,
          kind: call.kind,
          to: call.to,
          selector: call.selector,
          status: 'estimated',
          gasLimit,
          gasLimitHex: gasHex,
          estimatedCostUsd,
          warnings,
        } satisfies GasPreflightCall;
      } catch (err) {
        return {
          label: call.label,
          kind: call.kind,
          to: call.to,
          selector: call.selector,
          status: 'blocked',
          error: (err as Error).message,
          warnings:
            call.kind === 'position-mint'
              ? [
                  ...warnings,
                  'mint estimate may fail until allowances, balances, and pool-aware quote are ready',
                ]
              : warnings,
        } satisfies GasPreflightCall;
      }
    }),
  );
  const estimated = calls.filter((call) => call.status === 'estimated');
  const totalGasLimit = estimated
    .reduce((sum, call) => sum + BigInt(call.gasLimit ?? '0'), 0n)
    .toString();
  const estimatedCostUsd =
    gasCost.status === 'ready' && estimated.length
      ? estimated.reduce((sum, call) => sum + (call.estimatedCostUsd ?? 0), 0)
      : undefined;
  const maxGasOk =
    estimatedCostUsd == null || !Number.isFinite(maxGasUsd) ? undefined : estimatedCostUsd <= maxGasUsd;
  const approvalCalls = calls.filter((call) => call.kind === 'approval');
  const approvalsEstimated = approvalCalls.every((call) => call.status === 'estimated');
  const status: LiveRunPreflightReport['gasPreflight']['status'] =
    estimated.length === calls.length
      ? 'ready'
      : estimated.length > 0 || approvalsEstimated
        ? 'partial'
        : 'blocked';

  return {
    status,
    wallet,
    rpcEnvVar,
    calls,
    totalGasLimit: estimated.length ? totalGasLimit : undefined,
    gasPriceWei: gasCost.gasPriceWei,
    gasPriceHex: gasCost.gasPriceHex,
    gasPriceSource: gasCost.gasPriceSource,
    nativeTokenSymbol: gasCost.nativeTokenSymbol,
    nativeTokenPriceUsd: gasCost.nativeTokenPriceUsd,
    nativeTokenPriceSource: gasCost.nativeTokenPriceSource,
    estimatedCostUsd,
    maxGasUsd,
    maxGasOk,
    costError: gasCost.status === 'ready' ? undefined : gasCost.error,
    requiredInputs:
      status === 'ready'
        ? ['fork simulation']
        : ['successful eth_estimateGas for all preview calls'],
    warnings: [
      'gas estimate does not prove profitability or safety',
      'mint gas must be re-estimated after approvals and final quote',
    ],
    error:
      status === 'blocked'
        ? 'no preview call could be gas-estimated with the current wallet/RPC state'
        : undefined,
  };
}

async function buildCallSimulation(
  run: LiveStrategyRunRow,
  transactionPreview: LiveRunPreflightReport['transactionPreview'],
): Promise<LiveRunPreflightReport['callSimulation']> {
  const wallet = run.wallet_address;
  const rpcEnvVar = run.chain_id == null ? undefined : CHAIN_RPC_ENV[run.chain_id];
  const rpcUrl = rpcEnvVar ? process.env[rpcEnvVar] : undefined;
  const base = {
    wallet,
    rpcEnvVar,
    calls: [] as CallSimulationResult[],
    requiredInputs: ['wallet address', 'rpc url', 'transaction preview calldata'],
    warnings: [
      'eth_call simulation is read-only and does not apply prior approval state to later calls',
      'ordered fork simulation is still required before execution',
    ],
  };
  if (transactionPreview.status !== 'ready' || transactionPreview.calls.length === 0) {
    return {
      status: 'missing',
      ...base,
      error: transactionPreview.error ?? 'transaction preview is not ready',
    };
  }
  if (!wallet || !rpcUrl) {
    return {
      status: 'missing',
      ...base,
      error: !wallet ? 'wallet address is missing' : 'rpc url is missing',
    };
  }

  const calls = await Promise.all(
    transactionPreview.calls.map(async (call) => {
      try {
        const result = await ethCallTx(rpcUrl, {
          from: wallet,
          to: call.to,
          value: call.value,
          data: call.calldata,
        });
        return {
          label: call.label,
          kind: call.kind,
          to: call.to,
          selector: call.selector,
          status: 'passed',
          returnBytes: Math.max(0, (result.length - 2) / 2),
          returnDataPreview: shortHex(result),
          warnings: call.warnings,
        } satisfies CallSimulationResult;
      } catch (err) {
        return {
          label: call.label,
          kind: call.kind,
          to: call.to,
          selector: call.selector,
          status: 'reverted',
          error: (err as Error).message,
          warnings:
            call.kind === 'position-mint'
              ? [
                  ...call.warnings,
                  'mint simulation can revert until approvals and final quote are confirmed',
                ]
              : call.warnings,
        } satisfies CallSimulationResult;
      }
    }),
  );
  const passed = calls.filter((call) => call.status === 'passed');
  const status: LiveRunPreflightReport['callSimulation']['status'] =
    passed.length === calls.length
      ? 'passed'
      : passed.length > 0
        ? 'partial'
        : 'blocked';

  return {
    status,
    wallet,
    rpcEnvVar,
    calls,
    requiredInputs:
      status === 'passed'
        ? ['ordered fork simulation']
        : ['successful eth_call for all preview calls'],
    warnings: base.warnings,
    error:
      status === 'blocked'
        ? 'no preview call passed read-only eth_call simulation'
        : undefined,
  };
}

async function resolveTokenDecimals(
  run: LiveStrategyRunRow,
  token: string,
): Promise<{ decimals?: number; symbol?: string; source?: 'config' | 'erc20' }> {
  const configured = ASSETS.find(
    (asset) => asset.chainId === run.chain_id && sameAddress(asset.address, token),
  );
  if (configured) {
    return { decimals: configured.decimals, symbol: configured.symbol, source: 'config' };
  }
  const rpcEnvVar = run.chain_id == null ? undefined : CHAIN_RPC_ENV[run.chain_id];
  const rpcUrl = rpcEnvVar ? process.env[rpcEnvVar] : undefined;
  if (!rpcUrl) return {};
  try {
    const result = await ethCall(rpcUrl, token, ERC20_DECIMALS_SELECTOR);
    return { decimals: Number(BigInt(result)), source: 'erc20' };
  } catch {
    return {};
  }
}

async function resolvePoolState(
  run: LiveStrategyRunRow,
): Promise<LiveRunPreflightReport['poolState']> {
  const artifact = await loadCandidateArtifact();
  const candidate = artifact?.candidates.find((c) => c.id === run.candidate_id) as
    CandidateSnapshot | undefined;
  const base = {
    protocol: candidate?.project ?? null,
    poolAddress: null,
    fee: null,
    requiredInputs: ['pool address', 'current tick', 'liquidity'],
  };
  if (!candidate || !run.chain_id) {
    return { status: 'missing', ...base, error: 'candidate or chain id is missing' };
  }
  if (!candidate.project.includes('uniswap-v3')) {
    return {
      status: 'unsupported',
      ...base,
      error: `${candidate.project} pool-state resolver is not implemented yet`,
    };
  }

  const rpcEnvVar = CHAIN_RPC_ENV[run.chain_id];
  const rpcUrl = rpcEnvVar ? process.env[rpcEnvVar] : undefined;
  const factory = UNISWAP_V3_FACTORIES[run.chain_id];
  const fee = inferUniswapFee(run);
  if (!rpcUrl || !factory || fee == null) {
    return {
      status: 'missing',
      ...base,
      fee,
      rpcEnvVar,
      error: 'rpc url, factory, or fee tier is missing',
    };
  }

  try {
    const [token0, token1] = candidate.underlyingTokens;
    const poolAddress = await uniswapV3GetPool(rpcUrl, factory, token0, token1, fee);
    if (!poolAddress || poolAddress.toLowerCase() === ZERO_ADDRESS) {
      return {
        status: 'missing',
        ...base,
        fee,
        rpcEnvVar,
        error: 'Uniswap V3 factory returned zero pool address',
      };
    }
    const [slot0, liquidityHex] = await Promise.all([
      ethCall(rpcUrl, poolAddress, '0x3850c7bd'),
      ethCall(rpcUrl, poolAddress, '0x1a686502'),
    ]);
    return {
      status: 'ready',
      protocol: candidate.project,
      poolAddress,
      fee,
      sqrtPriceX96: BigInt(`0x${word(slot0, 0)}`).toString(),
      tick: decodeInt24(word(slot0, 1)),
      liquidity: BigInt(liquidityHex).toString(),
      rpcEnvVar,
      requiredInputs: ['price impact', 'gas estimate'],
    };
  } catch (err) {
    return {
      status: 'missing',
      ...base,
      fee,
      rpcEnvVar,
      error: (err as Error).message,
    };
  }
}

async function uniswapV3GetPool(
  rpcUrl: string,
  factory: string,
  token0: string,
  token1: string,
  fee: number,
): Promise<string> {
  const data = `0x1698ee82${padAddress(token0)}${padAddress(token1)}${padUint(fee)}`;
  const result = await ethCall(rpcUrl, factory, data);
  return `0x${result.slice(-40)}`;
}

async function ethCall(rpcUrl: string, to: string, data: string): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to, data }, 'latest'],
    }),
  });
  if (!res.ok) throw new Error(`rpc http ${res.status}`);
  const json = (await res.json()) as { result?: string; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? 'rpc error');
  if (!json.result) throw new Error('rpc returned no result');
  return json.result;
}

async function ethCallTx(
  rpcUrl: string,
  tx: { from: string; to: string; value: string; data: string },
): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [
        {
          from: tx.from,
          to: tx.to,
          value: toRpcQuantity(tx.value),
          data: tx.data,
        },
        'latest',
      ],
    }),
  });
  if (!res.ok) throw new Error(`rpc http ${res.status}`);
  const json = (await res.json()) as { result?: string; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? 'rpc error');
  if (!json.result) throw new Error('rpc returned no call result');
  return json.result;
}

async function ethEstimateGas(
  rpcUrl: string,
  tx: { from: string; to: string; value: string; data: string },
): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_estimateGas',
      params: [
        {
          from: tx.from,
          to: tx.to,
          value: toRpcQuantity(tx.value),
          data: tx.data,
        },
        'latest',
      ],
    }),
  });
  if (!res.ok) throw new Error(`rpc http ${res.status}`);
  const json = (await res.json()) as { result?: string; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? 'rpc error');
  if (!json.result) throw new Error('rpc returned no gas estimate');
  return json.result;
}

async function ethGasPrice(rpcUrl: string): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_gasPrice',
      params: [],
    }),
  });
  if (!res.ok) throw new Error(`rpc http ${res.status}`);
  const json = (await res.json()) as { result?: string; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? 'rpc error');
  if (!json.result) throw new Error('rpc returned no gas price');
  return json.result;
}

async function resolveGasCostInputs(
  run: LiveStrategyRunRow,
  rpcUrl: string,
  quote: LiveRunPreflightReport['quote'],
): Promise<{
  status: 'ready' | 'missing';
  gasPriceWei?: string;
  gasPriceHex?: string;
  gasPriceSource?: string;
  nativeTokenSymbol?: string;
  nativeTokenPriceUsd?: number;
  nativeTokenPriceSource?: string;
  error?: string;
}> {
  try {
    const gasPriceHex = await ethGasPrice(rpcUrl);
    const gasPriceWei = BigInt(gasPriceHex).toString();
    const nativePrice = await resolveNativeTokenPriceUsd(run, quote);
    if (nativePrice.priceUsd == null) {
      return {
        status: 'missing',
        gasPriceWei,
        gasPriceHex,
        gasPriceSource: 'eth_gasPrice',
        nativeTokenSymbol: nativePrice.symbol,
        error: nativePrice.error ?? 'native token price is missing',
      };
    }
    return {
      status: 'ready',
      gasPriceWei,
      gasPriceHex,
      gasPriceSource: 'eth_gasPrice',
      nativeTokenSymbol: nativePrice.symbol,
      nativeTokenPriceUsd: nativePrice.priceUsd,
      nativeTokenPriceSource: nativePrice.source,
    };
  } catch (err) {
    return {
      status: 'missing',
      nativeTokenSymbol: run.chain_id == null ? undefined : NATIVE_TOKEN_SYMBOLS[run.chain_id],
      error: (err as Error).message,
    };
  }
}

async function resolveNativeTokenPriceUsd(
  run: LiveStrategyRunRow,
  quote: LiveRunPreflightReport['quote'],
): Promise<{ symbol?: string; priceUsd?: number; source?: string; error?: string }> {
  const symbol = run.chain_id == null ? undefined : NATIVE_TOKEN_SYMBOLS[run.chain_id];
  const quotedNative = quote.prices?.find(
    (price) => price.symbol.toUpperCase() === 'WETH' || price.symbol.toUpperCase() === symbol,
  );
  if (quotedNative && quotedNative.priceUsd > 0) {
    return { symbol, priceUsd: quotedNative.priceUsd, source: quote.source ?? 'token quote' };
  }

  const coin = run.chain_id == null ? undefined : NATIVE_TOKEN_PRICE_COINS[run.chain_id];
  if (!coin) return { symbol, error: 'native token price coin is not configured' };
  try {
    const res = await fetch(`https://coins.llama.fi/prices/current/${coin}`);
    if (!res.ok) throw new Error(`DeFiLlama native price ${res.status}`);
    const json = (await res.json()) as {
      coins?: Record<string, { symbol?: string; price?: number }>;
    };
    const price = json.coins?.[coin]?.price;
    if (typeof price !== 'number' || price <= 0) {
      return { symbol, source: 'https://coins.llama.fi/prices/current', error: 'native token price missing' };
    }
    return {
      symbol: json.coins?.[coin]?.symbol ?? symbol,
      priceUsd: price,
      source: 'https://coins.llama.fi/prices/current',
    };
  } catch (err) {
    return { symbol, source: 'https://coins.llama.fi/prices/current', error: (err as Error).message };
  }
}

function estimateGasCostUsd(
  gasLimit: string,
  gasCost: { status: 'ready' | 'missing'; gasPriceWei?: string; nativeTokenPriceUsd?: number },
): number | undefined {
  if (gasCost.status !== 'ready' || !gasCost.gasPriceWei || gasCost.nativeTokenPriceUsd == null) {
    return undefined;
  }
  const nativeCost = (Number(gasLimit) * Number(gasCost.gasPriceWei)) / 1e18;
  const usd = nativeCost * gasCost.nativeTokenPriceUsd;
  return Number.isFinite(usd) ? Number(usd.toFixed(8)) : undefined;
}

function inferUniswapFee(run: LiveStrategyRunRow): number | null {
  const fee = run.plan?.transactions?.[0]?.label?.toLowerCase().includes('concentrated')
    ? 500
    : null;
  const paramFee = run.plan?.transactions?.[0] as { params?: { fee?: unknown } } | undefined;
  const n = Number(paramFee?.params?.fee);
  if (Number.isFinite(n)) return n;
  return fee;
}

function padAddress(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function padUint(value: number): string {
  return BigInt(value).toString(16).padStart(64, '0');
}

function word(hex: string, index: number): string {
  return hex.slice(2 + index * 64, 2 + (index + 1) * 64);
}

function decodeInt24(wordHex: string): number {
  let n = BigInt(`0x${wordHex}`);
  if (n >= 1n << 255n) n -= 1n << 256n;
  return Number(n);
}

function encodeApproveCalldata(spender: string, amount: string): string {
  return `${ERC20_APPROVE_SELECTOR}${encodeAddress(spender)}${encodeUint(amount)}`;
}

function encodeBalanceOfCalldata(owner: string): string {
  return `${ERC20_BALANCE_OF_SELECTOR}${encodeAddress(owner)}`;
}

function encodeAllowanceCalldata(owner: string, spender: string): string {
  return `${ERC20_ALLOWANCE_SELECTOR}${encodeAddress(owner)}${encodeAddress(spender)}`;
}

function encodeUniswapV3MintCalldata(params: {
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  amount0Desired: string;
  amount1Desired: string;
  amount0Min: string;
  amount1Min: string;
  recipient: string;
  deadline: string;
}): string {
  return `${UNISWAP_V3_MINT_SELECTOR}${[
    encodeAddress(params.token0),
    encodeAddress(params.token1),
    encodeUint(params.fee),
    encodeInt(params.tickLower),
    encodeInt(params.tickUpper),
    encodeUint(params.amount0Desired),
    encodeUint(params.amount1Desired),
    encodeUint(params.amount0Min),
    encodeUint(params.amount1Min),
    encodeAddress(params.recipient),
    encodeUint(params.deadline),
  ].join('')}`;
}

function encodeAddress(value: string): string {
  return value.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function encodeUint(value: string | number): string {
  return BigInt(value).toString(16).padStart(64, '0');
}

function toRpcQuantity(value: string): string {
  const n = BigInt(value);
  return `0x${n.toString(16)}`;
}

function shortHex(value: string): string {
  return value.length <= 34 ? value : `${value.slice(0, 18)}...${value.slice(-16)}`;
}

function encodeInt(value: number): string {
  const n = BigInt(value);
  const encoded = n < 0n ? (1n << 256n) + n : n;
  return encoded.toString(16).padStart(64, '0');
}

function sameAddress(a?: string | null, b?: string | null): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function roundTickDown(tick: number, spacing: number): number {
  return Math.floor(tick / spacing) * spacing;
}

function roundTickUp(tick: number, spacing: number): number {
  return Math.ceil(tick / spacing) * spacing;
}

function buildPoolAwareMintAmounts(params: {
  sqrtPriceX96: string;
  tickLower: number;
  tickUpper: number;
  amount0Available: string;
  amount1Available: string;
  maxSlippageBps: number;
}): {
  liquidity: string;
  amount0Desired: string;
  amount1Desired: string;
  amount0Min: string;
  amount1Min: string;
} {
  const sqrtRatioX96 = BigInt(params.sqrtPriceX96);
  const sqrtRatioAX96 = getSqrtRatioAtTick(params.tickLower);
  const sqrtRatioBX96 = getSqrtRatioAtTick(params.tickUpper);
  const [sqrtA, sqrtB] =
    sqrtRatioAX96 < sqrtRatioBX96
      ? [sqrtRatioAX96, sqrtRatioBX96]
      : [sqrtRatioBX96, sqrtRatioAX96];
  const amount0Available = BigInt(params.amount0Available);
  const amount1Available = BigInt(params.amount1Available);
  const liquidity = getLiquidityForAmounts(
    sqrtRatioX96,
    sqrtA,
    sqrtB,
    amount0Available,
    amount1Available,
  );
  const amount0Desired = getAmount0ForLiquidity(sqrtRatioX96, sqrtA, sqrtB, liquidity);
  const amount1Desired = getAmount1ForLiquidity(sqrtRatioX96, sqrtA, sqrtB, liquidity);
  const keepBps = BigInt(Math.max(0, 10_000 - params.maxSlippageBps));
  return {
    liquidity: liquidity.toString(),
    amount0Desired: amount0Desired.toString(),
    amount1Desired: amount1Desired.toString(),
    amount0Min: ((amount0Desired * keepBps) / 10_000n).toString(),
    amount1Min: ((amount1Desired * keepBps) / 10_000n).toString(),
  };
}

function getLiquidityForAmounts(
  sqrtRatioX96: bigint,
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  const [sqrtA, sqrtB] =
    sqrtRatioAX96 < sqrtRatioBX96
      ? [sqrtRatioAX96, sqrtRatioBX96]
      : [sqrtRatioBX96, sqrtRatioAX96];
  if (sqrtRatioX96 <= sqrtA) return getLiquidityForAmount0(sqrtA, sqrtB, amount0);
  if (sqrtRatioX96 < sqrtB) {
    const liquidity0 = getLiquidityForAmount0(sqrtRatioX96, sqrtB, amount0);
    const liquidity1 = getLiquidityForAmount1(sqrtA, sqrtRatioX96, amount1);
    return liquidity0 < liquidity1 ? liquidity0 : liquidity1;
  }
  return getLiquidityForAmount1(sqrtA, sqrtB, amount1);
}

function getLiquidityForAmount0(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, amount0: bigint): bigint {
  const [sqrtA, sqrtB] =
    sqrtRatioAX96 < sqrtRatioBX96
      ? [sqrtRatioAX96, sqrtRatioBX96]
      : [sqrtRatioBX96, sqrtRatioAX96];
  const intermediate = (sqrtA * sqrtB) / Q96;
  return (amount0 * intermediate) / (sqrtB - sqrtA);
}

function getLiquidityForAmount1(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, amount1: bigint): bigint {
  const [sqrtA, sqrtB] =
    sqrtRatioAX96 < sqrtRatioBX96
      ? [sqrtRatioAX96, sqrtRatioBX96]
      : [sqrtRatioBX96, sqrtRatioAX96];
  return (amount1 * Q96) / (sqrtB - sqrtA);
}

function getAmount0ForLiquidity(
  sqrtRatioX96: bigint,
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
): bigint {
  const [sqrtA, sqrtB] =
    sqrtRatioAX96 < sqrtRatioBX96
      ? [sqrtRatioAX96, sqrtRatioBX96]
      : [sqrtRatioBX96, sqrtRatioAX96];
  if (sqrtRatioX96 <= sqrtA) return amount0Delta(sqrtA, sqrtB, liquidity);
  if (sqrtRatioX96 < sqrtB) return amount0Delta(sqrtRatioX96, sqrtB, liquidity);
  return 0n;
}

function getAmount1ForLiquidity(
  sqrtRatioX96: bigint,
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
): bigint {
  const [sqrtA, sqrtB] =
    sqrtRatioAX96 < sqrtRatioBX96
      ? [sqrtRatioAX96, sqrtRatioBX96]
      : [sqrtRatioBX96, sqrtRatioAX96];
  if (sqrtRatioX96 <= sqrtA) return 0n;
  if (sqrtRatioX96 < sqrtB) return amount1Delta(sqrtA, sqrtRatioX96, liquidity);
  return amount1Delta(sqrtA, sqrtB, liquidity);
}

function amount0Delta(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, liquidity: bigint): bigint {
  const [sqrtA, sqrtB] =
    sqrtRatioAX96 < sqrtRatioBX96
      ? [sqrtRatioAX96, sqrtRatioBX96]
      : [sqrtRatioBX96, sqrtRatioAX96];
  return (((liquidity << 96n) * (sqrtB - sqrtA)) / sqrtB) / sqrtA;
}

function amount1Delta(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, liquidity: bigint): bigint {
  const [sqrtA, sqrtB] =
    sqrtRatioAX96 < sqrtRatioBX96
      ? [sqrtRatioAX96, sqrtRatioBX96]
      : [sqrtRatioBX96, sqrtRatioAX96];
  return (liquidity * (sqrtB - sqrtA)) / Q96;
}

function getSqrtRatioAtTick(tick: number): bigint {
  const absTick = tick < 0 ? -tick : tick;
  if (absTick > 887272) throw new Error(`tick out of range: ${tick}`);
  let ratio =
    (absTick & 0x1) !== 0
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;
  if ((absTick & 0x2) !== 0) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n;
  if ((absTick & 0x4) !== 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
  if ((absTick & 0x8) !== 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
  if ((absTick & 0x10) !== 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
  if ((absTick & 0x20) !== 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
  if ((absTick & 0x40) !== 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
  if ((absTick & 0x80) !== 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
  if ((absTick & 0x100) !== 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
  if ((absTick & 0x200) !== 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
  if ((absTick & 0x400) !== 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n;
  if ((absTick & 0x800) !== 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n;
  if ((absTick & 0x1000) !== 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
  if ((absTick & 0x2000) !== 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
  if ((absTick & 0x4000) !== 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n;
  if ((absTick & 0x8000) !== 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n;
  if ((absTick & 0x10000) !== 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n;
  if ((absTick & 0x20000) !== 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
  if ((absTick & 0x40000) !== 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n;
  if ((absTick & 0x80000) !== 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n;
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  return (ratio >> 32n) + (ratio % Q32 === 0n ? 0n : 1n);
}

function decimalToBaseUnits(value: string, decimals: number): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  const fixed = n.toFixed(decimals);
  const [whole, fraction = ''] = fixed.split('.');
  const raw = `${whole}${fraction.padEnd(decimals, '0').slice(0, decimals)}`;
  return BigInt(raw.replace(/^0+(?=\d)/, '') || '0').toString();
}

function baseUnitsToDecimalString(value: string, decimals: number): string {
  const raw = BigInt(value).toString().padStart(decimals + 1, '0');
  if (decimals === 0) return raw;
  const whole = raw.slice(0, -decimals) || '0';
  const fraction = raw.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

async function buildTokenQuote(run: LiveStrategyRunRow): Promise<LiveRunPreflightReport['quote']> {
  const artifact = await loadCandidateArtifact();
  const candidate = artifact?.candidates.find((c) => c.id === run.candidate_id) as
    CandidateSnapshot | undefined;
  const requiredInputs = ['current tick and liquidity', 'price impact', 'gas estimate'];
  if (!candidate || candidate.underlyingTokens.length < 2) {
    return {
      status: 'missing',
      capital: run.capital,
      requiredInputs: ['candidate underlying tokens', ...requiredInputs],
      error: 'candidate token metadata missing',
    };
  }

  try {
    let prices = new Map<string, TokenPrice>();
    let priceFetchError: string | undefined;
    try {
      prices = await fetchTokenPricesWithRetry(candidate);
    } catch (err) {
      priceFetchError = (err as Error).message;
    }

    for (const token of candidate.underlyingTokens) {
      if (prices.has(token.toLowerCase())) continue;
      const fallback = await fallbackTokenPrice(run, token);
      if (fallback) prices.set(token.toLowerCase(), fallback);
    }

    const missing = candidate.underlyingTokens.filter((token) => !prices.get(token.toLowerCase()));
    if (missing.length) {
      return {
        status: 'missing',
        capital: run.capital,
        source: priceFetchError
          ? `https://coins.llama.fi/prices/current (${priceFetchError})`
          : 'https://coins.llama.fi/prices/current',
        requiredInputs: [
          `missing prices for ${missing.join(', ')}`,
          'fallback token price source',
          ...requiredInputs,
        ],
        error: priceFetchError,
      };
    }

    const capitalUsd = Number(run.capital) / 1_000_000;
    const maxSlippageBps = riskLimitNumber(run, 'maxSlippageBps', 50);
    const tokenQuotes = candidate.underlyingTokens.map((token) => {
      const price = prices.get(token.toLowerCase());
      const usdShare = capitalUsd / candidate.underlyingTokens.length;
      const desiredAmount = usdShare / (price?.priceUsd ?? 1);
      const minAmount = desiredAmount * (1 - maxSlippageBps / 10_000);
      return {
        coin: price?.coin ?? `${chainSlug(candidate.chain)}:${token}`,
        token,
        symbol: price?.symbol ?? 'UNKNOWN',
        priceUsd: price?.priceUsd ?? 0,
        desiredAmount: formatQuoteAmount(desiredAmount),
        minAmount: formatQuoteAmount(minAmount),
        usdShare,
      };
    });

    return {
      status: 'partial',
      capital: run.capital,
      source: priceFetchError
        ? `fallback token prices after DeFiLlama error: ${priceFetchError}`
        : 'https://coins.llama.fi/prices/current',
      prices: tokenQuotes,
      requiredInputs,
    };
  } catch (err) {
    return {
      status: 'missing',
      capital: run.capital,
      source: 'https://coins.llama.fi/prices/current',
      requiredInputs: ['token price fetch', ...requiredInputs],
      error: (err as Error).message,
    };
  }
}

async function fetchTokenPrices(
  candidate: CandidateSnapshot,
): Promise<Map<string, TokenPrice>> {
  const coins = candidate.underlyingTokens.map((token) => `${chainSlug(candidate.chain)}:${token}`);
  const res = await fetch(`https://coins.llama.fi/prices/current/${coins.join(',')}`);
  if (!res.ok) throw new Error(`DeFiLlama prices ${res.status}`);
  const json = (await res.json()) as {
    coins?: Record<string, { symbol?: string; price?: number }>;
  };
  const out = new Map<string, TokenPrice>();
  for (const [coin, value] of Object.entries(json.coins ?? {})) {
    const token = coin.split(':')[1]?.toLowerCase();
    if (!token || typeof value.price !== 'number') continue;
    out.set(token, {
      coin,
      symbol: value.symbol ?? 'UNKNOWN',
      priceUsd: value.price,
    });
  }
  return out;
}

async function fetchTokenPricesWithRetry(candidate: CandidateSnapshot): Promise<Map<string, TokenPrice>> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchTokenPrices(candidate);
    } catch (err) {
      lastError = err as Error;
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastError ?? new Error('DeFiLlama prices unavailable');
}

async function fallbackTokenPrice(
  run: LiveStrategyRunRow,
  token: string,
): Promise<TokenPrice | undefined> {
  const configured = ASSETS.find(
    (asset) => asset.chainId === run.chain_id && sameAddress(asset.address, token),
  );
  const symbol = (configured?.symbol ?? '').toUpperCase();
  if (['USDC', 'USDT', 'DAI', 'USDS', 'PYUSD', 'LUSD', 'GHO'].includes(symbol)) {
    return { coin: `fallback:${symbol}`, symbol, priceUsd: 1 };
  }
  if (symbol === 'WETH' || symbol === 'ETH') {
    const native = await fetchCoinPriceUsd(NATIVE_TOKEN_PRICE_COINS[run.chain_id ?? 0]);
    if (native) return { coin: native.coin, symbol: configured?.symbol ?? native.symbol, priceUsd: native.priceUsd };
  }
  if (symbol === 'WBTC' || symbol === 'CBBTC' || symbol === 'BTC') {
    const btc = await fetchCoinPriceUsd('coingecko:bitcoin');
    if (btc) return { coin: btc.coin, symbol: configured?.symbol ?? btc.symbol, priceUsd: btc.priceUsd };
  }
  return undefined;
}

async function fetchCoinPriceUsd(coin?: string): Promise<TokenPrice | undefined> {
  if (!coin) return undefined;
  try {
    const res = await fetch(`https://coins.llama.fi/prices/current/${coin}`);
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      coins?: Record<string, { symbol?: string; price?: number }>;
    };
    const value = json.coins?.[coin];
    if (typeof value?.price !== 'number' || value.price <= 0) return undefined;
    return { coin, symbol: value.symbol ?? coin, priceUsd: value.price };
  } catch {
    return undefined;
  }
}

function chainSlug(chain: string): string {
  const map: Record<string, string> = {
    Ethereum: 'ethereum',
    Base: 'base',
    Arbitrum: 'arbitrum',
    Optimism: 'optimism',
    Polygon: 'polygon',
  };
  return map[chain] ?? chain.toLowerCase();
}

function riskLimitNumber(run: LiveStrategyRunRow, key: string, fallback: number): number {
  const value = run.plan?.riskLimits?.find((item) => item.key === key)?.value;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatQuoteAmount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value === 0) return '0';
  if (value >= 1) return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  return value.toPrecision(8);
}

function formatUsd(value: number | undefined): string {
  return value == null || !Number.isFinite(value) ? 'n/a' : value.toFixed(4);
}

async function pollQueuedBacktests(): Promise<void> {
  console.log('[backtest] queued-run poller start');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const rows = await db<{ id: string }>(
        `SELECT id FROM backtest_runs WHERE status='queued' ORDER BY created_at LIMIT 5`,
      );
      for (const row of rows) {
        await processBacktestRun(row.id);
      }
    } catch (err) {
      console.error('[backtest] poller error', (err as Error).message);
    }
    await sleep(3000);
  }
}

async function processBacktestRun(runId: string): Promise<void> {
  const rows = await db<BacktestRunRow>('SELECT * FROM backtest_runs WHERE id = $1', [runId]);
  if (!rows.length || rows[0].status !== 'queued') return;
  const run = rows[0];
  await db(`UPDATE backtest_runs SET status='running' WHERE id=$1 AND status='queued'`, [run.id]);
  const metrics = await buildBacktestMetrics(run);
  await db(`UPDATE backtest_runs SET status='done', metrics=$1, finished_at=now() WHERE id=$2`, [
    JSON.stringify(metrics),
    run.id,
  ]);
}

async function buildBacktestMetrics(run: {
  id: string;
  strategy_id: string;
  capital: string;
  params?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (run.strategy_id === 'lp-market-making' || run.strategy_id === 'yield-rotator') {
    const artifact = await loadCandidateArtifact();
    const requestedCandidateId =
      typeof run.params?.candidateId === 'string' ? run.params.candidateId : undefined;
    const candidate =
      artifact?.candidates.find((c) => c.id === requestedCandidateId) ?? artifact?.candidates[0];
    if (candidate) {
      const observedApy = conservativeObservedApy(candidate);
      const capital = Number(run.capital);
      const annualProfit = Number.isFinite(capital) ? (capital * observedApy) / 100 : 0;
      return {
        totalNetProfit: Math.round(annualProfit).toString(),
        tradeCount: 0,
        winningTrades: 0,
        winRate: 0,
        maxDrawdown: candidate.classification.includes('lp') ? 15 : 8,
        annualizedReturnPct: observedApy,
        sharpe: 0,
        equityCurve: [
          { block: 0, equity: run.capital },
          { block: 1, equity: Math.round(capital + annualProfit).toString() },
        ],
        dailyPnl: [],
        candidateId: candidate.id,
        candidate,
        methodology:
          'Evidence backtest from DeFiLlama fee/yield snapshot. This is not a block replay and not pure arbitrage.',
        caveats: candidate.riskNotes,
      };
    }
  }

  return {
    totalNetProfit: '0',
    tradeCount: 0,
    winningTrades: 0,
    winRate: 0,
    maxDrawdown: 0,
    annualizedReturnPct: 0,
    sharpe: 0,
    equityCurve: [],
    dailyPnl: [],
    methodology:
      'No verified profitable block-level arbitrage run is wired for this model yet. See docs/arbitrage-search-results.md.',
    caveats: ['Pure public-RPC AMM arbitrage has not produced five gas-positive 20%+ candidates.'],
  };
}

// ---------------------------------------------------------------------------
// morpho-watchlist-worker: refresh current Morpho state for stable replay markets.
// ---------------------------------------------------------------------------

async function startMorphoBlueWatchlistWorker(): Promise<void> {
  const intervalMs = envPositiveInteger('MORPHO_WATCH_REFRESH_MS', 120_000);
  const chain = String(process.env.MORPHO_WATCH_CHAIN ?? process.env.MORPHO_LIQ_CHAIN ?? 'ethereum')
    .trim()
    .toLowerCase();
  console.log(`[morpho-watchlist] start chain=${chain} intervalMs=${intervalMs}`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const startedAt = Date.now();
    try {
      await refreshMorphoBlueWatchlist(chain);
    } catch (err) {
      console.error('[morpho-watchlist] refresh error', (err as Error).message);
      await insertMetric('system', `morpho-watchlist:${chain}`, 'refresh_error', 1);
    }
    const elapsed = Date.now() - startedAt;
    await sleep(Math.max(10_000, intervalMs - elapsed));
  }
}

async function refreshMorphoBlueWatchlist(chain: string): Promise<void> {
  const env = await buildMorphoWatchlistEnv(chain);
  const current = await runNodeScript('scripts/search-morpho-blue-liquidations.mjs', env);
  if (current.exitCode !== 0) {
    throw new Error(
      `current Morpho scan exited ${current.exitCode}: ${lastLogLine(current.stderr)}`,
    );
  }
  const watchlist = await runNodeScript('scripts/build-morpho-blue-liquidation-watchlist.mjs', env);
  if (watchlist.exitCode !== 0) {
    throw new Error(
      `Morpho watchlist build exited ${watchlist.exitCode}: ${lastLogLine(watchlist.stderr)}`,
    );
  }
  const artifact = await loadMorphoWatchlistArtifact(chain);
  await persistMorphoWatchlistMetrics(chain, artifact);
  console.log(
    `[morpho-watchlist] refreshed chain=${chain} watch=${numMetric(
      artifact.summary?.watchCandidateCount,
    )} liquidatable=${numMetric(artifact.summary?.liquidatableCount)} passing=${numMetric(
      artifact.summary?.passingCurrentProfitabilityCount,
    )} generatedAt=${artifact.generatedAt ?? 'unknown'}`,
  );
}

async function buildMorphoWatchlistEnv(chain: string): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MORPHO_LIQ_CHAIN: chain,
    MORPHO_WATCH_CHAIN: chain,
    MORPHO_LIQ_POSITION_LIMIT:
      process.env.MORPHO_WATCH_POSITION_LIMIT ?? process.env.MORPHO_LIQ_POSITION_LIMIT ?? '100',
    MORPHO_LIQ_POSITION_PAGES:
      process.env.MORPHO_WATCH_POSITION_PAGES ?? process.env.MORPHO_LIQ_POSITION_PAGES ?? '2',
  };
  if (!env.MORPHO_LIQ_MARKET_IDS) {
    const stableMarketIds = await loadMorphoStableMarketIds(chain);
    if (stableMarketIds.length) {
      env.MORPHO_LIQ_MARKET_IDS = stableMarketIds.join(',');
      env.MORPHO_LIQ_MARKET_LIMIT = String(stableMarketIds.length);
    }
  }
  return env;
}

async function loadMorphoStableMarketIds(chain: string): Promise<string[]> {
  const path = resolve(
    process.cwd(),
    'data',
    `morpho-blue-liquidation-event-replay-candidates-${chain}.json`,
  );
  try {
    const artifact = JSON.parse(await readFile(path, 'utf8')) as MorphoReplayArtifact;
    const ids = new Set<string>();
    for (const candidate of artifact.candidates ?? []) {
      const metrics = candidate.replayMetrics ?? {};
      const annualized = numMetric(metrics.annualizedNetReturnPct, Number.NEGATIVE_INFINITY);
      const eventCount = numMetric(metrics.marketEventCount);
      const windowDays = numMetric(metrics.replayWindowDays);
      const minAnnualized = numMetric(metrics.minAnnualizedNetReturnPct, 20);
      const minEvents = numMetric(metrics.minMarketEventsForGate, 5);
      const minDays = numMetric(metrics.minReplayDaysForGate, 30);
      const stable =
        Boolean(candidate.marketId) &&
        annualized >= minAnnualized &&
        eventCount >= minEvents &&
        windowDays >= minDays &&
        numMetric(candidate.bestEstimate?.netProfitUsd) > 0;
      if (stable && candidate.marketId) ids.add(candidate.marketId);
    }
    return [...ids];
  } catch (err) {
    console.warn(
      `[morpho-watchlist] stable-market replay artifact unavailable: ${(err as Error).message}`,
    );
    return [];
  }
}

async function loadMorphoWatchlistArtifact(chain: string): Promise<MorphoWatchlistArtifact> {
  const path = resolve(process.cwd(), 'data', `morpho-blue-liquidation-watchlist-${chain}.json`);
  return JSON.parse(await readFile(path, 'utf8')) as MorphoWatchlistArtifact;
}

async function persistMorphoWatchlistMetrics(
  chain: string,
  artifact: MorphoWatchlistArtifact,
): Promise<void> {
  const scopeId = `morpho-watchlist:${chain}`;
  const summary = artifact.summary ?? {};
  await insertMetric(
    'system',
    scopeId,
    'historically_stable_market_count',
    numMetric(summary.historicallyStableMarketCount),
  );
  await insertMetric('system', scopeId, 'watch_candidate_count', numMetric(summary.watchCandidateCount));
  await insertMetric('system', scopeId, 'liquidatable_count', numMetric(summary.liquidatableCount));
  await insertMetric(
    'system',
    scopeId,
    'near_liquidation_count',
    numMetric(summary.nearLiquidationCount),
  );
  await insertMetric('system', scopeId, 'watch_count', numMetric(summary.watchCount));
  await insertMetric(
    'system',
    scopeId,
    'passing_current_profitability_count',
    numMetric(summary.passingCurrentProfitabilityCount),
  );
  await insertMetric('system', scopeId, 'requested_passing_count', numMetric(summary.requestedPassingCount));
}

// ---------------------------------------------------------------------------
// aave-watchlist-worker: refresh current Aave state for passing replay pairs.
// ---------------------------------------------------------------------------

async function startAaveLiquidationWatchlistWorker(): Promise<void> {
  const intervalMs = envPositiveInteger('AAVE_WATCH_REFRESH_MS', 120_000);
  const chain = String(process.env.AAVE_WATCH_CHAIN ?? process.env.LIQ_CHAIN ?? 'ethereum')
    .trim()
    .toLowerCase();
  console.log(`[aave-watchlist] start chain=${chain} intervalMs=${intervalMs}`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const startedAt = Date.now();
    try {
      await refreshAaveLiquidationWatchlist(chain);
    } catch (err) {
      console.error('[aave-watchlist] refresh error', (err as Error).message);
      await insertMetric('system', `aave-watchlist:${chain}`, 'refresh_error', 1);
    }
    const elapsed = Date.now() - startedAt;
    await sleep(Math.max(10_000, intervalMs - elapsed));
  }
}

async function refreshAaveLiquidationWatchlist(chain: string): Promise<void> {
  const env = await buildAaveWatchlistEnv(chain);
  const current = await runNodeScript('scripts/search-aave-liquidations.mjs', env);
  if (current.exitCode !== 0) {
    throw new Error(`current Aave scan exited ${current.exitCode}: ${lastLogLine(current.stderr)}`);
  }
  const watchlist = await runNodeScript('scripts/build-aave-liquidation-watchlist.mjs', env);
  if (watchlist.exitCode !== 0) {
    throw new Error(`Aave watchlist build exited ${watchlist.exitCode}: ${lastLogLine(watchlist.stderr)}`);
  }
  const artifact = await loadAaveWatchlistArtifact(chain);
  await persistAaveWatchlistMetrics(chain, artifact);
  console.log(
    `[aave-watchlist] refreshed chain=${chain} watch=${numMetric(
      artifact.summary?.watchCandidateCount,
    )} liquidatable=${numMetric(artifact.summary?.liquidatableCount)} passing=${numMetric(
      artifact.summary?.passingCurrentProfitabilityCount,
    )} generatedAt=${artifact.generatedAt ?? 'unknown'}`,
  );
}

async function buildAaveWatchlistEnv(chain: string): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LIQ_CHAIN: chain,
    AAVE_WATCH_CHAIN: chain,
    LIQ_SCAN_DESCENDING: process.env.AAVE_WATCH_SCAN_DESCENDING ?? process.env.LIQ_SCAN_DESCENDING ?? '1',
    LIQ_LOG_CHUNK_BLOCKS:
      process.env.AAVE_WATCH_LOG_CHUNK_BLOCKS ?? process.env.LIQ_LOG_CHUNK_BLOCKS ?? '10',
    LIQ_MAX_LOG_REQUESTS:
      process.env.AAVE_WATCH_MAX_LOG_REQUESTS ?? process.env.LIQ_MAX_LOG_REQUESTS ?? '600',
    LIQ_USER_LIMIT: process.env.AAVE_WATCH_USER_LIMIT ?? process.env.LIQ_USER_LIMIT ?? '80',
    LIQ_LOOKBACK_BLOCKS:
      process.env.AAVE_WATCH_LOOKBACK_BLOCKS ?? process.env.LIQ_LOOKBACK_BLOCKS ?? '50000',
    LIQ_RPC_TIMEOUT_MS:
      process.env.AAVE_WATCH_RPC_TIMEOUT_MS ?? process.env.LIQ_RPC_TIMEOUT_MS ?? '20000',
    AAVE_WATCH_NEAR_HEALTH_FACTOR:
      process.env.AAVE_WATCH_NEAR_HEALTH_FACTOR ?? '1.05',
    AAVE_WATCH_HEALTH_FACTOR:
      process.env.AAVE_WATCH_HEALTH_FACTOR ?? '1.15',
  };
  if (!env.LIQ_RESERVE_SYMBOLS) {
    const symbols = await loadAaveStablePairSymbols(chain);
    if (symbols.length) env.LIQ_RESERVE_SYMBOLS = symbols.join(',');
  }
  return env;
}

async function loadAaveStablePairSymbols(chain: string): Promise<string[]> {
  const path = resolve(process.cwd(), 'data', `aave-liquidation-event-replay-candidates-${chain}.json`);
  try {
    const artifact = JSON.parse(await readFile(path, 'utf8')) as AaveReplayArtifact;
    const symbols = new Set<string>();
    for (const candidate of artifact.candidates ?? []) {
      if (candidate.gate?.status !== 'pass') continue;
      const debt = candidate.bestEstimate?.debtSymbol;
      const collateral = candidate.bestEstimate?.collateralSymbol;
      if (debt) symbols.add(debt);
      if (collateral) symbols.add(collateral);
    }
    return [...symbols];
  } catch (err) {
    console.warn(`[aave-watchlist] replay artifact unavailable: ${(err as Error).message}`);
    return [];
  }
}

async function loadAaveWatchlistArtifact(chain: string): Promise<AaveWatchlistArtifact> {
  const path = resolve(process.cwd(), 'data', `aave-liquidation-watchlist-${chain}.json`);
  return JSON.parse(await readFile(path, 'utf8')) as AaveWatchlistArtifact;
}

async function persistAaveWatchlistMetrics(
  chain: string,
  artifact: AaveWatchlistArtifact,
): Promise<void> {
  const scopeId = `aave-watchlist:${chain}`;
  const summary = artifact.summary ?? {};
  await insertMetric(
    'system',
    scopeId,
    'historically_stable_pair_count',
    numMetric(summary.historicallyStablePairCount),
  );
  await insertMetric('system', scopeId, 'watch_candidate_count', numMetric(summary.watchCandidateCount));
  await insertMetric('system', scopeId, 'liquidatable_count', numMetric(summary.liquidatableCount));
  await insertMetric(
    'system',
    scopeId,
    'near_liquidation_count',
    numMetric(summary.nearLiquidationCount),
  );
  await insertMetric('system', scopeId, 'watch_count', numMetric(summary.watchCount));
  await insertMetric(
    'system',
    scopeId,
    'passing_current_profitability_count',
    numMetric(summary.passingCurrentProfitabilityCount),
  );
  await insertMetric('system', scopeId, 'requested_passing_count', numMetric(summary.requestedPassingCount));
}

function runNodeScript(script: string, env: NodeJS.ProcessEnv): Promise<ScriptRunResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = trimLog(`${stdout}${chunk.toString('utf8')}`);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = trimLog(`${stderr}${chunk.toString('utf8')}`);
    });
    child.on('error', rejectRun);
    child.on('close', (exitCode) => resolveRun({ exitCode, stdout, stderr }));
  });
}

async function insertMetric(
  scope: string,
  scopeId: string,
  metric: string,
  value: number,
): Promise<void> {
  await db(
    `INSERT INTO metrics_ts (scope, scope_id, ts, metric, value)
     VALUES ($1, $2, now(), $3, $4)
     ON CONFLICT DO NOTHING`,
    [scope, scopeId, metric, value],
  ).catch(() => undefined);
}

function envPositiveInteger(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function numMetric(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function trimLog(value: string): string {
  return value.length > 12_000 ? value.slice(value.length - 12_000) : value;
}

function lastLogLine(value: string): string {
  return value.trim().split(/\r?\n/).at(-1) ?? 'no stderr';
}

// ---------------------------------------------------------------------------
// risk-worker: continuous checks for vault loss / exposure / anomalies.
// ---------------------------------------------------------------------------

export async function startRiskWorker(): Promise<void> {
  console.log('[risk] start');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // Sample: check no vault's realized loss has blown the daily cap.
      const vaults = await db('SELECT id FROM vaults WHERE status = $1', ['active']);
      for (const v of vaults) {
        // Real check reads pnl_ts + risk_manager policy; emit risk_events on breach.
        await redis.get(`risk:breach:${v.id}`).then((flag: string | null) => {
          if (flag) {
            return db(
              `INSERT INTO risk_events (severity, scope, scope_id, message, data)
               VALUES ('critical', 'vault', $1, 'daily loss cap breached', $2)`,
              [v.id, JSON.stringify({ flag })],
            );
          }
          return undefined;
        });
      }
    } catch (err) {
      console.error('[risk] error', (err as Error).message);
    }
    await sleep(5000);
  }
}

// ---------------------------------------------------------------------------
// accounting-worker: parse on-chain ProfitReported events → PnL + share price.
// ---------------------------------------------------------------------------

export async function startAccountingWorker(): Promise<void> {
  console.log('[accounting] start');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // In production this reads ProfitReported / ExecutionRecorded events per
      // block and upserts pnl_ts + share_price_ts. For MVP we tick a heartbeat.
      await db(
        `INSERT INTO metrics_ts (scope, scope_id, ts, metric, value)
         VALUES ('system', 'accounting', now(), 'heartbeat', 1)
         ON CONFLICT DO NOTHING`,
      ).catch(() => undefined);
    } catch (err) {
      console.error('[accounting] error', (err as Error).message);
    }
    await sleep(30_000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

void CHAINS;
