/**
 * Model B — MEV-Share Backrun.
 *
 * Listens to pending/private orderflow (MEV-Share hint stream), predicts the
 * AMM price impact of a target swap, and backruns it to capture the spread.
 * Capital: flash-loan or vault. This TS layer subscribes to the orderflow
 * stream via the opportunity-worker; the precise price-impact math runs in
 * Rust (strategy-core::dex).
 */

import { BaseStrategyModel } from '../interface.js';
import { assetBySymbol } from '@oal/config';
import type { MarketContext, Opportunity } from '@oal/sdk';

export class MevBackrunModel extends BaseStrategyModel {
  readonly id = 'mev-backrun';
  readonly name = 'MEV-Share Backrun';
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
    // The opportunity-worker feeds MEV-Share hints here. For the interface
    // contract we emit nothing by default; hints produce opportunities when
    // the worker is connected to the orderflow stream.
    void ctx;
    return [];
  }
}
