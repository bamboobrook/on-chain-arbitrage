#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const walletAddress =
  process.env.SMOKE_WALLET_ADDRESS ?? '0x0000000000000000000000000000000000000001';
const capital = process.env.SMOKE_CAPITAL ?? '1000000000';
const maxSlippageBps = Number(process.env.SMOKE_MAX_SLIPPAGE_BPS ?? 30);
const maxGasUsd = Number(process.env.SMOKE_MAX_GAS_USD ?? 25);
const outPath = resolve(root, 'data', 'pure-live-interface-smoke.json');

const children = new Set();
const env = {
  ...process.env,
  ...loadDotenv(),
};

const cases = [
  {
    key: 'dex-quote-replay',
    label: 'DEX quote replay',
    artifact: 'data/dex-arbitrage-candidates.json',
    endpoint: '/api/dex-arbitrage-candidates',
    expectedForkReason: 'aerodrome-mixed-route-net-loss-reverted',
  },
  {
    key: 'uniswap-v3-fee-arb',
    label: 'Uniswap V3 cross-fee arbitrage',
    artifact: 'data/uniswap-v3-fee-arbitrage-candidates-base.json',
    endpoint: '/api/uniswap-v3-fee-arbitrage-candidates',
    expectedForkReasonPrefix: 'dex-direct-route-',
  },
  {
    key: 'curve-stable-arb',
    label: 'Curve stable arbitrage',
    artifact: 'data/curve-stable-arbitrage-candidates-ethereum.json',
    endpoint: '/api/curve-stable-arbitrage-candidates',
    expectedForkReason: 'curve-mixed-route-net-loss-reverted',
  },
  {
    key: 'balancer-v2-arb',
    label: 'Balancer V2 arbitrage',
    artifact: 'data/balancer-arbitrage-candidates-ethereum.json',
    endpoint: '/api/balancer-arbitrage-candidates',
    expectedForkReason: 'balancer-mixed-route-net-loss-reverted',
  },
  {
    key: 'aave-v3-liquidations',
    label: 'Aave V3 liquidations',
    artifact: 'data/aave-liquidation-candidates-ethereum.json',
    endpoint: '/api/aave-liquidation-candidates',
    expectedForkReason: 'aave-liquidation-health-factor-not-below-one',
  },
  {
    key: 'compound-v3-liquidations',
    label: 'Compound V3 liquidations',
    artifact: 'data/compound-v3-liquidation-candidates-ethereum.json',
    endpoint: '/api/compound-v3-liquidation-candidates',
    expectedForkReason: 'compound-v3-liquidation-account-not-liquidatable',
  },
  {
    key: 'morpho-blue-liquidations',
    label: 'Morpho Blue liquidations',
    artifact: 'data/morpho-blue-liquidation-candidates-ethereum.json',
    endpoint: '/api/morpho-blue-liquidation-candidates',
    expectedForkReasonPrefix: 'morpho-blue-liquidation-',
  },
  {
    key: 'morpho-blue-liquidation-replay',
    label: 'Morpho Blue liquidation replay',
    artifact: 'data/morpho-blue-liquidation-event-replay-candidates-ethereum.json',
    endpoint: '/api/morpho-blue-liquidation-candidates',
    expectedForkReasonPrefix: 'morpho-blue-liquidation-',
  },
];

function loadDotenv() {
  try {
    const text = readFileSync(resolve(root, '.env'), 'utf8');
    const out = {};
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
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  if (!address || typeof address === 'string') throw new Error('could not allocate API port');
  return address.port;
}

function start(name, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on('exit', () => children.delete(child));
  return child;
}

async function runCommand(name, command, args) {
  const child = start(name, command, args);
  const code = await new Promise((resolvePromise, reject) => {
    child.on('error', reject);
    child.on('exit', resolvePromise);
  });
  if (code !== 0) throw new Error(`${name} exited ${code}`);
}

async function cleanup() {
  for (const child of children) child.kill('SIGTERM');
  await sleep(500);
  for (const child of children) {
    if (!child.killed) child.kill('SIGKILL');
  }
}

process.on('SIGINT', () => cleanup().finally(() => process.exit(130)));
process.on('SIGTERM', () => cleanup().finally(() => process.exit(143)));

async function waitForApi(base) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`${base}/api/chains`);
      if (res.ok) return;
    } catch {
      // keep polling
    }
    await sleep(300);
  }
  throw new Error(`API did not become ready at ${base}`);
}

function firstCandidate(testCase) {
  const artifact = JSON.parse(readFileSync(resolve(root, testCase.artifact), 'utf8'));
  const candidate = artifact.candidates?.[0];
  return candidate
    ? { candidate, artifactSummary: artifact.summary ?? null }
    : { candidate: null, artifactSummary: artifact.summary ?? null };
}

async function postJson(url, body = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${url} failed ${res.status}: ${text}`);
  return json;
}

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${url} failed ${res.status}: ${text}`);
  return json;
}

