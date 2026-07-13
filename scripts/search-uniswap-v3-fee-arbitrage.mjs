#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');

let CHAIN = {
  name: 'Base',
  shortName: 'base',
  chainId: 8453,
  rpcEnvVar: 'RPC_BASE_URL',
  nativePriceSymbol: 'WETH',
};

let CONTRACTS = {
  uniswapV3QuoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
  uniswapV3SwapRouter02: '0x2626664c2603336E57B271c5C0b26F421741e481',
};

let TOKENS = {
  USDC: {
    symbol: 'USDC',
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6,
    defaultAmount: '1000',
  },
  WETH: {
    symbol: 'WETH',
    address: '0x4200000000000000000000000000000000000006',
    decimals: 18,
    defaultAmount: '1',
  },
  cbBTC: {
    symbol: 'cbBTC',
    address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    decimals: 8,
    defaultAmount: '0.05',
  },
  cbETH: {
    symbol: 'cbETH',
    address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
    decimals: 18,
    defaultAmount: '1',
  },
  EURC: {
    symbol: 'EURC',
    address: '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42',
    decimals: 6,
    defaultAmount: '1000',
  },
};

let PAIRS = [
  ['USDC', 'WETH'],
  ['WETH', 'USDC'],
  ['USDC', 'cbBTC'],
  ['cbBTC', 'USDC'],
  ['WETH', 'cbETH'],
  ['USDC', 'EURC'],
];

const SELECTORS = {
  uniswapQuoteExactInputSingle: '0xc6a5026a',
  uniswapExactInputSingle: '0x04e45aaf',
};

const UNISWAP_FEE_TIERS = [100, 500, 3000, 10000];
const REQUESTED_PASSING = 5;
const MIN_ANNUALIZED_NET_RETURN_PCT = 20;

let outJson = resolve(dataDir, 'uniswap-v3-fee-arbitrage-candidates-base.json');

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
    // Scripts also run in CI with exported env vars.
  }
}

