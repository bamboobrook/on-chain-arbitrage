#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');
const outJson = resolve(dataDir, 'pure-arbitrage-search-overview.json');
const liveForkVerificationJson = resolve(dataDir, 'live-fork-verification.json');

const REQUESTED_PASSING = 5;
const MIN_ANNUALIZED_NET_RETURN_PCT = 20;

const TASKS = [
  {
    key: 'dex-base',
    familyKey: 'dex-quote-replay',
    label: 'DEX quote replay Base',
    command: 'npm',
    args: ['run', 'search:dex-arb'],
    env: {
      DEX_ARB_CHAIN: 'base',
      DEX_ARB_SAMPLE_COUNT: '3',
      DEX_ARB_LOOKBACK_BLOCKS: '600',
      DEX_ARB_PAIR_LIMIT: '8',
      DEX_ARB_TRIANGLE_LIMIT: '1',
      DEX_ARB_MAX_STRATEGIES: '24',
      DEX_ARB_AMOUNT_MULTIPLIERS: '0.1,1',
    },
  },
  {
    key: 'dex-arbitrum',
    familyKey: 'dex-quote-replay',
    label: 'DEX quote replay Arbitrum',
    command: 'npm',
    args: ['run', 'search:dex-arb'],
    env: {
      DEX_ARB_CHAIN: 'arbitrum',
      DEX_ARB_SAMPLE_COUNT: '3',
      DEX_ARB_LOOKBACK_BLOCKS: '600',
      DEX_ARB_PAIR_LIMIT: '8',
      DEX_ARB_TRIANGLE_LIMIT: '1',
      DEX_ARB_MAX_STRATEGIES: '24',
      DEX_ARB_AMOUNT_MULTIPLIERS: '0.1,1',
    },
  },
  {
    key: 'dex-polygon',
    familyKey: 'dex-quote-replay',
    label: 'DEX quote replay Polygon',
    command: 'npm',
    args: ['run', 'search:dex-arb'],
    env: {
      DEX_ARB_CHAIN: 'polygon',
      DEX_ARB_SAMPLE_COUNT: '3',
      DEX_ARB_LOOKBACK_BLOCKS: '600',
      DEX_ARB_PAIR_LIMIT: '6',
      DEX_ARB_TRIANGLE_LIMIT: '0',
      DEX_ARB_MAX_STRATEGIES: '12',
      DEX_ARB_AMOUNT_MULTIPLIERS: '0.1,1,5',
    },
  },
  {
    key: 'dex-ethereum',
    familyKey: 'dex-quote-replay',
    label: 'DEX quote replay Ethereum',
    command: 'npm',
    args: ['run', 'search:dex-arb'],
    env: {
      DEX_ARB_CHAIN: 'ethereum',
      DEX_ARB_SAMPLE_COUNT: '2',
      DEX_ARB_LOOKBACK_BLOCKS: '300',
      DEX_ARB_PAIR_LIMIT: '5',
      DEX_ARB_TRIANGLE_LIMIT: '1',
      DEX_ARB_MAX_STRATEGIES: '14',
      DEX_ARB_AMOUNT_MULTIPLIERS: '0.1,1',
    },
  },
  {
    key: 'dex-optimism',
    familyKey: 'dex-quote-replay',
    label: 'DEX quote replay Optimism',
    command: 'npm',
    args: ['run', 'search:dex-arb'],
    env: {
      DEX_ARB_CHAIN: 'optimism',
      DEX_ARB_SAMPLE_COUNT: '3',
      DEX_ARB_LOOKBACK_BLOCKS: '600',
      DEX_ARB_PAIR_LIMIT: '6',
      DEX_ARB_TRIANGLE_LIMIT: '1',
      DEX_ARB_MAX_STRATEGIES: '18',
      DEX_ARB_AMOUNT_MULTIPLIERS: '0.1,1',
    },
  },
  {
    key: 'dex-bnb',
    familyKey: 'dex-quote-replay',
    label: 'DEX quote replay BNB',
    command: 'npm',
    args: ['run', 'search:dex-arb'],
    env: {
      DEX_ARB_CHAIN: 'bnb',
      DEX_ARB_SAMPLE_COUNT: '2',
      DEX_ARB_LOOKBACK_BLOCKS: '300',
      DEX_ARB_PAIR_LIMIT: '6',
      DEX_ARB_TRIANGLE_LIMIT: '1',
      DEX_ARB_MAX_STRATEGIES: '18',
      DEX_ARB_AMOUNT_MULTIPLIERS: '0.1,1',
    },
  },
  {
    key: 'liquidations-base',
    familyKey: 'aave-liquidations',
    label: 'Aave liquidations Base',
    command: 'npm',
    args: ['run', 'search:liquidations'],
    env: {
      LIQ_CHAIN: 'base',
      LIQ_LOOKBACK_BLOCKS: '500',
      LIQ_LOG_CHUNK_BLOCKS: '10',
      LIQ_USER_LIMIT: '50',
      LIQ_RESERVE_SYMBOLS: 'USDC,WETH,USDbC,cbETH,wstETH',
    },
  },
  {
    key: 'liquidations-arbitrum',
    familyKey: 'aave-liquidations',
    label: 'Aave liquidations Arbitrum',
    command: 'npm',
    args: ['run', 'search:liquidations'],
    env: {
      LIQ_CHAIN: 'arbitrum',
      LIQ_LOOKBACK_BLOCKS: '100',
      LIQ_LOG_CHUNK_BLOCKS: '10',
      LIQ_USER_LIMIT: '20',
      LIQ_RESERVE_SYMBOLS: 'USDC,WETH,WBTC,USDT,ARB',
    },
  },
  {
    key: 'liquidations-ethereum',
    familyKey: 'aave-liquidations',
    label: 'Aave liquidations Ethereum',
    command: 'npm',
    args: ['run', 'search:liquidations'],
    env: {
      LIQ_CHAIN: 'ethereum',
      LIQ_LOOKBACK_BLOCKS: '50000',
      LIQ_LOG_CHUNK_BLOCKS: '10',
      LIQ_MAX_LOG_REQUESTS: '600',
      LIQ_USER_LIMIT: '80',
      LIQ_RPC_TIMEOUT_MS: '20000',
      LIQ_RESERVE_SYMBOLS: 'USDT,USDC,DAI,WBTC,WETH,wstETH',
    },
  },
  {
    key: 'liquidations-polygon',
    familyKey: 'aave-liquidations',
    label: 'Aave liquidations Polygon',
    command: 'npm',
    args: ['run', 'search:liquidations'],
    env: {
      LIQ_CHAIN: 'polygon',
      LIQ_LOOKBACK_BLOCKS: '100',
      LIQ_LOG_CHUNK_BLOCKS: '10',
      LIQ_USER_LIMIT: '20',
      LIQ_RESERVE_SYMBOLS: 'USDC,WETH,WBTC,USDT,WMATIC',
    },
  },
  {
    key: 'aave-liquidation-replay-ethereum',
    familyKey: 'aave-liquidation-replay',
    label: 'Aave liquidation event replay Ethereum',
    command: 'npm',
    args: ['run', 'replay:aave-liquidations'],
    env: {
      AAVE_REPLAY_CHAIN: 'ethereum',
      AAVE_REPLAY_LOOKBACK_BLOCKS: '120000',
      AAVE_REPLAY_LOG_CHUNK_BLOCKS: '10000',
      AAVE_REPLAY_MAX_EVENTS: '80',
      AAVE_REPLAY_MIN_EVENTS: '3',
    },
  },
  {
    key: 'curve-stable',
    familyKey: 'curve-stable-arb',
    label: 'Curve stable arbitrage',
    command: 'npm',
    args: ['run', 'search:curve-stable-arb'],
    env: {
      CURVE_ARB_SAMPLE_COUNT: '2',
      CURVE_ARB_LOOKBACK_BLOCKS: '240',
      CURVE_ARB_POOL_LIMIT: '3',
      CURVE_ARB_PAIR_LIMIT: '12',
      CURVE_ARB_MAX_STRATEGIES: '16',
      CURVE_ARB_AMOUNT_MULTIPLIERS: '0.1',
    },
  },
  {
    key: 'compound-v3-liquidations',
    familyKey: 'compound-v3-liquidations',
    label: 'Compound V3 liquidations Ethereum',
    command: 'npm',
    args: ['run', 'search:compound-liquidations'],
    env: {
      COMP_LIQ_CHAIN: 'ethereum',
      COMP_LIQ_LOOKBACK_BLOCKS: '300',
      COMP_LIQ_LOG_CHUNK_BLOCKS: '50',
      COMP_LIQ_ACCOUNT_LIMIT: '40',
      COMP_LIQ_BASE_AMOUNTS: '10,100,1000',
    },
  },
  {
    key: 'compound-v3-liquidation-replay',
    familyKey: 'compound-v3-liquidations',
    label: 'Compound V3 liquidation event replay Ethereum',
    command: 'npm',
    args: ['run', 'replay:compound-liquidations'],
    env: {
      COMP_REPLAY_CHAIN: 'ethereum',
      COMP_REPLAY_LOOKBACK_BLOCKS: '250000',
      COMP_REPLAY_LOG_CHUNK_BLOCKS: '1000',
      COMP_REPLAY_MAX_EVENTS: '25',
      COMP_REPLAY_MAX_LOG_REQUESTS: '120',
      COMP_REPLAY_BASE_AMOUNTS: '10,100,1000',
    },
  },
  {
    key: 'morpho-blue-liquidations',
    familyKey: 'morpho-blue-liquidations',
    label: 'Morpho Blue liquidations Ethereum',
    command: 'npm',
    args: ['run', 'search:morpho-liquidations'],
    env: {
      MORPHO_LIQ_CHAIN: 'ethereum',
      MORPHO_LIQ_MARKET_LIMIT: '8',
      MORPHO_LIQ_POSITION_LIMIT: '20',
      MORPHO_LIQ_GAS_USD: '20',
    },
  },
  {
    key: 'morpho-blue-liquidation-replay',
    familyKey: 'morpho-blue-liquidations',
    label: 'Morpho Blue liquidation event replay Ethereum',
    command: 'npm',
    args: ['run', 'replay:morpho-liquidations'],
    env: {
      MORPHO_REPLAY_CHAIN: 'ethereum',
      MORPHO_REPLAY_LOOKBACK_BLOCKS: '250000',
      MORPHO_REPLAY_LOG_CHUNK_BLOCKS: '10',
      MORPHO_REPLAY_MAX_EVENTS: '50',
      MORPHO_REPLAY_MAX_LOG_REQUESTS: '120',
    },
  },
  {
    key: 'balancer-v2',
    familyKey: 'balancer-v2-arb',
    label: 'Balancer V2 arbitrage',
    command: 'npm',
    args: ['run', 'search:balancer-arb'],
    env: {
      BALANCER_ARB_SAMPLE_COUNT: '2',
      BALANCER_ARB_LOOKBACK_BLOCKS: '300',
      BALANCER_ARB_PAIR_LIMIT: '10',
      BALANCER_ARB_MAX_STRATEGIES: '12',
      BALANCER_ARB_AMOUNT_MULTIPLIERS: '0.1,1',
    },
  },
  {
    key: 'uniswap-v3-fee-base',
    familyKey: 'uniswap-v3-fee-arb',
    label: 'Uniswap V3 cross-fee arbitrage Base',
    command: 'npm',
    args: ['run', 'search:uniswap-v3-fee-arb'],
    env: {
      UNI_FEE_ARB_CHAIN: 'base',
      UNI_FEE_ARB_SAMPLE_COUNT: '3',
      UNI_FEE_ARB_LOOKBACK_BLOCKS: '600',
      UNI_FEE_ARB_PAIR_LIMIT: '6',
      UNI_FEE_ARB_MAX_STRATEGIES: '36',
      UNI_FEE_ARB_AMOUNT_MULTIPLIERS: '0.1,1',
    },
  },
  {
    key: 'uniswap-v3-fee-arbitrum',
    familyKey: 'uniswap-v3-fee-arb',
    label: 'Uniswap V3 cross-fee arbitrage Arbitrum',
    command: 'npm',
    args: ['run', 'search:uniswap-v3-fee-arb'],
    env: {
      UNI_FEE_ARB_CHAIN: 'arbitrum',
      UNI_FEE_ARB_SAMPLE_COUNT: '3',
      UNI_FEE_ARB_LOOKBACK_BLOCKS: '600',
      UNI_FEE_ARB_PAIR_LIMIT: '6',
      UNI_FEE_ARB_MAX_STRATEGIES: '36',
      UNI_FEE_ARB_AMOUNT_MULTIPLIERS: '0.1,1',
    },
  },
  {
    key: 'uniswap-v3-fee-ethereum',
    familyKey: 'uniswap-v3-fee-arb',
    label: 'Uniswap V3 cross-fee arbitrage Ethereum',
    command: 'npm',
    args: ['run', 'search:uniswap-v3-fee-arb'],
    env: {
      UNI_FEE_ARB_CHAIN: 'ethereum',
      UNI_FEE_ARB_SAMPLE_COUNT: '2',
      UNI_FEE_ARB_LOOKBACK_BLOCKS: '300',
      UNI_FEE_ARB_PAIR_LIMIT: '5',
      UNI_FEE_ARB_MAX_STRATEGIES: '24',
      UNI_FEE_ARB_AMOUNT_MULTIPLIERS: '0.1,1',
    },
  },
  {
    key: 'uniswap-v3-fee-polygon',
    familyKey: 'uniswap-v3-fee-arb',
    label: 'Uniswap V3 cross-fee arbitrage Polygon',
    command: 'npm',
    args: ['run', 'search:uniswap-v3-fee-arb'],
    env: {
      UNI_FEE_ARB_CHAIN: 'polygon',
      UNI_FEE_ARB_SAMPLE_COUNT: '3',
      UNI_FEE_ARB_LOOKBACK_BLOCKS: '600',
      UNI_FEE_ARB_PAIR_LIMIT: '5',
      UNI_FEE_ARB_MAX_STRATEGIES: '24',
      UNI_FEE_ARB_AMOUNT_MULTIPLIERS: '0.1,1',
    },
  },
  {
    key: 'uniswap-v3-fee-optimism',
    familyKey: 'uniswap-v3-fee-arb',
    label: 'Uniswap V3 cross-fee arbitrage Optimism',
    command: 'npm',
    args: ['run', 'search:uniswap-v3-fee-arb'],
    env: {
      UNI_FEE_ARB_CHAIN: 'optimism',
      UNI_FEE_ARB_SAMPLE_COUNT: '3',
      UNI_FEE_ARB_LOOKBACK_BLOCKS: '600',
      UNI_FEE_ARB_PAIR_LIMIT: '5',
      UNI_FEE_ARB_MAX_STRATEGIES: '24',
      UNI_FEE_ARB_AMOUNT_MULTIPLIERS: '0.1,1',
    },
  },
  {
    key: 'uniswap-v3-fee-bnb',
    familyKey: 'uniswap-v3-fee-arb',
    label: 'Uniswap V3 cross-fee arbitrage BNB',
    command: 'npm',
    args: ['run', 'search:uniswap-v3-fee-arb'],
    env: {
      UNI_FEE_ARB_CHAIN: 'bnb',
      UNI_FEE_ARB_SAMPLE_COUNT: '2',
      UNI_FEE_ARB_LOOKBACK_BLOCKS: '300',
      UNI_FEE_ARB_PAIR_LIMIT: '5',
      UNI_FEE_ARB_MAX_STRATEGIES: '24',
      UNI_FEE_ARB_AMOUNT_MULTIPLIERS: '0.1,1',
    },
  },
  {
    key: 'pendle-pt',
    familyKey: 'pendle-pt-arb',
    label: 'Pendle PT fixed-yield convergence',
    command: 'npm',
    args: ['run', 'search:pendle-pt-arb'],
    env: {
      PENDLE_CHAIN_IDS: '1,42161,8453,56,999',
      PENDLE_PT_MIN_IMPLIED_APY_PCT: '20',
      PENDLE_PT_MIN_LIQUIDITY_USD: '100000',
      PENDLE_PT_MIN_DAYS_TO_EXPIRY: '7',
      PENDLE_PT_CAPITAL_USD: '10000',
    },
  },
];

