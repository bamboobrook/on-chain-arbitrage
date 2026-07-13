#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

const root = new URL('../', import.meta.url);
const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = apiRequire('pg');

const runId = process.argv[2] ?? process.env.FORK_RUN_ID;
if (!runId) {
  console.error('usage: node scripts/fork-simulate-live-run.mjs <live-run-id>');
  process.exit(2);
}

const env = {
  ...process.env,
  ...loadDotenv(),
};
const allowRevert = env.FORK_ALLOW_REVERT === '1' || env.FORK_ALLOW_REVERT === 'true';

const CHAIN_RPC_ENV = {
  1: 'RPC_ETHEREUM_URL',
  8453: 'RPC_BASE_URL',
  42161: 'RPC_ARBITRUM_URL',
  10: 'RPC_OPTIMISM_URL',
  137: 'RPC_POLYGON_URL',
  56: 'RPC_BNB_URL',
};

const UNISWAP_V3 = {
  1: {
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  },
  8453: {
    factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
    quoter: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
    router: '0x2626664c2603336E57B271c5C0b26F421741e481',
  },
  42161: {
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  },
  10: {
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  },
  137: {
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  },
  56: {
    factory: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7',
    quoter: '0x78D78E420Da98ad378D7799bE8f4AF69033EB077',
    router: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2',
  },
};

const SELECTORS = {
  balanceOf: '0x70a08231',
  approve: '0x095ea7b3',
  balancerQueryBatchSwap: '0xf84d066e',
  compoundV3IsLiquidatable: '0x042e02cf',
  compoundV3QuoteCollateral: '0x7ac88ed1',
  aaveV3LiquidationCall: '0x00a718a9',
  uniswapV3GetPool: '0x1698ee82',
  uniswapV3QuoteExactInput: '0xcdca1753',
  uniswapV3QuoteExactInputSingle: '0xc6a5026a',
  uniswapV3SwapRouter02ExactInput: '0xb858183f',
  uniswapV3SwapRouter02ExactInputSingle: '0x04e45aaf',
  aerodromeGetAmountsOut: '0x5509a1ac',
  curveGetDy: '0x5e0d443f',
};

const AERODROME = {
  8453: {
    router: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  },
};

const BALANCER_V2 = {
  1: {
    vault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  },
};

const BALANCER_QUERY_SENDER = '0x0000000000000000000000000000000000000001';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const UNISWAP_V3_UNWIND_BRIDGES = {
  1: [
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
    { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' },
    { symbol: 'GHO', address: '0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f' },
  ],
};
const UNISWAP_V3_UNWIND_FEES = [100, 500, 3000, 10000];
const UNISWAP_V3_UNWIND_FEE_PLANS = {
  1: {
    1: [[500], [3000], [10000], [100]],
    2: [[3000, 500], [500, 500], [3000, 3000], [500, 3000], [10000, 500]],
    3: [[3000, 500, 500], [500, 500, 500], [3000, 3000, 500], [500, 3000, 500]],
  },
};

let anvil;

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

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === 'string') throw new Error('could not allocate a port');
  return address.port;
}