function selectChainProfile() {
  const key = String(process.env.UNI_FEE_ARB_CHAIN ?? 'base').toLowerCase();
  outJson = resolve(dataDir, `uniswap-v3-fee-arbitrage-candidates-${key}.json`);
  if (key === 'base') return;
  if (key === 'ethereum' || key === 'eth' || key === 'mainnet') {
    CHAIN = {
      name: 'Ethereum',
      shortName: 'ethereum',
      chainId: 1,
      rpcEnvVar: 'RPC_ETHEREUM_URL',
      nativePriceSymbol: 'WETH',
    };
    CONTRACTS = {
      uniswapV3QuoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      uniswapV3SwapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    };
    TOKENS = {
      USDC: {
        symbol: 'USDC',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        decimals: 6,
        defaultAmount: '1000',
      },
      WETH: {
        symbol: 'WETH',
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        decimals: 18,
        defaultAmount: '1',
      },
      WBTC: {
        symbol: 'WBTC',
        address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        decimals: 8,
        defaultAmount: '0.05',
      },
      USDT: {
        symbol: 'USDT',
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        decimals: 6,
        defaultAmount: '1000',
      },
      DAI: {
        symbol: 'DAI',
        address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        decimals: 18,
        defaultAmount: '1000',
      },
    };
    PAIRS = [
      ['USDC', 'WETH'],
      ['WETH', 'USDC'],
      ['USDC', 'WBTC'],
      ['WBTC', 'USDC'],
      ['USDC', 'USDT'],
      ['USDT', 'USDC'],
      ['USDC', 'DAI'],
      ['DAI', 'USDC'],
      ['WETH', 'WBTC'],
    ];
    return;
  }
  if (key === 'polygon' || key === 'matic') {
    CHAIN = {
      name: 'Polygon',
      shortName: 'polygon',
      chainId: 137,
      rpcEnvVar: 'RPC_POLYGON_URL',
      nativePriceSymbol: 'WMATIC',
    };
    CONTRACTS = {
      uniswapV3QuoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      uniswapV3SwapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    };
    TOKENS = {
      USDC: {
        symbol: 'USDC',
        address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        decimals: 6,
        defaultAmount: '1000',
      },
      USDT: {
        symbol: 'USDT',
        address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        decimals: 6,
        defaultAmount: '1000',
      },
      WETH: {
        symbol: 'WETH',
        address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
        decimals: 18,
        defaultAmount: '1',
      },
      WBTC: {
        symbol: 'WBTC',
        address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
        decimals: 8,
        defaultAmount: '0.05',
      },
      WMATIC: {
        symbol: 'WMATIC',
        address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
        decimals: 18,
        defaultAmount: '2500',
      },
    };
    PAIRS = [
      ['USDC', 'WETH'],
      ['WETH', 'USDC'],
      ['USDC', 'WBTC'],
      ['WBTC', 'USDC'],
      ['USDC', 'USDT'],
      ['USDT', 'USDC'],
      ['USDC', 'WMATIC'],
      ['WMATIC', 'USDC'],
      ['WETH', 'WBTC'],
    ];
    return;
  }
  if (key === 'arbitrum' || key === 'arb') {
    CHAIN = {
      name: 'Arbitrum',
      shortName: 'arbitrum',
      chainId: 42161,
      rpcEnvVar: 'RPC_ARBITRUM_URL',
      nativePriceSymbol: 'WETH',
    };
    CONTRACTS = {
      uniswapV3QuoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      uniswapV3SwapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    };
    TOKENS = {
      USDC: {
        symbol: 'USDC',
        address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        decimals: 6,
        defaultAmount: '1000',
      },
      USDT: {
        symbol: 'USDT',
        address: '0xFd086bC7CD5C481DCC9C85ebe478A1C0b69FCbb9',
        decimals: 6,
        defaultAmount: '1000',
      },
      WETH: {
        symbol: 'WETH',
        address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        decimals: 18,
        defaultAmount: '1',
      },
      WBTC: {
        symbol: 'WBTC',
        address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
        decimals: 8,
        defaultAmount: '0.05',
      },
      ARB: {
        symbol: 'ARB',
        address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
        decimals: 18,
        defaultAmount: '2000',
      },
    };
    PAIRS = [
      ['USDC', 'WETH'],
      ['WETH', 'USDC'],
      ['USDC', 'WBTC'],
      ['WBTC', 'USDC'],
      ['USDC', 'USDT'],
      ['USDT', 'USDC'],
      ['USDC', 'ARB'],
      ['ARB', 'USDC'],
      ['WETH', 'WBTC'],
    ];
    return;
  }
  if (key === 'optimism' || key === 'op') {
    CHAIN = {
      name: 'Optimism',
      shortName: 'optimism',
      chainId: 10,
      rpcEnvVar: 'RPC_OPTIMISM_URL',
      nativePriceSymbol: 'WETH',
    };
    CONTRACTS = {
      uniswapV3QuoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      uniswapV3SwapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    };
    TOKENS = {
      USDC: {
        symbol: 'USDC',
        address: '0x0b2C639c533813f4Aa9D7837CAF62653d097Ff85',
        decimals: 6,
        defaultAmount: '1000',
      },
      USDT: {
        symbol: 'USDT',
        address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
        decimals: 6,
        defaultAmount: '1000',
      },
      WETH: {
        symbol: 'WETH',
        address: '0x4200000000000000000000000000000000000006',
        decimals: 18,
        defaultAmount: '1',
      },
      WBTC: {
        symbol: 'WBTC',
        address: '0x68f180fcCe6836688e9084f035309E29Bf0A2095',
        decimals: 8,
        defaultAmount: '0.05',
      },
      OP: {
        symbol: 'OP',
        address: '0x4200000000000000000000000000000000000042',
        decimals: 18,
        defaultAmount: '1000',
      },
      DAI: {
        symbol: 'DAI',
        address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
        decimals: 18,
        defaultAmount: '1000',
      },
    };
    PAIRS = [
      ['USDC', 'WETH'],
      ['WETH', 'USDC'],
      ['USDC', 'USDT'],
      ['USDT', 'USDC'],
      ['USDC', 'WBTC'],
      ['WBTC', 'USDC'],
      ['USDC', 'OP'],
      ['OP', 'USDC'],
      ['USDC', 'DAI'],
      ['DAI', 'USDC'],
      ['WETH', 'WBTC'],
    ];
    return;
  }
  if (key === 'bnb' || key === 'bsc' || key === 'binance') {
    CHAIN = {
      name: 'BNB',
      shortName: 'bnb',
      chainId: 56,
      rpcEnvVar: 'RPC_BNB_URL',
      nativePriceSymbol: 'WBNB',
    };
    CONTRACTS = {
      uniswapV3QuoterV2: '0x78D78E420Da98ad378D7799bE8f4AF69033EB077',
      uniswapV3SwapRouter02: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2',
    };
    TOKENS = {
      USDT: {
        symbol: 'USDT',
        address: '0x55d398326f99059fF775485246999027B3197955',
        decimals: 18,
        defaultAmount: '1000',
      },
      USDC: {
        symbol: 'USDC',
        address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        decimals: 18,
        defaultAmount: '1000',
      },
      WBNB: {
        symbol: 'WBNB',
        address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        decimals: 18,
        defaultAmount: '2',
      },
      BTCB: {
        symbol: 'BTCB',
        address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
        decimals: 18,
        defaultAmount: '0.05',
      },
      ETH: {
        symbol: 'ETH',
        address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
        decimals: 18,
        defaultAmount: '1',
      },
    };
    PAIRS = [
      ['USDT', 'WBNB'],
      ['WBNB', 'USDT'],
      ['USDC', 'WBNB'],
      ['WBNB', 'USDC'],
      ['USDT', 'BTCB'],
      ['BTCB', 'USDT'],
      ['USDT', 'ETH'],
      ['ETH', 'USDT'],
      ['WBNB', 'BTCB'],
    ];
    return;
  }
  throw new Error(`unsupported UNI_FEE_ARB_CHAIN ${key}`);
}

