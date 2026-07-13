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
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
  liquidationCall: '0x00a718a9',
};

const TOPICS = {
  liquidationCall: '0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286',
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const REQUESTED_PASSING = 5;
const MIN_ANNUALIZED_NET_RETURN_PCT = 20;

let CHAIN = {
  name: 'Ethereum',
  shortName: 'ethereum',
  chainId: 1,
  rpcEnvVar: 'RPC_ETHEREUM_URL',
  nativePriceSymbol: 'WETH',
  aaveV3Pool: '0x87870Bca3F3fD6335C3F4cE8392D69350B4fA4E2',
};

const CHAIN_PROFILES = {
  ethereum: CHAIN,
  base: {
    name: 'Base',
    shortName: 'base',
    chainId: 8453,
    rpcEnvVar: 'RPC_BASE_URL',
    nativePriceSymbol: 'WETH',
    aaveV3Pool: '0xA238Dd80C259a72e81d7e4664a9801593f98d1c5',
  },
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
  'spark-ethereum': {
    name: 'Spark Ethereum',
    shortName: 'spark-ethereum',
    chainId: 1,
    rpcEnvVar: 'RPC_ETHEREUM_URL',
    nativePriceSymbol: 'WETH',
    aaveV3Pool: '0xC13e21B648A5Ee794902342038FF3aDAB66BE987',
    protocol: 'SparkLend',
    familyKey: 'spark-liquidation-event-replay',
    officialReferences: [
      'https://docs.spark.fi/dev/deployments',
      'https://github.com/sparkdotfi/spark-address-registry',
    ],
  },
};

let reserveByAsset = {};

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
    // RPC can also be passed through the environment.
  }
}

