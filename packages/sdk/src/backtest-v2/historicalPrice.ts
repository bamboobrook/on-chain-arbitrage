/**
 * Historical price oracle — fetches asset prices AT a specific block.
 *
 * Per full-audit plan §2: "优先协议 oracle at block，再用链上 TWAP/DEX quote
 * 交叉验证。禁止任何历史事件使用 prices/current。"
 *
 * Sources (priority order):
 * 1. Protocol oracle at block (Aave PriceOracle, Chainlink aggregator)
 * 2. On-chain TWAP via Uniswap V3 pool observations at block
 * 3. DEX quote at block (Quoter V2 exactInputSingle)
 *
 * NEVER uses DefiLlama prices/current (that was V1's bug — audit §1.2 item 1).
 */

// (ArtifactEnvelope not needed here; price quotes are embedded in events.)

export interface PriceQuote {
  asset: string;
  blockNumber: number;
  priceUsd: number;
  source: 'aave-oracle' | 'chainlink' | 'uni-v3-twap' | 'uni-v3-quoter' | 'curve-get_dy';
  confidence: 'high' | 'medium' | 'low';
  blockHash?: string;
  rpcSource: string;
}

export interface PriceCrossCheck {
  asset: string;
  blockNumber: number;
  primary: PriceQuote;
  crossChecks: PriceQuote[];
  agreed: boolean; // all sources within 2%
  finalPrice: number; // the price to use
}

/**
 * Fetch a Chainlink aggregator price at a specific block.
 * Chainlink feeds: ETH/USD = 0x5f4e... , BTC/USD = 0xfdFD... etc.
 */
export async function chainlinkPriceAtBlock(
  aggregatorAddress: string,
  blockNumber: number,
  rpcUrl: string,
): Promise<PriceQuote> {
  // Chainlink latestRoundData() returns (uint80 roundId, int256 answer, ...)
  // selector = 0xfeaf968c
  const data = '0xfeaf968c';
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: aggregatorAddress, data }, `0x${blockNumber.toString(16)}`],
    }),
    signal: AbortSignal.timeout(10000),
  });
  const json = (await res.json()) as { result?: string; error?: unknown };
  if (json.error || !json.result) {
    throw new Error(`chainlink price call failed at block ${blockNumber}: ${JSON.stringify(json.error)}`);
  }
  // latestRoundData returns 5 words: roundId, answer, startedAt, updatedAt, answeredInRound
  // answer is the 2nd word (offset 32..64). It's scaled by feed decimals (usually 8).
  const hex = json.result.slice(2);
  const words: bigint[] = [];
  for (let i = 0; i < hex.length; i += 64) {
    words.push(BigInt('0x' + hex.slice(i, i + 64)));
  }
  const answer = words[1]; // int256 answer
  const decimals = 8; // Chainlink USD feeds use 8 decimals
  const price = Number(answer) / 10 ** decimals;
  return {
    asset: aggregatorAddress,
    blockNumber,
    priceUsd: price,
    source: 'chainlink',
    confidence: 'high',
    rpcSource: rpcUrl.split('/v2/')[0] ?? rpcUrl,
  };
}

/**
 * Fetch a Uniswap V3 TWAP at a specific block using pool observe().
 * This gives a time-weighted average price resistant to manipulation.
 */