const FAMILY_DEFS = [
  {
    key: 'dex-quote-replay',
    label: 'DEX quote replay',
    pattern: /^dex-arbitrage-candidates(?:-[a-z0-9-]+)?\.json$/i,
    runCommand: 'DEX_ARB_CHAIN=<chain> npm run search:dex-arb',
    endpoint: '/api/dex-arbitrage-candidates/artifacts',
  },
  {
    key: 'aave-liquidations',
    label: 'Aave V3 liquidations',
    pattern: /^aave-liquidation-candidates(?!-spark-ethereum)(?:-[a-z0-9-]+)?\.json$/i,
    runCommand: 'LIQ_CHAIN=<chain> npm run search:liquidations',
    endpoint: '/api/aave-liquidation-candidates/artifacts',
  },
  {
    key: 'aave-liquidation-replay',
    label: 'Aave V3 liquidation event replay',
    pattern: /^aave-liquidation-event-replay-candidates(?!-spark-ethereum)(?:-[a-z0-9-]+)?\.json$/i,
    runCommand: 'AAVE_REPLAY_CHAIN=<chain> npm run replay:aave-liquidations',
    endpoint: '/api/aave-liquidation-replay-candidates/artifacts',
  },
  {
    key: 'spark-liquidations',
    label: 'SparkLend liquidations',
    pattern: /^aave-liquidation-candidates-spark-ethereum\.json$/i,
    runCommand: 'npm run search:spark-liquidations',
    endpoint: '/api/pure-arbitrage/overview',
  },
  {
    key: 'spark-liquidation-replay',
    label: 'SparkLend liquidation event replay',
    pattern: /^aave-liquidation-event-replay-candidates-spark-ethereum\.json$/i,
    runCommand: 'npm run replay:spark-liquidations',
    endpoint: '/api/pure-arbitrage/overview',
  },
  {
    key: 'curve-stable-arb',
    label: 'Curve stable arbitrage',
    pattern: /^curve-stable-arbitrage-candidates(?:-[a-z0-9-]+)?\.json$/i,
    runCommand: 'npm run search:curve-stable-arb',
    endpoint: '/api/curve-stable-arbitrage-candidates/artifacts',
  },
  {
    key: 'compound-v3-liquidations',
    label: 'Compound V3 liquidations',
    pattern: /^compound-v3-liquidation-candidates(?:-[a-z0-9-]+)?\.json$/i,
    runCommand: 'COMP_LIQ_CHAIN=ethereum npm run search:compound-liquidations; npm run replay:compound-liquidations',
    endpoint: '/api/pure-arbitrage/overview',
  },
  {
    key: 'morpho-blue-liquidations',
    label: 'Morpho Blue liquidations',
    pattern: /^morpho-blue-liquidation(?:-event-replay)?-candidates(?:-[a-z0-9-]+)?\.json$/i,
    runCommand: 'MORPHO_LIQ_CHAIN=ethereum npm run search:morpho-liquidations; npm run replay:morpho-liquidations',
    endpoint: '/api/pure-arbitrage/overview',
  },
  {
    key: 'balancer-v2-arb',
    label: 'Balancer V2 arbitrage',
    pattern: /^balancer-arbitrage-candidates(?:-[a-z0-9-]+)?\.json$/i,
    runCommand: 'npm run search:balancer-arb',
    endpoint: '/api/balancer-arbitrage-candidates/artifacts',
  },
  {
    key: 'uniswap-v3-fee-arb',
    label: 'Uniswap V3 cross-fee arbitrage',
    pattern: /^uniswap-v3-fee-arbitrage-candidates(?:-[a-z0-9-]+)?\.json$/i,
    runCommand: 'UNI_FEE_ARB_CHAIN=<chain> npm run search:uniswap-v3-fee-arb',
    endpoint: '/api/uniswap-v3-fee-arbitrage-candidates/artifacts',
  },
  {
    key: 'pendle-pt-arb',
    label: 'Pendle PT fixed-yield convergence',
    pattern: /^pendle-pt-arbitrage-candidates(?:-[a-z0-9-]+)?\.json$/i,
    runCommand: 'npm run search:pendle-pt-arb',
    endpoint: '/api/pendle-pt-arbitrage-candidates/artifacts',
  },
];

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
    // Scan scripts can rely on exported environment variables in CI.
  }
}

