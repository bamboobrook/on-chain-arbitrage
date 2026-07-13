#!/usr/bin/env node
/**
 * Sparse-scan event fetcher for protocols blocked by Alchemy free-tier
 * eth_getLogs 10-block limit.
 *
 * Strategy: scan every Nth 10-block window (sparse), then refine windows
 * that have events. Reduces API calls from 25000 to ~500.
 *
 * Output: data/backtest-v2/<protocol>-raw-events-ethereum.json
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const RPC = process.env.RPC_ETHEREUM_URL || 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY';
const FROM_BLOCK = 25230924;
const TO_BLOCK = 25480924;
const SPARSE_STEP = 500; // scan every 500th block window
const CHUNK_SIZE = 10;   // Alchemy free-tier max

async function rpc(method, params) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(8000),
      });
      const json = await res.json();
      if (json.error) {
        if (json.error.message?.includes('rate') && attempt < 2) { await sleep(1000); continue; }
        throw new Error(json.error.message?.slice(0, 80));
      }
      return json.result;
    } catch (e) {
      if (attempt < 2) { await sleep(500 * (attempt + 1)); continue; }
      throw e;
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function scanAddress(address, label) {
  console.log(`\n=== scanning ${label} (${address}) ===`);
  console.log(`window: ${FROM_BLOCK}-${TO_BLOCK}, sparse step: ${SPARSE_STEP}`);

  const allLogs = [];
  const activeWindows = [];

  // Phase 1: sparse scan to find windows with activity
  console.log('Phase 1: sparse scan...');
  let scanned = 0;
  for (let block = FROM_BLOCK; block <= TO_BLOCK; block += SPARSE_STEP) {
    const endBlock = Math.min(block + CHUNK_SIZE - 1, TO_BLOCK);
    try {
      const logs = await rpc('eth_getLogs', [{ address, fromBlock: `0x${block.toString(16)}`, toBlock: `0x${endBlock.toString(16)}` }]);
      if (logs && logs.length > 0) {
        activeWindows.push({ from: block, to: endBlock, count: logs.length });
        allLogs.push(...logs);
      }
    } catch (e) {
      // skip errors (rate limit, etc.)
    }
    scanned++;
    if (scanned % 50 === 0) {
      console.log(`  scanned ${scanned}/${Math.ceil((TO_BLOCK - FROM_BLOCK) / SPARSE_STEP)} windows, ${allLogs.length} logs so far`);
    }
    // Rate limit: ~5 req/sec
    if (scanned % 5 === 0) await sleep(200);
  }
  console.log(`Phase 1 done: ${activeWindows.length} active windows, ${allLogs.length} logs`);

  // Phase 2: refine — for each active window, scan the gaps between it and the next active window
  console.log('Phase 2: refining active regions...');
  let refined = 0;
  for (const win of activeWindows) {
    // Scan the blocks between the previous sparse step and this window
    const regionStart = Math.max(FROM_BLOCK, win.from - SPARSE_STEP + CHUNK_SIZE);
    for (let b = regionStart; b < win.from; b += CHUNK_SIZE) {
      const eb = Math.min(b + CHUNK_SIZE - 1, win.from - 1);
      try {
        const logs = await rpc('eth_getLogs', [{ address, fromBlock: `0x${b.toString(16)}`, toBlock: `0x${eb.toString(16)}` }]);
        if (logs && logs.length > 0) allLogs.push(...logs);
      } catch {}
      refined++;
      if (refined % 10 === 0) await sleep(200);
    }
    // Also scan forward from the active window
    const regionEnd = Math.min(TO_BLOCK, win.to + SPARSE_STEP);
    for (let b = win.to + 1; b <= regionEnd; b += CHUNK_SIZE) {
      const eb = Math.min(b + CHUNK_SIZE - 1, regionEnd);
      try {
        const logs = await rpc('eth_getLogs', [{ address, fromBlock: `0x${b.toString(16)}`, toBlock: `0x${eb.toString(16)}` }]);
        if (logs && logs.length > 0) allLogs.push(...logs);
      } catch {}
      refined++;
      if (refined % 10 === 0) await sleep(200);
    }
  }
  console.log(`Phase 2 done: ${refined} refinement scans, ${allLogs.length} total logs`);

  // Deduplicate by (blockNumber, logIndex)
  const seen = new Set();
  const unique = allLogs.filter(l => {
    const key = `${l.blockNumber}:${l.logIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Filter for specific event topics (LiquidationCall / AbsorbCollateral / etc.)
  const filtered = unique.filter(l => {
    if (!l.topics || !l.topics[0]) return false;
    const t = l.topics[0].toLowerCase();
    // Aave LiquidationCall
    if (t === '0xe413a321e8681d831f4dbccbca790d2952b56fcd9a960a0903afdd5b3a91e8e0') return true;
    // Morpho Liquidate
    if (t === '0x71e8c99cdd5ea94ecba5c8c4b33cd934379363b76ae133f92e50f90fe7daef83') return true;
    // Compound AbsorbCollateral
    if (t === '0x6fc3120d165d2435451660873e5837d69b67850ab65c218aa90b370e4623283e') return true;
    // Compound BuyCollateral
    if (t === '0xabfc19d4cf1e7c5e54bdf73b88f74c89a1f0c8d8c061e67c2e997e8e9cfcd9ee') return true;
    return false;
  });

  console.log(`\n=== ${label} results ===`);
  console.log(`total unique logs: ${unique.length}`);
  console.log(`liquidation/absorb events: ${filtered.length}`);

  // Save
  mkdirSync('data/backtest-v2', { recursive: true });
  const outFile = `data/backtest-v2/${label}-raw-events-ethereum.json`;
  writeFileSync(outFile, JSON.stringify({ address, fromBlock: FROM_BLOCK, toBlock: TO_BLOCK, totalLogs: unique.length, liquidationEvents: filtered.length, logs: filtered }, null, 2));
  console.log(`saved to ${outFile}`);
  return filtered;
}

// Protocol addresses
const PROTOCOLS = {
  'aave-v3': '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  'morpho-blue': '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF2C9895546ED',
  'compound-v3-usdc': '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
};

async function main() {
  const target = process.argv[2] || 'all';
  const labels = target === 'all' ? Object.keys(PROTOCOLS) : [target];
  for (const label of labels) {
    await scanAddress(PROTOCOLS[label], label);
  }
  console.log('\n=== all scans complete ===');
}

main().catch(e => { console.error(e); process.exit(1); });
