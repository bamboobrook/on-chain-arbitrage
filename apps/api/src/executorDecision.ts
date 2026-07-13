type AnyRecord = Record<string, any>;

interface DecisionOptions {
  capitalUsd: number;
  liveExecutionEnabled: boolean;
  signerConfigured: boolean;
  privateRelayRequired: boolean;
  privateRelayConfigured: boolean;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function check(key: string, status: 'pass' | 'block' | 'wait', reason: string, evidence: unknown = null) {
  return { key, status, reason, evidence };
}

function isDexLike(familyKey: string): boolean {
  return (
    familyKey.includes('dex') ||
    familyKey.includes('uniswap') ||
    familyKey.includes('curve') ||
    familyKey.includes('balancer')
  );
}

function uniswapV3TickStateCheck(opp: AnyRecord): AnyRecord {
  const pools = Array.isArray(opp?.market?.routePools) ? opp.market.routePools : [];
  const uniswapPools = pools.filter((pool: AnyRecord) => pool.dex === 'uniswap-v3');
  if (!uniswapPools.length) {
    return { required: false, ready: true, poolCount: 0, loadedCount: 0, failedPools: [] };
  }
  const loaded = uniswapPools.filter((pool: AnyRecord) => pool.uniswapV3State?.status === 'loaded');
  return {
    required: true,
    ready: loaded.length === uniswapPools.length,
    poolCount: uniswapPools.length,
    loadedCount: loaded.length,
    failedPools: uniswapPools
      .filter((pool: AnyRecord) => pool.uniswapV3State?.status !== 'loaded')
      .map((pool: AnyRecord) => ({
        poolAddress: pool.poolAddress ?? null,
        status: pool.uniswapV3State?.status ?? 'missing',
        error: pool.uniswapV3State?.error ?? null,
      })),
  };
}

function uniswapV3DepthCapacityCheck(opp: AnyRecord, requiredCapacityUsd: number): AnyRecord {
  const pools = Array.isArray(opp?.market?.routePools) ? opp.market.routePools : [];
  const uniswapPools = pools.filter((pool: AnyRecord) => pool.dex === 'uniswap-v3');
  if (!uniswapPools.length) {
    return {
      required: false,
      ready: true,
      poolCount: 0,
      readyCount: 0,
      capacityUsd: null,
      requiredCapacityUsd,
      failedPools: [],
    };
  }
  const depthRows: Array<{
    poolAddress: unknown;
    tokenIn: unknown;
    tokenOut: unknown;
    status: unknown;
    ready: boolean;
    capacityUsd: number | null;
    method: unknown;
  }> = uniswapPools.map((pool: AnyRecord) => ({
    poolAddress: pool.poolAddress ?? null,
    tokenIn: pool.tokenIn ?? null,
    tokenOut: pool.tokenOut ?? null,
    status: pool.uniswapV3Depth?.status ?? 'missing',
    ready: pool.uniswapV3Depth?.ready === true,
    capacityUsd: numberOrNull(pool.uniswapV3Depth?.capacityUsd),
    method: pool.uniswapV3Depth?.method ?? null,
  }));
  const readyRows = depthRows.filter((row) => row.ready && row.capacityUsd != null);
  const capacityUsd =
    readyRows.length === uniswapPools.length ? Math.min(...readyRows.map((row) => row.capacityUsd as number)) : null;
  return {
    required: true,
    ready: capacityUsd != null && requiredCapacityUsd > 0 && capacityUsd >= requiredCapacityUsd,
    poolCount: uniswapPools.length,
    readyCount: readyRows.length,
    capacityUsd,
    requiredCapacityUsd,
    source: 'uniswap-v3-exact-input-to-loaded-initialized-ticks',
    failedPools: depthRows.filter((row) => !row.ready || row.capacityUsd == null || row.capacityUsd < requiredCapacityUsd),
  };
}

function verificationByCandidateId(verification: AnyRecord | null): Map<string, AnyRecord> {
  const rows = Array.isArray(verification?.results) ? verification.results : [];
  return new Map(rows.map((row: AnyRecord) => [String(row.candidateId), row]));
}

function quoteAgeMs(opp: AnyRecord): number | null {
  const generatedAt = Date.parse(String(opp?.artifactGeneratedAt ?? ''));
  return Number.isFinite(generatedAt) ? Math.max(0, Date.now() - generatedAt) : null;
}

export function buildExecutorExecutionDecision(
  feed: AnyRecord,
  verification: AnyRecord | null,
  options: Partial<DecisionOptions> = {},
): AnyRecord {
  const policy = {
    capitalUsd: numberOrNull(options.capitalUsd) ?? 0,
    minNetProfitUsd: numberOrNull(process.env.EXECUTOR_MIN_NET_PROFIT_USD) ?? 0.01,
    minExecutionReturnPct: numberOrNull(process.env.EXECUTOR_MIN_EXECUTION_RETURN_PCT) ?? 0,
    minAnnualizedReturnPct:
      numberOrNull(process.env.EXECUTOR_MIN_ANNUALIZED_RETURN_PCT) ??
      numberOrNull(feed?.policy?.minAnnualizedReturnPct) ??
      20,
    maxGasUsd: numberOrNull(process.env.EXECUTOR_MAX_GAS_USD) ?? 25,
    minPoolLiquidityUsd: numberOrNull(process.env.EXECUTOR_MIN_POOL_LIQUIDITY_USD) ?? 0,
    minLiquidityToCapitalRatio: numberOrNull(process.env.EXECUTOR_MIN_LIQUIDITY_TO_CAPITAL_RATIO) ?? 10,
    minVolume24hUsd: numberOrNull(process.env.EXECUTOR_MIN_VOLUME_24H_USD) ?? 0,
    requireVolume24h: !['0', 'false', 'no', 'n'].includes(
      String(process.env.EXECUTOR_REQUIRE_VOLUME_24H ?? '1').toLowerCase(),
    ),
    maxQuoteAgeMs: numberOrNull(feed?.policy?.maxQuoteAgeMs) ?? 2500,
    maxSlippageBps: numberOrNull(feed?.policy?.maxSlippageBps) ?? 30,
    liveExecutionEnabled:
      options.liveExecutionEnabled ??
      ['1', 'true', 'yes', 'y'].includes(String(process.env.LIVE_EXECUTION_ENABLED ?? '').toLowerCase()),
    signerConfigured:
      options.signerConfigured ?? Boolean(process.env.EXECUTOR_PRIVATE_KEY || process.env.EXECUTOR_WALLET_MODE),
    privateRelayRequired:
      options.privateRelayRequired ??
      !['0', 'false', 'no', 'n'].includes(String(process.env.EXECUTOR_PRIVATE_RELAY_REQUIRED ?? '1').toLowerCase()),
    privateRelayConfigured:
      options.privateRelayConfigured ??
      Boolean(process.env.EXECUTOR_PRIVATE_RELAY_URL || process.env.FLASHBOTS_RELAY_URL || process.env.MEV_BLOCKER_RPC_URL),
  };
  const verificationRows = verificationByCandidateId(verification);
  const opportunityDecisions = (Array.isArray(feed?.opportunities) ? feed.opportunities : [])
    .map((opp: AnyRecord) => buildOpportunityDecision(opp, verificationRows.get(String(opp.id)), policy))
    .sort((a: AnyRecord, b: AnyRecord) => {
      if (a.submitReady !== b.submitReady) return a.submitReady ? -1 : 1;
      if (a.preForkReady !== b.preForkReady) return a.preForkReady ? -1 : 1;
      return (b.estimatedNetProfitUsd ?? -1_000_000) - (a.estimatedNetProfitUsd ?? -1_000_000);
    });
  const actionableCount = opportunityDecisions.filter((item: AnyRecord) => item.executorAction === 'fork-verify-now').length;
  const preForkReadyCount = opportunityDecisions.filter((item: AnyRecord) => item.preForkReady).length;
  const submitReadyCount = opportunityDecisions.filter((item: AnyRecord) => item.submitReady).length;
  const liveReadyCount = verification?.summary?.liveReadyCount ?? 0;
  const status =
    submitReadyCount > 0
      ? 'ready-for-submit'
      : preForkReadyCount > 0
        ? 'ready-for-fork-verification'
        : actionableCount > 0
          ? 'blocked-execution-risk-gates'
          : 'idle-no-gate-pass-opportunities';
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    policy,
    summary: {
      opportunityCount: opportunityDecisions.length,
      actionableCount,
      preForkReadyCount,
      submitReadyCount,
      liveReadyCount,
      blockedCount: opportunityDecisions.filter((item: AnyRecord) => !item.submitReady).length,
    },
    opportunityDecisions,
  };
}

