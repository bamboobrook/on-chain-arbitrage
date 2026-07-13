#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');
const outPath = resolve(dataDir, 'market-depth-snapshots.json');

const SELECTORS = {
  balanceOf: '0x70a08231',
  uniswapV3GetPool: '0x1698ee82',
  uniswapV3Slot0: '0x3850c7bd',
  uniswapV3Liquidity: '0x1a686502',
  uniswapV3TickSpacing: '0xd0c93a7c',
  uniswapV3TickBitmap: '0x5339c296',
  uniswapV3Ticks: '0xf30dba93',
  solidlyGetPool: '0x79bc57d5',
  v2GetPair: '0xe6a43905',
};

const UNISWAP_V3_FACTORIES = {
  Ethereum: '0x1F98431c8aD98523631AE4a59F267346ea31F984',
  Base: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  Polygon: '0x1F98431c8aD98523631AE4a59F267346ea31F984',
  Arbitrum: '0x1F98431c8aD98523631AE4a59F267346ea31F984',
  Optimism: '0x1F98431c8aD98523631AE4a59F267346ea31F984',
};

const DEXSCREENER_CHAINS = {
  Ethereum: 'ethereum',
  Base: 'base',
  Polygon: 'polygon',
  Arbitrum: 'arbitrum',
  Optimism: 'optimism',
  BNB: 'bsc',
};

const dexScreenerCache = new Map();
const poolResolveCache = new Map();
const tokenBalanceCache = new Map();
const uniswapV3StateCache = new Map();

const Q96 = 1n << 96n;
const MAX_UINT256 = (1n << 256n) - 1n;
const TICK_MATH_RATIOS = [
  '0xfffcb933bd6fad37aa2d162d1a594001',
  '0xfff97272373d413259a46990580e213a',
  '0xfff2e50f5f656932ef12357cf3c7fdcc',
  '0xffe5caca7e10e4e61c3624eaa0941cd0',
  '0xffcb9843d60f6159c9db58835c926644',
  '0xff973b41fa98c081472e6896dfb254c0',
  '0xff2ea16466c96a3843ec78b326b52861',
  '0xfe5dee046a99a2a811c461f1969c3053',
  '0xfcbe86c7900a88aedcffc83b479aa3a4',
  '0xf987a7253ac413176f2b074cf7815e54',
  '0xf3392b0822b70005940c7a398e4b70f3',
  '0xe7159475a2c29b7443b29c7fa6e889d9',
  '0xd097f3bdfd2022b8845ad8f792aa5825',
  '0xa9f746462d870fdf8a65dc1f90e061e5',
  '0x70d869a156d2a1b890bb3df62baf32f7',
  '0x31be135f97d08fd981231505542fcfa6',
  '0x9aa508b5b7a84e1c677de54f3e99bc9',
  '0x5d6af8dedb81196699c329225ee604',
  '0x2216e584f5fa1ea926041bedfe98',
  '0x48a170391f7dc42444e8fa2',
].map((value) => BigInt(value));

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
    // Optional in CI.
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

