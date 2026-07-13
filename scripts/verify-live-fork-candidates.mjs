#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');
const outPath = resolve(dataDir, 'live-fork-verification.json');
const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = apiRequire('pg');

function loadDotenv() {
  try {
    const text = readFileSync(resolve(root, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed
        .slice(idx + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Optional.
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function walletBuffer(address) {
  return Buffer.from(address.replace(/^0x/i, '').padStart(40, '0'), 'hex');
}

function parseReport(stdout) {
  const prefix = 'forkSimulationReport=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(prefix));
  if (!line) return null;
  return JSON.parse(line.slice(prefix.length));
}

function chainIdFromArtifact(artifact, fallback = 1) {
  const chainId = Number(artifact?.source?.chain?.chainId);
  return Number.isFinite(chainId) && chainId > 0 ? chainId : fallback;
}

function scoreCandidate(candidate) {
  const score = Number(
    candidate?.bestEstimate?.netProfitUsd ??
      candidate?.metrics?.netProfitUsd ??
      candidate?.bestEstimate?.grossProfitUsd ??
      0,
  );
  return Number.isFinite(score) ? score : 0;
}

function morphoPlan(candidate, walletCapital) {
  return {
    id: `morpho-blue-liq-plan-${candidate.id}`,
    candidateId: candidate.id,
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    status: 'fork-simulation-required',
    strategyId: 'atomic-amm',
    chainId: 1,
    chain: candidate.chain,
    strategyType: 'morpho-blue-liquidation-arbitrage',
    capital: walletCapital,
    borrower: candidate.user,
    liquidation: {
      morpho: candidate.liveInterface?.requiredContracts?.morpho ?? '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
      marketId: candidate.marketId,
      marketParams: candidate.marketParams,
      loanAsset: candidate.bestEstimate?.loanAsset ?? candidate.marketParams.loanToken,
      loanSymbol: candidate.bestEstimate?.loanSymbol ?? null,
      collateralAsset: candidate.bestEstimate?.collateralAsset ?? candidate.marketParams.collateralToken,
      collateralSymbol: candidate.bestEstimate?.collateralSymbol ?? null,
      repayUsd: candidate.bestEstimate?.repayUsd ?? null,
      liquidationSelector: '0xd8eabcb8',
    },
    riskLimits: [
      { key: 'maxSlippageBps', value: 30, unit: 'bps' },
      { key: 'maxGasUsd', value: 25, unit: 'USD' },
      { key: 'minNetProfitUsd', value: candidate.gate?.minNetProfitUsd ?? 5, unit: 'USD' },
    ],
    blockedBy: ['fork verification run; no transaction is submitted by this script'],
    evidence: {
      isPureArbitrage: candidate.isPureArbitrage,
      gate: candidate.gate,
      bestEstimate: candidate.bestEstimate,
    },
  };
}

function aavePlan(candidate, walletCapital, artifact) {
  const best = candidate.bestEstimate ?? {};
  const pool =
    candidate.liveInterface?.requiredContracts?.aaveV3Pool ??
    artifact?.source?.pool ??
    artifact?.source?.chain?.aaveV3Pool ??
    null;
  return {
    id: `aave-liq-plan-${candidate.id}`,
    candidateId: candidate.id,
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    status: 'fork-simulation-required',
    strategyId: 'atomic-amm',
    chainId: chainIdFromArtifact(artifact),
    chain: candidate.chain,
    strategyType: 'aave-v3-liquidation-arbitrage',
    capital: walletCapital,
    borrower: candidate.user,
    liquidation: {
      pool,
      debtAsset: best.debtAsset ?? null,
      debtSymbol: best.debtSymbol ?? null,
      collateralAsset: best.collateralAsset ?? null,
      collateralSymbol: best.collateralSymbol ?? null,
      debtToCoverUsd: best.debtToCoverUsd ?? null,
      debtToCover: best.debtToCoverBaseUnits ?? best.debtToCover ?? null,
      debtToCoverSource: best.debtToCoverSource ?? null,
      seizedCollateralUsd: best.seizedCollateralUsd ?? null,
      seizedCollateralAmount: best.seizedCollateralAmount ?? null,
      seizedCollateralBaseUnits: best.seizedCollateralBaseUnits ?? null,
      seizedCollateralSource: best.seizedCollateralSource ?? null,
      receiveAToken: false,
      liquidationCallSelector: '0x00a718a9',
    },
    riskLimits: [
      { key: 'maxSlippageBps', value: 30, unit: 'bps' },
      { key: 'maxGasUsd', value: 25, unit: 'USD' },
      { key: 'minNetProfitUsd', value: candidate.gate?.minNetProfitUsd ?? 5, unit: 'USD' },
    ],
    blockedBy: ['fork verification run; no transaction is submitted by this script'],
    evidence: {
      isPureArbitrage: candidate.isPureArbitrage,
      gate: candidate.gate,
      healthFactor: candidate.account?.healthFactor ?? null,
      bestEstimate: candidate.bestEstimate ?? null,
    },
  };
}

function compoundPlan(candidate, walletCapital, artifact) {
  const best = candidate.bestEstimate ?? {};
  const comet =
    candidate.liveInterface?.requiredContracts?.comet ??
    artifact?.source?.comet ??
    artifact?.source?.chain?.comet ??
    null;
  return {
    id: `compound-v3-liq-plan-${candidate.id}`,
    candidateId: candidate.id,
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    status: 'fork-simulation-required',
    strategyId: 'atomic-amm',
    chainId: chainIdFromArtifact(artifact),
    chain: candidate.chain,
    strategyType: 'compound-v3-liquidation-arbitrage',
    capital: walletCapital,
    borrower: candidate.user,
    liquidation: {
      comet,
      baseAsset: best.baseAsset ?? null,
      baseSymbol: best.baseSymbol ?? null,
      collateralAsset: best.collateralAsset ?? null,
      collateralSymbol: best.collateralSymbol ?? null,
      baseAmount: best.baseAmount ?? null,
      baseAmountHuman: best.baseAmountHuman ?? null,
      quotedCollateral: best.quotedCollateral ?? null,
      quotedCollateralHuman: best.quotedCollateralHuman ?? null,
      absorbSelector: '0xc3cecfd2',
      buyCollateralSelector: '0xe4e6e779',
    },
    riskLimits: [
      { key: 'maxSlippageBps', value: 30, unit: 'bps' },
      { key: 'maxGasUsd', value: 25, unit: 'USD' },
      { key: 'minNetProfitUsd', value: candidate.gate?.minNetProfitUsd ?? 5, unit: 'USD' },
    ],
    blockedBy: ['fork verification run; no transaction is submitted by this script'],
    evidence: {
      isPureArbitrage: candidate.isPureArbitrage,
      gate: candidate.gate,
      isLiquidatable: candidate.account?.isLiquidatable ?? null,
      borrowBalanceHuman: candidate.account?.borrowBalanceHuman ?? null,
      bestEstimate: candidate.bestEstimate ?? null,
    },
  };
}

function loadPassingFromArtifact(artifact, familyKey, plan) {
  return (artifact?.candidates ?? [])
    .filter((candidate) => candidate.gate?.status === 'pass')
    .map((candidate) => ({
      familyKey,
      candidate,
      plan: (selectedCandidate, capital) => plan(selectedCandidate, capital, artifact),
    }));
}

async function loadSupportedCandidates(limit) {
  const specs = [
    ['aave-v3-liquidations', 'aave-liquidation-candidates-ethereum.json', aavePlan],
    ['aave-v3-liquidations', 'aave-liquidation-candidates-base.json', aavePlan],
    ['aave-v3-liquidations', 'aave-liquidation-candidates-arbitrum.json', aavePlan],
    ['aave-v3-liquidations', 'aave-liquidation-candidates-polygon.json', aavePlan],
    ['compound-v3-liquidations', 'compound-v3-liquidation-candidates-ethereum.json', compoundPlan],
    ['morpho-blue-liquidations', 'morpho-blue-liquidation-candidates-ethereum.json', morphoPlan],
  ];
  const items = [];
  for (const [familyKey, fileName, plan] of specs) {
    const artifact = await readJson(resolve(dataDir, fileName));
    items.push(...loadPassingFromArtifact(artifact, familyKey, plan));
  }
  return items
    .sort((a, b) => scoreCandidate(b.candidate) - scoreCandidate(a.candidate))
    .slice(0, limit);
}

async function insertRun(pool, item, wallet, capital) {
  const plan = item.plan(item.candidate, capital);
  const { rows } = await pool.query(
    `INSERT INTO live_strategy_runs
       (candidate_id, strategy_id, status, chain_id, wallet_address, capital, plan, risk_limits, blocked_by)
     VALUES ($1, $2, 'blocked', $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      item.candidate.id,
      plan.strategyId,
      plan.chainId,
      walletBuffer(wallet),
      capital,
      JSON.stringify(plan),
      JSON.stringify(plan.riskLimits),
      JSON.stringify(plan.blockedBy),
    ],
  );
  return rows[0].id;
}

async function runFork(runId) {
  try {
    const result = await execFileAsync('node', ['scripts/fork-simulate-live-run.mjs', runId], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${process.env.HOME ?? ''}/.foundry/bin:${process.env.PATH ?? ''}`,
      },
      timeout: Number(process.env.LIVE_FORK_VERIFY_TIMEOUT_MS ?? 240_000),
      maxBuffer: 8 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (err) {
    return {
      exitCode: err.code ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? '',
    };
  }
}

async function main() {
  loadDotenv();
  const limit = Number(process.env.LIVE_FORK_VERIFY_LIMIT ?? 5);
  const capital = process.env.LIVE_FORK_VERIFY_CAPITAL ?? '1000000000';
  const wallet = process.env.LIVE_FORK_VERIFY_WALLET ?? '0x0000000000000000000000000000000000000001';
  const candidates = await loadSupportedCandidates(limit);
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://oal:oal_dev_password@127.0.0.1:5432/oal',
  });
  const results = [];
  try {
    for (const item of candidates) {
      const runId = await insertRun(pool, item, wallet, capital);
      const fork = await runFork(runId);
      const report = parseReport(fork.stdout);
      const executorStatus =
        report?.morphoBlueExecutor?.executorForkSimulation?.status ??
        report?.compoundExecutor?.executorForkSimulation?.status ??
        report?.aaveFlashLoanExecutor?.executorForkSimulation?.status ??
        report?.walletAtomicExecutorRehearsal?.sendResult?.status ??
        null;
      const liveReady = report?.forkSimulation === 'passed' && executorStatus === 'passed';
      const row = {
        familyKey: item.familyKey,
        candidateId: item.candidate.id,
        runId,
        liveReady,
        forkSimulation: report?.forkSimulation ?? 'missing-report',
        reason: report?.reason ?? null,
        executorStatus,
        executorCalldataStatus:
          report?.morphoBlueExecutor?.executeCalldataStatus ??
          report?.compoundExecutor?.executeCalldataStatus ??
          report?.aaveFlashLoanExecutor?.executeLiquidationCalldataStatus ??
          null,
        unwindQuoteStatus: report?.collateralUnwindQuote?.status ?? null,
        netProfitUsd: item.candidate.bestEstimate?.netProfitUsd ?? item.candidate.metrics?.netProfitUsd ?? null,
        stderrHead: fork.stderr.slice(0, 500),
      };
      results.push(row);
      console.log(`liveForkVerify=${JSON.stringify(row)}`);
    }
  } finally {
    await pool.end();
  }

  const summary = {
    verifiedCount: results.length,
    liveReadyCount: results.filter((result) => result.liveReady).length,
    status: results.some((result) => result.liveReady)
      ? 'found-live-ready-fork-verified-candidates'
      : 'no-live-ready-fork-verified-candidates',
  };
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    methodology: {
      pureOnChainOnly: true,
      noCexRequired: true,
      liveReadyRequires: [
        'candidate evidence gate is pass',
        'fork-simulate-live-run emits forkSimulation=passed',
        'strategy executor transaction status is passed',
      ],
      supportedFamilies: [
        'aave-v3-liquidations',
        'compound-v3-liquidations',
        'morpho-blue-liquidations',
      ],
      supportedCandidateArtifacts: [
        'aave-liquidation-candidates-ethereum.json',
        'aave-liquidation-candidates-base.json',
        'aave-liquidation-candidates-arbitrum.json',
        'aave-liquidation-candidates-polygon.json',
        'compound-v3-liquidation-candidates-ethereum.json',
        'morpho-blue-liquidation-candidates-ethereum.json',
      ],
    },
    summary,
    results,
  };
  await mkdir(dataDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`liveForkVerifySummary=${JSON.stringify(summary)} report=${outPath}`);
  if (summary.liveReadyCount < Number(process.env.LIVE_FORK_VERIFY_REQUIRED ?? 1)) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
