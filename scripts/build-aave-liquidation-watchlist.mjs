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

function pairKey(debtSymbol, collateralSymbol) {
  return `${String(debtSymbol ?? '').toUpperCase()}/${String(collateralSymbol ?? '').toUpperCase()}`;
}

function stableHistoricalPairs(replayArtifact) {
  const byPair = new Map();
  for (const candidate of replayArtifact.candidates ?? []) {
    if (candidate.gate?.status !== 'pass') continue;
    const estimate = candidate.bestEstimate ?? {};
    const debtSymbol = estimate.debtSymbol ?? null;
    const collateralSymbol = estimate.collateralSymbol ?? null;
    if (!debtSymbol || !collateralSymbol) continue;
    const key = pairKey(debtSymbol, collateralSymbol);
    const current = byPair.get(key) ?? {
      pairKey: key,
      debtSymbol,
      collateralSymbol,
      exampleCandidateId: candidate.id,
      candidateCount: 0,
      sampleCount: 0,
      maxAnnualizedNetReturnPct: -Infinity,
      maxWinRatePct: -Infinity,
      maxMedianNetProfitUsd: -Infinity,
      totalHistoricalNetProfitUsd: 0,
    };
    current.candidateCount += 1;
    current.sampleCount += num(candidate.metrics?.sampleCount, 0);
    current.maxAnnualizedNetReturnPct = Math.max(
      current.maxAnnualizedNetReturnPct,
      num(candidate.metrics?.annualizedNetReturnPct, -Infinity),
    );
    current.maxWinRatePct = Math.max(current.maxWinRatePct, num(candidate.metrics?.netWinRatePct, -Infinity));
    current.maxMedianNetProfitUsd = Math.max(
      current.maxMedianNetProfitUsd,
      num(candidate.metrics?.netProfitUsd?.median, -Infinity),
    );
    current.totalHistoricalNetProfitUsd += num(candidate.metrics?.netProfitUsd?.sum, 0);
    byPair.set(key, current);
  }
  return byPair;
}

function riskCategory(candidate, nearHealthFactor, watchHealthFactor) {
  const healthFactor = num(candidate.account?.healthFactor, Infinity);
  if (healthFactor < 1) return 'liquidatable';
  if (healthFactor <= nearHealthFactor) return 'near-liquidation';
  if (healthFactor <= watchHealthFactor) return 'watch';
  return 'healthy';
}

function watchPriority(item) {
  if (item.currentState.riskCategory === 'liquidatable') return 0;
  if (item.currentState.riskCategory === 'near-liquidation') return 1;
  if (item.currentState.riskCategory === 'watch') return 2;
  return 3;
}

function estimatePair(candidate, historicalPair) {
  const debt = (candidate.debts ?? []).find(
    (item) => String(item.symbol).toUpperCase() === String(historicalPair.debtSymbol).toUpperCase(),
  );
  const collateral = (candidate.collaterals ?? []).find(
    (item) => String(item.symbol).toUpperCase() === String(historicalPair.collateralSymbol).toUpperCase(),
  );
  if (!debt || !collateral) return null;
  if (!Number.isFinite(debt.valueUsd) || debt.valueUsd <= 0) return null;
  if (!Number.isFinite(collateral.valueUsd) || collateral.valueUsd <= 0) return null;
  const healthFactor = num(candidate.account?.healthFactor, Infinity);
  const closeFactor = healthFactor < 0.95 ? 1 : 0.5;
  const bonus = num(collateral.liquidationBonusBps, 10_000) / 10_000;
  if (!Number.isFinite(bonus) || bonus <= 1) return null;
  const gasUsd = num(candidate.bestEstimate?.gasUsd, 0);
  const maxDebtByCollateral = collateral.valueUsd / bonus;
  const debtToCoverUsd = Math.min(debt.valueUsd * closeFactor, maxDebtByCollateral);
  const protocolFeeRate =
    ((num(collateral.liquidationBonusBps, 10_000) - 10_000) / 10_000) *
    (num(collateral.liquidationProtocolFeeBps, 0) / 10_000);
  const grossProfitUsd = debtToCoverUsd * (bonus - 1);
  const protocolFeeUsd = debtToCoverUsd * protocolFeeRate;
  const seizedCollateralUsd = debtToCoverUsd + grossProfitUsd - protocolFeeUsd;
  const netProfitUsd = grossProfitUsd - protocolFeeUsd - gasUsd;
  const returnOnDebtPct = debtToCoverUsd > 0 ? (netProfitUsd / debtToCoverUsd) * 100 : null;
  const debtToCoverRatio = Math.min(1, debtToCoverUsd / debt.valueUsd);
  const debtToCoverScale = 1_000_000_000n;
  const debtToCoverScaled = BigInt(Math.max(0, Math.floor(debtToCoverRatio * Number(debtToCoverScale))));
  const debtBalanceBaseUnits = BigInt(debt.amountBaseUnits ?? '0');
  const debtToCoverBaseUnits = (debtBalanceBaseUnits * debtToCoverScaled) / debtToCoverScale;
  const seizedCollateralRatio = Math.min(1, seizedCollateralUsd / collateral.valueUsd);
  const seizedCollateralScaled = BigInt(
    Math.max(0, Math.floor(seizedCollateralRatio * Number(debtToCoverScale))),
  );
  const collateralBalanceBaseUnits = BigInt(collateral.amountBaseUnits ?? '0');
  const seizedCollateralBaseUnits =
    (collateralBalanceBaseUnits * seizedCollateralScaled) / debtToCoverScale;
  return {
    debtAsset: debt.asset,
    debtSymbol: debt.symbol,
    collateralAsset: collateral.asset,
    collateralSymbol: collateral.symbol,
    closeFactor,
    debtToCoverUsd,
    debtToCoverAmount: null,
    debtToCoverBaseUnits: debtToCoverBaseUnits.toString(),
    debtToCoverSource: 'estimated-from-current-debt-usd-and-close-factor',
    seizedCollateralUsd,
    seizedCollateralAmount: null,
    seizedCollateralBaseUnits: seizedCollateralBaseUnits.toString(),
    seizedCollateralSource: 'estimated-from-current-collateral-usd-bonus-and-protocol-fee',
    liquidationBonusBps: collateral.liquidationBonusBps,
    liquidationProtocolFeeBps: collateral.liquidationProtocolFeeBps,
    grossProfitUsd,
    protocolFeeUsd,
    gasUsd,
    netProfitUsd,
    returnOnDebtPct,
  };
}

