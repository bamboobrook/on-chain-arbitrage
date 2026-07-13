#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');
const outPath = resolve(dataDir, 'live-opportunity-feed.json');

function loadDotenv() {
  try {
    const text = readFileSync(resolve(root, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed
        .slice(idx + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Optional.
  }
}

async function readJson(fileName) {
  const path = resolve(dataDir, fileName);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function envNumber(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function finiteNumbers(values) {
  return values.map(numberOrNull).filter((value) => value != null);
}

function mean(values) {
  const nums = finiteNumbers(values);
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function median(values) {
  const nums = finiteNumbers(values).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

function percentile(values, pct) {
  const nums = finiteNumbers(values).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const index = Math.min(nums.length - 1, Math.max(0, Math.ceil((pct / 100) * nums.length) - 1));
  return nums[index];
}

function max(values) {
  const nums = finiteNumbers(values);
  return nums.length === 0 ? null : Math.max(...nums);
}

function gateStatus(candidate) {
  return candidate?.gate?.status ?? 'unknown';
}

function executionAction(candidate, familyKey) {
  if (gateStatus(candidate) === 'pass') return 'fork-verify-now';
  if (familyKey.includes('liquidation')) {
    const reason = String(candidate?.gate?.reason ?? '').toLowerCase();
    if (reason.includes('health factor') || reason.includes('ltv') || reason.includes('liquidatable')) {
      return 'watch-current-state';
    }
  }
  return 'skip-until-gate-pass';
}

function ttlSeconds(candidate, familyKey) {
  if (gateStatus(candidate) === 'pass') return familyKey.includes('liquidation') ? 15 : 8;
  if (familyKey.includes('liquidation')) return 60;
  return 20;
}

function riskNotes(candidate, familyKey) {
  const notes = [];
  if (familyKey.includes('liquidation')) {
    notes.push('Opportunity can disappear before transaction inclusion');
    notes.push('Current protocol liquidation gate must be recomputed at execution block');
    notes.push('Collateral unwind quote must be same-block and loss-reverting');
  } else {
    notes.push('Quote edge must be refreshed immediately before signing');
    notes.push('Capacity is limited by pool depth and price impact');
    notes.push('Public mempool execution can be copied or sandwiched');
  }
  if (gateStatus(candidate) !== 'pass') notes.push(`Blocked: ${candidate?.gate?.reason ?? 'gate not passed'}`);
  return notes;
}

function baseOpportunity({ familyKey, artifactFile, artifact, candidate, rank }) {
  const generatedAt = artifact?.generatedAt ?? null;
  const chain = candidate.chain ?? artifact?.source?.chain?.name ?? null;
  return {
    id: candidate.id,
    familyKey,
    artifactFile,
    artifactGeneratedAt: generatedAt,
    rank,
    chain,
    strategyType: candidate.strategyType ?? familyKey,
    gate: candidate.gate ?? { status: 'unknown', reason: 'gate missing' },
    liveInterfaceStatus: candidate.liveInterface?.status ?? null,
    executorAction: executionAction(candidate, familyKey),
    ttlSeconds: ttlSeconds(candidate, familyKey),
    staleAfter: generatedAt ? new Date(Date.parse(generatedAt) + ttlSeconds(candidate, familyKey) * 1000).toISOString() : null,
    economics: {
      estimatedGrossProfitUsd: null,
      estimatedNetProfitUsd: null,
      returnPct: null,
      capitalRequiredUsd: null,
      capacityUsd: null,
      gasUsd: null,
      protocolFeeUsd: null,
      slippageBudgetBps: envNumber('LIVE_FEED_MAX_SLIPPAGE_BPS', 30),
      privateRelayTipUsd: null,
    },
    market: {
      volume24hUsd: null,
      poolLiquidityUsd: null,
      poolLiquiditySource: null,
      volume24hSource: null,
      depthSnapshotStatus: null,
      depthSnapshotGeneratedAt: null,
      priceImpactBps: null,
      priceImpactBpsSource: null,
      route: null,
      quoteSampleCount: null,
      capacitySource: null,
      capacityCurve: [],
      uniswapV3DepthCapacityUsd: null,
      uniswapV3DepthStatus: 'not-required',
      uniswapV3DepthSource: null,
      routePools: [],
    },
    timing: {
      sameBlockRequired: true,
      maxQuoteAgeMs: envNumber('LIVE_FEED_MAX_QUOTE_AGE_MS', 2500),
      maxInclusionDelayMs: familyKey.includes('liquidation')
        ? envNumber('LIVE_FEED_LIQUIDATION_MAX_INCLUSION_DELAY_MS', 12000)
        : envNumber('LIVE_FEED_DEX_MAX_INCLUSION_DELAY_MS', 6000),
      observedLatencyMs: null,
    },
    riskNotes: riskNotes(candidate, familyKey),
  };
}

function aaveOpportunity(args) {
  const candidate = args.candidate;
  const best = candidate.bestEstimate ?? {};
  const out = baseOpportunity(args);
  out.borrower = candidate.user ?? null;
  out.economics = {
    ...out.economics,
    estimatedGrossProfitUsd: numberOrNull(best.grossProfitUsd),
    estimatedNetProfitUsd: numberOrNull(best.netProfitUsd),
    returnPct: numberOrNull(best.returnOnDebtPct),
    capitalRequiredUsd: numberOrNull(best.debtToCoverUsd),
    capacityUsd: numberOrNull(best.debtToCoverUsd),
    gasUsd: numberOrNull(best.gasUsd),
    protocolFeeUsd: numberOrNull(best.protocolFeeUsd),
  };
  out.market.route = best.debtSymbol && best.collateralSymbol ? `${best.debtSymbol}->${best.collateralSymbol}` : null;
  out.protocolState = {
    healthFactor: numberOrNull(candidate.account?.healthFactor),
    debtAsset: best.debtAsset ?? null,
    collateralAsset: best.collateralAsset ?? null,
  };
  return out;
}

function compoundOpportunity(args) {
  const candidate = args.candidate;
  const best = candidate.bestEstimate ?? {};
  const out = baseOpportunity(args);
  out.borrower = candidate.user ?? null;
  out.economics = {
    ...out.economics,
    estimatedGrossProfitUsd: numberOrNull(best.grossProfitUsd),
    estimatedNetProfitUsd: numberOrNull(best.netProfitUsd),
    returnPct: numberOrNull(best.returnOnBasePct),
    capitalRequiredUsd: numberOrNull(best.baseCostUsd),
    capacityUsd: numberOrNull(best.baseCostUsd),
    gasUsd: numberOrNull(best.gasUsd),
  };
  out.market.route = best.baseSymbol && best.collateralSymbol ? `${best.baseSymbol}->${best.collateralSymbol}` : null;
  out.protocolState = {
    isLiquidatable: candidate.account?.isLiquidatable ?? null,
    borrowBalanceHuman: candidate.account?.borrowBalanceHuman ?? null,
  };
  return out;
}

function morphoOpportunity(args) {
  const candidate = args.candidate;
  const best = candidate.bestEstimate ?? {};
  const out = baseOpportunity(args);
  out.borrower = candidate.user ?? null;
  out.marketId = candidate.marketId ?? null;
  out.economics = {
    ...out.economics,
    estimatedGrossProfitUsd: numberOrNull(best.grossProfitUsd),
    estimatedNetProfitUsd: numberOrNull(best.netProfitUsd),
    returnPct: numberOrNull(best.returnOnRepayPct),
    capitalRequiredUsd: numberOrNull(best.repayUsd),
    capacityUsd: numberOrNull(best.repayUsd),
    gasUsd: numberOrNull(best.gasUsd),
  };
  out.market.route = best.loanSymbol && best.collateralSymbol ? `${best.loanSymbol}->${best.collateralSymbol}` : null;
  out.protocolState = {
    ltv: numberOrNull(candidate.account?.ltv ?? best.ltv),
    lltv: numberOrNull(candidate.account?.lltv ?? best.lltv),
    liquidatable: candidate.account?.liquidatable ?? best.liquidatable ?? null,
    oracleCheck: candidate.oracleCheck ?? null,
  };
  return out;
}

function dexSampleStats(candidate) {
  const samples = Array.isArray(candidate.samples) ? candidate.samples : [];
  return {
    gasUsd: {
      mean: mean(samples.map((sample) => sample.gasUsd)),
      median: median(samples.map((sample) => sample.gasUsd)),
      max: max(samples.map((sample) => sample.gasUsd)),
    },
    latencyMs: {
      mean: mean(samples.map((sample) => sample.latencyMs)),
      p95: percentile(samples.map((sample) => sample.latencyMs), 95),
      max: max(samples.map((sample) => sample.latencyMs)),
    },
    grossReturnPct: {
      median: median(samples.map((sample) => sample.grossReturnPct)),
    },
    netReturnPct: {
      median: median(samples.map((sample) => sample.netReturnPct)),
    },
  };
}

function dexCapacityCurve(metrics) {
  const amountInUsd = numberOrNull(metrics.amountInUsd);
  const selectedMultiplier = numberOrNull(metrics.selectedAmountMultiplier);
  const rows = Array.isArray(metrics.testedAmountMultipliers) ? metrics.testedAmountMultipliers : [];
  if (!amountInUsd || rows.length === 0) {
    return {
      capacityUsd: gateFromMetrics(metrics) === 'pass' ? amountInUsd : 0,
      capacitySource: rows.length === 0 ? 'selected_quote_amount_only' : 'missing_selected_amount_usd',
      curve: [],
    };
  }

  const usdPerMultiplier = selectedMultiplier && selectedMultiplier > 0 ? amountInUsd / selectedMultiplier : amountInUsd;
  const curve = rows.map((row) => {
    const multiplier = numberOrNull(row.multiplier);
    return {
      multiplier,
      amountUsd: multiplier == null ? null : usdPerMultiplier * multiplier,
      gate: row.gate ?? 'unknown',
      medianNetProfitUsd: numberOrNull(row.medianNetProfitUsd),
      netWinRatePct: numberOrNull(row.netWinRatePct),
      annualizedNetReturnPct: numberOrNull(row.meanAnnualizedNetReturnPct),
    };
  });
  const passingAmounts = curve
    .filter((row) => row.gate === 'pass' && Number(row.medianNetProfitUsd) > 0)
    .map((row) => row.amountUsd);
  return {
    capacityUsd: max(passingAmounts) ?? 0,
    capacitySource: 'tested_amount_multiplier_quote_replay',
    curve,
  };
}

function gateFromMetrics(metrics) {
  const rows = Array.isArray(metrics.testedAmountMultipliers) ? metrics.testedAmountMultipliers : [];
  return rows.some((row) => row.gate === 'pass') ? 'pass' : 'block';
}

function dexPriceImpact(metrics, sampleStats) {
  const explicit = numberOrNull(metrics.priceImpactBps?.mean ?? metrics.priceImpactBps);
  if (explicit != null) return { value: explicit, source: 'artifact_price_impact_bps' };

  const grossReturnPct = numberOrNull(metrics.grossReturnPct?.median ?? sampleStats.grossReturnPct.median);
  if (grossReturnPct != null) {
    return { value: Math.abs(grossReturnPct) * 100, source: 'abs_median_gross_return_pct_proxy' };
  }

  const netReturnPct = numberOrNull(metrics.netReturnPct?.median ?? sampleStats.netReturnPct.median);
  if (netReturnPct != null) {
    return { value: Math.abs(netReturnPct) * 100, source: 'abs_median_net_return_pct_proxy_includes_gas' };
  }

  return { value: null, source: null };
}

function applyMarketDepth(opportunities, depthReport) {
  const snapshots = Array.isArray(depthReport?.snapshots) ? depthReport.snapshots : [];
  const byId = new Map(snapshots.map((snapshot) => [snapshot.opportunityId, snapshot]));
  for (const opp of opportunities) {
    const snapshot = byId.get(opp.id);
    if (!snapshot) {
      opp.market.depthSnapshotStatus = 'missing';
      opp.market.depthSnapshotGeneratedAt = null;
      opp.market.poolLiquiditySource = null;
      opp.market.volume24hSource = null;
      opp.market.routePools = [];
      continue;
    }
    opp.market.volume24hUsd = numberOrNull(snapshot.volume24hUsd);
    opp.market.poolLiquidityUsd = numberOrNull(snapshot.poolLiquidityUsd);
    opp.market.poolLiquiditySource = snapshot.poolLiquiditySource ?? null;
    opp.market.volume24hSource = snapshot.volume24hSource ?? null;
    opp.market.depthSnapshotStatus = 'loaded';
    opp.market.depthSnapshotGeneratedAt = snapshot.generatedAt ?? depthReport.generatedAt ?? null;
    opp.market.routePools = Array.isArray(snapshot.routePools) ? snapshot.routePools : [];
    const uniDepth = uniswapV3DepthSummary(opp.market.routePools);
    opp.market.uniswapV3DepthCapacityUsd = uniDepth.capacityUsd;
    opp.market.uniswapV3DepthStatus = uniDepth.status;
    opp.market.uniswapV3DepthSource = uniDepth.source;
  }
}

function uniswapV3DepthSummary(routePools) {
  const uniswapPools = routePools.filter((pool) => pool.dex === 'uniswap-v3');
  if (!uniswapPools.length) {
    return { status: 'not-required', capacityUsd: null, source: null };
  }
  const readyDepths = uniswapPools
    .map((pool) => pool.uniswapV3Depth)
    .filter((depth) => depth?.ready === true && numberOrNull(depth.capacityUsd) != null);
  if (readyDepths.length !== uniswapPools.length) {
    return {
      status: 'missing-or-not-ready',
      capacityUsd: null,
      source: 'uniswap-v3-exact-input-to-loaded-initialized-ticks',
    };
  }
  const capacities = readyDepths.map((depth) => numberOrNull(depth.capacityUsd)).filter((value) => value != null);
  return {
    status: capacities.some((value) => value <= 0) ? 'zero-capacity' : 'loaded',
    capacityUsd: capacities.length ? Math.min(...capacities) : null,
    source: 'uniswap-v3-exact-input-to-loaded-initialized-ticks',
  };
}

function dexOpportunity(args) {
  const candidate = args.candidate;
  const metrics = candidate.metrics ?? {};
  const out = baseOpportunity(args);
  const sampleStats = dexSampleStats(candidate);
  const capacity = dexCapacityCurve(metrics);
  const priceImpact = dexPriceImpact(metrics, sampleStats);
  const netProfit =
    metrics.medianNetProfitUsd ??
    metrics.netProfitUsd?.median ??
    metrics.netProfitUsd?.mean ??
    metrics.meanNetProfitUsd ??
    null;
  const annualized =
    metrics.meanAnnualizedNetReturnPct ??
    metrics.annualizedNetReturnPct?.mean ??
    metrics.annualizedNetReturnPct?.median ??
    null;
  out.economics = {
    ...out.economics,
    estimatedNetProfitUsd: numberOrNull(netProfit),
    returnPct: numberOrNull(annualized),
    capitalRequiredUsd: numberOrNull(metrics.amountInUsd),
    capacityUsd: capacity.capacityUsd,
    gasUsd: numberOrNull(metrics.gasUsd?.mean ?? metrics.gasUsd ?? sampleStats.gasUsd.median ?? sampleStats.gasUsd.mean),
  };
  out.market = {
    ...out.market,
    route: candidate.dexPath?.join('->') ?? `${candidate.buyDex ?? 'buy'}->${candidate.sellDex ?? 'sell'}`,
    quoteSampleCount: metrics.sampleCount ?? metrics.attemptedSamples ?? null,
    priceImpactBps: priceImpact.value,
    priceImpactBpsSource: priceImpact.source,
    capacitySource: capacity.capacitySource,
    capacityCurve: capacity.curve,
  };
  out.timing.sameBlockRequired = true;
  out.timing.observedLatencyMs = sampleStats.latencyMs;
  if (sampleStats.latencyMs.p95 != null) {
    out.timing.maxQuoteAgeMs = Math.max(out.timing.maxQuoteAgeMs, Math.ceil(sampleStats.latencyMs.p95 * 2));
  }
  return out;
}

function scoreOpportunity(opp) {
  const net = Number(opp.economics.estimatedNetProfitUsd ?? -1_000_000);
  const gateBonus = opp.gate.status === 'pass' ? 1_000_000 : 0;
  const freshnessPenalty = opp.artifactGeneratedAt
    ? Math.max(0, (Date.now() - Date.parse(opp.artifactGeneratedAt)) / 1000)
    : 1_000_000;
  return gateBonus + net - freshnessPenalty / 10_000;
}

function scoreScannerTarget(target) {
  const economicsScore = Number(target.economics?.estimatedNetProfitUsd ?? 0) / 1000;
  const capacityScore = Number(target.economics?.capacityUsd ?? 0) / 100000;
  const risk = String(target.protocolState?.riskCategory ?? '');
  const riskScore = risk === 'liquidatable' ? 10_000 : risk === 'near-liquidation' ? 1_000 : 100;
  const distance = Number(target.trigger?.distanceToTriggerPct ?? 100);
  return riskScore + economicsScore + capacityScore - distance;
}

function aaveScannerTarget(row, artifact, rank) {
  return {
    id: `scanner-target-${row.id}`,
    source: 'aave-liquidation-watchlist-analysis',
    sourceArtifact: 'aave-liquidation-watchlist-analysis-ethereum.json',
    artifactGeneratedAt: artifact.generatedAt ?? null,
    rank,
    familyKey: 'aave-liquidation-watchlist',
    chain: row.chain ?? 'Ethereum',
    strategyType: 'aave-v3-liquidation-watch-target',
    executorEligible: false,
    monitorAction: 'watch-health-factor',
    nextRequiredGate: 'health factor below 1, then fork simulation and collateral unwind quote',
    trigger: {
      type: 'health-factor-below-1',
      currentHealthFactor: numberOrNull(row.healthFactor),
      thresholdHealthFactor: 1,
      distanceToTriggerPct: numberOrNull(row.distanceToLiquidationPct),
    },
    economics: {
      estimatedNetProfitUsd: numberOrNull(row.netProfitUsd),
      returnPct: numberOrNull(row.returnOnDebtPct),
      capitalRequiredUsd: numberOrNull(row.debtToCoverUsd),
      capacityUsd: numberOrNull(row.debtToCoverUsd),
      gasUsd: numberOrNull(row.gasUsd),
    },
    market: {
      route: row.pairKey ?? null,
      debtSymbol: row.debtSymbol ?? null,
      collateralSymbol: row.collateralSymbol ?? null,
      capacityBucket: row.capacityBucket ?? null,
    },
    protocolState: {
      riskCategory: row.riskCategory ?? null,
      healthFactor: numberOrNull(row.healthFactor),
      gate: row.gate ?? null,
    },
    riskNotes: [
      'Scanner target only; do not submit until HF is below 1 at execution block',
      'Debt funding and collateral unwind quote must be refreshed same block',
      row.gate?.reason ? `Blocked: ${row.gate.reason}` : 'Blocked: current liquidation gate not passed',
    ],
  };
}

function morphoOracleByMarket(diagnosticsArtifact) {
  const rows = Array.isArray(diagnosticsArtifact?.diagnostics) ? diagnosticsArtifact.diagnostics : [];
  return new Map(rows.map((row) => [String(row.marketId ?? '').toLowerCase(), row.oracleDiagnostic ?? null]));
}

function morphoScannerTarget(item, artifact, oracleByMarket, rank) {
  const best = item.profitability?.bestEstimate ?? {};
  const gate = item.profitability?.gate ?? null;
  const oracleDiagnostic = oracleByMarket.get(String(item.marketId ?? '').toLowerCase()) ?? null;
  const riskCategory = item.currentState?.riskCategory ?? null;
  const monitorAction =
    oracleDiagnostic?.status && oracleDiagnostic.status !== 'passed'
      ? 'block-until-oracle-price-passes'
      : riskCategory === 'liquidatable'
        ? 'watch-current-liquidatable-and-fork-simulate'
        : 'watch-ltv';
  return {
    id: `scanner-target-${item.id}`,
    source: 'morpho-blue-liquidation-watchlist',
    sourceArtifact: 'morpho-blue-liquidation-watchlist-ethereum.json',
    artifactGeneratedAt: artifact.generatedAt ?? null,
    rank,
    familyKey: 'morpho-blue-liquidation-watchlist',
    chain: item.chain ?? 'Ethereum',
    strategyType: 'morpho-blue-liquidation-watch-target',
    executorEligible: false,
    monitorAction,
    nextRequiredGate:
      oracleDiagnostic?.status && oracleDiagnostic.status !== 'passed'
        ? 'oracle price() must pass on-chain before fork simulation'
        : 'current liquidatable borrower, same-block fork simulation, and collateral unwind quote',
    trigger: {
      type: 'ltv-at-or-above-lltv',
      currentLtv: numberOrNull(item.currentState?.ltv),
      thresholdLltv: numberOrNull(item.currentState?.lltv),
      distanceToTriggerPct: numberOrNull(item.currentState?.distanceToLiquidationPct),
      liquidatable: item.currentState?.liquidatable === true,
    },
    economics: {
      estimatedNetProfitUsd: numberOrNull(best.netProfitUsd),
      returnPct: numberOrNull(best.returnOnRepayPct),
      capitalRequiredUsd: numberOrNull(best.repayUsd),
      capacityUsd: numberOrNull(best.repayUsd),
      gasUsd: numberOrNull(best.gasUsd),
    },
    market: {
      marketId: item.marketId ?? null,
      route: item.symbols?.loan && item.symbols?.collateral ? `${item.symbols.loan}->${item.symbols.collateral}` : null,
      loanSymbol: item.symbols?.loan ?? null,
      collateralSymbol: item.symbols?.collateral ?? null,
    },
    protocolState: {
      riskCategory,
      ltv: numberOrNull(item.currentState?.ltv),
      lltv: numberOrNull(item.currentState?.lltv),
      liquidatable: item.currentState?.liquidatable === true,
      gate,
      oracleDiagnostic,
    },
    riskNotes: [
      'Scanner target only; Morpho GraphQL state must be re-read on-chain before execution',
      oracleDiagnostic?.status && oracleDiagnostic.status !== 'passed'
        ? `Blocked: oracle ${oracleDiagnostic.status}: ${oracleDiagnostic.priceCall?.reason ?? 'price unavailable'}`
        : 'Oracle diagnostic did not block this target',
      gate?.reason ? `Blocked: ${gate.reason}` : 'Blocked: current profitability gate not passed',
    ],
  };
}

async function collectScannerTargets() {
  const targets = [];
  const sources = [];
  const aaveAnalysis = await readJson('aave-liquidation-watchlist-analysis-ethereum.json');
  if (aaveAnalysis) {
    sources.push({
      artifactFile: 'aave-liquidation-watchlist-analysis-ethereum.json',
      familyKey: 'aave-liquidation-watchlist',
      status: 'loaded',
      generatedAt: aaveAnalysis.generatedAt ?? null,
      summary: aaveAnalysis.summary ?? null,
    });
    const rows = Array.isArray(aaveAnalysis.rows) ? aaveAnalysis.rows : [];
    rows.forEach((row, index) => targets.push(aaveScannerTarget(row, aaveAnalysis, index + 1)));
  } else {
    sources.push({
      artifactFile: 'aave-liquidation-watchlist-analysis-ethereum.json',
      familyKey: 'aave-liquidation-watchlist',
      status: 'missing',
    });
  }

  const morphoWatchlist = await readJson('morpho-blue-liquidation-watchlist-ethereum.json');
  const morphoOracleDiagnostics = await readJson('morpho-blue-oracle-diagnostics-ethereum.json');
  if (morphoWatchlist) {
    sources.push({
      artifactFile: 'morpho-blue-liquidation-watchlist-ethereum.json',
      familyKey: 'morpho-blue-liquidation-watchlist',
      status: 'loaded',
      generatedAt: morphoWatchlist.generatedAt ?? null,
      summary: morphoWatchlist.summary ?? null,
    });
    const oracleByMarket = morphoOracleByMarket(morphoOracleDiagnostics);
    const rows = Array.isArray(morphoWatchlist.watchlist) ? morphoWatchlist.watchlist : [];
    rows.forEach((item, index) => targets.push(morphoScannerTarget(item, morphoWatchlist, oracleByMarket, index + 1)));
  } else {
    sources.push({
      artifactFile: 'morpho-blue-liquidation-watchlist-ethereum.json',
      familyKey: 'morpho-blue-liquidation-watchlist',
      status: 'missing',
    });
  }

  targets.sort((a, b) => scoreScannerTarget(b) - scoreScannerTarget(a));
  return { scannerTargets: targets, scannerTargetSources: sources };
}

async function collect() {
  const specs = [
    ['aave-liquidations', 'aave-liquidation-candidates-ethereum.json', aaveOpportunity],
    ['aave-liquidations', 'aave-liquidation-candidates-base.json', aaveOpportunity],
    ['aave-liquidations', 'aave-liquidation-candidates-arbitrum.json', aaveOpportunity],
    ['aave-liquidations', 'aave-liquidation-candidates-polygon.json', aaveOpportunity],
    ['compound-v3-liquidations', 'compound-v3-liquidation-candidates-ethereum.json', compoundOpportunity],
    ['morpho-blue-liquidations', 'morpho-blue-liquidation-candidates-ethereum.json', morphoOpportunity],
    ['dex-quote-replay', 'dex-arbitrage-candidates.json', dexOpportunity],
    ['uniswap-v3-fee-arb', 'uniswap-v3-fee-arbitrage-candidates-base.json', dexOpportunity],
    ['uniswap-v3-fee-arb', 'uniswap-v3-fee-arbitrage-candidates-ethereum.json', dexOpportunity],
    ['curve-stable-arb', 'curve-stable-arbitrage-candidates-ethereum.json', dexOpportunity],
    ['balancer-v2-arb', 'balancer-arbitrage-candidates-ethereum.json', dexOpportunity],
  ];
  const opportunities = [];
  const sources = [];
  for (const [familyKey, artifactFile, mapper] of specs) {
    const artifact = await readJson(artifactFile);
    if (!artifact) {
      sources.push({ artifactFile, familyKey, status: 'missing' });
      continue;
    }
    sources.push({
      artifactFile,
      familyKey,
      status: 'loaded',
      generatedAt: artifact.generatedAt ?? null,
      summary: artifact.summary ?? null,
    });
    const candidates = Array.isArray(artifact.candidates) ? artifact.candidates : [];
    for (const [index, candidate] of candidates.slice(0, envNumber('LIVE_FEED_MAX_PER_ARTIFACT', 25)).entries()) {
      opportunities.push(mapper({ familyKey, artifactFile, artifact, candidate, rank: index + 1 }));
    }
  }
  return { opportunities, sources };
}

async function main() {
  loadDotenv();
  const { opportunities, sources } = await collect();
  const { scannerTargets, scannerTargetSources } = await collectScannerTargets();
  const marketDepth = await readJson('market-depth-snapshots.json');
  applyMarketDepth(opportunities, marketDepth);
  opportunities.sort((a, b) => scoreOpportunity(b) - scoreOpportunity(a));
  const actionable = opportunities.filter((opp) => opp.executorAction === 'fork-verify-now');
  const watch = opportunities.filter((opp) => opp.executorAction === 'watch-current-state');
  const scannerLiquidatable = scannerTargets.filter(
    (target) => target.protocolState?.riskCategory === 'liquidatable' || target.trigger?.liquidatable === true,
  );
  const scannerOracleBlocked = scannerTargets.filter(
    (target) => target.protocolState?.oracleDiagnostic?.status && target.protocolState.oracleDiagnostic.status !== 'passed',
  );
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    architecture: {
      scannerRole: 'continuous opportunity discovery and normalized feed publishing',
      executorRole: 'consume only gate-pass opportunities, rerun fork verification, then submit only when enabled',
      sharedArtifacts: ['data/live-opportunity-feed.json', 'data/live-fork-verification.json'],
    },
    policy: {
      minAnnualizedReturnPct: 20,
      requireNoCex: true,
      requireSameBlockForkSimulation: true,
      requireLossRevert: true,
      liveExecutionEnabled: ['1', 'true', 'yes', 'y'].includes(
        String(process.env.LIVE_EXECUTION_ENABLED ?? '').toLowerCase(),
      ),
      maxQuoteAgeMs: envNumber('LIVE_FEED_MAX_QUOTE_AGE_MS', 2500),
      maxSlippageBps: envNumber('LIVE_FEED_MAX_SLIPPAGE_BPS', 30),
    },
    summary: {
      sourceCount: sources.length,
      loadedSourceCount: sources.filter((source) => source.status === 'loaded').length,
      opportunityCount: opportunities.length,
      actionableCount: actionable.length,
      watchCount: watch.length,
      scannerTargetCount: scannerTargets.length,
      scannerLiquidatableTargetCount: scannerLiquidatable.length,
      scannerOracleBlockedTargetCount: scannerOracleBlocked.length,
      blockedCount: opportunities.length - actionable.length,
      status: actionable.length > 0 ? 'has-gate-pass-opportunities' : 'no-gate-pass-opportunities',
    },
    marketDepthSummary: marketDepth?.summary ?? {
      status: 'missing-market-depth-snapshots',
      hint: 'run npm run build:market-depth before build:live-opportunity-feed',
    },
    sources,
    scannerTargetSources,
    scannerTargets: scannerTargets.slice(0, envNumber('LIVE_FEED_MAX_SCANNER_TARGETS', 100)),
    opportunities: opportunities.slice(0, envNumber('LIVE_FEED_MAX_OUTPUT', 200)),
  };
  await mkdir(dataDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `liveOpportunityFeed=${report.summary.status} opportunities=${report.summary.opportunityCount} actionable=${report.summary.actionableCount} watch=${report.summary.watchCount} scannerTargets=${report.summary.scannerTargetCount} artifact=${outPath}`,
  );
  if (report.summary.actionableCount === 0 && process.env.LIVE_FEED_REQUIRE_ACTIONABLE === '1') {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
