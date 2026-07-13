/**
 * Model G — Yield Rotator.
 *
 * Cash-management style on-chain yield allocation. This is NOT arbitrage and
 * does not promise returns; it exists as a conservative place for idle vault
 * assets once protocol adapters and risk filters are configured.
 */

import { BaseStrategyModel } from '../interface.js';
import { assetBySymbol } from '@oal/config';
import type { MarketContext, Opportunity } from '@oal/sdk';

export class YieldRotatorModel extends BaseStrategyModel {
  readonly id = 'yield-rotator';
  readonly name = 'Yield Rotator';
  readonly version = '1.0.0';
  readonly supportedChains = [8453, 42161];
  readonly capitalMode = 'vault-capital' as const;
  readonly riskClass = 'low' as const;

  get supportedAssets(): `0x${string}`[] {
    return this.supportedChains
      .flatMap((c) => [assetBySymbol(c, 'USDC')?.address, assetBySymbol(c, 'WETH')?.address])
      .filter((a): a is `0x${string}` => !!a);
  }

  async discover(ctx: MarketContext): Promise<Opportunity[]> {
    void ctx;
    return [];
  }
}
