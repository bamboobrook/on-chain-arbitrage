/**
 * Model E — Peg / LST / Stable-baset arbitrage.
 *
 * Captures deviations of LST/LRT (stETH, wstETH, rETH, cbETH) and stablecoins
 * (USDC/USDT/DAI, sDAI, USDe/sUSDe) from their pegs via Curve/Balancer/Uniswap
 * and lending/redemption markets. Capital: vault (positions are held for a
 * regression half-life, not atomic). NOT risk-free — peg-break, redemption
 * pause and liquidity risk apply (see docs/risk-policy.md).
 */

import { BaseStrategyModel } from '../interface.js';
import { assetBySymbol } from '@oal/config';
import type { MarketContext, Opportunity } from '@oal/sdk';

export class PegLstModel extends BaseStrategyModel {
  readonly id = 'peg-lst';
  readonly name = 'Peg / LST / Stable';
  readonly version = '1.0.0';
  readonly supportedChains = [8453, 42161];
  readonly capitalMode = 'vault-capital' as const;
  readonly riskClass = 'medium' as const;

  get supportedAssets(): `0x${string}`[] {
    return this.supportedChains
      .flatMap((c) => [assetBySymbol(c, 'USDC')?.address, assetBySymbol(c, 'WETH')?.address])
      .filter((a): a is `0x${string}` => !!a);
  }

  async discover(ctx: MarketContext): Promise<Opportunity[]> {
    // Peg monitoring: the opportunity-worker polls DEX/redemption prices and
    // emits an opportunity when the deviation exceeds the regression half-life
    // threshold. Placeholder interface contract below.
    void ctx;
    return [];
  }
}
