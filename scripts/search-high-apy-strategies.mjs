#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'data');
const outJson = resolve(outDir, 'strategy-candidates.json');
const outMd = resolve(root, 'docs', 'current-20apy-candidates.md');

const ALLOWED_CHAINS = new Set(['Base', 'Arbitrum', 'Ethereum', 'Optimism', 'Polygon']);
const ALLOWED_PROJECTS = new Set([
  'uniswap-v3',
  'uniswap-v4',
  'aerodrome-slipstream',
  'curve-dex',
  'balancer-v2',
  'morpho-blue',
  'aave-v3',
  'compound-v3',
]);
const BLUE_CHIP_SYMBOLS = [
  'USDC',
  'USDT',
  'DAI',
  'WETH',
  'ETH',
  'WBTC',
  'CBBTC',
  'CBETH',
  'WSTETH',
  'STETH',
  'RETH',
  'AAVE',
  'PENDLE',
];

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hasKnownAsset(symbol = '') {
  const up = symbol.toUpperCase().replace(/[^A-Z0-9-]/g, '-');
  return BLUE_CHIP_SYMBOLS.some((s) => up.split('-').includes(s));
}

function classify(pool) {
  const project = String(pool.project ?? '');
  if (project.includes('uniswap') || project.includes('aerodrome') || project.includes('balancer')) {
    return 'lp-market-making';
  }
  if (project.includes('curve')) return pool.stablecoin ? 'stable-lp-yield' : 'lp-market-making';
  if (project.includes('aave') || project.includes('morpho') || project.includes('compound')) return 'lending-yield';
  return 'yield';
}

function liveInterfaceStatus(candidate) {
  if (candidate.classification === 'lp-market-making') {
    if (candidate.project === 'uniswap-v3') return 'needs-uniswap-v3-npm-adapter';
    if (candidate.project === 'aerodrome-slipstream') return 'needs-slipstream-adapter';
    if (candidate.project === 'balancer-v2') return 'needs-balancer-vault-adapter';
  }
  if (candidate.classification === 'stable-lp-yield') return 'needs-curve-adapter';
  return 'paper-only';
}

function riskNotes(pool, classification) {
  const notes = ['历史收益不代表未来收益', '策略目标不等于保证收益'];
  if (classification.includes('lp')) notes.push('LP 做市存在无常损失和再平衡成本');
  if (pool.stablecoin) notes.push('稳定币池仍有脱锚、赎回和协议风险');
  if (pool.ilRisk === 'yes') notes.push('DeFiLlama 标记存在 IL risk');
  if (num(pool.apyBase7d) === null) notes.push('缺少 7d fee APY，可能是新池或尖峰');
  return notes;
}

function score(pool) {
  const apyBase = num(pool.apyBase) ?? 0;
  const apyBase7d = num(pool.apyBase7d);
  const apyMean30d = num(pool.apyMean30d);
  const tvl = num(pool.tvlUsd) ?? 0;
  let s = 0;
  s += Math.min(40, Math.log10(Math.max(tvl, 1)) * 6);
  s += Math.min(30, apyBase / 4);
  if (apyBase7d != null) s += Math.min(20, apyBase7d / 3);
  if (apyMean30d != null && apyMean30d >= 20) s += 15;
  if (pool.stablecoin) s += 8;
  if (hasKnownAsset(pool.symbol)) s += 8;
  if (pool.ilRisk === 'yes') s -= 8;
  if (apyBase > 1000) s -= 20;
  if (apyBase7d == null) s -= 10;
  return s;
}

function pickCandidates(pools) {
  const filtered = pools
    .filter((p) => ALLOWED_CHAINS.has(p.chain))
    .filter((p) => ALLOWED_PROJECTS.has(p.project))
    .filter((p) => (num(p.tvlUsd) ?? 0) >= 1_000_000)
    .filter((p) => (num(p.apyBase) ?? 0) >= 20)
    .filter((p) => conservativeApyFromPool(p) >= 20)
    .filter((p) => hasKnownAsset(p.symbol) || p.stablecoin)
    .map((p) => ({ ...p, _score: score(p) }))
    .sort((a, b) => b._score - a._score);

  const selected = [];
  const seenSymbols = new Set();
  for (const p of filtered) {
    const key = `${p.chain}:${p.project}:${p.symbol}`.toUpperCase();
    if (seenSymbols.has(key)) continue;
    const classification = classify(p);
    const id = `candidate-${selected.length + 1}-${String(p.chain).toLowerCase()}-${String(p.symbol)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}`;
    const candidate = {
      id,
      poolId: p.pool,
      chain: p.chain,
      project: p.project,
      symbol: p.symbol,
      classification,
      isPureArbitrage: false,
      evidenceStatus: 'defillama-yields-snapshot',
      apyBase: num(p.apyBase),
      apyBase7d: num(p.apyBase7d),
      apyMean30d: num(p.apyMean30d),
      apy: num(p.apy),
      tvlUsd: num(p.tvlUsd),
      stablecoin: Boolean(p.stablecoin),
      ilRisk: p.ilRisk ?? null,
      exposure: p.exposure ?? null,
      underlyingTokens: p.underlyingTokens ?? [],
      liveInterfaceStatus: liveInterfaceStatus({ project: p.project, classification }),
      riskNotes: riskNotes(p, classification),
      source: 'https://yields.llama.fi/pools',
    };
    selected.push(candidate);
    seenSymbols.add(key);
    if (selected.length >= 5) break;
  }
  return selected;
}