function buildOpportunityDecision(opp: AnyRecord, verificationRow: AnyRecord | undefined, policy: AnyRecord): AnyRecord {
  const gate = opp?.gate?.status ?? 'unknown';
  const capitalRequiredUsd = numberOrNull(opp?.economics?.capitalRequiredUsd);
  const capacityUsd = numberOrNull(opp?.economics?.capacityUsd);
  const netProfitUsd = numberOrNull(opp?.economics?.estimatedNetProfitUsd);
  const returnPct = numberOrNull(opp?.economics?.returnPct);
  const gasUsd = numberOrNull(opp?.economics?.gasUsd);
  const priceImpactBps = numberOrNull(opp?.market?.priceImpactBps);
  const poolLiquidityUsd = numberOrNull(opp?.market?.poolLiquidityUsd);
  const volume24hUsd = numberOrNull(opp?.market?.volume24hUsd);
  const uniTickState = uniswapV3TickStateCheck(opp);
  const maxSlippageBps = numberOrNull(opp?.economics?.slippageBudgetBps) ?? policy.maxSlippageBps;
  const ageMs = quoteAgeMs(opp);
  const maxQuoteAgeMs = numberOrNull(opp?.timing?.maxQuoteAgeMs) ?? policy.maxQuoteAgeMs;
  const minReturnPct = isDexLike(String(opp.familyKey)) ? policy.minAnnualizedReturnPct : policy.minExecutionReturnPct;
  const capitalMeetsRequired = capitalRequiredUsd == null || policy.capitalUsd >= capitalRequiredUsd;
  const recommendedCapitalUsd =
    capitalMeetsRequired && policy.capitalUsd > 0 && capacityUsd != null && capacityUsd > 0
      ? Math.min(policy.capitalUsd, capacityUsd)
      : 0;
  const depthCapitalUsd = recommendedCapitalUsd || capitalRequiredUsd || policy.capitalUsd;
  const uniDepthCapacity = uniswapV3DepthCapacityCheck(opp, depthCapitalUsd);
  const requiredPoolLiquidityUsd = Math.max(
    policy.minPoolLiquidityUsd,
    depthCapitalUsd * policy.minLiquidityToCapitalRatio,
  );
  const checks = [
    check('gate-pass', gate === 'pass' ? 'pass' : 'block', gate === 'pass' ? 'candidate gate passed' : `candidate gate is ${gate}`, opp?.gate ?? null),
    check(
      'executor-action',
      opp.executorAction === 'fork-verify-now' ? 'pass' : 'block',
      opp.executorAction === 'fork-verify-now' ? 'scanner marked opportunity for fork verification' : `scanner action is ${opp.executorAction}`,
      { executorAction: opp.executorAction },
    ),
    check(
      'capital-configured',
      policy.capitalUsd > 0 ? 'pass' : 'block',
      policy.capitalUsd > 0 ? 'executor capital is configured' : 'capital input is missing',
      { capitalUsd: policy.capitalUsd },
    ),
    check(
      'capital-required',
      capitalMeetsRequired ? 'pass' : 'block',
      capitalMeetsRequired ? 'capital covers tested notional' : 'capital is below tested notional',
      { capitalUsd: policy.capitalUsd, capitalRequiredUsd },
    ),
    check(
      'capacity',
      capacityUsd != null && capacityUsd > 0 && recommendedCapitalUsd > 0 ? 'pass' : 'block',
      capacityUsd != null && capacityUsd > 0 && recommendedCapitalUsd > 0 ? 'positive executable capacity is available' : 'no positive capacity from current estimate',
      { capacityUsd, recommendedCapitalUsd, capacitySource: opp?.market?.capacitySource ?? null },
    ),
    check(
      'net-profit',
      netProfitUsd != null && netProfitUsd >= policy.minNetProfitUsd ? 'pass' : 'block',
      netProfitUsd != null && netProfitUsd >= policy.minNetProfitUsd ? 'net profit clears minimum' : 'net profit is missing or too low',
      { netProfitUsd, minNetProfitUsd: policy.minNetProfitUsd },
    ),
    check(
      'return',
      returnPct != null && returnPct >= minReturnPct ? 'pass' : 'block',
      returnPct != null && returnPct >= minReturnPct ? 'return clears minimum' : 'return is missing or too low',
      { returnPct, minReturnPct },
    ),
    check(
      'pool-liquidity',
      poolLiquidityUsd != null && poolLiquidityUsd >= requiredPoolLiquidityUsd ? 'pass' : 'block',
      poolLiquidityUsd != null && poolLiquidityUsd >= requiredPoolLiquidityUsd
        ? 'route pool liquidity clears required depth'
        : 'route pool liquidity is missing or below required depth',
      {
        poolLiquidityUsd,
        requiredPoolLiquidityUsd,
        poolLiquiditySource: opp?.market?.poolLiquiditySource ?? null,
      },
    ),
    check(
      'volume-24h',
      !policy.requireVolume24h || (volume24hUsd != null && volume24hUsd >= policy.minVolume24hUsd)
        ? 'pass'
        : 'block',
      !policy.requireVolume24h || (volume24hUsd != null && volume24hUsd >= policy.minVolume24hUsd)
        ? '24h volume requirement is satisfied or disabled'
        : '24h volume is missing or below required threshold',
      {
        volume24hUsd,
        minVolume24hUsd: policy.minVolume24hUsd,
        requireVolume24h: policy.requireVolume24h,
        volume24hSource: opp?.market?.volume24hSource ?? null,
      },
    ),
    check(
      'uniswap-v3-tick-state',
      uniTickState.ready ? 'pass' : 'block',
      uniTickState.ready
        ? 'Uniswap V3 tick state is loaded or not required for this route'
        : 'Uniswap V3 route is missing slot0/liquidity/tick state',
      uniTickState,
    ),
    check(
      'uniswap-v3-depth-capacity',
      uniDepthCapacity.ready ? 'pass' : 'block',
      uniDepthCapacity.ready
        ? 'Uniswap V3 loaded tick range covers recommended capital or is not required'
        : 'Uniswap V3 loaded tick-range capacity is missing or below recommended capital',
      uniDepthCapacity,
    ),
    check(
      'gas',
      gasUsd != null && gasUsd <= policy.maxGasUsd ? 'pass' : 'block',
      gasUsd != null && gasUsd <= policy.maxGasUsd ? 'gas is within budget' : 'gas is missing or too high',
      { gasUsd, maxGasUsd: policy.maxGasUsd },
    ),
    check(
      'slippage-price-impact',
      priceImpactBps != null && priceImpactBps <= maxSlippageBps ? 'pass' : 'block',
      priceImpactBps != null && priceImpactBps <= maxSlippageBps ? 'price-impact proxy is inside budget' : 'price-impact proxy is missing or too high',
      { priceImpactBps, maxSlippageBps, priceImpactBpsSource: opp?.market?.priceImpactBpsSource ?? null },
    ),
    check(
      'quote-freshness',
      ageMs != null && ageMs <= maxQuoteAgeMs ? 'pass' : 'block',
      ageMs != null && ageMs <= maxQuoteAgeMs ? 'quote is fresh enough' : 'quote is stale or missing timestamp',
      { quoteAgeMs: ageMs, maxQuoteAgeMs },
    ),
  ];
  const preForkReady = checks.every((item) => item.status === 'pass');
  const forkReady = verificationRow?.liveReady === true;
  checks.push(
    check(
      'fork-verification',
      forkReady ? 'pass' : preForkReady ? 'wait' : 'block',
      forkReady ? 'same-block fork verification passed' : preForkReady ? 'fork verification must run next' : 'preconditions must pass first',
      verificationRow ?? null,
    ),
  );
  checks.push(
    check(
      'production-enabled',
      policy.liveExecutionEnabled ? 'pass' : 'block',
      policy.liveExecutionEnabled ? 'production execution is enabled' : 'production execution is disabled',
      { liveExecutionEnabled: policy.liveExecutionEnabled },
    ),
  );
  checks.push(
    check('signer', policy.signerConfigured ? 'pass' : 'block', policy.signerConfigured ? 'signer is configured' : 'signer is missing', {
      signerConfigured: policy.signerConfigured,
    }),
  );
  checks.push(
    check(
      'private-relay',
      policy.privateRelayConfigured || !policy.privateRelayRequired ? 'pass' : 'block',
      policy.privateRelayConfigured || !policy.privateRelayRequired ? 'private relay requirement is satisfied or disabled' : 'private relay is required but missing',
      { privateRelayConfigured: policy.privateRelayConfigured, privateRelayRequired: policy.privateRelayRequired },
    ),
  );
  const submitReady = checks.every((item) => item.status === 'pass');
  return {
    id: opp.id,
    familyKey: opp.familyKey,
    chain: opp.chain,
    rank: opp.rank,
    executorAction: opp.executorAction,
    status: submitReady ? 'ready-for-submit' : preForkReady && !forkReady ? 'ready-for-fork-verification' : 'blocked-preconditions',
    submitReady,
    preForkReady,
    forkReady,
    recommendedCapitalUsd,
    capitalRequiredUsd,
    capacityUsd,
    estimatedNetProfitUsd: netProfitUsd,
    returnPct,
    gasUsd,
    priceImpactBps,
    poolLiquidityUsd,
    volume24hUsd,
    uniswapV3TickState: uniTickState,
    uniswapV3DepthCapacity: uniDepthCapacity,
    quoteAgeMs: ageMs,
    maxQuoteAgeMs,
    route: opp?.market?.route ?? null,
    blockingChecks: checks.filter((item) => item.status === 'block').map((item) => item.key),
    waitingChecks: checks.filter((item) => item.status === 'wait').map((item) => item.key),
    checks,
  };
}
