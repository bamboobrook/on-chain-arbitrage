#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');
let outJson = resolve(dataDir, 'dex-arbitrage-candidates.json');

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
  aerodromeRouter: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
};

const SELECTORS = {
  uniswapQuoteExactInputSingle: '0xc6a5026a',
  uniswapExactInputSingle: '0x414bf389',
  aerodromeGetAmountsOut: '0x5509a1ac',
  aerodromeSwapExactTokensForTokens: '0xcac88ea9',
  aerodromeDefaultFactory: '0xd4b6846d',
  v2RouterGetAmountsOut: '0xd06ca61f',
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
  AERO: {
    symbol: 'AERO',
    address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
    decimals: 18,
    defaultAmount: '5000',
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
  ['USDC', 'AERO'],
  ['AERO', 'USDC'],
  ['WETH', 'cbBTC'],
  ['WETH', 'AERO'],
  ['WETH', 'cbETH'],
  ['USDC', 'EURC'],
];

let TRIANGLES = [
  ['USDC', 'WETH', 'cbBTC'],
  ['USDC', 'WETH', 'AERO'],
  ['USDC', 'WETH', 'cbETH'],
  ['USDC', 'EURC', 'WETH'],
  ['WETH', 'cbBTC', 'USDC'],
  ['WETH', 'AERO', 'USDC'],
  ['AERO', 'USDC', 'WETH'],
  ['cbBTC', 'WETH', 'USDC'],
];

let DEXES = ['uniswap-v3', 'aerodrome'];
let OFFICIAL_REFERENCES = [
  'https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments',
  'https://docs.aerodrome.finance/security/contract-addresses',
  'https://raw.githubusercontent.com/aerodrome-finance/contracts/main/contracts/Router.sol',
];

const UNISWAP_FEE_TIERS = [100, 500, 3000, 10000];
const AERODROME_STABLE_FLAGS = [false, true];

function selectChainProfile() {
  const key = String(process.env.DEX_ARB_CHAIN ?? 'base').toLowerCase();
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
      sushiswapV2Router: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
      sushiswapV2Factory: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
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
    TRIANGLES = [
      ['USDC', 'WETH', 'WBTC'],
      ['USDC', 'USDT', 'WETH'],
      ['USDC', 'DAI', 'WETH'],
      ['WETH', 'WBTC', 'USDC'],
    ];
    DEXES = ['uniswap-v3', 'sushiswap-v2'];
    OFFICIAL_REFERENCES = [
      'https://docs.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments',
      'https://www.sushi.com/academy/articles/sushiswap-constant-product-pool-deployments',
    ];
    outJson = resolve(dataDir, 'dex-arbitrage-candidates-ethereum.json');
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
      quickswapV2Router: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
      quickswapV2Factory: '0x5757371414417b8c6caad45baef941abc7d3ab32',
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
      DAI: {
        symbol: 'DAI',
        address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
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
      ['USDC', 'WMATIC'],
      ['WMATIC', 'USDC'],
      ['WETH', 'WBTC'],
    ];
    TRIANGLES = [
      ['USDC', 'WETH', 'WBTC'],
      ['USDC', 'USDT', 'WETH'],
      ['USDC', 'DAI', 'WETH'],
      ['USDC', 'WMATIC', 'WETH'],
      ['WMATIC', 'USDC', 'WETH'],
    ];
    DEXES = ['uniswap-v3', 'quickswap-v2'];
    OFFICIAL_REFERENCES = [
      'https://docs.uniswap.org/contracts/v3/reference/deployments/polygon-deployments',
      'https://docs.quickswap.exchange/technical-reference/smart-contracts/v2',
    ];
    outJson = resolve(dataDir, 'dex-arbitrage-candidates-polygon.json');
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
      sushiswapV2Router: '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506',
      sushiswapV2Factory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
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
    TRIANGLES = [
      ['USDC', 'WETH', 'WBTC'],
      ['USDC', 'USDT', 'WETH'],
      ['USDC', 'OP', 'WETH'],
      ['USDC', 'DAI', 'WETH'],
      ['WETH', 'WBTC', 'USDC'],
    ];
    DEXES = ['uniswap-v3', 'sushiswap-v2'];
    OFFICIAL_REFERENCES = [
      'https://docs.uniswap.org/contracts/v3/reference/deployments/optimism-deployments',
      'https://docs.sushi.com/contracts/cpamm',
    ];
    outJson = resolve(dataDir, 'dex-arbitrage-candidates-optimism.json');
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
      pancakeswapV2Router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
      pancakeswapV2Factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
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
    TRIANGLES = [
      ['USDT', 'WBNB', 'BTCB'],
      ['USDT', 'WBNB', 'ETH'],
      ['USDT', 'USDC', 'WBNB'],
      ['WBNB', 'BTCB', 'USDT'],
    ];
    DEXES = ['uniswap-v3', 'pancakeswap-v2'];
    OFFICIAL_REFERENCES = [
      'https://docs.uniswap.org/contracts/v3/reference/deployments/bnb-deployments',
      'https://developer.pancakeswap.finance/contracts/v2/router-v2',
    ];
    outJson = resolve(dataDir, 'dex-arbitrage-candidates-bnb.json');
    return;
  }
  if (key !== 'arbitrum' && key !== 'arb') {
    throw new Error(`unsupported DEX_ARB_CHAIN ${key}`);
  }
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
    sushiswapV2Router: '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506',
    sushiswapV2Factory: '0xc35dadb65012ec5796536bd9864ed8773abc74c4',
  };
  TOKENS = {
    USDC: {
      symbol: 'USDC',
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      decimals: 6,
      defaultAmount: '1000',
    },
    WETH: {
      symbol: 'WETH',
      address: '0x82aF49447D8a07e3bd95BD0d56f35241523Fbab1',
      decimals: 18,
      defaultAmount: '1',
    },
    WBTC: {
      symbol: 'WBTC',
      address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
      decimals: 8,
      defaultAmount: '0.05',
    },
    USDT: {
      symbol: 'USDT',
      address: '0xFd086bC7CD5C481DCC9C85ebe478A1C0b69FCbb9',
      decimals: 6,
      defaultAmount: '1000',
    },
    ARB: {
      symbol: 'ARB',
      address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
      decimals: 18,
      defaultAmount: '1500',
    },
  };
  PAIRS = [
    ['USDC', 'WETH'],
    ['WETH', 'USDC'],
    ['USDC', 'WBTC'],
    ['WBTC', 'USDC'],
    ['USDC', 'USDT'],
    ['USDT', 'USDC'],
    ['WETH', 'WBTC'],
    ['USDC', 'ARB'],
    ['ARB', 'USDC'],
  ];
  TRIANGLES = [
    ['USDC', 'WETH', 'WBTC'],
    ['USDC', 'WETH', 'ARB'],
    ['USDC', 'USDT', 'WETH'],
    ['WETH', 'WBTC', 'USDC'],
    ['ARB', 'USDC', 'WETH'],
  ];
  DEXES = ['uniswap-v3', 'sushiswap-v2'];
  OFFICIAL_REFERENCES = [
    'https://docs.uniswap.org/contracts/v3/reference/deployments/arbitrum-deployments',
    'https://www.sushi.com/academy/articles/sushiswap-constant-product-pool-deployments',
  ];
  outJson = resolve(dataDir, 'dex-arbitrage-candidates-arbitrum.json');
}

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

