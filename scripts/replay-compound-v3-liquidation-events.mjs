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
  isLiquidatable: '0x042e02cf',
  borrowBalanceOf: '0x374c49b4',
  collateralBalanceOf: '0x5c2549ee',
  baseToken: '0xc55dae63',
  numAssets: '0xa46fe83b',
  getAssetInfo: '0xc8c7fe6b',
  getReserves: '0x0902f1ac',
  targetReserves: '0x32176c49',
  getCollateralReserves: '0x9ff567f8',
  quoteCollateral: '0x7ac88ed1',
  absorb: '0xc3cecfd2',
  buyCollateral: '0xe4e6e779',
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
};

const TOPICS = {
  supply: '0xd1cf3d156d5f8f0d50f6c122ed609cec09d35c9b9fb3fff6ea0959134dae424e',
  withdraw: '0x9b1bfa7fa9ee420a16e124f794c35ac9f90472acc99140eb2f6447c714cad8eb',
  transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  absorbCollateral: '0x9850ab1af75177e4a9201c65a2cf7976d5d28e40ef63494b44366f86b2f9412e',
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const UINT_256 = 1n << 256n;
const INT_256_SIGN = 1n << 255n;

let CHAIN = {
  name: 'Ethereum',
  shortName: 'ethereum',
  chainId: 1,
  rpcEnvVar: 'RPC_ETHEREUM_URL',
  nativePriceSymbol: 'WETH',
  comet: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
  market: 'cUSDCv3',
};

const CHAIN_PROFILES = {
  ethereum: CHAIN,
};

function selectChainProfile() {
  const key = String(process.env.COMP_REPLAY_CHAIN ?? process.env.COMP_LIQ_CHAIN ?? 'ethereum').toLowerCase();
  if (key === 'eth' || key === 'mainnet') CHAIN = CHAIN_PROFILES.ethereum;
  else if (CHAIN_PROFILES[key]) CHAIN = CHAIN_PROFILES[key];
  else throw new Error(`unsupported COMP_LIQ_CHAIN ${key}`);
  if (process.env.COMP_LIQ_COMET_ADDRESS) CHAIN = { ...CHAIN, comet: process.env.COMP_LIQ_COMET_ADDRESS };
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

function decodeIntWord(result, index) {
  const value = decodeUintWord(result, index);
  return value >= INT_256_SIGN ? value - UINT_256 : value;
}

function decodeAddressWord(result, index) {
  return addressFromWord(wordAt(result, index));
}

function decodeBoolWord(result, index) {
  return decodeUintWord(result, index) !== 0n;
}

function decimalBaseUnitsToNumber(value, decimals) {
  if (value === 0n) return 0;
  return Number(value) / 10 ** decimals;
}

function parseUnitsDecimal(value, decimals) {
  const raw = String(value).trim();
  if (!raw) return 0n;
  const [whole, frac = ''] = raw.split('.');
  const normalized = `${whole || '0'}${frac.padEnd(decimals, '0').slice(0, decimals)}`;
  return BigInt(normalized.replace(/^0+(?=\d)/, '') || '0');
}

function formatBaseUnits(value, decimals) {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const raw = abs.toString().padStart(decimals + 1, '0');
  const whole = decimals === 0 ? raw : raw.slice(0, -decimals);
  const frac = decimals === 0 ? '' : raw.slice(-decimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole || '0'}${frac ? `.${frac}` : ''}`;
}

function encodeCall(selector, ...words) {
  return selector + words.join('');
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

async function rpc(rpcUrl, method, params, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const rpcTimeoutMs = envNumber(
      'COMP_REPLAY_RPC_TIMEOUT_MS',
      envNumber('COMP_LIQ_RPC_TIMEOUT_MS', 20_000),
    );
    const timer = setTimeout(() => controller.abort(), rpcTimeoutMs);
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

async function readSymbol(rpcUrl, token, blockNumber) {
  try {
    const result = await ethCall(rpcUrl, token, SELECTORS.symbol, blockNumber);
    return decodeStringResult(result);
  } catch {
    return null;
  }
}

async function readDecimals(rpcUrl, token, blockNumber, fallback = 18) {
  try {
    const result = await ethCall(rpcUrl, token, SELECTORS.decimals, blockNumber);
    const n = Number(decodeUintWord(result, 0));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

async function fetchTokenPrices(tokens) {
  const coins = [...tokens].map((token) => `${CHAIN.shortName}:${token}`).join(',');
  const prices = {};
  if (coins) {
    try {
      const res = await fetch(`https://coins.llama.fi/prices/current/${coins}`);
      const json = await res.json();
      for (const token of tokens) {
        const price = Number(json?.coins?.[`${CHAIN.shortName}:${token}`]?.price);
        if (Number.isFinite(price) && price > 0) prices[token.toLowerCase()] = price;
      }
    } catch {
      // Fall through to symbol defaults.
    }
  }
  return prices;
}

