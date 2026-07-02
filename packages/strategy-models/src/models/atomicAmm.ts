/**
 * Model A — Atomic AMM Arbitrage.
 *
 * Same-chain atomic arbitrage: buy on one DEX, sell on another (or via a cycle)
 * within a single transaction. Flash-loan or vault capital. This TS layer
 * orchestrates; the graph search + DEX math run in Rust (crates/strategy-core).
 */

import { BaseStrategyModel } from '../interface.js';
import { assetBySymbol } from '@oal/config';
import type { MarketContext, Opportunity, PoolRef } from '@oal/sdk';

export class AtomicAmmModel extends BaseStrategyModel {
  readonly id = 'atomic-amm';
  readonly name = 'Atomic AMM Arbitrage';
  readonly version = '1.0.0';
  readonly supportedChains = [8453, 42161];
  readonly capitalMode = 'flash-loan' as const;
  readonly riskClass = 'medium' as const;

  get supportedAssets(): `0x${string}`[] {
    return this.supportedChains
      .flatMap((c) => [assetBySymbol(c, 'USDC')?.address, assetBySymbol(c, 'WETH')?.address])
      .filter((a): a is `0x${string}` => !!a);
  }

  async discover(ctx: MarketContext): Promise<Opportunity[]> {
    // Coarse scan: build a graph from the whitelisted pools and look for
    // profitable cycles. The actual search runs in Rust; here we issue the
    // request shape that the opportunity-worker forwards to the cores.
    const opps: Opportunity[] = [];
    for (const asset of ctx.assets) {
      const relevantPools = ctx.pools.filter((p) => p.token0 === asset || p.token1 === asset);
      if (relevantPools.length < 2) continue;
      // The worker calls strategy-core::graph::find_cycles with these pools;
      // for the MVP interface we emit a placeholder discovered opportunity per
      // asset that the worker refines via quote + simulate.
      opps.push(buildDraftOpportunity(this.id, ctx, asset, relevantPools));
    }
    return opps;
  }
}

function buildDraftOpportunity(
  strategyId: string,
  ctx: MarketContext,
  asset: `0x${string}`,
  pools: PoolRef[],
): Opportunity {
  // Draft a 2-hop cyclic route through the first two relevant pools so the
  // opportunity carries a route shape the worker can refine via Rust quoting.
  const hops =
    pools.length >= 2
      ? [
          {
            pool: pools[0],
            tokenIn: asset,
            tokenOut: pools[0].token0 === asset ? pools[0].token1 : pools[0].token0,
            zeroForOne: pools[0].token0 === asset,
          },
          {
            pool: pools[1],
            tokenIn: pools[0].token0 === asset ? pools[0].token1 : pools[0].token0,
            tokenOut: asset,
            zeroForOne: pools[1].token0 === asset,
          },
        ]
      : [];
  return {
    id: `opp-${strategyId}-${ctx.chainId}-${ctx.blockNumber}-${asset.slice(0, 8)}`,
    strategyId,
    chainId: ctx.chainId,
    blockNumber: ctx.blockNumber,
    assetIn: asset,
    capitalRequired: '0',
    expectedProfit: '0',
    expectedGas: 180_000,
    expectedBribe: '0',
    netProfit: '0',
    route: { hops },
    confidence: 0,
    ttlBlocks: 1,
    riskFlags: [],
    status: 'discovered',
  };
}