async function runTask(task) {
  const startedAt = new Date();
  const startedMs = Date.now();
  console.log(`[pure-search] start ${task.key}: ${task.label}`);
  return new Promise((resolveTask) => {
    const child = spawn(task.command, task.args, {
      cwd: root,
      env: { ...process.env, ...task.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on('close', (code) => {
      const durationMs = Date.now() - startedMs;
      const ok = code === 0;
      console.log(`[pure-search] ${ok ? 'done' : 'failed'} ${task.key} code=${code} durationMs=${durationMs}`);
      resolveTask({
        key: task.key,
        familyKey: task.familyKey,
        label: task.label,
        status: ok ? 'passed' : 'failed',
        exitCode: code,
        startedAt: startedAt.toISOString(),
        durationMs,
        stdoutTail: tailLines(stdout, 20),
        stderrTail: tailLines(stderr, 20),
      });
    });
    child.on('error', (err) => {
      resolveTask({
        key: task.key,
        familyKey: task.familyKey,
        label: task.label,
        status: 'failed',
        exitCode: null,
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedMs,
        stdoutTail: tailLines(stdout, 20),
        stderrTail: err.message,
      });
    });
  });
}

function tailLines(text, count) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-count)
    .join('\n');
}

async function readArtifacts(pattern) {
  let filenames = [];
  try {
    filenames = (await readdir(dataDir)).filter((filename) => pattern.test(filename)).sort();
  } catch {
    filenames = [];
  }
  const artifacts = [];
  for (const filename of filenames) {
    try {
      const raw = await readFile(resolve(dataDir, filename), 'utf8');
      artifacts.push({ filename, json: JSON.parse(raw) });
    } catch (err) {
      artifacts.push({ filename, error: err.message });
    }
  }
  return artifacts;
}

async function readLiveForkVerification() {
  try {
    const json = JSON.parse(await readFile(liveForkVerificationJson, 'utf8'));
    const byCandidate = new Map();
    for (const result of json.results ?? []) {
      byCandidate.set(result.candidateId, result);
    }
    return {
      generatedAt: json.generatedAt ?? null,
      summary: json.summary ?? null,
      results: json.results ?? [],
      byCandidate,
    };
  } catch {
    return {
      generatedAt: null,
      summary: null,
      results: [],
      byCandidate: new Map(),
    };
  }
}

function summarizeFamily(def, artifacts, liveForkVerification) {
  const valid = artifacts.filter((artifact) => artifact.json);
  const candidates = valid.flatMap((artifact) => artifact.json.candidates ?? []);
  const passingCount = candidates.filter((candidate) => candidate.gate?.status === 'pass').length;
  const liveReadyPassingCount = candidates.filter((candidate) =>
    isLiveReadyCandidate(candidate, liveForkVerification.byCandidate),
  ).length;
  const requestedPassingCount = Math.max(
    REQUESTED_PASSING,
    ...valid.map((artifact) => artifact.json.summary?.requestedPassingCount ?? REQUESTED_PASSING),
  );
  return {
    key: def.key,
    label: def.label,
    artifactCount: valid.length,
    invalidArtifactCount: artifacts.length - valid.length,
    candidateCount: candidates.length,
    passingCount,
    liveReadyPassingCount,
    requestedPassingCount,
    status:
      passingCount >= requestedPassingCount
        ? `found-at-least-${requestedPassingCount}-passing`
        : `did-not-find-${requestedPassingCount}-passing`,
    liveReadyStatus:
      liveReadyPassingCount >= requestedPassingCount
        ? `found-at-least-${requestedPassingCount}-live-ready`
        : `did-not-find-${requestedPassingCount}-live-ready`,
    endpoint: def.endpoint,
    runCommand: def.runCommand,
    artifacts: artifacts.map((artifact) => ({
      filename: artifact.filename,
      generatedAt: artifact.json?.generatedAt ?? null,
      candidateCount: artifact.json?.summary?.candidateCount ?? 0,
      passingCount: artifact.json?.summary?.passingCount ?? 0,
      status: artifact.json?.summary?.status ?? (artifact.error ? 'invalid-json' : 'unknown'),
      error: artifact.error ?? null,
    })),
    topCandidates: candidates
      .map((candidate) => ({
        id: candidate.id,
        chain: candidate.chain,
        strategyType: candidate.strategyType,
        gateStatus: candidate.gate?.status ?? 'unknown',
        gateReason: candidate.gate?.reason ?? 'missing gate reason',
        liveStatus: candidate.liveInterface?.status ?? candidate.liveInterface?.productionStatus ?? null,
        forkVerification: liveForkVerification.byCandidate.get(candidate.id) ?? null,
        score: candidateScore(candidate),
      }))
      .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
      .slice(0, 5),
  };
}

function isLiveReadyCandidate(candidate, verificationByCandidate) {
  if (candidate.gate?.status !== 'pass') return false;
  const verification = verificationByCandidate.get(candidate.id);
  return verification?.liveReady === true && verification?.forkSimulation === 'passed';
}

function candidateScore(candidate) {
  const median = readNestedNumber(candidate.metrics, ['medianNetProfitUsd']);
  if (median != null) return median;
  const nestedMedian = readNestedNumber(candidate.metrics, ['netProfitUsd', 'median']);
  if (nestedMedian != null) return nestedMedian;
  const liquidationNet = candidate.bestEstimate?.netProfitUsd;
  return Number.isFinite(liquidationNet) ? liquidationNet : null;
}

function readNestedNumber(value, path) {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== 'object' || !(part in current)) return null;
    current = current[part];
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : null;
}