async function loadCometAssets(rpcUrl, blockNumber) {
  const baseToken = decodeAddressWord(await ethCall(rpcUrl, CHAIN.comet, SELECTORS.baseToken, blockNumber), 0);
  const baseSymbol = (await readSymbol(rpcUrl, baseToken, blockNumber)) ?? 'BASE';
  const baseDecimals = await readDecimals(rpcUrl, baseToken, blockNumber, 6);
  const numAssets = Number(decodeUintWord(await ethCall(rpcUrl, CHAIN.comet, SELECTORS.numAssets, blockNumber), 0));
  const assets = [];
  for (let i = 0; i < numAssets; i += 1) {
    const data = await ethCall(rpcUrl, CHAIN.comet, encodeCall(SELECTORS.getAssetInfo, encodeUint(i)), blockNumber);
    const asset = decodeAddressWord(data, 1);
    const symbol = (await readSymbol(rpcUrl, asset, blockNumber)) ?? asset.slice(0, 10);
    const decimals = await readDecimals(rpcUrl, asset, blockNumber, 18);
    const reserves = await readCollateralReserves(rpcUrl, asset, blockNumber);
    assets.push({
      offset: Number(decodeUintWord(data, 0)),
      asset,
      symbol,
      decimals,
      priceFeed: decodeAddressWord(data, 2),
      scale: decodeUintWord(data, 3).toString(),
      borrowCollateralFactor: decodeUintWord(data, 4).toString(),
      liquidateCollateralFactor: decodeUintWord(data, 5).toString(),
      liquidationFactor: decodeUintWord(data, 6).toString(),
      supplyCap: decodeUintWord(data, 7).toString(),
      collateralReserves: reserves.toString(),
      collateralReservesHuman: formatBaseUnits(reserves, decimals),
    });
  }
  return { baseToken, baseSymbol, baseDecimals, assets };
}

async function readCollateralReserves(rpcUrl, asset, blockNumber) {
  try {
    const result = await ethCall(
      rpcUrl,
      CHAIN.comet,
      encodeCall(SELECTORS.getCollateralReserves, encodeAddress(asset)),
      blockNumber,
    );
    return decodeUintWord(result, 0);
  } catch {
    return 0n;
  }
}

async function collectRecentAccounts(rpcUrl, fromBlock, toBlock, accountLimit) {
  const accounts = new Map();
  const chunkSize = Math.floor(envNumber('COMP_LIQ_LOG_CHUNK_BLOCKS', 2_000));
  const topics = [[TOPICS.supply, TOPICS.withdraw, TOPICS.transfer]];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = Math.min(toBlock, start + chunkSize - 1);
    let logs = [];
    try {
      logs = await getLogs(rpcUrl, CHAIN.comet, start, end, topics);
    } catch (err) {
      console.error(`[compound-liq] logs failed ${start}-${end}: ${err.message}`);
      continue;
    }
    for (const log of logs) {
      const topic0 = String(log.topics[0]).toLowerCase();
      const seen = [];
      if ([TOPICS.supply, TOPICS.withdraw, TOPICS.transfer].includes(topic0)) {
        if (log.topics[1]) seen.push(addressFromTopic(log.topics[1]));
        if (log.topics[2]) seen.push(addressFromTopic(log.topics[2]));
      }
      for (const account of seen) {
        if (!account || account.toLowerCase() === ZERO_ADDRESS) continue;
        const key = account.toLowerCase();
        if (!accounts.has(key)) {
          accounts.set(key, {
            address: account,
            firstSeenBlock: hexToNumber(log.blockNumber),
            eventTopicsSeen: new Set(),
          });
        }
        accounts.get(key).eventTopicsSeen.add(topic0);
        if (accounts.size >= accountLimit) return accounts;
      }
    }
  }
  return accounts;
}

