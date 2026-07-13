/**
 * Competition model — estimates capture rate from on-chain competition data.
 *
 * Per full-audit plan §2: "观察真实 liquidator/searcher 地址、同区块竞争
 * 交易、成功捕获率。"
 *
 * The model looks at how many competitors targeted the same opportunity in
 * the same block, who won, and estimates the probability WE would capture it.
 */

import type { CompetitionData } from './types.js';

/**
 * Estimate capture rate based on observed competition.
 *
 * Models (configurable):
 * - 'naive': 1/N (uniform probability among N competitors)
 * - 'speed-weighted': higher weight to MEV bots (private relay access)
 * - 'historical': calibrated from observed win rate vs specific competitors
 *
 * Default: 'naive' with a speed bonus if we have private relay access.
 */
export function estimateCaptureRate(
  competitors: number,
  model: 'naive' | 'speed-weighted' | 'historical' = 'naive',
  hasPrivateRelay: boolean = false,
): number {
  if (competitors === 0) return 1.0;
  switch (model) {
    case 'naive': {
      const base = 1 / (competitors + 1);
      // Private relay access gives a speed advantage: +20% relative.
      return hasPrivateRelay ? Math.min(1, base * 1.2) : base;
    }
    case 'speed-weighted': {
      // Assume MEV bots with private relay get 2x weight vs public-mempool bots.
      // Without private relay, our weight is 1; with it, 2.
      const ourWeight = hasPrivateRelay ? 2 : 1;
      const competitorWeight = 2; // assume competitors are sophisticated
      const totalWeight = ourWeight + competitors * competitorWeight;
      return ourWeight / totalWeight;
    }
    case 'historical': {
      // Placeholder: would be calibrated from actual observed win/loss log.
      return 1 / (competitors + 1);
    }
  }
}

/**
 * Build competition data for an event by scanning the same block for
 * competing liquidation/arbitrage transactions.
 *
 * In production this queries the indexer for all txs targeting the same
 * user/opportunity in the same block. Here we provide the structure.
 */
export function buildCompetitionData(params: {
  eventId: string;
  blockNumber: number;
  sameBlockCompetitors: number;
  winnerAddress: string;
  winnerTxHash: string;
  competitorAddresses: string[];
  hasPrivateRelay?: boolean;
}): CompetitionData {
  return {
    eventId: params.eventId,
    blockNumber: params.blockNumber,
    sameBlockCompetitors: params.sameBlockCompetitors,
    winnerAddress: params.winnerAddress,
    winnerTxHash: params.winnerTxHash,
    estimatedCaptureRate: estimateCaptureRate(
      params.sameBlockCompetitors,
      'naive',
      params.hasPrivateRelay ?? false,
    ),
    competitorAddresses: params.competitorAddresses,
  };
}