async function readJson(fileName) {
  const path = resolve(dataDir, fileName);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function strip0x(value) {
  return String(value ?? '').replace(/^0x/i, '');
}

function pad32(value) {
  return strip0x(value).padStart(64, '0');
}

function encodeAddress(address) {
  return pad32(strip0x(address).toLowerCase());
}

function encodeUint(value) {
  return pad32(BigInt(value).toString(16));
}

function encodeInt(value) {
  const n = BigInt(value);
  return pad32((n < 0n ? (1n << 256n) + n : n).toString(16));
}

function encodeBool(value) {
  return encodeUint(value ? 1n : 0n);
}

function toBlockTag(blockNumber) {
  return blockNumber ? `0x${BigInt(blockNumber).toString(16)}` : 'latest';
}

function hexToBigInt(hex) {
  if (!hex || hex === '0x') return 0n;
  return BigInt(hex);
}

function hexWords(hex) {
  const raw = strip0x(hex);
  const words = [];
  for (let i = 0; i < raw.length; i += 64) words.push(raw.slice(i, i + 64).padStart(64, '0'));
  return words;
}

function signedWordToBigInt(word) {
  const value = BigInt(`0x${word}`);
  return value >= (1n << 255n) ? value - (1n << 256n) : value;
}

function floorDiv(a, b) {
  const x = BigInt(a);
  const y = BigInt(b);
  const q = x / y;
  const r = x % y;
  return r !== 0n && (x < 0n) !== (y < 0n) ? q - 1n : q;
}

function ceilDiv(a, b) {
  const x = BigInt(a);
  const y = BigInt(b);
  return x === 0n ? 0n : (x - 1n) / y + 1n;
}

function getSqrtRatioAtTick(tick) {
  const t = Number(tick);
  const absTick = Math.abs(t);
  if (absTick > 887272) throw new Error(`tick out of range: ${tick}`);
  let ratio = (absTick & 1) !== 0 ? TICK_MATH_RATIOS[0] : 0x100000000000000000000000000000000n;
  for (let i = 1; i < TICK_MATH_RATIOS.length; i += 1) {
    if ((absTick & (1 << i)) !== 0) ratio = (ratio * TICK_MATH_RATIOS[i]) >> 128n;
  }
  if (t > 0) ratio = MAX_UINT256 / ratio;
  return ratio % (1n << 32n) === 0n ? ratio >> 32n : (ratio >> 32n) + 1n;
}

function amount0Delta(liquidity, sqrtA, sqrtB) {
  let lower = BigInt(sqrtA);
  let upper = BigInt(sqrtB);
  if (lower > upper) [lower, upper] = [upper, lower];
  if (lower === upper || liquidity <= 0n) return 0n;
  const numerator1 = BigInt(liquidity) << 96n;
  const numerator2 = upper - lower;
  return ceilDiv(ceilDiv(numerator1 * numerator2, upper), lower);
}

function amount1Delta(liquidity, sqrtA, sqrtB) {
  let lower = BigInt(sqrtA);
  let upper = BigInt(sqrtB);
  if (lower > upper) [lower, upper] = [upper, lower];
  if (lower === upper || liquidity <= 0n) return 0n;
  return ceilDiv(BigInt(liquidity) * (upper - lower), Q96);
}

function baseUnitsToNumber(value, decimals) {
  return Number(value) / 10 ** decimals;
}

function isToken0(tokenA, tokenB) {
  return BigInt(`0x${strip0x(tokenA.address)}`) < BigInt(`0x${strip0x(tokenB.address)}`);
}

function estimateUniswapV3Depth({ descriptor, state, tokenPrices }) {
  if (!state || state.status !== 'loaded') {
    return { status: 'missing-tick-state', ready: false };
  }
  const tokenInIsToken0 = isToken0(descriptor.tokenIn, descriptor.tokenOut);
  const zeroForOne = tokenInIsToken0;
  const currentTick = Number(state.currentTick);
  const currentSqrt = BigInt(state.sqrtPriceX96);
  let liquidity = BigInt(state.activeLiquidity ?? '0');
  const ticks = Array.isArray(state.initializedTicks) ? state.initializedTicks : [];
  const directionTicks = ticks
    .filter((tick) => Number.isFinite(Number(tick.tick)) && Number(tick.tick) !== currentTick)
    .filter((tick) => (zeroForOne ? Number(tick.tick) < currentTick : Number(tick.tick) > currentTick))
    .sort((a, b) => (zeroForOne ? Number(b.tick) - Number(a.tick) : Number(a.tick) - Number(b.tick)));
  let sqrtCursor = currentSqrt;
  let amountIn = 0n;
  let crossed = 0;
  let targetTick = currentTick;
  const segments = [];
  for (const tickRow of directionTicks) {
    if (liquidity <= 0n) break;
    const nextTick = Number(tickRow.tick);
    const nextSqrt = getSqrtRatioAtTick(nextTick);
    const amount = zeroForOne
      ? amount0Delta(liquidity, nextSqrt, sqrtCursor)
      : amount1Delta(liquidity, sqrtCursor, nextSqrt);
    amountIn += amount;
    segments.push({
      fromTick: targetTick,
      toTick: nextTick,
      amountIn: amount.toString(),
      liquidity: liquidity.toString(),
    });
    targetTick = nextTick;
    sqrtCursor = nextSqrt;
    const liquidityNet = BigInt(tickRow.liquidityNet ?? '0');
    liquidity = zeroForOne ? liquidity - liquidityNet : liquidity + liquidityNet;
    crossed += 1;
  }
  const amountInHuman = baseUnitsToNumber(amountIn, descriptor.tokenIn.decimals);
  const tokenInPriceUsd = numberOrNull(tokenPrices?.[descriptor.tokenIn.symbol]);
  return {
    status: directionTicks.length ? 'estimated-loaded-range' : 'no-initialized-tick-in-loaded-range',
    ready: directionTicks.length > 0,
    method: 'uniswap-v3-exact-input-to-loaded-initialized-ticks',
    zeroForOne,
    tokenIn: descriptor.tokenIn.symbol,
    tokenOut: descriptor.tokenOut.symbol,
    tokenInIsToken0,
    amountIn: amountIn.toString(),
    amountInHuman,
    capacityUsd: tokenInPriceUsd == null ? null : amountInHuman * tokenInPriceUsd,
    tokenInPriceUsd,
    currentTick,
    targetTick,
    initializedTicksTraversed: crossed,
    initializedTickCountLoaded: ticks.length,
    remainingLiquidityAfterLoadedRange: liquidity.toString(),
    segments,
    caveat: 'Estimated only across loaded nearby initialized ticks; exact execution still requires same-block quote and fork simulation.',
  };
}

function chainName(artifact) {
  const sourceChain = artifact?.source?.chain;
  return typeof sourceChain === 'string' ? sourceChain : sourceChain?.name ?? null;
}

function rpcEnvVar(artifact) {
  const sourceChain = artifact?.source?.chain;
  return artifact?.source?.rpcEnvVar ?? (typeof sourceChain === 'object' ? sourceChain.rpcEnvVar : null);
}

function latestSampleBlock(candidate) {
  const blocks = (candidate.samples ?? [])
    .map((sample) => Number(sample.blockNumber))
    .filter((block) => Number.isFinite(block) && block > 0);
  return blocks.length ? Math.max(...blocks) : null;
}

async function rpc(rpcUrl, method, params) {
  const retries = envNumber('MARKET_DEPTH_RPC_RETRIES', 2);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), envNumber('MARKET_DEPTH_RPC_TIMEOUT_MS', 20_000));
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

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function ethCall(rpcUrl, to, data, blockNumber) {
  return rpc(rpcUrl, 'eth_call', [{ to, data }, toBlockTag(blockNumber)]);
}

