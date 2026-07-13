#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');
const Q96 = 1n << 96n;
const Q32 = 1n << 32n;
const MAX_UINT256 = (1n << 256n) - 1n;
const SWAP_TOPIC0 = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';
const FEE_DENOMINATOR = 1_000_000n;

const SUPPORTED = {
  'candidate-4-base-weth-usdc': {
    chain: 'Base',
    rpcEnvVar: 'RPC_BASE_URL',
    poolAddress: '0xd0b53d9277642d899df5c87a3966a349a798f224',
    feePips: 500,
    tickSpacing: 10,
    token0: {
      symbol: 'WETH',
      decimals: 18,
      address: '0x4200000000000000000000000000000000000006',
    },
    token1: {
      symbol: 'USDC',
      decimals: 6,
      address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    },
  },
};

const candidateId = process.argv[2] ?? 'candidate-4-base-weth-usdc';
const config = SUPPORTED[candidateId];

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
    // Optional in CI; RPC can be passed through the environment.
  }
}

function envNumber(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toHex(n) {
  return `0x${BigInt(n).toString(16)}`;
}

function hexToNumber(hex) {
  return Number(BigInt(hex));
}

function hexWord(data, index) {
  const clean = data.replace(/^0x/, '');
  return clean.slice(index * 64, (index + 1) * 64);
}

function decodeUint(word) {
  return BigInt(`0x${word}`);
}

function decodeInt256(word) {
  const value = BigInt(`0x${word}`);
  return value >= (1n << 255n) ? value - (1n << 256n) : value;
}

function baseUnitsToNumber(value, decimals) {
  return Number(value) / 10 ** decimals;
}

function decimalToBaseUnits(value, decimals) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0n;
  const fixed = n.toFixed(decimals);
  const [whole, fraction = ''] = fixed.split('.');
  const raw = `${whole}${fraction.padEnd(decimals, '0').slice(0, decimals)}`;
  return BigInt(raw.replace(/^0+(?=\d)/, '') || '0');
}

function price1Per0FromSqrt(sqrtPriceX96, token0Decimals, token1Decimals) {
  const sqrt = Number(sqrtPriceX96) / Number(Q96);
  return sqrt * sqrt * 10 ** (token0Decimals - token1Decimals);
}

function roundTickDown(tick, spacing) {
  return Math.floor(tick / spacing) * spacing;
}

function roundTickUp(tick, spacing) {
  return Math.ceil(tick / spacing) * spacing;
}

function getLiquidityForAmounts(sqrtRatioX96, sqrtRatioAX96, sqrtRatioBX96, amount0, amount1) {
  const [sqrtA, sqrtB] =
    sqrtRatioAX96 < sqrtRatioBX96
      ? [sqrtRatioAX96, sqrtRatioBX96]
      : [sqrtRatioBX96, sqrtRatioAX96];
  if (sqrtRatioX96 <= sqrtA) return getLiquidityForAmount0(sqrtA, sqrtB, amount0);
  if (sqrtRatioX96 < sqrtB) {
    const liquidity0 = getLiquidityForAmount0(sqrtRatioX96, sqrtB, amount0);
    const liquidity1 = getLiquidityForAmount1(sqrtA, sqrtRatioX96, amount1);
    return liquidity0 < liquidity1 ? liquidity0 : liquidity1;
  }
  return getLiquidityForAmount1(sqrtA, sqrtB, amount1);
}

function getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0) {
  const [sqrtA, sqrtB] =
    sqrtRatioAX96 < sqrtRatioBX96
      ? [sqrtRatioAX96, sqrtRatioBX96]
      : [sqrtRatioBX96, sqrtRatioAX96];
  const intermediate = (sqrtA * sqrtB) / Q96;
  return (amount0 * intermediate) / (sqrtB - sqrtA);
}

function getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1) {
  const [sqrtA, sqrtB] =
    sqrtRatioAX96 < sqrtRatioBX96
      ? [sqrtRatioAX96, sqrtRatioBX96]
      : [sqrtRatioBX96, sqrtRatioAX96];
  return (amount1 * Q96) / (sqrtB - sqrtA);
}