export async function uniswapV3TwapAtBlock(
  poolAddress: string,
  blockNumber: number,
  rpcUrl: string,
  secondsAgo: number = 1800,
): Promise<PriceQuote | null> {
  // observe(uint32[] secondsAgos) returns int56[] tickCumulatives
  // selector = 0x887bdb7a
  // encode: selector + offset(0x20) + array_length(2) + secondsAgo + 0
  const tw = Math.floor(secondsAgo);
  const data =
    '0x887bdb7a' +
    '0000000000000000000000000000000000000000000000000000000000000020' +
    '0000000000000000000000000000000000000000000000000000000000000002' +
    tw.toString(16).padStart(64, '0') +
    '0'.repeat(64);
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: poolAddress, data }, `0x${blockNumber.toString(16)}`],
      }),
      signal: AbortSignal.timeout(10000),
    });
    const json = (await res.json()) as { result?: string; error?: unknown };
    if (json.error || !json.result) return null;
    const hex = json.result.slice(2);
    const ticks: bigint[] = [];
    for (let i = 0; i < hex.length; i += 64) {
      ticks.push(BigInt('0x' + hex.slice(i, i + 64)));
    }
    if (ticks.length < 2) return null;
    // tickCumulative at [secondsAgo, 0]. delta = tick1 - tick0. twap tick = delta/secondsAgo
    let delta = ticks[1] - ticks[0];
    // handle sign (int56 stored as uint256)
    const MASK_56 = (1n << 56n) - 1n;
    delta = delta & MASK_56;
    if (delta > (1n << 55n)) delta -= 1n << 56n; // sign-extend
    const twapTick = Number(delta) / secondsAgo;
    const price = 1.0001 ** twapTick;
    return {
      asset: poolAddress,
      blockNumber,
      priceUsd: price,
      source: 'uni-v3-twap',
      confidence: 'medium',
      rpcSource: rpcUrl.split('/v2/')[0] ?? rpcUrl,
    };
  } catch {
    return null;
  }
}

/**
 * Cross-check a primary price against alternative sources.
 * If sources disagree by >2%, flag as not-agreed (use primary but lower confidence).
 */
export function crossCheckPrices(
  asset: string,
  blockNumber: number,
  primary: PriceQuote,
  alternatives: PriceQuote[],
): PriceCrossCheck {
  const allPrices = [primary, ...alternatives].filter((p) => p.priceUsd > 0);
  if (allPrices.length === 0) {
    return { asset, blockNumber, primary, crossChecks: alternatives, agreed: false, finalPrice: 0 };
  }
  const min = Math.min(...allPrices.map((p) => p.priceUsd));
  const max = Math.max(...allPrices.map((p) => p.priceUsd));
  const spread = max > 0 ? (max - min) / min : 0;
  return {
    asset,
    blockNumber,
    primary,
    crossChecks: alternatives,
    agreed: spread < 0.02,
    finalPrice: primary.priceUsd,
  };
}

/**
 * Well-known Chainlink aggregator addresses on Ethereum mainnet.
 */
export const CHAINLINK_FEEDS: Record<string, string> = {
  ETH: '0x5f4eA3A77aB26D77B6EDC7A4A4873D8F4c8c1C50',
  BTC: '0xfdFD9e9A6e2373b3926F2f7DBFfC75eA7fBf6F2D',
  USDC: '0x8ffffFd4AfB6115b954BdFe26a5246211cAFD7d2',
  USDT: '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D',
  DAI: '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9',
  WBTC: '0xfdFD9e9A6e2373b3926F2f7DBFfC75eA7fBf6F2D',
};

/**
 * Get a historical price with full provenance — the ONLY approved method.
 * Returns a PriceCrossCheck with the primary (chainlink) + cross-checks.
 */
export async function getHistoricalPrice(
  asset: string,
  blockNumber: number,
  rpcUrl: string,
  chainlinkFeed?: string,
  uniV3Pool?: string,
): Promise<PriceCrossCheck> {
  const primary = chainlinkFeed
    ? await chainlinkPriceAtBlock(chainlinkFeed, blockNumber, rpcUrl)
    : { asset, blockNumber, priceUsd: 0, source: 'chainlink' as const, confidence: 'low' as const, rpcSource: rpcUrl };
  const alternatives: PriceQuote[] = [];
  if (uniV3Pool) {
    const twap = await uniswapV3TwapAtBlock(uniV3Pool, blockNumber, rpcUrl);
    if (twap) alternatives.push(twap);
  }
  return crossCheckPrices(asset, blockNumber, primary, alternatives);
}
