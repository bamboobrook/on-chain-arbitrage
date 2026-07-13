#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');

const MORPHO_API = 'https://api.morpho.org/graphql';
const WAD = 10n ** 18n;

const SELECTORS = {
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
  idToMarketParams: '0x2c3c9157',
};

const TOPICS = {
  liquidate: '0xa4946ede45d0c6f06a0f5ce92c9ad3b4751452d2fe0e25010783bcab57a67e41',
};

let CHAIN = {
  name: 'Ethereum',
  shortName: 'ethereum',
  chainId: 1,
  rpcEnvVar: 'RPC_ETHEREUM_URL',
  priceSlug: 'ethereum',
  morpho: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
};

const CHAIN_PROFILES = {
  ethereum: CHAIN,
  base: {
    name: 'Base',
    shortName: 'base',
    chainId: 8453,
    rpcEnvVar: 'RPC_BASE_URL',
    priceSlug: 'base',
    morpho: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
  },
};

function selectChainProfile() {
  const key = String(process.env.MORPHO_REPLAY_CHAIN ?? process.env.MORPHO_LIQ_CHAIN ?? 'ethereum').toLowerCase();
  if (key === 'eth' || key === 'mainnet') CHAIN = CHAIN_PROFILES.ethereum;
  else if (CHAIN_PROFILES[key]) CHAIN = CHAIN_PROFILES[key];
  else throw new Error(`unsupported MORPHO_REPLAY_CHAIN ${key}`);
  if (process.env.MORPHO_BLUE_ADDRESS) CHAIN = { ...CHAIN, morpho: process.env.MORPHO_BLUE_ADDRESS };
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
    // RPC can be supplied externally.
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

function decodeStringResult(result) {
  const clean = hexStrip(result);
  if (!clean || clean.length < 64) return null;
  const first = clean.slice(0, 64);
  const offset = Number(BigInt(`0x${first}`));
  if (offset === 32 && clean.length >= 128) {
    const length = Number(BigInt(`0x${clean.slice(64, 128)}`));
    const data = clean.slice(128, 128 + length * 2);
    return Buffer.from(data, 'hex').toString('utf8').replace(/\0+$/, '') || null;
  }
  const bytes32 = Buffer.from(first.replace(/(00)+$/g, ''), 'hex')
    .toString('utf8')
    .replace(/\0+$/, '');
  return bytes32 || null;
}

async function rpc(rpcUrl, method, params, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      envNumber('MORPHO_REPLAY_RPC_TIMEOUT_MS', 20_000),
    );
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

async function gql(query, variables = {}) {
  const res = await fetch(MORPHO_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.[0]?.message ?? `Morpho GraphQL ${res.status}`);
  }
  return json.data;
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

async function blockTimestamp(rpcUrl, blockNumber) {
  const block = await rpc(rpcUrl, 'eth_getBlockByNumber', [toBlockTag(blockNumber), false]);
  return new Date(hexToNumber(block.timestamp) * 1000).toISOString();
}

async function readSymbol(rpcUrl, token, blockNumber) {
  try {
    return decodeStringResult(await ethCall(rpcUrl, token, SELECTORS.symbol, blockNumber));
  } catch {
    return null;
  }
}

async function readDecimals(rpcUrl, token, blockNumber, fallback = 18) {
  try {
    const n = Number(decodeUintWord(await ethCall(rpcUrl, token, SELECTORS.decimals, blockNumber), 0));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

function encodeIdToMarketParams(id) {
  return SELECTORS.idToMarketParams + pad32(id);
}

async function readMarketParams(rpcUrl, marketId, blockNumber) {
  const result = await ethCall(rpcUrl, CHAIN.morpho, encodeIdToMarketParams(marketId), blockNumber);
  return {
    loanToken: decodeAddressWord(result, 0),
    collateralToken: decodeAddressWord(result, 1),
    oracle: decodeAddressWord(result, 2),
    irm: decodeAddressWord(result, 3),
    lltv: decodeUintWord(result, 4).toString(),
  };
}

function formatBaseUnits(value, decimals) {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const raw = abs.toString().padStart(decimals + 1, '0');
  const whole = decimals === 0 ? raw : raw.slice(0, -decimals);
  const frac = decimals === 0 ? '' : raw.slice(-decimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole || '0'}${frac ? `.${frac}` : ''}`;
}

function numberFromBaseUnits(value, decimals) {
  return Number(formatBaseUnits(value, decimals));
}

function bigIntFrom(value) {
  return BigInt(String(value ?? 0));
}

async function fetchTokenPrices(tokens) {
  const coins = [...tokens].map((token) => `${CHAIN.priceSlug}:${token}`).join(',');
  const prices = {};
  if (coins) {
    try {
      const res = await fetch(`https://coins.llama.fi/prices/current/${coins}`);
      const json = await res.json();
      for (const token of tokens) {
        const price = Number(json?.coins?.[`${CHAIN.priceSlug}:${token}`]?.price);
        if (Number.isFinite(price) && price > 0) prices[token.toLowerCase()] = price;
      }
    } catch {
      // Symbol fallbacks below are intentionally limited to common stablecoins.
    }
  }
  return prices;
}

function fallbackPrice(symbol) {
  return ['DAI', 'USDC', 'USDT', 'USDS', 'FRAX', 'USDE'].includes(String(symbol).toUpperCase()) ? 1 : null;
}

function decodeLiquidateLog(log) {
  return {
    marketId: log.topics[1],
    caller: addressFromTopic(log.topics[2]),
    borrower: addressFromTopic(log.topics[3]),
    repaidAssets: decodeUintWord(log.data, 0),
    repaidShares: decodeUintWord(log.data, 1),
    seizedAssets: decodeUintWord(log.data, 2),
    badDebtAssets: decodeUintWord(log.data, 3),
    badDebtShares: decodeUintWord(log.data, 4),
  };
}

function eventLogKey(log) {
  return `${log.transactionHash}:${Number(hexToBigInt(log.logIndex))}`;
}

function candidateIdFor(log, event) {
  const block = Number(hexToBigInt(log.blockNumber));
  const index = Number(hexToBigInt(log.logIndex));
  return [
    'morpho-blue-liq-replay',
    CHAIN.shortName,
    block,
    index,
    event.borrower.slice(2, 8).toLowerCase(),
  ].join('-');
}

function candidateIdForGraphql(item) {
  return [
    'morpho-blue-liq-replay',
    CHAIN.shortName,
    item.blockNumber,
    item.logIndex,
    item.user.address.slice(2, 8).toLowerCase(),
  ].join('-');
}

function lltvNumber(marketParams) {
  return Number(BigInt(marketParams.lltv)) / Number(WAD);
}

function baseGate(candidate, thresholds) {
  const best = candidate.bestEstimate;
  if (!candidate.pricing.loanPriceUsd || !candidate.pricing.collateralPriceUsd) {
    return {
      status: 'block',
      reason: 'historical event found but token pricing is incomplete',
    };
  }
  if (best.repayUsd <= 0 || best.collateralUsd <= 0) {
    return {
      status: 'block',
      reason: 'historical event has zero repay or seized collateral value',
    };
  }
  if (best.netProfitUsd < thresholds.minNetProfitUsd) {
    return {
      status: 'block',
      reason: `historical estimated net profit ${best.netProfitUsd.toFixed(4)} USD below ${thresholds.minNetProfitUsd} USD`,
    };
  }
  if (best.returnOnRepayPct < thresholds.minReturnOnRepayPct) {
    return {
      status: 'block',
      reason: `historical return on repay ${best.returnOnRepayPct.toFixed(4)}% below ${thresholds.minReturnOnRepayPct}%`,
    };
  }
  return {
    status: 'block',
    reason: 'historical event is economically positive, but current liquidatable borrower and repeatability are not yet proven',
  };
}

function applyReplayGates(candidates, window, thresholds) {
  const byMarket = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.marketId}:${candidate.marketParams.loanToken}:${candidate.marketParams.collateralToken}`;
    const bucket = byMarket.get(key) ?? [];
    bucket.push(candidate);
    byMarket.set(key, bucket);
  }

  for (const bucket of byMarket.values()) {
    const marketEventCount = bucket.length;
    const marketNetProfitUsd = bucket.reduce((sum, candidate) => sum + candidate.bestEstimate.netProfitUsd, 0);
    const maxRepayUsd = Math.max(...bucket.map((candidate) => candidate.bestEstimate.repayUsd), 0);
    const annualizedNetReturnPct =
      window.durationDays > 0 && maxRepayUsd > 0
        ? (marketNetProfitUsd / maxRepayUsd) * (365 / window.durationDays) * 100
        : null;

    for (const candidate of bucket) {
      const eventGate = baseGate(candidate, thresholds);
      const replayMetrics = {
        marketEventCount,
        marketNetProfitUsd,
        maxRepayUsd,
        replayWindowDays: window.durationDays,
        annualizedNetReturnPct,
        minReplayDaysForGate: thresholds.minReplayDays,
        minMarketEventsForGate: thresholds.minMarketEvents,
        minAnnualizedNetReturnPct: thresholds.minAnnualizedNetReturnPct,
      };
      let gate = eventGate;
      if (eventGate.reason.startsWith('historical event is economically positive')) {
        if (window.durationDays < thresholds.minReplayDays) {
          gate = {
            status: 'block',
            reason: `replay window ${window.durationDays.toFixed(2)} days below ${thresholds.minReplayDays} days stability gate`,
          };
        } else if (marketEventCount < thresholds.minMarketEvents) {
          gate = {
            status: 'block',
            reason: `market has ${marketEventCount} historical liquidations below ${thresholds.minMarketEvents} event stability gate`,
          };
        } else if (annualizedNetReturnPct == null || annualizedNetReturnPct < thresholds.minAnnualizedNetReturnPct) {
          gate = {
            status: 'block',
            reason: `market replay annualized net return ${annualizedNetReturnPct?.toFixed(4) ?? 'n/a'}% below ${thresholds.minAnnualizedNetReturnPct}%`,
          };
        } else if (thresholds.requireCurrentLiquidatable) {
          gate = {
            status: 'block',
            reason: 'historical stability gates passed, but current liquidatable borrower must be found and fork-simulated before enabling live execution',
          };
        } else {
          gate = {
            status: 'pass',
            reason: 'historical event, repeatability, and annualized return gates passed; current-state fork gate disabled by env',
          };
        }
      }

      candidate.replayMetrics = replayMetrics;
      candidate.gate = {
        ...gate,
        minNetProfitUsd: thresholds.minNetProfitUsd,
        minReturnOnRepayPct: thresholds.minReturnOnRepayPct,
        minAnnualizedNetReturnPct: thresholds.minAnnualizedNetReturnPct,
        minReplayDaysForGate: thresholds.minReplayDays,
        minMarketEventsForGate: thresholds.minMarketEvents,
        requireCurrentLiquidatable: thresholds.requireCurrentLiquidatable,
      };
      candidate.liveInterface.status =
        candidate.gate.status === 'pass'
          ? 'morpho-liquidation-replay-plan-ready-needs-current-fork-simulation'
          : 'blocked-by-morpho-liquidation-replay-gate';
    }
  }
}

async function buildCandidate(rpcUrl, log, caches, thresholds) {
  const event = decodeLiquidateLog(log);
  const blockNumber = Number(hexToBigInt(log.blockNumber));
  const marketCacheKey = `${event.marketId}:${blockNumber}`;
  let marketParams = caches.markets.get(marketCacheKey);
  if (!marketParams) {
    marketParams = await readMarketParams(rpcUrl, event.marketId, blockNumber);
    caches.markets.set(marketCacheKey, marketParams);
  }

  const tokenMeta = {};
  for (const token of [marketParams.loanToken, marketParams.collateralToken]) {
    const key = `${token.toLowerCase()}:${blockNumber}`;
    if (!caches.tokens.has(key)) {
      const [symbol, decimals] = await Promise.all([
        readSymbol(rpcUrl, token, blockNumber),
        readDecimals(rpcUrl, token, blockNumber),
      ]);
      caches.tokens.set(key, { symbol: symbol ?? token.slice(0, 6), decimals });
    }
    tokenMeta[token.toLowerCase()] = caches.tokens.get(key);
  }

  const priceTokens = new Set([marketParams.loanToken, marketParams.collateralToken]);
  const priceKey = [...priceTokens].map((token) => token.toLowerCase()).sort().join(',');
  let prices = caches.prices.get(priceKey);
  if (!prices) {
    prices = await fetchTokenPrices(priceTokens);
    caches.prices.set(priceKey, prices);
  }

  const loanMeta = tokenMeta[marketParams.loanToken.toLowerCase()];
  const collateralMeta = tokenMeta[marketParams.collateralToken.toLowerCase()];
  const loanPriceUsd =
    prices[marketParams.loanToken.toLowerCase()] ?? fallbackPrice(loanMeta.symbol);
  const collateralPriceUsd =
    prices[marketParams.collateralToken.toLowerCase()] ?? fallbackPrice(collateralMeta.symbol);
  const repaidAmount = numberFromBaseUnits(event.repaidAssets, loanMeta.decimals);
  const seizedAmount = numberFromBaseUnits(event.seizedAssets, collateralMeta.decimals);
  const badDebtAmount = numberFromBaseUnits(event.badDebtAssets, loanMeta.decimals);
  const repayUsd = loanPriceUsd == null ? 0 : repaidAmount * loanPriceUsd;
  const collateralUsd = collateralPriceUsd == null ? 0 : seizedAmount * collateralPriceUsd;
  const badDebtUsd = loanPriceUsd == null ? 0 : badDebtAmount * loanPriceUsd;
  const grossProfitUsd = collateralUsd - repayUsd;
  const netProfitUsd = grossProfitUsd - thresholds.gasUsd;
  const returnOnRepayPct = repayUsd > 0 ? (netProfitUsd / repayUsd) * 100 : 0;
  const txHash = log.transactionHash;
  const lltv = lltvNumber(marketParams);

  return {
    id: candidateIdFor(log, event),
    chain: CHAIN.name,
    strategyType: 'morpho-blue-liquidation-arbitrage',
    isPureArbitrage: true,
    noCexRequired: true,
    user: event.borrower,
    marketId: event.marketId,
    marketParams,
    event: {
      source: 'Morpho Blue Liquidate event',
      logKey: eventLogKey(log),
      blockNumber,
      transactionHash: txHash,
      logIndex: Number(hexToBigInt(log.logIndex)),
      caller: event.caller,
      borrower: event.borrower,
      repaidAssets: event.repaidAssets.toString(),
      repaidShares: event.repaidShares.toString(),
      seizedAssets: event.seizedAssets.toString(),
      badDebtAssets: event.badDebtAssets.toString(),
      badDebtShares: event.badDebtShares.toString(),
    },
    account: {
      borrowAssets: event.repaidAssets.toString(),
      borrowAssetsUsd: repayUsd,
      collateral: event.seizedAssets.toString(),
      collateralUsd,
      ltv: 0,
      lltv,
      liquidatable: false,
    },
    pricing: {
      loanPriceUsd,
      collateralPriceUsd,
      priceSource: 'DefiLlama current token price with stablecoin fallback',
      pricingCaveat: 'Event amounts are historical but prices are current spot prices; production must re-price at execution block.',
    },
    bestEstimate: {
      loanAsset: marketParams.loanToken,
      loanSymbol: loanMeta.symbol,
      collateralAsset: marketParams.collateralToken,
      collateralSymbol: collateralMeta.symbol,
      borrowUsd: repayUsd,
      collateralUsd,
      lltv,
      ltv: 0,
      liquidatable: false,
      liquidationIncentive: repayUsd > 0 ? collateralUsd / repayUsd : 0,
      repayUsd,
      grossProfitUsd,
      gasUsd: thresholds.gasUsd,
      netProfitUsd,
      returnOnRepayPct,
      badDebtUsd,
    },
    gate: {
      status: 'block',
      reason: 'replay gates not evaluated yet',
    },
    liveInterface: {
      status: 'blocked-by-morpho-liquidation-replay-gate',
      requiresCex: false,
      userFlow:
        'connect wallet, discover a currently liquidatable Morpho borrower, optionally flash-borrow loan asset, call Morpho liquidate, unwind collateral, and settle profit',
      requiredContracts: {
        morpho: CHAIN.morpho,
      },
      selectors: {
        liquidate: '0xd8eabcb8',
      },
      productionStatus: 'not-enabled-until-current-state-fork-simulation-and-executor-audit-pass',
    },
  };
}

async function fetchGraphqlLiquidations(limit) {
  const query = `
    query($first: Int!, $chainId: Int!) {
      marketTransactions(
        first: $first
        orderBy: Timestamp
        orderDirection: Desc
        where: { chainId_in: [$chainId], type_in: [Liquidation] }
      ) {
        items {
          txHash
          blockNumber
          logIndex
          timestamp
          type
          user { address }
          market {
            marketId
            lltv
            loanAsset { address symbol decimals }
            collateralAsset { address symbol decimals }
            oracle { address }
            irmAddress
          }
          data {
            __typename
            ... on MarketTransactionLiquidationData {
              repaidAssets
              repaidShares
              seizedAssets
              badDebtAssets
              badDebtShares
              liquidator
            }
          }
        }
      }
    }
  `;
  const data = await gql(query, { first: limit, chainId: CHAIN.chainId });
  return data.marketTransactions.items.filter((item) => item.data?.__typename === 'MarketTransactionLiquidationData');
}

async function buildCandidateFromGraphql(item, caches, thresholds) {
  const market = item.market;
  const marketParams = {
    loanToken: market.loanAsset.address,
    collateralToken: market.collateralAsset.address,
    oracle: market.oracle.address,
    irm: market.irmAddress,
    lltv: String(market.lltv),
  };
  const loanMeta = {
    symbol: market.loanAsset.symbol,
    decimals: Number(market.loanAsset.decimals),
  };
  const collateralMeta = {
    symbol: market.collateralAsset.symbol,
    decimals: Number(market.collateralAsset.decimals),
  };
  const priceTokens = new Set([marketParams.loanToken, marketParams.collateralToken]);
  const priceKey = [...priceTokens].map((token) => token.toLowerCase()).sort().join(',');
  let prices = caches.prices.get(priceKey);
  if (!prices) {
    prices = await fetchTokenPrices(priceTokens);
    caches.prices.set(priceKey, prices);
  }

  const data = item.data;
  const repaidAssets = bigIntFrom(data.repaidAssets);
  const repaidShares = bigIntFrom(data.repaidShares);
  const seizedAssets = bigIntFrom(data.seizedAssets);
  const badDebtAssets = bigIntFrom(data.badDebtAssets);
  const badDebtShares = bigIntFrom(data.badDebtShares);
  const loanPriceUsd =
    prices[marketParams.loanToken.toLowerCase()] ?? fallbackPrice(loanMeta.symbol);
  const collateralPriceUsd =
    prices[marketParams.collateralToken.toLowerCase()] ?? fallbackPrice(collateralMeta.symbol);
  const repaidAmount = numberFromBaseUnits(repaidAssets, loanMeta.decimals);
  const seizedAmount = numberFromBaseUnits(seizedAssets, collateralMeta.decimals);
  const badDebtAmount = numberFromBaseUnits(badDebtAssets, loanMeta.decimals);
  const repayUsd = loanPriceUsd == null ? 0 : repaidAmount * loanPriceUsd;
  const collateralUsd = collateralPriceUsd == null ? 0 : seizedAmount * collateralPriceUsd;
  const badDebtUsd = loanPriceUsd == null ? 0 : badDebtAmount * loanPriceUsd;
  const grossProfitUsd = collateralUsd - repayUsd;
  const netProfitUsd = grossProfitUsd - thresholds.gasUsd;
  const returnOnRepayPct = repayUsd > 0 ? (netProfitUsd / repayUsd) * 100 : 0;
  const lltv = lltvNumber(marketParams);

  return {
    id: candidateIdForGraphql(item),
    chain: CHAIN.name,
    strategyType: 'morpho-blue-liquidation-arbitrage',
    isPureArbitrage: true,
    noCexRequired: true,
    user: item.user.address,
    marketId: market.marketId,
    marketParams,
    event: {
      source: 'Morpho official GraphQL marketTransactions Liquidation row',
      logKey: `${item.txHash}:${item.logIndex}`,
      blockNumber: Number(item.blockNumber),
      timestamp: new Date(Number(item.timestamp) * 1000).toISOString(),
      transactionHash: item.txHash,
      logIndex: Number(item.logIndex),
      caller: data.liquidator,
      borrower: item.user.address,
      repaidAssets: repaidAssets.toString(),
      repaidShares: repaidShares.toString(),
      seizedAssets: seizedAssets.toString(),
      badDebtAssets: badDebtAssets.toString(),
      badDebtShares: badDebtShares.toString(),
    },
    account: {
      borrowAssets: repaidAssets.toString(),
      borrowAssetsUsd: repayUsd,
      collateral: seizedAssets.toString(),
      collateralUsd,
      ltv: 0,
      lltv,
      liquidatable: false,
    },
    pricing: {
      loanPriceUsd,
      collateralPriceUsd,
      priceSource: 'DefiLlama current token price with stablecoin fallback',
      pricingCaveat: 'GraphQL event amounts are historical but prices are current spot prices; production must re-price at execution block.',
    },
    bestEstimate: {
      loanAsset: marketParams.loanToken,
      loanSymbol: loanMeta.symbol,
      collateralAsset: marketParams.collateralToken,
      collateralSymbol: collateralMeta.symbol,
      borrowUsd: repayUsd,
      collateralUsd,
      lltv,
      ltv: 0,
      liquidatable: false,
      liquidationIncentive: repayUsd > 0 ? collateralUsd / repayUsd : 0,
      repayUsd,
      grossProfitUsd,
      gasUsd: thresholds.gasUsd,
      netProfitUsd,
      returnOnRepayPct,
      badDebtUsd,
    },
    gate: {
      status: 'block',
      reason: 'replay gates not evaluated yet',
    },
    liveInterface: {
      status: 'blocked-by-morpho-liquidation-replay-gate',
      requiresCex: false,
      userFlow:
        'connect wallet, discover a currently liquidatable Morpho borrower, optionally flash-borrow loan asset, call Morpho liquidate, unwind collateral, and settle profit',
      requiredContracts: {
        morpho: CHAIN.morpho,
      },
      selectors: {
        liquidate: '0xd8eabcb8',
      },
      productionStatus: 'not-enabled-until-current-state-fork-simulation-and-executor-audit-pass',
    },
  };
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  loadDotenv();
  selectChainProfile();

  const rpcUrl = process.env[CHAIN.rpcEnvVar];
  if (!rpcUrl) throw new Error(`${CHAIN.rpcEnvVar} is required`);

  const latestBlock = hexToNumber(await rpc(rpcUrl, 'eth_blockNumber', []));
  const requestedToBlock = Math.floor(envNumber('MORPHO_REPLAY_TO_BLOCK', latestBlock));
  const toBlock = Math.min(requestedToBlock, latestBlock);
  const lookbackBlocks = Math.floor(envNumber('MORPHO_REPLAY_LOOKBACK_BLOCKS', 250_000));
  const fromBlock = Math.max(0, toBlock - lookbackBlocks);
  const chunkBlocks = Math.floor(envNumber('MORPHO_REPLAY_LOG_CHUNK_BLOCKS', 10));
  const maxLogRequests = Math.floor(envNumber('MORPHO_REPLAY_MAX_LOG_REQUESTS', 100));
  const maxEvents = Math.floor(envNumber('MORPHO_REPLAY_MAX_EVENTS', 80));
  const includeGraphql = envBool('MORPHO_REPLAY_INCLUDE_GRAPHQL', true);
  const graphqlFirst = Math.floor(envNumber('MORPHO_REPLAY_GRAPHQL_FIRST', 50));
  const resume = envBool('MORPHO_REPLAY_RESUME', false);
  const thresholds = {
    gasUsd: envNumber('MORPHO_REPLAY_GAS_USD', 20),
    minNetProfitUsd: envNumber('MORPHO_REPLAY_MIN_NET_PROFIT_USD', 5),
    minReturnOnRepayPct: envNumber('MORPHO_REPLAY_MIN_RETURN_ON_REPAY_PCT', 0.1),
    minReplayDays: envNumber('MORPHO_REPLAY_MIN_DAYS_FOR_GATE', 30),
    minMarketEvents: Math.floor(envNumber('MORPHO_REPLAY_MIN_MARKET_EVENTS_FOR_GATE', 5)),
    minAnnualizedNetReturnPct: envNumber('MORPHO_REPLAY_MIN_ANNUALIZED_NET_RETURN_PCT', 20),
    requireCurrentLiquidatable: envBool('MORPHO_REPLAY_REQUIRE_CURRENT_LIQUIDATABLE', true),
  };

  const outJson = resolve(dataDir, `morpho-blue-liquidation-event-replay-candidates-${CHAIN.shortName}.json`);
  const stateJson = resolve(dataDir, `morpho-blue-liquidation-replay-state-${CHAIN.shortName}.json`);
  const priorState = resume ? await readJson(stateJson) : null;
  const canResume =
    priorState?.chain?.shortName === CHAIN.shortName &&
    priorState?.fromBlock === fromBlock &&
    priorState?.toBlock === toBlock &&
    Number.isFinite(Number(priorState?.nextEndBlock));
  let cursorEnd = canResume ? Number(priorState.nextEndBlock) : toBlock;
  const priorArtifact = resume && existsSync(outJson) ? await readJson(outJson) : null;
  const candidates = Array.isArray(priorArtifact?.candidates) ? priorArtifact.candidates : [];
  const seen = new Set(candidates.map((candidate) => candidate.event?.logKey).filter(Boolean));
  const logs = [];
  let graphqlItems = [];
  let logRequestCount = 0;
  let scannedThisRun = 0;

  console.error(
    `[morpho-replay] chain=${CHAIN.name} from=${fromBlock} to=${toBlock} startEnd=${cursorEnd} chunk=${chunkBlocks} maxRequests=${maxLogRequests} maxEvents=${maxEvents} resume=${resume && canResume}`,
  );

  if (includeGraphql && graphqlFirst > 0) {
    graphqlItems = await fetchGraphqlLiquidations(graphqlFirst);
    console.error(`[morpho-replay] graphql liquidation rows=${graphqlItems.length} first=${graphqlFirst}`);
  }

  while (cursorEnd >= fromBlock && logRequestCount < maxLogRequests && logs.length < maxEvents) {
    const chunkFrom = Math.max(fromBlock, cursorEnd - chunkBlocks + 1);
    const chunkTo = cursorEnd;
    const chunkLogs = await getLogs(rpcUrl, CHAIN.morpho, chunkFrom, chunkTo, [TOPICS.liquidate]);
    scannedThisRun += chunkTo - chunkFrom + 1;
    logRequestCount += 1;
    for (const log of chunkLogs) {
      if (!seen.has(eventLogKey(log))) logs.push(log);
      if (logs.length >= maxEvents) break;
    }
    console.error(
      `[morpho-replay] chunk ${chunkFrom}-${chunkTo} logs=${chunkLogs.length} new=${logs.length} requests=${logRequestCount}`,
    );
    cursorEnd = chunkFrom - 1;
  }

  logs.sort((a, b) => {
    const blockDiff = Number(hexToBigInt(b.blockNumber) - hexToBigInt(a.blockNumber));
    if (blockDiff !== 0) return blockDiff;
    return Number(hexToBigInt(b.logIndex) - hexToBigInt(a.logIndex));
  });

  const caches = {
    markets: new Map(),
    tokens: new Map(),
    prices: new Map(),
  };
  let buildErrorCount = 0;
  let graphqlCandidateCount = 0;
  for (const item of graphqlItems) {
    const key = `${item.txHash}:${item.logIndex}`;
    if (seen.has(key)) continue;
    try {
      const candidate = await buildCandidateFromGraphql(item, caches, thresholds);
      candidates.push(candidate);
      seen.add(key);
      graphqlCandidateCount += 1;
    } catch (err) {
      buildErrorCount += 1;
      console.error(
        `[morpho-replay] failed to build graphql candidate ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let rpcCandidateCount = 0;
  for (const log of logs) {
    const key = eventLogKey(log);
    if (seen.has(key)) continue;
    try {
      const candidate = await buildCandidate(rpcUrl, log, caches, thresholds);
      candidates.push(candidate);
      seen.add(key);
      rpcCandidateCount += 1;
    } catch (err) {
      buildErrorCount += 1;
      console.error(
        `[morpho-replay] failed to build candidate ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const earliestCandidateBlock = Math.min(
    ...candidates.map((candidate) => Number(candidate.event?.blockNumber)).filter((n) => Number.isFinite(n)),
  );
  const coveredFromBlock = Math.min(
    Math.max(fromBlock, cursorEnd + 1),
    Number.isFinite(earliestCandidateBlock) ? earliestCandidateBlock : toBlock,
  );
  const [chainStartTimestamp, endTimestamp] = await Promise.all([
    blockTimestamp(rpcUrl, coveredFromBlock),
    blockTimestamp(rpcUrl, toBlock),
  ]);
  const eventTimestamps = candidates
    .map((candidate) => Date.parse(candidate.event?.timestamp ?? ''))
    .filter((n) => Number.isFinite(n));
  const startTimestamp = eventTimestamps.length
    ? new Date(Math.min(Date.parse(chainStartTimestamp), ...eventTimestamps)).toISOString()
    : chainStartTimestamp;
  const durationDays = Math.max(
    0,
    (Date.parse(endTimestamp) - Date.parse(startTimestamp)) / 86_400_000,
  );
  const window = {
    requestedFromBlock: fromBlock,
    coveredFromBlock,
    toBlock,
    startTimestamp,
    endTimestamp,
    durationDays,
    scannedBlockCount: (canResume ? Number(priorState.scannedBlockCount ?? 0) : 0) + scannedThisRun,
    logRequestCount: (canResume ? Number(priorState.logRequestCount ?? 0) : 0) + logRequestCount,
    newEventCount: logs.length + graphqlItems.length,
    graphqlRowCount: graphqlItems.length,
    graphqlCandidateCount,
    rpcCandidateCount,
  };

  applyReplayGates(candidates, window, thresholds);
  candidates.sort((a, b) => {
    const ap = a.gate.status === 'pass' ? 1_000_000 : 0;
    const bp = b.gate.status === 'pass' ? 1_000_000 : 0;
    return bp + b.bestEstimate.netProfitUsd - (ap + a.bestEstimate.netProfitUsd);
  });

  const passing = candidates.filter((candidate) => candidate.gate.status === 'pass');
  const historicalStabilityPassedButLiveBlocked = candidates.filter((candidate) =>
    String(candidate.gate.reason).includes('historical stability gates passed'),
  );
  const historicalStabilityPassedMarketCount = new Set(
    historicalStabilityPassedButLiveBlocked.map((candidate) => candidate.marketId),
  ).size;
  const marketCount = new Set(candidates.map((candidate) => candidate.marketId)).size;
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      chain: CHAIN,
      morpho: CHAIN.morpho,
      api: MORPHO_API,
      event: {
        name: 'Liquidate(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)',
        topic0: TOPICS.liquidate,
      },
      officialReferences: [
        'https://github.com/morpho-org/morpho-blue/blob/main/src/libraries/EventsLib.sol',
        'https://github.com/morpho-org/morpho-blue/blob/main/src/Morpho.sol',
        'https://docs.morpho.org/',
      ],
    },
    methodology: {
      classification: 'pure-on-chain-morpho-blue-liquidation-event-replay',
      isPureArbitrage: true,
      noCexRequired: true,
      eventDiscovery: 'eth_getLogs over the Morpho Blue Liquidate event',
      indexedEventDiscovery: includeGraphql
        ? 'Morpho official GraphQL marketTransactions filtered to type Liquidation'
        : 'disabled',
      marketParamDiscovery: 'idToMarketParams(bytes32) read from Morpho Blue at the event block',
      pricing: 'current DefiLlama token prices with stablecoin fallback; live execution must use same-block DEX quotes',
      thresholds,
      caveats: [
        'Historical Morpho liquidation events prove that the liquidation mechanism existed, not that a borrower is liquidatable now.',
        'The default gate remains blocked until a current borrower is liquidatable and same-block fork simulation proves after-gas profit.',
        'Historical token prices are not reconstructed here; current prices are used only for coarse replay triage.',
        'Production execution requires audited callback/funding logic and collateral unwind routing.',
      ],
    },
    window,
    summary: {
      marketCount,
      candidateCount: candidates.length,
      passingCount: passing.length,
      requestedPassingCount: 5,
      buildErrorCount,
      graphqlRowCount: graphqlItems.length,
      graphqlCandidateCount,
      rpcCandidateCount,
      historicalStabilityPassedButLiveBlockedCount: historicalStabilityPassedButLiveBlocked.length,
      historicalStabilityPassedButLiveBlockedMarketCount: historicalStabilityPassedMarketCount,
      status:
        passing.length >= 5
          ? 'found-at-least-five-passing-morpho-blue-liquidation-event-replay-opportunities'
          : 'did-not-find-five-passing-morpho-blue-liquidation-event-replay-opportunities',
    },
    candidates,
  };

  const state = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    chain: CHAIN,
    morpho: CHAIN.morpho,
    fromBlock,
    toBlock,
    nextEndBlock: cursorEnd,
    scanComplete: cursorEnd < fromBlock,
    scannedBlockCount: window.scannedBlockCount,
    logRequestCount: window.logRequestCount,
    eventCount: candidates.length,
    newEventCount: logs.length + graphqlItems.length,
    graphqlRowCount: graphqlItems.length,
    graphqlCandidateCount,
    rpcCandidateCount,
    buildErrorCount,
  };

  await mkdir(dataDir, { recursive: true });
  await writeFile(outJson, `${JSON.stringify(artifact, null, 2)}\n`);
  await writeFile(stateJson, `${JSON.stringify(state, null, 2)}\n`);
  console.log(
    `morphoBlueLiquidationReplay=${artifact.summary.status} markets=${marketCount} candidates=${candidates.length} passing=${passing.length} scannedBlocks=${window.scannedBlockCount} nextEndBlock=${state.nextEndBlock} artifact=${outJson}`,
  );
  for (const candidate of candidates.slice(0, 10)) {
    console.log(
      `${candidate.id} gate=${candidate.gate.status} block=${candidate.event.blockNumber} repayUsd=${candidate.bestEstimate.repayUsd.toFixed(4)} netUsd=${candidate.bestEstimate.netProfitUsd.toFixed(4)} reason=${candidate.gate.reason}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