async function buildOverview(taskResults) {
  const liveForkVerification = await readLiveForkVerification();
  const families = [];
  for (const def of FAMILY_DEFS) {
    families.push(summarizeFamily(def, await readArtifacts(def.pattern), liveForkVerification));
  }
  const artifactCount = families.reduce((sum, family) => sum + family.artifactCount, 0);
  const candidateCount = families.reduce((sum, family) => sum + family.candidateCount, 0);
  const passingCount = families.reduce((sum, family) => sum + family.passingCount, 0);
  const liveReadyPassingCount = families.reduce((sum, family) => sum + family.liveReadyPassingCount, 0);
  const historicalEvidenceReady = passingCount >= REQUESTED_PASSING;
  const liveExecutionReady = liveReadyPassingCount >= REQUESTED_PASSING;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    objective: {
      requestedPassingStrategies: REQUESTED_PASSING,
      minAnnualizedNetReturnPct: MIN_ANNUALIZED_NET_RETURN_PCT,
      pureOnChainOnly: true,
      noCexRequired: true,
    },
    run: {
      scansExecuted: taskResults.length > 0,
      taskCount: taskResults.length,
      tasks: taskResults,
      liveForkVerification: {
        generatedAt: liveForkVerification.generatedAt,
        summary: liveForkVerification.summary,
        resultCount: liveForkVerification.results.length,
      },
    },
    summary: {
      familyCount: families.length,
      artifactCount,
      candidateCount,
      passingCount,
      liveReadyPassingCount,
      requestedPassingCount: REQUESTED_PASSING,
      status:
        historicalEvidenceReady
          ? 'found-at-least-five-passing-pure-on-chain-backtests'
          : 'did-not-find-five-passing-pure-on-chain-backtests',
      liveExecutionStatus: liveExecutionReady ? 'ready' : 'blocked',
      decision:
        liveExecutionReady
          ? 'evidence and live execution gates met; keep per-run preflight, fresh quote, fork simulation, and loss-revert checks enabled'
          : historicalEvidenceReady
            ? 'historical evidence threshold met, but live execution remains blocked until current opportunities, calldata, fresh quotes, fork simulation, and loss-revert gates pass'
          : 'keep live execution blocked; current evidence does not support five stable 20%+ pure on-chain strategies',
    },
    families,
    blockers: buildBlockers(families, passingCount, liveReadyPassingCount),
  };
}

