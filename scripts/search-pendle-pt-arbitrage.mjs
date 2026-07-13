#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');

const PENDLE_API = 'https://api-v2.pendle.finance/core/v1';
const DEFAULT_CHAIN_IDS = [1, 42161, 8453, 56, 999];
const CHAIN_LABELS = {
  1: 'Ethereum',
  42161: 'Arbitrum',
  8453: 'Base',
  56: 'BNB',
  999: 'HyperEVM',
};

function envNumber(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envList(key, fallback) {
  const raw = String(process.env[key] ?? '').trim();
  if (!raw) return fallback;
  return raw
    .split(/[\s,]+/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function short(value) {
  return String(value ?? '')
    .replace(/^[0-9]+-/u, '')
    .slice(2, 8)
    .toLowerCase();
}

function gateFor({ impliedApyPct, liquidityUsd, daysToExpiry, netProfitUsd }) {
  const minApy = envNumber('PENDLE_PT_MIN_IMPLIED_APY_PCT', 20);
  const minLiquidity = envNumber('PENDLE_PT_MIN_LIQUIDITY_USD', 100000);
  const minDays = envNumber('PENDLE_PT_MIN_DAYS_TO_EXPIRY', 7);
  const countCarryAsPass = process.env.PENDLE_PT_COUNT_CARRY_AS_PASS === '1';
  const reasons = [];
  if (impliedApyPct < minApy) reasons.push(`implied APY ${impliedApyPct.toFixed(2)}% below ${minApy}%`);
  if (liquidityUsd < minLiquidity) {
    reasons.push(`liquidity ${liquidityUsd.toFixed(2)} USD below ${minLiquidity} USD`);
  }
  if (daysToExpiry < minDays) reasons.push(`expiry ${daysToExpiry.toFixed(2)}d below ${minDays}d`);
  if (netProfitUsd <= 0) reasons.push(`estimated hold profit ${netProfitUsd.toFixed(2)} USD is not positive`);
  if (!reasons.length && countCarryAsPass) {
    return {
      status: 'pass',
      reason:
        'PT fixed-yield carry gate passed by explicit override; execution still needs router quote, redemption path, and fork simulation',
      minAnnualizedNetReturnPct: minApy,
      minLiquidityUsd: minLiquidity,
      minDaysToExpiry: minDays,
    };
  }
  if (!reasons.length) {
    reasons.push(
      'PT fixed-yield carry is not counted as stable atomic arbitrage until historical PT price replay, exit-liquidity stress, router quote, and fork simulation pass',
    );
  }
  return {
    status: 'block',
    reason: reasons.join('; '),
    minAnnualizedNetReturnPct: minApy,
    minLiquidityUsd: minLiquidity,
    minDaysToExpiry: minDays,
  };
}

async function fetchActiveMarkets(chainId) {
  const res = await fetch(`${PENDLE_API}/${chainId}/markets/active`);
  const text = await res.text();
  if (!res.ok) throw new Error(`Pendle ${chainId} ${res.status}: ${text.slice(0, 160)}`);
  const json = JSON.parse(text);
  return Array.isArray(json.markets) ? json.markets : [];
}

function candidateFromMarket(chainId, market) {
  const now = Date.now();
  const expiryMs = Date.parse(market.expiry);
  const daysToExpiry = Number.isFinite(expiryMs) ? Math.max(0, (expiryMs - now) / 86_400_000) : 0;
  const details = market.details ?? {};
  const impliedApy = Number(details.impliedApy ?? 0);
  const impliedApyPct = impliedApy * 100;
  const aggregatedApyPct = Number(details.aggregatedApy ?? 0) * 100;
  const liquidityUsd = Number(details.liquidity ?? 0);
  const capitalUsd = envNumber('PENDLE_PT_CAPITAL_USD', 10000);
  const gasUsd = envNumber('PENDLE_PT_GAS_USD', chainId === 1 ? 20 : 1);
  const holdReturnPct = (Math.pow(1 + Math.max(0, impliedApy), daysToExpiry / 365) - 1) * 100;
  const grossProfitUsd = (capitalUsd * holdReturnPct) / 100;
  const netProfitUsd = grossProfitUsd - gasUsd;
  const gate = gateFor({ impliedApyPct, liquidityUsd, daysToExpiry, netProfitUsd });
  const chain = CHAIN_LABELS[chainId] ?? `chain-${chainId}`;
  const id = `pendle-pt-${chain.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${short(market.address)}-${short(market.pt)}`;
  return {
    id,
    chain,
    chainId,
    protocol: market.protocol ?? 'Pendle',
    strategyType: 'pendle-pt-fixed-yield-convergence',
    isPureArbitrage: true,
    noCexRequired: true,
    atomicArbitrage: false,
    market: {
      name: market.name,
      address: market.address,
      expiry: market.expiry,
      pt: market.pt,
      yt: market.yt,
      sy: market.sy,
      underlyingAsset: market.underlyingAsset,
      accountingAsset: market.accountingAsset ?? market.underlyingAsset,
      inputTokens: market.inputTokens ?? [],
      outputTokens: market.outputTokens ?? [],
      categoryIds: market.categoryIds ?? [],
    },
    metrics: {
      sampleCount: 1,
      liquidityUsd,
      impliedApyPct,
      aggregatedApyPct,
      pendleApyPct: Number(details.pendleApy ?? 0) * 100,
      daysToExpiry,
      estimatedHoldReturnPct: holdReturnPct,
      annualizedNetReturnPct: {
        mean: impliedApyPct,
        median: impliedApyPct,
      },
      netProfitUsd: {
        mean: netProfitUsd,
        median: netProfitUsd,
      },
    },
    bestEstimate: {
      capitalUsd,
      gasUsd,
      grossProfitUsd,
      netProfitUsd,
      impliedApyPct,
      estimatedHoldReturnPct: holdReturnPct,
      daysToExpiry,
    },
    gate,
    liveInterface: {
      status:
        gate.status === 'pass'
          ? 'pendle-carry-plan-needs-router-quote-and-fork-simulation'
          : 'blocked-by-pendle-carry-risk-gate',
      requiresCex: false,
      userFlow:
        'connect wallet, quote PT purchase on Pendle router, hold/redeem PT on-chain, and optionally unwind before maturity',
      blockers: [
        'not an atomic same-block arbitrage',
        'requires Pendle router calldata, PT redemption path, and fork simulation',
        'requires historical PT price replay and exit-liquidity stress before counting as stable 20%+ evidence',
      ],
    },
    samples: [],
  };
}

async function main() {
  const chainIds = envList('PENDLE_CHAIN_IDS', DEFAULT_CHAIN_IDS);
  const maxPerChain = Math.floor(envNumber('PENDLE_PT_MAX_MARKETS_PER_CHAIN', 80));
  const candidates = [];
  const errors = [];
  for (const chainId of chainIds) {
    try {
      const markets = await fetchActiveMarkets(chainId);
      for (const market of markets.slice(0, maxPerChain)) {
        candidates.push(candidateFromMarket(chainId, market));
      }
    } catch (err) {
      errors.push({ chainId, error: err.message });
    }
  }
  candidates.sort((a, b) => {
    const scoreA = a.bestEstimate.netProfitUsd + a.metrics.impliedApyPct * 100;
    const scoreB = b.bestEstimate.netProfitUsd + b.metrics.impliedApyPct * 100;
    return scoreB - scoreA;
  });
  const minApy = envNumber('PENDLE_PT_MIN_IMPLIED_APY_PCT', 20);
  const economicCandidates = candidates.filter(
    (candidate) =>
      candidate.metrics.impliedApyPct >= minApy &&
      candidate.metrics.liquidityUsd >= envNumber('PENDLE_PT_MIN_LIQUIDITY_USD', 100000) &&
      candidate.metrics.daysToExpiry >= envNumber('PENDLE_PT_MIN_DAYS_TO_EXPIRY', 7) &&
      candidate.bestEstimate.netProfitUsd > 0,
  );
  const passing = candidates.filter((candidate) => candidate.gate.status === 'pass');
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      api: PENDLE_API,
      officialReferences: [
        'https://docs.pendle.finance/',
        'https://api-v2.pendle.finance/core/v1/1/markets/active',
      ],
      chainIds,
      errors,
    },
    methodology: {
      classification: 'pure-on-chain-pendle-pt-fixed-yield-convergence',
      isPureArbitrage: true,
      noCexRequired: true,
      atomicArbitrage: false,
      selection:
        'active Pendle PT markets with observable implied APY, liquidity, expiry, and a hold-to-maturity estimate',
      caveats: [
        'This is a carry/convergence candidate scan, not a same-block arbitrage replay.',
        'PT implied APY can change before execution; the user may need to hold until maturity.',
        'Principal, smart-contract, oracle, liquidity, and early-exit risks are not eliminated.',
        'Default gates remain blocked until historical PT price replay, router quote, redemption quote, and fork simulation pass.',
      ],
    },
    summary: {
      chainCount: chainIds.length,
      candidateCount: candidates.length,
      economicCandidateCount: economicCandidates.length,
      passingCount: passing.length,
      requestedPassingCount: 5,
      status:
        passing.length >= 5
          ? 'found-at-least-five-passing-pendle-pt-carry-candidates'
          : 'did-not-find-five-passing-pendle-pt-carry-candidates',
    },
    candidates,
  };
  await mkdir(dataDir, { recursive: true });
  const outJson = resolve(dataDir, 'pendle-pt-arbitrage-candidates.json');
  await writeFile(outJson, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    `pendlePt=${artifact.summary.status} chains=${chainIds.length} candidates=${candidates.length} economic=${economicCandidates.length} passing=${passing.length} artifact=${outJson}`,
  );
  for (const candidate of economicCandidates.slice(0, 10)) {
    console.log(
      `${candidate.id} chain=${candidate.chain} market=${candidate.market.name} implied=${candidate.metrics.impliedApyPct.toFixed(2)}% liquidity=${candidate.metrics.liquidityUsd.toFixed(2)} net=${candidate.bestEstimate.netProfitUsd.toFixed(2)} gate=${candidate.gate.status}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
