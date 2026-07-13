#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');
const outJson = resolve(dataDir, 'balancer-arbitrage-candidates-ethereum.json');

const CHAIN = {
  name: 'Ethereum',
  shortName: 'ethereum',
  chainId: 1,
  rpcEnvVar: 'RPC_ETHEREUM_URL',
  nativePriceSymbol: 'WETH',
};

const CONTRACTS = {
  balancerV2Vault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  uniswapV3QuoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  uniswapV3SwapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
};

const SELECTORS = {
  balancerQueryBatchSwap: '0xf84d066e',
  balancerSwap: '0x52bbbe29',
  uniswapQuoteExactInputSingle: '0xc6a5026a',
  uniswapExactInputSingle: '0x414bf389',
};

const UNISWAP_FEE_TIERS = [100, 500, 3000, 10000];
const ZERO_DATA_WORD = '0'.repeat(64);
const QUERY_SENDER = '0x0000000000000000000000000000000000000001';
const MAJOR_SECONDARY_MARKET_SYMBOLS = new Set([
  'WETH',
  'WBTC',
  'USDC',
  'USDT',
  'DAI',
  'BAL',
]);
const OFFICIAL_REFERENCES = [
  'https://docs.balancer.fi/concepts/explore-available-balancer-pools/intro.html',
  'https://docs-v2.balancer.fi/reference/contracts/apis/vault.html',
  'https://docs-v2.balancer.fi/reference/swaps/batch-swaps.html',
  'https://docs.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments',
];