function buildBlockers(families, passingCount, liveReadyPassingCount) {
  const blockers = [];
  if (passingCount < REQUESTED_PASSING) {
    blockers.push(`only ${passingCount}/${REQUESTED_PASSING} pure on-chain candidates currently pass evidence gates`);
  } else if (liveReadyPassingCount < REQUESTED_PASSING) {
    blockers.push(
      `${passingCount}/${REQUESTED_PASSING} pure on-chain candidates pass historical evidence gates, but only ${liveReadyPassingCount}/${REQUESTED_PASSING} are live-ready`,
    );
  }
  for (const family of families) {
    if (!family.artifactCount) blockers.push(`${family.label} has no artifact; run ${family.runCommand}`);
    else if (!family.passingCount) blockers.push(`${family.label} has ${family.candidateCount} candidates but 0 passing gates`);
  }
  blockers.push('production live execution must remain blocked until route replay, fresh quote, fork simulation, and adapter gates pass');
  blockers.push('do not market guaranteed or stable 20%+ APY from the current evidence');
  return blockers;
}

function selectedTasks() {
  const requested = String(process.env.PURE_ARB_FAMILIES ?? 'all')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (requested.includes('all')) return TASKS;
  const selected = new Set(requested);
  return TASKS.filter((task) => selected.has(task.key) || selected.has(task.familyKey));
}

async function main() {
  loadDotenv();
  const shouldRunScans = process.env.PURE_ARB_RUN_SCANS === '1';
  const tasks = shouldRunScans ? selectedTasks() : [];
  const results = [];
  for (const task of tasks) {
    results.push(await runTask(task));
  }
  const overview = await buildOverview(results);
  await mkdir(dataDir, { recursive: true });
  await writeFile(outJson, `${JSON.stringify(overview, null, 2)}\n`);
  console.log(`[pure-search] wrote ${outJson}`);
  console.log(
    `[pure-search] status=${overview.summary.status} families=${overview.summary.familyCount} artifacts=${overview.summary.artifactCount} candidates=${overview.summary.candidateCount} passing=${overview.summary.passingCount}/${overview.summary.requestedPassingCount} live=${overview.summary.liveExecutionStatus}`,
  );
  if (overview.summary.liveExecutionStatus !== 'ready') process.exitCode = 2;
}

main().catch((err) => {
  console.error('[pure-search] failed', err);
  process.exit(1);
});
