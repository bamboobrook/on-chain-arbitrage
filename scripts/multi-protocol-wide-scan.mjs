#!/usr/bin/env node
/**
 * Wide sparse scan: scan 12 months for liquidation events across multiple
 * protocols. Uses 5000-block steps with 10-block windows to stay within
 * Alchemy free-tier eth_getLogs limit.
 *
 * Finds active periods for Morpho Blue, Compound V3, and Aave V3 across
 * a 12-month window, then outputs per-protocol event counts by month.
 *
 * ~1500 API calls per protocol at 5000-step. 3 protocols = 4500 calls.
 * At 5/sec = ~15 min per protocol, ~45 min total.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const RPC = process.env.RPC_ETHEREUM_URL;
const FROM = 18000000;
const TO = 25500000;
const STEP = 5000;

const PROTOCOLS = {
  'aave-v3': {
    address: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    topic: '0xe413a321e8681d831f4dbccbca790d2952b56fcd9a960a0903afdd5b3a91e8e0',
    name: 'LiquidationCall',
  },
  'morpho-blue': {
    address: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF2C9895546ED',
    topic: '0x71e8c99cdd5ea94ecba5c8c4b33cd934379363b76ae133f92e50f90fe7daef83',
    name: 'Liquidate',
  },
  'compound-v3': {
    address: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
    topic: '0x6fc3120d165d2435451660873e5837d69b67850ab65c218aa90b370e4623283e',
    name: 'AbsorbCollateral',
  },
};

async function getLogs(address, topic, from, to) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'eth_getLogs',
          params: [{ address, topics: [topic], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }],
        }),
        signal: AbortSignal.timeout(8000),
      });
      const json = await res.json();
      if (json.error) {
        if (json.error.message?.includes('rate') || json.error.message?.includes('block')) {
          if (i < 2) { await new Promise(r => setTimeout(r, 1500)); continue; }
        }
        return [];
      }
      return json.result || [];
    } catch { if (i < 2) { await new Promise(r => setTimeout(r, 500)); continue; } return []; }
  }
  return [];
}

async function scanProtocol(key, config) {
  console.log(`\n=== scanning ${key} (${config.name}) ===`);
  const monthlyCounts = {};
  const activeWindows = [];
  let totalEvents = 0;
  let scanned = 0;
  const totalWindows = Math.ceil((TO - FROM) / STEP);

  for (let block = FROM; block <= TO; block += STEP) {
    const endBlock = Math.min(block + 9, TO);
    const logs = await getLogs(config.address, config.topic, block, endBlock);
    if (logs.length > 0) {
      activeWindows.push({ from: block, to: endBlock, count: logs.length });
      totalEvents += logs.length;
      // Track by month
      for (const log of logs) {
        const bn = parseInt(log.blockNumber, 16);
        // Approximate month from block number (7200 blocks/day, 30 days/month)
        const monthBlock = Math.floor((bn - FROM) / (7200 * 30));
        monthlyCounts[monthBlock] = (monthlyCounts[monthBlock] || 0) + 1;
      }
    }
    scanned++;
    if (scanned % 100 === 0) {
      console.log(`  ${key}: ${scanned}/${totalWindows} windows, ${totalEvents} events, ${activeWindows.length} active windows`);
    }
    // Rate limit
    if (scanned % 5 === 0) await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n  ${key} DONE: ${totalEvents} events in ${activeWindows.length} active windows`);
  console.log(`  monthly distribution (by block-month):`);
  for (const [m, c] of Object.entries(monthlyCounts).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
    console.log(`    month ${parseInt(m) + 1}: ${c} events`);
  }

  // If active windows found, do a refinement scan around them
  if (activeWindows.length > 0 && activeWindows.length < 200) {
    console.log(`  refining ${activeWindows.length} active regions...`);
    const refinedLogs = [];
    for (const w of activeWindows) {
      // Scan the full 5000-block gap
      for (let b = Math.max(FROM, w.from - STEP + 10); b <= Math.min(TO, w.to + STEP); b += 10) {
        const eb = Math.min(b + 9, TO);
        const logs = await getLogs(config.address, config.topic, b, eb);
        if (logs.length > 0) refinedLogs.push(...logs);
        if (b % 500 === 0) await new Promise(r => setTimeout(r, 100));
      }
    }
    // Deduplicate
    const seen = new Set();
    const unique = refinedLogs.filter(l => {
      const k = `${l.blockNumber}:${l.logIndex}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    });
    console.log(`  refined: ${unique.length} unique events`);
    mkdirSync('data/backtest-v2', { recursive: true });
    writeFileSync(`data/backtest-v2/${key}-wide-scan-events.json`, JSON.stringify(unique));
    return { totalEvents, uniqueEvents: unique.length, activeWindows: activeWindows.length, monthlyCounts };
  }

  return { totalEvents, uniqueEvents: 0, activeWindows: activeWindows.length, monthlyCounts };
}

async function main() {
  console.log(`=== Wide sparse scan: blocks ${FROM}-${TO} step ${STEP} ===`);
  const results = {};
  for (const [key, config] of Object.entries(PROTOCOLS)) {
    results[key] = await scanProtocol(key, config);
  }
  console.log('\n=== SUMMARY ===');
  for (const [key, r] of Object.entries(results)) {
    console.log(`  ${key}: ${r.totalEvents} sparse events, ${r.uniqueEvents} refined, ${r.activeWindows} active windows`);
  }
  writeFileSync('data/backtest-v2/wide-scan-summary.json', JSON.stringify(results, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
