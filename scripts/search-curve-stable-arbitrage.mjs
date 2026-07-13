#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');
const outJson = resolve(dataDir, 'curve-stable-arbitrage-candidates-ethereum.json');

const CHAIN = {
  name: 'Ethereum',
  shortName: 'ethereum',
  chainId: 1,
  rpcEnvVar: 'RPC_ETHEREUM_URL',
  nativePriceSymbol: 'WETH',
};

const CONTRACTS = {
  curve3pool: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7',
  uniswapV3QuoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  uniswapV3SwapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
};

const SELECTORS = {
  curveGetDyInt128: '0x5e0d443f',
  curveExchangeInt128: '0x3df02124',
  uniswapQuoteExactInputSingle: '0xc6a5026a',
  uniswapExactInputSingle: '0x414bf389',
};

const TOKENS = {
  DAI: {
    symbol: 'DAI',
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    decimals: 18,
    defaultAmount: '1000',
    curveIndex: 0,
  },
  USDC: {
    symbol: 'USDC',
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    decimals: 6,
    defaultAmount: '1000',
    curveIndex: 1,
  },
  USDT: {
    symbol: 'USDT',
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    decimals: 6,
    defaultAmount: '1000',
    curveIndex: 2,
  },
};

const PAIRS = [
  ['DAI', 'USDC'],
  ['USDC', 'DAI'],
  ['DAI', 'USDT'],
  ['USDT', 'DAI'],
  ['USDC', 'USDT'],
  ['USDT', 'USDC'],
];

const UNISWAP_FEE_TIERS = [100, 500, 3000, 10000];
const CURVE_API_URL = 'https://api.curve.fi/api/getPools/ethereum/main';
const CURVE_TOKEN_ALLOWLIST = new Set([
  'DAI',
  'USDC',
  'USDT',
  'FRAX',
  'CRVUSD',
  'GHO',
  'LUSD',
  'PYUSD',
  'USDD',
  'USDP',
  'USDE',
  'SUSDE',
  'TUSD',
]);
const OFFICIAL_REFERENCES = [
  'https://www.curve.finance/dex/ethereum/pools/3pool/',
  'https://api.curve.fi/api/getPools/ethereum/main',
  'https://docs.curve.finance/developer/amm/legacy/stableswap-overview',
  'https://docs.curve.finance/developer/amm/router/curve-router-ng',
  'https://docs.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments',
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
    // RPC can be passed through env in CI.
  }
}

