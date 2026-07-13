#!/usr/bin/env node
/**
 * Extended Aave V3 liquidation event scan — 12 month window.
 * Uses 10-block chunks (Alchemy free-tier max) with 2000-block sparse step.
 * ~3750 API calls at 5/sec ≈ 12 min.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const RPC = process.env.RPC_ETHEREUM_URL;
const POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const TOPIC = '0xe413a321e8681d831f4dbccbca790d2952b56fcd9a960a0903afdd5b3a91e8e0';
const FROM = 18000000; // ~12 months ago
const TO = 25500000;   // current
const STEP = 2000;

async function getLogs(from, to) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs',
          params: [{ address: POOL, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: [TOPIC] }] }),
        signal: AbortSignal.timeout(8000),
      });
      const json = await res.json();
      if (json.error) { if (i < 2) { await new Promise(r => setTimeout(r, 1000)); continue; } return []; }
      return json.result || [];
    } catch { if (i < 2) { await new Promise(r => setTimeout(r, 500)); continue; } return []; }
  }
  return [];
}

async function main() {
  console.log(`=== Aave V3 extended scan: blocks ${FROM}-${TO} (step ${STEP}) ===`);
  const allLogs = [];
  const activeWindows = [];
  let scanned = 0;
  const totalWindows = Math.ceil((TO - FROM) / STEP);

  // Phase 1: sparse scan
  for (let block = FROM; block <= TO; block += STEP) {
    const endBlock = Math.min(block + 9, TO);
    const logs = await getLogs(block, endBlock);
    if (logs.length > 0) {
      activeWindows.push({ from: block, to: endBlock });
      allLogs.push(...logs);
    }
    scanned++;
    if (scanned % 100 === 0) console.log(`  phase1: ${scanned}/${totalWindows} windows, ${allLogs.length} events`);
    // Rate limit: 5 req/sec → 200ms between calls
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`phase1 done: ${activeWindows.length} active windows, ${allLogs.length} events`);

  // Phase 2: refine around active windows
  for (const w of activeWindows) {
    // scan backward from active window to previous step
    for (let b = Math.max(FROM, w.from - STEP + 10); b < w.from; b += 10) {
      const logs = await getLogs(b, Math.min(b + 9, w.from - 1));
      if (logs.length > 0) allLogs.push(...logs);
      await new Promise(r => setTimeout(r, 200));
    }
    // scan forward from active window to next step
    for (let b = w.to + 1; b <= Math.min(TO, w.to + STEP); b += 10) {
      const logs = await getLogs(b, Math.min(b + 9, TO));
      if (logs.length > 0) allLogs.push(...logs);
      await new Promise(r => setTimeout(r, 200));
    }
  }
  // Deduplicate
  const seen = new Set();
  const unique = allLogs.filter(l => {
    const k = `${l.blockNumber}:${l.logIndex}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  console.log(`\n=== extended scan complete ===`);
  console.log(`unique LiquidationCall events: ${unique.length}`);
  if (unique.length > 0) {
    const blocks = unique.map(l => parseInt(l.blockNumber, 16));
    console.log(`block range: ${Math.min(...blocks)} - ${Math.max(...blocks)}`);
    console.log(`span: ${((Math.max(...blocks) - Math.min(...blocks)) / 7200).toFixed(1)} days`);
  }
  mkdirSync('data/backtest-v2', { recursive: true });
  writeFileSync('data/backtest-v2/aave-v3-extended-events-ethereum.json', JSON.stringify(unique));
  console.log(`saved ${unique.length} events to data/backtest-v2/aave-v3-extended-events-ethereum.json`);
}
main().catch(e => { console.error(e); process.exit(1); });
