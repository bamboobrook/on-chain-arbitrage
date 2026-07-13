#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');
const docsDir = resolve(root, 'docs');

function num(value, fallback = null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function money(value) {
  const n = num(value, 0);
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function pct(value) {
  const n = num(value, 0);
  return `${n.toFixed(4)}%`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function liquidationDistanceFromHealthFactor(healthFactor) {
  const hf = num(healthFactor, Infinity);
  if (!Number.isFinite(hf) || hf <= 0) return null;
  if (hf <= 1) return 0;
  return (1 - 1 / hf) * 100;
}

function classifyCapacity(debtToCoverUsd) {
  const value = num(debtToCoverUsd, 0);
  if (value >= 1_000_000) return 'institutional';
  if (value >= 100_000) return 'large';
  if (value >= 10_000) return 'medium';
  if (value >= 1_000) return 'small';
  return 'dust';
}

function sortWatch(a, b) {
  const ahf = num(a.healthFactor, Infinity);
  const bhf = num(b.healthFactor, Infinity);
  if (ahf !== bhf) return ahf - bhf;
  return num(b.netProfitUsd, 0) - num(a.netProfitUsd, 0);
}

function buildRows(watchlist) {
  return (watchlist.watchlist ?? []).map((item) => {
    const healthFactor = num(item.currentState?.healthFactor, null);
    const distanceToLiquidationPct = liquidationDistanceFromHealthFactor(healthFactor);
    const best = item.profitability?.bestEstimate ?? {};
    return {
      id: item.id,
      currentCandidateId: item.currentCandidateId,
      chain: item.chain,
      user: item.user,
      pairKey: item.historicalPair?.pairKey ?? `${item.symbols?.debt}/${item.symbols?.collateral}`,
      debtSymbol: item.symbols?.debt ?? best.debtSymbol ?? null,
      collateralSymbol: item.symbols?.collateral ?? best.collateralSymbol ?? null,
      riskCategory: item.currentState?.riskCategory ?? null,
      healthFactor,
      distanceToLiquidationPct,
      debtToCoverUsd: num(best.debtToCoverUsd, 0),
      netProfitUsd: num(best.netProfitUsd, 0),
      returnOnDebtPct: num(best.returnOnDebtPct, 0),
      gasUsd: num(best.gasUsd, 0),
      liquidationBonusBps: best.liquidationBonusBps ?? null,
      liquidationProtocolFeeBps: best.liquidationProtocolFeeBps ?? null,
      capacityBucket: classifyCapacity(best.debtToCoverUsd),
      gate: item.profitability?.gate ?? null,
      historical: item.historicalPair ?? null,
      liveStatus: item.liveInterface?.status ?? null,
      liveReason: item.liveInterface?.reason ?? null,
    };
  }).sort(sortWatch);
}

function aggregatePairs(rows) {
  const byPair = new Map();
  for (const row of rows) {
    const current = byPair.get(row.pairKey) ?? {
      pairKey: row.pairKey,
      watchCount: 0,
      minHealthFactor: Infinity,
      minDistanceToLiquidationPct: Infinity,
      totalDebtToCoverUsd: 0,
      totalEstimatedNetProfitUsd: 0,
      maxReturnOnDebtPct: -Infinity,
      capacityBuckets: new Set(),
      exampleIds: [],
    };
    current.watchCount += 1;
    current.minHealthFactor = Math.min(current.minHealthFactor, num(row.healthFactor, Infinity));
    current.minDistanceToLiquidationPct = Math.min(
      current.minDistanceToLiquidationPct,
      num(row.distanceToLiquidationPct, Infinity),
    );
    current.totalDebtToCoverUsd += num(row.debtToCoverUsd, 0);
    current.totalEstimatedNetProfitUsd += num(row.netProfitUsd, 0);
    current.maxReturnOnDebtPct = Math.max(current.maxReturnOnDebtPct, num(row.returnOnDebtPct, -Infinity));
    current.capacityBuckets.add(row.capacityBucket);
    if (current.exampleIds.length < 3) current.exampleIds.push(row.id);
    byPair.set(row.pairKey, current);
  }
  return [...byPair.values()]
    .map((item) => ({
      ...item,
      minHealthFactor: Number.isFinite(item.minHealthFactor) ? item.minHealthFactor : null,
      minDistanceToLiquidationPct: Number.isFinite(item.minDistanceToLiquidationPct)
        ? item.minDistanceToLiquidationPct
        : null,
      maxReturnOnDebtPct: Number.isFinite(item.maxReturnOnDebtPct) ? item.maxReturnOnDebtPct : null,
      capacityBuckets: [...item.capacityBuckets],
    }))
    .sort((a, b) => a.minHealthFactor - b.minHealthFactor);
}

function markdown(artifact) {
  const lines = [];
  lines.push('# Aave 当前 Watchlist 容量与触发分析');
  lines.push('');
  lines.push(`生成时间：${artifact.generatedAt}`);
  lines.push('');
  lines.push('## 总览');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('|---|---:|');
  lines.push(`| watch entries | ${artifact.summary.watchCount} |`);
  lines.push(`| liquidatable | ${artifact.summary.liquidatableCount} |`);
  lines.push(`| near-liquidation | ${artifact.summary.nearLiquidationCount} |`);
  lines.push(`| passing current profitability | ${artifact.summary.passingCurrentProfitabilityCount} |`);
  lines.push(`| total debt-to-cover capacity | ${money(artifact.summary.totalDebtToCoverUsd)} |`);
  lines.push(`| total estimated net profit | ${money(artifact.summary.totalEstimatedNetProfitUsd)} |`);
  lines.push(`| minimum HF | ${artifact.summary.minHealthFactor?.toFixed(6) ?? 'n/a'} |`);
  lines.push(`| closest liquidation distance | ${pct(artifact.summary.minDistanceToLiquidationPct ?? 0)} |`);
  lines.push('');
  lines.push('## 组合聚合');
  lines.push('');
  lines.push('| pair | count | min HF | trigger move | debt capacity | est. net profit | max ROI | buckets |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---|');
  for (const pair of artifact.pairs) {
    lines.push(
      `| ${pair.pairKey} | ${pair.watchCount} | ${pair.minHealthFactor?.toFixed(6) ?? 'n/a'} | ${pct(pair.minDistanceToLiquidationPct ?? 0)} | ${money(pair.totalDebtToCoverUsd)} | ${money(pair.totalEstimatedNetProfitUsd)} | ${pct(pair.maxReturnOnDebtPct ?? 0)} | ${pair.capacityBuckets.join(', ')} |`,
    );
  }
  lines.push('');
  lines.push('## Top Watch Entries');
  lines.push('');
  lines.push('| id | pair | category | HF | trigger move | debt capacity | est. net profit | ROI | gate |');
  lines.push('|---|---|---|---:|---:|---:|---:|---:|---|');
  for (const row of artifact.rows.slice(0, 20)) {
    lines.push(
      `| ${row.id} | ${row.pairKey} | ${row.riskCategory} | ${row.healthFactor?.toFixed(6) ?? 'n/a'} | ${pct(row.distanceToLiquidationPct ?? 0)} | ${money(row.debtToCoverUsd)} | ${money(row.netProfitUsd)} | ${pct(row.returnOnDebtPct)} | ${row.gate?.status ?? 'unknown'}: ${row.gate?.reason ?? ''} |`,
    );
  }
  lines.push('');
  lines.push('## 结论');
  lines.push('');
  lines.push('- 当前没有 Aave watchlist entry 可执行，全部卡在 HF >= 1。');
  lines.push('- 这些 entry 是 scanner 节点应该持续盯的账户和组合，不应进入 executor 下单队列。');
  lines.push('- 触发后仍必须经过同区块 fork simulation、债务资金来源、抵押品退出 quote、gas/slippage gate。');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const chain = String(process.env.AAVE_ANALYSIS_CHAIN ?? process.env.AAVE_WATCH_CHAIN ?? 'ethereum').toLowerCase();
  const watchlistPath = resolve(dataDir, `aave-liquidation-watchlist-${chain}.json`);
  const outJson = resolve(dataDir, `aave-liquidation-watchlist-analysis-${chain}.json`);
  const outMd = resolve(docsDir, `aave-liquidation-watchlist-analysis-${chain}-20260708.md`);
  const watchlist = await readJson(watchlistPath);
  const rows = buildRows(watchlist);
  const pairs = aggregatePairs(rows);
  const liquidatableCount = rows.filter((row) => row.riskCategory === 'liquidatable').length;
  const nearLiquidationCount = rows.filter((row) => row.riskCategory === 'near-liquidation').length;
  const passingCurrentProfitabilityCount = rows.filter((row) => row.gate?.status === 'pass').length;
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      chain,
      watchlistArtifact: watchlistPath,
    },
    methodology: {
      classification: 'aave-current-watchlist-capacity-analysis',
      liquidationDistanceApproximation:
        'For HF > 1, approximate collateral-side move to HF=1 as 1 - 1/HF. This is a triage metric, not a substitute for protocol math at execution time.',
      executionRequirement:
        'Rows are scanner targets only until HF < 1, fork simulation succeeds, and unwind quote remains profitable after gas and slippage.',
    },
    summary: {
      watchCount: rows.length,
      liquidatableCount,
      nearLiquidationCount,
      passingCurrentProfitabilityCount,
      pairCount: pairs.length,
      minHealthFactor: rows.length ? Math.min(...rows.map((row) => num(row.healthFactor, Infinity))) : null,
      minDistanceToLiquidationPct: rows.length
        ? Math.min(...rows.map((row) => num(row.distanceToLiquidationPct, Infinity)))
        : null,
      totalDebtToCoverUsd: rows.reduce((sum, row) => sum + num(row.debtToCoverUsd, 0), 0),
      totalEstimatedNetProfitUsd: rows.reduce((sum, row) => sum + num(row.netProfitUsd, 0), 0),
      status:
        passingCurrentProfitabilityCount > 0
          ? 'found-current-watchlist-entries-ready-for-fork-simulation'
          : 'no-current-watchlist-entry-ready-for-fork-simulation',
    },
    pairs,
    rows,
  };
  await mkdir(dataDir, { recursive: true });
  await mkdir(docsDir, { recursive: true });
  await writeFile(outJson, `${JSON.stringify(artifact, null, 2)}\n`);
  await writeFile(outMd, markdown(artifact));
  console.log(
    `aaveWatchlistAnalysis=${artifact.summary.status} rows=${rows.length} pairs=${pairs.length} capacityUsd=${artifact.summary.totalDebtToCoverUsd.toFixed(2)} netUsd=${artifact.summary.totalEstimatedNetProfitUsd.toFixed(2)} artifact=${outJson} report=${outMd}`,
  );
  for (const row of rows.slice(0, 10)) {
    console.log(
      `${row.id} pair=${row.pairKey} hf=${row.healthFactor?.toFixed(6) ?? 'n/a'} triggerMove=${(row.distanceToLiquidationPct ?? 0).toFixed(4)}% capacity=${row.debtToCoverUsd.toFixed(2)} net=${row.netProfitUsd.toFixed(2)} gate=${row.gate?.status ?? 'unknown'}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