async function tokenBalanceUsd(rpcUrl, token, holder, priceUsd, blockNumber) {
  const cacheKey = `${token.address.toLowerCase()}:${holder.toLowerCase()}:${blockNumber ?? 'latest'}`;
  const cached = tokenBalanceCache.get(cacheKey);
  if (cached) {
    return {
      ...cached,
      priceUsd,
      balanceUsd: priceUsd == null ? null : cached.balanceHuman * priceUsd,
    };
  }
  const result = await ethCall(rpcUrl, token.address, SELECTORS.balanceOf + encodeAddress(holder), blockNumber);
  const balance = hexToBigInt(result);
  const balanceHuman = baseUnitsToNumber(balance, token.decimals);
  const row = {
    symbol: token.symbol,
    token: token.address,
    balance: balance.toString(),
    balanceHuman,
  };
  tokenBalanceCache.set(cacheKey, row);
  return {
    ...row,
    priceUsd,
    balanceUsd: priceUsd == null ? null : balanceHuman * priceUsd,
  };
}

async function tokenBalancesLiquidity(rpcUrl, poolAddress, tokens, prices, blockNumber) {
  const balances = [];
  for (const token of tokens) {
    const priceUsd = numberOrNull(prices?.[token.symbol]);
    try {
      balances.push(await tokenBalanceUsd(rpcUrl, token, poolAddress, priceUsd, blockNumber));
    } catch (err) {
      balances.push({
        symbol: token.symbol,
        token: token.address,
        status: 'balance-read-failed',
        error: String(err.message ?? err).slice(0, 240),
      });
    }
  }
  const usdBalances = balances
    .map((balance) => numberOrNull(balance.balanceUsd))
    .filter((value) => value != null && value > 0);
  return {
    tokenBalances: balances,
    poolLiquidityUsd: usdBalances.length ? usdBalances.reduce((sum, value) => sum + value, 0) : null,
  };
}

async function resolveUniswapV3Pool(rpcUrl, chain, tokenIn, tokenOut, fee, blockNumber) {
  const factory = UNISWAP_V3_FACTORIES[chain];
  if (!factory || !fee) return null;
  const cacheKey = `univ3:${chain}:${tokenIn.address.toLowerCase()}:${tokenOut.address.toLowerCase()}:${fee}:${blockNumber ?? 'latest'}`;
  if (poolResolveCache.has(cacheKey)) return poolResolveCache.get(cacheKey);
  const data =
    SELECTORS.uniswapV3GetPool +
    encodeAddress(tokenIn.address) +
    encodeAddress(tokenOut.address) +
    encodeUint(BigInt(fee));
  const result = await ethCall(rpcUrl, factory, data, blockNumber);
  const address = `0x${strip0x(result).slice(-40)}`;
  const out = /^0x0{40}$/i.test(address) ? null : address;
  poolResolveCache.set(cacheKey, out);
  return out;
}