async function readAccount(rpcUrl, account, assets, blockNumber) {
  const isLiquidatable = decodeBoolWord(
    await ethCall(rpcUrl, CHAIN.comet, encodeCall(SELECTORS.isLiquidatable, encodeAddress(account)), blockNumber),
    0,
  );
  const borrowBalance = decodeUintWord(
    await ethCall(rpcUrl, CHAIN.comet, encodeCall(SELECTORS.borrowBalanceOf, encodeAddress(account)), blockNumber),
    0,
  );
  const collaterals = [];
  for (const asset of assets) {
    const balance = decodeUintWord(
      await ethCall(
        rpcUrl,
        CHAIN.comet,
        encodeCall(SELECTORS.collateralBalanceOf, encodeAddress(account), encodeAddress(asset.asset)),
        blockNumber,
      ),
      0,
    );
    if (balance > 0n) {
      collaterals.push({
        ...asset,
        balance: balance.toString(),
        amount: formatBaseUnits(balance, asset.decimals),
        amountNumber: decimalBaseUnitsToNumber(balance, asset.decimals),
      });
    }
  }
  return { isLiquidatable, borrowBalance, collaterals };
}

async function quoteCollateral(rpcUrl, asset, baseAmount, blockNumber) {
  const result = await ethCall(
    rpcUrl,
    CHAIN.comet,
    encodeCall(SELECTORS.quoteCollateral, encodeAddress(asset), encodeUint(baseAmount)),
    blockNumber,
  );
  return decodeUintWord(result, 0);
}

function gateFor(account, best, reservesBelowTarget, minNetProfitUsd, minReturnPct) {
  if (!account.isLiquidatable) return { status: 'block', reason: 'account is not currently liquidatable' };
  if (!reservesBelowTarget) return { status: 'block', reason: 'base reserves are not below target reserves' };
  if (!best) return { status: 'block', reason: 'no collateral quote fits the account collateral balance' };
  if (best.netProfitUsd < minNetProfitUsd) {
    return {
      status: 'block',
      reason: `estimated net profit ${best.netProfitUsd.toFixed(4)} USD below ${minNetProfitUsd} USD`,
    };
  }
  if (best.returnOnBasePct < minReturnPct) {
    return {
      status: 'block',
      reason: `return on base ${best.returnOnBasePct.toFixed(4)}% below ${minReturnPct}%`,
    };
  }
  return {
    status: 'pass',
    reason: 'liquidatable account, reserves gate, discount quote, net profit, and return gates passed',
  };
}

async function estimateBestBuy(rpcUrl, account, base, tokenPrices, baseAmounts, gasUsd, blockNumber) {
  let best = null;
  const basePrice = tokenPrices[base.baseToken.toLowerCase()] ?? 1;
  for (const collateral of account.collaterals) {
    const collateralPrice = tokenPrices[collateral.asset.toLowerCase()];
    if (!Number.isFinite(collateralPrice) || collateralPrice <= 0) continue;
    const collateralBalance = BigInt(collateral.balance);
    for (const baseAmountRaw of baseAmounts) {
      let quotedCollateral;
      try {
        quotedCollateral = await quoteCollateral(rpcUrl, collateral.asset, baseAmountRaw, blockNumber);
      } catch {
        continue;
      }
      if (quotedCollateral <= 0n || quotedCollateral > collateralBalance) continue;
      const baseAmountNumber = decimalBaseUnitsToNumber(baseAmountRaw, base.baseDecimals);
      const collateralAmountNumber = decimalBaseUnitsToNumber(quotedCollateral, collateral.decimals);
      const baseCostUsd = baseAmountNumber * basePrice;
      const collateralValueUsd = collateralAmountNumber * collateralPrice;
      const grossProfitUsd = collateralValueUsd - baseCostUsd;
      const netProfitUsd = grossProfitUsd - gasUsd;
      const returnOnBasePct = baseCostUsd > 0 ? (netProfitUsd / baseCostUsd) * 100 : 0;
      const estimate = {
        collateralAsset: collateral.asset,
        collateralSymbol: collateral.symbol,
        baseAsset: base.baseToken,
        baseSymbol: base.baseSymbol,
        baseAmount: baseAmountRaw.toString(),
        baseAmountHuman: formatBaseUnits(baseAmountRaw, base.baseDecimals),
        quotedCollateral: quotedCollateral.toString(),
        quotedCollateralHuman: formatBaseUnits(quotedCollateral, collateral.decimals),
        collateralBalance: collateral.balance,
        collateralBalanceHuman: collateral.amount,
        baseCostUsd,
        collateralValueUsd,
        grossProfitUsd,
        gasUsd,
        netProfitUsd,
        returnOnBasePct,
      };
      if (!best || estimate.netProfitUsd > best.netProfitUsd) best = estimate;
    }
  }
  return best;
}

