#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');

const PRICE_SELECTOR = '0x41976e09';
const CHAIN_PROFILES = {
  ethereum: {
    name: 'Ethereum',
    shortName: 'ethereum',
    chainId: 1,
    rpcEnvVar: 'RPC_ETHEREUM_URL',
  },
  base: {
    name: 'Base',
    shortName: 'base',
    chainId: 8453,
    rpcEnvVar: 'RPC_BASE_URL',
  },
};

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

function envNumber(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function hexStrip(hex) {
  return String(hex ?? '').replace(/^0x/i, '');
}

function decodeUint256(result) {
  const clean = hexStrip(result);
  if (clean.length < 64) return null;
  return BigInt(`0x${clean.slice(0, 64)}`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function rpc(url, method, params = []) {
  const controller = new AbortController();
  const timeoutMs = envNumber('MORPHO_ORACLE_DIAG_RPC_TIMEOUT_MS', 20_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: `${Date.now()}-${Math.random()}`, method, params }),
      signal: controller.signal,
    });
    let body;
    try {
      body = await res.json();
    } catch (err) {
      throw new Error(`${method}: invalid json response: ${err.message}`);
    }
    if (!res.ok || body.error) {
      const error = body.error ?? {};
      const message = error.message ?? `http ${res.status}`;
      const data = typeof error.data === 'string' ? error.data : JSON.stringify(error.data ?? null);
      const err = new Error(`${method}: ${message}`);
      err.rpcError = { code: error.code ?? null, message, data };
      throw err;
    }
    return body.result;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`${method}: timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function uniqueMarkets(watchlistArtifact, currentArtifact) {
  const markets = new Map();
  for (const item of watchlistArtifact.watchlist ?? []) {
    markets.set(item.marketId.toLowerCase(), {
      marketId: item.marketId,
      symbols: item.symbols,
      marketParams: item.marketParams,
      currentState: item.currentState,
      gate: item.profitability?.gate ?? null,
      source: 'watchlist',
    });
  }
  for (const candidate of currentArtifact.candidates ?? []) {
    const key = candidate.marketId?.toLowerCase();
    if (!key || markets.has(key)) continue;
    if (candidate.bestEstimate?.riskCategory !== 'liquidatable') continue;
    markets.set(key, {
      marketId: candidate.marketId,
      symbols: {
        loan: candidate.bestEstimate?.loanSymbol ?? null,
        collateral: candidate.bestEstimate?.collateralSymbol ?? null,
      },
      marketParams: candidate.marketParams,
      currentState: {
        riskCategory: candidate.bestEstimate?.riskCategory ?? null,
        ltv: candidate.account?.ltv ?? null,
        lltv: candidate.account?.lltv ?? null,
        liquidatable: candidate.account?.liquidatable ?? null,
        borrowUsd: candidate.bestEstimate?.borrowUsd ?? null,
        collateralUsd: candidate.bestEstimate?.collateralUsd ?? null,
      },
      gate: candidate.gate ?? null,
      source: 'current-liquidatable',
    });
  }
  return [...markets.values()];
}

async function diagnoseMarket(rpcUrl, market) {
  const oracle = market.marketParams?.oracle;
  if (!oracle) {
    return {
      ...market,
      oracleDiagnostic: {
        status: 'failed',
        reason: 'missing oracle address',
      },
    };
  }

  const diagnostic = {
    oracle,
    priceSelector: PRICE_SELECTOR,
    codeSizeBytes: null,
    priceCall: null,
  };

  try {
    const code = await rpc(rpcUrl, 'eth_getCode', [oracle, 'latest']);
    diagnostic.codeSizeBytes = hexStrip(code).length / 2;
    if (diagnostic.codeSizeBytes <= 0) {
      diagnostic.priceCall = {
        status: 'failed',
        reason: 'oracle has no bytecode at latest',
      };
      return { ...market, oracleDiagnostic: { status: 'failed', ...diagnostic } };
    }
  } catch (err) {
    diagnostic.codeCheckError = {
      message: err.message,
      rpcError: err.rpcError ?? null,
    };
    return { ...market, oracleDiagnostic: { status: 'failed', ...diagnostic } };
  }

  try {
    const result = await rpc(rpcUrl, 'eth_call', [{ to: oracle, data: PRICE_SELECTOR }, 'latest']);
    const price = decodeUint256(result);
    diagnostic.priceCall = {
      status: price && price > 0n ? 'passed' : 'failed',
      rawResult: result,
      decodedPrice: price?.toString() ?? null,
      reason: price && price > 0n ? 'oracle price() returned a positive value' : 'oracle price() returned zero or short data',
    };
  } catch (err) {
    diagnostic.priceCall = {
      status: 'failed',
      reason: err.message,
      rpcError: err.rpcError ?? null,
    };
  }

  return {
    ...market,
    oracleDiagnostic: {
      status: diagnostic.priceCall.status,
      ...diagnostic,
    },
  };
}

async function main() {
  loadDotenv();
  const chainKey = String(process.env.MORPHO_ORACLE_DIAG_CHAIN ?? process.env.MORPHO_WATCH_CHAIN ?? 'ethereum').toLowerCase();
  const chain = CHAIN_PROFILES[chainKey];
  if (!chain) throw new Error(`unsupported chain ${chainKey}`);
  const rpcUrl = process.env[chain.rpcEnvVar];
  if (!rpcUrl) throw new Error(`${chain.rpcEnvVar} is not configured`);

  const watchlistPath = resolve(dataDir, `morpho-blue-liquidation-watchlist-${chain.shortName}.json`);
  const currentPath = resolve(dataDir, `morpho-blue-liquidation-candidates-${chain.shortName}.json`);
  const outPath = resolve(dataDir, `morpho-blue-oracle-diagnostics-${chain.shortName}.json`);
  const [watchlistArtifact, currentArtifact] = await Promise.all([readJson(watchlistPath), readJson(currentPath)]);
  const markets = uniqueMarkets(watchlistArtifact, currentArtifact);
  const limit = envNumber('MORPHO_ORACLE_DIAG_LIMIT', markets.length);
  const selected = markets.slice(0, limit);
  const diagnostics = [];
  for (const market of selected) {
    diagnostics.push(await diagnoseMarket(rpcUrl, market));
  }

  const passed = diagnostics.filter((item) => item.oracleDiagnostic.status === 'passed');
  const failed = diagnostics.filter((item) => item.oracleDiagnostic.status !== 'passed');
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      chain,
      watchlistArtifact: watchlistPath,
      currentArtifact: currentPath,
    },
    methodology: {
      classification: 'morpho-blue-oracle-diagnostics',
      purpose: 'explain current-state Morpho liquidation gate blocks before any live execution is considered',
      oracleCheck: 'eth_getCode plus eth_call oracle.price() at latest block',
      priceSelector: PRICE_SELECTOR,
    },
    summary: {
      diagnosedMarketCount: diagnostics.length,
      passedOracleCount: passed.length,
      failedOracleCount: failed.length,
      liquidatableDiagnosedCount: diagnostics.filter((item) => item.currentState?.riskCategory === 'liquidatable').length,
      liquidatablePassedOracleCount: passed.filter((item) => item.currentState?.riskCategory === 'liquidatable').length,
      status:
        passed.some((item) => item.currentState?.riskCategory === 'liquidatable')
          ? 'found-liquidatable-markets-with-passing-oracle-check'
          : 'no-liquidatable-market-with-passing-oracle-check',
    },
    diagnostics,
  };
  await mkdir(dataDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    `morphoOracleDiagnostics=${artifact.summary.status} diagnosed=${diagnostics.length} passed=${passed.length} failed=${failed.length} liquidatablePassed=${artifact.summary.liquidatablePassedOracleCount} artifact=${outPath}`,
  );
  for (const item of diagnostics.slice(0, 10)) {
    console.log(
      `${item.marketId} ${item.symbols?.loan ?? '?'}-${item.symbols?.collateral ?? '?'} category=${item.currentState?.riskCategory ?? 'n/a'} oracle=${item.marketParams?.oracle} status=${item.oracleDiagnostic.status} reason=${item.oracleDiagnostic.priceCall?.reason ?? item.oracleDiagnostic.reason ?? 'n/a'}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
