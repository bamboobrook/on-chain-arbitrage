#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const root = new URL('../', import.meta.url);
const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = apiRequire('pg');

const port = Number(process.env.SMOKE_API_PORT ?? 4037);
const candidateId = process.env.SMOKE_CANDIDATE_ID ?? 'candidate-4-base-weth-usdc';
const walletAddress =
  process.env.SMOKE_WALLET_ADDRESS ?? '0x000000000000000000000000000000000000dEaD';
const capital = process.env.SMOKE_CAPITAL ?? '10000000000';
const maxSlippageBps = Number(process.env.SMOKE_MAX_SLIPPAGE_BPS ?? 50);
const maxGasUsd = Number(process.env.SMOKE_MAX_GAS_USD ?? 25);
const workerMillis = Number(process.env.SMOKE_WORKER_MILLIS ?? 35_000);
const skipFork = process.env.SMOKE_SKIP_FORK === '1' || process.env.SMOKE_SKIP_FORK === 'true';

const env = {
  ...process.env,
  ...loadDotenv(),
  API_PORT: String(port),
};

const children = new Set();

function loadDotenv() {
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
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

function start(name, command, args) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on('exit', () => children.delete(child));
  return child;
}

async function cleanup() {
  for (const child of children) {
    child.kill('SIGTERM');
  }
  await sleep(500);
  for (const child of children) {
    if (!child.killed) child.kill('SIGKILL');
  }
}

process.on('SIGINT', () => cleanup().finally(() => process.exit(130)));
process.on('SIGTERM', () => cleanup().finally(() => process.exit(143)));

async function waitForApi() {
  const url = `http://127.0.0.1:${port}/api/chains`;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // keep polling
    }
    await sleep(500);
  }
  throw new Error(`API did not become ready on ${url}`);
}

async function createRun() {
  const res = await fetch(
    `http://127.0.0.1:${port}/api/strategy-candidates/${candidateId}/live-runs`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        walletAddress,
        capital,
        maxSlippageBps,
        maxGasUsd,
        autoStart: true,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`live-runs create failed ${res.status}: ${body}`);
  }
  return res.json();
}

async function queryRun(runId) {
  const pool = new Pool({
    connectionString: env.DATABASE_URL ?? 'postgres://oal:oal_dev_password@127.0.0.1:5432/oal',
  });
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.status, r.blocked_by, p.report AS latest_preflight,
              f.result AS latest_fork_simulation
       FROM live_strategy_runs r
       LEFT JOIN LATERAL (
         SELECT report FROM live_run_preflights WHERE run_id = r.id ORDER BY created_at DESC LIMIT 1
       ) p ON true
       LEFT JOIN LATERAL (
         SELECT result FROM live_run_fork_simulations WHERE run_id = r.id ORDER BY created_at DESC LIMIT 1
       ) f ON true
       WHERE r.id = $1`,
      [runId],
    );
    return rows[0];
  } finally {
    await pool.end();
  }
}

async function rerunPreflight(runId) {
  const res = await fetch(`http://127.0.0.1:${port}/api/live/runs/${runId}/rerun-preflight`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`rerun preflight failed ${res.status}: ${body}`);
  }
  return res.json();
}

async function fetchLiveRun(runId) {
  const res = await fetch(`http://127.0.0.1:${port}/api/live/runs/${runId}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`live run fetch failed ${res.status}: ${body}`);
  }
  return res.json();
}

async function runForkSimulation(runId) {
  const res = await fetch(`http://127.0.0.1:${port}/api/live/runs/${runId}/fork-simulation`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fork simulation failed ${res.status}: ${body}`);
  }
  return res.json();
}

