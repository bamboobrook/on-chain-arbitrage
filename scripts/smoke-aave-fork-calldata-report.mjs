#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactPath =
  process.env.SMOKE_AAVE_ARTIFACT ?? 'data/aave-liquidation-candidates-ethereum.json';
const walletAddress =
  process.env.SMOKE_WALLET_ADDRESS ?? '0x0000000000000000000000000000000000000001';
const capital = process.env.SMOKE_CAPITAL ?? '1000000000';
const maxSlippageBps = Number(process.env.SMOKE_MAX_SLIPPAGE_BPS ?? 30);
const maxGasUsd = Number(process.env.SMOKE_MAX_GAS_USD ?? 25);
const outPath = resolve(root, 'data', 'aave-fork-calldata-smoke.json');

const children = new Set();
const env = {
  ...process.env,
  ...loadDotenv(),
};

function loadDotenv() {
  try {
    const text = readFileSync(resolve(root, '.env'), 'utf8');
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 1) continue;
      out[trimmed.slice(0, idx).trim()] = trimmed
        .slice(idx + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
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

async function cleanup() {
  for (const child of children) child.kill('SIGTERM');
  await sleep(500);
  for (const child of children) {
    if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
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

function selectedCandidate() {
  const artifact = JSON.parse(readFileSync(resolve(root, artifactPath), 'utf8'));
  const id = process.env.SMOKE_AAVE_CANDIDATE_ID;
  const candidate = id
    ? artifact.candidates?.find((item) => item.id === id)
    : artifact.candidates?.[0];
  if (!candidate) throw new Error(`no Aave candidate found in ${artifactPath}`);
  return candidate;
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${url} failed ${res.status}: ${text}`);
  return json;
}

async function postJson(url, body = {}) {
  return requestJson(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function assertAaveForkReport(plan, fork) {
  const liquidationTx = plan.transactions?.find(
    (tx) => tx.method === 'liquidationCall(address,address,address,uint256,bool)',
  );
  if (!liquidationTx) throw new Error('execution plan is missing liquidationCall transaction');
  if (liquidationTx.calldataStatus !== 'ready-after-quote') {
    throw new Error(`expected liquidationCall calldata preview, got ${liquidationTx.calldataStatus}`);
  }
  if (!liquidationTx.calldata || liquidationTx.calldataBytes !== 164) {
    throw new Error('execution plan liquidationCall calldata preview is incomplete');
  }
  const executorTx = plan.transactions?.find(
    (tx) =>
      tx.method ===
      'executeLiquidation(address,uint256,(address,address,uint256,bool,address,bytes,uint256,uint256,address))',
  );
  if (!executorTx) throw new Error('execution plan is missing Aave executor transaction');
  if (executorTx.selector !== '0xb6b5f0e7') {
    throw new Error(`unexpected Aave executor selector ${executorTx.selector}`);
  }
  if (executorTx.calldataStatus !== 'fork-gated') {
    throw new Error(`expected Aave executor calldata to be fork-gated, got ${executorTx.calldataStatus}`);
  }
  if (executorTx.calldata != null) {
    throw new Error('execution plan must not expose user-submittable Aave executor calldata before fork gates pass');
  }
  if ((executorTx.calldataBytes ?? 0) < 400) {
    throw new Error('execution plan Aave executor ABI sanity byte length is incomplete');
  }

  if (fork.status !== 'failed') throw new Error(`fork simulation should remain failed/blocked, got ${fork.status}`);
  if (!String(fork.details?.reason ?? '').startsWith('aave-liquidation-')) {
    throw new Error(`unexpected Aave fork reason: ${fork.details?.reason ?? 'missing'}`);
  }

  const liquidationCall = fork.details?.liquidationCall;
  if (!liquidationCall) throw new Error('fork report missing liquidationCall details');
  if (liquidationCall.selector !== '0x00a718a9') {
    throw new Error(`unexpected liquidationCall selector ${liquidationCall.selector}`);
  }
  if (liquidationCall.liquidationCallCalldataBytes !== 164) {
    throw new Error(
      `unexpected liquidationCall byte length ${liquidationCall.liquidationCallCalldataBytes}`,
    );
  }
  if (!String(liquidationCall.calldataPreview ?? '').startsWith('0x00a718a9')) {
    throw new Error('fork report missing liquidationCall calldata preview');
  }

  const flashLoanExecutor = fork.details?.aaveFlashLoanExecutor;
  if (!flashLoanExecutor) throw new Error('fork report missing Aave flash-loan executor details');
  if (flashLoanExecutor.contract !== 'AaveV3LiquidationExecutor') {
    throw new Error(`unexpected Aave executor contract ${flashLoanExecutor.contract}`);
  }
  if (flashLoanExecutor.deploymentStatus !== 'passed') {
    throw new Error(`Aave executor deployment did not pass: ${flashLoanExecutor.deploymentStatus}`);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(flashLoanExecutor.executor ?? ''))) {
    throw new Error('fork report missing deployed Aave executor address');
  }
  const collateralUnwindQuoteStatus = flashLoanExecutor.collateralUnwindQuote?.status;
  if (!collateralUnwindQuoteStatus) {
    throw new Error('fork report missing collateral unwind quote status');
  }
  if (!flashLoanExecutor.executorForkSimulation?.status) {
    throw new Error('fork report missing Aave executor fork simulation status');
  }
  const executorUnwindReady =
    collateralUnwindQuoteStatus === 'quoted' || collateralUnwindQuoteStatus === 'not-required';
  if (executorUnwindReady) {
    if ((flashLoanExecutor.executeLiquidationCalldataBytes ?? 0) < 400) {
      throw new Error(
        `Aave executor calldata preview is too short: ${flashLoanExecutor.executeLiquidationCalldataBytes}`,
      );
    }
    if (!String(flashLoanExecutor.executeLiquidationCalldataPreview ?? '').startsWith('0x')) {
      throw new Error('fork report missing Aave executor calldata preview');
    }
  } else {
    if (collateralUnwindQuoteStatus !== 'no-route') {
      throw new Error(`unexpected collateral unwind quote status ${collateralUnwindQuoteStatus}`);
    }
    if (
      flashLoanExecutor.executeLiquidationCalldataStatus !==
      'blocked-collateral-unwind-quote-required'
    ) {
      throw new Error(
        `expected executor calldata to be blocked by missing unwind quote, got ${flashLoanExecutor.executeLiquidationCalldataStatus}`,
      );
    }
    if (flashLoanExecutor.executeLiquidationCalldataBytes != null) {
      throw new Error(
        `expected no executor calldata bytes without an unwind route, got ${flashLoanExecutor.executeLiquidationCalldataBytes}`,
      );
    }
  }

  const healthFactor = Number(fork.details?.latestAccountData?.healthFactor);
  if (Number.isFinite(healthFactor) && healthFactor >= 1) {
    if (liquidationCall.calldataStatus !== 'withheld-health-factor-not-below-one') {
      throw new Error(`expected calldata to be withheld by health factor, got ${liquidationCall.calldataStatus}`);
    }
    if (liquidationCall.withheldBecauseHealthFactorNotBelowOne !== true) {
      throw new Error('fork report did not mark liquidationCall as withheld by health factor');
    }
    if (executorUnwindReady) {
      if (
        flashLoanExecutor.executeLiquidationCalldataStatus !==
        'withheld-health-factor-not-below-one'
      ) {
        throw new Error(
          `expected executor calldata to be withheld by health factor, got ${flashLoanExecutor.executeLiquidationCalldataStatus}`,
        );
      }
      if (flashLoanExecutor.withheldBecauseHealthFactorNotBelowOne !== true) {
        throw new Error('fork report did not mark executor calldata as withheld by health factor');
      }
      if (
        flashLoanExecutor.executorForkSimulation.status !==
        'skipped-health-factor-not-below-one'
      ) {
        throw new Error(
          `expected executor fork simulation to be skipped by health factor, got ${flashLoanExecutor.executorForkSimulation.status}`,
        );
      }
      const failedConfig = (flashLoanExecutor.unwindTargetConfigResults ?? []).find(
        (item) => item?.status && item.status !== 'passed',
      );
      if (failedConfig) {
        throw new Error(
          `unexpected failed Aave executor config while HF>=1: ${failedConfig.error ?? failedConfig.status}`,
        );
      }
    } else if (flashLoanExecutor.withheldBecauseHealthFactorNotBelowOne === true) {
      throw new Error('fork report marked unavailable executor calldata as withheld by health factor');
    }
  }

  return {
    status: 'passed',
    reason: fork.details.reason,
    summary: fork.summary,
    planCalldataBytes: liquidationTx.calldataBytes,
    planExecutorCalldataBytes: executorTx.calldataBytes,
    forkCalldataStatus: liquidationCall.calldataStatus,
    forkCalldataBytes: liquidationCall.liquidationCallCalldataBytes,
    forkCalldataPreview: liquidationCall.calldataPreview,
    executorDeploymentStatus: flashLoanExecutor.deploymentStatus,
    executorAddress: flashLoanExecutor.executor,
    executorCollateralUnwindQuoteStatus: flashLoanExecutor.collateralUnwindQuote.status,
    executorCollateralUnwindQuoteBest: flashLoanExecutor.collateralUnwindQuote.best ?? null,
    executorCalldataStatus: flashLoanExecutor.executeLiquidationCalldataStatus,
    executorCalldataBytes: flashLoanExecutor.executeLiquidationCalldataBytes,
    executorCalldataPreview: flashLoanExecutor.executeLiquidationCalldataPreview,
    executorForkSimulationStatus: flashLoanExecutor.executorForkSimulation.status,
    executorUnwindTargetConfigResults: flashLoanExecutor.unwindTargetConfigResults ?? [],
    withheldBecauseHealthFactorNotBelowOne:
      liquidationCall.withheldBecauseHealthFactorNotBelowOne,
    executorWithheldBecauseHealthFactorNotBelowOne:
      flashLoanExecutor.withheldBecauseHealthFactorNotBelowOne,
    healthFactor: fork.details?.latestAccountData?.healthFactor ?? null,
  };
}

async function main() {
  const port = await getFreePort();
  const base = `http://127.0.0.1:${port}`;
  const candidate = selectedCandidate();
  const request = {
    walletAddress,
    capital,
    maxSlippageBps,
    maxGasUsd,
    autoStart: false,
  };

  start('api', 'apps/api/node_modules/.bin/tsx', ['apps/api/src/server.ts'], {
    API_PORT: String(port),
  });
  try {
    await waitForApi(base);
    const plan = await postJson(
      `${base}/api/aave-liquidation-candidates/${candidate.id}/execution-plan`,
      request,
    );
    const run = await postJson(
      `${base}/api/aave-liquidation-candidates/${candidate.id}/live-runs`,
      request,
    );
    const fork = await postJson(`${base}/api/live/runs/${run.id}/fork-simulation`);
    const result = {
      generatedAt: new Date().toISOString(),
      candidateId: candidate.id,
      liveRunId: run.id,
      ...assertAaveForkReport(plan, fork),
    };
    await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await cleanup();
  }
}

main().catch(async (err) => {
  await cleanup();
  console.error(err);
  process.exit(1);
});