function gateForPair(candidate, estimate) {
  const minNetProfitUsd = num(candidate.gate?.minNetProfitUsd, 5);
  const minReturnOnDebtPct = num(candidate.gate?.minReturnOnDebtPct, 0.1);
  const healthFactor = num(candidate.account?.healthFactor, Infinity);
  if (healthFactor >= 1) {
    return {
      status: 'block',
      reason: `health factor ${healthFactor.toFixed(6)} is not below 1`,
      minNetProfitUsd,
      minReturnOnDebtPct,
    };
  }
  if (!estimate) {
    return {
      status: 'block',
      reason: 'historical debt/collateral pair not present in current borrower balances',
      minNetProfitUsd,
      minReturnOnDebtPct,
    };
  }
  if (estimate.netProfitUsd < minNetProfitUsd) {
    return {
      status: 'block',
      reason: `estimated net profit ${estimate.netProfitUsd.toFixed(4)} USD below ${minNetProfitUsd} USD`,
      minNetProfitUsd,
      minReturnOnDebtPct,
    };
  }
  if ((estimate.returnOnDebtPct ?? -Infinity) < minReturnOnDebtPct) {
    return {
      status: 'block',
      reason: `return on debt ${estimate.returnOnDebtPct?.toFixed(4) ?? 'n/a'}% below ${minReturnOnDebtPct}%`,
      minNetProfitUsd,
      minReturnOnDebtPct,
    };
  }
  return {
    status: 'pass',
    reason: 'health factor, estimated net profit, and return-on-debt gates passed for historical pair',
    minNetProfitUsd,
    minReturnOnDebtPct,
  };
}

function watchReason(item) {
  if (item.currentState.riskCategory === 'liquidatable') {
    return item.profitability.gate?.status === 'pass'
      ? 'current borrower is liquidatable and current profitability gates passed; same-block fork simulation and liquidation/unwind calldata are still required'
      : `current borrower is liquidatable but blocked: ${item.profitability.gate?.reason ?? 'missing gate reason'}`;
  }
  if (item.currentState.riskCategory === 'near-liquidation') {
    return 'borrower health factor is near 1; monitor frequently and rerun current Aave scan when it crosses the liquidation threshold';
  }
  if (item.currentState.riskCategory === 'watch') {
    return 'borrower is on a historically profitable pair but not close enough to liquidation for live execution';
  }
  return 'borrower is healthy';
}