async function exerciseCase(base, testCase) {
  const { candidate, artifactSummary } = firstCandidate(testCase);
  if (!candidate) {
    return {
      key: testCase.key,
      label: testCase.label,
      status: 'skipped-no-candidate',
      artifact: testCase.artifact,
      artifactSummary,
      reason: `${testCase.key} has no current candidate in ${testCase.artifact}`,
    };
  }
  const request = {
    walletAddress,
    capital,
    maxSlippageBps,
    maxGasUsd,
    autoStart: false,
  };
  const plan = await postJson(`${base}${testCase.endpoint}/${candidate.id}/execution-plan`, request);
  if (plan.evidence?.isPureArbitrage !== true) {
    throw new Error(`${testCase.key} plan is not marked pure arbitrage`);
  }

  const run = await postJson(`${base}${testCase.endpoint}/${candidate.id}/live-runs`, request);
  if (run.status !== 'blocked') {
    throw new Error(`${testCase.key} live run should remain blocked, got ${run.status}`);
  }

  const fork = await postJson(`${base}/api/live/runs/${run.id}/fork-simulation`);
  const reason = fork.details?.reason;
  const reasonMatches = testCase.expectedForkReasonPrefix
    ? String(reason).startsWith(testCase.expectedForkReasonPrefix)
    : reason === testCase.expectedForkReason;
  if (fork.status !== 'failed' || !reasonMatches) {
    throw new Error(
      `${testCase.key} expected ${testCase.expectedForkReasonPrefix ?? testCase.expectedForkReason} fork report, got ${fork.status}/${reason}`,
    );
  }

  const reread = await getJson(`${base}/api/live/runs/${run.id}`);
  const persistedReason = reread.latest_fork_simulation?.details?.reason;
  const persistedReasonMatches = testCase.expectedForkReasonPrefix
    ? String(persistedReason).startsWith(testCase.expectedForkReasonPrefix)
    : persistedReason === testCase.expectedForkReason;
  if (!persistedReasonMatches) {
    throw new Error(`${testCase.key} persisted fork report is missing parsed reason`);
  }

  const readinessForkGate = reread.readiness?.gates?.find(
    (gate) => gate.key === 'ordered-fork-simulation',
  );
  const executorRehearsal =
    fork.details?.walletAtomicExecutorRehearsal ?? fork.details?.strategyExecutorRehearsal;
  return {
    key: testCase.key,
    label: testCase.label,
    candidateId: candidate.id,
    planStatus: plan.status,
    strategyType: plan.strategyType ?? plan.strategyId,
    liveRunId: run.id,
    liveRunStatus: run.status,
    forkStatus: fork.status,
    forkExitCode: fork.exitCode,
    forkReason: reason,
    forkMode: fork.details?.mode ?? null,
    forkSummary: fork.summary,
    netProfit: fork.details?.netProfit ?? null,
    latestAccountData: fork.details?.latestAccountData ?? null,
    latestCometData: fork.details?.latestCometData ?? null,
    latestMorphoData: fork.details?.latestMorphoData ?? null,
    collateralUnwindQuote: fork.details?.collateralUnwindQuote ?? null,
    liquidation: fork.details?.liquidation ?? null,
    strategyExecutorRehearsal: executorRehearsal
      ? {
          mode: executorRehearsal.mode ?? null,
          adapters: executorRehearsal.adapters ?? null,
          adapter: executorRehearsal.adapter ?? null,
          executor: executorRehearsal.executor ?? null,
          ethCallStatus: executorRehearsal.ethCallStatus ?? null,
          sendStatus: executorRehearsal.sendResult?.status ?? null,
          sendGasUsed: executorRehearsal.sendResult?.gasUsed ?? null,
          executeCalldataBytes: executorRehearsal.executeCalldataBytes ?? null,
        }
      : null,
    walletAtomicExecutorRehearsal: executorRehearsal
      ? {
          mode: executorRehearsal.mode ?? null,
          adapters: executorRehearsal.adapters ?? null,
          adapter: executorRehearsal.adapter ?? null,
          executor: executorRehearsal.executor ?? null,
          ethCallStatus: executorRehearsal.ethCallStatus ?? null,
          sendStatus: executorRehearsal.sendResult?.status ?? null,
          sendGasUsed: executorRehearsal.sendResult?.gasUsed ?? null,
          executeCalldataBytes: executorRehearsal.executeCalldataBytes ?? null,
        }
      : null,
    blockerCount: fork.details?.blockers?.length ?? 0,
    requirementCount: fork.details?.requirements?.length ?? 0,
    readinessStatus: reread.readiness?.status ?? null,
    readinessForkGate: readinessForkGate?.message ?? null,
  };
}

async function main() {
  const port = Number(process.env.SMOKE_API_PORT ?? (await getFreePort()));
  const base = `http://127.0.0.1:${port}`;
  await runCommand('migrate', 'node', ['scripts/migrate-postgres.mjs']);
  const api = start('api', 'apps/api/node_modules/.bin/tsx', ['apps/api/src/server.ts'], {
    API_PORT: String(port),
  });

  const results = [];
  try {
    await waitForApi(base);
    for (const testCase of cases) {
      const result = await exerciseCase(base, testCase);
      results.push(result);
      if (result.status === 'skipped-no-candidate') {
        console.log(
          `pureLive|${result.key}|skipped=no-candidate|artifact=${result.artifact}|reason=${result.reason}`,
        );
        continue;
      }
      console.log(
        `pureLive|${result.key}|candidate=${result.candidateId}|run=${result.liveRunId}|plan=${result.planStatus}|fork=${result.forkStatus}|reason=${result.forkReason}|requirements=${result.requirementCount}|blockers=${result.blockerCount}`,
      );
    }
    const artifact = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      baseUrl: base,
      walletAddress,
      capital,
      maxSlippageBps,
      maxGasUsd,
      summary: {
        caseCount: cases.length,
        exercisedInterfaceCount: results.filter((result) => result.status !== 'skipped-no-candidate').length,
        skippedNoCandidateCount: results.filter((result) => result.status === 'skipped-no-candidate').length,
        liveExecutionStatus: 'blocked',
        reason:
          'DEX, Curve, and Balancer calldata are rehearsed with WalletAtomicArbitrageExecutor on fork; Aave, Compound, and Morpho liquidation protocol gates are checked on fork; production execution still needs passing profitability and protocol gates',
      },
      results,
    };
    await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`wrote=${outPath}`);
  } finally {
    api.kill('SIGTERM');
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  cleanup().finally(() => process.exit(1));
});
