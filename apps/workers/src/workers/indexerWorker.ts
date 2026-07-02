/**
 * indexer-worker: watches new blocks and indexes swap/mint-burn/oracle/liquidation
 * events for whitelisted pools into Postgres + ClickHouse.
 *
 * For the MVP this polls the latest block via an archive RPC and records block
 * progression + pool-state snapshots. Real event decoding is delegated to the
 * Rust cores / subgraph; here we establish the polling loop and write path.
 */

import { db } from '../infra.js';

const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 4000);

export async function startIndexer(chainId: number, rpcUrl: string): Promise<void> {
  console.log(`[indexer] start chain=${chainId} rpc=${maskUrl(rpcUrl)}`);
  let lastBlock = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const block = await fetchLatestBlock(rpcUrl);
      if (block > lastBlock) {
        // Persist a pool-state snapshot marker (the real decode runs in Rust).
        await db(
          `INSERT INTO pool_events (chain_id, block_number, log_index, pool_address, event_type, args_json, ts)
           VALUES ($1, $2, 0, '0xindexer', 'block', $3, now())
           ON CONFLICT DO NOTHING`,
          [chainId, block, JSON.stringify({ rpc: maskUrl(rpcUrl) })],
        ).catch(() => undefined); // ClickHouse side handled separately; ignore pg dup
        if (block % 100 === 0) console.log(`[indexer] chain=${chainId} block=${block}`);
        lastBlock = block;
      }
    } catch (err) {
      console.error(`[indexer] chain=${chainId} error:`, (err as Error).message);
    }
    await sleep(POLL_MS);
  }
}

async function fetchLatestBlock(rpcUrl: string): Promise<number> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  });
  const json = (await res.json()) as { result: string };
  return parseInt(json.result, 16);
}

function maskUrl(u: string): string {
  return u.replace(/(\/v2\/)[^/]+/, '$1***');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