async function main() {
  const chain = String(process.env.AAVE_WATCH_CHAIN ?? process.env.LIQ_CHAIN ?? 'ethereum').toLowerCase();
  const currentPath = resolve(dataDir, `aave-liquidation-candidates-${chain}.json`);
  const replayPath = resolve(dataDir, `aave-liquidation-event-replay-candidates-${chain}.json`);
  const outPath = resolve(dataDir, `aave-liquidation-watchlist-${chain}.json`);
  const nearHealthFactor = num(Number(process.env.AAVE_WATCH_NEAR_HEALTH_FACTOR), 1.02);
  const watchHealthFactor = num(Number(process.env.AAVE_WATCH_HEALTH_FACTOR), 1.05);

  const currentArtifact = await readJson(currentPath);
  const replayArtifact = await readJson(replayPath);
  const stablePairs = stableHistoricalPairs(replayArtifact);
  const watched = [];

  for (const candidate of currentArtifact.candidates ?? []) {
    const category = riskCategory(candidate, nearHealthFactor, watchHealthFactor);
    if (!['liquidatable', 'near-liquidation', 'watch'].includes(category)) continue;
    for (const historicalPair of stablePairs.values()) {
      const estimate = estimatePair(candidate, historicalPair);
      if (!estimate) continue;
      const gate = gateForPair(candidate, estimate);
      const currentBestPair = pairKey(candidate.bestEstimate?.debtSymbol, candidate.bestEstimate?.collateralSymbol);
      const bestEstimateMatchesHistoricalPair = currentBestPair === historicalPair.pairKey;
      const item = {
      id: bestEstimateMatchesHistoricalPair ? candidate.id : `${candidate.id}-${historicalPair.pairKey.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      currentCandidateId: candidate.id,
      bestEstimateMatchesHistoricalPair,
      chain: candidate.chain,
      strategyType: candidate.strategyType,
      isPureArbitrage: candidate.isPureArbitrage === true,
      noCexRequired: candidate.noCexRequired === true,
      user: candidate.user,
      blockNumber: candidate.blockNumber,
      symbols: {
        debt: estimate.debtSymbol,
        collateral: estimate.collateralSymbol,
      },
      currentState: {
        riskCategory: category,
        healthFactor: candidate.account?.healthFactor ?? null,
        healthFactorRaw: candidate.account?.healthFactorRaw ?? null,
        totalCollateralBase: candidate.account?.totalCollateralBase ?? null,
        totalDebtBase: candidate.account?.totalDebtBase ?? null,
        debtToCoverUsd: estimate.debtToCoverUsd,
        netProfitUsd: estimate.netProfitUsd,
        returnOnDebtPct: estimate.returnOnDebtPct,
      },
      profitability: {
        gate,
        bestEstimate: estimate,
      },
      historicalPair,
      liveInterface: {
        status: gate.status === 'pass' ? 'watchlist-ready-for-fork-simulation' : 'watchlist-blocked-until-current-liquidation-and-profitability-gates-pass',
        reason: null,
        nextRequiredGate:
          gate.status === 'pass'
            ? 'same-block fork simulation with liquidationCall calldata, debt funding, and collateral unwind quote'
            : 'current health factor and profitability gate',
      },
    };
      item.liveInterface.reason = watchReason(item);
      watched.push(item);
    }
  }

  watched.sort((a, b) => {
    const priority = watchPriority(a) - watchPriority(b);
    if (priority !== 0) return priority;
    const hf = num(a.currentState.healthFactor, Infinity) - num(b.currentState.healthFactor, Infinity);
    if (hf !== 0) return hf;
    return num(b.currentState.debtToCoverUsd, 0) - num(a.currentState.debtToCoverUsd, 0);
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
      classification: 'aave-v3-current-opportunity-watchlist',
      isPureArbitrage: true,
      noCexRequired: true,
      selection:
        'current Aave borrowers whose best debt/collateral liquidation pair matches a historically passing Aave replay pair and whose health factor is liquidatable, near-liquidation, or watch',
      nearHealthFactor,
      watchHealthFactor,
      liveGate:
        'watchlist entries are not executable until current liquidation/profitability gates, same-block fork simulation, debt funding, and collateral unwind gates pass',
    },
    summary: {
      historicallyStablePairCount: stablePairs.size,
      watchCandidateCount: watched.length,
      liquidatableCount: liquidatable.length,
      nearLiquidationCount: near.length,
      watchCount: watch.length,
      passingCurrentProfitabilityCount: passing.length,
      requestedPassingCount: 5,
      liveExecutionStatus: passing.length >= 5 ? 'fork-simulation-required' : 'blocked',
      status:
        passing.length >= 5
          ? 'found-at-least-five-current-aave-watchlist-profitability-candidates'
          : 'did-not-find-five-current-aave-watchlist-profitability-candidates',
    },
    watchlist: watched,
  };

  await mkdir(dataDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    `aaveWatchlist=${artifact.summary.status} stablePairs=${stablePairs.size} watch=${watched.length} liquidatable=${liquidatable.length} near=${near.length} passing=${passing.length} artifact=${outPath}`,
  );
  for (const item of watched.slice(0, 10)) {
    console.log(
      `${item.id} pair=${item.symbols.debt}/${item.symbols.collateral} category=${item.currentState.riskCategory} hf=${num(item.currentState.healthFactor).toFixed(6)} netUsd=${num(item.currentState.netProfitUsd).toFixed(4)} gate=${item.profitability.gate?.status ?? 'unknown'} reason=${item.profitability.gate?.reason ?? 'missing'}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
