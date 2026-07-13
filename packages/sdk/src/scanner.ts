/**
 * Standard OpportunityEnvelope — the canonical format scanners emit and
 * executors consume. Per full-audit plan §3.
 *
 * Scanner emits these into Redis Streams. Executor does NOT trust the
 * scanner's profit claims and re-verifies everything.
 */

export interface OpportunityEnvelope {
  // Identity
  strategyId: string;
  strategyVersion: string;
  codeHash: string; // scanner code version

  // Provenance
  chainId: number;
  blockNumber: number;
  blockHash: string;
  observedAt: number; // epoch ms when scanner saw it

  // Execution details
  route: RouteLeg[];
  calldataTemplate: string; // ABI-encoded calldata with placeholders
  amountCurve?: AmountPoint[]; // profit at different capital sizes

  // Economics (scanner's estimate — executor re-verifies)
  grossProfitUsd: number;
  netProfitUsd: number;
  costBreakdown: {
    gasUsd: number;
    flashLoanPremiumUsd: number;
    protocolFeeUsd: number;
    dexFeesUsd: number;
    builderTipUsd: number;
  };

  // Limits
  minProfitUsd: number;
  maxGasCostUsd: number;
  maxSlippageBps: number;
  capacityUsd: number; // max capital this opportunity supports

  // Timing
  ttlBlocks: number; // how many blocks this stays valid
  quoteAgeBlocks: number; // how old the quote is
  deadline: number; // unix ms deadline

  // Integrity
  evidenceHash: string; // hash of the evidence (block state, quotes, etc.)
}

export interface RouteLeg {
  protocol: string;
  action: string; // 'liquidate', 'swap', 'absorb', 'buyCollateral', 'take'
  target: string; // contract address
  args: Record<string, string>; // encoded args
}

export interface AmountPoint {
  capitalUsd: number;
  estimatedNetProfitUsd: number;
}

/**
 * Idempotency key for an envelope: deterministic from chainId + block + strategy + route.
 * Prevents duplicate opportunities from being submitted.
 */
export function envelopeIdempotencyKey(env: OpportunityEnvelope): string {
  const routeSig = env.route.map((r) => `${r.action}:${r.target}`).join('|');
  return `${env.chainId}:${env.blockNumber}:${env.strategyId}:${routeSig}`;
}