function decodeSlot0(result) {
  const words = hexWords(result);
  return {
    sqrtPriceX96: hexToBigInt(`0x${words[0]}`).toString(),
    tick: Number(signedWordToBigInt(words[1])),
    observationIndex: Number(hexToBigInt(`0x${words[2]}`)),
    observationCardinality: Number(hexToBigInt(`0x${words[3]}`)),
    observationCardinalityNext: Number(hexToBigInt(`0x${words[4]}`)),
    feeProtocol: Number(hexToBigInt(`0x${words[5]}`)),
    unlocked: hexToBigInt(`0x${words[6]}`) !== 0n,
  };
}

function decodeTick(result, tick) {
  const words = hexWords(result);
  return {
    tick,
    liquidityGross: hexToBigInt(`0x${words[0]}`).toString(),
    liquidityNet: signedWordToBigInt(words[1]).toString(),
  };
}

async function readUniswapV3State(rpcUrl, poolAddress, blockNumber) {
  if (!envBool('MARKET_DEPTH_UNISWAP_TICK_STATE_ENABLED', true)) {
    return { status: 'disabled' };
  }
  const radius = envNumber('MARKET_DEPTH_UNISWAP_TICK_WORD_RADIUS', 1);
  const maxTicks = envNumber('MARKET_DEPTH_UNISWAP_MAX_INITIALIZED_TICKS', 64);
  const cacheKey = `${poolAddress.toLowerCase()}:${blockNumber ?? 'latest'}:${radius}:${maxTicks}`;
  if (uniswapV3StateCache.has(cacheKey)) return uniswapV3StateCache.get(cacheKey);
  try {
    const [slot0Raw, activeLiquidityRaw, tickSpacingRaw] = await Promise.all([
      ethCall(rpcUrl, poolAddress, SELECTORS.uniswapV3Slot0, blockNumber),
      ethCall(rpcUrl, poolAddress, SELECTORS.uniswapV3Liquidity, blockNumber),
      ethCall(rpcUrl, poolAddress, SELECTORS.uniswapV3TickSpacing, blockNumber),
    ]);
    const slot0 = decodeSlot0(slot0Raw);
    const activeLiquidity = hexToBigInt(activeLiquidityRaw);
    const tickSpacing = Number(hexToBigInt(tickSpacingRaw));
    const currentCompressedTick = floorDiv(BigInt(slot0.tick), BigInt(tickSpacing));
    const currentWord = floorDiv(currentCompressedTick, 256n);
    const initializedTicks = [];
    for (let word = currentWord - BigInt(radius); word <= currentWord + BigInt(radius); word += 1n) {
      const bitmapRaw = await ethCall(
        rpcUrl,
        poolAddress,
        SELECTORS.uniswapV3TickBitmap + encodeInt(word),
        blockNumber,
      );
      const bitmap = hexToBigInt(bitmapRaw);
      for (let bit = 0n; bit < 256n; bit += 1n) {
        if ((bitmap & (1n << bit)) === 0n) continue;
        const compressedTick = word * 256n + bit;
        const tick = Number(compressedTick * BigInt(tickSpacing));
        try {
          const tickRaw = await ethCall(
            rpcUrl,
            poolAddress,
            SELECTORS.uniswapV3Ticks + encodeInt(BigInt(tick)),
            blockNumber,
          );
          initializedTicks.push(decodeTick(tickRaw, tick));
          if (initializedTicks.length >= maxTicks) break;
        } catch (err) {
          initializedTicks.push({
            tick,
            status: 'tick-read-failed',
            error: String(err.message ?? err).slice(0, 160),
          });
        }
      }
      if (initializedTicks.length >= maxTicks) break;
    }
    initializedTicks.sort((a, b) => a.tick - b.tick);
    const below = initializedTicks.filter((row) => row.tick <= slot0.tick).at(-1) ?? null;
    const above = initializedTicks.find((row) => row.tick > slot0.tick) ?? null;
    const out = {
      status: 'loaded',
      source: 'uniswap-v3-pool-slot0-liquidity-tick-bitmap',
      sqrtPriceX96: slot0.sqrtPriceX96,
      currentTick: slot0.tick,
      tickSpacing,
      activeLiquidity: activeLiquidity.toString(),
      observationCardinality: slot0.observationCardinality,
      observationCardinalityNext: slot0.observationCardinalityNext,
      scannedWordRadius: radius,
      currentWord: currentWord.toString(),
      initializedTickCount: initializedTicks.length,
      nearestLowerOrCurrentTick: below,
      nearestUpperTick: above,
      distanceToLowerOrCurrentTick: below ? slot0.tick - below.tick : null,
      distanceToUpperTick: above ? above.tick - slot0.tick : null,
      initializedTicks,
    };
    uniswapV3StateCache.set(cacheKey, out);
    return out;
  } catch (err) {
    const out = {
      status: 'read-failed',
      source: 'uniswap-v3-pool-slot0-liquidity-tick-bitmap',
      error: String(err.message ?? err).slice(0, 240),
    };
    uniswapV3StateCache.set(cacheKey, out);
    return out;
  }
}