function conservativeApyFromPool(pool) {
  const vals = [num(pool.apyBase), num(pool.apyBase7d), num(pool.apyMean30d)].filter(
    (x) => typeof x === 'number' && Number.isFinite(x),
  );
  if (!vals.length) return 0;
  return Math.min(...vals);
}

function evidenceBacktests(candidates, capturedAt) {
  return candidates.map((c) => {
    const conservativeApy = Math.max(
      0,
      Math.min(
        ...[c.apyBase, c.apyBase7d, c.apyMean30d].filter(
          (x) => typeof x === 'number' && Number.isFinite(x),
        ),
      ),
    );
    return {
      id: `evidence-${c.id}`,
      candidateId: c.id,
      strategyId: 'yield-rotator',
      status: conservativeApy >= 20 ? 'passes-20apy-observation' : 'needs-more-history',
      source: c.source,
      capturedAt,
      metrics: {
        currentApyBasePct: c.apyBase,
        sevenDayApyBasePct: c.apyBase7d,
        thirtyDayMeanApyPct: c.apyMean30d,
        conservativeObservedApyPct: conservativeApy,
        tvlUsd: c.tvlUsd,
        isPureArbitrage: c.isPureArbitrage,
        classification: c.classification,
      },
      caveats: c.riskNotes,
    };
  });
}

async function main() {
  const res = await fetch('https://yields.llama.fi/pools');
  if (!res.ok) throw new Error(`DeFiLlama API ${res.status}`);
  const json = await res.json();
  const pools = Array.isArray(json.data) ? json.data : [];
  const capturedAt = new Date().toISOString();
  const candidates = pickCandidates(pools);
  if (candidates.length < 5) {
    throw new Error(`only found ${candidates.length} candidates with current filters`);
  }
  const artifact = {
    generatedAt: capturedAt,
    source: 'https://yields.llama.fi/pools',
    methodology: {
      minTvlUsd: 1_000_000,
      minApyBasePct: 20,
      allowedChains: [...ALLOWED_CHAINS],
      allowedProjects: [...ALLOWED_PROJECTS],
      note: 'These are on-chain APY candidates, not guaranteed pure arbitrage strategies.',
    },
    candidates,
    evidenceBacktests: evidenceBacktests(candidates, capturedAt),
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(outJson, `${JSON.stringify(artifact, null, 2)}\n`);
  await writeFile(outMd, renderMarkdown(artifact));
  console.log(`wrote ${outJson}`);
  console.log(`wrote ${outMd}`);
  for (const c of candidates) {
    console.log(`${c.id}: ${c.chain} ${c.project} ${c.symbol} apyBase=${c.apyBase}% tvl=$${Math.round(c.tvlUsd ?? 0)}`);
  }
}

function renderMarkdown(artifact) {
  const rows = artifact.candidates
    .map(
      (c) =>
        `| ${c.id} | ${c.chain} | ${c.project} | ${c.symbol} | ${c.classification} | ${c.apyBase ?? 'n/a'} | ${c.apyBase7d ?? 'n/a'} | ${c.apyMean30d ?? 'n/a'} | ${Math.round(c.tvlUsd ?? 0)} | ${c.liveInterfaceStatus} |`,
    )
    .join('\n');
  return `# Current 20%+ On-Chain Candidates

Generated: ${artifact.generatedAt}

Source: ${artifact.source}

Important: these are on-chain APY candidates from DeFiLlama Yields. They are not guaranteed returns and they are not pure arbitrage unless explicitly marked \`isPureArbitrage=true\`. In the current snapshot all selected candidates are LP / market-making / yield candidates.

| ID | Chain | Project | Symbol | Classification | APY base % | 7d APY base % | 30d mean APY % | TVL USD | Live interface |
|---|---|---|---|---:|---:|---:|---:|---:|---|
${rows}

## Caveats

- Historical yields are not future yields.
- LP strategies carry impermanent-loss, range, gas, rebalance, and protocol risk.
- These candidates satisfy an observable 20%+ APY filter, not a promise of 20%+ annualized return.
- Pure public-RPC AMM arbitrage remains unproven in this repo; see \`docs/arbitrage-search-results.md\`.
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