function candidateId(account, best) {
  return [
    'compound-v3-liq',
    CHAIN.shortName,
    account.address.slice(2, 8).toLowerCase(),
    best?.baseSymbol?.toLowerCase() ?? 'base',
    best?.collateralSymbol?.toLowerCase() ?? 'collateral',
  ].join('-');
}

function decodeAbsorbCollateralLog(log) {
  const clean = hexStrip(log.data);
  const collateralAbsorbed = clean.length >= 64 ? BigInt(`0x${clean.slice(0, 64)}`) : 0n;
  const usdValue = clean.length >= 128 ? BigInt(`0x${clean.slice(64, 128)}`) : 0n;
  return {
    blockNumber: hexToNumber(log.blockNumber),
    transactionHash: log.transactionHash,
    logIndex: hexToNumber(log.logIndex),
    absorber: addressFromTopic(log.topics[1]),
    borrower: addressFromTopic(log.topics[2]),
    asset: addressFromTopic(log.topics[3]),
    collateralAbsorbed,
    usdValue,
  };
}

function eventKey(event) {
  return `${String(event.transactionHash).toLowerCase()}:${event.logIndex}`;
}

function serializeEvent(event) {
  return {
    ...event,
    collateralAbsorbed: event.collateralAbsorbed.toString(),
    usdValue: event.usdValue.toString(),
  };
}

function hydrateEvent(event) {
  return {
    ...event,
    collateralAbsorbed: BigInt(event.collateralAbsorbed ?? 0),
    usdValue: BigInt(event.usdValue ?? 0),
  };
}

function replayStatePath() {
  const custom = process.env.COMP_REPLAY_STATE_FILE;
  return custom ? resolve(root, custom) : resolve(dataDir, `compound-v3-liquidation-replay-state-${CHAIN.shortName}.json`);
}

