/**
 * Unified cost model V2 — all costs in USD.
 *
 * Per full-audit plan §2.2:
 *   netProfit = exitProceeds - debtRepay - protocolFee - flashFee - dexFees
 *               - gas - builderTip - failureReserve - inventoryHaircut
 *
 * Each component is computed from event-block truth (gas from receipt, fees
 * from protocol params, slippage from exit-route fork quote).
 */

import type { CostBreakdownV2 } from './types.js';

export interface CostModelParamsV2 {
  flashLoanPremiumBps: number; // e.g. 9 for Aave (0.09%)
  protocolFeeBps: number; // e.g. 1000 for Aave liquidation fee (10%)
  dexFeeBps: number; // pool fee for exit route (e.g. 5 for 0.05%)
  gasCostWei: string; // from receipt: effectiveGasPrice * gasUsed
  ethPriceUsd: number; // ETH price at event block (for gas conversion)
  builderTipFraction: number; // fraction of gross profit paid to builder (e.g. 0.30)
  failureRate: number; // estimated fraction of attempts that fail (e.g. 0.15)
  inventoryHaircutBps: number; // haircut for holding collateral (e.g. 50 = 0.5%)
}

export interface CostInput {
  grossProceedsUsd: number; // from exit route quote at event block
  debtRepayUsd: number; // debt to cover
  collateralValueUsd: number; // value of seized collateral
  capitalRequiredUsd: number; // how much capital is deployed
  params: CostModelParamsV2;
}

/**
 * Compute the full cost breakdown and net profit.
 * Returns all components so the breakdown is transparent and auditable.
 */
export function computeNetProfit(input: CostInput): {
  costs: CostBreakdownV2;
  netProfit: number;
  returnOnCapital: number;
} {
  const { grossProceedsUsd, debtRepayUsd, collateralValueUsd, capitalRequiredUsd, params } = input;

  // Flash loan premium: charged on the principal borrowed.
  const flashLoanPrincipal = Math.max(debtRepayUsd, capitalRequiredUsd);
  const flashLoanPremium = (flashLoanPrincipal * params.flashLoanPremiumBps) / 10_000;

  // Protocol fee: e.g. Aave takes a % of the liquidated collateral.
  const protocolFee = (collateralValueUsd * params.protocolFeeBps) / 10_000;

  // DEX fees: charged on the exit swap.
  const dexFees = (grossProceedsUsd * params.dexFeeBps) / 10_000;

  // Slippage/price impact: difference between ideal and actual exit proceeds.
  // This is embedded in grossProceedsUsd (from fork quote), so we extract it
  // as the haircut relative to the spot collateral value.
  const slippage = Math.max(0, collateralValueUsd - grossProceedsUsd - dexFees);

  // Gas cost in USD.
  const gasCost = (Number(params.gasCostWei) * params.ethPriceUsd) / 1e18;

  // Builder tip: fraction of GROSS profit (before tip).
  const grossBeforeTip = grossProceedsUsd - debtRepayUsd - flashLoanPremium - protocolFee - dexFees - gasCost;
  const builderTip = Math.max(0, grossBeforeTip * params.builderTipFraction);

  // Failure reserve: expected cost of failed attempts.
  // If failureRate=0.15, we expect 1 success per 1/(1-0.15)=1.18 attempts.
  // The failed attempt costs gas (and possibly bribe) without profit.
  const failureReserve = (gasCost + builderTip) * (params.failureRate / (1 - params.failureRate));

  // Inventory haircut: for non-atomic exits (holding collateral briefly).
  const inventoryHaircut = (collateralValueUsd * params.inventoryHaircutBps) / 10_000;

  const costs: CostBreakdownV2 = {
    flashLoanPremium,
    protocolFee,
    dexFees,
    slippage,
    gasCost,
    builderTip,
    failureReserve,
    inventoryHaircut,
    total:
      flashLoanPremium + protocolFee + dexFees + slippage + gasCost + builderTip + failureReserve + inventoryHaircut,
  };

  const netProfit = grossProceedsUsd - debtRepayUsd - costs.total;
  const returnOnCapital = capitalRequiredUsd > 0 ? netProfit / capitalRequiredUsd : 0;

  return { costs, netProfit, returnOnCapital };
}

/**
 * Stressed cost model: multiply variable costs by a stress factor.
 * Per plan §2.1: "压力成本情景下净 APY >= 10%".
 */
export function computeStressNetProfit(
  input: CostInput,
  stressFactor: number,
): { costs: CostBreakdownV2; netProfit: number } {
  const stressed: CostInput = {
    ...input,
    params: {
      ...input.params,
      flashLoanPremiumBps: input.params.flashLoanPremiumBps * stressFactor,
      dexFeeBps: input.params.dexFeeBps * stressFactor,
      gasCostWei: (BigInt(Math.round(Number(input.params.gasCostWei) * stressFactor))).toString(),
      builderTipFraction: Math.min(0.99, input.params.builderTipFraction * stressFactor),
      failureRate: Math.min(0.9, input.params.failureRate * stressFactor),
      inventoryHaircutBps: input.params.inventoryHaircutBps * stressFactor,
    },
  };
  return computeNetProfit(stressed);
}