async function resolveSolidlyPool(rpcUrl, factory, tokenIn, tokenOut, stable, blockNumber) {
  if (!factory) return null;
  const cacheKey = `solidly:${factory.toLowerCase()}:${tokenIn.address.toLowerCase()}:${tokenOut.address.toLowerCase()}:${Boolean(stable)}:${blockNumber ?? 'latest'}`;
  if (poolResolveCache.has(cacheKey)) return poolResolveCache.get(cacheKey);
  const data =
    SELECTORS.solidlyGetPool +
    encodeAddress(tokenIn.address) +
    encodeAddress(tokenOut.address) +
    encodeBool(Boolean(stable));
  const result = await ethCall(rpcUrl, factory, data, blockNumber);
  const address = `0x${strip0x(result).slice(-40)}`;
  const out = /^0x0{40}$/i.test(address) ? null : address;
  poolResolveCache.set(cacheKey, out);
  return out;
}

async function resolveV2Pair(rpcUrl, factory, tokenIn, tokenOut, blockNumber) {
  if (!factory) return null;
  const cacheKey = `v2:${factory.toLowerCase()}:${tokenIn.address.toLowerCase()}:${tokenOut.address.toLowerCase()}:${blockNumber ?? 'latest'}`;
  if (poolResolveCache.has(cacheKey)) return poolResolveCache.get(cacheKey);
  const data = SELECTORS.v2GetPair + encodeAddress(tokenIn.address) + encodeAddress(tokenOut.address);
  const result = await ethCall(rpcUrl, factory, data, blockNumber);
  const address = `0x${strip0x(result).slice(-40)}`;
  const out = /^0x0{40}$/i.test(address) ? null : address;
  poolResolveCache.set(cacheKey, out);
  return out;
}

function buildTokenMap(artifact) {
  const tokens = new Map();
  for (const candidate of artifact?.candidates ?? []) {
    for (const token of [candidate.startToken, candidate.midToken, ...(candidate.pool?.tokens ?? [])]) {
      if (token?.symbol && token?.address) tokens.set(token.symbol, token);
    }
  }
  return tokens;
}

function sampleForCandidate(candidate) {
  return (candidate.samples ?? []).find((sample) => sample.status === 'quoted') ?? candidate.samples?.[0] ?? null;
}

function legDescriptors(candidate, artifact) {
  const sample = sampleForCandidate(candidate);
  if (!sample) return [];
  const tokenMap = buildTokenMap(artifact);
  const descriptors = [];
  if (Array.isArray(sample.legs)) {
    for (const leg of sample.legs) {
      const tokenIn = tokenMap.get(leg.tokenIn);
      const tokenOut = tokenMap.get(leg.tokenOut);
      if (tokenIn && tokenOut) descriptors.push({ dex: leg.dex, tokenIn, tokenOut, route: leg.route ?? {} });
    }
    return descriptors;
  }
  if (sample.firstRoute && sample.secondRoute && candidate.startToken && candidate.midToken) {
    descriptors.push({
      dex: sample.firstDex ?? candidate.dexPath?.[0] ?? candidate.buyDex,
      tokenIn: candidate.startToken,
      tokenOut: candidate.midToken,
      route: sample.firstRoute,
    });
    descriptors.push({
      dex: sample.secondDex ?? candidate.dexPath?.[1] ?? candidate.sellDex,
      tokenIn: candidate.midToken,
      tokenOut: candidate.startToken,
      route: sample.secondRoute,
    });
    return descriptors;
  }
  if (sample.buyRoute && sample.sellRoute && candidate.startToken && candidate.midToken) {
    descriptors.push({
      dex: sample.buyDex ?? candidate.buyDex,
      tokenIn: candidate.startToken,
      tokenOut: candidate.midToken,
      route: sample.buyRoute,
    });
    descriptors.push({
      dex: sample.sellDex ?? candidate.sellDex,
      tokenIn: candidate.midToken,
      tokenOut: candidate.startToken,
      route: sample.sellRoute,
    });
  }
  return descriptors;
}

