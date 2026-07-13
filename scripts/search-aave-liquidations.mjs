#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');

const SELECTORS = {
  getReservesList: '0xd1946dbc',
  getReserveData: '0x35ea6a75',
  getUserAccountData: '0xbf92857c',
  balanceOf: '0x70a08231',
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
  liquidationCall: '0x00a718a9',
};

const TOPICS = {
  transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const RAY = 10n ** 18n;

let CHAIN = {
  name: 'Base',
  shortName: 'base',
  chainId: 8453,
  rpcEnvVar: 'RPC_BASE_URL',
  nativePriceSymbol: 'WETH',
  aaveV3Pool: '0xA238Dd80C259a72e81d7e4664a9801593f98d1c5',
};

const CHAIN_PROFILES = {
  base: CHAIN,
  arbitrum: {
    name: 'Arbitrum',
    shortName: 'arbitrum',
    chainId: 42161,
    rpcEnvVar: 'RPC_ARBITRUM_URL',
    nativePriceSymbol: 'WETH',
    aaveV3Pool: '0x794a61358D6845594F94dC1dB02A252b5b4814aD',
  },
  polygon: {
    name: 'Polygon',
    shortName: 'polygon',
    chainId: 137,
    rpcEnvVar: 'RPC_POLYGON_URL',
    nativePriceSymbol: 'WMATIC',
    aaveV3Pool: '0x794a61358D6845594F94dC1dB02A252b5b4814aD',
  },
  ethereum: {
    name: 'Ethereum',
    shortName: 'ethereum',
    chainId: 1,
    rpcEnvVar: 'RPC_ETHEREUM_URL',
    nativePriceSymbol: 'WETH',
    aaveV3Pool: '0x87870Bca3F3fD6335C3F4cE8392D69350B4fA4E2',
  },
  'spark-ethereum': {
    name: 'Spark Ethereum',
    shortName: 'spark-ethereum',
    chainId: 1,
    rpcEnvVar: 'RPC_ETHEREUM_URL',
    nativePriceSymbol: 'WETH',
    aaveV3Pool: '0xC13e21B648A5Ee794902342038FF3aDAB66BE987',
    protocol: 'SparkLend',
    familyKey: 'spark-liquidation-arbitrage',
    officialReferences: [
      'https://docs.spark.fi/dev/deployments',
      'https://github.com/sparkdotfi/spark-address-registry',
    ],
  },
};

function selectChainProfile() {
  const key = String(process.env.LIQ_CHAIN ?? 'base').toLowerCase();
  if (key === 'arb') CHAIN = CHAIN_PROFILES.arbitrum;
  else if (key === 'eth' || key === 'mainnet') CHAIN = CHAIN_PROFILES.ethereum;
  else if (key === 'spark' || key === 'sparklend' || key === 'spark-mainnet') CHAIN = CHAIN_PROFILES['spark-ethereum'];
  else if (CHAIN_PROFILES[key]) CHAIN = CHAIN_PROFILES[key];
  else throw new Error(`unsupported LIQ_CHAIN ${key}`);
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

function envBool(key, fallback = false) {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'y'].includes(String(raw).toLowerCase());
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

function addressFromWord(word) {
  return `0x${hexStrip(word).slice(24, 64)}`;
}

function toBlockTag(n) {
  return `0x${BigInt(n).toString(16)}`;
}

function hexToBigInt(hex) {
  if (!hex || hex === '0x') return 0n;
  return BigInt(hex);
}

function hexToNumber(hex) {
  return Number(hexToBigInt(hex));
}

function wordAt(result, index) {
  const clean = hexStrip(result);
  return clean.slice(index * 64, index * 64 + 64);
}

function decodeUintWord(result, index) {
  const word = wordAt(result, index);
  return word ? BigInt(`0x${word}`) : 0n;
}

function decodeAddressWord(result, index) {
  return addressFromWord(wordAt(result, index));
}

function decimalBaseUnitsToNumber(value, decimals) {
  if (value === 0n) return 0;
  return Number(value) / 10 ** decimals;
}

function formatBaseUnits(value, decimals) {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const raw = abs.toString().padStart(decimals + 1, '0');
  const whole = decimals === 0 ? raw : raw.slice(0, -decimals);
  const frac = decimals === 0 ? '' : raw.slice(-decimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole || '0'}${frac ? `.${frac}` : ''}`;
}

function rayToNumber(value) {
  if (value > 10n ** 40n) return Infinity;
  return Number(value) / Number(RAY);
}

async function rpc(rpcUrl, method, params, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), envNumber('LIQ_RPC_TIMEOUT_MS', 20_000));
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

async function getLogs(rpcUrl, address, fromBlock, toBlock, topics) {
  return rpc(rpcUrl, 'eth_getLogs', [
    {
      address,
      fromBlock: toBlockTag(fromBlock),
      toBlock: toBlockTag(toBlock),
      topics,
    },
  ]);
}

function encodeCall(selector, ...words) {
  return selector + words.join('');
}

function decodeAddressArray(result) {
  const offset = Number(decodeUintWord(result, 0));
  const startWord = offset / 32;
  const length = Number(decodeUintWord(result, startWord));
  const out = [];
  for (let i = 0; i < length; i += 1) {
    out.push(decodeAddressWord(result, startWord + 1 + i));
  }
  return out;
}

function decodeStringResult(result) {
  const clean = hexStrip(result);
  if (!clean || clean.length < 64) return null;
  const first = clean.slice(0, 64);
  const offset = Number(BigInt(`0x${first}`));
  if (offset === 32 && clean.length >= 128) {
    const length = Number(BigInt(`0x${clean.slice(64, 128)}`));
    const data = clean.slice(128, 128 + length * 2);
    return Buffer.from(data, 'hex').toString('utf8').replace(/\0+$/, '');
  }
  const bytes = Buffer.from(first.replace(/00+$/, ''), 'hex').toString('utf8').replace(/\0+$/, '');
  return bytes || null;
}

function decodeReserveConfig(config) {
  const mask16 = 0xffffn;
  const ltvBps = Number(config & mask16);
  const liquidationThresholdBps = Number((config >> 16n) & mask16);
  const liquidationBonusBps = Number((config >> 32n) & mask16);
  const decimals = Number((config >> 48n) & 0xffn);
  const active = ((config >> 56n) & 1n) === 1n;
  const frozen = ((config >> 57n) & 1n) === 1n;
  const borrowingEnabled = ((config >> 58n) & 1n) === 1n;
  const paused = ((config >> 60n) & 1n) === 1n;
  const liquidationProtocolFeeBps = Number((config >> 152n) & mask16);
  return {
    ltvBps,
    liquidationThresholdBps,
    liquidationBonusBps,
    decimals,
    active,
    frozen,
    borrowingEnabled,
    paused,
    liquidationProtocolFeeBps,
  };
}

async function fetchTokenPrices() {
  const prefix = CHAIN.shortName === 'ethereum' ? 'ethereum' : CHAIN.shortName;
  const coins = Object.values(reserveByAsset)
    .map((r) => `${prefix}:${r.asset}`)
    .join(',');
  const prices = {};
  if (coins) {
    try {
      const res = await fetch(`https://coins.llama.fi/prices/current/${coins}`);
      const json = await res.json();
      for (const reserve of Object.values(reserveByAsset)) {
        const price = Number(json?.coins?.[`${prefix}:${reserve.asset}`]?.price);
        if (Number.isFinite(price) && price > 0) prices[reserve.asset.toLowerCase()] = price;
      }
    } catch {
      // Fall through to symbol defaults.
    }
  }
  for (const reserve of Object.values(reserveByAsset)) {
    if (prices[reserve.asset.toLowerCase()]) continue;
    if (['USDC', 'USDT', 'DAI'].includes(reserve.symbol)) prices[reserve.asset.toLowerCase()] = 1;
    if (reserve.symbol === 'WETH') prices[reserve.asset.toLowerCase()] = envNumber('LIQ_ETH_USD', 1760);
    if (reserve.symbol === 'WBTC') prices[reserve.asset.toLowerCase()] = envNumber('LIQ_BTC_USD', 110000);
    if (reserve.symbol === 'WMATIC') prices[reserve.asset.toLowerCase()] = envNumber('LIQ_MATIC_USD', 0.22);
  }
  return prices;
}

