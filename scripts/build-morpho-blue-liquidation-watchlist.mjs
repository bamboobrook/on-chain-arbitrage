#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');

function num(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function stableHistoricalMarkets(replayArtifact) {
  const byMarket = new Map();
  for (const candidate of replayArtifact.candidates ?? []) {
    const metrics = candidate.replayMetrics ?? {};
    const annualized = num(metrics.annualizedNetReturnPct, -Infinity);
    const eventCount = num(metrics.marketEventCount, 0);
    const windowDays = num(metrics.replayWindowDays, 0);
    const minAnnualized = num(metrics.minAnnualizedNetReturnPct, 20);
    const minEvents = num(metrics.minMarketEventsForGate, 5);
    const minDays = num(metrics.minReplayDaysForGate, 30);
    const stable =
      annualized >= minAnnualized &&
      eventCount >= minEvents &&
      windowDays >= minDays &&
      candidate.bestEstimate?.netProfitUsd > 0;
    if (!stable) continue;

    const current = byMarket.get(candidate.marketId) ?? {
      marketId: candidate.marketId,
      chain: candidate.chain,
      loanSymbol: candidate.bestEstimate?.loanSymbol ?? null,
      collateralSymbol: candidate.bestEstimate?.collateralSymbol ?? null,
      eventCount: 0,
      maxAnnualizedNetReturnPct: -Infinity,
      totalHistoricalNetProfitUsd: 0,
      maxEventNetProfitUsd: -Infinity,
      replayWindowDays: windowDays,
      exampleCandidateId: candidate.id,
      exampleTransactionHash: candidate.event?.transactionHash ?? null,
    };
    current.eventCount += 1;
    current.maxAnnualizedNetReturnPct = Math.max(current.maxAnnualizedNetReturnPct, annualized);
    current.totalHistoricalNetProfitUsd += num(candidate.bestEstimate?.netProfitUsd, 0);
    current.maxEventNetProfitUsd = Math.max(
      current.maxEventNetProfitUsd,
      num(candidate.bestEstimate?.netProfitUsd, -Infinity),
    );
    current.replayWindowDays = Math.max(current.replayWindowDays, windowDays);
    byMarket.set(candidate.marketId, current);
  }
  return byMarket;
}

function watchPriority(item) {
  const category =
    item.currentState?.riskCategory ??
    item.bestEstimate?.riskCategory ??
    item.account?.riskCategory ??
    'healthy';
  if (category === 'liquidatable') return 0;
  if (category === 'near-liquidation') return 1;
  if (category === 'watch') return 2;
  return 3;
}

function watchReason(candidate) {
  const category = candidate.bestEstimate?.riskCategory ?? candidate.account?.riskCategory ?? 'healthy';
  if (category === 'liquidatable') {
    return candidate.gate?.status === 'pass'
      ? 'current borrower is liquidatable and candidate gates passed; fork execution and unwind quote still required'
      : `current borrower is liquidatable but blocked: ${candidate.gate?.reason ?? 'missing gate reason'}`;
  }
  if (category === 'near-liquidation') {
    return 'borrower is within 2% of LLTV; monitor every block and rerun fork gate when LTV crosses LLTV';
  }
  if (category === 'watch') {
    return 'borrower is within 5% of LLTV; keep in lower-priority watch queue';
  }
  return 'borrower is not close enough to liquidation threshold';
}

async function main() {
  const chain = String(process.env.MORPHO_WATCH_CHAIN ?? process.env.MORPHO_LIQ_CHAIN ?? 'ethereum').toLowerCase();
  const currentPath = resolve(dataDir, `morpho-blue-liquidation-candidates-${chain}.json`);
  const replayPath = resolve(dataDir, `morpho-blue-liquidation-event-replay-candidates-${chain}.json`);
  const outPath = resolve(dataDir, `morpho-blue-liquidation-watchlist-${chain}.json`);

  const currentArtifact = await readJson(currentPath);
  const replayArtifact = await readJson(replayPath);
  const stableMarkets = stableHistoricalMarkets(replayArtifact);
  const watched = [];

  for (const candidate of currentArtifact.candidates ?? []) {
    const historicalMarket = stableMarkets.get(candidate.marketId);
    if (!historicalMarket) continue;
    const category = candidate.bestEstimate?.riskCategory ?? candidate.account?.riskCategory ?? 'healthy';
    if (!['liquidatable', 'near-liquidation', 'watch'].includes(category)) continue;
    watched.push({
      id: candidate.id,
      chain: candidate.chain,
      strategyType: candidate.strategyType,
      isPureArbitrage: candidate.isPureArbitrage === true,
      noCexRequired: candidate.noCexRequired === true,
      user: candidate.user,
      marketId: candidate.marketId,
      marketParams: candidate.marketParams,
      symbols: {
        loan: candidate.bestEstimate?.loanSymbol ?? null,
        collateral: candidate.bestEstimate?.collateralSymbol ?? null,
      },
      currentState: {
        riskCategory: category,
        ltv: candidate.account?.ltv ?? null,
        lltv: candidate.account?.lltv ?? null,
        liquidatable: candidate.account?.liquidatable === true,
        liquidationGapUsd: candidate.account?.liquidationGapUsd ?? null,
        distanceToLiquidationPct: candidate.account?.distanceToLiquidationPct ?? null,
        borrowUsd: candidate.bestEstimate?.borrowUsd ?? candidate.account?.borrowAssetsUsd ?? null,
        collateralUsd: candidate.bestEstimate?.collateralUsd ?? candidate.account?.collateralUsd ?? null,
      },
      profitability: {
        gate: candidate.gate,
        bestEstimate: candidate.bestEstimate ?? null,
      },
      historicalMarket,
      liveInterface: {
        status:
          candidate.gate?.status === 'pass'
            ? 'watchlist-ready-for-fork-simulation'
            : 'watchlist-blocked-until-current-profitability-gate-passes',
        reason: watchReason(candidate),
        nextRequiredGate:
          candidate.gate?.status === 'pass'
            ? 'same-block fork simulation with liquidate calldata and collateral unwind quote'
            : 'current profitability gate',
      },
    });
  }

  watched.sort((a, b) => {
    const priority = watchPriority(a) - watchPriority(b);
    if (priority !== 0) return priority;
    const gapA = num(a.currentState.liquidationGapUsd, Number.POSITIVE_INFINITY);
    const gapB = num(b.currentState.liquidationGapUsd, Number.POSITIVE_INFINITY);
    if (gapA !== gapB) return gapA - gapB;
    return num(b.currentState.borrowUsd, 0) - num(a.currentState.borrowUsd, 0);
  });

  const liquidatable = watched.filter((item) => item.currentState.riskCategory === 'liquidatable');
  const near = watched.filter((item) => item.currentState.riskCategory === 'near-liquidation');
  const watch = watched.filter((item) => item.currentState.riskCategory === 'watch');
  const passing = watched.filter((item) => item.profitability.gate?.status === 'pass');
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      currentArtifact: currentPath,
      replayArtifact: replayPath,
      chain,
    },
    methodology: {
      classification: 'morpho-blue-current-opportunity-watchlist',
      isPureArbitrage: true,
      noCexRequired: true,
      selection:
        'current Morpho borrowers in historically stable replay markets with liquidatable, near-liquidation, or watch risk category',
      liveGate:
        'watchlist entries are not executable until current profitability, same-block fork simulation, and collateral unwind gates pass',
    },
    summary: {
      historicallyStableMarketCount: stableMarkets.size,
      watchCandidateCount: watched.length,
      liquidatableCount: liquidatable.length,
      nearLiquidationCount: near.length,
      watchCount: watch.length,
      passingCurrentProfitabilityCount: passing.length,
      requestedPassingCount: 5,
      liveExecutionStatus: passing.length >= 5 ? 'fork-simulation-required' : 'blocked',
      status:
        passing.length >= 5
          ? 'found-at-least-five-current-morpho-watchlist-profitability-candidates'
          : 'did-not-find-five-current-morpho-watchlist-profitability-candidates',
    },
    watchlist: watched,
  };

  await mkdir(dataDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    `morphoWatchlist=${artifact.summary.status} stableMarkets=${stableMarkets.size} watch=${watched.length} liquidatable=${liquidatable.length} near=${near.length} passing=${passing.length} artifact=${outPath}`,
  );
  for (const item of watched.slice(0, 10)) {
    console.log(
      `${item.id} category=${item.currentState.riskCategory} ltv=${num(item.currentState.ltv).toFixed(4)} lltv=${num(item.currentState.lltv).toFixed(4)} borrowUsd=${num(item.currentState.borrowUsd).toFixed(4)} gate=${item.profitability.gate?.status ?? 'unknown'} reason=${item.profitability.gate?.reason ?? 'missing'}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
