#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');
const outPath = resolve(dataDir, 'live-opportunity-refresh.json');

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
    // Optional in CI.
  }
}

function envNumber(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envBool(key, fallback = false) {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'y'].includes(String(raw).toLowerCase());
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function taskTimeoutMs(task) {
  return envNumber(`LIVE_REFRESH_${task.key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_TIMEOUT_MS`, task.timeoutMs);
}

async function runTask(task) {
  const startedAt = new Date();
  const started = Date.now();
  const env = { ...process.env, ...task.env };
  const acceptedExitCodes = new Set(task.acceptedExitCodes ?? [0]);
  try {
    const result = await execFileAsync(task.command, task.args, {
      cwd: root,
      env,
      timeout: taskTimeoutMs(task),
      maxBuffer: 8 * 1024 * 1024,
    });
    const row = {
      key: task.key,
      familyKey: task.familyKey,
      label: task.label,
      status: acceptedExitCodes.has(0) ? 'passed' : 'failed',
      exitCode: 0,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - started,
      stdoutTail: result.stdout.slice(-1200),
      stderrTail: result.stderr.slice(-1200),
    };
    console.log(`liveRefreshTask=${JSON.stringify({ key: row.key, status: row.status, exitCode: row.exitCode, durationMs: row.durationMs })}`);
    return row;
  } catch (err) {
    const exitCode = err.code ?? 1;
    const accepted = acceptedExitCodes.has(exitCode);
    const row = {
      key: task.key,
      familyKey: task.familyKey,
      label: task.label,
      status: accepted ? 'accepted-nonzero' : 'failed',
      exitCode,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - started,
      stdoutTail: String(err.stdout ?? '').slice(-1200),
      stderrTail: String(err.stderr ?? err.message ?? '').slice(-1200),
    };
    console.log(`liveRefreshTask=${JSON.stringify({ key: row.key, status: row.status, exitCode: row.exitCode, durationMs: row.durationMs })}`);
    return row;
  }
}

function quickTasks() {
  return [
    {
      key: 'aave-ethereum-current',
      familyKey: 'aave-liquidations',
      label: 'Aave V3 current liquidation scan Ethereum',
      command: 'npm',
      args: ['run', 'search:liquidations'],
      timeoutMs: envNumber('LIVE_REFRESH_AAVE_ETHEREUM_TIMEOUT_MS', 240_000),
      env: {
        LIQ_CHAIN: 'ethereum',
        LIQ_SCAN_DESCENDING: '1',
        LIQ_LOOKBACK_BLOCKS: process.env.LIVE_REFRESH_AAVE_ETHEREUM_LOOKBACK_BLOCKS ?? '300',
        LIQ_LOG_CHUNK_BLOCKS: process.env.LIVE_REFRESH_AAVE_ETHEREUM_LOG_CHUNK_BLOCKS ?? '10',
        LIQ_MAX_LOG_REQUESTS: process.env.LIVE_REFRESH_AAVE_ETHEREUM_MAX_LOG_REQUESTS ?? '520',
        LIQ_USER_LIMIT: process.env.LIVE_REFRESH_AAVE_ETHEREUM_USER_LIMIT ?? '80',
        LIQ_RESERVE_SYMBOLS:
          process.env.LIVE_REFRESH_AAVE_ETHEREUM_RESERVES ??
          'USDT,USDC,DAI,WETH,WBTC,wstETH,cbETH,rETH',
      },
    },
    {
      key: 'aave-base-current',
      familyKey: 'aave-liquidations',
      label: 'Aave V3 current liquidation scan Base',
      command: 'npm',
      args: ['run', 'search:liquidations'],
      timeoutMs: envNumber('LIVE_REFRESH_AAVE_BASE_TIMEOUT_MS', 240_000),
      env: {
        LIQ_CHAIN: 'base',
        LIQ_SCAN_DESCENDING: '1',
        LIQ_LOOKBACK_BLOCKS: process.env.LIVE_REFRESH_AAVE_BASE_LOOKBACK_BLOCKS ?? '500',
        LIQ_LOG_CHUNK_BLOCKS: process.env.LIVE_REFRESH_AAVE_BASE_LOG_CHUNK_BLOCKS ?? '10',
        LIQ_MAX_LOG_REQUESTS: process.env.LIVE_REFRESH_AAVE_BASE_MAX_LOG_REQUESTS ?? '180',
        LIQ_USER_LIMIT: process.env.LIVE_REFRESH_AAVE_BASE_USER_LIMIT ?? '50',
        LIQ_RESERVE_SYMBOLS:
          process.env.LIVE_REFRESH_AAVE_BASE_RESERVES ?? 'USDC,WETH,cbETH,wstETH,USDbC,DAI',
      },
    },
    {
      key: 'aave-arbitrum-current',
      familyKey: 'aave-liquidations',
      label: 'Aave V3 current liquidation scan Arbitrum',
      command: 'npm',
      args: ['run', 'search:liquidations'],
      timeoutMs: envNumber('LIVE_REFRESH_AAVE_ARBITRUM_TIMEOUT_MS', 180_000),
      env: {
        LIQ_CHAIN: 'arbitrum',
        LIQ_SCAN_DESCENDING: '1',
        LIQ_LOOKBACK_BLOCKS: process.env.LIVE_REFRESH_AAVE_ARBITRUM_LOOKBACK_BLOCKS ?? '300',
        LIQ_LOG_CHUNK_BLOCKS: process.env.LIVE_REFRESH_AAVE_ARBITRUM_LOG_CHUNK_BLOCKS ?? '10',
        LIQ_MAX_LOG_REQUESTS: process.env.LIVE_REFRESH_AAVE_ARBITRUM_MAX_LOG_REQUESTS ?? '180',
        LIQ_USER_LIMIT: process.env.LIVE_REFRESH_AAVE_ARBITRUM_USER_LIMIT ?? '50',
        LIQ_RESERVE_SYMBOLS:
          process.env.LIVE_REFRESH_AAVE_ARBITRUM_RESERVES ?? 'USDC,WETH,WBTC,USDT,ARB',
      },
    },
    {
      key: 'compound-ethereum-current',
      familyKey: 'compound-v3-liquidations',
      label: 'Compound V3 current liquidation scan Ethereum',
      command: 'npm',
      args: ['run', 'search:compound-liquidations'],
      timeoutMs: envNumber('LIVE_REFRESH_COMPOUND_ETHEREUM_TIMEOUT_MS', 180_000),
      env: {
        COMP_LIQ_CHAIN: 'ethereum',
        COMP_LIQ_LOOKBACK_BLOCKS: process.env.LIVE_REFRESH_COMPOUND_ETHEREUM_LOOKBACK_BLOCKS ?? '500',
        COMP_LIQ_LOG_CHUNK_BLOCKS: process.env.LIVE_REFRESH_COMPOUND_ETHEREUM_LOG_CHUNK_BLOCKS ?? '50',
        COMP_LIQ_MAX_LOG_REQUESTS: process.env.LIVE_REFRESH_COMPOUND_ETHEREUM_MAX_LOG_REQUESTS ?? '120',
        COMP_LIQ_ACCOUNT_LIMIT: process.env.LIVE_REFRESH_COMPOUND_ETHEREUM_ACCOUNT_LIMIT ?? '60',
        COMP_LIQ_BASE_AMOUNTS: process.env.LIVE_REFRESH_COMPOUND_ETHEREUM_BASE_AMOUNTS ?? '10,100,1000',
      },
    },
    {
      key: 'morpho-ethereum-current',
      familyKey: 'morpho-blue-liquidations',
      label: 'Morpho Blue current liquidation scan Ethereum',
      command: 'npm',
      args: ['run', 'search:morpho-liquidations'],
      timeoutMs: envNumber('LIVE_REFRESH_MORPHO_ETHEREUM_TIMEOUT_MS', 240_000),
      env: {
        MORPHO_LIQ_CHAIN: 'ethereum',
        MORPHO_LIQ_MARKET_LIMIT: process.env.LIVE_REFRESH_MORPHO_MARKET_LIMIT ?? '60',
        MORPHO_LIQ_POSITION_LIMIT: process.env.LIVE_REFRESH_MORPHO_POSITION_LIMIT ?? '120',
        MORPHO_LIQ_POSITION_PAGES: process.env.LIVE_REFRESH_MORPHO_POSITION_PAGES ?? '2',
        MORPHO_LIQ_MIN_NET_PROFIT_USD: process.env.LIVE_REFRESH_MIN_NET_PROFIT_USD ?? '5',
        MORPHO_LIQ_MIN_RETURN_ON_REPAY_PCT: process.env.LIVE_REFRESH_MIN_RETURN_PCT ?? '0.1',
      },
    },
    {
      key: 'live-fork-verification',
      familyKey: 'live-verification',
      label: 'Fork verification for current passing candidates',
      command: 'npm',
      args: ['run', 'verify:live-fork-candidates'],
      timeoutMs: envNumber('LIVE_REFRESH_FORK_VERIFY_TIMEOUT_MS', 300_000),
      acceptedExitCodes: [0, 2],
      env: {
        LIVE_FORK_VERIFY_LIMIT: process.env.LIVE_REFRESH_FORK_VERIFY_LIMIT ?? '5',
      },
    },
    {
      key: 'pure-overview',
      familyKey: 'overview',
      label: 'Pure arbitrage overview refresh',
      command: 'npm',
      args: ['run', 'search:pure-overview'],
      timeoutMs: envNumber('LIVE_REFRESH_OVERVIEW_TIMEOUT_MS', 120_000),
      acceptedExitCodes: [0, 2],
      env: {},
    },
    {
      key: 'market-depth',
      familyKey: 'market-depth',
      label: 'Build DEX market depth snapshots',
      command: 'npm',
      args: ['run', 'build:market-depth'],
      timeoutMs: envNumber('LIVE_REFRESH_MARKET_DEPTH_TIMEOUT_MS', 240_000),
      acceptedExitCodes: [0, 2],
      env: {
        MARKET_DEPTH_MAX_PER_ARTIFACT: process.env.LIVE_REFRESH_MARKET_DEPTH_MAX_PER_ARTIFACT ?? '25',
      },
    },
    {
      key: 'live-opportunity-feed',
      familyKey: 'opportunity-feed',
      label: 'Build normalized live opportunity feed',
      command: 'npm',
      args: ['run', 'build:live-opportunity-feed'],
      timeoutMs: envNumber('LIVE_REFRESH_FEED_TIMEOUT_MS', 120_000),
      acceptedExitCodes: [0, 2],
      env: {},
    },
  ];
}

async function artifactSummaries() {
  const files = [
    ['overview', 'pure-arbitrage-search-overview.json'],
    ['liveForkVerification', 'live-fork-verification.json'],
    ['aaveEthereum', 'aave-liquidation-candidates-ethereum.json'],
    ['aaveBase', 'aave-liquidation-candidates-base.json'],
    ['aaveArbitrum', 'aave-liquidation-candidates-arbitrum.json'],
    ['compoundEthereum', 'compound-v3-liquidation-candidates-ethereum.json'],
    ['morphoEthereum', 'morpho-blue-liquidation-candidates-ethereum.json'],
    ['marketDepth', 'market-depth-snapshots.json'],
    ['liveOpportunityFeed', 'live-opportunity-feed.json'],
  ];
  const out = {};
  for (const [key, file] of files) {
    const artifact = await readJson(resolve(dataDir, file));
    out[key] = artifact
      ? {
          file,
          generatedAt: artifact.generatedAt ?? null,
          summary: artifact.summary ?? null,
        }
      : { file, missing: true };
  }
  return out;
}

async function main() {
  loadDotenv();
  const startedAt = new Date();
  const profile = process.env.LIVE_REFRESH_PROFILE ?? 'quick';
  const tasks = quickTasks();
  const selectedTasks = envBool('LIVE_REFRESH_SKIP_SEARCH', false)
    ? tasks.filter((task) =>
        ['live-fork-verification', 'pure-overview', 'market-depth', 'live-opportunity-feed'].includes(
          task.key,
        ),
      )
    : tasks;

  const results = [];
  for (const task of selectedTasks) {
    results.push(await runTask(task));
  }

  const summaries = await artifactSummaries();
  const liveReadyCount = summaries.liveForkVerification?.summary?.liveReadyCount ?? 0;
  const passingCount = summaries.overview?.summary?.passingCount ?? 0;
  const requestedPassingCount = summaries.overview?.summary?.requestedPassingCount ?? 5;
  const failedTasks = results.filter((result) => result.status === 'failed');
  const status =
    failedTasks.length > 0
      ? 'refresh-finished-with-task-failures'
      : liveReadyCount >= requestedPassingCount
        ? 'live-ready-threshold-met'
        : passingCount >= requestedPassingCount
          ? 'historical-threshold-met-live-blocked'
          : 'historical-and-live-thresholds-not-met';
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    profile,
    objective: {
      pureOnChainOnly: true,
      walletOnly: true,
      requestedPassingStrategies: requestedPassingCount,
      minAnnualizedNetReturnPct: 20,
      liveReadyRequiresCurrentGateForkExecutorAndProfit: true,
    },
    summary: {
      status,
      taskCount: results.length,
      failedTaskCount: failedTasks.length,
      historicalPassingCount: passingCount,
      liveReadyCount,
      requestedPassingCount,
      liveExecutionStatus:
        liveReadyCount >= requestedPassingCount ? 'ready-for-controlled-rollout' : 'blocked',
    },
    tasks: results,
    artifacts: summaries,
    caveats: [
      '20%+ APY cannot be guaranteed; this refresh only verifies evidence gates.',
      'Historical liquidation replay is not a current executable opportunity.',
      'Live execution remains blocked unless current opportunity gates and fork executor simulation pass.',
    ],
  };
  await mkdir(dataDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`liveRefreshSummary=${JSON.stringify(report.summary)} report=${outPath}`);
  if (failedTasks.length > 0 || liveReadyCount < Number(process.env.LIVE_REFRESH_REQUIRED_LIVE_READY ?? 1)) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