function getAmount0ForLiquidity(sqrtRatioX96, sqrtRatioAX96, sqrtRatioBX96, liquidity) {
  const [sqrtA, sqrtB] =
    sqrtRatioAX96 < sqrtRatioBX96
      ? [sqrtRatioAX96, sqrtRatioBX96]
      : [sqrtRatioBX96, sqrtRatioAX96];
  if (sqrtRatioX96 <= sqrtA) return amount0Delta(sqrtA, sqrtB, liquidity);
  if (sqrtRatioX96 < sqrtB) return amount0Delta(sqrtRatioX96, sqrtB, liquidity);
  return 0n;
}

function getAmount1ForLiquidity(sqrtRatioX96, sqrtRatioAX96, sqrtRatioBX96, liquidity) {
  const [sqrtA, sqrtB] =
    sqrtRatioAX96 < sqrtRatioBX96
      ? [sqrtRatioAX96, sqrtRatioBX96]
      : [sqrtRatioBX96, sqrtRatioAX96];
  if (sqrtRatioX96 <= sqrtA) return 0n;
  if (sqrtRatioX96 < sqrtB) return amount1Delta(sqrtA, sqrtRatioX96, liquidity);
  return amount1Delta(sqrtA, sqrtB, liquidity);
}

function amount0Delta(sqrtRatioAX96, sqrtRatioBX96, liquidity) {
  const [sqrtA, sqrtB] =
    sqrtRatioAX96 < sqrtRatioBX96
      ? [sqrtRatioAX96, sqrtRatioBX96]
      : [sqrtRatioBX96, sqrtRatioAX96];
  return (((liquidity << 96n) * (sqrtB - sqrtA)) / sqrtB) / sqrtA;
}

function amount1Delta(sqrtRatioAX96, sqrtRatioBX96, liquidity) {
  const [sqrtA, sqrtB] =
    sqrtRatioAX96 < sqrtRatioBX96
      ? [sqrtRatioAX96, sqrtRatioBX96]
      : [sqrtRatioBX96, sqrtRatioAX96];
  return (liquidity * (sqrtB - sqrtA)) / Q96;
}

