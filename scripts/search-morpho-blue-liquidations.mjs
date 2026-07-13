#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');

const MORPHO_API = 'https://api.morpho.org/graphql';
const WAD = 1e18;
const PRICE_SELECTOR = '0x41976e09';

let CHAIN = {
  name: 'Ethereum',
  shortName: 'ethereum',
  chainId: 1,
  nativePriceSymbol: 'WETH',
  morpho: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
};

const CHAIN_PROFILES = {
  ethereum: CHAIN,
  base: {
    name: 'Base',
    shortName: 'base',
    chainId: 8453,
    nativePriceSymbol: 'WETH',
    morpho: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
  },
};

function selectChainProfile() {
  const key = String(process.env.MORPHO_LIQ_CHAIN ?? 'ethereum').toLowerCase();
  if (key === 'eth' || key === 'mainnet') CHAIN = CHAIN_PROFILES.ethereum;
  else if (CHAIN_PROFILES[key]) CHAIN = CHAIN_PROFILES[key];
  else throw new Error(`unsupported MORPHO_LIQ_CHAIN ${key}`);
}

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
    // RPC/API env can be supplied externally.
  }
}

function envNumber(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envList(key) {
  return String(process.env[key] ?? '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function chainRpcEnvVar() {
  if (CHAIN.shortName === 'ethereum') return 'RPC_ETHEREUM_URL';
  if (CHAIN.shortName === 'base') return 'RPC_BASE_URL';
  return null;
}

function hexStrip(hex) {
  return String(hex ?? '').replace(/^0x/i, '');
}

function decodeFirstUint(result) {
  const clean = hexStrip(result);
  if (clean.length < 64) throw new Error('short uint256 result');
  return BigInt(`0x${clean.slice(0, 64)}`);
}

async function rpc(url, method, params = []) {
  const controller = new AbortController();
  const timeoutMs = envNumber('MORPHO_LIQ_RPC_TIMEOUT_MS', 20_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${method} http ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(`${method}: ${json.error.message ?? 'rpc error'}`);
    return json.result;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`${method}: timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function checkOraclePrice(rpcUrl, oracle) {
  if (process.env.MORPHO_LIQ_SKIP_ORACLE_CHECK === '1') {
    return { status: 'skipped', reason: 'MORPHO_LIQ_SKIP_ORACLE_CHECK=1' };
  }
  if (!rpcUrl) {
    return { status: 'skipped', reason: `${chainRpcEnvVar() ?? 'chain rpc env'} is not configured` };
  }
  try {
    const result = await rpc(rpcUrl, 'eth_call', [{ to: oracle, data: PRICE_SELECTOR }]);
    const price = decodeFirstUint(result);
    if (price <= 0n) return { status: 'failed', reason: 'oracle price() returned zero' };
    return { status: 'passed', price: price.toString() };
  } catch (err) {
    return { status: 'failed', reason: err.message };
  }
}

async function gql(query, variables = {}) {
  const res = await fetch(MORPHO_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.[0]?.message ?? `Morpho GraphQL ${res.status}`);
  }
  return json.data;
}

async function fetchMarkets(limit) {
  const query = `
    query($first: Int!, $chainId: Int!) {
      markets(
        first: $first
        orderBy: BorrowAssetsUsd
        orderDirection: Desc
        where: { chainId_in: [$chainId], listed: true }
      ) {
        items {
          marketId
          lltv
          loanAsset { address symbol decimals }
          collateralAsset { address symbol decimals }
          oracle { address }
          irmAddress
          state { borrowAssets borrowAssetsUsd supplyAssetsUsd }
        }
      }
    }
  `;
  const data = await gql(query, { first: limit, chainId: CHAIN.chainId });
  return data.markets.items;
}

async function fetchMarketsByIds(marketIds) {
  if (!marketIds.length) return [];
  const query = `
    query($first: Int!, $chainId: Int!, $marketIds: [String!]) {
      markets(
        first: $first
        orderBy: BorrowAssetsUsd
        orderDirection: Desc
        where: { chainId_in: [$chainId], uniqueKey_in: $marketIds }
      ) {
        items {
          marketId
          lltv
          loanAsset { address symbol decimals }
          collateralAsset { address symbol decimals }
          oracle { address }
          irmAddress
          state { borrowAssets borrowAssetsUsd supplyAssetsUsd }
        }
      }
    }
  `;
  const data = await gql(query, {
    first: Math.max(marketIds.length, 1),
    chainId: CHAIN.chainId,
    marketIds,
  });
  return data.markets.items;
}

async function fetchPositions(marketId, limit, skip = 0) {
  const query = `
    query($first: Int!, $skip: Int!, $marketId: String!) {
      marketPositions(
        first: $first
        skip: $skip
        orderBy: BorrowShares
        orderDirection: Desc
        where: { marketUniqueKey_in: [$marketId] }
      ) {
        items {
          user { address }
          state {
            borrowAssets
            borrowAssetsUsd
            collateral
            collateralUsd
            supplyAssets
            supplyAssetsUsd
          }
        }
      }
    }
  `;
  const data = await gql(query, { first: limit, skip, marketId });
  return data.marketPositions.items;
}

async function fetchPositionPages(marketId, pageSize, pageCount) {
  const positions = [];
  for (let page = 0; page < pageCount; page += 1) {
    const pageItems = await fetchPositions(marketId, pageSize, page * pageSize);
    positions.push(...pageItems);
    if (pageItems.length < pageSize) break;
  }
  return positions;
}

function liquidationIncentive(lltv) {
  // Morpho Blue's liquidation incentive is bounded. This conservative estimate
  // follows the published shape and caps the bonus at 15%.
  const cursor = envNumber('MORPHO_LIQ_LIF_CURSOR', 0.3);
  const maxLif = envNumber('MORPHO_LIQ_MAX_LIF', 1.15);
  const lif = 1 / (1 - cursor * (1 - lltv));
  return Math.min(maxLif, lif);
}

function estimate(position, market, gasUsd) {
  const borrowUsd = Number(position.state.borrowAssetsUsd ?? 0);
  const collateralUsd = Number(position.state.collateralUsd ?? 0);
  const lltv = Number(BigInt(market.lltv)) / WAD;
  const ltv = collateralUsd > 0 ? borrowUsd / collateralUsd : Infinity;
  const liquidatable = ltv >= lltv && borrowUsd > 0 && collateralUsd > 0;
  const lif = liquidationIncentive(lltv);
  const maxRepayByCollateralUsd = collateralUsd / lif;
  const repayUsd = Math.min(borrowUsd, maxRepayByCollateralUsd);
  const grossProfitUsd = liquidatable ? repayUsd * (lif - 1) : 0;
  const netProfitUsd = grossProfitUsd - gasUsd;
  const returnOnRepayPct = repayUsd > 0 ? (netProfitUsd / repayUsd) * 100 : 0;
  const liquidationGapUsd =
    Number.isFinite(ltv) && collateralUsd > 0 ? Math.max(0, collateralUsd * lltv - borrowUsd) : 0;
  const distanceToLiquidationPct =
    Number.isFinite(ltv) && lltv > 0 ? Math.max(0, ((lltv - ltv) / lltv) * 100) : 0;
  const riskCategory = liquidatable
    ? 'liquidatable'
    : ltv >= lltv * 0.98
      ? 'near-liquidation'
      : ltv >= lltv * 0.95
        ? 'watch'
        : 'healthy';
  return {
    loanAsset: market.loanAsset.address,
    loanSymbol: market.loanAsset.symbol,
    collateralAsset: market.collateralAsset.address,
    collateralSymbol: market.collateralAsset.symbol,
    borrowUsd,
    collateralUsd,
    lltv,
    ltv,
    liquidatable,
    liquidationIncentive: lif,
    repayUsd,
    grossProfitUsd,
    gasUsd,
    netProfitUsd,
    returnOnRepayPct,
    liquidationGapUsd,
    distanceToLiquidationPct,
    riskCategory,
  };
}

function gateFor(estimate, minNetProfitUsd, minReturnPct) {
  if (!estimate.liquidatable) {
    return {
      status: 'block',
      reason: `position LTV ${estimate.ltv.toFixed(6)} is below LLTV ${estimate.lltv.toFixed(6)}`,
    };
  }
  if (estimate.netProfitUsd < minNetProfitUsd) {
    return {
      status: 'block',
      reason: `estimated net profit ${estimate.netProfitUsd.toFixed(4)} USD below ${minNetProfitUsd} USD`,
    };
  }
  if (estimate.returnOnRepayPct < minReturnPct) {
    return {
      status: 'block',
      reason: `return on repay ${estimate.returnOnRepayPct.toFixed(4)}% below ${minReturnPct}%`,
    };
  }
  return {
    status: 'pass',
    reason: 'LTV, estimated net profit, and return-on-repay gates passed',
  };
}

function candidateId(market, user) {
  return [
    'morpho-blue-liq',
    CHAIN.shortName,
    market.marketId.slice(2, 8).toLowerCase(),
    user.slice(2, 8).toLowerCase(),
    market.loanAsset.symbol.toLowerCase(),
    market.collateralAsset.symbol.toLowerCase(),
  ].join('-');
}

async function main() {
  loadDotenv();
  selectChainProfile();

  const marketLimit = Math.floor(envNumber('MORPHO_LIQ_MARKET_LIMIT', 8));
  const positionLimit = Math.floor(envNumber('MORPHO_LIQ_POSITION_LIMIT', 20));
  const positionPages = Math.floor(envNumber('MORPHO_LIQ_POSITION_PAGES', 1));
  const targetMarketIds = envList('MORPHO_LIQ_MARKET_IDS');
  const gasUsd = envNumber('MORPHO_LIQ_GAS_USD', 20);
  const minNetProfitUsd = envNumber('MORPHO_LIQ_MIN_NET_PROFIT_USD', 5);
  const minReturnPct = envNumber('MORPHO_LIQ_MIN_RETURN_ON_REPAY_PCT', 0.1);
  const rpcEnvVar = chainRpcEnvVar();
  const rpcUrl = rpcEnvVar ? process.env[rpcEnvVar] : null;

  console.error(
    `[morpho-liq] chain=${CHAIN.name} markets=${targetMarketIds.length ? targetMarketIds.length : marketLimit} positions=${positionLimit} pages=${positionPages} targeted=${targetMarketIds.length > 0}`,
  );
  const markets = targetMarketIds.length
    ? await fetchMarketsByIds(targetMarketIds)
    : await fetchMarkets(marketLimit);
  const missingMarketIds = targetMarketIds.filter(
    (marketId) => !markets.some((market) => market.marketId.toLowerCase() === marketId.toLowerCase()),
  );
  const candidates = [];
  for (const market of markets) {
    const oracleCheck = await checkOraclePrice(rpcUrl, market.oracle.address);
    const positions = await fetchPositionPages(market.marketId, positionLimit, positionPages);
    for (const position of positions) {
      const user = position.user.address;
      const best = estimate(position, market, gasUsd);
      let gate = gateFor(best, minNetProfitUsd, minReturnPct);
      if (gate.status === 'pass' && oracleCheck.status !== 'passed') {
        gate = {
          status: 'block',
          reason: `on-chain oracle price check ${oracleCheck.status}: ${oracleCheck.reason ?? 'price unavailable'}`,
        };
      }
      if (best.borrowUsd <= 0 && best.collateralUsd <= 0) continue;
      candidates.push({
        id: candidateId(market, user),
        chain: CHAIN.name,
        strategyType: 'morpho-blue-liquidation-arbitrage',
        isPureArbitrage: true,
        noCexRequired: true,
        user,
        marketId: market.marketId,
        marketParams: {
          loanToken: market.loanAsset.address,
          collateralToken: market.collateralAsset.address,
          oracle: market.oracle.address,
          irm: market.irmAddress,
          lltv: market.lltv,
        },
        account: {
          borrowAssets: String(position.state.borrowAssets ?? '0'),
          borrowAssetsUsd: Number(position.state.borrowAssetsUsd ?? 0),
          collateral: String(position.state.collateral ?? '0'),
          collateralUsd: Number(position.state.collateralUsd ?? 0),
          ltv: best.ltv,
          lltv: best.lltv,
          liquidatable: best.liquidatable,
          liquidationGapUsd: best.liquidationGapUsd,
          distanceToLiquidationPct: best.distanceToLiquidationPct,
          riskCategory: best.riskCategory,
        },
        bestEstimate: best,
        oracleCheck,
        gate: {
          ...gate,
          minNetProfitUsd,
          minReturnOnRepayPct: minReturnPct,
        },
        liveInterface: {
          status: gate.status === 'pass' ? 'morpho-liquidation-plan-ready-needs-fork-simulation' : 'blocked-by-morpho-liquidation-gate',
          requiresCex: false,
          userFlow: 'connect wallet, optionally flash-borrow loan asset, call Morpho liquidate, unwind seized collateral, and settle profit',
          requiredContracts: {
            morpho: CHAIN.morpho,
          },
          selectors: {
            liquidate: '0xd8eabcb8',
          },
          productionStatus: 'not-enabled-until-morpho-liquidation-adapter-and-fork-simulation-pass',
        },
      });
    }
  }

  candidates.sort((a, b) => {
    const ag = a.gate.status === 'pass' ? 1_000_000 : 0;
    const bg = b.gate.status === 'pass' ? 1_000_000 : 0;
    return bg + b.bestEstimate.netProfitUsd - (ag + a.bestEstimate.netProfitUsd);
  });
  const passing = candidates.filter((candidate) => candidate.gate.status === 'pass');
  const nearLiquidation = candidates.filter((candidate) => candidate.bestEstimate.riskCategory === 'near-liquidation');
  const watch = candidates.filter((candidate) => candidate.bestEstimate.riskCategory === 'watch');
  const liquidatable = candidates.filter((candidate) => candidate.bestEstimate.riskCategory === 'liquidatable');
  const highestLtv = candidates.reduce(
    (best, candidate) => Math.max(best, Number.isFinite(candidate.account.ltv) ? candidate.account.ltv : 0),
    0,
  );
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      chain: CHAIN,
      morpho: CHAIN.morpho,
      api: MORPHO_API,
      officialReferences: [
        'https://docs.morpho.org/',
        'https://docs.morpho.org/get-started/resources/contracts/morpho/',
        'https://docs.morpho.org/tools/offchain/api/morpho/',
      ],
    },
    methodology: {
      classification: 'pure-on-chain-morpho-blue-liquidation-arbitrage-scan',
      isPureArbitrage: true,
      noCexRequired: true,
      marketLimit,
      positionLimit,
      positionPages,
      targetMarketIds,
      missingMarketIds,
      oracleCheck: {
        enabled: process.env.MORPHO_LIQ_SKIP_ORACLE_CHECK !== '1',
        rpcEnvVar,
        requirement:
          'candidate gate can pass only when market oracle price() succeeds on-chain for the selected fork/current block',
      },
      accountDiscovery: 'Morpho official GraphQL marketPositions ordered by borrow shares',
      gasAssumption: {
        gasUsd,
      },
      thresholds: {
        ltvAtOrAboveLltv: true,
        minNetProfitUsd,
        minReturnOnRepayPct: minReturnPct,
      },
      caveats: [
        'This is a current-state liquidation scan, not a long-horizon APY backtest.',
        'Market and position discovery uses Morpho official GraphQL data; live execution must re-read Morpho state on-chain.',
        'Liquidation incentive is estimated conservatively and must be recomputed from audited Morpho libraries before production.',
        'A passing candidate must be simulated on a fork immediately before execution.',
        'Markets whose oracle price() reverts are blocked even if GraphQL position data suggests profitability.',
        'Production execution requires a Morpho liquidation adapter, flash-loan or prefunded loan asset handling, and collateral unwind logic.',
      ],
    },
    summary: {
      marketCount: markets.length,
      missingMarketCount: missingMarketIds.length,
      candidateCount: candidates.length,
      passingCount: passing.length,
      liquidatableCount: liquidatable.length,
      nearLiquidationCount: nearLiquidation.length,
      watchCount: watch.length,
      highestLtv,
      requestedPassingCount: 5,
      status:
        passing.length >= 5
          ? 'found-at-least-five-passing-morpho-blue-liquidation-opportunities'
          : 'did-not-find-five-passing-morpho-blue-liquidation-opportunities',
    },
    candidates,
  };
  await mkdir(dataDir, { recursive: true });
  const outJson = resolve(dataDir, `morpho-blue-liquidation-candidates-${CHAIN.shortName}.json`);
  await writeFile(outJson, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    `morphoBlueLiquidations=${artifact.summary.status} markets=${markets.length} candidates=${candidates.length} passing=${passing.length} liquidatable=${liquidatable.length} near=${nearLiquidation.length} watch=${watch.length} highestLtv=${highestLtv.toFixed(6)} artifact=${outJson}`,
  );
  for (const candidate of candidates.slice(0, 10)) {
    console.log(
      `${candidate.id} gate=${candidate.gate.status} ltv=${candidate.account.ltv.toFixed(4)} lltv=${candidate.account.lltv.toFixed(4)} netUsd=${candidate.bestEstimate.netProfitUsd.toFixed(4)} reason=${candidate.gate.reason}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