async function main() {
  const api = start('api', 'apps/api/node_modules/.bin/tsx', ['apps/api/src/server.ts']);
  try {
    await waitForApi();
    const run = await createRun();
    console.log(`created=${run.id}`);

    const worker = start('worker', 'apps/workers/node_modules/.bin/tsx', [
      'apps/workers/src/index.ts',
    ]);
    await sleep(workerMillis);
    worker.kill('SIGTERM');
    await sleep(750);

    const row = await queryRun(run.id);
    const preflight = row?.latest_preflight;
    const txPreview = preflight?.transactionPreview;
    const gasPreflight = preflight?.gasPreflight;
    const callSimulation = preflight?.callSimulation;
    console.log(
      `run=${row?.id} status=${row?.status} blockers=${Array.isArray(row?.blocked_by) ? row.blocked_by.length : 'n/a'}`,
    );
    const walletPreflight = preflight?.walletPreflight;
    console.log(
      `preflight=${preflight?.status} checks=${preflight?.checks?.length ?? 0} quote=${preflight?.quote?.status} poolState=${preflight?.poolState?.status} mintPreview=${preflight?.mintPreview?.status} transactionPreview=${txPreview?.status} gasPreflight=${gasPreflight?.status} callSimulation=${callSimulation?.status} walletPreflight=${walletPreflight?.status}`,
    );
    console.log(`calls=${txPreview?.calls?.length ?? 0}`);
    for (const call of txPreview?.calls ?? []) {
      console.log(
        `${call.kind}|${call.label}|to=${call.to}|selector=${call.selector}|bytes=${call.calldataBytes}|calldata=${call.calldata.slice(0, 18)}...${call.calldata.slice(-16)}`,
      );
    }
    console.log(
      `gasCalls=${gasPreflight?.calls?.length ?? 0} totalGas=${gasPreflight?.totalGasLimit ?? 'n/a'} gasCostUsd=${gasPreflight?.estimatedCostUsd ?? 'n/a'} maxGasUsd=${gasPreflight?.maxGasUsd ?? 'n/a'} maxGasOk=${gasPreflight?.maxGasOk ?? 'n/a'} gasPriceWei=${gasPreflight?.gasPriceWei ?? 'n/a'} native=${gasPreflight?.nativeTokenSymbol ?? 'n/a'}:${gasPreflight?.nativeTokenPriceUsd ?? 'n/a'}`,
    );
    for (const call of gasPreflight?.calls ?? []) {
      console.log(
        `gas|${call.kind}|${call.label}|status=${call.status}|gas=${call.gasLimit ?? 'n/a'}|costUsd=${call.estimatedCostUsd ?? 'n/a'}|error=${call.error ?? 'none'}`,
      );
    }
    console.log(`simCalls=${callSimulation?.calls?.length ?? 0} status=${callSimulation?.status}`);
    for (const call of callSimulation?.calls ?? []) {
      console.log(
        `sim|${call.kind}|${call.label}|status=${call.status}|returnBytes=${call.returnBytes ?? 'n/a'}|error=${call.error ?? 'none'}`,
      );
    }
    console.log(`walletTokens=${walletPreflight?.tokens?.length ?? 0}`);
    for (const token of walletPreflight?.tokens ?? []) {
      console.log(
        `${token.symbol}|required=${token.requiredBaseUnits}|balance=${token.balanceBaseUnits ?? 'n/a'}|balanceOk=${token.balanceOk}|allowance=${token.allowanceBaseUnits ?? 'n/a'}|allowanceOk=${token.allowanceOk}|approvalGap=${token.approvalRequiredBaseUnits ?? 'n/a'}`,
      );
    }
    if (txPreview?.status !== 'ready' || txPreview?.calls?.length !== 3) {
      throw new Error(txPreview?.error ?? 'transaction preview missing or incomplete');
    }
    if (
      !['ready', 'partial', 'blocked'].includes(gasPreflight?.status ?? '') ||
      gasPreflight?.calls?.length !== 3
    ) {
      throw new Error(gasPreflight?.error ?? 'gas preflight missing or incomplete');
    }
    const estimatedGasCalls = gasPreflight.calls.filter((call) => call.status === 'estimated');
    if (
      typeof gasPreflight.estimatedCostUsd !== 'number' ||
      typeof gasPreflight.maxGasUsd !== 'number' ||
      typeof gasPreflight.maxGasOk !== 'boolean' ||
      estimatedGasCalls.some((call) => typeof call.estimatedCostUsd !== 'number')
    ) {
      throw new Error(gasPreflight.costError ?? 'gas USD/maxGas gate missing or incomplete');
    }
    if (
      !['passed', 'partial', 'blocked'].includes(callSimulation?.status ?? '') ||
      callSimulation?.calls?.length !== 3 ||
      !callSimulation.calls.some((call) => call.kind === 'approval' && call.status === 'passed')
    ) {
      throw new Error(callSimulation?.error ?? 'call simulation missing or incomplete');
    }
    if (
      !['ready', 'needs-approval', 'blocked'].includes(walletPreflight?.status ?? '') ||
      walletPreflight?.tokens?.length !== 2
    ) {
      throw new Error(walletPreflight?.error ?? 'wallet preflight missing or incomplete');
    }
    const rerun = await rerunPreflight(run.id);
    console.log(
      `rerun=${rerun.id} status=${rerun.status} blockers=${Array.isArray(rerun.blocked_by) ? rerun.blocked_by.length : 'n/a'}`,
    );
    if (rerun.status !== 'queued') {
      throw new Error(`rerun preflight did not requeue run: ${rerun.status}`);
    }
    if (!skipFork) {
      const fork = await runForkSimulation(run.id);
      console.log(
        `forkApi=${fork.runId} status=${fork.status} exitCode=${fork.exitCode} summary=${fork.summary ?? 'n/a'}`,
      );
      for (const line of String(fork.stdout ?? '').split(/\r?\n/).filter(Boolean)) {
        console.log(`forkApiOut|${line}`);
      }
      if (fork.status !== 'passed') throw new Error(fork.summary ?? 'ordered fork simulation failed');
      const afterFork = await fetchLiveRun(run.id);
      const readiness = afterFork?.readiness;
      const forkGate = readiness?.gates?.find((gate) => gate.key === 'ordered-fork-simulation');
      const profitabilityGate = readiness?.gates?.find(
        (gate) => gate.key === 'profitability-backtest',
      );
      const eventReplay = afterFork?.event_replay_evidence;
      console.log(
        `persistedFork=${afterFork?.latest_fork_simulation?.status ?? 'n/a'} summary=${afterFork?.latest_fork_simulation?.summary ?? 'n/a'}`,
      );
      console.log(
        `eventReplay=${eventReplay?.gate?.status ?? 'n/a'} replayNetApy=${eventReplay?.metrics?.netApyPct ?? 'n/a'} profitabilityGate=${profitabilityGate?.status ?? 'n/a'}`,
      );
      console.log(
        `readiness=${readiness?.status ?? 'n/a'} blockers=${readiness?.blockers?.length ?? 'n/a'} forkGate=${forkGate?.status ?? 'n/a'}`,
      );
      if (afterFork?.latest_fork_simulation?.status !== 'passed') {
        throw new Error('fork simulation result was not persisted');
      }
      if (!eventReplay || profitabilityGate?.status !== 'block') {
        throw new Error('event replay profitability evidence was not attached as a blocking gate');
      }
      if (readiness?.status !== 'blocked' || forkGate?.status !== 'pass') {
        throw new Error('readiness gates did not reflect persisted fork simulation');
      }
    }
    api.kill('SIGTERM');
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  cleanup().finally(() => process.exit(1));
});