async function routePoolSnapshot({ artifact, candidate, descriptor, rpcUrl, chain, blockNumber }) {
  const prices = artifact?.source?.tokenPrices ?? {};
  if (descriptor.dex === 'uniswap-v3') {
    if (!rpcUrl) return missingPool(descriptor, 'missing-rpc');
    const poolAddress = await resolveUniswapV3Pool(
      rpcUrl,
      chain,
      descriptor.tokenIn,
      descriptor.tokenOut,
      descriptor.route?.fee,
      blockNumber,
    );
    if (!poolAddress) return missingPool(descriptor, 'pool-not-found');
    const liquidity = await tokenBalancesLiquidity(
      rpcUrl,
      poolAddress,
      [descriptor.tokenIn, descriptor.tokenOut],
      prices,
      blockNumber,
    );
    const uniswapV3State = await readUniswapV3State(rpcUrl, poolAddress, blockNumber);
    const uniswapV3Depth = estimateUniswapV3Depth({
      descriptor,
      state: uniswapV3State,
      tokenPrices: prices,
    });
    return {
      ...basePool(descriptor),
      poolAddress,
      source: 'onchain-token-balances',
      uniswapV3State,
      uniswapV3Depth,
      ...liquidity,
    };
  }
  if (descriptor.dex === 'aerodrome') {
    if (!rpcUrl) return missingPool(descriptor, 'missing-rpc');
    const poolAddress = await resolveSolidlyPool(
      rpcUrl,
      descriptor.route?.factory ?? artifact?.source?.aerodromeFactory,
      descriptor.tokenIn,
      descriptor.tokenOut,
      descriptor.route?.stable,
      blockNumber,
    );
    if (!poolAddress) return missingPool(descriptor, 'pool-not-found');
    const liquidity = await tokenBalancesLiquidity(
      rpcUrl,
      poolAddress,
      [descriptor.tokenIn, descriptor.tokenOut],
      prices,
      blockNumber,
    );
    return { ...basePool(descriptor), poolAddress, source: 'onchain-token-balances', ...liquidity };
  }
  if (descriptor.dex === 'sushiswap-v2' || descriptor.dex === 'quickswap-v2') {
    if (!rpcUrl) return missingPool(descriptor, 'missing-rpc');
    const factory = artifact?.source?.contracts?.sushiswapV2Factory ?? artifact?.source?.contracts?.quickswapV2Factory;
    const poolAddress = await resolveV2Pair(rpcUrl, factory, descriptor.tokenIn, descriptor.tokenOut, blockNumber);
    if (!poolAddress) return missingPool(descriptor, 'pool-not-found');
    const liquidity = await tokenBalancesLiquidity(
      rpcUrl,
      poolAddress,
      [descriptor.tokenIn, descriptor.tokenOut],
      prices,
      blockNumber,
    );
    return { ...basePool(descriptor), poolAddress, source: 'onchain-token-balances', ...liquidity };
  }
  if (descriptor.dex?.startsWith('curve') || descriptor.route?.poolName?.startsWith('Curve')) {
    if (!rpcUrl) return missingPool(descriptor, 'missing-rpc');
    const poolAddress = descriptor.route?.pool;
    if (!poolAddress) return missingPool(descriptor, 'pool-not-found');
    const tokenMap = buildTokenMap(artifact);
    const poolTokens = ['DAI', 'USDC', 'USDT']
      .map((symbol) => tokenMap.get(symbol))
      .filter(Boolean);
    const liquidity = await tokenBalancesLiquidity(
      rpcUrl,
      poolAddress,
      poolTokens.length ? poolTokens : [descriptor.tokenIn, descriptor.tokenOut],
      prices,
      blockNumber,
    );
    return {
      ...basePool(descriptor),
      poolAddress,
      poolName: descriptor.route?.poolName ?? null,
      source: 'onchain-token-balances',
      ...liquidity,
    };
  }
  if (descriptor.dex === 'balancer-v2') {
    const direct = candidate.pool?.totalLiquidityUsd ?? candidate.pool?.dynamicData?.totalLiquidity;
    return {
      ...basePool(descriptor),
      poolId: descriptor.route?.poolId ?? candidate.pool?.id ?? null,
      poolType: descriptor.route?.poolType ?? candidate.pool?.type ?? null,
      poolLiquidityUsd: numberOrNull(direct),
      source: numberOrNull(direct) == null ? 'missing-balancer-liquidity' : 'balancer-api-total-liquidity',
      tokenBalances: [],
    };
  }
  return missingPool(descriptor, 'unsupported-dex');
}