function getSqrtRatioAtTick(tick) {
  const absTick = tick < 0 ? -tick : tick;
  if (absTick > 887272) throw new Error(`tick out of range: ${tick}`);
  let ratio =
    (absTick & 0x1) !== 0
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;
  if ((absTick & 0x2) !== 0) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n;
  if ((absTick & 0x4) !== 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
  if ((absTick & 0x8) !== 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
  if ((absTick & 0x10) !== 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
  if ((absTick & 0x20) !== 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
  if ((absTick & 0x40) !== 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
  if ((absTick & 0x80) !== 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
  if ((absTick & 0x100) !== 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
  if ((absTick & 0x200) !== 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
  if ((absTick & 0x400) !== 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n;
  if ((absTick & 0x800) !== 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n;
  if ((absTick & 0x1000) !== 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
  if ((absTick & 0x2000) !== 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
  if ((absTick & 0x4000) !== 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n;
  if ((absTick & 0x8000) !== 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n;
  if ((absTick & 0x10000) !== 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n;
  if ((absTick & 0x20000) !== 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
  if ((absTick & 0x40000) !== 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n;
  if ((absTick & 0x80000) !== 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n;
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  return (ratio >> 32n) + (ratio % Q32 === 0n ? 0n : 1n);
}

async function rpc(rpcUrl, method, params, retries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), envNumber('REPLAY_RPC_TIMEOUT_MS', 20_000));
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: `${Date.now()}-${Math.random()}`, method, params }),
        signal: controller.signal,
      });
      const body = await res.json();
      if (!res.ok || body.error) {
        throw new Error(body.error?.message ?? `RPC ${method} HTTP ${res.status}`);
      }
      return body.result;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(350 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function getLogsRange(rpcUrl, address, fromBlock, toBlock, depth = 0) {
  try {
    return await rpc(rpcUrl, 'eth_getLogs', [
      { address, fromBlock: toHex(fromBlock), toBlock: toHex(toBlock), topics: [SWAP_TOPIC0] },
    ]);
  } catch (err) {
    if (toBlock > fromBlock && depth < 10) {
      const mid = Math.floor((fromBlock + toBlock) / 2);
      const left = await getLogsRange(rpcUrl, address, fromBlock, mid, depth + 1);
      const right = await getLogsRange(rpcUrl, address, mid + 1, toBlock, depth + 1);
      return [...left, ...right];
    }
    throw err;
  }
}

function decodeSwap(log) {
  const data = log.data ?? '0x';
  if (data.replace(/^0x/, '').length < 64 * 5) {
    throw new Error(`short swap data at ${log.transactionHash ?? 'unknown tx'}`);
  }
  return {
    blockNumber: hexToNumber(log.blockNumber),
    transactionHash: log.transactionHash,
    logIndex: hexToNumber(log.logIndex),
    amount0: decodeInt256(hexWord(data, 0)),
    amount1: decodeInt256(hexWord(data, 1)),
    sqrtPriceX96: decodeUint(hexWord(data, 2)),
    liquidity: decodeUint(hexWord(data, 3)),
    tick: Number(decodeInt256(hexWord(data, 4))),
  };
}

async function fetchSwapLogs(rpcUrl, fromBlock, toBlock, chunkSize) {
  const logs = [];
  let chunkCount = 0;
  for (let from = fromBlock; from <= toBlock; from += chunkSize) {
    const to = Math.min(toBlock, from + chunkSize - 1);
    const chunk = await getLogsRange(rpcUrl, config.poolAddress, from, to);
    logs.push(...chunk);
    chunkCount += 1;
    console.error(`[event-replay] scanned ${fromBlock}-${to}; logs=${logs.length}`);
  }
  return logs
    .map(decodeSwap)
    .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

async function blockTimestamp(rpcUrl, blockNumber) {
  const block = await rpc(rpcUrl, 'eth_getBlockByNumber', [toHex(blockNumber), false]);
  if (!block?.timestamp) throw new Error(`missing block timestamp for ${blockNumber}`);
  return hexToNumber(block.timestamp);
}

async function fetchEthUsd() {
  const fallback = envNumber('REPLAY_ETH_USD', 0);
  try {
    const url = `https://coins.llama.fi/prices/current/base:${config.token0.address}`;
    const res = await fetch(url);
    const json = await res.json();
    const price = Number(json?.coins?.[`base:${config.token0.address}`]?.price);
    if (Number.isFinite(price) && price > 0) return { price, source: url };
  } catch {
    // Use explicit fallback below.
  }
  if (fallback > 0) return { price: fallback, source: 'REPLAY_ETH_USD fallback' };
  return { price: null, source: null };
}

function estimatePosition(firstSwap, lastSwap, capitalUsd, rangeWidthTicks) {
  const startPrice = price1Per0FromSqrt(
    firstSwap.sqrtPriceX96,
    config.token0.decimals,
    config.token1.decimals,
  );
  const endPrice = price1Per0FromSqrt(
    lastSwap.sqrtPriceX96,
    config.token0.decimals,
    config.token1.decimals,
  );
  const tickLower = roundTickDown(firstSwap.tick - rangeWidthTicks, config.tickSpacing);
  const tickUpper = roundTickUp(firstSwap.tick + rangeWidthTicks, config.tickSpacing);
  const sqrtLower = getSqrtRatioAtTick(tickLower);
  const sqrtUpper = getSqrtRatioAtTick(tickUpper);
  const amount0Available = decimalToBaseUnits(capitalUsd / 2 / startPrice, config.token0.decimals);
  const amount1Available = decimalToBaseUnits(capitalUsd / 2, config.token1.decimals);
  const liquidity = getLiquidityForAmounts(
    firstSwap.sqrtPriceX96,
    sqrtLower,
    sqrtUpper,
    amount0Available,
    amount1Available,
  );
  const startAmount0 = getAmount0ForLiquidity(
    firstSwap.sqrtPriceX96,
    sqrtLower,
    sqrtUpper,
    liquidity,
  );
  const startAmount1 = getAmount1ForLiquidity(
    firstSwap.sqrtPriceX96,
    sqrtLower,
    sqrtUpper,
    liquidity,
  );
  const endAmount0 = getAmount0ForLiquidity(
    lastSwap.sqrtPriceX96,
    sqrtLower,
    sqrtUpper,
    liquidity,
  );
  const endAmount1 = getAmount1ForLiquidity(
    lastSwap.sqrtPriceX96,
    sqrtLower,
    sqrtUpper,
    liquidity,
  );
  const investedUsd =
    baseUnitsToNumber(startAmount0, config.token0.decimals) * startPrice +
    baseUnitsToNumber(startAmount1, config.token1.decimals);
  const lpValueUsd =
    baseUnitsToNumber(endAmount0, config.token0.decimals) * endPrice +
    baseUnitsToNumber(endAmount1, config.token1.decimals);
  const holdValueUsd =
    baseUnitsToNumber(startAmount0, config.token0.decimals) * endPrice +
    baseUnitsToNumber(startAmount1, config.token1.decimals);
  return {
    tickLower,
    tickUpper,
    sqrtLower,
    sqrtUpper,
    startPrice,
    endPrice,
    liquidity,
    amount0Available,
    amount1Available,
    startAmount0,
    startAmount1,
    endAmount0,
    endAmount1,
    investedUsd,
    lpValueUsd,
    holdValueUsd,
  };
}

function accumulateFees(swaps, position) {
  let fee0Pool = 0n;
  let fee1Pool = 0n;
  let fee0Position = 0n;
  let fee1Position = 0n;
  let inRangeSwaps = 0;
  let zeroLiquiditySwaps = 0;
  for (const swap of swaps) {
    let inputFee0 = 0n;
    let inputFee1 = 0n;
    if (swap.amount0 > 0n) inputFee0 = (swap.amount0 * BigInt(config.feePips)) / FEE_DENOMINATOR;
    if (swap.amount1 > 0n) inputFee1 = (swap.amount1 * BigInt(config.feePips)) / FEE_DENOMINATOR;
    fee0Pool += inputFee0;
    fee1Pool += inputFee1;
    if (swap.tick < position.tickLower || swap.tick >= position.tickUpper) continue;
    if (swap.liquidity <= 0n) {
      zeroLiquiditySwaps += 1;
      continue;
    }
    inRangeSwaps += 1;
    fee0Position += (inputFee0 * position.liquidity) / swap.liquidity;
    fee1Position += (inputFee1 * position.liquidity) / swap.liquidity;
  }
  return { fee0Pool, fee1Pool, fee0Position, fee1Position, inRangeSwaps, zeroLiquiditySwaps };
}

function pct(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

async function main() {
  loadDotenv();
  if (!config) {
    throw new Error(
      `unsupported candidate ${candidateId}; supported candidates: ${Object.keys(SUPPORTED).join(', ')}`,
    );
  }
  const rpcUrl = process.env[config.rpcEnvVar];
  if (!rpcUrl) throw new Error(`${config.rpcEnvVar} is required`);

  const candidatesRaw = await readFile(resolve(dataDir, 'strategy-candidates.json'), 'utf8');
  const candidatesArtifact = JSON.parse(candidatesRaw);
  const candidate = candidatesArtifact.candidates?.find((c) => c.id === candidateId);
  if (!candidate) throw new Error(`candidate ${candidateId} not found in data/strategy-candidates.json`);

  const latestBlock = Number(process.env.REPLAY_TO_BLOCK ?? hexToNumber(await rpc(rpcUrl, 'eth_blockNumber', [])));
  const blockCount = Math.floor(envNumber('REPLAY_BLOCKS', 50_000));
  const fromBlock = Number(process.env.REPLAY_FROM_BLOCK ?? Math.max(0, latestBlock - blockCount + 1));
  const toBlock = latestBlock;
  const chunkSize = Math.floor(envNumber('REPLAY_CHUNK_SIZE', 2_000));
  const capitalUsd = envNumber('REPLAY_CAPITAL_USD', 10_000);
  const rangeWidthTicks = Math.floor(envNumber('REPLAY_RANGE_WIDTH_TICKS', 600));
  const minReplayDaysForGate = envNumber('REPLAY_MIN_DAYS_FOR_GATE', 7);
  const minSwapCountForGate = Math.floor(envNumber('REPLAY_MIN_SWAPS_FOR_GATE', 100));
  const entryGasUnits = Math.floor(envNumber('REPLAY_ENTRY_GAS_UNITS', 538_979));
  const exitGasUnits = Math.floor(envNumber('REPLAY_EXIT_GAS_UNITS', 0));

  console.error(
    `[event-replay] candidate=${candidateId} pool=${config.poolAddress} blocks=${fromBlock}-${toBlock}`,
  );
  const [startTs, endTs, gasPriceWei, ethUsdQuote, swaps] = await Promise.all([
    blockTimestamp(rpcUrl, fromBlock),
    blockTimestamp(rpcUrl, toBlock),
    rpc(rpcUrl, 'eth_gasPrice', []),
    fetchEthUsd(),
    fetchSwapLogs(rpcUrl, fromBlock, toBlock, chunkSize),
  ]);
  if (!swaps.length) {
    throw new Error(`no Swap logs found in ${fromBlock}-${toBlock}; increase REPLAY_BLOCKS`);
  }
  const durationDays = Math.max((endTs - startTs) / 86_400, 1 / 86_400);
  const firstSwap = swaps[0];
  const lastSwap = swaps[swaps.length - 1];
  const position = estimatePosition(firstSwap, lastSwap, capitalUsd, rangeWidthTicks);
  if (position.liquidity <= 0n) throw new Error('hypothetical position has zero liquidity');
  const fees = accumulateFees(swaps, position);

  const fee0PositionHuman = baseUnitsToNumber(fees.fee0Position, config.token0.decimals);
  const fee1PositionHuman = baseUnitsToNumber(fees.fee1Position, config.token1.decimals);
  const fee0PoolHuman = baseUnitsToNumber(fees.fee0Pool, config.token0.decimals);
  const fee1PoolHuman = baseUnitsToNumber(fees.fee1Pool, config.token1.decimals);
  const feeUsd = fee0PositionHuman * position.endPrice + fee1PositionHuman;
  const impermanentLossUsd = position.lpValueUsd - position.holdValueUsd;
  const gasUnits = entryGasUnits + exitGasUnits;
  const gasEth = (Number(BigInt(gasPriceWei)) * gasUnits) / 1e18;
  const gasUsd = ethUsdQuote.price == null ? null : gasEth * ethUsdQuote.price;
  const netPnlUsd = feeUsd + impermanentLossUsd - (gasUsd ?? 0);
  const annualizer = 365 / durationDays;
  const grossFeeApyPct = pct(feeUsd * annualizer, position.investedUsd);
  const ilApyPct = pct(impermanentLossUsd * annualizer, position.investedUsd);
  const gasApyPct = gasUsd == null ? null : pct(-gasUsd * annualizer, position.investedUsd);
  const netApyPct = pct(netPnlUsd * annualizer, position.investedUsd);
  const inRangeSwapPct = pct(fees.inRangeSwaps, swaps.length);
  const priceChangePct = pct(position.endPrice - position.startPrice, position.startPrice);
  const gatePass =
    (netApyPct ?? -Infinity) >= 20 &&
    durationDays >= minReplayDaysForGate &&
    swaps.length >= minSwapCountForGate;
  const evidenceStatus = gatePass
    ? 'passes-20apy-event-replay-gate'
    : (netApyPct ?? -Infinity) >= 20
      ? 'net-apy-observed-but-sample-too-short-or-thin'
      : 'fails-20apy-event-replay-gate';

  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidateId,
    source: {
      chain: config.chain,
      rpcEnvVar: config.rpcEnvVar,
      poolAddress: config.poolAddress,
      event: 'Swap(address,address,int256,int256,uint160,uint128,int24)',
      topic0: SWAP_TOPIC0,
      candidateSource: candidate.source,
    },
    methodology: {
      classification: 'lp-event-replay',
      isPureArbitrage: false,
      capitalUsd,
      feePips: config.feePips,
      tickSpacing: config.tickSpacing,
      rangeWidthTicks,
      minReplayDaysForGate,
      minSwapCountForGate,
      gasAssumption: {
        entryGasUnits,
        exitGasUnits,
        gasPriceWei: BigInt(gasPriceWei).toString(),
        nativeTokenUsd: ethUsdQuote.price,
        nativeTokenUsdSource: ethUsdQuote.source,
      },
      caveats: [
        'This is LP fee event replay, not pure arbitrage backtesting.',
        'Fees are estimated from positive swap deltas and fee tier; protocol fee switches and exact fee growth accounting are not replayed.',
        'Active liquidity uses the Swap event liquidity field; mints/burns are not independently reconstructed.',
        'The range is fixed from the first observed swap tick and does not rebalance.',
        'Gas uses latest gas price and a fixed entry/exit gas assumption, not historical per-block gas.',
        'Annualized returns are unstable on short windows and must not be marketed as guaranteed APY.',
      ],
    },
    window: {
      fromBlock,
      toBlock,
      startTimestamp: new Date(startTs * 1000).toISOString(),
      endTimestamp: new Date(endTs * 1000).toISOString(),
      durationDays,
      swapCount: swaps.length,
    },
    tokens: {
      token0: config.token0,
      token1: config.token1,
    },
    position: {
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      startTick: firstSwap.tick,
      endTick: lastSwap.tick,
      liquidity: position.liquidity.toString(),
      startPriceToken1PerToken0: position.startPrice,
      endPriceToken1PerToken0: position.endPrice,
      priceChangePct,
      amount0Start: baseUnitsToNumber(position.startAmount0, config.token0.decimals),
      amount1Start: baseUnitsToNumber(position.startAmount1, config.token1.decimals),
      amount0End: baseUnitsToNumber(position.endAmount0, config.token0.decimals),
      amount1End: baseUnitsToNumber(position.endAmount1, config.token1.decimals),
      investedUsd: position.investedUsd,
      lpValueUsdBeforeFees: position.lpValueUsd,
      holdValueUsd: position.holdValueUsd,
    },
    fees: {
      poolFee0: fee0PoolHuman,
      poolFee1: fee1PoolHuman,
      positionFee0: fee0PositionHuman,
      positionFee1: fee1PositionHuman,
      positionFeeUsdAtEndPrice: feeUsd,
      inRangeSwaps: fees.inRangeSwaps,
      inRangeSwapPct,
      zeroLiquiditySwaps: fees.zeroLiquiditySwaps,
    },
    metrics: {
      grossFeeApyPct,
      impermanentLossUsd,
      ilApyPct,
      gasUsd,
      gasApyPct,
      netPnlUsd,
      netApyPct,
    },
    gate: {
      status: gatePass ? 'pass' : 'block',
      evidenceStatus,
      minNetApyPct: 20,
      minReplayDaysForGate,
      minSwapCountForGate,
      reason: gatePass
        ? 'net APY, replay duration, and swap-count thresholds passed'
        : 'net APY, replay duration, or swap-count threshold did not pass',
    },
    summary: {
      evidenceStatus,
      durationDays,
      swapCount: swaps.length,
      inRangeSwapPct,
      grossFeeApyPct,
      ilApyPct,
      gasApyPct,
      netApyPct,
      netPnlUsd,
      investedUsd: position.investedUsd,
      isPureArbitrage: false,
    },
  };

  await mkdir(dataDir, { recursive: true });
  const outFile = resolve(dataDir, `event-replay-${candidateId}.json`);
  await writeFile(outFile, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    `eventReplay=${artifact.gate.status} status=${evidenceStatus} candidate=${candidateId} logs=${swaps.length} days=${durationDays.toFixed(4)} netApyPct=${(netApyPct ?? NaN).toFixed(4)} grossFeeApyPct=${(grossFeeApyPct ?? NaN).toFixed(4)} ilApyPct=${(ilApyPct ?? NaN).toFixed(4)}`,
  );
  console.log(`artifact=${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