let reserveByAsset = {};

async function readSymbol(rpcUrl, token, blockNumber) {
  try {
    const result = await ethCall(rpcUrl, token, SELECTORS.symbol, blockNumber);
    return decodeStringResult(result);
  } catch {
    return null;
  }
}

async function readDecimals(rpcUrl, token, blockNumber, fallback) {
  try {
    const result = await ethCall(rpcUrl, token, SELECTORS.decimals, blockNumber);
    const n = Number(decodeUintWord(result, 0));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

async function balanceOf(rpcUrl, token, user, blockNumber) {
  try {
    const result = await ethCall(rpcUrl, token, encodeCall(SELECTORS.balanceOf, encodeAddress(user)), blockNumber);
    return decodeUintWord(result, 0);
  } catch {
    return 0n;
  }
}

async function loadReserves(rpcUrl, blockNumber) {
  const reserveListResult = await ethCall(rpcUrl, CHAIN.aaveV3Pool, SELECTORS.getReservesList, blockNumber);
  const assets = decodeAddressArray(reserveListResult);
  const reserves = [];
  for (const asset of assets) {
    const data = await ethCall(rpcUrl, CHAIN.aaveV3Pool, encodeCall(SELECTORS.getReserveData, encodeAddress(asset)), blockNumber);
    const config = decodeReserveConfig(decodeUintWord(data, 0));
    const aToken = decodeAddressWord(data, 8);
    const stableDebtToken = decodeAddressWord(data, 9);
    const variableDebtToken = decodeAddressWord(data, 10);
    const symbol = (await readSymbol(rpcUrl, asset, blockNumber)) ?? asset.slice(0, 10);
    const decimals = await readDecimals(rpcUrl, asset, blockNumber, config.decimals);
    const reserve = {
      asset,
      symbol,
      decimals,
      aToken,
      stableDebtToken,
      variableDebtToken,
      config: { ...config, decimals },
    };
    reserves.push(reserve);
  }
  const requestedSymbols = String(process.env.LIQ_RESERVE_SYMBOLS ?? '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const filtered = requestedSymbols.length
    ? reserves.filter((reserve) => requestedSymbols.includes(reserve.symbol.toUpperCase()))
    : reserves;
  reserveByAsset = Object.fromEntries(filtered.map((reserve) => [reserve.asset.toLowerCase(), reserve]));
  return filtered;
}

function addressFromTopic(topic) {
  return `0x${hexStrip(topic).slice(24, 64)}`;
}

function shouldSplitLogRangeError(err) {
  const message = String(err?.message ?? err ?? '').toLowerCase();
  return [
    'block range',
    'range is too large',
    'too many blocks',
    'too many results',
    'more than',
    'response size',
    'limit exceeded',
    'exceeds',
    'exceed',
    'up to a',
    'timeout',
    'timed out',
  ].some((pattern) => message.includes(pattern));
}

function splitBlockRange(start, end) {
  const mid = Math.floor((start + end) / 2);
  return [
    { start, end: mid },
    { start: mid + 1, end },
  ].filter((range) => range.start <= range.end);
}

async function collectRecentDebtUsers(rpcUrl, reserves, fromBlock, toBlock, userLimit) {
  const users = new Map();
  const chunkSize = Math.max(1, Math.floor(envNumber('LIQ_LOG_CHUNK_BLOCKS', 5_000)));
  const minChunkSize = Math.max(1, Math.floor(envNumber('LIQ_MIN_LOG_CHUNK_BLOCKS', 1)));
  const maxLogRequests = Math.floor(envNumber('LIQ_MAX_LOG_REQUESTS', Number.POSITIVE_INFINITY));
  const scanDescending = envBool('LIQ_SCAN_DESCENDING', false);
  const adaptiveLogChunks = envBool('LIQ_ADAPTIVE_LOG_CHUNKS', true);
  let requestCount = 0;
  const scannedRanges = [];
  let splitRangeCount = 0;

  async function getLogsWithAdaptiveRange(reserve, debtToken, start, end) {
    const logs = [];
    const pending = [{ start, end }];
    let exhaustedRequestBudget = false;

    while (pending.length) {
      const range = pending.shift();
      if (requestCount >= maxLogRequests) {
        exhaustedRequestBudget = true;
        break;
      }

      try {
        const rangeLogs = await getLogs(rpcUrl, debtToken, range.start, range.end, [TOPICS.transfer]);
        requestCount += 1;
        scannedRanges.push({
          reserveSymbol: reserve.symbol,
          debtToken,
          fromBlock: range.start,
          toBlock: range.end,
          eventCount: rangeLogs.length,
        });
        logs.push(...rangeLogs);
      } catch (err) {
        requestCount += 1;
        const width = range.end - range.start + 1;
        const canSplit =
          adaptiveLogChunks && width > minChunkSize && shouldSplitLogRangeError(err);
        if (canSplit) {
          const childRanges = splitBlockRange(range.start, range.end);
          splitRangeCount += 1;
          scannedRanges.push({
            reserveSymbol: reserve.symbol,
            debtToken,
            fromBlock: range.start,
            toBlock: range.end,
            eventCount: 0,
            error: err.message,
            handledBySplit: true,
            childRangeCount: childRanges.length,
            countAsScannedBlocks: false,
          });
          const orderedChildRanges = scanDescending ? childRanges.reverse() : childRanges;
          pending.unshift(...orderedChildRanges);
          continue;
        }

        scannedRanges.push({
          reserveSymbol: reserve.symbol,
          debtToken,
          fromBlock: range.start,
          toBlock: range.end,
          eventCount: 0,
          error: err.message,
        });
        console.error(`[aave-liq] logs failed ${reserve.symbol} ${range.start}-${range.end}: ${err.message}`);
      }
    }

    return { logs, exhaustedRequestBudget };
  }

  outer: for (const reserve of reserves) {
    for (const debtToken of [reserve.variableDebtToken, reserve.stableDebtToken]) {
      if (!debtToken || debtToken.toLowerCase() === ZERO_ADDRESS) continue;
      const ranges = [];
      for (let start = fromBlock; start <= toBlock; start += chunkSize) {
        ranges.push({ start, end: Math.min(toBlock, start + chunkSize - 1) });
      }
      if (scanDescending) ranges.reverse();
      for (const { start, end } of ranges) {
        if (requestCount >= maxLogRequests) break outer;
        const { logs, exhaustedRequestBudget } = await getLogsWithAdaptiveRange(reserve, debtToken, start, end);
        for (const log of logs) {
          const from = addressFromTopic(log.topics[1] ?? '');
          const to = addressFromTopic(log.topics[2] ?? '');
          for (const user of [from, to]) {
            if (!user || user.toLowerCase() === ZERO_ADDRESS) continue;
            if (!users.has(user.toLowerCase())) {
              users.set(user.toLowerCase(), {
                address: user,
                firstSeenBlock: hexToNumber(log.blockNumber),
                debtTokensSeen: new Set(),
              });
            }
            users.get(user.toLowerCase()).debtTokensSeen.add(debtToken.toLowerCase());
            if (users.size >= userLimit) break outer;
          }
        }
        if (exhaustedRequestBudget) break outer;
      }
    }
  }
  return {
    users,
    scanState: {
      scanDescending,
      adaptiveLogChunks,
      initialLogChunkBlocks: chunkSize,
      minLogChunkBlocks: minChunkSize,
      maxLogRequests: Number.isFinite(maxLogRequests) ? maxLogRequests : null,
      logRequestCount: requestCount,
      scannedRangeCount: scannedRanges.length,
      splitRangeCount,
      handledSplitRangeCount: scannedRanges.filter((range) => range.handledBySplit).length,
      scannedBlockCount: scannedRanges.reduce(
        (sum, range) =>
          sum + (range.countAsScannedBlocks === false ? 0 : Math.max(0, range.toBlock - range.fromBlock + 1)),
        0,
      ),
      failedRangeCount: scannedRanges.filter((range) => range.error && !range.handledBySplit).length,
      firstScannedRange: scannedRanges[0] ?? null,
      lastScannedRange: scannedRanges[scannedRanges.length - 1] ?? null,
    },
  };
}

async function readUserAccountData(rpcUrl, user, blockNumber) {
  const result = await ethCall(
    rpcUrl,
    CHAIN.aaveV3Pool,
    encodeCall(SELECTORS.getUserAccountData, encodeAddress(user)),
    blockNumber,
  );
  return {
    totalCollateralBase: decodeUintWord(result, 0),
    totalDebtBase: decodeUintWord(result, 1),
    availableBorrowsBase: decodeUintWord(result, 2),
    currentLiquidationThreshold: Number(decodeUintWord(result, 3)),
    ltv: Number(decodeUintWord(result, 4)),
    healthFactorRaw: decodeUintWord(result, 5),
    healthFactor: rayToNumber(decodeUintWord(result, 5)),
  };
}

async function readUserReserveBalances(rpcUrl, reserves, user, blockNumber, tokenPrices) {
  const collaterals = [];
  const debts = [];
  for (const reserve of reserves) {
    const priceUsd = tokenPrices[reserve.asset.toLowerCase()] ?? null;
    const collateralBalance = await balanceOf(rpcUrl, reserve.aToken, user, blockNumber);
    const variableDebt = await balanceOf(rpcUrl, reserve.variableDebtToken, user, blockNumber);
    const stableDebt =
      reserve.stableDebtToken && reserve.stableDebtToken.toLowerCase() !== ZERO_ADDRESS
        ? await balanceOf(rpcUrl, reserve.stableDebtToken, user, blockNumber)
        : 0n;
    const debtBalance = variableDebt + stableDebt;
    if (collateralBalance > 0n) {
      const amount = decimalBaseUnitsToNumber(collateralBalance, reserve.decimals);
      collaterals.push({
        asset: reserve.asset,
        symbol: reserve.symbol,
        amount: formatBaseUnits(collateralBalance, reserve.decimals),
        amountBaseUnits: collateralBalance.toString(),
        amountNumber: amount,
        valueUsd: priceUsd == null ? null : amount * priceUsd,
        liquidationBonusBps: reserve.config.liquidationBonusBps,
        liquidationProtocolFeeBps: reserve.config.liquidationProtocolFeeBps,
      });
    }
    if (debtBalance > 0n) {
      const amount = decimalBaseUnitsToNumber(debtBalance, reserve.decimals);
      debts.push({
        asset: reserve.asset,
        symbol: reserve.symbol,
        amount: formatBaseUnits(debtBalance, reserve.decimals),
        amountBaseUnits: debtBalance.toString(),
        amountNumber: amount,
        valueUsd: priceUsd == null ? null : amount * priceUsd,
        variableDebt: formatBaseUnits(variableDebt, reserve.decimals),
        variableDebtBaseUnits: variableDebt.toString(),
        stableDebt: formatBaseUnits(stableDebt, reserve.decimals),
        stableDebtBaseUnits: stableDebt.toString(),
      });
    }
  }
  collaterals.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  debts.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  return { collaterals, debts };
}

function estimateBestLiquidation(user, balances, gasUsd) {
  let best = null;
  const closeFactor = user.healthFactor < 0.95 ? 1 : 0.5;
  for (const debt of balances.debts) {
    if (!Number.isFinite(debt.valueUsd ?? NaN) || (debt.valueUsd ?? 0) <= 0) continue;
    for (const collateral of balances.collaterals) {
      if (!Number.isFinite(collateral.valueUsd ?? NaN) || (collateral.valueUsd ?? 0) <= 0) continue;
      const bonus = collateral.liquidationBonusBps / 10_000;
      if (!Number.isFinite(bonus) || bonus <= 1) continue;
      const maxDebtByCollateral = (collateral.valueUsd ?? 0) / bonus;
      const debtToCoverUsd = Math.min((debt.valueUsd ?? 0) * closeFactor, maxDebtByCollateral);
      if (debtToCoverUsd <= 0) continue;
      const protocolFeeRate =
        ((collateral.liquidationBonusBps - 10_000) / 10_000) *
        (collateral.liquidationProtocolFeeBps / 10_000);
      const grossProfitUsd = debtToCoverUsd * (bonus - 1);
      const protocolFeeUsd = debtToCoverUsd * protocolFeeRate;
      const seizedCollateralUsd = debtToCoverUsd + grossProfitUsd - protocolFeeUsd;
      const netProfitUsd = grossProfitUsd - protocolFeeUsd - gasUsd;
      const returnOnDebtPct = (netProfitUsd / debtToCoverUsd) * 100;
      const debtToCoverRatio = Math.min(1, debtToCoverUsd / (debt.valueUsd ?? debtToCoverUsd));
      const debtToCoverScale = 1_000_000_000n;
      const debtToCoverScaled = BigInt(Math.max(0, Math.floor(debtToCoverRatio * Number(debtToCoverScale))));
      const debtBalanceBaseUnits = BigInt(debt.amountBaseUnits ?? '0');
      const debtToCoverBaseUnits = (debtBalanceBaseUnits * debtToCoverScaled) / debtToCoverScale;
      const seizedCollateralRatio = Math.min(1, seizedCollateralUsd / (collateral.valueUsd ?? seizedCollateralUsd));
      const seizedCollateralScaled = BigInt(
        Math.max(0, Math.floor(seizedCollateralRatio * Number(debtToCoverScale))),
      );
      const collateralBalanceBaseUnits = BigInt(collateral.amountBaseUnits ?? '0');
      const seizedCollateralBaseUnits =
        (collateralBalanceBaseUnits * seizedCollateralScaled) / debtToCoverScale;
      const collateralDecimals = reserveByAsset[collateral.asset.toLowerCase()]?.decimals ?? 18;
      const estimate = {
        collateralAsset: collateral.asset,
        collateralSymbol: collateral.symbol,
        debtAsset: debt.asset,
        debtSymbol: debt.symbol,
        closeFactor,
        debtToCoverUsd,
        debtToCoverAmount: formatBaseUnits(debtToCoverBaseUnits, reserveByAsset[debt.asset.toLowerCase()]?.decimals ?? 18),
        debtToCoverBaseUnits: debtToCoverBaseUnits.toString(),
        debtToCoverSource: 'estimated-from-current-debt-usd-and-close-factor',
        seizedCollateralUsd,
        seizedCollateralAmount: formatBaseUnits(seizedCollateralBaseUnits, collateralDecimals),
        seizedCollateralBaseUnits: seizedCollateralBaseUnits.toString(),
        seizedCollateralSource: 'estimated-from-current-collateral-usd-bonus-and-protocol-fee',
        liquidationBonusBps: collateral.liquidationBonusBps,
        liquidationProtocolFeeBps: collateral.liquidationProtocolFeeBps,
        grossProfitUsd,
        protocolFeeUsd,
        gasUsd,
        netProfitUsd,
        returnOnDebtPct,
      };
      if (!best || estimate.netProfitUsd > best.netProfitUsd) best = estimate;
    }
  }
  return best;
}

function gateFor(user, bestEstimate, minNetProfitUsd, minReturnPct) {
  if (user.healthFactor >= 1) {
    return { status: 'block', reason: `health factor ${user.healthFactor.toFixed(6)} is not below 1` };
  }
  if (!bestEstimate) return { status: 'block', reason: 'no priced debt/collateral pair available' };
  if (bestEstimate.netProfitUsd < minNetProfitUsd) {
    return {
      status: 'block',
      reason: `estimated net profit ${bestEstimate.netProfitUsd.toFixed(4)} USD below ${minNetProfitUsd} USD`,
    };
  }
  if (bestEstimate.returnOnDebtPct < minReturnPct) {
    return {
      status: 'block',
      reason: `return on debt ${bestEstimate.returnOnDebtPct.toFixed(4)}% below ${minReturnPct}%`,
    };
  }
  return {
    status: 'pass',
    reason: 'health factor, estimated net profit, and return-on-debt gates passed',
  };
}

function candidateId(user, estimate) {
  return [
    'liq',
    CHAIN.shortName,
    user.address.slice(2, 8).toLowerCase(),
    estimate?.debtSymbol?.toLowerCase() ?? 'debt',
    estimate?.collateralSymbol?.toLowerCase() ?? 'collateral',
  ].join('-');
}

async function main() {
  loadDotenv();
  selectChainProfile();
  const rpcUrl = process.env[CHAIN.rpcEnvVar];
  if (!rpcUrl) throw new Error(`${CHAIN.rpcEnvVar} is required`);

  const latestBlock = Number(process.env.LIQ_TO_BLOCK ?? hexToNumber(await rpc(rpcUrl, 'eth_blockNumber', [])));
  const lookbackBlocks = Math.floor(envNumber('LIQ_LOOKBACK_BLOCKS', 50_000));
  const fromBlock = Math.max(1, latestBlock - lookbackBlocks);
  const userLimit = Math.floor(envNumber('LIQ_USER_LIMIT', 200));
  const gasUnits = Math.floor(envNumber('LIQ_GAS_UNITS', 850_000));
  const minNetProfitUsd = envNumber('LIQ_MIN_NET_PROFIT_USD', 5);
  const minReturnPct = envNumber('LIQ_MIN_RETURN_ON_DEBT_PCT', 0.1);

  console.error(`[aave-liq] chain=${CHAIN.name} latest=${latestBlock} lookback=${lookbackBlocks}`);
  const reserves = await loadReserves(rpcUrl, latestBlock);
  console.error(`[aave-liq] reserves=${reserves.length}`);
  const tokenPrices = await fetchTokenPrices();
  const nativeUsd =
    CHAIN.nativePriceSymbol === 'WMATIC'
      ? tokenPrices[reserves.find((r) => r.symbol === 'WMATIC')?.asset?.toLowerCase()] ?? envNumber('LIQ_MATIC_USD', 0.22)
      : envNumber('LIQ_ETH_USD', tokenPrices[reserves.find((r) => r.symbol === 'WETH')?.asset?.toLowerCase()] ?? 1760);
  const gasPriceWei = BigInt(await rpc(rpcUrl, 'eth_gasPrice', []));
  const gasUsd = (Number(gasPriceWei) * gasUnits * nativeUsd) / 1e18;

  const { users, scanState } = await collectRecentDebtUsers(rpcUrl, reserves, fromBlock, latestBlock, userLimit);
  console.error(
    `[aave-liq] debtUsers=${users.size} logRequests=${scanState.logRequestCount} scannedBlocks=${scanState.scannedBlockCount} failedRanges=${scanState.failedRangeCount}`,
  );

  const candidates = [];
  let checked = 0;
  const protocolName = CHAIN.protocol ?? 'Aave V3';
  const strategyType = CHAIN.familyKey ?? 'aave-v3-liquidation-arbitrage';
  for (const entry of users.values()) {
    checked += 1;
    let account;
    try {
      account = await readUserAccountData(rpcUrl, entry.address, latestBlock);
    } catch (err) {
      candidates.push({
        id: `liq-${CHAIN.shortName}-${entry.address.slice(2, 8).toLowerCase()}-error`,
        chain: CHAIN.name,
        strategyType,
        isPureArbitrage: true,
        user: entry.address,
        gate: { status: 'block', reason: `account data unavailable: ${err.message}` },
        liveInterface: { status: 'blocked-by-account-read', requiresCex: false },
      });
      continue;
    }
    if (account.totalDebtBase === 0n) continue;
    const balances = await readUserReserveBalances(rpcUrl, reserves, entry.address, latestBlock, tokenPrices);
    const best = estimateBestLiquidation(account, balances, gasUsd);
    const gate = gateFor(account, best, minNetProfitUsd, minReturnPct);
    const candidate = {
      id: candidateId({ address: entry.address }, best),
      chain: CHAIN.name,
      strategyType,
      isPureArbitrage: true,
      noCexRequired: true,
      user: entry.address,
      observedFromDebtTokenTransfers: [...entry.debtTokensSeen],
      firstSeenBlock: entry.firstSeenBlock,
      blockNumber: latestBlock,
      account: {
        totalCollateralBase: account.totalCollateralBase.toString(),
        totalDebtBase: account.totalDebtBase.toString(),
        healthFactor: account.healthFactor,
        healthFactorRaw: account.healthFactorRaw.toString(),
        currentLiquidationThreshold: account.currentLiquidationThreshold,
        ltv: account.ltv,
      },
      collaterals: balances.collaterals.slice(0, 5),
      debts: balances.debts.slice(0, 5),
      bestEstimate: best,
      gate: {
        ...gate,
        minNetProfitUsd,
        minReturnOnDebtPct: minReturnPct,
      },
      liveInterface: {
        status: gate.status === 'pass' ? 'liquidation-plan-ready-needs-fork-simulation' : 'blocked-by-liquidation-gate',
        requiresCex: false,
        userFlow: `connect wallet, optionally flash-borrow debt asset, call ${protocolName} liquidationCall, swap seized collateral back to repay asset`,
        requiredContracts: {
          aaveV3Pool: CHAIN.aaveV3Pool,
          protocol: protocolName,
        },
        selectors: {
          liquidationCall: SELECTORS.liquidationCall,
        },
        productionStatus: 'not-enabled-until-flash-loan-liquidation-adapter-and-fork-simulation-pass',
      },
    };
    candidates.push(candidate);
    if (checked % 25 === 0) console.error(`[aave-liq] checked=${checked} candidates=${candidates.length}`);
  }

  candidates.sort((a, b) => {
    const ag = a.gate?.status === 'pass' ? 1_000_000 : 0;
    const bg = b.gate?.status === 'pass' ? 1_000_000 : 0;
    return bg + (b.bestEstimate?.netProfitUsd ?? -1_000_000) - (ag + (a.bestEstimate?.netProfitUsd ?? -1_000_000));
  });
  const passing = candidates.filter((candidate) => candidate.gate.status === 'pass');
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      chain: CHAIN,
      pool: CHAIN.aaveV3Pool,
      officialReferences: [
        ...(CHAIN.officialReferences ?? [
          'https://aave.com/docs/developers/smart-contracts/pool',
          'https://aave.com/docs/developers/liquidations',
        ]),
      ],
    },
    methodology: {
      classification:
        CHAIN.familyKey === 'spark-liquidation-arbitrage'
          ? 'pure-on-chain-sparklend-liquidation-arbitrage-scan'
          : 'pure-on-chain-aave-v3-liquidation-arbitrage-scan',
      isPureArbitrage: true,
      noCexRequired: true,
      protocol: protocolName,
      lookbackBlocks,
      fromBlock,
      toBlock: latestBlock,
      userDiscovery: 'recent Transfer events on Aave V3 stable/variable debt tokens',
      userLimit,
      scanState,
      reserveSymbols: reserves.map((reserve) => reserve.symbol),
      gasAssumption: {
        gasUnits,
        gasPriceWei: gasPriceWei.toString(),
        nativeTokenSymbol: CHAIN.nativePriceSymbol,
        nativeUsd,
        gasUsd,
      },
      thresholds: {
        minHealthFactor: '<1',
        minNetProfitUsd,
        minReturnOnDebtPct: minReturnPct,
      },
      caveats: [
        'This is a current-state liquidation scan, not a long-horizon APY backtest.',
        'Profit estimates use token price snapshots and Aave reserve liquidation bonus parameters.',
        'A passing candidate must be simulated on a fork immediately before execution.',
        'Liquidation opportunities can disappear before a public transaction lands.',
        'Production execution requires flash-loan or prefunded debt-asset handling and collateral unwind logic.',
      ],
    },
    summary: {
      reserveCount: reserves.length,
      discoveredDebtUsers: users.size,
      checkedDebtUsers: checked,
      logRequestCount: scanState.logRequestCount,
      scannedBlockCount: scanState.scannedBlockCount,
      failedRangeCount: scanState.failedRangeCount,
      candidateCount: candidates.length,
      passingCount: passing.length,
      requestedPassingCount: 5,
      status:
        passing.length >= 5
          ? 'found-at-least-five-passing-liquidation-opportunities'
          : 'did-not-find-five-passing-liquidation-opportunities',
    },
    candidates,
  };
  await mkdir(dataDir, { recursive: true });
  const outJson = resolve(dataDir, `aave-liquidation-candidates-${CHAIN.shortName}.json`);
  await writeFile(outJson, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    `aaveLiquidations=${artifact.summary.status} users=${users.size} candidates=${candidates.length} passing=${passing.length} artifact=${outJson}`,
  );
  for (const candidate of candidates.slice(0, 10)) {
    console.log(
      `${candidate.id} gate=${candidate.gate.status} hf=${candidate.account?.healthFactor?.toFixed?.(6) ?? 'n/a'} netUsd=${candidate.bestEstimate?.netProfitUsd?.toFixed?.(4) ?? 'n/a'} reason=${candidate.gate.reason}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