function basePool(descriptor) {
  return {
    dex: descriptor.dex ?? null,
    tokenIn: descriptor.tokenIn?.symbol ?? null,
    tokenOut: descriptor.tokenOut?.symbol ?? null,
    route: descriptor.route ?? {},
  };
}

function missingPool(descriptor, source) {
  return {
    ...basePool(descriptor),
    poolAddress: null,
    poolLiquidityUsd: null,
    volume24hUsd: null,
    source,
    tokenBalances: [],
  };
}

function aggregateLiquidity(routePools) {
  if (!routePools.length) return null;
  const liquidities = routePools.map((pool) => numberOrNull(pool.poolLiquidityUsd));
  if (liquidities.some((value) => value == null || value <= 0)) return null;
  return Math.min(...liquidities);
}

function aggregateVolume(routePools) {
  if (!routePools.length) return null;
  const volumes = routePools.map((pool) => numberOrNull(pool.volume24hUsd));
  if (volumes.some((value) => value == null || value <= 0)) return null;
  return Math.min(...volumes);
}

function poolAddressForIndexer(pool) {
  if (pool.poolAddress) return pool.poolAddress;
  if (typeof pool.poolId === 'string' && /^0x[0-9a-f]{64}$/i.test(pool.poolId)) {
    return pool.poolId.slice(0, 42);
  }
  return null;
}

async function withDexScreenerMetrics(pool, chain) {
  if (!envBool('MARKET_DEPTH_ENABLE_DEXSCREENER', true)) {
    return { ...pool, volume24hUsd: null, volume24hSource: 'dexscreener-disabled' };
  }
  const chainId = DEXSCREENER_CHAINS[chain] ?? String(chain ?? '').toLowerCase();
  const pairId = poolAddressForIndexer(pool);
  if (!chainId || !pairId) {
    return { ...pool, volume24hUsd: null, volume24hSource: 'missing-indexer-pair-id' };
  }
  const cacheKey = `${chainId}:${pairId.toLowerCase()}`;
  try {
    let body = dexScreenerCache.get(cacheKey);
    if (!body) {
      const url = `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(
        chainId,
      )}/${encodeURIComponent(pairId)}`;
      body = await fetchJson(url, envNumber('MARKET_DEPTH_DEXSCREENER_TIMEOUT_MS', 10_000));
      dexScreenerCache.set(cacheKey, body);
      await sleep(envNumber('MARKET_DEPTH_DEXSCREENER_DELAY_MS', 120));
    }
    const pairs = Array.isArray(body?.pairs) ? body.pairs : [];
    const pair =
      pairs.find((row) => String(row.pairAddress ?? '').toLowerCase() === pairId.toLowerCase()) ??
      pairs[0] ??
      null;
    if (!pair) {
      return { ...pool, volume24hUsd: null, volume24hSource: 'missing-indexer-pair' };
    }
    const indexerLiquidityUsd = numberOrNull(pair.liquidity?.usd);
    const volume24hUsd = numberOrNull(pair.volume?.h24);
    return {
      ...pool,
      poolLiquidityUsd: pool.poolLiquidityUsd ?? indexerLiquidityUsd,
      indexerPoolLiquidityUsd: indexerLiquidityUsd,
      volume24hUsd,
      volume24hSource: volume24hUsd == null ? 'missing-indexer-volume' : 'dexscreener-pair-api',
      indexer: {
        provider: 'dexscreener',
        chainId,
        dexId: pair.dexId ?? null,
        pairAddress: pair.pairAddress ?? pairId,
        url: pair.url ?? null,
        liquidityUsd: indexerLiquidityUsd,
        volume24hUsd,
      },
    };
  } catch (err) {
    return {
      ...pool,
      volume24hUsd: null,
      volume24hSource: 'dexscreener-read-failed',
      indexerError: String(err.message ?? err).slice(0, 240),
    };
  }
}