function loadReplayState(fromBlock, toBlock) {
  if (!envBool('COMP_REPLAY_RESUME', false)) return null;
  try {
    const state = JSON.parse(readFileSync(replayStatePath(), 'utf8'));
    if (String(state.comet).toLowerCase() !== CHAIN.comet.toLowerCase()) return null;
    if (Number(state.fromBlock) !== Number(fromBlock) || Number(state.toBlock) !== Number(toBlock)) return null;
    return {
      ...state,
      events: Array.isArray(state.events) ? state.events.map(hydrateEvent) : [],
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
        events: state.events.map(serializeEvent),
      },
      null,
      2,
    )}\n`,
  );
}

async function getLogsAdaptive(rpcUrl, fromBlock, toBlock) {
  try {
    return await getLogs(rpcUrl, CHAIN.comet, fromBlock, toBlock, [TOPICS.absorbCollateral]);
  } catch (err) {
    if (fromBlock >= toBlock) {
      console.error(`[compound-replay] logs failed ${fromBlock}-${toBlock}: ${err.message}`);
      return [];
    }
    const mid = Math.floor((fromBlock + toBlock) / 2);
    const left = await getLogsAdaptive(rpcUrl, fromBlock, mid);
    const right = await getLogsAdaptive(rpcUrl, mid + 1, toBlock);
    return [...left, ...right];
  }
}

async function collectAbsorbCollateralEvents(rpcUrl, fromBlock, toBlock, maxEvents, maxRequests) {
  const resumeEnabled = envBool('COMP_REPLAY_RESUME', false);
  const existingState = loadReplayState(fromBlock, toBlock);
  const eventsByKey = new Map((existingState?.events ?? []).map((event) => [eventKey(event), event]));
  const chunkSize = Math.floor(envNumber('COMP_REPLAY_LOG_CHUNK_BLOCKS', 1_000));
  let requests = 0;
  let cursor = Number(existingState?.nextEndBlock ?? toBlock);
  const scannedRanges = [...(existingState?.scannedRanges ?? [])];
  for (let end = cursor; end >= fromBlock && eventsByKey.size < maxEvents; end -= chunkSize) {
    if (requests >= maxRequests) break;
    const start = Math.max(fromBlock, end - chunkSize + 1);
    requests += 1;
    const logs = await getLogsAdaptive(rpcUrl, start, end);
    for (const log of logs.sort((a, b) => hexToNumber(b.blockNumber) - hexToNumber(a.blockNumber))) {
      const event = decodeAbsorbCollateralLog(log);
      eventsByKey.set(eventKey(event), event);
      if (eventsByKey.size >= maxEvents) break;
    }
    scannedRanges.push({ fromBlock: start, toBlock: end, eventCount: logs.length });
    cursor = start - 1;
    if (resumeEnabled) {
      await saveReplayState({
        schemaVersion: 1,
        chain: CHAIN.shortName,
        comet: CHAIN.comet,
        fromBlock,
        toBlock,
        nextEndBlock: cursor,
        complete: cursor < fromBlock || eventsByKey.size >= maxEvents,
        chunkSize,
        scannedRanges,
        events: [...eventsByKey.values()].sort((a, b) => b.blockNumber - a.blockNumber),
      });
    }
  }
  const events = [...eventsByKey.values()].sort((a, b) => b.blockNumber - a.blockNumber).slice(0, maxEvents);
  return {
    events,
    requests,
    state: {
      resumeEnabled,
      fromBlock,
      toBlock,
      nextEndBlock: cursor,
      complete: cursor < fromBlock || events.length >= maxEvents,
      chunkSize,
      scannedRangeCount: scannedRanges.length,
      scannedBlockCount: scannedRanges.reduce((sum, range) => sum + Math.max(0, range.toBlock - range.fromBlock + 1), 0),
      persistedEventCount: eventsByKey.size,
      stateFile: resumeEnabled ? replayStatePath() : null,
    },
  };
}

async function estimateBestEventBuy(rpcUrl, event, asset, base, tokenPrices, baseAmounts, gasUsd) {
  const basePrice = tokenPrices[base.baseToken.toLowerCase()] ?? 1;
  const collateralPrice = tokenPrices[asset.asset.toLowerCase()];
  if (!Number.isFinite(collateralPrice) || collateralPrice <= 0) return null;
  let best = null;
  for (const baseAmountRaw of baseAmounts) {
    let quotedCollateral;
    try {
      quotedCollateral = await quoteCollateral(rpcUrl, asset.asset, baseAmountRaw, event.blockNumber);
    } catch {
      continue;
    }
    if (quotedCollateral <= 0n || quotedCollateral > event.collateralAbsorbed) continue;
    const baseAmountNumber = decimalBaseUnitsToNumber(baseAmountRaw, base.baseDecimals);
    const collateralAmountNumber = decimalBaseUnitsToNumber(quotedCollateral, asset.decimals);
    const baseCostUsd = baseAmountNumber * basePrice;
    const collateralValueUsd = collateralAmountNumber * collateralPrice;
    const grossProfitUsd = collateralValueUsd - baseCostUsd;
    const netProfitUsd = grossProfitUsd - gasUsd;
    const returnOnBasePct = baseCostUsd > 0 ? (netProfitUsd / baseCostUsd) * 100 : 0;
    const estimate = {
      collateralAsset: asset.asset,
      collateralSymbol: asset.symbol,
      baseAsset: base.baseToken,
      baseSymbol: base.baseSymbol,
      baseAmount: baseAmountRaw.toString(),
      baseAmountHuman: formatBaseUnits(baseAmountRaw, base.baseDecimals),
      quotedCollateral: quotedCollateral.toString(),
      quotedCollateralHuman: formatBaseUnits(quotedCollateral, asset.decimals),
      collateralAbsorbed: event.collateralAbsorbed.toString(),
      collateralAbsorbedHuman: formatBaseUnits(event.collateralAbsorbed, asset.decimals),
      baseCostUsd,
      collateralValueUsd,
      grossProfitUsd,
      gasUsd,
      netProfitUsd,
      returnOnBasePct,
      pricingMode: 'current-token-price-with-historical-comet-quote',
    };
    if (!best || estimate.netProfitUsd > best.netProfitUsd) best = estimate;
  }
  return best;
}

function replayGateFor({ preAccount, best, reservesBelowTarget, minNetProfitUsd, minReturnPct }) {
  if (!preAccount?.isLiquidatable) return { status: 'block', reason: 'borrower was not liquidatable at the pre-event block' };
  if (!reservesBelowTarget) return { status: 'block', reason: 'base reserves were not below target reserves after absorb' };
  if (!best) return { status: 'block', reason: 'no post-absorb buyCollateral quote fits absorbed collateral' };
  if (best.netProfitUsd < minNetProfitUsd) {
    return {
      status: 'block',
      reason: `estimated net profit ${best.netProfitUsd.toFixed(4)} USD below ${minNetProfitUsd} USD`,
    };
  }
  if (best.returnOnBasePct < minReturnPct) {
    return {
      status: 'block',
      reason: `return on base ${best.returnOnBasePct.toFixed(4)}% below ${minReturnPct}%`,
    };
  }
  return {
    status: 'pass',
    reason: 'historical absorb event, pre-event liquidatability, post-absorb reserve gate, collateral quote, net profit, and return gates passed',
  };
}

async function main() {
  loadDotenv();
  selectChainProfile();
  const rpcUrl = process.env[CHAIN.rpcEnvVar];
  if (!rpcUrl) throw new Error(`${CHAIN.rpcEnvVar} is required`);

  const latestBlock = Number(process.env.COMP_REPLAY_TO_BLOCK ?? hexToNumber(await rpc(rpcUrl, 'eth_blockNumber', [])));
  const lookbackBlocks = Math.floor(envNumber('COMP_REPLAY_LOOKBACK_BLOCKS', 250_000));
  const fromBlock = Math.max(1, latestBlock - lookbackBlocks);
  const maxEvents = Math.floor(envNumber('COMP_REPLAY_MAX_EVENTS', 25));
  const maxRequests = Math.floor(envNumber('COMP_REPLAY_MAX_LOG_REQUESTS', 120));
  const minNetProfitUsd = envNumber('COMP_REPLAY_MIN_NET_PROFIT_USD', 5);
  const minReturnPct = envNumber('COMP_REPLAY_MIN_RETURN_ON_BASE_PCT', 0.1);
  const gasUnits = Math.floor(envNumber('COMP_REPLAY_GAS_UNITS', 1_400_000));

  console.error(`[compound-replay] chain=${CHAIN.name} market=${CHAIN.market} latest=${latestBlock} lookback=${lookbackBlocks}`);
  const { events, requests, state: scanState } = await collectAbsorbCollateralEvents(
    rpcUrl,
    fromBlock,
    latestBlock,
    maxEvents,
    maxRequests,
  );
  console.error(
    `[compound-replay] absorbCollateralEvents=${events.length} logRequests=${requests} scannedBlocks=${scanState.scannedBlockCount} nextEnd=${scanState.nextEndBlock}`,
  );

  const sampleBlock = events[0]?.blockNumber ?? latestBlock;
  const base = await loadCometAssets(rpcUrl, sampleBlock);
  const tokenSet = new Set([base.baseToken, ...base.assets.map((asset) => asset.asset)]);
  const tokenPrices = await fetchTokenPrices(tokenSet);
  if (!tokenPrices[base.baseToken.toLowerCase()] && ['USDC', 'USDT', 'DAI'].includes(base.baseSymbol)) {
    tokenPrices[base.baseToken.toLowerCase()] = 1;
  }
  const nativeUsd = envNumber(
    'COMP_REPLAY_ETH_USD',
    tokenPrices[base.assets.find((a) => a.symbol === 'WETH')?.asset?.toLowerCase()] ?? 1760,
  );
  const gasPriceWei = BigInt(await rpc(rpcUrl, 'eth_gasPrice', []));
  const gasUsd = (Number(gasPriceWei) * gasUnits * nativeUsd) / 1e18;
  const baseAmounts = String(process.env.COMP_REPLAY_BASE_AMOUNTS ?? '10,100,1000')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => parseUnitsDecimal(item, base.baseDecimals))
    .filter((amount) => amount > 0n);

  const assetByAddress = new Map(base.assets.map((asset) => [asset.asset.toLowerCase(), asset]));
  const candidates = [];
  let checkedEvents = 0;
  for (const event of events) {
    checkedEvents += 1;
    const preBlock = Math.max(1, event.blockNumber - 1);
    const asset = assetByAddress.get(event.asset.toLowerCase());
    if (!asset) {
      candidates.push({
        id: `compound-v3-liq-replay-${CHAIN.shortName}-${event.blockNumber}-${event.logIndex}-unknown-asset`,
        chain: CHAIN.name,
        strategyType: 'compound-v3-liquidation-arbitrage',
        isPureArbitrage: true,
        noCexRequired: true,
        user: event.borrower,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        liquidationEvent: {
          ...event,
          collateralAbsorbed: event.collateralAbsorbed.toString(),
          usdValue: event.usdValue.toString(),
        },
        gate: { status: 'block', reason: `absorbed collateral asset ${event.asset} not in current Comet asset list` },
        liveInterface: { status: 'blocked-by-compound-liquidation-gate', requiresCex: false },
      });
      continue;
    }
    let preAccount = null;
    let readError = null;
    try {
      preAccount = await readAccount(rpcUrl, event.borrower, base.assets, preBlock);
    } catch (err) {
      readError = err.message;
    }
    let reserves = 0n;
    let targetReserves = 0n;
    let reservesBelowTarget = false;
    try {
      reserves = decodeIntWord(await ethCall(rpcUrl, CHAIN.comet, SELECTORS.getReserves, event.blockNumber), 0);
      targetReserves = decodeUintWord(await ethCall(rpcUrl, CHAIN.comet, SELECTORS.targetReserves, event.blockNumber), 0);
      reservesBelowTarget = reserves < BigInt(targetReserves);
    } catch {
      // Keep default false so the candidate stays blocked.
    }
    const best = preAccount?.isLiquidatable
      ? await estimateBestEventBuy(rpcUrl, event, asset, base, tokenPrices, baseAmounts, gasUsd)
      : null;
    const gate = readError
      ? { status: 'block', reason: `pre-event account data unavailable: ${readError}` }
      : replayGateFor({ preAccount, best, reservesBelowTarget, minNetProfitUsd, minReturnPct });
    candidates.push({
      id: `compound-v3-liq-replay-${CHAIN.shortName}-${event.blockNumber}-${event.logIndex}-${event.borrower.slice(2, 8).toLowerCase()}-${asset.symbol.toLowerCase()}`,
      chain: CHAIN.name,
      strategyType: 'compound-v3-liquidation-arbitrage',
      isPureArbitrage: true,
      noCexRequired: true,
      user: event.borrower,
      blockNumber: event.blockNumber,
      preEventBlock: preBlock,
      transactionHash: event.transactionHash,
      liquidationEvent: {
        absorber: event.absorber,
        borrower: event.borrower,
        asset: event.asset,
        collateralSymbol: asset.symbol,
        collateralAbsorbed: event.collateralAbsorbed.toString(),
        collateralAbsorbedHuman: formatBaseUnits(event.collateralAbsorbed, asset.decimals),
        usdValue: event.usdValue.toString(),
        logIndex: event.logIndex,
      },
      account: preAccount
        ? {
            isLiquidatable: preAccount.isLiquidatable,
            borrowBalance: preAccount.borrowBalance.toString(),
            borrowBalanceHuman: formatBaseUnits(preAccount.borrowBalance, base.baseDecimals),
            collateralCount: preAccount.collaterals.length,
          }
        : null,
      collaterals: preAccount?.collaterals?.slice(0, 8) ?? [],
      bestEstimate: best,
      reserves: {
        reserves: reserves.toString(),
        reservesHuman: formatBaseUnits(reserves, base.baseDecimals),
        targetReserves: targetReserves.toString(),
        targetReservesHuman: formatBaseUnits(targetReserves, base.baseDecimals),
        reservesBelowTarget,
      },
      gate: {
        ...gate,
        minNetProfitUsd,
        minReturnOnBasePct: minReturnPct,
      },
      liveInterface: {
        status: gate.status === 'pass' ? 'compound-liquidation-replay-passed-needs-current-fork-simulation' : 'blocked-by-compound-liquidation-gate',
        requiresCex: false,
        userFlow: 'connect wallet, optionally flash-borrow base asset, call Comet absorb, then buyCollateral for discounted collateral when current-state gates match the historical replay',
        requiredContracts: {
          comet: CHAIN.comet,
        },
        selectors: {
          absorb: SELECTORS.absorb,
          buyCollateral: SELECTORS.buyCollateral,
        },
        productionStatus: 'not-enabled-until-current-state-candidate-and-fork-simulation-pass',
      },
    });
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
      comet: CHAIN.comet,
      officialReferences: [
        'https://docs.compound.finance/liquidation/',
        'https://github.com/compound-finance/comet/blob/main/contracts/CometMainInterface.sol',
        'https://github.com/compound-finance/comet/tree/main/deployments',
      ],
    },
    methodology: {
      classification: 'pure-on-chain-compound-v3-historical-absorb-event-replay',
      isPureArbitrage: true,
      noCexRequired: true,
      eventTopic: TOPICS.absorbCollateral,
      eventSignature: 'AbsorbCollateral(address,address,address,uint256,uint256)',
      lookbackBlocks,
      fromBlock,
      toBlock: latestBlock,
      maxEvents,
      logRequests: requests,
      scanState,
      checkedEvents,
      replayModel:
        'read borrower isLiquidatable at blockNumber-1, read post-absorb reserves and quoteCollateral at blockNumber, then estimate discounted collateral buy after gas',
      baseAmounts: baseAmounts.map((amount) => formatBaseUnits(amount, base.baseDecimals)),
      baseAsset: {
        token: base.baseToken,
        symbol: base.baseSymbol,
        decimals: base.baseDecimals,
      },
      collateralAssets: base.assets,
      gasAssumption: {
        gasUnits,
        gasPriceWei: gasPriceWei.toString(),
        nativeTokenSymbol: CHAIN.nativePriceSymbol,
        nativeUsd,
        gasUsd,
      },
      thresholds: {
        preEventLiquidatable: true,
        postAbsorbReservesBelowTarget: true,
        minNetProfitUsd,
        minReturnOnBasePct: minReturnPct,
      },
      caveats: [
        'This replay uses historical Comet state for liquidatability, reserves, and quoteCollateral, but current token USD prices for rough profitability ranking.',
        'A historical pass is not a live-trading pass; current state, fresh fork simulation, calldata, and collateral unwind must still pass.',
        'Free-tier RPC log and archive-state limits can hide older liquidations or fail pre-event reads.',
      ],
    },
    summary: {
      eventCount: events.length,
      checkedEvents,
      scannedBlockCount: scanState.scannedBlockCount,
      nextEndBlock: scanState.nextEndBlock,
      scanComplete: scanState.complete,
      candidateCount: candidates.length,
      passingCount: passing.length,
      requestedPassingCount: 5,
      status:
        passing.length >= 5
          ? 'found-at-least-five-passing-compound-v3-liquidation-event-replays'
          : 'did-not-find-five-passing-compound-v3-liquidation-event-replays',
    },
    candidates,
  };
  await mkdir(dataDir, { recursive: true });
  const outJson = resolve(dataDir, `compound-v3-liquidation-candidates-event-replay-${CHAIN.shortName}.json`);
  await writeFile(outJson, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    `compoundV3LiquidationReplay=${artifact.summary.status} events=${events.length} candidates=${candidates.length} passing=${passing.length} artifact=${outJson}`,
  );
  for (const candidate of candidates.slice(0, 10)) {
    console.log(
      `${candidate.id} gate=${candidate.gate.status} preLiquidatable=${candidate.account?.isLiquidatable ?? 'n/a'} reservesBelowTarget=${candidate.reserves?.reservesBelowTarget ?? 'n/a'} netUsd=${candidate.bestEstimate?.netProfitUsd?.toFixed?.(4) ?? 'n/a'} reason=${candidate.gate.reason}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