function envNumber(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
}

function envNumberList(key, fallback) {
  const raw = process.env[key];
  if (!raw) return fallback;
  const values = raw
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
  return values.length ? values : fallback;
}

function hexStrip(hex) {
  return String(hex).replace(/^0x/i, '');
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

function hexToBigInt(hex) {
  if (!hex || hex === '0x') return 0n;
  return BigInt(hex);
}

function hexToNumber(hex) {
  return Number(hexToBigInt(hex));
}

function toBlockTag(n) {
  return `0x${BigInt(n).toString(16)}`;
}

function decimalToBaseUnits(value, decimals) {
  const raw = String(value).trim();
  if (!raw || raw.startsWith('-')) return 0n;
  const [whole, frac = ''] = raw.split('.');
  const digits = `${whole || '0'}${frac.padEnd(decimals, '0').slice(0, decimals)}`;
  return BigInt(digits.replace(/^0+(?=\d)/, '') || '0');
}

function scaleBaseUnits(value, multiplier) {
  const scale = BigInt(Math.round(multiplier * 1_000_000));
  const scaled = (BigInt(value) * scale) / 1_000_000n;
  return scaled > 0n ? scaled : 1n;
}

function baseUnitsToNumber(value, decimals) {
  return Number(value) / 10 ** decimals;
}

function formatBaseUnits(value, decimals) {
  const raw = BigInt(value).toString().padStart(decimals + 1, '0');
  if (decimals === 0) return raw;
  const whole = raw.slice(0, -decimals) || '0';
  const fraction = raw.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

async function rpc(rpcUrl, method, params, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), envNumber('UNI_FEE_ARB_RPC_TIMEOUT_MS', 15_000));
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
      if (attempt < retries) await sleep(250 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function ethCall(rpcUrl, to, data, blockNumber) {
  return rpc(rpcUrl, 'eth_call', [{ to, data }, toBlockTag(blockNumber)]);
}

function encodeUniswapQuote(tokenIn, tokenOut, amountIn, fee) {
  return (
    SELECTORS.uniswapQuoteExactInputSingle +
    encodeAddress(tokenIn) +
    encodeAddress(tokenOut) +
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

async function quoteUniswapFee(rpcUrl, tokenIn, tokenOut, amountIn, fee, blockNumber) {
  const data = encodeUniswapQuote(tokenIn.address, tokenOut.address, amountIn, fee);
  const result = await ethCall(rpcUrl, CONTRACTS.uniswapV3QuoterV2, data, blockNumber);
  const amountOut = decodeUniswapQuote(result);
  if (amountOut <= 0n) throw new Error(`zero quote for fee ${fee}`);
  return { amountOut, fee, route: { fee } };
}

function llamaChainPrefix() {
  if (CHAIN.shortName === 'arbitrum') return 'arbitrum';
  if (CHAIN.shortName === 'ethereum') return 'ethereum';
  if (CHAIN.shortName === 'polygon') return 'polygon';
  if (CHAIN.shortName === 'optimism') return 'optimism';
  if (CHAIN.shortName === 'bnb') return 'bsc';
  return 'base';
}

async function fetchTokenPrices() {
  const coins = Object.values(TOKENS)
    .map((t) => `${llamaChainPrefix()}:${t.address}`)
    .join(',');
  const prices = {};
  try {
    const res = await fetch(`https://coins.llama.fi/prices/current/${coins}`);
    const json = await res.json();
    for (const token of Object.values(TOKENS)) {
      const price = Number(json?.coins?.[`${llamaChainPrefix()}:${token.address}`]?.price);
      if (Number.isFinite(price) && price > 0) prices[token.symbol] = price;
    }
  } catch {
    // Use explicit fallbacks below.
  }
  if (!prices.USDC) prices.USDC = 1;
  if (!prices.USDT) prices.USDT = 1;
  if (!prices.DAI) prices.DAI = 1;
  if (!prices.EURC) prices.EURC = Number(process.env.UNI_FEE_ARB_EURC_USD ?? 1.08);
  if (!prices.WETH) prices.WETH = Number(process.env.UNI_FEE_ARB_ETH_USD ?? 1760);
  if (!prices.ETH) prices.ETH = prices.WETH;
  if (!prices.WBTC) prices.WBTC = Number(process.env.UNI_FEE_ARB_BTC_USD ?? 110000);
  if (!prices.BTCB) prices.BTCB = prices.WBTC;
  if (!prices.WMATIC) prices.WMATIC = Number(process.env.UNI_FEE_ARB_MATIC_USD ?? 0.22);
  if (!prices.WBNB) prices.WBNB = Number(process.env.UNI_FEE_ARB_BNB_USD ?? 600);
  if (!prices.OP) prices.OP = Number(process.env.UNI_FEE_ARB_OP_USD ?? 0.6);
  return prices;
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

function chainSlug() {
  return String(CHAIN.shortName ?? CHAIN.name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
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

async function evaluateFeePair({
  rpcUrl,
  startToken,
  midToken,
  firstFee,
  secondFee,
  amountIn,
  sampleBlocks,
  intervalDays,
  gasPriceWei,
  nativeTokenUsd,
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
      firstQuote = await quoteUniswapFee(rpcUrl, startToken, midToken, amountIn, firstFee, blockNumber);
      secondQuote = await quoteUniswapFee(
        rpcUrl,
        midToken,
        startToken,
        firstQuote.amountOut,
        secondFee,
        blockNumber,
      );
    } catch (err) {
      error = err.message;
    }
    if (!firstQuote || !secondQuote) {
      samples.push({ blockNumber, status: 'missing-quote', error, latencyMs: Date.now() - startedAt });
      continue;
    }
    const grossProfitBaseUnits = secondQuote.amountOut - amountIn;
    const startTokenPriceUsd = tokenPrices[startToken.symbol] ?? null;
    const grossProfitUsd =
      startTokenPriceUsd == null
        ? null
        : baseUnitsToNumber(grossProfitBaseUnits, startToken.decimals) * startTokenPriceUsd;
    const gasUsd = (Number(gasPriceWei) * gasUnits * nativeTokenUsd) / 1e18;
    const netProfitUsd = grossProfitUsd == null ? null : grossProfitUsd - gasUsd;
    const amountInUsd =
      startTokenPriceUsd == null
        ? null
        : baseUnitsToNumber(amountIn, startToken.decimals) * startTokenPriceUsd;
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
      dexPath: ['uniswap-v3', 'uniswap-v3'],
      firstRoute: firstQuote.route,
      secondRoute: secondQuote.route,
      firstFee,
      secondFee,
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
  const grossProfits = quoted.map((s) => s.grossProfitUsd).filter((v) => typeof v === 'number' && Number.isFinite(v));
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
    amountInUsd: tokenPrices[startToken.symbol]
      ? baseUnitsToNumber(amountIn, startToken.decimals) * tokenPrices[startToken.symbol]
      : null,
    grossProfitUsd: stats(grossProfits),
    netProfitUsd: stats(netProfits),
    netReturnPct: stats(netReturns),
    annualizedNetReturnPct: stats(annualizedReturns),
    medianNetProfitUsd: stats(netProfits).median,
    meanAnnualizedNetReturnPct: stats(annualizedReturns).mean,
    netWinRatePct: quoted.length
      ? (quoted.filter((s) => (s.netProfitUsd ?? -Infinity) > 0).length / quoted.length) * 100
      : 0,
    firstFee,
    secondFee,
  };
  const gate = gateFor(metrics, minAnnualizedPct, minSamples, minWinRatePct);

  return {
    id: `uni-v3-fee-${chainSlug()}-${startToken.symbol.toLowerCase()}-${midToken.symbol.toLowerCase()}-${firstFee}-to-${secondFee}`,
    chain: CHAIN.name,
    strategyType: 'uniswap-v3-cross-fee-exact-input-arbitrage',
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
    buyDex: 'uniswap-v3',
    sellDex: 'uniswap-v3',
    dexPath: ['uniswap-v3', 'uniswap-v3'],
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
        'connect wallet, approve start token, execute atomic Uniswap V3 cross-fee swap only after fork simulation',
      requiredContracts: {
        uniswapV3QuoterV2: CONTRACTS.uniswapV3QuoterV2,
        uniswapV3SwapRouter02: CONTRACTS.uniswapV3SwapRouter02,
      },
      selectors: {
        uniswapExactInputSingle: SELECTORS.uniswapExactInputSingle,
      },
      productionStatus: 'not-enabled-until-atomic-adapter-and-fork-simulation-pass',
    },
    samples,
  };
}

function rankStrategy(s) {
  const gateBonus = s.gate.status === 'pass' ? 1_000_000 : 0;
  return (
    gateBonus +
    (s.metrics.meanAnnualizedNetReturnPct ?? -1_000_000) +
    (s.metrics.netWinRatePct ?? 0) * 10 +
    (s.metrics.medianNetProfitUsd ?? -1_000_000) * 100
  );
}

function withAmountSearchMetadata(strategy, tested, selectedMultiplier) {
  if (tested.length <= 1) return strategy;
  return {
    ...strategy,
    metrics: {
      ...strategy.metrics,
      selectedAmountMultiplier: selectedMultiplier,
      testedAmountMultipliers: tested.map((item) => ({
        multiplier: item.multiplier,
        gate: item.gate,
        meanAnnualizedNetReturnPct: item.meanAnnualizedNetReturnPct,
        medianNetProfitUsd: item.medianNetProfitUsd,
        netWinRatePct: item.netWinRatePct,
      })),
    },
  };
}

async function main() {
  loadDotenv();
  selectChainProfile();
  const rpcUrl = process.env[CHAIN.rpcEnvVar];
  if (!rpcUrl) throw new Error(`${CHAIN.rpcEnvVar} is required`);

  const latestBlock = Number(process.env.UNI_FEE_ARB_TO_BLOCK ?? hexToNumber(await rpc(rpcUrl, 'eth_blockNumber', [])));
  const lookbackBlocks = Math.floor(envNumber('UNI_FEE_ARB_LOOKBACK_BLOCKS', 1_200));
  const sampleCount = Math.floor(envNumber('UNI_FEE_ARB_SAMPLE_COUNT', 5));
  const sampleBlocks = buildSampleBlocks(latestBlock, lookbackBlocks, sampleCount);
  const intervalDays =
    sampleBlocks.length > 1
      ? ((sampleBlocks[sampleBlocks.length - 1] - sampleBlocks[0]) * 2) / 86_400
      : 2 / 86_400;
  const gasPriceWei = BigInt(await rpc(rpcUrl, 'eth_gasPrice', []));
  const gasUnits = Math.floor(envNumber('UNI_FEE_ARB_GAS_UNITS', 360_000));
  const minAnnualizedPct = envNumber('UNI_FEE_ARB_MIN_ANNUALIZED_PCT', MIN_ANNUALIZED_NET_RETURN_PCT);
  const minSamples = Math.floor(envNumber('UNI_FEE_ARB_MIN_SAMPLES', Math.min(5, sampleBlocks.length)));
  const minWinRatePct = envNumber('UNI_FEE_ARB_MIN_WIN_RATE_PCT', 80);
  const tokenPrices = await fetchTokenPrices();
  const nativeTokenUsd =
    tokenPrices[CHAIN.nativePriceSymbol] ??
    (CHAIN.nativePriceSymbol === 'WMATIC'
      ? envNumber('UNI_FEE_ARB_MATIC_USD', 0.22)
      : CHAIN.nativePriceSymbol === 'WBNB'
        ? envNumber('UNI_FEE_ARB_BNB_USD', 600)
        : envNumber('UNI_FEE_ARB_ETH_USD', 1760));
  const maxStrategies = Math.floor(envNumber('UNI_FEE_ARB_MAX_STRATEGIES', 40));
  const pairLimit = Math.floor(envNumber('UNI_FEE_ARB_PAIR_LIMIT', PAIRS.length));
  const pairs = PAIRS.slice(0, pairLimit);
  const amountMultipliers = envNumberList(
    'UNI_FEE_ARB_AMOUNT_MULTIPLIERS',
    [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  );
  const strategies = [];
  const feeCombos = UNISWAP_FEE_TIERS.flatMap((a) =>
    UNISWAP_FEE_TIERS.map((b) => [a, b]),
  ).filter(([a, b]) => a !== b);

  console.error(
    `[uni-v3-fee-arb] chain=${CHAIN.name} latest=${latestBlock} samples=${sampleBlocks.join(',')} pairs=${pairs.length}`,
  );

  for (const [startSymbol, midSymbol] of pairs) {
    const startToken = TOKENS[startSymbol];
    const midToken = TOKENS[midSymbol];
    if (!startToken || !midToken) continue;
    const baseAmountIn = decimalToBaseUnits(startToken.defaultAmount, startToken.decimals);
    for (const [firstFee, secondFee] of feeCombos) {
      if (strategies.length >= maxStrategies) break;
      console.error(
        `[uni-v3-fee-arb] ${startSymbol}->${midSymbol}->${startSymbol} fee=${firstFee}->${secondFee} amounts=${amountMultipliers.join(',')}`,
      );
      const tested = [];
      let bestStrategy = null;
      let selectedMultiplier = amountMultipliers[0];
      for (const multiplier of amountMultipliers) {
        const amountIn = scaleBaseUnits(baseAmountIn, multiplier);
        const strategy = await evaluateFeePair({
          rpcUrl,
          startToken,
          midToken,
          firstFee,
          secondFee,
          amountIn,
          sampleBlocks,
          intervalDays,
          gasPriceWei,
          nativeTokenUsd,
          tokenPrices,
          gasUnits,
          minAnnualizedPct,
          minSamples,
          minWinRatePct,
        });
        tested.push({
          multiplier,
          gate: strategy.gate.status,
          meanAnnualizedNetReturnPct: strategy.metrics.meanAnnualizedNetReturnPct,
          medianNetProfitUsd: strategy.metrics.medianNetProfitUsd,
          netWinRatePct: strategy.metrics.netWinRatePct,
          rank: rankStrategy(strategy),
        });
        if (!bestStrategy || rankStrategy(strategy) > rankStrategy(bestStrategy)) {
          bestStrategy = strategy;
          selectedMultiplier = multiplier;
        }
      }
      if (bestStrategy) strategies.push(withAmountSearchMetadata(bestStrategy, tested, selectedMultiplier));
    }
  }

  strategies.sort((a, b) => rankStrategy(b) - rankStrategy(a));
  const limited = strategies.slice(0, maxStrategies);
  const passing = limited.filter((candidate) => candidate.gate.status === 'pass');
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      chain: CHAIN.name,
      chainId: CHAIN.chainId,
      rpcEnvVar: CHAIN.rpcEnvVar,
      contracts: CONTRACTS,
      officialReferences: [
        'https://docs.uniswap.org/contracts/v3/reference/deployments/',
        'https://docs.uniswap.org/contracts/v3/guides/swaps/single-swaps',
        'https://docs.uniswap.org/contracts/v3/guides/flash-integrations/flash-callback',
      ],
    },
    methodology: {
      classification: 'pure-on-chain-uniswap-v3-cross-fee-arbitrage-quote-backtest',
      isPureArbitrage: true,
      noCexRequired: true,
      quoteOnly: true,
      sampleBlocks,
      lookbackBlocks,
      sampleCount: sampleBlocks.length,
      intervalDays,
      gasUnits,
      minAnnualizedNetReturnPct: minAnnualizedPct,
      minSamples,
      minWinRatePct,
      feeTiers: UNISWAP_FEE_TIERS,
      amountMultipliers,
      caveats: [
        'This is historical eth_call quote replay, not executed transaction replay.',
        'Cross-fee tier spreads can vanish in the same block under public mempool competition.',
        'Annualization assumes one opportunity per sample interval and is not a guaranteed APY.',
        'Passing candidates must still pass fresh quote, fork simulation, and loss-reverting executor gates.',
      ],
    },
    summary: {
      candidateCount: limited.length,
      passingCount: passing.length,
      requestedPassingCount: REQUESTED_PASSING,
      status:
        passing.length >= REQUESTED_PASSING
          ? 'found-at-least-five-passing-uniswap-v3-fee-arbitrage-backtests'
          : 'did-not-find-five-passing-uniswap-v3-fee-arbitrage-backtests',
    },
    candidates: limited,
  };

  await mkdir(dataDir, { recursive: true });
  await writeFile(outJson, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    `uniV3FeeArbCandidates=${artifact.summary.status} total=${limited.length} passing=${passing.length} artifact=${outJson}`,
  );
  for (const candidate of limited.slice(0, 10)) {
    console.log(
      `${candidate.id} gate=${candidate.gate.status} samples=${candidate.metrics.sampleCount}/${candidate.metrics.attemptedSamples} win=${candidate.metrics.netWinRatePct?.toFixed(2)} annualized=${candidate.metrics.meanAnnualizedNetReturnPct?.toFixed(2) ?? 'n/a'} medianNetUsd=${candidate.metrics.medianNetProfitUsd?.toFixed(6) ?? 'n/a'} reason=${candidate.gate.reason}`,
    );
  }
}

main().catch((err) => {
  console.error('[uni-v3-fee-arb] failed', err);
  process.exit(1);
});