async function candidateSnapshot(artifact, familyKey, artifactFile, candidate) {
  const chain = chainName(artifact);
  const rpcUrl = process.env[rpcEnvVar(artifact) ?? ''] ?? null;
  const blockNumber = latestSampleBlock(candidate);
  const descriptors = legDescriptors(candidate, artifact);
  const routePools = [];
  for (const descriptor of descriptors) {
    try {
      const pool = await routePoolSnapshot({ artifact, candidate, descriptor, rpcUrl, chain, blockNumber });
      routePools.push(await withDexScreenerMetrics(pool, chain));
    } catch (err) {
      routePools.push({
        ...basePool(descriptor),
        poolLiquidityUsd: null,
        volume24hUsd: null,
        volume24hSource: 'missing-indexer-volume',
        source: 'depth-read-failed',
        error: String(err.message ?? err).slice(0, 240),
      });
    }
  }
  if (!routePools.length && candidate.pool?.totalLiquidityUsd != null) {
    routePools.push({
      dex: candidate.sellDex ?? 'balancer-v2',
      poolId: candidate.pool.id ?? null,
      poolLiquidityUsd: numberOrNull(candidate.pool.totalLiquidityUsd),
      volume24hUsd: null,
      volume24hSource: 'missing-indexer-volume',
      source: 'artifact-total-liquidity',
      tokenBalances: [],
    });
  }
  const poolLiquidityUsd = aggregateLiquidity(routePools);
  const volume24hUsd = aggregateVolume(routePools);
  return {
    opportunityId: candidate.id,
    familyKey,
    artifactFile,
    chain,
    generatedAt: new Date().toISOString(),
    blockNumber,
    poolLiquidityUsd,
    poolLiquiditySource: poolLiquidityUsd == null ? 'missing-route-liquidity' : 'route-min-pool-liquidity-usd',
    volume24hUsd,
    volume24hSource: volume24hUsd == null ? 'missing-indexer-volume' : 'route-min-volume24h-usd',
    routePools,
  };
}

async function main() {
  loadDotenv();
  const specs = [
    ['dex-quote-replay', 'dex-arbitrage-candidates.json'],
    ['dex-quote-replay', 'dex-arbitrage-candidates-ethereum.json'],
    ['uniswap-v3-fee-arb', 'uniswap-v3-fee-arbitrage-candidates-base.json'],
    ['uniswap-v3-fee-arb', 'uniswap-v3-fee-arbitrage-candidates-ethereum.json'],
    ['curve-stable-arb', 'curve-stable-arbitrage-candidates-ethereum.json'],
    ['balancer-v2-arb', 'balancer-arbitrage-candidates-ethereum.json'],
  ];
  const maxPerArtifact = envNumber('MARKET_DEPTH_MAX_PER_ARTIFACT', 25);
  const snapshots = [];
  const sources = [];
  for (const [familyKey, artifactFile] of specs) {
    const artifact = await readJson(artifactFile);
    if (!artifact) {
      sources.push({ artifactFile, familyKey, status: 'missing' });
      continue;
    }
    sources.push({
      artifactFile,
      familyKey,
      status: 'loaded',
      generatedAt: artifact.generatedAt ?? null,
      candidateCount: artifact.candidates?.length ?? 0,
    });
    for (const candidate of (artifact.candidates ?? []).slice(0, maxPerArtifact)) {
      snapshots.push(await candidateSnapshot(artifact, familyKey, artifactFile, candidate));
    }
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    methodology: {
      indexerReferences: ['https://docs.dexscreener.com/api/reference'],
      poolLiquidityUsd:
        'For routed DEX opportunities, liquidity is the minimum USD token-balance liquidity across known route pools. For Balancer, API totalLiquidity is used when present.',
      volume24hUsd:
        '24h volume is read from the DEX Screener pair API when the route pool is indexed; missing-indexer-volume is an explicit blocker for production sizing.',
      caveats: [
        'Uniswap V3 slot0, active liquidity, and nearby initialized ticks are captured when RPC allows it; exact swap-depth still requires per-tick swap simulation.',
        'Token-balance liquidity is a screening input, not an execution guarantee.',
        'DEX Screener coverage is best-effort and can miss pools or lag current on-chain state.',
      ],
    },
    summary: {
      sourceCount: sources.length,
      loadedSourceCount: sources.filter((source) => source.status === 'loaded').length,
      snapshotCount: snapshots.length,
      liquidityKnownCount: snapshots.filter((snapshot) => snapshot.poolLiquidityUsd != null).length,
      volumeKnownCount: snapshots.filter((snapshot) => snapshot.volume24hUsd != null).length,
    },
    sources,
    snapshots,
  };
  await mkdir(dataDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `marketDepthSnapshots=${report.summary.snapshotCount} liquidityKnown=${report.summary.liquidityKnownCount} volumeKnown=${report.summary.volumeKnownCount} artifact=${outPath}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