async function queryRun(id) {
  const pool = new Pool({
    connectionString: env.DATABASE_URL ?? 'postgres://oal:oal_dev_password@127.0.0.1:5432/oal',
  });
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.candidate_id, r.strategy_id, r.status, r.chain_id, r.plan, r.blocked_by,
         CASE WHEN r.wallet_address IS NULL THEN NULL ELSE '0x' || encode(r.wallet_address, 'hex') END AS wallet_address,
         p.report AS latest_preflight
       FROM live_strategy_runs r
       LEFT JOIN LATERAL (
         SELECT report FROM live_run_preflights WHERE run_id = r.id ORDER BY created_at DESC LIMIT 1
       ) p ON true
       WHERE r.id = $1`,
      [id],
    );
    return rows[0];
  } finally {
    await pool.end();
  }
}

async function rpc(url, method, params = [], timeoutMs = 0) {
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller?.signal,
    });
    if (!res.ok) throw new Error(`${method} http ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(`${method}: ${json.error.message ?? 'rpc error'}`);
    return json.result;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`${method}: timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function rpcWithRetries(url, method, params = [], attempts = 3, timeoutMs = 0) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await rpc(url, method, params, timeoutMs);
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) await sleep(250 * (attempt + 1));
    }
  }
  throw lastError;
}

async function waitForRpc(url) {
  for (let i = 0; i < 120; i += 1) {
    try {
      await rpc(url, 'web3_clientVersion');
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`anvil did not become ready at ${url}`);
}

async function waitForReceipt(url, hash) {
  const timeoutMs = Math.max(5_000, Number(env.FORK_RECEIPT_TIMEOUT_MS ?? 60_000));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await rpc(url, 'eth_getTransactionReceipt', [hash]);
    if (receipt) return receipt;
    await sleep(250);
  }
  throw new Error(`transaction receipt timed out after ${timeoutMs}ms: ${hash}`);
}

function anvilBin() {
  if (env.ANVIL_BIN) return env.ANVIL_BIN;
  if (env.HOME) return `${env.HOME}/.foundry/bin/anvil`;
  return 'anvil';
}

function toQuantity(value) {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  return `0x${n.toString(16)}`;
}

function bufferedGas(gasHex) {
  const gas = BigInt(gasHex);
  return toQuantity((gas * 13n) / 10n + 25_000n);
}

function callValue(value) {
  return value === '0' ? '0x0' : toQuantity(value);
}

function hexStrip(hex) {
  return String(hex ?? '').replace(/^0x/i, '');
}

function pad32(hex) {
  return hexStrip(hex).padStart(64, '0');
}

function encodeUint(value) {
  return pad32(BigInt(value).toString(16));
}

function encodeAddress(value) {
  return pad32(hexStrip(value).toLowerCase());
}

function encodeBool(value) {
  return encodeUint(value ? 1n : 0n);
}

function decodeFirstUint(result) {
  const clean = hexStrip(result);
  if (clean.length < 64) throw new Error('short uint256 result');
  return BigInt(`0x${clean.slice(0, 64)}`);
}

function decodeUintWords(result, count) {
  const clean = hexStrip(result);
  if (clean.length < count * 64) throw new Error(`short uint256[${count}] result`);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(BigInt(`0x${clean.slice(i * 64, (i + 1) * 64)}`));
  }
  return out;
}

function signedWordToBigInt(word) {
  const value = BigInt(`0x${word}`);
  const limit = 1n << 255n;
  return value >= limit ? value - (1n << 256n) : value;
}

function decodeIntArray(result) {
  const clean = hexStrip(result);
  if (clean.length < 128) throw new Error('short int256[] result');
  const offset = Number(BigInt(`0x${clean.slice(0, 64)}`));
  const start = offset * 2;
  const length = Number(BigInt(`0x${clean.slice(start, start + 64)}`));
  const out = [];
  for (let i = 0; i < length; i += 1) {
    const wordStart = start + 64 + i * 64;
    out.push(signedWordToBigInt(clean.slice(wordStart, wordStart + 64)));
  }
  return out;
}

function decodeUintArrayLast(result) {
  const clean = hexStrip(result);
  if (clean.length < 128) throw new Error('short uint256[] result');
  const offset = Number(BigInt(`0x${clean.slice(0, 64)}`));
  const start = offset * 2;
  const length = Number(BigInt(`0x${clean.slice(start, start + 64)}`));
  if (length < 1) throw new Error('empty uint256[] result');
  const wordStart = start + 64 + (length - 1) * 64;
  return BigInt(`0x${clean.slice(wordStart, wordStart + 64)}`);
}

function decodeAddress(result) {
  const clean = hexStrip(result);
  if (clean.length < 64) throw new Error('short address result');
  return `0x${clean.slice(24, 64)}`;
}

function decodeBool(result) {
  return decodeFirstUint(result) !== 0n;
}

function calldataHead(data) {
  return data.length <= 34 ? data : `${data.slice(0, 18)}...${data.slice(-16)}`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
}

function sanitizeJsonValue(value) {
  if (typeof value === 'string') return value.replace(/\u0000/g, '').replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeJsonValue(item)]),
    );
  }
  return value;
}

function isPureOnChainDryRunPlan(plan) {
  return plan?.mode === 'dry-run' && plan?.evidence?.isPureArbitrage === true;
}

function isAaveLiquidationPlan(row) {
  const plan = row.plan ?? {};
  return (
    plan?.strategyType === 'aave-v3-liquidation-arbitrage' &&
    Boolean(plan?.borrower) &&
    Boolean(plan?.liquidation?.pool)
  );
}

function isCompoundLiquidationPlan(row) {
  const plan = row.plan ?? {};
  return (
    plan?.strategyType === 'compound-v3-liquidation-arbitrage' &&
    Boolean(plan?.borrower) &&
    Boolean(plan?.liquidation?.comet)
  );
}

function isMorphoBlueLiquidationPlan(row) {
  const plan = row.plan ?? {};
  return (
    plan?.strategyType === 'morpho-blue-liquidation-arbitrage' &&
    Boolean(plan?.borrower) &&
    Boolean(plan?.liquidation?.morpho) &&
    Boolean(plan?.liquidation?.marketId) &&
    Boolean(plan?.liquidation?.marketParams?.oracle)
  );
}

function isDexDirectRouteCandidate(row) {
  const plan = row.plan ?? {};
  const dexPath = asArray(plan.route?.dexPath);
  return (
    plan?.strategyId === 'atomic-amm' &&
    typeof plan?.strategyType === 'string' &&
    plan.strategyType.includes('arbitrage') &&
    dexPath.length > 0 &&
    dexPath.every(
      (dex) =>
        dex === 'uniswap-v3' ||
        dex === 'aerodrome' ||
        dex === 'balancer-v2' ||
        String(dex).startsWith('curve-'),
    ) &&
    dexPath.includes('uniswap-v3') &&
    Boolean(UNISWAP_V3[row.chain_id])
  );
}

function purePlanBlockedReport(row, reason, preflight) {
  const plan = row.plan ?? {};
  const blockers = unique([
    ...asArray(plan.blockedBy),
    ...asArray(row.blocked_by),
    preflight?.transactionPreview?.error,
    'fork simulation requires executable calldata for every approval and strategy call',
  ]);
  const requirements = unique([
    ...asArray(plan.forkSimulation?.requirements),
    'fresh block-scoped calldata from the quote/executor service',
    'deployed and verified executor address for the selected strategy',
  ]);
  const transactions = asArray(plan.transactions).map((tx) => ({
    label: tx.label ?? 'unknown',
    to: tx.to ?? null,
    method: tx.method ?? null,
    calldataStatus: tx.calldataStatus ?? 'unknown',
  }));
  const strategyType = plan.strategyType ?? row.strategy_id ?? 'unknown';
  const candidateId = plan.candidateId ?? row.candidate_id ?? 'unknown';
  const planStatus = plan.status ?? 'unknown';
  const summary = `forkSimulation=blocked reason=${reason} planStatus=${planStatus} strategyType=${strategyType} candidateId=${candidateId}`;
  return {
    kind: 'fork-simulation-report',
    status: 'failed',
    forkSimulation: 'blocked',
    reason,
    summary,
    runId: row.id,
    liveRunStatus: row.status,
    planStatus,
    strategyType,
    candidateId,
    chainId: row.chain_id,
    blockers,
    requirements,
    transactions,
  };
}

function emitReport(report) {
  const safeReport = sanitizeJsonValue(report);
  console.log(`forkSimulationReport=${JSON.stringify(safeReport)}`);
  console.log(safeReport.summary);
}

function castBin() {
  if (env.CAST_BIN) return env.CAST_BIN;
  if (env.HOME) return `${env.HOME}/.foundry/bin/cast`;
  return 'cast';
}

function forgeBin() {
  if (env.FORGE_BIN) return env.FORGE_BIN;
  if (env.HOME) return `${env.HOME}/.foundry/bin/forge`;
  return 'forge';
}

function contractBytecode(contractSpec) {
  return execFileSync(forgeBin(), ['inspect', '--root', 'contracts', contractSpec, 'bytecode'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...env, PATH: `${env.HOME ?? ''}/.foundry/bin:${env.PATH ?? ''}` },
  }).trim();
}

function castAbiEncode(signature, args) {
  return execFileSync(castBin(), ['abi-encode', signature, ...args], {
    encoding: 'utf8',
    env: { ...env, PATH: `${env.HOME ?? ''}/.foundry/bin:${env.PATH ?? ''}` },
  }).trim();
}

function castCalldata(signature, args) {
  return execFileSync(castBin(), ['calldata', signature, ...args], {
    encoding: 'utf8',
    env: { ...env, PATH: `${env.HOME ?? ''}/.foundry/bin:${env.PATH ?? ''}` },
  }).trim();
}

async function startFork(row) {
  if (!row.wallet_address) throw new Error('run wallet address is missing');
  const rpcEnvVar = CHAIN_RPC_ENV[row.chain_id];
  const forkUrl = rpcEnvVar ? env[rpcEnvVar] : undefined;
  if (!forkUrl) throw new Error(`rpc url missing for chain ${row.chain_id}`);

  const port = Number(process.env.FORK_ANVIL_PORT ?? (await getFreePort()));
  const localUrl = `http://127.0.0.1:${port}`;
  anvil = spawn(
    anvilBin(),
    ['--fork-url', forkUrl, '--host', '127.0.0.1', '--port', String(port), '--silent'],
    {
      cwd: root,
      env: {
        ...env,
        PATH: `${env.HOME ?? ''}/.foundry/bin:${env.PATH ?? ''}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  anvil.stderr.on('data', (chunk) => process.stderr.write(`[anvil] ${chunk}`));
  await waitForRpc(localUrl);

  const forkBlock = await rpc(localUrl, 'eth_blockNumber');
  await rpc(localUrl, 'anvil_impersonateAccount', [row.wallet_address]);
  await rpc(localUrl, 'anvil_setBalance', [row.wallet_address, toQuantity(10n ** 19n)]);
  return { localUrl, forkBlock };
}

async function deployContract(localUrl, wallet, label, bytecode, constructorArgs = '0x') {
  const data = `0x${hexStrip(bytecode)}${hexStrip(constructorArgs)}`;
  const tx = {
    from: wallet,
    data,
  };
  const gasHex = await rpc(localUrl, 'eth_estimateGas', [tx]);
  const hash = await rpc(localUrl, 'eth_sendTransaction', [{ ...tx, gas: bufferedGas(gasHex) }]);
  const receipt = await waitForReceipt(localUrl, hash);
  if (receipt.status !== '0x1' || !receipt.contractAddress) {
    throw new Error(`${label} deployment failed: ${hash}`);
  }
  console.log(
    `fork|deploy|${label}|status=passed|estimate=${BigInt(gasHex)}|gasUsed=${BigInt(
      receipt.gasUsed ?? '0x0',
    )}|address=${receipt.contractAddress}`,
  );
  return {
    address: receipt.contractAddress,
    hash,
    gasEstimate: BigInt(gasHex).toString(),
    gasUsed: BigInt(receipt.gasUsed ?? '0x0').toString(),
  };
}

function dataFilesMatching(match) {
  try {
    return readdirSync(new URL('../data/', import.meta.url))
      .filter((file) => file.endsWith('.json') && match(file))
      .sort();
  } catch {
    return [];
  }
}

function readDexCandidate(candidateId) {
  const files = dataFilesMatching(
    (file) =>
      file === 'dex-arbitrage-candidates.json' ||
      /^dex-arbitrage-candidates-[a-z0-9-]+\.json$/i.test(file) ||
      /^curve-stable-arbitrage-candidates-[a-z0-9-]+\.json$/i.test(file) ||
      /^balancer-arbitrage-candidates-[a-z0-9-]+\.json$/i.test(file) ||
      /^uniswap-v3-fee-arbitrage-candidates-[a-z0-9-]+\.json$/i.test(file),
  );
  for (const file of files) {
    try {
      const artifact = JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
      const candidate = artifact.candidates?.find((item) => item.id === candidateId);
      if (candidate) return candidate;
    } catch {
      // Try the next artifact.
    }
  }
  return null;
}

function readAaveLiquidationCandidate(candidateId) {
  const files = [
    'aave-liquidation-candidates-ethereum.json',
    'aave-liquidation-candidates-base.json',
    'aave-liquidation-candidates-arbitrum.json',
    'aave-liquidation-candidates-polygon.json',
    'aave-liquidation-event-replay-candidates-ethereum.json',
    'aave-liquidation-event-replay-candidates-base.json',
    'aave-liquidation-event-replay-candidates-arbitrum.json',
    'aave-liquidation-event-replay-candidates-polygon.json',
  ];
  for (const file of files) {
    try {
      const artifact = JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
      const candidate = artifact.candidates?.find((item) => item.id === candidateId);
      if (candidate) return candidate;
    } catch {
      // Try the next artifact.
    }
  }
  return null;
}

function readCompoundLiquidationCandidate(candidateId) {
  const files = [
    'compound-v3-liquidation-candidates-ethereum.json',
    'compound-v3-liquidation-candidates-event-replay-ethereum.json',
  ];
  for (const file of files) {
    try {
      const artifact = JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
      const candidate = artifact.candidates?.find((item) => item.id === candidateId);
      if (candidate) return candidate;
    } catch {
      // Try the next artifact.
    }
  }
  return null;
}

function readMorphoBlueLiquidationCandidate(candidateId) {
  const files = [
    'morpho-blue-liquidation-candidates-ethereum.json',
    'morpho-blue-liquidation-event-replay-candidates-ethereum.json',
  ];
  for (const file of files) {
    try {
      const artifact = JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
      const candidate = artifact.candidates?.find((item) => item.id === candidateId);
      if (candidate) return candidate;
    } catch {
      // Try the next artifact.
    }
  }
  return null;
}

function formatRay(value, decimals = 6) {
  const scale = 10n ** 18n;
  const n = BigInt(value);
  const whole = n / scale;
  const frac = (n % scale).toString().padStart(18, '0').slice(0, decimals);
  return `${whole}.${frac}`.replace(/\.?0+$/, '');
}

function maybeAddressWord(value) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(value ?? ''))) return null;
  return encodeAddress(value);
}

function maybeUintWord(value) {
  if (value == null || value === '') return null;
  try {
    const n = BigInt(value);
    if (n < 0n) return null;
    return encodeUint(n);
  } catch {
    return null;
  }
}

function encodeBoolWord(value) {
  return encodeUint(value ? 1n : 0n);
}

function buildAaveLiquidationCallCalldata({
  collateralAsset,
  debtAsset,
  borrower,
  debtToCover,
  receiveAToken,
}) {
  const words = [
    maybeAddressWord(collateralAsset),
    maybeAddressWord(debtAsset),
    maybeAddressWord(borrower),
    maybeUintWord(debtToCover),
    encodeBoolWord(receiveAToken === true),
  ];
  if (!words.every((word) => typeof word === 'string')) return null;
  return `${SELECTORS.aaveV3LiquidationCall}${words.join('')}`;
}

function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value ?? ''));
}

function buildAaveExecutorLiquidationCalldata({
  collateralAsset,
  debtAsset,
  borrower,
  debtToCover,
  receiveAToken,
  unwindTarget = ZERO_ADDRESS,
  unwindCalldata = '0x',
  minDebtAssetOut = '0',
  minProfit = '0',
  beneficiary = ZERO_ADDRESS,
}) {
  const missingFields = [
    !isAddress(collateralAsset) ? 'collateralAsset' : null,
    !isAddress(debtAsset) ? 'debtAsset' : null,
    !isAddress(borrower) ? 'borrower' : null,
    debtToCover == null || debtToCover === '' ? 'debtToCover' : null,
    !isAddress(unwindTarget) ? 'unwindTarget' : null,
    !isAddress(beneficiary) ? 'beneficiary' : null,
  ].filter(Boolean);
  if (missingFields.length > 0) {
    return { calldata: null, missingFields, error: null };
  }

  try {
    const tuple = `(${collateralAsset},${borrower},${debtToCover},${receiveAToken === true ? 'true' : 'false'},${unwindTarget},${unwindCalldata},${minDebtAssetOut},${minProfit},${beneficiary})`;
    return {
      calldata: castCalldata(
        'executeLiquidation(address,uint256,(address,address,uint256,bool,address,bytes,uint256,uint256,address))',
        [debtAsset, String(debtToCover), tuple],
      ),
      missingFields: [],
      error: null,
    };
  } catch (err) {
    return { calldata: null, missingFields: [], error: err.message };
  }
}

function buildCompoundExecutorCalldata({
  comet,
  baseAsset,
  borrower,
  collateralAsset,
  baseAmount,
  minCollateralAmount,
  unwindRoute,
  minProfitBase = '0',
  deadline = '9999999999',
  beneficiary = ZERO_ADDRESS,
}) {
  const missingFields = [
    !isAddress(comet) ? 'comet' : null,
    !isAddress(baseAsset) ? 'baseAsset' : null,
    !isAddress(borrower) ? 'borrower' : null,
    !isAddress(collateralAsset) ? 'collateralAsset' : null,
    baseAmount == null || baseAmount === '' ? 'baseAmount' : null,
    minCollateralAmount == null || minCollateralAmount === '' ? 'minCollateralAmount' : null,
    !Array.isArray(unwindRoute) ? 'unwindRoute' : null,
    !isAddress(beneficiary) ? 'beneficiary' : null,
  ].filter(Boolean);
  if (missingFields.length > 0) {
    return { calldata: null, missingFields, error: null };
  }

  try {
    const tuple = `(${comet},${baseAsset},${borrower},${collateralAsset},${baseAmount},${minCollateralAmount},${routeTupleString(
      unwindRoute,
    )},${minProfitBase},${deadline},${beneficiary})`;
    return {
      calldata: castCalldata(
        'execute((address,address,address,address,uint256,uint256,(address,address,address,address,uint256)[],uint256,uint256,address))',
        [tuple],
      ),
      missingFields: [],
      error: null,
    };
  } catch (err) {
    return { calldata: null, missingFields: [], error: err.message };
  }
}

function marketParamsTupleString(marketParams) {
  if (!marketParams) return null;
  return `(${marketParams.loanToken},${marketParams.collateralToken},${marketParams.oracle},${marketParams.irm},${marketParams.lltv})`;
}

function buildMorphoBlueExecutorCalldata({
  morpho,
  marketParams,
  borrower,
  seizedAssets,
  repaidShares,
  maxRepayAssets,
  minCollateralSeized,
  unwindRoute,
  minProfitLoan = '0',
  deadline = '9999999999',
  beneficiary = ZERO_ADDRESS,
}) {
  const missingFields = [
    !isAddress(morpho) ? 'morpho' : null,
    !isAddress(marketParams?.loanToken) ? 'marketParams.loanToken' : null,
    !isAddress(marketParams?.collateralToken) ? 'marketParams.collateralToken' : null,
    !isAddress(marketParams?.oracle) ? 'marketParams.oracle' : null,
    !isAddress(marketParams?.irm) ? 'marketParams.irm' : null,
    marketParams?.lltv == null || marketParams.lltv === '' ? 'marketParams.lltv' : null,
    !isAddress(borrower) ? 'borrower' : null,
    seizedAssets == null || seizedAssets === '' ? 'seizedAssets' : null,
    repaidShares == null || repaidShares === '' ? 'repaidShares' : null,
    maxRepayAssets == null || maxRepayAssets === '' ? 'maxRepayAssets' : null,
    minCollateralSeized == null || minCollateralSeized === '' ? 'minCollateralSeized' : null,
    !Array.isArray(unwindRoute) ? 'unwindRoute' : null,
    !isAddress(beneficiary) ? 'beneficiary' : null,
  ].filter(Boolean);
  if (missingFields.length > 0) {
    return { calldata: null, missingFields, error: null };
  }

  try {
    const tuple = `(${morpho},${marketParamsTupleString(
      marketParams,
    )},${borrower},${seizedAssets},${repaidShares},${maxRepayAssets},${minCollateralSeized},${routeTupleString(
      unwindRoute,
    )},${minProfitLoan},${deadline},${beneficiary})`;
    return {
      calldata: castCalldata(
        'execute((address,(address,address,address,address,uint256),address,uint256,uint256,uint256,uint256,(address,address,address,address,uint256)[],uint256,uint256,address))',
        [tuple],
      ),
      missingFields: [],
      error: null,
    };
  } catch (err) {
    return { calldata: null, missingFields: [], error: err.message };
  }
}

function tokenMapForCandidate(candidate) {
  const out = new Map();
  for (const token of [candidate.startToken, candidate.midToken, candidate.thirdToken]) {
    if (token?.symbol && token?.address) out.set(token.symbol, token);
  }
  return out;
}

function maxSlippageBps(plan) {
  const value = asArray(plan.riskLimits).find((limit) => limit?.key === 'maxSlippageBps')?.value;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30;
}

function applySlippage(amount, bps) {
  const scale = BigInt(Math.max(0, 10_000 - Math.floor(bps)));
  return (BigInt(amount) * scale) / 10_000n;
}

function addBps(amount, bps) {
  const scale = BigInt(10_000 + Math.max(0, Math.floor(bps)));
  return divUp(BigInt(amount) * scale, 10_000n);
}

function divUp(numerator, denominator) {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  if (d === 0n) return 0n;
  return (n + d - 1n) / d;
}

function mulDivDown(a, b, denominator) {
  const d = BigInt(denominator);
  if (d === 0n) return 0n;
  return (BigInt(a) * BigInt(b)) / d;
}

function encodeBalanceOf(owner) {
  return SELECTORS.balanceOf + encodeAddress(owner);
}

function encodeApprove(spender, amount) {
  return SELECTORS.approve + encodeAddress(spender) + encodeUint(amount);
}

function encodeCompoundIsLiquidatable(account) {
  return SELECTORS.compoundV3IsLiquidatable + encodeAddress(account);
}

function encodeCompoundQuoteCollateral(asset, baseAmount) {
  return SELECTORS.compoundV3QuoteCollateral + encodeAddress(asset) + encodeUint(baseAmount);
}

function encodeUniswapGetPool(tokenIn, tokenOut, fee) {
  return SELECTORS.uniswapV3GetPool + encodeAddress(tokenIn) + encodeAddress(tokenOut) + encodeUint(fee);
}

function encodeUniswapQuote(tokenIn, tokenOut, amountIn, fee) {
  return (
    SELECTORS.uniswapV3QuoteExactInputSingle +
    encodeAddress(tokenIn) +
    encodeAddress(tokenOut) +
    encodeUint(amountIn) +
    encodeUint(fee) +
    encodeUint(0n)
  );
}

function encodeDynamicBytes(hex) {
  const clean = hexStrip(hex).toLowerCase();
  const paddedLength = Math.ceil(clean.length / 64) * 64;
  return encodeUint(clean.length / 2) + clean.padEnd(paddedLength, '0');
}

function encodeUniswapQuoteExactInput(pathHex, amountIn) {
  return (
    SELECTORS.uniswapV3QuoteExactInput +
    encodeUint(64n) +
    encodeUint(amountIn) +
    encodeDynamicBytes(pathHex)
  );
}

function encodeUniswapSwap(tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum) {
  return (
    SELECTORS.uniswapV3SwapRouter02ExactInputSingle +
    encodeAddress(tokenIn) +
    encodeAddress(tokenOut) +
    encodeUint(fee) +
    encodeAddress(recipient) +
    encodeUint(amountIn) +
    encodeUint(amountOutMinimum) +
    encodeUint(0n)
  );
}

function encodeUniswapExactInput(pathHex, recipient, amountIn, amountOutMinimum) {
  return (
    SELECTORS.uniswapV3SwapRouter02ExactInput +
    encodeUint(32n) +
    encodeUint(128n) +
    encodeAddress(recipient) +
    encodeUint(amountIn) +
    encodeUint(amountOutMinimum) +
    encodeDynamicBytes(pathHex)
  );
}

function encodeUniswapV3Path(tokens, fees) {
  if (tokens.length !== fees.length + 1) throw new Error('invalid Uniswap V3 path shape');
  let out = hexStrip(tokens[0]).toLowerCase();
  for (let i = 0; i < fees.length; i += 1) {
    out += Number(fees[i]).toString(16).padStart(6, '0');
    out += hexStrip(tokens[i + 1]).toLowerCase();
  }
  return `0x${out}`;
}

function encodeAerodromeGetAmountsOut(amountIn, tokenIn, tokenOut, stable, factory) {
  return (
    SELECTORS.aerodromeGetAmountsOut +
    encodeUint(amountIn) +
    encodeUint(64n) +
    encodeUint(1n) +
    encodeAddress(tokenIn) +
    encodeAddress(tokenOut) +
    encodeBool(stable) +
    encodeAddress(factory)
  );
}

async function balanceOf(localUrl, token, owner) {
  return decodeFirstUint(await rpc(localUrl, 'eth_call', [{ to: token, data: encodeBalanceOf(owner) }]));
}

function balanceStorageSlot(owner, slot) {
  return execFileSync(castBin(), ['index', 'address', owner, String(slot)], {
    encoding: 'utf8',
    env: { ...env, PATH: `${env.HOME ?? ''}/.foundry/bin:${env.PATH ?? ''}` },
  }).trim();
}

async function setErc20Balance(localUrl, token, owner, amount) {
  for (let slot = 0; slot < 120; slot += 1) {
    const storageSlot = balanceStorageSlot(owner, slot);
    await rpc(localUrl, 'anvil_setStorageAt', [token, storageSlot, `0x${encodeUint(amount)}`]);
    const observed = await balanceOf(localUrl, token, owner).catch(() => 0n);
    if (observed === BigInt(amount)) return { slot, storageSlot };
  }
  throw new Error(`could not locate ERC20 balance slot for ${token}`);
}

async function quoteUniswapV3(localUrl, chainId, tokenIn, tokenOut, amountIn, fee) {
  const contracts = UNISWAP_V3[chainId];
  const pool = decodeAddress(
    await rpcWithRetries(localUrl, 'eth_call', [
      { to: contracts.factory, data: encodeUniswapGetPool(tokenIn, tokenOut, fee) },
    ]),
  );
  if (/^0x0{40}$/i.test(pool)) throw new Error(`missing Uniswap V3 pool for fee ${fee}`);
  const amountOut = decodeFirstUint(
    await rpcWithRetries(localUrl, 'eth_call', [
      { to: contracts.quoter, data: encodeUniswapQuote(tokenIn, tokenOut, amountIn, fee) },
    ]),
  );
  if (amountOut <= 0n) throw new Error('zero Uniswap V3 quote');
  return { pool, amountOut };
}

function tokenLabel(address, chainId) {
  const token = UNISWAP_V3_UNWIND_BRIDGES[chainId]?.find(
    (item) => item.address.toLowerCase() === String(address).toLowerCase(),
  );
  return token?.symbol ?? address;
}

function uniqueTokenPaths(paths) {
  const seen = new Set();
  const out = [];
  for (const path of paths) {
    const key = path.map((token) => token.toLowerCase()).join('>');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

function unwindTokenPaths(chainId, tokenIn, tokenOut) {
  const bridges = (UNISWAP_V3_UNWIND_BRIDGES[chainId] ?? [])
    .map((item) => item.address)
    .filter(
      (address) =>
        address.toLowerCase() !== tokenIn.toLowerCase() &&
        address.toLowerCase() !== tokenOut.toLowerCase(),
    );
  const paths = [[tokenIn, tokenOut]];
  for (const bridge of bridges) paths.push([tokenIn, bridge, tokenOut]);
  for (const first of bridges) {
    for (const second of bridges) {
      if (first.toLowerCase() === second.toLowerCase()) continue;
      paths.push([tokenIn, first, second, tokenOut]);
    }
  }
  return uniqueTokenPaths(paths);
}

function feePlansForPath(chainId, hopCount) {
  const configured = UNISWAP_V3_UNWIND_FEE_PLANS[chainId]?.[hopCount];
  if (configured?.length) return configured;
  return hopCount === 1 ? UNISWAP_V3_UNWIND_FEES.map((fee) => [fee]) : [];
}

function prioritizedUnwindRoutePlans(chainId, tokenIn, tokenOut) {
  const out = [];
  for (const tokens of unwindTokenPaths(chainId, tokenIn, tokenOut)) {
    for (const fees of feePlansForPath(chainId, tokens.length - 1)) {
      out.push({ tokens, fees });
    }
  }
  return out;
}

async function uniswapPoolsForPath(localUrl, chainId, tokens, fees) {
  const pools = [];
  const timeoutMs = Math.max(500, Number(env.AAVE_UNWIND_RPC_TIMEOUT_MS ?? 12000));
  for (let i = 0; i < fees.length; i += 1) {
    const pool = decodeAddress(
      await rpcWithRetries(localUrl, 'eth_call', [
        { to: UNISWAP_V3[chainId].factory, data: encodeUniswapGetPool(tokens[i], tokens[i + 1], fees[i]) },
      ], 1, timeoutMs),
    );
    if (/^0x0{40}$/i.test(pool)) return null;
    pools.push(pool);
  }
  return pools;
}

async function quoteUniswapV3Path(localUrl, chainId, tokens, fees, amountIn) {
  const timeoutMs = Math.max(500, Number(env.AAVE_UNWIND_RPC_TIMEOUT_MS ?? 12000));
  const pools = await uniswapPoolsForPath(localUrl, chainId, tokens, fees);
  if (!pools) throw new Error('missing pool for one or more hops');
  const pathHex = encodeUniswapV3Path(tokens, fees);
  const amountOut = decodeFirstUint(
    await rpcWithRetries(localUrl, 'eth_call', [
      { to: UNISWAP_V3[chainId].quoter, data: encodeUniswapQuoteExactInput(pathHex, amountIn) },
    ], 1, timeoutMs),
  );
  if (amountOut <= 0n) throw new Error('zero Uniswap V3 path quote');
  return { pools, pathHex, amountOut };
}

async function quoteBestUniswapV3Unwind(localUrl, chainId, tokenIn, tokenOut, amountIn) {
  if (!UNISWAP_V3[chainId]) {
    return {
      status: 'unsupported-chain',
      reason: `Uniswap V3 contracts are not configured for chain ${chainId}`,
    };
  }
  if (!tokenIn || !tokenOut) {
    return { status: 'missing-token', reason: 'collateral or loan token is missing' };
  }
  if (amountIn <= 0n) {
    return { status: 'missing-amount', reason: 'collateral amount is zero' };
  }
  const attempts = [];
  let best = null;
  const maxAttempts = Math.max(1, Number(env.AAVE_UNWIND_MAX_ROUTE_ATTEMPTS ?? 8));
  const routePlans = prioritizedUnwindRoutePlans(chainId, tokenIn, tokenOut);
  for (const { tokens, fees } of routePlans) {
      if (attempts.length >= maxAttempts) break;
      const routeLabel = tokens.map((token) => tokenLabel(token, chainId));
      try {
        const quote = await quoteUniswapV3Path(localUrl, chainId, tokens, fees, amountIn);
        const row = {
          route: routeLabel,
          tokenPath: tokens,
          fees,
          pools: quote.pools,
          path: quote.pathHex,
          amountOut: quote.amountOut.toString(),
        };
        attempts.push({ ...row, status: 'quoted' });
        if (!best || quote.amountOut > best.amountOutRaw) {
          best = { ...row, amountOutRaw: quote.amountOut };
        }
      } catch (err) {
        attempts.push({
          route: routeLabel,
          tokenPath: tokens,
          fees,
          status: 'failed',
          error: err.message,
        });
      }
  }
  if (!best) {
    return {
      status: 'no-route',
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
      maxAttempts,
      attempts,
    };
  }
  return {
    status: 'quoted',
    tokenIn,
    tokenOut,
    amountIn: amountIn.toString(),
    best: {
      fee: best.fees?.length === 1 ? best.fees[0] : undefined,
      pool: best.pools?.length === 1 ? best.pools[0] : undefined,
      fees: best.fees,
      route: best.route,
      tokenPath: best.tokenPath,
      pools: best.pools,
      path: best.path,
      amountOut: best.amountOut,
    },
    maxAttempts,
    attempts,
  };
}

function encodeCurveGetDy(i, j, amountIn) {
  return SELECTORS.curveGetDy + encodeUint(i) + encodeUint(j) + encodeUint(amountIn);
}

async function quoteCurveStable(localUrl, tokenIn, tokenOut, amountIn, route) {
  if (!route?.pool) throw new Error('Curve route pool is missing');
  const i = route.i;
  const j = route.j;
  if (!Number.isInteger(i) || !Number.isInteger(j)) {
    throw new Error('Curve route coin indexes are missing');
  }
  const amountOut = decodeFirstUint(
    await rpcWithRetries(localUrl, 'eth_call', [
      { to: route.pool, data: encodeCurveGetDy(i, j, amountIn) },
    ]),
  );
  if (amountOut <= 0n) throw new Error('zero Curve StableSwap quote');
  return { pool: route.pool, amountOut, i, j };
}

async function quoteAerodrome(localUrl, row, tokenIn, tokenOut, amountIn, route) {
  const router = AERODROME[row.chain_id]?.router;
  if (!router) throw new Error(`Aerodrome router missing for chain ${row.chain_id}`);
  if (!route || typeof route.stable !== 'boolean') throw new Error('Aerodrome route stable flag is missing');
  if (!route.factory) throw new Error('Aerodrome route factory is missing');
  const amountOut = decodeUintArrayLast(
    await rpcWithRetries(localUrl, 'eth_call', [
      {
        to: router,
        data: encodeAerodromeGetAmountsOut(
          amountIn,
          tokenIn.address,
          tokenOut.address,
          route.stable,
          route.factory,
        ),
      },
    ]),
  );
  if (amountOut <= 0n) throw new Error('zero Aerodrome quote');
  return {
    pool: router,
    router,
    factory: route.factory,
    stable: route.stable,
    amountOut,
  };
}

function poolAddressFromBalancerPoolId(poolId) {
  const clean = hexStrip(poolId);
  if (clean.length < 40) throw new Error('Balancer poolId is too short');
  return `0x${clean.slice(0, 40)}`;
}

function encodeBalancerQueryBatchSwap(poolId, tokenIn, tokenOut, amountIn) {
  const headWords = 7;
  const swapsWords = 8;
  const swapsOffset = headWords * 32;
  const assetsOffset = swapsOffset + swapsWords * 32;
  const kindGivenIn = 0;
  const swaps = [
    encodeUint(1n),
    encodeUint(32n),
    pad32(poolId),
    encodeUint(0n),
    encodeUint(1n),
    encodeUint(amountIn),
    encodeUint(160n),
    encodeUint(0n),
  ];
  const assets = [encodeUint(2n), encodeAddress(tokenIn.address), encodeAddress(tokenOut.address)];
  return (
    SELECTORS.balancerQueryBatchSwap +
    [
      encodeUint(kindGivenIn),
      encodeUint(swapsOffset),
      encodeUint(assetsOffset),
      encodeAddress(BALANCER_QUERY_SENDER),
      encodeUint(0n),
      encodeAddress(BALANCER_QUERY_SENDER),
      encodeUint(0n),
      ...swaps,
      ...assets,
    ].join('')
  );
}

async function quoteBalancerV2(localUrl, row, tokenIn, tokenOut, amountIn, route) {
  const vault = route?.vault ?? BALANCER_V2[row.chain_id]?.vault;
  const poolId = route?.poolId;
  if (!vault) throw new Error(`Balancer V2 vault missing for chain ${row.chain_id}`);
  if (!poolId) throw new Error('Balancer route poolId is missing');
  const deltas = decodeIntArray(
    await rpcWithRetries(localUrl, 'eth_call', [
      { to: vault, data: encodeBalancerQueryBatchSwap(poolId, tokenIn, tokenOut, amountIn) },
    ]),
  );
  const outDelta = deltas[1] ?? 0n;
  const amountOut = outDelta < 0n ? -outDelta : 0n;
  if (amountOut <= 0n) throw new Error('zero Balancer V2 quote');
  return {
    pool: poolAddressFromBalancerPoolId(poolId),
    poolId,
    vault,
    amountOut,
  };
}

function quotedSample(candidate) {
  return candidate.samples?.find((sample) => sample.status === 'quoted') ?? null;
}

function routeForHop(candidate, hopIndex) {
  const sample = quotedSample(candidate);
  if (!sample) return null;
  if (Array.isArray(sample.legs)) return sample.legs[hopIndex]?.route ?? null;
  if (hopIndex === 0 && sample.buyRoute) return sample.buyRoute;
  if (hopIndex === 1 && sample.sellRoute) return sample.sellRoute;
  if (hopIndex === 0) return sample.firstRoute ?? null;
  if (hopIndex === 1) return sample.secondRoute ?? null;
  return null;
}

async function quoteDexHop(localUrl, row, dex, tokenIn, tokenOut, amountIn, route) {
  if (dex === 'uniswap-v3') {
    const fee = Number(route?.fee ?? 3000);
    const quote = await quoteUniswapV3(localUrl, row.chain_id, tokenIn.address, tokenOut.address, amountIn, fee);
    return {
      adapterKind: 'uniswap-v3',
      dex,
      pool: quote.pool,
      fee,
      tokenIn: tokenIn.symbol,
      tokenOut: tokenOut.symbol,
      amountIn: amountIn.toString(),
      quotedAmountOut: quote.amountOut.toString(),
      amountOut: quote.amountOut,
    };
  }
  if (String(dex).startsWith('curve-')) {
    const quote = await quoteCurveStable(localUrl, tokenIn, tokenOut, amountIn, route);
    return {
      adapterKind: 'curve-stable',
      dex,
      pool: quote.pool,
      curveIndexes: { i: quote.i, j: quote.j },
      tokenIn: tokenIn.symbol,
      tokenOut: tokenOut.symbol,
      amountIn: amountIn.toString(),
      quotedAmountOut: quote.amountOut.toString(),
      amountOut: quote.amountOut,
    };
  }
  if (dex === 'balancer-v2') {
    const quote = await quoteBalancerV2(localUrl, row, tokenIn, tokenOut, amountIn, route);
    return {
      adapterKind: 'balancer-v2',
      dex,
      pool: quote.pool,
      poolId: quote.poolId,
      vault: quote.vault,
      tokenIn: tokenIn.symbol,
      tokenOut: tokenOut.symbol,
      amountIn: amountIn.toString(),
      quotedAmountOut: quote.amountOut.toString(),
      amountOut: quote.amountOut,
    };
  }
  if (dex === 'aerodrome') {
    const quote = await quoteAerodrome(localUrl, row, tokenIn, tokenOut, amountIn, route);
    return {
      adapterKind: `aerodrome:${quote.stable ? 'stable' : 'volatile'}:${quote.factory.toLowerCase()}`,
      dex,
      pool: quote.router,
      router: quote.router,
      factory: quote.factory,
      stable: quote.stable,
      tokenIn: tokenIn.symbol,
      tokenOut: tokenOut.symbol,
      amountIn: amountIn.toString(),
      quotedAmountOut: quote.amountOut.toString(),
      amountOut: quote.amountOut,
    };
  }
  throw new Error(`unsupported direct rehearsal dex ${dex}`);
}

async function sendPreparedCall(localUrl, wallet, call) {
  const tx = {
    from: wallet,
    to: call.to,
    value: callValue(call.value ?? '0'),
    data: call.calldata,
  };
  const gasHex = await rpc(localUrl, 'eth_estimateGas', [tx]);
  const hash = await rpc(localUrl, 'eth_sendTransaction', [{ ...tx, gas: bufferedGas(gasHex) }]);
  const receipt = await waitForReceipt(localUrl, hash);
  return {
    label: call.label,
    kind: call.kind,
    status: receipt.status === '0x1' ? 'passed' : 'reverted',
    hash,
    gasEstimate: BigInt(gasHex).toString(),
    gasUsed: BigInt(receipt.gasUsed ?? '0x0').toString(),
  };
}

async function simulatePreparedTransaction(localUrl, wallet, call) {
  const tx = {
    from: wallet,
    to: call.to,
    value: callValue(call.value ?? '0'),
    data: call.calldata,
  };
  let gasHex;
  try {
    gasHex = await rpc(localUrl, 'eth_estimateGas', [tx]);
  } catch (err) {
    return {
      label: call.label,
      kind: call.kind,
      status: 'estimate-failed',
      error: err.message,
    };
  }

  const txWithGas = { ...tx, gas: bufferedGas(gasHex) };
  try {
    await rpc(localUrl, 'eth_call', [txWithGas]);
  } catch (err) {
    return {
      label: call.label,
      kind: call.kind,
      status: 'eth-call-reverted',
      gasEstimate: BigInt(gasHex).toString(),
      error: err.message,
    };
  }

  try {
    const hash = await rpc(localUrl, 'eth_sendTransaction', [txWithGas]);
    const receipt = await waitForReceipt(localUrl, hash);
    return {
      label: call.label,
      kind: call.kind,
      status: receipt.status === '0x1' ? 'passed' : 'reverted',
      hash,
      gasEstimate: BigInt(gasHex).toString(),
      gasUsed: BigInt(receipt.gasUsed ?? '0x0').toString(),
    };
  } catch (err) {
    return {
      label: call.label,
      kind: call.kind,
      status: 'send-failed',
      gasEstimate: BigInt(gasHex).toString(),
      error: err.message,
    };
  }
}

function routeTupleString(route) {
  return `[${route
    .map(
      (hop) =>
        `(${hop.adapter},${hop.pool},${hop.tokenIn},${hop.tokenOut},${hop.minAmountOut})`,
    )
    .join(',')}]`;
}

async function deployAdapterForKind(localUrl, wallet, kind, chainId) {
  if (kind === 'uniswap-v3') {
    return deployContract(
      localUrl,
      wallet,
      'UniswapV3Adapter',
      contractBytecode('src/adapters/UniversalDexAdapter.sol:UniswapV3Adapter'),
    );
  }
  if (kind === 'curve-stable') {
    return deployContract(
      localUrl,
      wallet,
      'CurveStableSwapAdapter',
      contractBytecode('src/adapters/CurveStableSwapAdapter.sol:CurveStableSwapAdapter'),
    );
  }
  if (kind === 'balancer-v2') {
    const vault = BALANCER_V2[chainId]?.vault;
    if (!vault) throw new Error(`Balancer V2 vault missing for chain ${chainId}`);
    return deployContract(
      localUrl,
      wallet,
      'BalancerV2VaultAdapter',
      contractBytecode('src/adapters/BalancerV2VaultAdapter.sol:BalancerV2VaultAdapter'),
      castAbiEncode('constructor(address)', [vault]),
    );
  }
  if (kind.startsWith('aerodrome:')) {
    const [, mode, factory] = kind.split(':');
    const router = AERODROME[chainId]?.router;
    if (!router) throw new Error(`Aerodrome router missing for chain ${chainId}`);
    if (mode !== 'stable' && mode !== 'volatile') throw new Error(`unsupported Aerodrome adapter mode ${mode}`);
    if (!factory) throw new Error(`Aerodrome factory missing in adapter kind ${kind}`);
    return deployContract(
      localUrl,
      wallet,
      `AerodromeRouterAdapter-${mode}`,
      contractBytecode('src/adapters/AerodromeRouterAdapter.sol:AerodromeRouterAdapter'),
      castAbiEncode('constructor(address,address,bool)', [router, factory, mode === 'stable' ? 'true' : 'false']),
    );
  }
  throw new Error(`unsupported adapter kind ${kind}`);
}

async function runWalletAtomicExecutorRehearsal(localUrl, row, startToken, startingAmount, quotes, tokens) {
  const adapters = new Map();
  for (const kind of unique(quotes.map((quote) => quote.adapterKind))) {
    adapters.set(kind, await deployAdapterForKind(localUrl, row.wallet_address, kind, row.chain_id));
  }
  const executorConstructor = castAbiEncode('constructor(address)', [row.wallet_address]);
  const executorDeployment = await deployContract(
    localUrl,
    row.wallet_address,
    'WalletAtomicArbitrageExecutor',
    contractBytecode('src/WalletAtomicArbitrageExecutor.sol:WalletAtomicArbitrageExecutor'),
    executorConstructor,
  );
  const configResults = [];
  for (const [kind, deployment] of adapters.entries()) {
    configResults.push(
      await sendPreparedCall(localUrl, row.wallet_address, {
        kind: 'executor-config',
        label: `Whitelist ${kind} adapter`,
        to: executorDeployment.address,
        value: '0',
        calldata: castCalldata('whitelistAdapter(address,bool)', [deployment.address, 'true']),
      }),
    );
  }
  const approvalResult = await sendPreparedCall(localUrl, row.wallet_address, {
    kind: 'executor-approval',
    label: 'Approve start token to wallet atomic executor',
    to: startToken.address,
    value: '0',
    calldata: encodeApprove(executorDeployment.address, startingAmount),
  });
  const route = quotes.map((quote, i) => ({
    adapter: adapters.get(quote.adapterKind).address,
    pool: quote.pool,
    tokenIn: tokens[i].address,
    tokenOut: tokens[i + 1].address,
    minAmountOut: quote.minAmountOut,
  }));
  const executeTuple = `(${startToken.address},${startingAmount},${routeTupleString(
    route,
  )},0,9999999999,${row.wallet_address})`;
  const executeCalldata = castCalldata(
    'execute((address,uint256,(address,address,address,address,uint256)[],uint256,uint256,address))',
    [executeTuple],
  );
  const callTx = {
    from: row.wallet_address,
    to: executorDeployment.address,
    value: '0x0',
    data: executeCalldata,
    gas: toQuantity(8_000_000n),
  };
  let ethCallError = null;
  try {
    await rpc(localUrl, 'eth_call', [callTx]);
  } catch (err) {
    ethCallError = err.message;
  }

  let sendResult;
  try {
    const hash = await rpc(localUrl, 'eth_sendTransaction', [callTx]);
    const receipt = await waitForReceipt(localUrl, hash);
    sendResult = {
      status: receipt.status === '0x1' ? 'passed' : 'reverted',
      hash,
      gasUsed: BigInt(receipt.gasUsed ?? '0x0').toString(),
    };
  } catch (err) {
    sendResult = {
      status: 'send-failed',
      error: err.message,
    };
  }

  return {
    mode: 'wallet-atomic-executor-rehearsal',
    contract: 'WalletAtomicArbitrageExecutor',
    adapters: Object.fromEntries(
      [...adapters.entries()].map(([kind, deployment]) => [kind, deployment.address]),
    ),
    adapter: adapters.get('uniswap-v3')?.address ?? adapters.values().next().value?.address ?? null,
    executor: executorDeployment.address,
    approvalResult,
    configResults,
    route,
    executeCalldataBytes: (executeCalldata.length - 2) / 2,
    ethCallStatus: ethCallError ? 'reverted' : 'passed',
    ethCallError,
    sendResult,
  };
}

function mixedDexLabel(dex) {
  if (dex === 'balancer-v2') return 'balancer';
  if (dex === 'aerodrome') return 'aerodrome';
  if (String(dex).startsWith('curve-')) return 'curve';
  return String(dex || 'dex').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

async function runDexDirectRouteRehearsal(row) {
  const candidate = readDexCandidate(row.candidate_id);
  if (!candidate) {
    emitReport(purePlanBlockedReport(row, 'dex-direct-route-candidate-artifact-missing', row.latest_preflight));
    process.exitCode = 1;
    return;
  }
  const plan = row.plan ?? {};
  const tokenPath = asArray(plan.route?.tokenPath);
  const dexPath = asArray(plan.route?.dexPath);
  const tokenBySymbol = tokenMapForCandidate(candidate);
  const tokens = tokenPath.map((symbol) => tokenBySymbol.get(symbol));
  if (tokens.length !== tokenPath.length || tokens.some((token) => !token)) {
    emitReport(purePlanBlockedReport(row, 'dex-direct-route-token-metadata-missing', row.latest_preflight));
    process.exitCode = 1;
    return;
  }

  const { localUrl, forkBlock } = await startFork(row);
  const contracts = UNISWAP_V3[row.chain_id];
  const bps = maxSlippageBps(plan);
  const startToken = tokens[0];
  const startingAmount = BigInt(plan.route?.amountIn ?? candidate.amountIn);
  const funding = await setErc20Balance(localUrl, startToken.address, row.wallet_address, startingAmount);
  const calls = [];
  const quotes = [];
  let runningAmount = startingAmount;
  const allUniswapV3 = dexPath.every((dex) => dex === 'uniswap-v3');
  const firstNonUniswapDex = dexPath.find((dex) => dex !== 'uniswap-v3');
  const mixedLabel = mixedDexLabel(firstNonUniswapDex);
  const rehearsalMode = allUniswapV3
    ? 'dex-direct-route-rehearsal'
    : `${mixedLabel}-mixed-route-rehearsal`;

  try {
    for (let i = 0; i < dexPath.length; i += 1) {
      const dex = dexPath[i];
      const tokenIn = tokens[i];
      const tokenOut = tokens[i + 1];
      const route = routeForHop(candidate, i);
      const quote = await quoteDexHop(localUrl, row, dex, tokenIn, tokenOut, runningAmount, route);
      const minOut = applySlippage(quote.amountOut, bps);
      quotes.push({
        ...quote,
        amountOut: undefined,
        minAmountOut: minOut.toString(),
      });
      if (allUniswapV3) {
        calls.push({
          kind: 'approval',
          label: `Approve ${tokenIn.symbol} for Uniswap V3 router`,
          to: tokenIn.address,
          value: '0',
          calldata: encodeApprove(contracts.router, runningAmount),
        });
        calls.push({
          kind: 'dex-swap',
          label: `Swap ${tokenIn.symbol} to ${tokenOut.symbol} on Uniswap V3`,
          to: contracts.router,
          value: '0',
          calldata: encodeUniswapSwap(
            tokenIn.address,
            tokenOut.address,
            quote.fee,
            row.wallet_address,
            runningAmount,
            minOut,
          ),
        });
      }
      runningAmount = minOut;
    }
  } catch (err) {
    const quoteFailReason = allUniswapV3
      ? 'dex-direct-route-quote-failed'
      : `${mixedLabel}-mixed-route-quote-failed`;
    emitReport({
      kind: 'fork-simulation-report',
      status: 'failed',
      forkSimulation: 'blocked',
      mode: rehearsalMode,
      reason: quoteFailReason,
      summary: `forkSimulation=failed mode=${rehearsalMode} reason=${quoteFailReason} candidateId=${row.candidate_id}`,
      runId: row.id,
      candidateId: row.candidate_id,
      chainId: row.chain_id,
      error: err.message,
      quotes,
      blockers: ['fresh route quote failed for the fork rehearsal'],
      requirements: ['refresh route liquidity and pool metadata before building executable calldata'],
    });
    process.exitCode = 1;
    return;
  }

  let strategyExecutorRehearsal = null;
  try {
    strategyExecutorRehearsal = await runWalletAtomicExecutorRehearsal(
      localUrl,
      row,
      startToken,
      startingAmount,
      quotes,
      tokens,
    );
    console.log(
      `fork|wallet-atomic-executor|execute|ethCall=${strategyExecutorRehearsal.ethCallStatus}|send=${strategyExecutorRehearsal.sendResult.status}|executor=${strategyExecutorRehearsal.executor}|adapter=${strategyExecutorRehearsal.adapter}`,
    );
  } catch (err) {
    strategyExecutorRehearsal = {
      mode: 'wallet-atomic-executor-rehearsal',
      status: 'setup-failed',
      error: err.message,
    };
    console.log(`fork|wallet-atomic-executor|setup|status=failed|error=${err.message}`);
  }

  console.log(
    `fork=ready run=${row.id} chain=${row.chain_id} wallet=${row.wallet_address} block=${Number(
      BigInt(forkBlock),
    )} mode=${rehearsalMode} calls=${calls.length}`,
  );
  console.log(
    `dexDirectFunding token=${startToken.symbol} amount=${startingAmount} storageSlot=${funding.slot}`,
  );

  const results = [];
  if (allUniswapV3) {
    for (const call of calls) {
      try {
        const result = await sendPreparedCall(localUrl, row.wallet_address, call);
        results.push(result);
        console.log(
          `fork|${call.kind}|${call.label}|status=${result.status}|estimate=${result.gasEstimate}|gasUsed=${result.gasUsed}|hash=${result.hash}|calldata=${calldataHead(call.calldata)}`,
        );
        if (result.status !== 'passed') break;
      } catch (err) {
        results.push({
          label: call.label,
          kind: call.kind,
          status: 'estimate-or-send-failed',
          error: err.message,
        });
        console.log(`fork|${call.kind}|${call.label}|status=estimate-or-send-failed|error=${err.message}`);
        break;
      }
    }
  }

  const finalBalance = allUniswapV3
    ? await balanceOf(localUrl, startToken.address, row.wallet_address).catch(() => 0n)
    : runningAmount;
  const netProfit = finalBalance - startingAmount;
  const directGasUsed = results.reduce((sum, result) => sum + BigInt(result.gasUsed ?? '0'), 0n);
  const executorGasUsed = BigInt(strategyExecutorRehearsal?.sendResult?.gasUsed ?? '0');
  const totalGasUsed = allUniswapV3 ? directGasUsed : executorGasUsed;
  const allCallsPassed = results.length === calls.length && results.every((result) => result.status === 'passed');
  const executorReverted = strategyExecutorRehearsal?.sendResult?.status === 'reverted';
  const mixedLossReason = `${mixedLabel}-mixed-route-net-loss-reverted`;
  let reason;
  if (!allUniswapV3 && executorReverted && netProfit <= 0n) {
    reason = mixedLossReason;
  } else if (!allUniswapV3 && strategyExecutorRehearsal?.status === 'setup-failed') {
    reason = `${mixedLabel}-mixed-route-executor-setup-failed`;
  } else if (!allUniswapV3) {
    reason = netProfit > 0n
      ? `${mixedLabel}-mixed-route-rehearsal-not-production-executor`
      : `${mixedLabel}-mixed-route-net-loss-not-reverted`;
  } else if (!allCallsPassed) {
    reason = 'dex-direct-route-transaction-failed';
  } else {
    reason = netProfit > 0n
      ? 'dex-direct-route-rehearsal-not-production-executor'
      : 'dex-direct-route-net-loss';
  }
  const summary = `forkSimulation=failed mode=${rehearsalMode} reason=${reason} calls=${results.length}/${calls.length} netProfit=${netProfit} totalGasUsed=${totalGasUsed} candidateId=${row.candidate_id}`;
  emitReport({
    kind: 'fork-simulation-report',
    status: 'failed',
    forkSimulation: 'failed',
    mode: rehearsalMode,
    reason,
    summary,
    runId: row.id,
    candidateId: row.candidate_id,
    chainId: row.chain_id,
    startToken: startToken.symbol,
    startingAmount: startingAmount.toString(),
    finalBalance: finalBalance.toString(),
    netProfit: netProfit.toString(),
    totalGasUsed: totalGasUsed.toString(),
    quotes,
    results,
    strategyExecutorRehearsal,
    walletAtomicExecutorRehearsal: strategyExecutorRehearsal,
    blockers: [
      netProfit <= 0n
        ? 'same-block route is not profitable after executing or simulating the quoted swaps on the fork'
        : 'fork rehearsal is not the deployed audited production path',
      'production execution still requires an audited loss-reverting executor, private routing policy, and final profitability gate',
    ],
    requirements: [
      allUniswapV3
        ? 'replace direct router-swap rehearsal with deployed WalletAtomicArbitrageExecutor calldata'
        : 'promote fork-only mixed-route adapter rehearsal to deployed audited WalletAtomicArbitrageExecutor contracts',
      'prove atomic revert-on-loss behavior on the same fork block',
      'pass profitability and gas gates with fresh quotes immediately before signing',
    ],
  });
  process.exitCode = 1;
}

async function runAaveLiquidationGateRehearsal(row) {
  const plan = row.plan ?? {};
  const candidate = readAaveLiquidationCandidate(row.candidate_id);
  if (!candidate) {
    emitReport(purePlanBlockedReport(row, 'aave-liquidation-candidate-artifact-missing', row.latest_preflight));
    process.exitCode = 1;
    return;
  }

  const pool = plan.liquidation?.pool;
  const borrower = plan.borrower ?? candidate.user;
  if (!pool || !borrower) {
    emitReport(purePlanBlockedReport(row, 'aave-liquidation-plan-missing-pool-or-borrower', row.latest_preflight));
    process.exitCode = 1;
    return;
  }

  const { localUrl, forkBlock } = await startFork(row);
  const calldata = castCalldata('getUserAccountData(address)', [borrower]);
  const result = await rpcWithRetries(localUrl, 'eth_call', [{ to: pool, data: calldata }]);
  const [
    totalCollateralBase,
    totalDebtBase,
    availableBorrowsBase,
    currentLiquidationThreshold,
    ltv,
    healthFactor,
  ] = decodeUintWords(result, 6);
  const oneRay = 10n ** 18n;
  const isLiquidatable = healthFactor < oneRay;
  const best = candidate.bestEstimate ?? {};
  const liquidation = plan.liquidation ?? {};
  const collateralAsset = liquidation.collateralAsset ?? best.collateralAsset ?? null;
  const debtAsset = liquidation.debtAsset ?? best.debtAsset ?? null;
  const debtToCover =
    liquidation.debtToCover ?? best.debtToCoverBaseUnits ?? best.debtToCover ?? null;
  const debtToCoverSource =
    liquidation.debtToCoverSource ?? best.debtToCoverSource ?? 'unknown';
  const receiveAToken = liquidation.receiveAToken === true;
  const liquidationCallCalldata = buildAaveLiquidationCallCalldata({
    collateralAsset,
    debtAsset,
    borrower,
    debtToCover,
    receiveAToken,
  });
  const liquidationCallCalldataBytes =
    liquidationCallCalldata == null ? null : (liquidationCallCalldata.length - 2) / 2;
  const liquidationCallCalldataPreview =
    liquidationCallCalldata == null ? null : calldataHead(liquidationCallCalldata);
  const calldataMissingFields = [
    !collateralAsset ? 'collateralAsset' : null,
    !debtAsset ? 'debtAsset' : null,
    !borrower ? 'borrower' : null,
    debtToCover == null || debtToCover === '' ? 'debtToCover' : null,
  ].filter(Boolean);
  const calldataStatus =
    liquidationCallCalldata == null
      ? 'missing-inputs'
      : isLiquidatable
        ? 'ready-for-fork-rehearsal'
        : 'withheld-health-factor-not-below-one';
  const seizedCollateralBaseUnits =
    liquidation.seizedCollateralBaseUnits ?? best.seizedCollateralBaseUnits ?? null;
  let seizedCollateralAmountIn = 0n;
  try {
    seizedCollateralAmountIn = BigInt(seizedCollateralBaseUnits ?? '0');
  } catch {
    seizedCollateralAmountIn = 0n;
  }
  let collateralUnwindQuote = {
    status: 'not-attempted',
    reason: 'executor deployment is attempted before collateral unwind route search',
  };
  let executorCalldataBuild = { calldata: null, missingFields: [], error: null };
  let executeLiquidationCalldata = null;
  let executeLiquidationCalldataBytes = null;
  let executeLiquidationCalldataStatus = 'blocked-collateral-unwind-quote-required';
  let unwindTarget = ZERO_ADDRESS;
  let unwindCalldata = '0x';
  let minDebtAssetOut = '0';
  let unwindTargetConfigResults = [];
  let executorForkSimulation = {
    status: 'not-attempted',
    reason: 'executor calldata and health-factor gates have not been evaluated yet',
  };
  let aaveFlashLoanExecutor = {
    mode: 'aave-v3-flash-loan-liquidation-executor-rehearsal',
    contract: 'AaveV3LiquidationExecutor',
    deploymentStatus: 'not-attempted',
    executor: null,
    executeLiquidationCalldataStatus,
    executeLiquidationCalldataBytes,
    executeLiquidationCalldataPreview:
      executeLiquidationCalldata == null ? null : calldataHead(executeLiquidationCalldata),
    withheldBecauseHealthFactorNotBelowOne: Boolean(executeLiquidationCalldata && !isLiquidatable),
    collateralUnwindQuote,
    missingFields: executorCalldataBuild.missingFields,
    error: executorCalldataBuild.error,
    params: {
      aavePool: pool,
      debtAsset,
      collateralAsset,
      borrower,
      debtToCover,
      seizedCollateralBaseUnits,
      receiveAToken,
      unwindTarget,
      unwindCalldata,
      minDebtAssetOut,
      minProfit: '0',
      beneficiary: row.wallet_address ?? ZERO_ADDRESS,
    },
    unwindTargetConfigResults,
    executorForkSimulation,
  };
  let deployment = null;
  try {
    const constructorArgs = castAbiEncode('constructor(address,address)', [
      pool,
      row.wallet_address,
    ]);
    deployment = await deployContract(
      localUrl,
      row.wallet_address,
      'AaveV3LiquidationExecutor',
      contractBytecode('src/AaveV3LiquidationExecutor.sol:AaveV3LiquidationExecutor'),
      constructorArgs,
    );
    aaveFlashLoanExecutor = {
      ...aaveFlashLoanExecutor,
      deploymentStatus: 'passed',
      executor: deployment.address,
      deployment,
    };
    console.log(`fork|aave-executor|deploy|status=passed|executor=${deployment.address}`);
  } catch (err) {
    aaveFlashLoanExecutor = {
      ...aaveFlashLoanExecutor,
      deploymentStatus: 'failed',
      error: err.message,
    };
    console.log(`fork|aave-executor|deploy|status=failed|error=${err.message}`);
  }

  if (deployment) {
    try {
      if (!collateralAsset || !debtAsset) {
        collateralUnwindQuote = { status: 'missing-token', reason: 'collateral or debt asset is missing' };
      } else if (collateralAsset.toLowerCase() === debtAsset.toLowerCase()) {
        collateralUnwindQuote = {
          status: 'not-required',
          reason: 'collateral asset already matches debt asset',
          amountIn: seizedCollateralAmountIn.toString(),
          best: { amountOut: seizedCollateralAmountIn.toString() },
        };
      } else {
        collateralUnwindQuote = await quoteBestUniswapV3Unwind(
          localUrl,
          row.chain_id,
          collateralAsset,
          debtAsset,
          seizedCollateralAmountIn,
        );
      }
      const hasExecutableUnwind =
        collateralUnwindQuote.status === 'quoted' || collateralUnwindQuote.status === 'not-required';
      minDebtAssetOut =
        collateralUnwindQuote.status === 'quoted'
          ? applySlippage(BigInt(collateralUnwindQuote.best.amountOut), maxSlippageBps(plan)).toString()
          : collateralUnwindQuote.status === 'not-required'
            ? seizedCollateralAmountIn.toString()
            : '0';
      unwindTarget =
        collateralUnwindQuote.status === 'quoted' ? UNISWAP_V3[row.chain_id]?.router : ZERO_ADDRESS;
      unwindCalldata =
        collateralUnwindQuote.status === 'quoted'
          ? encodeUniswapExactInput(
              collateralUnwindQuote.best.path,
              deployment.address,
              seizedCollateralAmountIn,
              BigInt(minDebtAssetOut),
            )
          : '0x';
      if (isLiquidatable && collateralUnwindQuote.status === 'quoted' && unwindTarget !== ZERO_ADDRESS) {
        try {
          const result = await sendPreparedCall(localUrl, row.wallet_address, {
            kind: 'aave-executor-config',
            label: 'Whitelist collateral unwind target',
            to: deployment.address,
            value: '0',
            calldata: castCalldata('setUnwindTarget(address,bool)', [unwindTarget, 'true']),
          });
          unwindTargetConfigResults = [result];
        } catch (err) {
          unwindTargetConfigResults = [
            {
              label: 'Whitelist collateral unwind target',
              kind: 'aave-executor-config',
              status: 'failed',
              error: err.message,
            },
          ];
        }
      }
      if (hasExecutableUnwind) {
        executorCalldataBuild = buildAaveExecutorLiquidationCalldata({
          collateralAsset,
          debtAsset,
          borrower,
          debtToCover,
          receiveAToken,
          unwindTarget,
          unwindCalldata,
          minDebtAssetOut,
          minProfit: '0',
          beneficiary: row.wallet_address ?? ZERO_ADDRESS,
        });
        executeLiquidationCalldata = executorCalldataBuild.calldata;
        executeLiquidationCalldataBytes =
          executeLiquidationCalldata == null ? null : (executeLiquidationCalldata.length - 2) / 2;
        executeLiquidationCalldataStatus =
          executeLiquidationCalldata == null
            ? 'missing-inputs'
            : !isLiquidatable
              ? 'withheld-health-factor-not-below-one'
              : 'ready-for-fork-eth-call';
      } else {
        executeLiquidationCalldataStatus = 'blocked-collateral-unwind-quote-required';
      }
      const configPassed = unwindTargetConfigResults.every((item) => item.status === 'passed');
      if (!deployment) {
        executorForkSimulation = {
          status: 'skipped-executor-deployment-failed',
          reason: 'executor deployment did not pass',
        };
      } else if (!isLiquidatable) {
        executorForkSimulation = {
          status: 'skipped-health-factor-not-below-one',
          reason: 'borrower is not liquidatable at the fork block',
        };
      } else if (!executeLiquidationCalldata) {
        executorForkSimulation = {
          status: 'skipped-calldata-unavailable',
          reason:
            executorCalldataBuild.error ||
            executorCalldataBuild.missingFields.join(', ') ||
            'executor calldata unavailable',
        };
      } else if (!configPassed) {
        executorForkSimulation = {
          status: 'skipped-unwind-target-config-failed',
          reason: 'collateral unwind target whitelist transaction did not pass',
          configResults: unwindTargetConfigResults,
        };
      } else {
        executorForkSimulation = await simulatePreparedTransaction(localUrl, row.wallet_address, {
          kind: 'aave-executor-liquidation',
          label: 'Execute Aave flash-loan liquidation',
          to: deployment.address,
          value: '0',
          calldata: executeLiquidationCalldata,
        });
      }
      if (executeLiquidationCalldata && isLiquidatable) {
        executeLiquidationCalldataStatus =
          executorForkSimulation.status === 'passed'
            ? 'fork-transaction-passed'
            : `fork-transaction-${executorForkSimulation.status}`;
      }
      aaveFlashLoanExecutor = {
        ...aaveFlashLoanExecutor,
        executeLiquidationCalldataStatus,
        executeLiquidationCalldataBytes,
        executeLiquidationCalldataPreview:
          executeLiquidationCalldata == null ? null : calldataHead(executeLiquidationCalldata),
        withheldBecauseHealthFactorNotBelowOne: Boolean(executeLiquidationCalldata && !isLiquidatable),
        collateralUnwindQuote,
        unwindTargetConfigResults,
        executorForkSimulation,
        missingFields: executorCalldataBuild.missingFields,
        error: executorCalldataBuild.error,
        params: {
          ...aaveFlashLoanExecutor.params,
          unwindTarget,
          unwindCalldata: calldataHead(unwindCalldata),
          minDebtAssetOut,
        },
      };
      console.log(
        `fork|aave-executor|calldata|unwindQuoteStatus=${collateralUnwindQuote.status}|executeCalldataBytes=${executeLiquidationCalldataBytes ?? 'none'}|executeCalldataStatus=${executeLiquidationCalldataStatus}`,
      );
    } catch (err) {
      collateralUnwindQuote = {
        status: 'failed',
        reason: 'collateral unwind quote or executor calldata build failed',
        error: err.message,
      };
      executeLiquidationCalldataStatus = 'blocked-collateral-unwind-quote-required';
      aaveFlashLoanExecutor = {
        ...aaveFlashLoanExecutor,
        collateralUnwindQuote,
        executeLiquidationCalldataStatus,
        executorForkSimulation,
        error: err.message,
      };
      console.log(`fork|aave-executor|calldata|status=failed|error=${err.message}`);
    }
  } else {
    executorForkSimulation = {
      status: 'skipped-executor-deployment-failed',
      reason: 'executor deployment did not pass',
    };
    aaveFlashLoanExecutor = {
      ...aaveFlashLoanExecutor,
      executorForkSimulation,
    };
  }
  const executorForkPassed = executorForkSimulation.status === 'passed';
  const reason = executorForkPassed
    ? 'aave-liquidation-executor-fork-simulation-passed'
    : isLiquidatable
      ? 'aave-liquidation-liquidatable-executor-simulation-not-passed'
      : 'aave-liquidation-health-factor-not-below-one';
  const summary = `forkSimulation=${executorForkPassed ? 'passed' : 'blocked'} mode=aave-liquidation-gate-check reason=${reason} healthFactor=${formatRay(
    healthFactor,
  )} liquidationCallCalldataBytes=${liquidationCallCalldataBytes ?? 'none'} aaveExecutorCalldataBytes=${executeLiquidationCalldataBytes ?? 'none'} calldataStatus=${calldataStatus} executorCalldataStatus=${executeLiquidationCalldataStatus} withheldByHealthFactor=${Boolean(
    liquidationCallCalldata && !isLiquidatable,
  )} candidateId=${row.candidate_id}`;

  emitReport({
    kind: 'fork-simulation-report',
    status: executorForkPassed ? 'passed' : 'failed',
    forkSimulation: executorForkPassed ? 'passed' : 'blocked',
    mode: 'aave-liquidation-gate-check',
    reason,
    summary,
    runId: row.id,
    candidateId: row.candidate_id,
    chainId: row.chain_id,
    forkBlock: Number(BigInt(forkBlock)),
    borrower,
    pool,
    latestAccountData: {
      totalCollateralBase: totalCollateralBase.toString(),
      totalDebtBase: totalDebtBase.toString(),
      availableBorrowsBase: availableBorrowsBase.toString(),
      currentLiquidationThreshold: currentLiquidationThreshold.toString(),
      ltv: ltv.toString(),
      healthFactorRaw: healthFactor.toString(),
      healthFactor: formatRay(healthFactor),
      isLiquidatable,
    },
    artifactAccountData: candidate.account ?? null,
    liquidation: plan.liquidation ?? null,
    aaveFlashLoanExecutor,
    liquidationCall: {
      selector: SELECTORS.aaveV3LiquidationCall,
      calldataStatus,
      calldataPreview: liquidationCallCalldataPreview,
      liquidationCallCalldataBytes,
      withheldBecauseHealthFactorNotBelowOne: Boolean(liquidationCallCalldata && !isLiquidatable),
      missingFields: calldataMissingFields,
      params: {
        collateralAsset,
        debtAsset,
        borrower,
        debtToCover,
        debtToCoverSource,
        receiveAToken,
      },
    },
    blockers: [
      executorForkPassed
        ? null
        : isLiquidatable
          ? 'borrower is liquidatable, but the Aave executor fork transaction did not pass'
          : 'Aave V3 liquidationCall will revert unless borrower health factor is below 1 at execution block',
      liquidationCallCalldata
        ? `liquidationCall calldata preview is ${liquidationCallCalldataBytes} bytes and must be regenerated at the execution block`
        : `liquidationCall calldata cannot be built yet; missing ${calldataMissingFields.join(', ') || 'valid ABI inputs'}`,
      executeLiquidationCalldata
        ? `Aave flash-loan executor calldata preview is ${executeLiquidationCalldataBytes} bytes with status ${executeLiquidationCalldataStatus}`
        : `Aave flash-loan executor calldata cannot be built yet; missing ${executorCalldataBuild.missingFields.join(', ') || executorCalldataBuild.error || 'valid ABI inputs'}`,
      'production execution still requires a same-block collateral unwind quote, whitelisted unwind target, and revert-on-loss fork simulation',
    ].filter(Boolean),
    requirements: [
      'refresh borrower health factor immediately before signing',
      'use liquidationCall calldata only when healthFactor < 1 on the forked execution block',
      'execute liquidation through AaveV3LiquidationExecutor flashLoanSimple callback only after HF and quote gates pass',
      'set a whitelisted collateral unwind target and minDebtAssetOut/minProfit in debt-asset base units',
      'quote seized collateral unwind route and prove after-gas profit on the same fork block',
    ],
  });
  if (!executorForkPassed) process.exitCode = 1;
}

async function runCompoundLiquidationGateRehearsal(row) {
  const plan = row.plan ?? {};
  const candidate = readCompoundLiquidationCandidate(row.candidate_id);
  if (!candidate) {
    emitReport(purePlanBlockedReport(row, 'compound-v3-liquidation-candidate-artifact-missing', row.latest_preflight));
    process.exitCode = 1;
    return;
  }

  const comet = plan.liquidation?.comet;
  const borrower = plan.borrower ?? candidate.user;
  if (!comet || !borrower) {
    emitReport(purePlanBlockedReport(row, 'compound-v3-liquidation-plan-missing-comet-or-borrower', row.latest_preflight));
    process.exitCode = 1;
    return;
  }

  const { localUrl, forkBlock } = await startFork(row);
  const isLiquidatable = decodeBool(
    await rpcWithRetries(localUrl, 'eth_call', [
      { to: comet, data: encodeCompoundIsLiquidatable(borrower) },
    ]),
  );
  const best = candidate.bestEstimate ?? {};
  const liquidation = plan.liquidation ?? {};
  const baseAsset = liquidation.baseAsset ?? best.baseAsset ?? null;
  const collateralAsset = liquidation.collateralAsset ?? best.collateralAsset ?? null;
  const baseAmount = liquidation.baseAmount ?? best.baseAmount ?? null;
  const artifactQuotedCollateral = liquidation.quotedCollateral ?? best.quotedCollateral ?? null;
  const bps = maxSlippageBps(plan);

  let compoundExecutor = {
    mode: 'compound-v3-liquidation-executor-rehearsal',
    contract: 'CompoundV3LiquidationExecutor',
    deploymentStatus: 'not-attempted',
    executor: null,
    adapter: null,
    funding: null,
    approvalResult: null,
    configResults: [],
    cometCollateralQuote: {
      status: 'not-attempted',
      artifactQuotedCollateral,
    },
    collateralUnwindQuote: {
      status: 'not-attempted',
      reason: 'liquidatability and calldata input gates have not passed yet',
    },
    route: [],
    executeCalldataBytes: null,
    executeCalldataPreview: null,
    executeCalldataStatus: 'not-attempted',
    executorForkSimulation: {
      status: 'not-attempted',
      reason: 'liquidatability and calldata input gates have not passed yet',
    },
    params: {
      comet,
      baseAsset,
      borrower,
      collateralAsset,
      baseAmount,
      minCollateralAmount: null,
      minProfitBase: '0',
      beneficiary: row.wallet_address ?? ZERO_ADDRESS,
    },
  };

  if (!isLiquidatable) {
    const reason = 'compound-v3-liquidation-account-not-liquidatable';
    const summary = `forkSimulation=blocked mode=compound-v3-liquidation-gate-check reason=${reason} isLiquidatable=${isLiquidatable} candidateId=${row.candidate_id}`;

    emitReport({
      kind: 'fork-simulation-report',
      status: 'failed',
      forkSimulation: 'blocked',
      mode: 'compound-v3-liquidation-gate-check',
      reason,
      summary,
      runId: row.id,
      candidateId: row.candidate_id,
      chainId: row.chain_id,
      forkBlock: Number(BigInt(forkBlock)),
      borrower,
      comet,
      latestCometData: {
        isLiquidatable,
      },
      artifactAccountData: candidate.account ?? null,
      liquidation: plan.liquidation ?? null,
      compoundExecutor,
      blockers: [
        'Compound V3 absorb/buyCollateral path should not run unless Comet isLiquidatable(account) is true at execution block',
        'production execution still requires a liquidation adapter, collateral reserve checks, unwind quote, and revert-on-loss fork simulation',
      ],
      requirements: [
        'refresh isLiquidatable(account), borrow balance, collateral balances, and reserves immediately before signing',
        'build absorb and buyCollateral calldata only when the account is liquidatable and reserves support the trade',
        'quote collateral unwind route and prove after-gas profit on the same fork block',
      ],
    });
    process.exitCode = 1;
    return;
  }

  const missingFields = [
    !isAddress(baseAsset) ? 'baseAsset' : null,
    !isAddress(collateralAsset) ? 'collateralAsset' : null,
    baseAmount == null || baseAmount === '' ? 'baseAmount' : null,
  ].filter(Boolean);
  let baseAmountIn = 0n;
  try {
    baseAmountIn = BigInt(baseAmount ?? '0');
    if (baseAmountIn <= 0n) missingFields.push('baseAmount>0');
  } catch {
    missingFields.push('baseAmount<uint256>');
  }

  if (missingFields.length === 0) {
    try {
      const quotedCollateral = decodeFirstUint(
        await rpcWithRetries(localUrl, 'eth_call', [
          { to: comet, data: encodeCompoundQuoteCollateral(collateralAsset, baseAmountIn) },
        ]),
      );
      compoundExecutor = {
        ...compoundExecutor,
        cometCollateralQuote: {
          status: quotedCollateral > 0n ? 'quoted' : 'zero-quote',
          baseAmount: baseAmountIn.toString(),
          quotedCollateral: quotedCollateral.toString(),
          artifactQuotedCollateral,
        },
      };
    } catch (err) {
      compoundExecutor = {
        ...compoundExecutor,
        cometCollateralQuote: {
          status: 'failed',
          baseAmount: baseAmountIn.toString(),
          artifactQuotedCollateral,
          error: err.message,
        },
      };
    }
  }

  let minCollateralAmount = '0';
  let collateralAmountIn = 0n;
  if (compoundExecutor.cometCollateralQuote.status === 'quoted') {
    collateralAmountIn = BigInt(compoundExecutor.cometCollateralQuote.quotedCollateral);
    minCollateralAmount = applySlippage(collateralAmountIn, bps).toString();
  }

  let deployment = null;
  let adapterDeployment = null;
  let collateralUnwindQuote = compoundExecutor.collateralUnwindQuote;
  let route = [];
  let executeCalldataBuild = { calldata: null, missingFields, error: null };
  let executeCalldata = null;
  let executeCalldataStatus = 'blocked-inputs-missing';
  let executorForkSimulation = compoundExecutor.executorForkSimulation;
  let funding = null;
  let approvalResult = null;
  let configResults = [];

  try {
    if (missingFields.length > 0) {
      executorForkSimulation = {
        status: 'skipped-calldata-inputs-missing',
        reason: `missing ${missingFields.join(', ')}`,
      };
    } else if (compoundExecutor.cometCollateralQuote.status !== 'quoted' || collateralAmountIn <= 0n) {
      executeCalldataStatus = 'blocked-comet-collateral-quote-required';
      executorForkSimulation = {
        status: 'skipped-comet-collateral-quote-unavailable',
        reason:
          compoundExecutor.cometCollateralQuote.error ||
          compoundExecutor.cometCollateralQuote.status ||
          'Comet quoteCollateral did not return a positive amount',
      };
    } else {
      if (collateralAsset.toLowerCase() === baseAsset.toLowerCase()) {
        collateralUnwindQuote = {
          status: 'not-required',
          reason: 'collateral asset already matches base asset',
          amountIn: collateralAmountIn.toString(),
          best: { amountOut: collateralAmountIn.toString() },
        };
      } else {
        collateralUnwindQuote = await quoteBestUniswapV3Unwind(
          localUrl,
          row.chain_id,
          collateralAsset,
          baseAsset,
          collateralAmountIn,
        );
      }

      const hasExecutableUnwind =
        collateralUnwindQuote.status === 'quoted' || collateralUnwindQuote.status === 'not-required';
      if (!hasExecutableUnwind) {
        executeCalldataStatus = 'blocked-collateral-unwind-quote-required';
        executorForkSimulation = {
          status: 'skipped-collateral-unwind-quote-unavailable',
          reason: collateralUnwindQuote.reason || collateralUnwindQuote.status,
        };
      } else {
        if (collateralUnwindQuote.status === 'quoted') {
          adapterDeployment = await deployAdapterForKind(localUrl, row.wallet_address, 'uniswap-v3', row.chain_id);
          const tokenPath = collateralUnwindQuote.best.tokenPath ?? [];
          const pools = collateralUnwindQuote.best.pools ?? [];
          const finalMinBaseOut = applySlippage(
            BigInt(collateralUnwindQuote.best.amountOut),
            bps,
          ).toString();
          route = pools.map((pool, index) => ({
            adapter: adapterDeployment.address,
            pool,
            tokenIn: tokenPath[index],
            tokenOut: tokenPath[index + 1],
            minAmountOut: index === pools.length - 1 ? finalMinBaseOut : '0',
          }));
        }

        deployment = await deployContract(
          localUrl,
          row.wallet_address,
          'CompoundV3LiquidationExecutor',
          contractBytecode('src/CompoundV3LiquidationExecutor.sol:CompoundV3LiquidationExecutor'),
          castAbiEncode('constructor(address)', [row.wallet_address]),
        );
        console.log(`fork|compound-executor|deploy|status=passed|executor=${deployment.address}`);

        if (adapterDeployment) {
          configResults.push(
            await sendPreparedCall(localUrl, row.wallet_address, {
              kind: 'compound-executor-config',
              label: 'Whitelist Uniswap V3 collateral unwind adapter',
              to: deployment.address,
              value: '0',
              calldata: castCalldata('whitelistAdapter(address,bool)', [adapterDeployment.address, 'true']),
            }),
          );
        }

        funding = await setErc20Balance(localUrl, baseAsset, row.wallet_address, baseAmountIn);
        approvalResult = await sendPreparedCall(localUrl, row.wallet_address, {
          kind: 'compound-executor-approval',
          label: 'Approve base asset to Compound V3 liquidation executor',
          to: baseAsset,
          value: '0',
          calldata: encodeApprove(deployment.address, baseAmountIn),
        });

        executeCalldataBuild = buildCompoundExecutorCalldata({
          comet,
          baseAsset,
          borrower,
          collateralAsset,
          baseAmount: baseAmountIn.toString(),
          minCollateralAmount,
          unwindRoute: route,
          minProfitBase: '0',
          deadline: '9999999999',
          beneficiary: row.wallet_address ?? ZERO_ADDRESS,
        });
        executeCalldata = executeCalldataBuild.calldata;
        executeCalldataStatus = executeCalldata ? 'ready-for-fork-eth-call' : 'missing-inputs';
        const configPassed = configResults.every((item) => item.status === 'passed');
        if (!executeCalldata) {
          executorForkSimulation = {
            status: 'skipped-calldata-unavailable',
            reason:
              executeCalldataBuild.error ||
              executeCalldataBuild.missingFields.join(', ') ||
              'executor calldata unavailable',
          };
        } else if (!configPassed) {
          executorForkSimulation = {
            status: 'skipped-adapter-config-failed',
            reason: 'collateral unwind adapter whitelist transaction did not pass',
            configResults,
          };
        } else if (approvalResult.status !== 'passed') {
          executorForkSimulation = {
            status: 'skipped-approval-failed',
            reason: 'base asset approval transaction did not pass',
            approvalResult,
          };
        } else {
          executorForkSimulation = await simulatePreparedTransaction(localUrl, row.wallet_address, {
            kind: 'compound-executor-liquidation',
            label: 'Execute Compound V3 liquidation and collateral unwind',
            to: deployment.address,
            value: '0',
            calldata: executeCalldata,
          });
        }
        if (executeCalldata) {
          executeCalldataStatus =
            executorForkSimulation.status === 'passed'
              ? 'fork-transaction-passed'
              : `fork-transaction-${executorForkSimulation.status}`;
        }
      }
    }
  } catch (err) {
    executeCalldataStatus = 'failed';
    executorForkSimulation = {
      status: 'failed',
      reason: 'Compound V3 executor rehearsal threw before completion',
      error: err.message,
    };
    console.log(`fork|compound-executor|calldata|status=failed|error=${err.message}`);
  }

  compoundExecutor = {
    ...compoundExecutor,
    deploymentStatus: deployment ? 'passed' : compoundExecutor.deploymentStatus,
    executor: deployment?.address ?? null,
    adapter: adapterDeployment?.address ?? null,
    funding,
    approvalResult,
    configResults,
    collateralUnwindQuote,
    route,
    executeCalldataBytes: executeCalldata == null ? null : (executeCalldata.length - 2) / 2,
    executeCalldataPreview: executeCalldata == null ? null : calldataHead(executeCalldata),
    executeCalldataStatus,
    executorForkSimulation,
    missingFields: executeCalldataBuild.missingFields,
    error: executeCalldataBuild.error,
    params: {
      ...compoundExecutor.params,
      minCollateralAmount,
      unwindRouteLength: route.length,
    },
  };
  console.log(
    `fork|compound-executor|calldata|unwindQuoteStatus=${collateralUnwindQuote.status}|executeCalldataBytes=${compoundExecutor.executeCalldataBytes ?? 'none'}|executeCalldataStatus=${executeCalldataStatus}`,
  );

  const executorForkPassed = executorForkSimulation.status === 'passed';
  const reason = executorForkPassed
    ? 'compound-v3-liquidation-executor-fork-simulation-passed'
    : missingFields.length > 0
      ? 'compound-v3-liquidation-liquidatable-calldata-inputs-missing'
      : collateralUnwindQuote.status !== 'quoted' && collateralUnwindQuote.status !== 'not-required'
        ? 'compound-v3-liquidation-collateral-unwind-quote-required'
        : 'compound-v3-liquidation-liquidatable-executor-simulation-not-passed';
  const summary = `forkSimulation=${executorForkPassed ? 'passed' : 'blocked'} mode=compound-v3-liquidation-gate-check reason=${reason} isLiquidatable=${isLiquidatable} executeCalldataBytes=${compoundExecutor.executeCalldataBytes ?? 'none'} executorCalldataStatus=${executeCalldataStatus} candidateId=${row.candidate_id}`;

  emitReport({
    kind: 'fork-simulation-report',
    status: executorForkPassed ? 'passed' : 'failed',
    forkSimulation: executorForkPassed ? 'passed' : 'blocked',
    mode: 'compound-v3-liquidation-gate-check',
    reason,
    summary,
    runId: row.id,
    candidateId: row.candidate_id,
    chainId: row.chain_id,
    forkBlock: Number(BigInt(forkBlock)),
    borrower,
    comet,
    latestCometData: {
      isLiquidatable,
    },
    artifactAccountData: candidate.account ?? null,
    liquidation: plan.liquidation ?? null,
    compoundExecutor,
    blockers: [
      executorForkPassed
        ? null
        : 'Compound V3 executor fork transaction did not pass for the current block-scoped account and quote state',
      executeCalldata
        ? `Compound V3 executor calldata preview is ${compoundExecutor.executeCalldataBytes} bytes with status ${executeCalldataStatus}`
        : `Compound V3 executor calldata cannot be built yet; missing ${executeCalldataBuild.missingFields.join(', ') || executeCalldataBuild.error || missingFields.join(', ') || 'valid ABI inputs'}`,
      'production execution still requires a liquidation adapter, collateral reserve checks, unwind quote, and revert-on-loss fork simulation',
    ].filter(Boolean),
    requirements: [
      'refresh isLiquidatable(account), borrow balance, collateral balances, and reserves immediately before signing',
      'build absorb and buyCollateral calldata only when the account is liquidatable and reserves support the trade',
      'quote collateral unwind route and prove after-gas profit on the same fork block',
    ],
  });
  if (!executorForkPassed) process.exitCode = 1;
}

async function runMorphoBlueLiquidationGateRehearsal(row) {
  const plan = row.plan ?? {};
  const candidate = readMorphoBlueLiquidationCandidate(row.candidate_id);
  if (!candidate) {
    emitReport(purePlanBlockedReport(row, 'morpho-blue-liquidation-candidate-artifact-missing', row.latest_preflight));
    process.exitCode = 1;
    return;
  }

  const morpho = plan.liquidation?.morpho;
  const borrower = plan.borrower ?? candidate.user;
  const marketId = plan.liquidation?.marketId ?? candidate.marketId;
  const marketParams = plan.liquidation?.marketParams ?? candidate.marketParams;
  const oracle = marketParams?.oracle;
  if (!morpho || !borrower || !marketId || !oracle) {
    emitReport(purePlanBlockedReport(row, 'morpho-blue-liquidation-plan-missing-market-or-borrower', row.latest_preflight));
    process.exitCode = 1;
    return;
  }

  const { localUrl, forkBlock } = await startFork(row);
  const positionWords = decodeUintWords(
    await rpcWithRetries(localUrl, 'eth_call', [
      { to: morpho, data: castCalldata('position(bytes32,address)', [marketId, borrower]) },
    ]),
    3,
  );
  const marketWords = decodeUintWords(
    await rpcWithRetries(localUrl, 'eth_call', [
      { to: morpho, data: castCalldata('market(bytes32)', [marketId]) },
    ]),
    6,
  );
  const [supplyShares, borrowShares, collateral] = positionWords;
  const [
    totalSupplyAssets,
    totalSupplyShares,
    totalBorrowAssets,
    totalBorrowShares,
    lastUpdate,
    fee,
  ] = marketWords;
  let price;
  try {
    price = decodeFirstUint(
      await rpcWithRetries(localUrl, 'eth_call', [
        { to: oracle, data: castCalldata('price()', []) },
      ]),
    );
  } catch (err) {
    const reason = 'morpho-blue-liquidation-oracle-price-unavailable';
    const summary = `forkSimulation=blocked mode=morpho-blue-liquidation-gate-check reason=${reason} candidateId=${row.candidate_id}`;
    emitReport({
      kind: 'fork-simulation-report',
      status: 'failed',
      forkSimulation: 'blocked',
      mode: 'morpho-blue-liquidation-gate-check',
      reason,
      summary,
      runId: row.id,
      candidateId: row.candidate_id,
      chainId: row.chain_id,
      forkBlock: Number(BigInt(forkBlock)),
      borrower,
      morpho,
      marketId,
      latestMorphoData: {
        supplyShares: supplyShares.toString(),
        borrowShares: borrowShares.toString(),
        collateral: collateral.toString(),
        totalSupplyAssets: totalSupplyAssets.toString(),
        totalSupplyShares: totalSupplyShares.toString(),
        totalBorrowAssets: totalBorrowAssets.toString(),
        totalBorrowShares: totalBorrowShares.toString(),
        lastUpdate: lastUpdate.toString(),
        fee: fee.toString(),
        oracle,
        oraclePriceStatus: 'failed',
        oraclePriceError: err.message,
      },
      profitabilityGate: {
        status: candidate.gate?.status ?? 'unknown',
        reason: candidate.gate?.reason ?? null,
        minNetProfitUsd: candidate.gate?.minNetProfitUsd ?? null,
        minReturnOnRepayPct: candidate.gate?.minReturnOnRepayPct ?? null,
        bestEstimate: candidate.bestEstimate ?? null,
      },
      artifactAccountData: candidate.account ?? null,
      liquidation: plan.liquidation ?? null,
      blockers: [
        'Morpho Blue oracle price() reverted at the fork execution block',
        'liquidatability and profitability cannot be trusted until the oracle returns a current price on-chain',
      ],
      requirements: [
        'refresh oracle price immediately before signing',
        'exclude or quarantine markets whose oracle reverts, is stale, or cannot be consumed on-chain',
      ],
    });
    process.exitCode = 1;
    return;
  }
  const borrowAssets = totalBorrowShares === 0n
    ? 0n
    : divUp(borrowShares * totalBorrowAssets, totalBorrowShares);
  const oracleScale = 10n ** 36n;
  const wad = 10n ** 18n;
  const lltv = BigInt(marketParams.lltv);
  const collateralValueAssets = mulDivDown(collateral, price, oracleScale);
  const maxBorrowAssets = mulDivDown(collateralValueAssets, lltv, wad);
  const ltvWad = collateralValueAssets > 0n
    ? mulDivDown(borrowAssets, wad, collateralValueAssets)
    : 0n;
  const liquidatable = borrowAssets > maxBorrowAssets && borrowAssets > 0n && collateral > 0n;
  const candidateGate = candidate.gate ?? {};
  const candidateBest = candidate.bestEstimate ?? null;
  const candidateGatePassed = candidateGate.status === 'pass';
  const repayBufferBps = Number(env.MORPHO_REPAY_BUFFER_BPS ?? 5);
  const maxRepayAssets = borrowAssets > 0n ? addBps(borrowAssets, repayBufferBps) : 0n;
  let collateralUnwindQuote =
    liquidatable && marketParams?.collateralToken && marketParams?.loanToken && collateral > 0n
      ? await quoteBestUniswapV3Unwind(
          localUrl,
          row.chain_id,
          marketParams.collateralToken,
          marketParams.loanToken,
          collateral,
        )
      : {
          status: 'not-required',
          reason: liquidatable
            ? 'collateral or loan token is missing'
            : 'position is not liquidatable at the fork block',
        };
  let morphoBlueExecutor = {
    mode: 'morpho-blue-liquidation-executor-rehearsal',
    contract: 'MorphoBlueLiquidationExecutor',
    deploymentStatus: 'not-attempted',
    executor: null,
    adapter: null,
    funding: null,
    approvalResult: null,
    configResults: [],
    route: [],
    executeCalldataBytes: null,
    executeCalldataPreview: null,
    executeCalldataStatus: 'not-attempted',
    executorForkSimulation: {
      status: 'not-attempted',
      reason: 'liquidatability, unwind quote, and calldata gates have not passed yet',
    },
    params: {
      morpho,
      marketParams,
      borrower,
      seizedAssets: collateral.toString(),
      repaidShares: '0',
      maxRepayAssets: maxRepayAssets.toString(),
      minCollateralSeized: collateral.toString(),
      minProfitLoan: '0',
      beneficiary: row.wallet_address ?? ZERO_ADDRESS,
      repayBufferBps,
    },
  };

  let executorForkPassed = false;
  if (liquidatable) {
    let deployment = null;
    let adapterDeployment = null;
    let route = [];
    let executeCalldataBuild = { calldata: null, missingFields: [], error: null };
    let executeCalldata = null;
    let executeCalldataStatus = 'blocked-collateral-unwind-quote-required';
    let executorForkSimulation = morphoBlueExecutor.executorForkSimulation;
    let funding = null;
    let approvalResult = null;
    let configResults = [];
    try {
      const hasExecutableUnwind =
        marketParams.collateralToken?.toLowerCase() === marketParams.loanToken?.toLowerCase() ||
        collateralUnwindQuote.status === 'quoted';
      if (!hasExecutableUnwind) {
        executorForkSimulation = {
          status: 'skipped-collateral-unwind-quote-unavailable',
          reason: collateralUnwindQuote.reason || collateralUnwindQuote.status,
        };
      } else {
        if (collateralUnwindQuote.status === 'quoted') {
          adapterDeployment = await deployAdapterForKind(localUrl, row.wallet_address, 'uniswap-v3', row.chain_id);
          const tokenPath = collateralUnwindQuote.best.tokenPath ?? [];
          const pools = collateralUnwindQuote.best.pools ?? [];
          route = pools.map((pool, index) => ({
            adapter: adapterDeployment.address,
            pool,
            tokenIn: tokenPath[index],
            tokenOut: tokenPath[index + 1],
            minAmountOut: '0',
          }));
        } else {
          collateralUnwindQuote = {
            status: 'not-required',
            reason: 'collateral asset already matches loan asset',
            amountIn: collateral.toString(),
            best: { amountOut: collateral.toString() },
          };
        }

        deployment = await deployContract(
          localUrl,
          row.wallet_address,
          'MorphoBlueLiquidationExecutor',
          contractBytecode('src/MorphoBlueLiquidationExecutor.sol:MorphoBlueLiquidationExecutor'),
          castAbiEncode('constructor(address)', [row.wallet_address]),
        );
        console.log(`fork|morpho-executor|deploy|status=passed|executor=${deployment.address}`);

        if (adapterDeployment) {
          configResults.push(
            await sendPreparedCall(localUrl, row.wallet_address, {
              kind: 'morpho-executor-config',
              label: 'Whitelist Uniswap V3 collateral unwind adapter',
              to: deployment.address,
              value: '0',
              calldata: castCalldata('whitelistAdapter(address,bool)', [adapterDeployment.address, 'true']),
            }),
          );
        }

        funding = await setErc20Balance(localUrl, marketParams.loanToken, row.wallet_address, maxRepayAssets);
        approvalResult = await sendPreparedCall(localUrl, row.wallet_address, {
          kind: 'morpho-executor-approval',
          label: 'Approve loan asset to Morpho Blue liquidation executor',
          to: marketParams.loanToken,
          value: '0',
          calldata: encodeApprove(deployment.address, maxRepayAssets),
        });

        executeCalldataBuild = buildMorphoBlueExecutorCalldata({
          morpho,
          marketParams,
          borrower,
          seizedAssets: collateral.toString(),
          repaidShares: '0',
          maxRepayAssets: maxRepayAssets.toString(),
          minCollateralSeized: collateral.toString(),
          unwindRoute: route,
          minProfitLoan: '0',
          deadline: '9999999999',
          beneficiary: row.wallet_address ?? ZERO_ADDRESS,
        });
        executeCalldata = executeCalldataBuild.calldata;
        executeCalldataStatus = executeCalldata ? 'ready-for-fork-eth-call' : 'missing-inputs';
        const configPassed = configResults.every((item) => item.status === 'passed');
        if (!executeCalldata) {
          executorForkSimulation = {
            status: 'skipped-calldata-unavailable',
            reason:
              executeCalldataBuild.error ||
              executeCalldataBuild.missingFields.join(', ') ||
              'executor calldata unavailable',
          };
        } else if (!configPassed) {
          executorForkSimulation = {
            status: 'skipped-adapter-config-failed',
            reason: 'collateral unwind adapter whitelist transaction did not pass',
            configResults,
          };
        } else if (approvalResult.status !== 'passed') {
          executorForkSimulation = {
            status: 'skipped-approval-failed',
            reason: 'loan asset approval transaction did not pass',
            approvalResult,
          };
        } else {
          executorForkSimulation = await simulatePreparedTransaction(localUrl, row.wallet_address, {
            kind: 'morpho-executor-liquidation',
            label: 'Execute Morpho Blue liquidation and collateral unwind',
            to: deployment.address,
            value: '0',
            calldata: executeCalldata,
          });
        }
        if (executeCalldata) {
          executeCalldataStatus =
            executorForkSimulation.status === 'passed'
              ? 'fork-transaction-passed'
              : `fork-transaction-${executorForkSimulation.status}`;
        }
      }
    } catch (err) {
      executeCalldataStatus = 'failed';
      executorForkSimulation = {
        status: 'failed',
        reason: 'Morpho Blue executor rehearsal threw before completion',
        error: err.message,
      };
      console.log(`fork|morpho-executor|calldata|status=failed|error=${err.message}`);
    }

    executorForkPassed = executorForkSimulation.status === 'passed';
    morphoBlueExecutor = {
      ...morphoBlueExecutor,
      deploymentStatus: deployment ? 'passed' : morphoBlueExecutor.deploymentStatus,
      executor: deployment?.address ?? null,
      adapter: adapterDeployment?.address ?? null,
      funding,
      approvalResult,
      configResults,
      route,
      executeCalldataBytes: executeCalldata == null ? null : (executeCalldata.length - 2) / 2,
      executeCalldataPreview: executeCalldata == null ? null : calldataHead(executeCalldata),
      executeCalldataStatus,
      executorForkSimulation,
      missingFields: executeCalldataBuild.missingFields,
      error: executeCalldataBuild.error,
      params: {
        ...morphoBlueExecutor.params,
        unwindRouteLength: route.length,
      },
    };
    console.log(
      `fork|morpho-executor|calldata|unwindQuoteStatus=${collateralUnwindQuote.status}|executeCalldataBytes=${morphoBlueExecutor.executeCalldataBytes ?? 'none'}|executeCalldataStatus=${executeCalldataStatus}`,
    );
  }

  const reason = !liquidatable
    ? 'morpho-blue-liquidation-ltv-below-lltv'
    : !candidateGatePassed
      ? 'morpho-blue-liquidation-profitability-gate-blocked'
      : executorForkPassed
        ? 'morpho-blue-liquidation-executor-fork-simulation-passed'
        : collateralUnwindQuote.status !== 'quoted' && collateralUnwindQuote.status !== 'not-required'
          ? 'morpho-blue-liquidation-collateral-unwind-quote-required'
          : 'morpho-blue-liquidation-liquidatable-executor-simulation-not-passed';
  const forkPassedForGate = candidateGatePassed && executorForkPassed;
  const summary = `forkSimulation=${forkPassedForGate ? 'passed' : 'blocked'} mode=morpho-blue-liquidation-gate-check reason=${reason} ltv=${formatRay(
    ltvWad,
  )} lltv=${formatRay(lltv)} candidateGate=${candidateGate.status ?? 'unknown'} executorCalldataStatus=${morphoBlueExecutor.executeCalldataStatus} candidateId=${row.candidate_id}`;

  emitReport({
    kind: 'fork-simulation-report',
    status: forkPassedForGate ? 'passed' : 'failed',
    forkSimulation: forkPassedForGate ? 'passed' : 'blocked',
    mode: 'morpho-blue-liquidation-gate-check',
    reason,
    summary,
    runId: row.id,
    candidateId: row.candidate_id,
    chainId: row.chain_id,
    forkBlock: Number(BigInt(forkBlock)),
    borrower,
    morpho,
    marketId,
    latestMorphoData: {
      supplyShares: supplyShares.toString(),
      borrowShares: borrowShares.toString(),
      collateral: collateral.toString(),
      totalSupplyAssets: totalSupplyAssets.toString(),
      totalSupplyShares: totalSupplyShares.toString(),
      totalBorrowAssets: totalBorrowAssets.toString(),
      totalBorrowShares: totalBorrowShares.toString(),
      lastUpdate: lastUpdate.toString(),
      fee: fee.toString(),
      oracle,
      oraclePrice: price.toString(),
      borrowAssets: borrowAssets.toString(),
      collateralValueAssets: collateralValueAssets.toString(),
      maxBorrowAssets: maxBorrowAssets.toString(),
      ltvRaw: ltvWad.toString(),
      ltv: formatRay(ltvWad),
      lltvRaw: lltv.toString(),
      lltv: formatRay(lltv),
      liquidatable,
    },
    profitabilityGate: {
      status: candidateGate.status ?? 'unknown',
      reason: candidateGate.reason ?? null,
      minNetProfitUsd: candidateGate.minNetProfitUsd ?? null,
      minReturnOnRepayPct: candidateGate.minReturnOnRepayPct ?? null,
      bestEstimate: candidateBest,
    },
    collateralUnwindQuote,
    morphoBlueExecutor,
    artifactAccountData: candidate.account ?? null,
    liquidation: plan.liquidation ?? null,
    blockers: [
      !liquidatable
        ? 'Morpho Blue liquidate should not run unless borrow assets exceed collateral value times LLTV at execution block'
        : !candidateGatePassed
          ? `position is liquidatable, but candidate profitability gate is ${candidateGate.status ?? 'unknown'}: ${candidateGate.reason ?? 'missing reason'}`
          : executorForkPassed
            ? null
            : 'position is liquidatable, but the Morpho Blue executor fork transaction did not pass',
      !liquidatable
        ? 'collateral unwind quote was not attempted because the position is not liquidatable at the fork block'
        : collateralUnwindQuote.status !== 'quoted'
          ? `collateral unwind quote is not ready: ${collateralUnwindQuote.reason ?? collateralUnwindQuote.status}`
          : `collateral unwind quote observed; executor calldata status is ${morphoBlueExecutor.executeCalldataStatus}`,
      'production execution still requires a liquidation adapter, collateral unwind quote, callback/funding path, and revert-on-loss fork simulation',
    ].filter(Boolean),
    requirements: [
      'refresh Morpho position, market totals, oracle price, and LLTV immediately before signing',
      'build liquidate calldata only when the position is liquidatable at the execution block',
      'quote collateral unwind route and prove after-gas profit on the same fork block',
    ],
  });
  if (!forkPassedForGate) process.exitCode = 1;
}

async function cleanup() {
  if (anvil && !anvil.killed) {
    anvil.kill('SIGTERM');
    await sleep(500);
    if (!anvil.killed) anvil.kill('SIGKILL');
  }
}

process.on('SIGINT', () => cleanup().finally(() => process.exit(130)));
process.on('SIGTERM', () => cleanup().finally(() => process.exit(143)));

async function main() {
  const row = await queryRun(runId);
  if (!row) throw new Error(`live run not found: ${runId}`);
  const preflight = row.latest_preflight;
  const calls = preflight?.transactionPreview?.calls ?? [];
  if (preflight?.transactionPreview?.status !== 'ready' || calls.length === 0) {
    if (isDexDirectRouteCandidate(row)) {
      await runDexDirectRouteRehearsal(row);
      return;
    }
    if (isAaveLiquidationPlan(row)) {
      await runAaveLiquidationGateRehearsal(row);
      return;
    }
    if (isCompoundLiquidationPlan(row)) {
      await runCompoundLiquidationGateRehearsal(row);
      return;
    }
    if (isMorphoBlueLiquidationPlan(row)) {
      await runMorphoBlueLiquidationGateRehearsal(row);
      return;
    }
    if (isPureOnChainDryRunPlan(row.plan)) {
      emitReport(
        purePlanBlockedReport(row, 'pure-on-chain-plan-needs-calldata', preflight),
      );
      process.exitCode = 1;
      return;
    }
    throw new Error(preflight?.transactionPreview?.error ?? 'transaction preview is not ready');
  }
  const { localUrl, forkBlock } = await startFork(row);
  console.log(
    `fork=ready run=${row.id} chain=${row.chain_id} wallet=${row.wallet_address} block=${Number(
      BigInt(forkBlock),
    )} calls=${calls.length}`,
  );

  const results = [];
  for (const call of calls) {
    const tx = {
      from: row.wallet_address,
      to: call.to,
      value: callValue(call.value ?? '0'),
      data: call.calldata,
    };
    let gasHex;
    try {
      gasHex = await rpc(localUrl, 'eth_estimateGas', [tx]);
    } catch (err) {
      results.push({
        label: call.label,
        kind: call.kind,
        status: 'estimate-failed',
        error: err.message,
      });
      console.log(`fork|${call.kind}|${call.label}|status=estimate-failed|error=${err.message}`);
      break;
    }
    const hash = await rpc(localUrl, 'eth_sendTransaction', [{ ...tx, gas: bufferedGas(gasHex) }]);
    const receipt = await waitForReceipt(localUrl, hash);
    const ok = receipt.status === '0x1';
    results.push({
      label: call.label,
      kind: call.kind,
      status: ok ? 'passed' : 'reverted',
      hash,
      gasEstimate: BigInt(gasHex).toString(),
      gasUsed: BigInt(receipt.gasUsed ?? '0x0').toString(),
    });
    console.log(
      `fork|${call.kind}|${call.label}|status=${ok ? 'passed' : 'reverted'}|estimate=${BigInt(
        gasHex,
      )}|gasUsed=${BigInt(receipt.gasUsed ?? '0x0')}|hash=${hash}|calldata=${calldataHead(
        call.calldata,
      )}`,
    );
    if (!ok) break;
  }

  await rpc(localUrl, 'anvil_stopImpersonatingAccount', [row.wallet_address]).catch(() => {});
  const passed = results.length === calls.length && results.every((result) => result.status === 'passed');
  const totalGasUsed = results.reduce((sum, result) => sum + BigInt(result.gasUsed ?? '0'), 0n);
  const failed = results.find((result) => result.status !== 'passed');
  console.log(
    `forkSimulation=${passed ? 'passed' : 'failed'} calls=${results.length} totalGasUsed=${totalGasUsed} failedKind=${failed?.kind ?? 'none'} failedStatus=${failed?.status ?? 'none'} failedError=${failed?.error ?? 'none'}`,
  );
  if (!passed && !allowRevert) process.exitCode = 1;
}

main()
  .catch((err) => {
    emitReport({
      kind: 'fork-simulation-report',
      status: 'failed',
      forkSimulation: 'failed',
      mode: 'fork-simulation-script',
      reason: 'fork-simulation-script-error',
      summary: `forkSimulation=failed mode=fork-simulation-script reason=fork-simulation-script-error runId=${runId}`,
      runId,
      error: err.message,
      blockers: [
        'fork simulation script failed before a strategy-specific report could be emitted',
      ],
      requirements: [
        'retry after the fork RPC, DNS, Anvil process, and local dependency paths are healthy',
      ],
    });
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => cleanup());