function selectChainProfile() {
  const key = String(process.env.AAVE_REPLAY_CHAIN ?? 'ethereum').toLowerCase();
  if (key === 'eth' || key === 'mainnet') CHAIN = CHAIN_PROFILES.ethereum;
  else if (key === 'arb') CHAIN = CHAIN_PROFILES.arbitrum;
  else if (key === 'spark' || key === 'sparklend' || key === 'spark-mainnet') CHAIN = CHAIN_PROFILES['spark-ethereum'];
  else if (CHAIN_PROFILES[key]) CHAIN = CHAIN_PROFILES[key];
  else throw new Error(`unsupported AAVE_REPLAY_CHAIN ${key}`);
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

function addressFromTopic(topic) {
  return addressFromWord(topic);
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

function decodeBoolWord(result, index) {
  return decodeUintWord(result, index) !== 0n;
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

function decodeAddressArray(result) {
  const offset = Number(decodeUintWord(result, 0));
  const startWord = offset / 32;
  const length = Number(decodeUintWord(result, startWord));
  const out = [];
  for (let i = 0; i < length; i += 1) out.push(decodeAddressWord(result, startWord + 1 + i));
  return out;
}

function decodeReserveConfig(config) {
  const mask16 = 0xffffn;
  return {
    ltvBps: Number(config & mask16),
    liquidationThresholdBps: Number((config >> 16n) & mask16),
    liquidationBonusBps: Number((config >> 32n) & mask16),
    decimals: Number((config >> 48n) & 0xffn),
    liquidationProtocolFeeBps: Number((config >> 152n) & mask16),
  };
}

function decimalBaseUnitsToNumber(value, decimals) {
  if (value === 0n) return 0;
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
  const maxRetries = Math.max(retries, Math.floor(envNumber('AAVE_REPLAY_RPC_RETRIES', retries)));
  const retryDelayMs = Math.floor(envNumber('AAVE_REPLAY_RPC_RETRY_DELAY_MS', 300));
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), envNumber('AAVE_REPLAY_RPC_TIMEOUT_MS', 20_000));
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
      if (attempt < maxRetries) await sleep(retryDelayMs * (attempt + 1));
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

async function readSymbol(rpcUrl, token, blockNumber) {
  try {
    return decodeStringResult(await ethCall(rpcUrl, token, SELECTORS.symbol, blockNumber));
  } catch {
    return null;
  }
}

async function readDecimals(rpcUrl, token, blockNumber, fallback) {
  try {
    const n = Number(decodeUintWord(await ethCall(rpcUrl, token, SELECTORS.decimals, blockNumber), 0));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

async function loadReserves(rpcUrl, blockNumber) {
  const result = await ethCall(rpcUrl, CHAIN.aaveV3Pool, SELECTORS.getReservesList, blockNumber);
  const assets = decodeAddressArray(result);
  const reserves = [];
  for (const asset of assets) {
    const data = await ethCall(
      rpcUrl,
      CHAIN.aaveV3Pool,
      encodeCall(SELECTORS.getReserveData, encodeAddress(asset)),
      blockNumber,
    );
    const config = decodeReserveConfig(decodeUintWord(data, 0));
    const symbol = (await readSymbol(rpcUrl, asset, blockNumber)) ?? asset.slice(0, 10);
    const decimals = await readDecimals(rpcUrl, asset, blockNumber, config.decimals);
    reserves.push({ asset, symbol, decimals, config: { ...config, decimals } });
  }
  const requestedSymbols = String(process.env.AAVE_REPLAY_RESERVE_SYMBOLS ?? '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const filtered = requestedSymbols.length
    ? reserves.filter((reserve) => requestedSymbols.includes(reserve.symbol.toUpperCase()))
    : reserves;
  reserveByAsset = Object.fromEntries(filtered.map((reserve) => [reserve.asset.toLowerCase(), reserve]));
  return filtered;
}

function llamaChainPrefix() {
  if (CHAIN.shortName === 'ethereum') return 'ethereum';
  if (CHAIN.shortName === 'arbitrum') return 'arbitrum';
  if (CHAIN.shortName === 'polygon') return 'polygon';
  return 'base';
}

async function fetchTokenPrices() {
  const prefix = llamaChainPrefix();
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
      // Use symbol fallbacks below.
    }
  }
  for (const reserve of Object.values(reserveByAsset)) {
    const key = reserve.asset.toLowerCase();
    if (prices[key]) continue;
    if (['USDC', 'USDT', 'DAI', 'GHO', 'LUSD', 'FRAX'].includes(reserve.symbol)) prices[key] = 1;
    if (reserve.symbol === 'WETH' || reserve.symbol === 'ETH') prices[key] = envNumber('AAVE_REPLAY_ETH_USD', 1760);
    if (reserve.symbol === 'WBTC' || reserve.symbol === 'cbBTC') prices[key] = envNumber('AAVE_REPLAY_BTC_USD', 110000);
    if (reserve.symbol === 'WMATIC') prices[key] = envNumber('AAVE_REPLAY_MATIC_USD', 0.22);
  }
  return prices;
}

function normalizedScanRange(range) {
  const fromBlock = Number(range?.fromBlock);
  const toBlock = Number(range?.toBlock);
  if (!Number.isFinite(fromBlock) || !Number.isFinite(toBlock)) return null;
  const low = Math.min(fromBlock, toBlock);
  const high = Math.max(fromBlock, toBlock);
  return {
    fromBlock: low,
    toBlock: high,
    eventCount: Math.max(0, Number(range?.eventCount ?? 0)),
    error: range?.error ? String(range.error).replace(/\s+/g, ' ').slice(0, 240) : null,
  };
}

function mergedBlockCount(ranges) {
  const normalized = ranges.map(normalizedScanRange).filter(Boolean).sort((a, b) => a.fromBlock - b.fromBlock);
  if (!normalized.length) return 0;
  let count = 0;
  let currentFrom = normalized[0].fromBlock;
  let currentTo = normalized[0].toBlock;
  for (const range of normalized.slice(1)) {
    if (range.fromBlock <= currentTo + 1) {
      currentTo = Math.max(currentTo, range.toBlock);
      continue;
    }
    count += currentTo - currentFrom + 1;
    currentFrom = range.fromBlock;
    currentTo = range.toBlock;
  }
  count += currentTo - currentFrom + 1;
  return count;
}

function coveragePct(blockCount, targetBlockCount) {
  if (!Number.isFinite(blockCount) || !Number.isFinite(targetBlockCount) || targetBlockCount <= 0) return null;
  return Math.min(100, (blockCount / targetBlockCount) * 100);
}

function buildScanQuality(scannedRanges, fromBlock, toBlock, requestCount, maxLogRequests) {
  const ranges = scannedRanges.map(normalizedScanRange).filter(Boolean);
  const successfulRanges = ranges.filter((range) => !range.error);
  const failedRanges = ranges.filter((range) => range.error);
  const rangesWithEvents = successfulRanges.filter((range) => range.eventCount > 0);
  const targetBlockCount = Math.max(0, toBlock - fromBlock + 1);
  const attemptedBlockCount = mergedBlockCount(ranges);
  const successfulBlockCount = mergedBlockCount(successfulRanges);
  const failedBlockCount = mergedBlockCount(failedRanges);
  const errorCounts = new Map();
  for (const range of failedRanges) {
    errorCounts.set(range.error, (errorCounts.get(range.error) ?? 0) + 1);
  }
  const topErrors = [...errorCounts.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count || a.message.localeCompare(b.message))
    .slice(0, 8);

  return {
    targetBlockCount,
    attemptedRangeCount: ranges.length,
    successfulRangeCount: successfulRanges.length,
    failedRangeCount: failedRanges.length,
    rangesWithEvents: rangesWithEvents.length,
    eventCount: successfulRanges.reduce((sum, range) => sum + range.eventCount, 0),
    attemptedBlockCount,
    successfulBlockCount,
    failedBlockCount,
    attemptedCoveragePct: coveragePct(attemptedBlockCount, targetBlockCount),
    successfulCoveragePct: coveragePct(successfulBlockCount, targetBlockCount),
    requestCount,
    maxLogRequests,
    reachedMaxLogRequests: requestCount >= maxLogRequests,
    topErrors,
    failedRangeSamples: failedRanges.slice(0, 10),
  };
}

function shouldLogScanRange(eventCount) {
  return eventCount > 0 || envBool('AAVE_REPLAY_VERBOSE_LOGS', false);
}

async function collectLiquidationLogs(rpcUrl, fromBlock, toBlock, maxEvents) {
  const resumeEnabled = envBool('AAVE_REPLAY_RESUME', false);
  const existingState = loadReplayState(fromBlock, toBlock);
  const retryFailedRanges = envBool('AAVE_REPLAY_RETRY_FAILED', false);
  const existingScannedRanges = Array.isArray(existingState?.scannedRanges) ? existingState.scannedRanges : [];
  const failedRangesToRetry = retryFailedRanges
    ? existingScannedRanges.map(normalizedScanRange).filter((range) => range?.error)
    : [];
  const logsByKey = new Map((existingState?.logs ?? []).map((log) => [logKey(log), log]));
  const chunkSize = Math.floor(envNumber('AAVE_REPLAY_LOG_CHUNK_BLOCKS', 10_000));
  const maxLogRequests = Math.floor(envNumber('AAVE_REPLAY_MAX_LOG_REQUESTS', 500));
  let requestCount = 0;
  let cursor = Number(existingState?.nextEndBlock ?? toBlock);
  if (failedRangesToRetry.length) {
    cursor = Math.max(cursor, ...failedRangesToRetry.map((range) => range.toBlock));
  }
  const scannedRanges = retryFailedRanges
    ? existingScannedRanges.filter((range) => !range?.error)
    : [...existingScannedRanges];
  for (let end = cursor; end >= fromBlock && logsByKey.size < maxEvents; end -= chunkSize) {
    const start = Math.max(fromBlock, end - chunkSize + 1);
    const beforeRangeCount = scannedRanges.length;
    const logs = [...logsByKey.values()];
    requestCount = await collectLiquidationLogsRange(
      rpcUrl,
      start,
      end,
      maxEvents,
      logs,
      requestCount,
      maxLogRequests,
      scannedRanges,
    );
    for (const log of logs) logsByKey.set(logKey(log), log);
    const newRanges = scannedRanges.slice(beforeRangeCount);
    const earliestScanned = newRanges.length
      ? Math.min(...newRanges.map((range) => range.fromBlock))
      : start;
    cursor = requestCount >= maxLogRequests && earliestScanned > start ? earliestScanned - 1 : start - 1;
    if (resumeEnabled) {
      await saveReplayState({
        schemaVersion: 1,
        chain: CHAIN.shortName,
        pool: CHAIN.aaveV3Pool,
        fromBlock,
        toBlock,
        nextEndBlock: cursor,
        complete: cursor < fromBlock || logsByKey.size >= maxEvents,
        chunkSize,
        scannedRanges,
        logs: [...logsByKey.values()].sort((a, b) => hexToNumber(b.blockNumber) - hexToNumber(a.blockNumber)),
      });
    }
    if (logsByKey.size >= maxEvents || requestCount >= maxLogRequests) break;
  }
  const logs = [...logsByKey.values()].sort((a, b) => hexToNumber(b.blockNumber) - hexToNumber(a.blockNumber)).slice(0, maxEvents);
  const coveredLookback = cursor < fromBlock;
  const maxEventsReached = logs.length >= maxEvents;
  const maxLogRequestsReached = requestCount >= maxLogRequests;
  const stopReason = maxEventsReached
    ? 'max-events-reached'
    : coveredLookback
      ? 'covered-lookback'
      : maxLogRequestsReached
        ? 'max-log-requests-reached'
        : 'loop-ended-before-lookback-complete';
  const scanQuality = buildScanQuality(scannedRanges, fromBlock, toBlock, requestCount, maxLogRequests);
  return {
    logs,
    requestCount,
    scanState: {
      resumeEnabled,
      retryFailedRanges,
      retriedFailedRangeCount: failedRangesToRetry.length,
      fromBlock,
      toBlock,
      nextEndBlock: cursor,
      complete: cursor < fromBlock || logs.length >= maxEvents,
      coveredLookback,
      maxEventsReached,
      maxLogRequestsReached,
      stopReason,
      chunkSize,
      scannedRangeCount: scannedRanges.length,
      scannedBlockCount: scannedRanges.reduce((sum, range) => sum + Math.max(0, range.toBlock - range.fromBlock + 1), 0),
      scanQuality,
      persistedEventCount: logsByKey.size,
      stateFile: resumeEnabled ? replayStatePath() : null,
    },
  };
}

async function collectLiquidationLogsRange(
  rpcUrl,
  fromBlock,
  toBlock,
  maxEvents,
  logs,
  requestCount,
  maxLogRequests,
  scannedRanges,
) {
  if (logs.length >= maxEvents || requestCount >= maxLogRequests) return requestCount;
  try {
    const chunk = await getLogs(rpcUrl, CHAIN.aaveV3Pool, fromBlock, toBlock, [TOPICS.liquidationCall]);
    requestCount += 1;
    scannedRanges.push({ fromBlock, toBlock, eventCount: chunk.length });
    for (const log of chunk) {
      logs.push(log);
      if (logs.length >= maxEvents) return requestCount;
    }
    if (shouldLogScanRange(chunk.length)) {
      console.error(`[aave-replay] logs ${fromBlock}-${toBlock} count=${chunk.length} total=${logs.length}`);
    }
    return requestCount;
  } catch (err) {
    const message = err.message ?? String(err);
    if (fromBlock < toBlock && /10 block range|block range|too large|more than/i.test(message)) {
      const maxSpan = /10 block range/i.test(message) ? 10 : Math.max(1, Math.floor((toBlock - fromBlock + 1) / 2));
      if (maxSpan < toBlock - fromBlock + 1) {
        if (maxSpan === 10) {
          return collectSmallLogRangesDescending(
            rpcUrl,
            fromBlock,
            toBlock,
            maxSpan,
            maxEvents,
            logs,
            requestCount,
            maxLogRequests,
            scannedRanges,
          );
        }
        for (let end = toBlock; end >= fromBlock; end -= maxSpan) {
          const start = Math.max(fromBlock, end - maxSpan + 1);
          requestCount = await collectLiquidationLogsRange(
            rpcUrl,
            start,
            end,
            maxEvents,
            logs,
            requestCount,
            maxLogRequests,
            scannedRanges,
          );
          if (logs.length >= maxEvents || requestCount >= maxLogRequests) return requestCount;
        }
        return requestCount;
      }
    }
    requestCount += 1;
    console.error(`[aave-replay] logs failed ${fromBlock}-${toBlock}: ${message}`);
    return requestCount;
  }
}

async function collectSmallLogRangesDescending(
  rpcUrl,
  fromBlock,
  toBlock,
  span,
  maxEvents,
  logs,
  requestCount,
  maxLogRequests,
  scannedRanges,
) {
  const concurrency = Math.max(1, Math.floor(envNumber('AAVE_REPLAY_LOG_CONCURRENCY', 4)));
  const batchDelayMs = Math.floor(envNumber('AAVE_REPLAY_LOG_BATCH_DELAY_MS', 0));
  const ranges = [];
  for (let end = toBlock; end >= fromBlock; end -= span) {
    ranges.push({ fromBlock: Math.max(fromBlock, end - span + 1), toBlock: end });
  }
  for (let i = 0; i < ranges.length && logs.length < maxEvents && requestCount < maxLogRequests; i += concurrency) {
    const remaining = Math.max(0, maxLogRequests - requestCount);
    const batch = ranges.slice(i, i + Math.min(concurrency, remaining));
    const results = await Promise.all(
      batch.map(async (range) => {
        try {
          const chunk = await getLogs(
            rpcUrl,
            CHAIN.aaveV3Pool,
            range.fromBlock,
            range.toBlock,
            [TOPICS.liquidationCall],
          );
          return { ...range, chunk };
        } catch (err) {
          return { ...range, error: err.message ?? String(err), chunk: [] };
        }
      }),
    );
    requestCount += results.length;
    for (const result of results) {
      scannedRanges.push({
        fromBlock: result.fromBlock,
        toBlock: result.toBlock,
        eventCount: result.chunk.length,
        error: result.error,
      });
      if (result.error) {
        console.error(`[aave-replay] logs failed ${result.fromBlock}-${result.toBlock}: ${result.error}`);
      }
      let addedCount = 0;
      for (const log of result.chunk) {
        logs.push(log);
        addedCount += 1;
        if (logs.length >= maxEvents) break;
      }
      if (!result.error && shouldLogScanRange(result.chunk.length)) {
        console.error(
          `[aave-replay] logs ${result.fromBlock}-${result.toBlock} count=${result.chunk.length} added=${addedCount} total=${logs.length}`,
        );
      }
      if (logs.length >= maxEvents) break;
    }
    if (batchDelayMs > 0 && logs.length < maxEvents && requestCount < maxLogRequests) {
      await sleep(batchDelayMs);
    }
  }
  return requestCount;
}

function decodeLiquidationLog(log) {
  const data = log.data ?? '0x';
  return {
    blockNumber: hexToNumber(log.blockNumber),
    transactionHash: log.transactionHash,
    logIndex: hexToNumber(log.logIndex),
    collateralAsset: addressFromTopic(log.topics[1] ?? ''),
    debtAsset: addressFromTopic(log.topics[2] ?? ''),
    user: addressFromTopic(log.topics[3] ?? ''),
    debtToCover: decodeUintWord(data, 0),
    liquidatedCollateralAmount: decodeUintWord(data, 1),
    liquidator: decodeAddressWord(data, 2),
    receiveAToken: decodeBoolWord(data, 3),
  };
}

function logKey(log) {
  return `${String(log.transactionHash).toLowerCase()}:${hexToNumber(log.logIndex)}`;
}

function replayStatePath() {
  const custom = process.env.AAVE_REPLAY_STATE_FILE;
  return custom ? resolve(root, custom) : resolve(dataDir, `aave-liquidation-replay-state-${CHAIN.shortName}.json`);
}

function loadReplayState(fromBlock, toBlock) {
  if (!envBool('AAVE_REPLAY_RESUME', false)) return null;
  try {
    const state = JSON.parse(readFileSync(replayStatePath(), 'utf8'));
    if (String(state.pool).toLowerCase() !== CHAIN.aaveV3Pool.toLowerCase()) return null;
    if (Number(state.fromBlock) !== Number(fromBlock) || Number(state.toBlock) !== Number(toBlock)) return null;
    return {
      ...state,
      logs: Array.isArray(state.logs) ? state.logs : [],
      scannedRanges: Array.isArray(state.scannedRanges) ? state.scannedRanges : [],
    };
  } catch {
    return null;
  }
}

async function saveReplayState(state) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    replayStatePath(),
    `${JSON.stringify(
      {
        ...state,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

function stats(values) {
  if (!values.length) return { min: null, max: null, mean: null, median: null, sum: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return { min: sorted[0], max: sorted[sorted.length - 1], mean, median, sum: values.reduce((a, b) => a + b, 0) };
}

function annualizedPct(totalNetProfitUsd, capitalUsd, durationDays) {
  if (!Number.isFinite(totalNetProfitUsd) || !Number.isFinite(capitalUsd) || capitalUsd <= 0) return null;
  if (!Number.isFinite(durationDays) || durationDays <= 0) return null;
  return (totalNetProfitUsd / capitalUsd) * (365 / durationDays) * 100;
}

function gateFor(metrics, minEvents, minWinRatePct, minAnnualizedPct, minMedianNetProfitUsd) {
  if (metrics.sampleCount < minEvents) {
    return { status: 'block', reason: `insufficient historical liquidation samples: ${metrics.sampleCount}/${minEvents}` };
  }
  if ((metrics.netWinRatePct ?? 0) < minWinRatePct) {
    return { status: 'block', reason: `net win rate ${metrics.netWinRatePct?.toFixed(2) ?? 'n/a'}% below ${minWinRatePct}%` };
  }
  if ((metrics.annualizedNetReturnPct ?? -Infinity) < minAnnualizedPct) {
    return {
      status: 'block',
      reason: `annualized net return ${metrics.annualizedNetReturnPct?.toFixed(2) ?? 'n/a'}% below ${minAnnualizedPct}%`,
    };
  }
  if ((metrics.netProfitUsd.median ?? -Infinity) < minMedianNetProfitUsd) {
    return {
      status: 'block',
      reason: `median net profit ${metrics.netProfitUsd.median?.toFixed(4) ?? 'n/a'} USD below ${minMedianNetProfitUsd} USD`,
    };
  }
  return {
    status: 'pass',
    reason: 'historical sample count, net win rate, annualized return, and median net profit gates passed',
  };
}

function buildCandidates(events, tokenPrices, gasUsd, fromBlock, toBlock, durationDays) {
  const grouped = new Map();
  for (const event of events) {
    const collateral = reserveByAsset[event.collateralAsset.toLowerCase()];
    const debt = reserveByAsset[event.debtAsset.toLowerCase()];
    if (!collateral || !debt) continue;
    const debtPrice = tokenPrices[debt.asset.toLowerCase()] ?? null;
    const collateralPrice = tokenPrices[collateral.asset.toLowerCase()] ?? null;
    if (debtPrice == null || collateralPrice == null) continue;
    const debtAmount = decimalBaseUnitsToNumber(event.debtToCover, debt.decimals);
    const collateralAmount = decimalBaseUnitsToNumber(event.liquidatedCollateralAmount, collateral.decimals);
    const debtToCoverUsd = debtAmount * debtPrice;
    const collateralUsd = collateralAmount * collateralPrice;
    const grossProfitUsd = collateralUsd - debtToCoverUsd;
    const netProfitUsd = grossProfitUsd - gasUsd;
    const returnOnDebtPct = debtToCoverUsd > 0 ? (netProfitUsd / debtToCoverUsd) * 100 : null;
    const key = `${debt.symbol}-${collateral.symbol}`.toLowerCase();
    const sample = {
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      logIndex: event.logIndex,
      user: event.user,
      liquidator: event.liquidator,
      receiveAToken: event.receiveAToken,
      debtAsset: debt.asset,
      debtSymbol: debt.symbol,
      debtToCover: event.debtToCover.toString(),
      debtToCoverHuman: formatBaseUnits(event.debtToCover, debt.decimals),
      collateralAsset: collateral.asset,
      collateralSymbol: collateral.symbol,
      liquidatedCollateralAmount: event.liquidatedCollateralAmount.toString(),
      liquidatedCollateralHuman: formatBaseUnits(event.liquidatedCollateralAmount, collateral.decimals),
      debtToCoverUsd,
      collateralUsd,
      grossProfitUsd,
      gasUsd,
      netProfitUsd,
      returnOnDebtPct,
    };
    if (!grouped.has(key)) grouped.set(key, { debt, collateral, samples: [] });
    grouped.get(key).samples.push(sample);
  }

  const minEvents = Math.floor(envNumber('AAVE_REPLAY_MIN_EVENTS', 5));
  const minWinRatePct = envNumber('AAVE_REPLAY_MIN_WIN_RATE_PCT', 60);
  const minAnnualizedPct = envNumber('AAVE_REPLAY_MIN_ANNUALIZED_PCT', MIN_ANNUALIZED_NET_RETURN_PCT);
  const minMedianNetProfitUsd = envNumber('AAVE_REPLAY_MIN_MEDIAN_NET_PROFIT_USD', 1);
  const configuredCapitalUsd = envNumber('AAVE_REPLAY_CAPITAL_USD', 10_000);
  const candidates = [];

  for (const { debt, collateral, samples } of grouped.values()) {
    samples.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    const netProfits = samples.map((s) => s.netProfitUsd).filter((n) => Number.isFinite(n));
    const debtUsd = samples.map((s) => s.debtToCoverUsd).filter((n) => Number.isFinite(n) && n > 0);
    const returns = samples.map((s) => s.returnOnDebtPct).filter((n) => Number.isFinite(n));
    const netProfitStats = stats(netProfits);
    const maxCapitalUsd = debtUsd.length ? Math.max(...debtUsd) : configuredCapitalUsd;
    const capitalUsd = Math.max(configuredCapitalUsd, maxCapitalUsd);
    const metrics = {
      sampleCount: samples.length,
      fromBlock,
      toBlock,
      durationDays,
      capitalUsd,
      grossProfitUsd: stats(samples.map((s) => s.grossProfitUsd).filter((n) => Number.isFinite(n))),
      netProfitUsd: netProfitStats,
      returnOnDebtPct: stats(returns),
      netWinRatePct: samples.length ? (samples.filter((s) => s.netProfitUsd > 0).length / samples.length) * 100 : 0,
      annualizedNetReturnPct: annualizedPct(netProfitStats.sum, capitalUsd, durationDays),
    };
    const gate = gateFor(metrics, minEvents, minWinRatePct, minAnnualizedPct, minMedianNetProfitUsd);
    const representative = samples.reduce((best, sample) => (sample.netProfitUsd > best.netProfitUsd ? sample : best), samples[0]);
    const replayPrefix = CHAIN.familyKey === 'spark-liquidation-event-replay' ? 'spark-replay' : 'aave-replay';
    const protocolName = CHAIN.protocol ?? 'Aave V3';
    candidates.push({
      id: `${replayPrefix}-${CHAIN.shortName}-${debt.symbol.toLowerCase()}-${collateral.symbol.toLowerCase()}`,
      chain: CHAIN.name,
      strategyType: CHAIN.familyKey ?? 'aave-v3-liquidation-event-replay',
      isPureArbitrage: true,
      noCexRequired: true,
      user: representative.user,
      blockNumber: representative.blockNumber,
      account: {
        totalCollateralBase: 'historical-event-replay',
        totalDebtBase: 'historical-event-replay',
        healthFactor: 0,
        healthFactorRaw: 'historical-event-replay',
        currentLiquidationThreshold: 0,
        ltv: 0,
      },
      bestEstimate: {
        collateralAsset: collateral.asset,
        collateralSymbol: collateral.symbol,
        debtAsset: debt.asset,
        debtSymbol: debt.symbol,
        debtToCoverUsd: representative.debtToCoverUsd,
        liquidationBonusBps: collateral.config.liquidationBonusBps,
        grossProfitUsd: representative.grossProfitUsd,
        protocolFeeUsd: 0,
        gasUsd: representative.gasUsd,
        netProfitUsd: representative.netProfitUsd,
        returnOnDebtPct: representative.returnOnDebtPct ?? 0,
      },
      metrics,
      gate: {
        ...gate,
        minEvents,
        minWinRatePct,
        minAnnualizedNetReturnPct: minAnnualizedPct,
        minMedianNetProfitUsd,
      },
      liveInterface: {
        status: gate.status === 'pass' ? 'historical-edge-needs-current-event-and-fork-simulation' : 'blocked-by-event-replay',
        requiresCex: false,
        userFlow:
          `connect wallet, run liquidation searcher, source debt asset through wallet/vault/flash loan, call ${protocolName} liquidationCall, unwind collateral`,
        requiredContracts: {
          aaveV3Pool: CHAIN.aaveV3Pool,
          protocol: protocolName,
        },
        selectors: {
          liquidationCall: SELECTORS.liquidationCall,
        },
        productionStatus: 'not-enabled-until-current-event-detection-and-fork-simulation-pass',
      },
      samples,
    });
  }
  candidates.sort((a, b) => {
    const gateBonus = (b.gate.status === 'pass' ? 1_000_000 : 0) - (a.gate.status === 'pass' ? 1_000_000 : 0);
    if (gateBonus) return gateBonus;
    return (b.metrics.annualizedNetReturnPct ?? -Infinity) - (a.metrics.annualizedNetReturnPct ?? -Infinity);
  });
  return candidates;
}

async function main() {
  loadDotenv();
  selectChainProfile();
  const rpcUrl = process.env[CHAIN.rpcEnvVar];
  if (!rpcUrl) throw new Error(`${CHAIN.rpcEnvVar} is required`);

  const latestBlock = Number(process.env.AAVE_REPLAY_TO_BLOCK ?? hexToNumber(await rpc(rpcUrl, 'eth_blockNumber', [])));
  const lookbackBlocks = Math.floor(envNumber('AAVE_REPLAY_LOOKBACK_BLOCKS', 250_000));
  const fromBlock = Math.max(1, latestBlock - lookbackBlocks);
  const maxEvents = Math.floor(envNumber('AAVE_REPLAY_MAX_EVENTS', 200));
  const gasUnits = Math.floor(envNumber('AAVE_REPLAY_GAS_UNITS', 950_000));
  const durationDays = Math.max(
    envNumber('AAVE_REPLAY_MIN_DURATION_DAYS', 1),
    (latestBlock - fromBlock) * envNumber('AAVE_REPLAY_SECONDS_PER_BLOCK', CHAIN.chainId === 1 ? 12 : 2) / 86_400,
  );

  console.error(`[aave-replay] chain=${CHAIN.name} latest=${latestBlock} from=${fromBlock} maxEvents=${maxEvents}`);
  const reserves = await loadReserves(rpcUrl, latestBlock);
  const tokenPrices = await fetchTokenPrices();
  const nativeReserve = reserves.find((reserve) => reserve.symbol === CHAIN.nativePriceSymbol || reserve.symbol === 'WETH');
  const nativeUsd =
    tokenPrices[nativeReserve?.asset?.toLowerCase?.() ?? ''] ??
    (CHAIN.nativePriceSymbol === 'WMATIC'
      ? envNumber('AAVE_REPLAY_MATIC_USD', 0.22)
      : envNumber('AAVE_REPLAY_ETH_USD', 1760));
  const gasPriceWei = BigInt(await rpc(rpcUrl, 'eth_gasPrice', []));
  const gasUsd = (Number(gasPriceWei) * gasUnits * nativeUsd) / 1e18;
  const { logs, requestCount, scanState } = await collectLiquidationLogs(rpcUrl, fromBlock, latestBlock, maxEvents);
  console.error(
    `[aave-replay] liquidationLogs=${logs.length} logRequests=${requestCount} scannedBlocks=${scanState.scannedBlockCount} nextEnd=${scanState.nextEndBlock}`,
  );
  const events = logs.map(decodeLiquidationLog);
  const candidates = buildCandidates(events, tokenPrices, gasUsd, fromBlock, latestBlock, durationDays);
  const passing = candidates.filter((candidate) => candidate.gate.status === 'pass');

  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      chain: CHAIN,
      pool: CHAIN.aaveV3Pool,
      event: {
        name: 'LiquidationCall',
        signature: 'LiquidationCall(address,address,address,uint256,uint256,address,bool)',
        topic0: TOPICS.liquidationCall,
      },
      officialReferences: [
        ...(CHAIN.officialReferences ?? [
          'https://aave.com/docs/aave-v3/smart-contracts/pool',
          'https://aave.com/help/borrowing/liquidations',
        ]),
      ],
    },
    methodology: {
      classification:
        CHAIN.familyKey === 'spark-liquidation-event-replay'
          ? 'pure-on-chain-sparklend-liquidation-event-replay'
          : 'pure-on-chain-aave-v3-liquidation-event-replay',
      isPureArbitrage: true,
      noCexRequired: true,
      protocol: CHAIN.protocol ?? 'Aave V3',
      lookbackBlocks,
      fromBlock,
      toBlock: latestBlock,
      durationDays,
      maxEvents,
      eventCount: events.length,
      logRequests: requestCount,
      scanState,
      scanQuality: scanState.scanQuality,
      gasAssumption: {
        gasUnits,
        gasPriceWei: gasPriceWei.toString(),
        nativeTokenSymbol: CHAIN.nativePriceSymbol,
        nativeUsd,
        gasUsd,
      },
      caveats: [
        'This replay groups actual Aave V3 LiquidationCall events by debt/collateral pair.',
        'USD conversion uses current token price snapshots or configured fallbacks, not historical oracle prices.',
        'Historical liquidations prove the opportunity class existed, not that a public transaction can capture the next event.',
        'Passing replay candidates still require current-event detection, private routing, fork simulation, and loss-reverting execution.',
      ],
    },
    summary: {
      reserveCount: reserves.length,
      discoveredDebtUsers: events.length,
      checkedDebtUsers: candidates.length,
      eventCount: events.length,
      scannedBlockCount: scanState.scannedBlockCount,
      successfulScannedBlockCount: scanState.scanQuality.successfulBlockCount,
      failedScannedBlockCount: scanState.scanQuality.failedBlockCount,
      attemptedCoveragePct: scanState.scanQuality.attemptedCoveragePct,
      successfulCoveragePct: scanState.scanQuality.successfulCoveragePct,
      failedRangeCount: scanState.scanQuality.failedRangeCount,
      topScanErrors: scanState.scanQuality.topErrors,
      nextEndBlock: scanState.nextEndBlock,
      scanComplete: scanState.complete,
      scanStopReason: scanState.stopReason,
      candidateCount: candidates.length,
      passingCount: passing.length,
      requestedPassingCount: REQUESTED_PASSING,
      status:
        passing.length >= REQUESTED_PASSING
          ? 'found-at-least-five-passing-aave-liquidation-event-replays'
          : 'did-not-find-five-passing-aave-liquidation-event-replays',
    },
    candidates,
  };

  await mkdir(dataDir, { recursive: true });
  const outJson = resolve(dataDir, `aave-liquidation-event-replay-candidates-${CHAIN.shortName}.json`);
  await writeFile(outJson, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    `aaveLiquidationReplay=${artifact.summary.status} events=${events.length} candidates=${candidates.length} passing=${passing.length} artifact=${outJson}`,
  );
  for (const candidate of candidates.slice(0, 10)) {
    console.log(
      `${candidate.id} gate=${candidate.gate.status} samples=${candidate.metrics.sampleCount} annualized=${candidate.metrics.annualizedNetReturnPct?.toFixed?.(2) ?? 'n/a'} win=${candidate.metrics.netWinRatePct?.toFixed?.(2) ?? 'n/a'} medianNetUsd=${candidate.metrics.netProfitUsd.median?.toFixed?.(4) ?? 'n/a'} reason=${candidate.gate.reason}`,
    );
  }
}

main().catch((err) => {
  console.error('[aave-replay] failed', err);
  process.exit(1);
});
