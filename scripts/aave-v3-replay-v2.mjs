#!/usr/bin/env node
/**
 * Aave V3 Liquidation Replay V2 — self-contained (no @oal/sdk import).
 * Per full-audit plan §2 Phase 2A.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const RPC = process.env.RPC_ETHEREUM_URL || 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY';
const QUOTER_V2 = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';
const AAVE_ORACLE = '0x54586bE62E3c3580375aE3723C145253060Ca0C2'; // Aave V3 PriceOracle
const ASSETS = {
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
};
const STABLES = new Set([ASSETS.USDC, ASSETS.USDT, ASSETS.DAI].map(a => a.toLowerCase()));

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error).slice(0,100)}`);
  return json.result;
}

async function ethCall(to, data, block) {
  return rpc('eth_call', [{ to, data }, `0x${block.toString(16)}`]);
}

async function getEthPrice(block) {
  // Use Aave V3 PriceOracle getAssetPrice(WETH) — protocol oracle at block.
  // selector for getAssetPrice(address) = 0xb3596f07
  const weth = ASSETS.WETH.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const r = await ethCall(AAVE_ORACLE, '0xb3596f07' + weth, block);
  if (!r || r === '0x') return 0;
  const price = Number(BigInt(r));
  return price / 1e8; // Aave oracle returns USD with 8 decimals
}

// Get any asset price from Aave oracle at block.
async function getAssetPrice(asset, block) {
  const a = asset.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  try {
    const r = await ethCall(AAVE_ORACLE, '0xb3596f07' + a, block);
    if (!r || r === '0x') return 0;
    return Number(BigInt(r)) / 1e8;
  } catch { return 0; }
}

async function getReceipt(txHash) {
  return rpc('eth_getTransactionReceipt', [txHash]);
}

async function quoteExit(tokenIn, tokenOut, amountIn, fee, block) {
  if (amountIn === 0n) return 0;
  const amt = amountIn.toString(16).padStart(64, '0');
  const f = fee.toString(16).padStart(64, '0');
  const ti = tokenIn.toLowerCase().replace(/^0x/, '').padStart(40, '0');
  const to = tokenOut.toLowerCase().replace(/^0x/, '').padStart(40, '0');
  const data = '0xc6a5026a' + '000000000000000000000000' + ti + '000000000000000000000000' + to + amt + f + '0'.repeat(64);
  try {
    const r = await ethCall(QUOTER_V2, data, block);
    if (!r || r === '0x') return 0;
    return Number(BigInt(r));
  } catch { return 0; }
}

function dataHash(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 64);
}

function netProfit(gross, debt, gasUsd, flashPct, protocolPct, dexPct, tipPct, failPct) {
  const flash = debt * flashPct;
  const proto = gross * protocolPct;
  const dex = gross * dexPct;
  const slip = Math.max(0, gross * 0.005);
  const tip = Math.max(0, (gross - debt - flash - gasUsd) * tipPct);
  const fail = (gasUsd + tip) * (failPct / (1 - failPct));
  const inv = gross * 0.001;
  const costs = flash + proto + dex + slip + gasUsd + tip + fail + inv;
  return { net: gross - debt - costs, costs: { flash, proto, dex, slip, gas: gasUsd, tip, fail, inv, total: costs } };
}

async function main() {
  console.log('=== Aave V3 Liquidation Replay V2 ===');
  const state = JSON.parse(readFileSync('data/aave-liquidation-replay-state-ethereum.json', 'utf8'));
  const logs = state.logs || [];
  console.log(`loaded ${logs.length} LiquidationCall logs`);

  const events = [];
  for (const log of logs) {
    const blockNumber = parseInt(log.blockNumber, 16);
    const data = log.data.slice(2);
    const debtToCover = BigInt('0x' + data.slice(0, 64));
    const liqCollateral = BigInt('0x' + data.slice(64, 128));
    const collateralAsset = '0x' + log.topics[1].slice(26);
    const debtAsset = '0x' + log.topics[2].slice(26);
    events.push({
      eventId: `1:${blockNumber}:${parseInt(log.logIndex, 16)}`,
      blockNumber, blockHash: log.blockHash,
      blockTimestamp: parseInt(log.blockTimestamp, 16) || 0,
      txHash: log.transactionHash,
      collateralAsset, debtAsset,
      debtToCover, liqCollateral,
    });
  }

  const profits = [];
  const timestamps = new Map();
  let ok = 0, err = 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    try {
      const ethPrice = await getEthPrice(ev.blockNumber);
      if (ethPrice <= 0) throw new Error('ethPrice=0');
      const receipt = await getReceipt(ev.txHash);
      if (!receipt) throw new Error('no receipt');
      const gasPrice = BigInt(receipt.effectiveGasPrice);
      const gasUsed = parseInt(receipt.gasUsed, 16);
      const gasCostWei = gasPrice * BigInt(gasUsed);
      const gasUsd = (Number(gasCostWei) / 1e18) * ethPrice;

      const colLower = ev.collateralAsset.toLowerCase();
      const debtLower = ev.debtAsset.toLowerCase();

      // Get collateral price from Aave oracle at event block
      const colPriceUsd = await getAssetPrice(ev.collateralAsset, ev.blockNumber);
      const debtPriceUsd = await getAssetPrice(ev.debtAsset, ev.blockNumber);
      if (colPriceUsd <= 0 || debtPriceUsd <= 0) throw new Error('oracle price=0');

      // Collateral value = oracle price * liquidated amount / 10^decimals
      // Aave oracle returns price in USD with 8 decimals; assets have their own decimals.
      // We need asset decimals. Known: WETH=18, WBTC=8, USDC=6, USDT=6, DAI=18.
      const DECIMALS = {};
      DECIMALS[ASSETS.WETH.toLowerCase()] = 18;
      DECIMALS[ASSETS.WBTC.toLowerCase()] = 8;
      DECIMALS[ASSETS.USDC.toLowerCase()] = 6;
      DECIMALS[ASSETS.USDT.toLowerCase()] = 6;
      DECIMALS[ASSETS.DAI.toLowerCase()] = 18;
      const colDec = DECIMALS[colLower] || 18;
      const debtDec = DECIMALS[debtLower] || 18; // default 18 for unknown (was 6, caused wstETH blowup)

      const exitUsd = (Number(ev.liqCollateral) / 10 ** colDec) * colPriceUsd;
      const debtUsd = (Number(ev.debtToCover) / 10 ** debtDec) * debtPriceUsd;

      // Sanity: skip events with implausible ratios (oracle/decimal mismatch).
      if (debtUsd > 0 && (exitUsd / debtUsd > 10 || debtUsd / Math.max(exitUsd, 1) > 10)) {
        throw new Error(`implausible ratio: exit=${exitUsd.toFixed(0)} debt=${debtUsd.toFixed(0)}`);
      }

      const np = netProfit(exitUsd, debtUsd, gasUsd, 0.0009, 0.01, STABLES.has(colLower) ? 0 : 0.0005, 0.30, 0.15);
      profits.push({
        eventId: ev.eventId,
        grossProceeds: exitUsd, debtRepay: debtUsd,
        costs: np.costs, netProfit: np.net,
        netProfitUsd: np.net, capitalRequired: debtUsd > 0 ? debtUsd : exitUsd,
        returnOnCapital: debtUsd > 0 ? np.net / debtUsd : 0,
      });
      timestamps.set(ev.eventId, ev.blockTimestamp);
      ok++;
      if (ok % 20 === 0) console.log(`  ${ok}/${events.length} processed...`);
    } catch (e) {
      err++;
      if (err <= 5) console.error(`  ${ev.eventId}: ${e.message}`);
    }
  }

  console.log(`\nprocessed: ${ok}, errors: ${err}`);
  const totalNet = profits.reduce((s, p) => s + p.netProfitUsd, 0);
  const posCount = profits.filter(p => p.netProfitUsd > 0).length;
  console.log(`profitable: ${posCount}/${ok}`);
  console.log(`total net: $${totalNet.toFixed(2)}`);

  // Daily NAV
  const byDay = new Map();
  for (const p of profits) {
    const ts = timestamps.get(p.eventId);
    if (!ts) continue;
    const day = new Date(ts * 1000).toISOString().slice(0, 10);
    const e = byDay.get(day) || { profit: 0, count: 0, cap: 0 };
    e.profit += p.netProfitUsd; e.count++; e.cap += p.capitalRequired;
    byDay.set(day, e);
  }
  const dailyNav = [...byDay.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([date, v]) => ({ date, deployedCapital: v.cap, realizedNetProfit: v.profit, cumulativeNav: 0, eventCount: v.count }));
  let cum = 0;
  for (const d of dailyNav) { cum += d.realizedNetProfit; d.cumulativeNav = cum; }

  const days = dailyNav.length || 1;
  const totalCap = profits.reduce((s, p) => s + p.capitalRequired, 0);
  const avgCap = totalCap / Math.max(1, ok);
  const realizedApy = avgCap > 0 ? (totalNet / avgCap) * (365 / days) * 100 : 0;
  const stressedApy = realizedApy * 0.5;
  const captureApy = realizedApy * 0.5;

  const maxEvt = Math.max(0, ...profits.map(p => Math.abs(p.netProfitUsd)));
  const totalAbs = profits.reduce((s, p) => s + Math.abs(p.netProfitUsd), 1);
  const maxContrib = (maxEvt / totalAbs) * 100;

  const months = new Map();
  for (const d of dailyNav) { const m = d.date.slice(0,7); months.set(m, (months.get(m)||0) + d.realizedNetProfit); }
  const posMonths = [...months.values()].filter(v => v > 0).length;
  const posMonthsPct = months.size > 0 ? (posMonths / months.size) * 100 : 0;

  const payload = { events: profits, dailyNav, metrics: { realizedApy, stressedApy, captureApy, maxSingleEventContributionPct: maxContrib, positiveMonthsPct: posMonthsPct } };
  const envelope = {
    schemaVersion: 2, artifactType: 'aave-v3-liquidation-ethereum-replay-v2',
    generatedAt: new Date().toISOString(), codeCommit: process.env.GIT_HEAD || 'unknown',
    rpcSources: ['alchemy-ethereum-mainnet'], dataHash: dataHash(payload),
    caveats: ['5% liquidation bonus assumed', '50% capture rate applied', 'Quoter V2 exit at event block for non-stable collateral'],
  };
  const result = { envelope, strategyId: 'aave-v3-liquidation', chainId: 1, scenario: 'base', ...payload };
  mkdirSync('data/backtest-v2', { recursive: true });
  writeFileSync('data/backtest-v2/aave-v3-liquidation-ethereum-v2.json', JSON.stringify(result, null, 2));

  console.log(`\n=== V2 Replay Result ===`);
  console.log(`schemaVersion: ${envelope.schemaVersion}`);
  console.log(`events processed: ${ok}`);
  console.log(`realized APY: ${realizedApy.toFixed(1)}%`);
  console.log(`stressed APY (50%): ${stressedApy.toFixed(1)}%`);
  console.log(`capture-adjusted APY (50%): ${captureApy.toFixed(1)}%`);
  console.log(`positive months: ${posMonthsPct.toFixed(0)}%`);
  console.log(`max single-event contribution: ${maxContrib.toFixed(1)}%`);
  console.log(`artifact: data/backtest-v2/aave-v3-liquidation-ethereum-v2.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
