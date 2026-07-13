/**
 * Model H — Concentrated LP Market Making.
 *
 * Provides liquidity into high-fee APY pools such as Uniswap V3 / Aerodrome
 * Slipstream. This is NOT pure arbitrage. It is included because the user
 * asked the system to find 20%+ on-chain candidates; public pure-arbitrage
 * searches did not find five viable strategies.
 */

import { BaseStrategyModel } from '../interface.js';
import { assetBySymbol } from '@oal/config';
import type { MarketContext, Opportunity } from '@oal/sdk';

export class LpMarketMakingModel extends BaseStrategyModel {
  readonly id = 'lp-market-making';
  readonly name = 'Concentrated LP Market Making';
  readonly version = '1.0.0';
  readonly supportedChains = [1, 8453, 42161];
  readonly capitalMode = 'vault-capital' as const;
  readonly riskClass = 'high' as const;

  get supportedAssets(): `0x${string}`[] {
    return this.supportedChains
      .flatMap((c) => [assetBySymbol(c, 'USDC')?.address, assetBySymbol(c, 'WETH')?.address])
      .filter((a): a is `0x${string}` => !!a);
  }

  async discover(ctx: MarketContext): Promise<Opportunity[]> {
    // Discovery is candidate-driven from data/strategy-candidates.json, which
    // is generated from DeFiLlama Yields. The model emits no blind live
    // opportunities until a concrete pool adapter is enabled.
    void ctx;
    return [];
  }
}
