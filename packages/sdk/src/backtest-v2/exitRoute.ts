/**
 * Exit route quoting — get collateral/asset proceeds at the EVENT BLOCK.
 *
 * Per full-audit plan §2: "在事件区块 fork 上对不同 amount 做 exact
 * quote/simulation"。
 *
 * Uses the on-chain Quoter V2 (same as two-pool-scan) to get EXACT swap
 * output for the collateral at the historical block. This replaces V1's
 * assumption of "拿到抵押品即可按现价卖出" (audit §1.2 item 3).
 */

import type { ExitRouteQuote } from './types.js';

/**
 * Quote a Uniswap V3 swap at a specific historical block.
 * Uses QuoterV2.quoteExactInputSingle (selector 0xc6a5026a).
 */
export async function quoteExitRoute(params: {
  rpcUrl: string;
  quoterAddress: string; // Uniswap V3 QuoterV2
  tokenIn: string; // collateral asset
  tokenOut: string; // output (usually USDC/USDT)
  amountIn: string; // base units, decimal string
  fee: number; // pool fee in millionths (e.g. 500 = 0.05%)
  blockNumber: number;
  eventId: string;
}): Promise<ExitRouteQuote> {
  const { rpcUrl, quoterAddress, tokenIn, tokenOut, amountIn, fee, blockNumber, eventId } = params;

  // Encode quoteExactInputSingle((address,address,uint256,uint24,uint160))
  // selector + tokenIn(32) + tokenOut(32) + amountIn(32) + fee(32) + sqrtPriceLimit(32)
  const amountInHex = BigInt(amountIn).toString(16).padStart(64, '0');
  const feeHex = fee.toString(16).padStart(64, '0');
  const tokenInClean = tokenIn.toLowerCase().replace(/^0x/, '').padStart(40, '0');
  const tokenOutClean = tokenOut.toLowerCase().replace(/^0x/, '').padStart(40, '0');
  const data =
    '0xc6a5026a' +
    '000000000000000000000000' + tokenInClean +
    '000000000000000000000000' + tokenOutClean +
    amountInHex +
    feeHex +
    '0'.repeat(64); // sqrtPriceLimitX96 = 0

  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: quoterAddress, data }, `0x${blockNumber.toString(16)}`],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as { result?: string; error?: unknown };
  if (json.error || !json.result) {
    throw new Error(`exit route quote failed at block ${blockNumber}: ${JSON.stringify(json.error)}`);
  }
  const outputAmount = BigInt(json.result).toString();

  // Compute price impact (approximate: need spot price for exact figure).
  const amountInNum = Number(amountIn);
  const amountOutNum = Number(outputAmount);
  // Price impact relative to 1:1 (refined with oracle price in caller).
  const priceImpactBps = amountInNum > 0 ? Math.max(0, (1 - amountOutNum / amountInNum) * 10_000) : 0;

  return {
    eventId,
    method: 'uniswap-v3-quoter',
    blockNumber,
    inputAsset: tokenIn,
    inputAmount: amountIn,
    outputAsset: tokenOut,
    outputAmount,
    priceImpactBps,
    dexFeesBps: fee / 100, // fee in millionths -> bps
    quoteAgeBlocks: 0, // quoted at event block
    rpcSource: rpcUrl.split('/v2/')[0] ?? rpcUrl,
  };
}

/**
 * Well-known Quoter V2 addresses per chain.
 */
export const QUOTER_V2_ADDRESSES: Record<number, string> = {
  1: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', // Ethereum
  42161: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', // Arbitrum
  137: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', // Polygon
  8453: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', // Base
  10: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', // Optimism
};