const STATIC_FALLBACK_POOLS = [
  {
    id: '0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014',
    type: 'WEIGHTED',
    dynamicData: { totalLiquidity: '3821040', swapFee: '0.01' },
    poolTokens: [
      {
        address: '0xba100000625a3754423978a60c9317c58a424e3d',
        symbol: 'BAL',
        decimals: 18,
        weight: '0.8',
      },
      {
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        symbol: 'WETH',
        decimals: 18,
        weight: '0.2',
      },
    ],
  },
  {
    id: '0xa6f548df93de924d73be7d25dc02554c6bd66db500020000000000000000000e',
    type: 'WEIGHTED',
    dynamicData: { totalLiquidity: '1424982', swapFee: '0.0025' },
    poolTokens: [
      {
        address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
        symbol: 'WBTC',
        decimals: 8,
        weight: '0.5',
      },
      {
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        symbol: 'WETH',
        decimals: 18,
        weight: '0.5',
      },
    ],
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
  const n = BigInt(value);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const raw = abs.toString().padStart(decimals + 1, '0');
  if (decimals === 0) return `${neg ? '-' : ''}${raw}`;
  const whole = raw.slice(0, -decimals) || '0';
  const fraction = raw.slice(-decimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${fraction ? `${whole}.${fraction}` : whole}`;
}

function signedWordToBigInt(word) {
  const value = BigInt(`0x${word}`);
  const limit = 1n << 255n;
  return value >= limit ? value - (1n << 256n) : value;
}

async function rpc(rpcUrl, method, params, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), envNumber('BALANCER_ARB_RPC_TIMEOUT_MS', 20_000));
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
      encodeAddress(QUERY_SENDER),
      encodeUint(0n),
      encodeAddress(QUERY_SENDER),
      encodeUint(0n),
      ...swaps,
      ...assets,
    ].join('')
  );
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

async function quoteBalancer(rpcUrl, pool, tokenIn, tokenOut, amountIn, blockNumber) {
  const result = await ethCall(
    rpcUrl,
    CONTRACTS.balancerV2Vault,
    encodeBalancerQueryBatchSwap(pool.id, tokenIn, tokenOut, amountIn),
    blockNumber,
  );
  const deltas = decodeIntArray(result);
  const outDelta = deltas[1] ?? 0n;
  const amountOut = outDelta < 0n ? -outDelta : 0n;
  if (amountOut <= 0n) return null;
  return {
    dex: 'balancer-v2',
    amountOut,
    route: {
      vault: CONTRACTS.balancerV2Vault,
      poolId: pool.id,
      poolType: pool.type,
      swapFee: pool.dynamicData?.swapFee ?? null,
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

async function fetchBalancerPools() {
  const limit = envNumber('BALANCER_ARB_POOL_FETCH_LIMIT', 40);
  const query = `query Pools($first: Int!) {
    aggregatorPools(first: $first, where: {chainIn: [MAINNET], protocolVersionIn: [2]}) {
      id
      type
      poolTokens {
        address
        symbol
        decimals
        weight
      }
      dynamicData {
        totalLiquidity
        swapFee
      }
    }
  }`;
  try {
    const res = await fetch('https://api-v3.balancer.fi/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { first: limit } }),
    });
    const json = await res.json();
    const pools = json?.data?.aggregatorPools;
    if (Array.isArray(pools) && pools.length) return pools;
  } catch {
    // Fallback below.
  }
  return STATIC_FALLBACK_POOLS;
}

function normalizePool(pool) {
  const tokens = (pool.poolTokens ?? [])
    .filter((token) => token.address && token.symbol && Number.isFinite(Number(token.decimals)))
    .map((token) => ({
      symbol: String(token.symbol).replace(/^WETH$/i, 'WETH'),
      address: String(token.address),
      decimals: Number(token.decimals),
      weight: token.weight ?? null,
    }));
  return {
    id: pool.id,
    type: pool.type ?? 'UNKNOWN',
    dynamicData: pool.dynamicData ?? {},
    poolTokens: tokens,
  };
}

function hasMajorSecondaryMarket(pool) {
  return pool.poolTokens.some((token) =>
    MAJOR_SECONDARY_MARKET_SYMBOLS.has(token.symbol.toUpperCase()),
  );
}

function tokenAllowlist() {
  return new Set(
    String(process.env.BALANCER_ARB_TOKEN_ALLOWLIST ?? 'WETH,WBTC,BAL,USDC,USDT,DAI')
      .split(',')
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean),
  );
}

function poolMatchesTokenAllowlist(pool, allowlist) {
  if (!allowlist.size) return true;
  return pool.poolTokens.every((token) => allowlist.has(token.symbol.toUpperCase()));
}

function defaultAmountForToken(token) {
  const symbol = token.symbol.toUpperCase();
  if (symbol.includes('BTC')) return '0.05';
  if (symbol === 'WETH' || symbol === 'ETH' || symbol.includes('STETH') || symbol.includes('RETH')) return '1';
  if (symbol === 'BAL') return '500';
  if (symbol === 'AAVE') return '20';
  if (symbol === 'MKR') return '1';
  return '1000';
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

async function fetchTokenPrices(tokens) {
  const unique = [];
  const seen = new Set();
  for (const token of tokens) {
    const key = token.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(token);
  }
  const coins = unique.map((token) => `ethereum:${token.address}`).join(',');
  const prices = {};
  try {
    const res = await fetch(`https://coins.llama.fi/prices/current/${coins}`);
    const json = await res.json();
    for (const token of unique) {
      const price = Number(json?.coins?.[`ethereum:${token.address}`]?.price);
      if (Number.isFinite(price) && price > 0) prices[token.address.toLowerCase()] = price;
    }
  } catch {
    // Explicit fallbacks below.
  }
  for (const token of unique) {
    const key = token.address.toLowerCase();
    const symbol = token.symbol.toUpperCase();
    if (prices[key]) continue;
    if (['USDC', 'USDT', 'DAI', 'LUSD', 'GHO', 'FRAX', 'USDE', 'SUSDE'].includes(symbol)) prices[key] = 1;
    else if (symbol === 'WETH' || symbol === 'ETH' || symbol.includes('STETH') || symbol.includes('RETH')) {
      prices[key] = Number(process.env.BALANCER_ARB_ETH_USD ?? 1760);
    } else if (symbol.includes('BTC')) prices[key] = Number(process.env.BALANCER_ARB_BTC_USD ?? 110000);
  }
  return prices;
}

async function evaluateRoute({
  rpcUrl,
  pool,
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
        firstDex === 'balancer-v2'
          ? await quoteBalancer(rpcUrl, pool, startToken, midToken, amountIn, blockNumber)
          : await quoteUniswapBest(rpcUrl, startToken, midToken, amountIn, blockNumber);
      if (!firstQuote) throw new Error(`${firstDex} ${startToken.symbol}->${midToken.symbol} quote unavailable`);

      secondQuote =
        secondDex === 'balancer-v2'
          ? await quoteBalancer(rpcUrl, pool, midToken, startToken, firstQuote.amountOut, blockNumber)
          : await quoteUniswapBest(rpcUrl, midToken, startToken, firstQuote.amountOut, blockNumber);
      if (!secondQuote) throw new Error(`${secondDex} ${midToken.symbol}->${startToken.symbol} quote unavailable`);
    } catch (err) {
      error = err.message;
    }
    if (!firstQuote || !secondQuote) {
      samples.push({ blockNumber, status: 'missing-quote', error, latencyMs: Date.now() - startedAt });
      continue;
    }

    const price = tokenPrices[startToken.address.toLowerCase()] ?? null;
    const ethPrice = tokenPrices['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'] ?? 1760;
    const grossProfitBaseUnits = secondQuote.amountOut - amountIn;
    const grossProfitUsd =
      price == null ? null : baseUnitsToNumber(grossProfitBaseUnits, startToken.decimals) * price;
    const gasUsd = (Number(gasPriceWei) * gasUnits * ethPrice) / 1e18;
    const netProfitUsd = grossProfitUsd == null ? null : grossProfitUsd - gasUsd;
    const amountInUsd = price == null ? null : baseUnitsToNumber(amountIn, startToken.decimals) * price;
    const grossReturnPct =
      amountInUsd == null || amountInUsd === 0 || grossProfitUsd == null
        ? null
        : (grossProfitUsd / amountInUsd) * 100;
    const netReturnPct =
      amountInUsd == null || amountInUsd === 0 || netProfitUsd == null
        ? null
        : (netProfitUsd / amountInUsd) * 100;

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
  const netProfits = quoted.map((s) => s.netProfitUsd).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const grossProfits = quoted
    .map((s) => s.grossProfitUsd)
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
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
    amountInUsd:
      tokenPrices[startToken.address.toLowerCase()] == null
        ? null
        : baseUnitsToNumber(amountIn, startToken.decimals) * tokenPrices[startToken.address.toLowerCase()],
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
  const routeSlug = `${firstDex.replace(/[^a-z0-9]/g, '')}-to-${secondDex.replace(/[^a-z0-9]/g, '')}`;
  const amountSlug = formatBaseUnits(amountIn, startToken.decimals).replace(/[^0-9a-z]+/gi, '-');
  return {
    id: `balancer-eth-${startToken.symbol.toLowerCase()}-${midToken.symbol.toLowerCase()}-${routeSlug}-${amountSlug}`,
    chain: CHAIN.name,
    strategyType: 'balancer-v2-dex-arbitrage',
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
    pool: {
      id: pool.id,
      type: pool.type,
      totalLiquidityUsd: Number(pool.dynamicData?.totalLiquidity ?? NaN) || null,
      swapFee: pool.dynamicData?.swapFee ?? null,
      tokens: pool.poolTokens,
    },
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
        'connect wallet, approve start token, execute atomic Balancer/Uniswap route only after same-block fork simulation',
      requiredContracts: {
        balancerV2Vault: CONTRACTS.balancerV2Vault,
        uniswapV3SwapRouter02: CONTRACTS.uniswapV3SwapRouter02,
        atomicExecutor: process.env.BALANCER_ARB_EXECUTOR_ADDRESS ?? process.env.DEX_ARB_EXECUTOR_ADDRESS ?? null,
      },
      selectors: {
        balancerSwap: SELECTORS.balancerSwap,
        uniswapExactInputSingle: SELECTORS.uniswapExactInputSingle,
      },
      blocker:
        gate.status === 'pass'
          ? 'strategy still requires deployed atomic executor, Balancer adapter, and loss-reverting fork simulation'
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
  const lookbackBlocks = envNumber('BALANCER_ARB_LOOKBACK_BLOCKS', 600);
  const sampleCount = envNumber('BALANCER_ARB_SAMPLE_COUNT', 3);
  const minSamples = envNumber('BALANCER_ARB_MIN_SAMPLES', Math.min(3, sampleCount));
  const minAnnualizedPct = envNumber('BALANCER_ARB_MIN_ANNUALIZED_PCT', 20);
  const minWinRatePct = envNumber('BALANCER_ARB_MIN_WIN_RATE_PCT', 80);
  const gasUnits = envNumber('BALANCER_ARB_GAS_UNITS', 420_000);
  const maxStrategies = envNumber('BALANCER_ARB_MAX_STRATEGIES', 40);
  const pairLimit = envNumber('BALANCER_ARB_PAIR_LIMIT', 12);
  const amountMultipliers = String(process.env.BALANCER_ARB_AMOUNT_MULTIPLIERS ?? '0.1,1,5')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const sampleBlocks = buildSampleBlocks(latestBlock, lookbackBlocks, sampleCount);
  const intervalDays = Math.max(1 / 24, (lookbackBlocks * 12) / 86_400);
  const gasPriceWei = hexToBigInt(await rpc(rpcUrl, 'eth_gasPrice', []));

  const includeExotic = process.env.BALANCER_ARB_INCLUDE_EXOTIC === '1';
  const allowlist = tokenAllowlist();
  const pools = (await fetchBalancerPools())
    .map(normalizePool)
    .filter((pool) => pool.id && pool.poolTokens.length === 2)
    .filter((pool) => includeExotic || hasMajorSecondaryMarket(pool))
    .filter((pool) => includeExotic || poolMatchesTokenAllowlist(pool, allowlist))
    .sort(
      (a, b) =>
        (Number(b.dynamicData?.totalLiquidity ?? 0) || 0) -
        (Number(a.dynamicData?.totalLiquidity ?? 0) || 0),
    )
    .slice(0, pairLimit);
  const allTokens = pools.flatMap((pool) => pool.poolTokens);
  const tokenPrices = await fetchTokenPrices([
    ...allTokens,
    {
      symbol: 'WETH',
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      decimals: 18,
    },
  ]);

  console.log(
    `[balancer-arb] chain=${CHAIN.name} latest=${latestBlock} samples=${sampleBlocks.join(',')} pools=${pools.length}`,
  );

  const candidates = [];
  for (const pool of pools) {
    const [a, b] = pool.poolTokens;
    const directions = [
      [a, b],
      [b, a],
    ];
    for (const [startToken, midToken] of directions) {
      for (const multiplier of amountMultipliers) {
        const amountIn = parseUnits(
          String(Number(defaultAmountForToken(startToken)) * multiplier),
          startToken.decimals,
        );
        for (const [firstDex, secondDex] of [
          ['balancer-v2', 'uniswap-v3'],
          ['uniswap-v3', 'balancer-v2'],
        ]) {
          const candidate = await evaluateRoute({
            rpcUrl,
            pool,
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
            `[balancer-arb] ${candidate.id} gate=${candidate.gate.status} samples=${candidate.metrics.sampleCount}/${candidate.metrics.attemptedSamples} win=${candidate.metrics.netWinRatePct?.toFixed(2)} annualized=${candidate.metrics.meanAnnualizedNetReturnPct?.toFixed(2) ?? 'n/a'} medianNetUsd=${candidate.metrics.medianNetProfitUsd?.toFixed(6) ?? 'n/a'} reason=${candidate.gate.reason}`,
          );
          if (candidates.length >= maxStrategies) break;
        }
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
      balancerApi: 'https://api-v3.balancer.fi/',
      rpcEnvVar: CHAIN.rpcEnvVar,
      blockWindow: {
        latestBlock,
        lookbackBlocks,
        sampleBlocks,
        intervalDays,
      },
      contracts: CONTRACTS,
      poolCount: pools.length,
    },
    methodology: {
      classification: 'pure on-chain Balancer V2 versus Uniswap V3 quote replay',
      isPureArbitrage: true,
      requiresCex: false,
      description:
        'Discovers high-liquidity Balancer V2 two-token pools, quote-replays Balancer Vault queryBatchSwap against Uniswap V3 quotes, and subtracts estimated gas.',
      gate: {
        minSamples,
        minAnnualizedPct,
        minWinRatePct,
        medianNetProfitUsdMustBePositive: true,
      },
      caveats: [
        'Quote replay is not execution proof; same-block fork simulation is required before live use.',
        'Balancer API pool discovery is current-state metadata; historical quotes still come from archive eth_call samples.',
        'Public Balancer/Uniswap arbitrage is MEV-competitive and can disappear before a public transaction lands.',
        'Annualized returns are an evidence metric over sampled opportunities, not a guaranteed user APY.',
      ],
    },
    summary: {
      candidateCount: candidates.length,
      passingCount: passing.length,
      requestedPassingCount: 5,
      status:
        passing.length >= 5
          ? 'found-at-least-five-passing-balancer-arbitrage-backtests'
          : 'did-not-find-five-passing-balancer-arbitrage-backtests',
    },
    candidates,
  };

  await mkdir(dataDir, { recursive: true });
  await writeFile(outJson, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`[balancer-arb] wrote ${outJson}`);
  console.log(
    `[balancer-arb] status=${artifact.summary.status} total=${candidates.length} passing=${passing.length}`,
  );
}

main().catch((err) => {
  console.error('[balancer-arb] failed', err);
  process.exit(1);
});