function envNonNegativeNumber(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
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

function safeSuffix(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function applyOutputOverride() {
  const explicit = process.env.DEX_ARB_OUT;
  if (explicit) {
    outJson = resolve(root, explicit);
    return;
  }
  const suffix = safeSuffix(process.env.DEX_ARB_OUTPUT_SUFFIX);
  if (suffix) {
    outJson = outJson.replace(/\.json$/i, `-${suffix}.json`);
  }
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

function encodeBool(value) {
  return encodeUint(value ? 1n : 0n);
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
    const timer = setTimeout(() => controller.abort(), envNumber('DEX_ARB_RPC_TIMEOUT_MS', 15_000));
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
    encodeAddress(tokenIn).slice(0) +
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

function encodeV2RouterGetAmountsOut(amountIn, tokenIn, tokenOut) {
  return (
    SELECTORS.v2RouterGetAmountsOut +
    encodeUint(amountIn) +
    encodeUint(64n) +
    encodeUint(2n) +
    encodeAddress(tokenIn) +
    encodeAddress(tokenOut)
  );
}

function decodeUintArrayLast(result) {
  const clean = hexStrip(result);
  if (clean.length < 64 * 3) throw new Error('short uint256[] result');
  const offset = Number(BigInt(`0x${clean.slice(0, 64)}`));
  const start = offset * 2;
  const length = Number(BigInt(`0x${clean.slice(start, start + 64)}`));
  if (length < 1) throw new Error('empty uint256[] result');
  const lastStart = start + 64 + (length - 1) * 64;
  return BigInt(`0x${clean.slice(lastStart, lastStart + 64)}`);
}

async function readAerodromeDefaultFactory(rpcUrl, blockNumber) {
  if (!CONTRACTS.aerodromeRouter) return null;
  const result = await ethCall(rpcUrl, CONTRACTS.aerodromeRouter, SELECTORS.aerodromeDefaultFactory, blockNumber);
  return `0x${hexStrip(result).slice(24, 64)}`;
}

async function quoteUniswapBest(rpcUrl, tokenIn, tokenOut, amountIn, blockNumber) {
  let best = null;
  for (const fee of UNISWAP_FEE_TIERS) {
    try {
      const data = encodeUniswapQuote(tokenIn.address, tokenOut.address, amountIn, fee);
      const result = await ethCall(rpcUrl, CONTRACTS.uniswapV3QuoterV2, data, blockNumber);
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

async function quoteAerodromeBest(rpcUrl, tokenIn, tokenOut, amountIn, blockNumber, factory) {
  if (!CONTRACTS.aerodromeRouter || !factory) return null;
  let best = null;
  for (const stable of AERODROME_STABLE_FLAGS) {
    try {
      const data = encodeAerodromeGetAmountsOut(
        amountIn,
        tokenIn.address,
        tokenOut.address,
        stable,
        factory,
      );
      const result = await ethCall(rpcUrl, CONTRACTS.aerodromeRouter, data, blockNumber);
      const amountOut = decodeUintArrayLast(result);
      if (amountOut > 0n && (!best || amountOut > best.amountOut)) {
        best = { dex: 'aerodrome', amountOut, stable, route: { stable, factory } };
      }
    } catch {
      // Missing pool or no viable route.
    }
  }
  return best;
}

function v2RouterForDex(dex) {
  if (dex === 'sushiswap-v2') return CONTRACTS.sushiswapV2Router;
  if (dex === 'quickswap-v2') return CONTRACTS.quickswapV2Router;
  if (dex === 'pancakeswap-v2') return CONTRACTS.pancakeswapV2Router;
  return null;
}

async function quoteV2Router(rpcUrl, dex, tokenIn, tokenOut, amountIn, blockNumber) {
  const router = v2RouterForDex(dex);
  if (!router) return null;
  try {
    const data = encodeV2RouterGetAmountsOut(amountIn, tokenIn.address, tokenOut.address);
    const result = await ethCall(rpcUrl, router, data, blockNumber);
    const amountOut = decodeUintArrayLast(result);
    if (amountOut <= 0n) return null;
    return { dex, amountOut, route: { router } };
  } catch {
    return null;
  }
}

async function quoteDex(rpcUrl, dex, tokenIn, tokenOut, amountIn, blockNumber, factory) {
  if (dex === 'uniswap-v3') return quoteUniswapBest(rpcUrl, tokenIn, tokenOut, amountIn, blockNumber);
  if (dex === 'aerodrome') return quoteAerodromeBest(rpcUrl, tokenIn, tokenOut, amountIn, blockNumber, factory);
  if (dex === 'sushiswap-v2' || dex === 'quickswap-v2' || dex === 'pancakeswap-v2') {
    return quoteV2Router(rpcUrl, dex, tokenIn, tokenOut, amountIn, blockNumber);
  }
  throw new Error(`unsupported dex ${dex}`);
}

function requiredContractsForDexes() {
  const out = {};
  if (DEXES.includes('uniswap-v3')) {
    out.uniswapV3QuoterV2 = CONTRACTS.uniswapV3QuoterV2;
    out.uniswapV3SwapRouter02 = CONTRACTS.uniswapV3SwapRouter02;
  }
  if (DEXES.includes('aerodrome')) out.aerodromeRouter = CONTRACTS.aerodromeRouter;
  if (DEXES.includes('sushiswap-v2')) out.sushiswapV2Router = CONTRACTS.sushiswapV2Router;
  if (DEXES.includes('quickswap-v2')) out.quickswapV2Router = CONTRACTS.quickswapV2Router;
  if (DEXES.includes('pancakeswap-v2')) out.pancakeswapV2Router = CONTRACTS.pancakeswapV2Router;
  return out;
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
  const url = `https://coins.llama.fi/prices/current/${coins}`;
  const prices = {};
  try {
    const res = await fetch(url);
    const json = await res.json();
    for (const token of Object.values(TOKENS)) {
      const price = Number(json?.coins?.[`${llamaChainPrefix()}:${token.address}`]?.price);
      if (Number.isFinite(price) && price > 0) prices[token.symbol] = price;
    }
  } catch {
    // Explicit fallbacks below.
  }
  if (!prices.USDC) prices.USDC = 1;
  if (!prices.USDT) prices.USDT = 1;
  if (!prices.DAI) prices.DAI = 1;
  if (!prices.EURC) prices.EURC = Number(process.env.DEX_ARB_EURC_USD ?? 1.08);
  if (!prices.WETH) prices.WETH = Number(process.env.DEX_ARB_ETH_USD ?? 1760);
  if (!prices.ETH) prices.ETH = prices.WETH;
  if (!prices.WBTC) prices.WBTC = Number(process.env.DEX_ARB_BTC_USD ?? 110000);
  if (!prices.BTCB) prices.BTCB = prices.WBTC;
  if (!prices.WMATIC) prices.WMATIC = Number(process.env.DEX_ARB_MATIC_USD ?? 0.22);
  if (!prices.WBNB) prices.WBNB = Number(process.env.DEX_ARB_BNB_USD ?? 600);
  if (!prices.OP) prices.OP = Number(process.env.DEX_ARB_OP_USD ?? 0.6);
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

async function evaluateStrategy({
  rpcUrl,
  startToken,
  midToken,
  buyDex,
  sellDex,
  amountIn,
  sampleBlocks,
  intervalDays,
  gasPriceWei,
  ethUsd,
  tokenPrices,
  aerodromeFactory,
  gasUnits,
  minAnnualizedPct,
  minSamples,
  minWinRatePct,
}) {
  const samples = [];
  for (const blockNumber of sampleBlocks) {
    const startedAt = Date.now();
    let buyQuote = null;
    let sellQuote = null;
    let error = null;
    try {
      buyQuote = await quoteDex(rpcUrl, buyDex, startToken, midToken, amountIn, blockNumber, aerodromeFactory);
      if (!buyQuote) throw new Error(`${buyDex} ${startToken.symbol}->${midToken.symbol} quote unavailable`);
      sellQuote = await quoteDex(
        rpcUrl,
        sellDex,
        midToken,
        startToken,
        buyQuote.amountOut,
        blockNumber,
        aerodromeFactory,
      );
      if (!sellQuote) throw new Error(`${sellDex} ${midToken.symbol}->${startToken.symbol} quote unavailable`);
    } catch (err) {
      error = err.message;
    }
    if (!buyQuote || !sellQuote) {
      samples.push({ blockNumber, status: 'missing-quote', error, latencyMs: Date.now() - startedAt });
      continue;
    }
    const grossProfitBaseUnits = sellQuote.amountOut - amountIn;
    const startTokenPriceUsd = tokenPrices[startToken.symbol] ?? null;
    const grossProfitUsd =
      startTokenPriceUsd == null
        ? null
        : baseUnitsToNumber(grossProfitBaseUnits, startToken.decimals) * startTokenPriceUsd;
    const gasUsd = (Number(gasPriceWei) * gasUnits * ethUsd) / 1e18;
    const netProfitUsd = grossProfitUsd == null ? null : grossProfitUsd - gasUsd;
    const amountInUsd = startTokenPriceUsd == null ? null : baseUnitsToNumber(amountIn, startToken.decimals) * startTokenPriceUsd;
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
      buyDex,
      sellDex,
      buyRoute: buyQuote.route,
      sellRoute: sellQuote.route,
      amountIn: amountIn.toString(),
      amountInHuman: formatBaseUnits(amountIn, startToken.decimals),
      midAmount: buyQuote.amountOut.toString(),
      midAmountHuman: formatBaseUnits(buyQuote.amountOut, midToken.decimals),
      amountOut: sellQuote.amountOut.toString(),
      amountOutHuman: formatBaseUnits(sellQuote.amountOut, startToken.decimals),
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
  };
  const gate = gateFor(metrics, minAnnualizedPct, minSamples, minWinRatePct);
  return {
    id: `arb-${chainSlug()}-${startToken.symbol.toLowerCase()}-${midToken.symbol.toLowerCase()}-${buyDex.replace(/[^a-z0-9]/g, '')}-to-${sellDex.replace(/[^a-z0-9]/g, '')}`,
    chain: CHAIN.name,
    strategyType: 'dex-dex-exact-input-arbitrage',
    isPureArbitrage: true,
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
    buyDex,
    sellDex,
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
      userFlow: 'connect wallet, approve start token, execute atomic two-leg swap adapter only after fork simulation',
      requiredContracts: {
        ...requiredContractsForDexes(),
      },
      selectors: {
        uniswapExactInputSingle: SELECTORS.uniswapExactInputSingle,
        aerodromeSwapExactTokensForTokens: SELECTORS.aerodromeSwapExactTokensForTokens,
      },
      productionStatus: 'not-enabled-until-atomic-adapter-and-fork-simulation-pass',
    },
    samples,
  };
}

async function evaluateTriangularStrategy({
  rpcUrl,
  tokenA,
  tokenB,
  tokenC,
  dexPath,
  amountIn,
  sampleBlocks,
  intervalDays,
  gasPriceWei,
  ethUsd,
  tokenPrices,
  aerodromeFactory,
  gasUnits,
  minAnnualizedPct,
  minSamples,
  minWinRatePct,
}) {
  const samples = [];
  for (const blockNumber of sampleBlocks) {
    const startedAt = Date.now();
    const legs = [];
    let currentAmount = amountIn;
    let error = null;
    const path = [
      [tokenA, tokenB],
      [tokenB, tokenC],
      [tokenC, tokenA],
    ];
    try {
      for (let i = 0; i < path.length; i += 1) {
        const [tokenIn, tokenOut] = path[i];
        const dex = dexPath[i];
        const quote = await quoteDex(
          rpcUrl,
          dex,
          tokenIn,
          tokenOut,
          currentAmount,
          blockNumber,
          aerodromeFactory,
        );
        if (!quote) throw new Error(`${dex} ${tokenIn.symbol}->${tokenOut.symbol} quote unavailable`);
        legs.push({
          dex,
          tokenIn: tokenIn.symbol,
          tokenOut: tokenOut.symbol,
          route: quote.route,
          amountIn: currentAmount.toString(),
          amountInHuman: formatBaseUnits(currentAmount, tokenIn.decimals),
          amountOut: quote.amountOut.toString(),
          amountOutHuman: formatBaseUnits(quote.amountOut, tokenOut.decimals),
        });
        currentAmount = quote.amountOut;
      }
    } catch (err) {
      error = err.message;
    }
    if (legs.length !== 3) {
      samples.push({ blockNumber, status: 'missing-quote', error, legs, latencyMs: Date.now() - startedAt });
      continue;
    }
    const grossProfitBaseUnits = currentAmount - amountIn;
    const startTokenPriceUsd = tokenPrices[tokenA.symbol] ?? null;
    const grossProfitUsd =
      startTokenPriceUsd == null
        ? null
        : baseUnitsToNumber(grossProfitBaseUnits, tokenA.decimals) * startTokenPriceUsd;
    const gasUsd = (Number(gasPriceWei) * gasUnits * ethUsd) / 1e18;
    const netProfitUsd = grossProfitUsd == null ? null : grossProfitUsd - gasUsd;
    const amountInUsd = startTokenPriceUsd == null ? null : baseUnitsToNumber(amountIn, tokenA.decimals) * startTokenPriceUsd;
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
      dexPath,
      legs,
      amountIn: amountIn.toString(),
      amountInHuman: formatBaseUnits(amountIn, tokenA.decimals),
      amountOut: currentAmount.toString(),
      amountOutHuman: formatBaseUnits(currentAmount, tokenA.decimals),
      grossProfitBaseUnits: grossProfitBaseUnits.toString(),
      grossProfitHuman: formatBaseUnits(grossProfitBaseUnits, tokenA.decimals),
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
    amountInUsd: tokenPrices[tokenA.symbol]
      ? baseUnitsToNumber(amountIn, tokenA.decimals) * tokenPrices[tokenA.symbol]
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
  };
  const gate = gateFor(metrics, minAnnualizedPct, minSamples, minWinRatePct);
  return {
    id: `tri-${chainSlug()}-${tokenA.symbol.toLowerCase()}-${tokenB.symbol.toLowerCase()}-${tokenC.symbol.toLowerCase()}-${dexPath.map((d) => d.replace(/[^a-z0-9]/g, '')).join('-')}`,
    chain: CHAIN.name,
    strategyType: 'triangular-exact-input-arbitrage',
    isPureArbitrage: true,
    startToken: {
      symbol: tokenA.symbol,
      address: tokenA.address,
      decimals: tokenA.decimals,
    },
    midToken: {
      symbol: tokenB.symbol,
      address: tokenB.address,
      decimals: tokenB.decimals,
    },
    thirdToken: {
      symbol: tokenC.symbol,
      address: tokenC.address,
      decimals: tokenC.decimals,
    },
    buyDex: dexPath[0],
    sellDex: dexPath[2],
    dexPath,
    tokenPath: [tokenA.symbol, tokenB.symbol, tokenC.symbol, tokenA.symbol],
    amountIn: amountIn.toString(),
    amountInHuman: formatBaseUnits(amountIn, tokenA.decimals),
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
      userFlow: 'connect wallet, approve start token, execute atomic three-leg swap adapter only after fork simulation',
      requiredContracts: {
        ...requiredContractsForDexes(),
      },
      selectors: {
        uniswapExactInputSingle: SELECTORS.uniswapExactInputSingle,
        aerodromeSwapExactTokensForTokens: SELECTORS.aerodromeSwapExactTokensForTokens,
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

async function main() {
  loadDotenv();
  selectChainProfile();
  applyOutputOverride();
  const rpcUrl = process.env[CHAIN.rpcEnvVar];
  if (!rpcUrl) throw new Error(`${CHAIN.rpcEnvVar} is required`);

  const latestBlock = Number(process.env.DEX_ARB_TO_BLOCK ?? hexToNumber(await rpc(rpcUrl, 'eth_blockNumber', [])));
  const lookbackBlocks = Math.floor(envNumber('DEX_ARB_LOOKBACK_BLOCKS', 1_200));
  const sampleCount = Math.floor(envNumber('DEX_ARB_SAMPLE_COUNT', 5));
  const sampleBlocks = buildSampleBlocks(latestBlock, lookbackBlocks, sampleCount);
  const intervalDays =
    sampleBlocks.length > 1
      ? ((sampleBlocks[sampleBlocks.length - 1] - sampleBlocks[0]) * 2) / 86_400
      : 2 / 86_400;
  const gasPriceWei = BigInt(await rpc(rpcUrl, 'eth_gasPrice', []));
  const gasUnits = Math.floor(envNumber('DEX_ARB_GAS_UNITS', 420_000));
  const minAnnualizedPct = envNumber('DEX_ARB_MIN_ANNUALIZED_PCT', 20);
  const minSamples = Math.floor(envNumber('DEX_ARB_MIN_SAMPLES', Math.min(5, sampleBlocks.length)));
  const minWinRatePct = envNumber('DEX_ARB_MIN_WIN_RATE_PCT', 60);
  const tokenPrices = await fetchTokenPrices();
  const nativeTokenUsd =
    tokenPrices[CHAIN.nativePriceSymbol] ??
    (CHAIN.nativePriceSymbol === 'WMATIC'
      ? envNumber('DEX_ARB_MATIC_USD', 0.22)
      : CHAIN.nativePriceSymbol === 'WBNB'
        ? envNumber('DEX_ARB_BNB_USD', 600)
        : envNumber('DEX_ARB_ETH_USD', 1760));
  const aerodromeFactory = await readAerodromeDefaultFactory(rpcUrl, latestBlock);
  const maxStrategies = Math.floor(envNumber('DEX_ARB_MAX_STRATEGIES', 40));
  const pairOffset = Math.floor(envNonNegativeNumber('DEX_ARB_PAIR_OFFSET', 0));
  const pairLimit = Math.floor(envNonNegativeNumber('DEX_ARB_PAIR_LIMIT', PAIRS.length));
  const pairs = PAIRS.slice(pairOffset, pairOffset + pairLimit);
  const triangleOffset = Math.floor(envNonNegativeNumber('DEX_ARB_TRIANGLE_OFFSET', 0));
  const triangleLimit = Math.floor(envNonNegativeNumber('DEX_ARB_TRIANGLE_LIMIT', TRIANGLES.length));
  const triangles = TRIANGLES.slice(triangleOffset, triangleOffset + triangleLimit);
  const triangleGasUnits = Math.floor(envNumber('DEX_ARB_TRIANGLE_GAS_UNITS', Math.max(gasUnits, 650_000)));
  const amountMultipliers = envNumberList(
    'DEX_ARB_AMOUNT_MULTIPLIERS',
    [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  );
  const strategies = [];
  const allDexCombos = DEXES.flatMap((a) => DEXES.map((b) => [a, b])).filter(([a, b]) => a !== b);
  const dexComboOffset = Math.floor(envNonNegativeNumber('DEX_ARB_DEX_COMBO_OFFSET', 0));
  const dexComboLimit = Math.floor(envNonNegativeNumber('DEX_ARB_DEX_COMBO_LIMIT', allDexCombos.length));
  const dexCombos = allDexCombos.slice(dexComboOffset, dexComboOffset + dexComboLimit);
  const allTriangularDexPaths = DEXES.flatMap((a) =>
    DEXES.flatMap((b) => DEXES.map((c) => [a, b, c])),
  );
  const triangularDexPathOffset = Math.floor(envNonNegativeNumber('DEX_ARB_TRIANGULAR_DEX_PATH_OFFSET', 0));
  const triangularDexPathLimit = Math.floor(
    envNonNegativeNumber('DEX_ARB_TRIANGULAR_DEX_PATH_LIMIT', allTriangularDexPaths.length),
  );
  const triangularDexPaths = allTriangularDexPaths.slice(
    triangularDexPathOffset,
    triangularDexPathOffset + triangularDexPathLimit,
  );

  console.error(
    `[dex-arb] chain=${CHAIN.name} latest=${latestBlock} samples=${sampleBlocks.join(',')} pairs=${pairs.length}@${pairOffset} dexCombos=${dexCombos.length}@${dexComboOffset} triangles=${triangles.length}@${triangleOffset} triangularDexPaths=${triangularDexPaths.length}@${triangularDexPathOffset} out=${outJson}`,
  );
  for (const [startSymbol, midSymbol] of pairs) {
    const startToken = TOKENS[startSymbol];
    const midToken = TOKENS[midSymbol];
    if (!startToken || !midToken) continue;
    const baseAmountIn = decimalToBaseUnits(startToken.defaultAmount, startToken.decimals);
    for (const [buyDex, sellDex] of dexCombos) {
      if (strategies.length >= maxStrategies) break;
      console.error(
        `[dex-arb] ${startSymbol}->${midSymbol}->${startSymbol} ${buyDex}->${sellDex} amounts=${amountMultipliers.join(',')}`,
      );
      const tested = [];
      let bestStrategy = null;
      let selectedMultiplier = amountMultipliers[0];
      for (const multiplier of amountMultipliers) {
        const amountIn = scaleBaseUnits(baseAmountIn, multiplier);
        const strategy = await evaluateStrategy({
          rpcUrl,
          startToken,
          midToken,
          buyDex,
          sellDex,
          amountIn,
          sampleBlocks,
          intervalDays,
          gasPriceWei,
          ethUsd: nativeTokenUsd,
          tokenPrices,
          aerodromeFactory,
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
        });
        if (!bestStrategy || rankStrategy(strategy) > rankStrategy(bestStrategy)) {
          bestStrategy = strategy;
          selectedMultiplier = multiplier;
        }
      }
      strategies.push(withAmountSearchMetadata(bestStrategy, tested, selectedMultiplier));
    }
  }
  for (const [symbolA, symbolB, symbolC] of triangles) {
    const tokenA = TOKENS[symbolA];
    const tokenB = TOKENS[symbolB];
    const tokenC = TOKENS[symbolC];
    if (!tokenA || !tokenB || !tokenC) continue;
    const baseAmountIn = decimalToBaseUnits(tokenA.defaultAmount, tokenA.decimals);
    for (const dexPath of triangularDexPaths) {
      if (strategies.length >= maxStrategies) break;
      console.error(
        `[dex-arb] ${symbolA}->${symbolB}->${symbolC}->${symbolA} ${dexPath.join('->')} amounts=${amountMultipliers.join(',')}`,
      );
      const tested = [];
      let bestStrategy = null;
      let selectedMultiplier = amountMultipliers[0];
      for (const multiplier of amountMultipliers) {
        const amountIn = scaleBaseUnits(baseAmountIn, multiplier);
        const strategy = await evaluateTriangularStrategy({
          rpcUrl,
          tokenA,
          tokenB,
          tokenC,
          dexPath,
          amountIn,
          sampleBlocks,
          intervalDays,
          gasPriceWei,
          ethUsd: nativeTokenUsd,
          tokenPrices,
          aerodromeFactory,
          gasUnits: triangleGasUnits,
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
        });
        if (!bestStrategy || rankStrategy(strategy) > rankStrategy(bestStrategy)) {
          bestStrategy = strategy;
          selectedMultiplier = multiplier;
        }
      }
      strategies.push(withAmountSearchMetadata(bestStrategy, tested, selectedMultiplier));
    }
  }
  strategies.sort((a, b) => rankStrategy(b) - rankStrategy(a));
  const passing = strategies.filter((s) => s.gate.status === 'pass');
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      chain: CHAIN,
      contracts: CONTRACTS,
      aerodromeFactory,
      tokenPrices,
      officialReferences: [
        ...OFFICIAL_REFERENCES,
      ],
    },
    methodology: {
      classification: 'pure-on-chain-dex-dex-arbitrage-quote-backtest',
      isPureArbitrage: true,
      noCexRequired: true,
      quoteOnly: true,
      sampleBlocks,
      lookbackBlocks,
      gasAssumption: {
        gasUnits,
        triangleGasUnits,
        gasPriceWei: gasPriceWei.toString(),
        nativeTokenSymbol: CHAIN.nativePriceSymbol,
        nativeTokenUsd,
      },
      routeUniverse: {
        pairOffset,
        twoLegPairs: pairs,
        dexComboOffset,
        dexCombos,
        triangleOffset,
        triangles,
        triangularDexPathOffset,
        triangularDexPaths,
        dexes: DEXES,
        amountMultipliers,
      },
      thresholds: {
        minAnnualizedNetReturnPct: minAnnualizedPct,
        minSamples,
        minWinRatePct,
      },
      caveats: [
        'This is historical eth_call quote replay, not executed transaction replay.',
        'Quotes do not prove that a public mempool transaction would land before competing searchers.',
        'Annualization assumes one opportunity per sample interval and is not a guaranteed APY.',
        'Live execution remains disabled until an atomic adapter and ordered fork simulation pass.',
        'Passing candidates must be rechecked immediately before signing because DEX arbitrage decays quickly.',
      ],
    },
    summary: {
      candidateCount: strategies.length,
      passingCount: passing.length,
      requestedPassingCount: 5,
      status:
        passing.length >= 5
          ? 'found-at-least-five-passing-quote-backtests'
          : 'did-not-find-five-passing-quote-backtests',
    },
    candidates: strategies.slice(0, maxStrategies),
  };
  await mkdir(dataDir, { recursive: true });
  await writeFile(outJson, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    `dexArbCandidates=${artifact.summary.status} total=${strategies.length} passing=${passing.length} artifact=${outJson}`,
  );
  for (const s of strategies.slice(0, 10)) {
    console.log(
      `${s.id} gate=${s.gate.status} samples=${s.metrics.sampleCount}/${s.metrics.attemptedSamples} win=${s.metrics.netWinRatePct?.toFixed(2)} annualized=${s.metrics.meanAnnualizedNetReturnPct?.toFixed(2) ?? 'n/a'} medianNetUsd=${s.metrics.medianNetProfitUsd?.toFixed(6) ?? 'n/a'} reason=${s.gate.reason}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