function envNumber(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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

function encodeInt128(value) {
  const n = BigInt(value);
  if (n < 0n) throw new Error('negative int128 encoding is not needed here');
  return encodeUint(n);
}

function encodeAddress(addr) {
  return pad32(hexStrip(addr).toLowerCase());
}

function toBlockTag(n) {
  return `0x${BigInt(n).toString(16)}`;
}

function hexToBigInt(hex) {
  if (!hex || hex === '0x') return 0n;
  return BigInt(hex);
}

function parseUnits(value, decimals) {
  const [whole, frac = ''] = String(value).split('.');
  const padded = `${frac}${'0'.repeat(decimals)}`.slice(0, decimals);
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

function baseUnitsToNumber(value, decimals) {
  return Number(value) / 10 ** decimals;
}

function formatBaseUnits(value, decimals) {
  const neg = BigInt(value) < 0n;
  const abs = neg ? -BigInt(value) : BigInt(value);
  const raw = abs.toString().padStart(decimals + 1, '0');
  if (decimals === 0) return `${neg ? '-' : ''}${raw}`;
  const whole = raw.slice(0, -decimals) || '0';
  const fraction = raw.slice(-decimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${fraction ? `${whole}.${fraction}` : whole}`;
}

async function rpc(rpcUrl, method, params, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), envNumber('CURVE_ARB_RPC_TIMEOUT_MS', 20_000));
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: `${Date.now()}-${Math.random()}`, method, params }),
        signal: controller.signal,
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error?.message ?? `RPC ${method} ${res.status}`);
      return body.result;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(300 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function ethCall(rpcUrl, to, data, blockNumber) {
  return rpc(rpcUrl, 'eth_call', [{ to, data }, toBlockTag(blockNumber)]);
}

function encodeCurveGetDy(tokenIn, tokenOut, amountIn) {
  return (
    SELECTORS.curveGetDyInt128 +
    encodeInt128(tokenIn.curveIndex) +
    encodeInt128(tokenOut.curveIndex) +
    encodeUint(amountIn)
  );
}

async function quoteCurvePool(rpcUrl, tokenIn, tokenOut, amountIn, blockNumber) {
  const poolAddress = tokenIn.curvePoolAddress ?? CONTRACTS.curve3pool;
  const result = await ethCall(
    rpcUrl,
    poolAddress,
    encodeCurveGetDy(tokenIn, tokenOut, amountIn),
    blockNumber,
  );
  const amountOut = hexToBigInt(result);
  if (amountOut <= 0n) return null;
  return {
    dex: tokenIn.curveDexName ?? 'curve-3pool',
    amountOut,
    route: {
      pool: poolAddress,
      poolName: tokenIn.curvePoolName ?? 'Curve.fi DAI/USDC/USDT',
      i: tokenIn.curveIndex,
      j: tokenOut.curveIndex,
    },
  };
}

function encodeUniswapQuote(tokenIn, tokenOut, amountIn, fee) {
  return (
    SELECTORS.uniswapQuoteExactInputSingle +
    encodeAddress(tokenIn.address) +
    encodeAddress(tokenOut.address) +
    encodeUint(amountIn) +
    encodeUint(fee) +
    encodeUint(0n)
  );
}

function decodeUniswapQuote(result) {
  const clean = hexStrip(result);
  if (clean.length < 64) throw new Error('short Uniswap quote result');
  return BigInt(`0x${clean.slice(0, 64)}`);
}

async function quoteUniswapBest(rpcUrl, tokenIn, tokenOut, amountIn, blockNumber) {
  let best = null;
  for (const fee of UNISWAP_FEE_TIERS) {
    try {
      const result = await ethCall(
        rpcUrl,
        CONTRACTS.uniswapV3QuoterV2,
        encodeUniswapQuote(tokenIn, tokenOut, amountIn, fee),
        blockNumber,
      );
      const amountOut = decodeUniswapQuote(result);
      if (amountOut > 0n && (!best || amountOut > best.amountOut)) {
        best = { dex: 'uniswap-v3', amountOut, fee, route: { fee } };
      }
    } catch {
      // Missing pool or insufficient liquidity for this fee tier.
    }
  }
  return best;
}

function buildSampleBlocks(latestBlock, lookbackBlocks, sampleCount) {
  if (sampleCount <= 1) return [latestBlock];
  const from = Math.max(1, latestBlock - lookbackBlocks);
  const step = Math.max(1, Math.floor((latestBlock - from) / (sampleCount - 1)));
  const blocks = [];
  for (let i = 0; i < sampleCount; i += 1) {
    blocks.push(Math.min(latestBlock, from + i * step));
  }
  return [...new Set(blocks)];
}

function stats(values) {
  if (!values.length) return { min: null, max: null, mean: null, median: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return { min: sorted[0], max: sorted[sorted.length - 1], mean, median };
}

function annualizedPct(sampleNetReturnPct, intervalDays) {
  if (!Number.isFinite(sampleNetReturnPct) || !Number.isFinite(intervalDays) || intervalDays <= 0) {
    return null;
  }
  return sampleNetReturnPct * (365 / intervalDays);
}

function gateFor(metrics, minAnnualizedPct, minSamples, minWinRatePct) {
  if (metrics.sampleCount < minSamples) {
    return {
      status: 'block',
      reason: `insufficient quote samples: ${metrics.sampleCount}/${minSamples}`,
    };
  }
  if ((metrics.netWinRatePct ?? 0) < minWinRatePct) {
    return {
      status: 'block',
      reason: `net win rate ${metrics.netWinRatePct?.toFixed(2) ?? 'n/a'}% below ${minWinRatePct}%`,
    };
  }
  if ((metrics.meanAnnualizedNetReturnPct ?? -Infinity) < minAnnualizedPct) {
    return {
      status: 'block',
      reason: `mean annualized net return ${metrics.meanAnnualizedNetReturnPct?.toFixed(2) ?? 'n/a'}% below ${minAnnualizedPct}%`,
    };
  }
  if ((metrics.medianNetProfitUsd ?? -Infinity) <= 0) {
    return {
      status: 'block',
      reason: `median net profit ${metrics.medianNetProfitUsd?.toFixed(4) ?? 'n/a'} USD is not positive`,
    };
  }
  return {
    status: 'pass',
    reason: 'sample count, net win rate, median net profit, and annualized net return passed',
  };
}

async function fetchCurvePairsFromApi() {
  if (process.env.CURVE_ARB_STATIC_3POOL_ONLY === '1') return fallbackCurvePairs();
  const poolLimit = envNumber('CURVE_ARB_POOL_LIMIT', 6);
  const pairLimit = envNumber('CURVE_ARB_PAIR_LIMIT', 48);
  try {
    const res = await fetch(CURVE_API_URL);
    const json = await res.json();
    const pools = (json?.data?.poolData ?? [])
      .filter((pool) => !pool.isBroken && String(pool.assetTypeName ?? '').toLowerCase() === 'usd')
      .map(normalizeCurvePool)
      .filter((pool) => pool.tokens.length >= 2)
      .sort((a, b) => (b.usdTotal ?? 0) - (a.usdTotal ?? 0))
      .slice(0, poolLimit);
    const pairs = [];
    for (const pool of pools) {
      for (const startToken of pool.tokens) {
        for (const midToken of pool.tokens) {
          if (startToken.address.toLowerCase() === midToken.address.toLowerCase()) continue;
          pairs.push([startToken, midToken]);
          if (pairs.length >= pairLimit) return pairs;
        }
      }
    }
    return pairs.length ? pairs : fallbackCurvePairs();
  } catch {
    return fallbackCurvePairs();
  }
}

function normalizeCurvePool(pool) {
  const coins = Array.isArray(pool.coins) ? pool.coins : [];
  const tokens = coins
    .map((coin, index) => ({
      symbol: String(coin.symbol ?? '').trim(),
      address: String(coin.address ?? '').trim(),
      decimals: Number(coin.decimals),
      defaultAmount: defaultAmountForCurveToken(String(coin.symbol ?? '')),
      curveIndex: index,
      curvePoolAddress: pool.address,
      curvePoolName: pool.name ?? pool.symbol ?? pool.address,
      curveDexName: `curve-${slug(pool.symbol ?? pool.name ?? pool.id ?? pool.address)}`,
      usdPrice: Number(coin.usdPrice),
    }))
    .filter((token) => {
      if (!token.symbol || !token.address || token.address === '0x0000000000000000000000000000000000000000') {
        return false;
      }
      if (!Number.isFinite(token.decimals) || token.decimals < 0) return false;
      if (coins[token.curveIndex]?.isBasePoolLpToken) return false;
      return CURVE_TOKEN_ALLOWLIST.has(token.symbol.toUpperCase());
    });
  return {
    id: pool.id,
    name: pool.name ?? pool.symbol ?? pool.address,
    address: pool.address,
    usdTotal: Number(pool.usdTotal) || 0,
    tokens,
  };
}

function fallbackCurvePairs() {
  return PAIRS.map(([startSymbol, midSymbol]) => [TOKENS[startSymbol], TOKENS[midSymbol]]);
}

function defaultAmountForCurveToken(symbol) {
  const key = symbol.toUpperCase();
  if (key === 'SUSDE') return '100';
  return '1000';
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pool';
}

async function fetchTokenPrices(tokens) {
  const unique = [];
  const seen = new Set();
  for (const token of tokens) {
    const key = token.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(token);
  }
  const coins = [
    ...unique.map((token) => `ethereum:${token.address}`),
    'ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  ].join(',');
  const prices = {};
  try {
    const res = await fetch(`https://coins.llama.fi/prices/current/${coins}`);
    const json = await res.json();
    for (const token of unique) {
      const price = Number(json?.coins?.[`ethereum:${token.address}`]?.price);
      if (Number.isFinite(price) && price > 0) prices[token.symbol] = price;
    }
    const ethPrice = Number(
      json?.coins?.['ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2']?.price,
    );
    if (Number.isFinite(ethPrice) && ethPrice > 0) prices.WETH = ethPrice;
  } catch {
    // Explicit fallbacks below.
  }
  for (const token of unique) {
    if (!prices[token.symbol] && Number.isFinite(token.usdPrice) && token.usdPrice > 0) {
      prices[token.symbol] = token.usdPrice;
    }
    if (!prices[token.symbol]) prices[token.symbol] = 1;
  }
  if (!prices.WETH) prices.WETH = Number(process.env.CURVE_ARB_ETH_USD ?? 1760);
  return prices;
}

async function evaluateRoute({
  rpcUrl,
  startToken,
  midToken,
  firstDex,
  secondDex,
  amountIn,
  sampleBlocks,
  intervalDays,
  gasPriceWei,
  tokenPrices,
  gasUnits,
  minAnnualizedPct,
  minSamples,
  minWinRatePct,
}) {
  const samples = [];
  for (const blockNumber of sampleBlocks) {
    const startedAt = Date.now();
    let firstQuote = null;
    let secondQuote = null;
    let error = null;
    try {
      firstQuote =
        firstDex.startsWith('curve-')
          ? await quoteCurvePool(rpcUrl, startToken, midToken, amountIn, blockNumber)
          : await quoteUniswapBest(rpcUrl, startToken, midToken, amountIn, blockNumber);
      if (!firstQuote) throw new Error(`${firstDex} ${startToken.symbol}->${midToken.symbol} quote unavailable`);

      secondQuote =
        secondDex.startsWith('curve-')
          ? await quoteCurvePool(rpcUrl, midToken, startToken, firstQuote.amountOut, blockNumber)
          : await quoteUniswapBest(rpcUrl, midToken, startToken, firstQuote.amountOut, blockNumber);
      if (!secondQuote) throw new Error(`${secondDex} ${midToken.symbol}->${startToken.symbol} quote unavailable`);
    } catch (err) {
      error = err.message;
    }
    if (!firstQuote || !secondQuote) {
      samples.push({ blockNumber, status: 'missing-quote', error, latencyMs: Date.now() - startedAt });
      continue;
    }

    const grossProfitBaseUnits = secondQuote.amountOut - amountIn;
    const startTokenPriceUsd = tokenPrices[startToken.symbol] ?? 1;
    const ethUsd = tokenPrices.WETH ?? 1760;
    const grossProfitUsd = baseUnitsToNumber(grossProfitBaseUnits, startToken.decimals) * startTokenPriceUsd;
    const gasUsd = (Number(gasPriceWei) * gasUnits * ethUsd) / 1e18;
    const netProfitUsd = grossProfitUsd - gasUsd;
    const amountInUsd = baseUnitsToNumber(amountIn, startToken.decimals) * startTokenPriceUsd;
    const grossReturnPct = amountInUsd === 0 ? null : (grossProfitUsd / amountInUsd) * 100;
    const netReturnPct = amountInUsd === 0 ? null : (netProfitUsd / amountInUsd) * 100;

    samples.push({
      blockNumber,
      status: 'quoted',
      firstDex,
      secondDex,
      firstRoute: firstQuote.route,
      secondRoute: secondQuote.route,
      amountIn: amountIn.toString(),
      amountInHuman: formatBaseUnits(amountIn, startToken.decimals),
      midAmount: firstQuote.amountOut.toString(),
      midAmountHuman: formatBaseUnits(firstQuote.amountOut, midToken.decimals),
      amountOut: secondQuote.amountOut.toString(),
      amountOutHuman: formatBaseUnits(secondQuote.amountOut, startToken.decimals),
      grossProfitBaseUnits: grossProfitBaseUnits.toString(),
      grossProfitHuman: formatBaseUnits(grossProfitBaseUnits, startToken.decimals),
      grossProfitUsd,
      gasUsd,
      netProfitUsd,
      grossReturnPct,
      netReturnPct,
      annualizedNetReturnPct: netReturnPct == null ? null : annualizedPct(netReturnPct, intervalDays),
      latencyMs: Date.now() - startedAt,
    });
  }

  const quoted = samples.filter((s) => s.status === 'quoted');
  const netProfits = quoted.map((s) => s.netProfitUsd).filter((v) => Number.isFinite(v));
  const grossProfits = quoted.map((s) => s.grossProfitUsd).filter((v) => Number.isFinite(v));
  const annualizedReturns = quoted
    .map((s) => s.annualizedNetReturnPct)
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  const netReturns = quoted
    .map((s) => s.netReturnPct)
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  const metrics = {
    sampleCount: quoted.length,
    attemptedSamples: samples.length,
    missingQuoteSamples: samples.length - quoted.length,
    amountInUsd: baseUnitsToNumber(amountIn, startToken.decimals) * (tokenPrices[startToken.symbol] ?? 1),
    grossProfitUsd: stats(grossProfits),
    netProfitUsd: stats(netProfits),
    netReturnPct: stats(netReturns),
    annualizedNetReturnPct: stats(annualizedReturns),
    medianNetProfitUsd: stats(netProfits).median,
    meanAnnualizedNetReturnPct: stats(annualizedReturns).mean,
    netWinRatePct: quoted.length
      ? (quoted.filter((s) => (s.netProfitUsd ?? -Infinity) > 0).length / quoted.length) * 100
      : 0,
  };
  const gate = gateFor(metrics, minAnnualizedPct, minSamples, minWinRatePct);
  const curvePoolSlug = slug(startToken.curvePoolName ?? startToken.curveDexName ?? '3pool');
  const routeSlug = `${firstDex.replace(/[^a-z0-9]/g, '')}-to-${secondDex.replace(/[^a-z0-9]/g, '')}`;
  return {
    id: `curve-eth-${curvePoolSlug}-${startToken.symbol.toLowerCase()}-${midToken.symbol.toLowerCase()}-${routeSlug}-${formatBaseUnits(amountIn, startToken.decimals).replace(/[^0-9a-z]+/gi, '-')}`,
    chain: CHAIN.name,
    strategyType: 'curve-stableswap-dex-arbitrage',
    isPureArbitrage: true,
    noCexRequired: true,
    startToken: {
      symbol: startToken.symbol,
      address: startToken.address,
      decimals: startToken.decimals,
    },
    midToken: {
      symbol: midToken.symbol,
      address: midToken.address,
      decimals: midToken.decimals,
    },
    buyDex: firstDex,
    sellDex: secondDex,
    dexPath: [firstDex, secondDex],
    tokenPath: [startToken.symbol, midToken.symbol, startToken.symbol],
    amountIn: amountIn.toString(),
    amountInHuman: formatBaseUnits(amountIn, startToken.decimals),
    metrics,
    gate: {
      ...gate,
      minAnnualizedNetReturnPct: minAnnualizedPct,
      minSamples,
      minWinRatePct,
    },
    liveInterface: {
      status: gate.status === 'pass' ? 'quote-ready-needs-fork-execution-adapter' : 'blocked-by-backtest',
      requiresCex: false,
      userFlow:
        'connect wallet, approve start token, execute atomic Curve/Uniswap route only after same-block fork simulation',
      requiredContracts: {
        curvePool: startToken.curvePoolAddress ?? CONTRACTS.curve3pool,
        uniswapV3SwapRouter02: CONTRACTS.uniswapV3SwapRouter02,
        atomicExecutor: process.env.CURVE_ARB_EXECUTOR_ADDRESS ?? null,
      },
      selectors: {
        curveExchange: SELECTORS.curveExchangeInt128,
        uniswapExactInputSingle: SELECTORS.uniswapExactInputSingle,
      },
      blocker:
        gate.status === 'pass'
          ? 'strategy still requires deployed atomic executor, loss-reverting fork simulation, and private execution policy'
          : 'quote replay gate did not pass',
    },
    samples,
  };
}

function sortCandidate(a, b) {
  const gateBonus = (c) => (c.gate.status === 'pass' ? 1_000_000 : 0);
  return (
    gateBonus(b) -
    gateBonus(a) +
    ((b.metrics.medianNetProfitUsd ?? -Infinity) - (a.metrics.medianNetProfitUsd ?? -Infinity))
  );
}

async function main() {
  loadDotenv();
  const rpcUrl = process.env[CHAIN.rpcEnvVar];
  if (!rpcUrl) {
    throw new Error(`${CHAIN.rpcEnvVar} is required. Add it to .env or export it before running.`);
  }

  const latestBlock = Number(hexToBigInt(await rpc(rpcUrl, 'eth_blockNumber', [])));
  const lookbackBlocks = envNumber('CURVE_ARB_LOOKBACK_BLOCKS', 600);
  const sampleCount = envNumber('CURVE_ARB_SAMPLE_COUNT', 3);
  const minSamples = envNumber('CURVE_ARB_MIN_SAMPLES', Math.min(3, sampleCount));
  const minAnnualizedPct = envNumber('CURVE_ARB_MIN_ANNUALIZED_PCT', 20);
  const minWinRatePct = envNumber('CURVE_ARB_MIN_WIN_RATE_PCT', 80);
  const gasUnits = envNumber('CURVE_ARB_GAS_UNITS', 320_000);
  const maxStrategies = envNumber('CURVE_ARB_MAX_STRATEGIES', 72);
  const amountMultipliers = String(process.env.CURVE_ARB_AMOUNT_MULTIPLIERS ?? '0.1,0.5,1,2,5,10')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const sampleBlocks = buildSampleBlocks(latestBlock, lookbackBlocks, sampleCount);
  const intervalDays = Math.max(1 / 24, (lookbackBlocks * 12) / 86_400);
  const gasPriceWei = hexToBigInt(await rpc(rpcUrl, 'eth_gasPrice', []));
  const curvePairs = await fetchCurvePairsFromApi();
  const tokenPrices = await fetchTokenPrices(curvePairs.flatMap(([startToken, midToken]) => [startToken, midToken]));

  console.log(
    `[curve-arb] chain=${CHAIN.name} latest=${latestBlock} samples=${sampleBlocks.join(',')} pairs=${curvePairs.length}`,
  );

  const candidates = [];
  for (const [startToken, midToken] of curvePairs) {
    for (const multiplier of amountMultipliers) {
      const amountIn = parseUnits(String(Number(startToken.defaultAmount) * multiplier), startToken.decimals);
      const curveDex = startToken.curveDexName ?? 'curve-3pool';
      for (const [firstDex, secondDex] of [
        [curveDex, 'uniswap-v3'],
        ['uniswap-v3', curveDex],
      ]) {
        const candidate = await evaluateRoute({
          rpcUrl,
          startToken,
          midToken,
          firstDex,
          secondDex,
          amountIn,
          sampleBlocks,
          intervalDays,
          gasPriceWei,
          tokenPrices,
          gasUnits,
          minAnnualizedPct,
          minSamples,
          minWinRatePct,
        });
        candidates.push(candidate);
        console.log(
          `[curve-arb] ${candidate.id} gate=${candidate.gate.status} samples=${candidate.metrics.sampleCount}/${candidate.metrics.attemptedSamples} win=${candidate.metrics.netWinRatePct?.toFixed(2)} annualized=${candidate.metrics.meanAnnualizedNetReturnPct?.toFixed(2) ?? 'n/a'} medianNetUsd=${candidate.metrics.medianNetProfitUsd?.toFixed(6) ?? 'n/a'} reason=${candidate.gate.reason}`,
        );
        if (candidates.length >= maxStrategies) break;
      }
      if (candidates.length >= maxStrategies) break;
    }
    if (candidates.length >= maxStrategies) break;
  }

  candidates.sort(sortCandidate);
  const passing = candidates.filter((c) => c.gate.status === 'pass');
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      chain: CHAIN,
      officialReferences: OFFICIAL_REFERENCES,
      rpcEnvVar: CHAIN.rpcEnvVar,
      blockWindow: {
        latestBlock,
        lookbackBlocks,
        sampleBlocks,
        intervalDays,
      },
      contracts: CONTRACTS,
      curvePoolDiscovery: {
        api: CURVE_API_URL,
        pairCount: curvePairs.length,
        static3poolOnly: process.env.CURVE_ARB_STATIC_3POOL_ONLY === '1',
      },
    },
    methodology: {
      classification: 'pure on-chain Curve stablecoin arbitrage quote replay',
      isPureArbitrage: true,
      requiresCex: false,
      description:
        'Quote-replays atomic two-leg routes between Curve stable pools and Uniswap V3 using historical eth_call samples, then subtracts estimated gas.',
      gate: {
        minSamples,
        minAnnualizedPct,
        minWinRatePct,
        medianNetProfitUsdMustBePositive: true,
      },
      caveats: [
        'Quote replay is not execution proof; same-block fork simulation is required before live use.',
        'Public stablecoin arbitrage is MEV-competitive and can disappear before a public transaction lands.',
        'Annualized returns are an evidence metric over sampled opportunities, not a guaranteed user APY.',
        'USDT transfer behavior and Curve pool-specific exchange selectors must be fork-tested before execution.',
      ],
    },
    summary: {
      candidateCount: candidates.length,
      passingCount: passing.length,
      requestedPassingCount: 5,
      status:
        passing.length >= 5
          ? 'found-at-least-five-passing-curve-stable-arbitrage-backtests'
          : 'did-not-find-five-passing-curve-stable-arbitrage-backtests',
    },
    candidates,
  };

  await mkdir(dataDir, { recursive: true });
  await writeFile(outJson, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`[curve-arb] wrote ${outJson}`);
  console.log(
    `[curve-arb] status=${artifact.summary.status} total=${candidates.length} passing=${passing.length}`,
  );
}

main().catch((err) => {
  console.error('[curve-arb] failed', err);
  process.exit(1);
});
