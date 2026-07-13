/**
 * Health-check probes for /health/live and /health/ready.
 *
 * - /health/live: liveness; process is up and serving. Always 200 unless the
 *   process is shutting down.
 * - /health/ready: readiness; checks that DB (Postgres), Redis, ClickHouse
 *   and at least one EVM RPC are reachable. Returns 503 with the failing
 *   component list if any dependency is down.
 *
 * Per full-audit plan §3 (Phase 0): ready must check DB, Redis, RPC, ClickHouse.
 */

import type { FastifyInstance } from 'fastify';
import { pool as pgPool } from './db.js';
import { Redis } from 'ioredis';
import { RpcMonitor, buildConfigsFromEnv, type ChainHealth } from '@oal/sdk';

let rpcMonitor: RpcMonitor | null = null;
function getRpcMonitor(): RpcMonitor {
  if (!rpcMonitor) {
    const configs = buildConfigsFromEnv(process.env);
    rpcMonitor = new RpcMonitor(configs);
    rpcMonitor.start();
  }
  return rpcMonitor;
}

export interface HealthComponent {
  name: string;
  ok: boolean;
  latencyMs?: number;
  detail?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  ts: number;
  components: HealthComponent[];
}

/** Check Postgres connectivity. */
async function checkPostgres(): Promise<HealthComponent> {
  const t0 = Date.now();
  try {
    const conn = await pgPool.connect();
    try {
      await conn.query('SELECT 1');
    } finally {
      conn.release();
    }
    return { name: 'postgres', ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { name: 'postgres', ok: false, detail: (e as Error).message };
  }
}

let redisClient: Redis | null = null;
function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
  }
  return redisClient;
}

/** Check Redis connectivity. */
async function checkRedis(): Promise<HealthComponent> {
  const t0 = Date.now();
  try {
    const r = getRedis();
    await r.connect().catch(() => undefined); // ignore if already connected
    await r.ping();
    return { name: 'redis', ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { name: 'redis', ok: false, detail: (e as Error).message };
  }
}

/** Check ClickHouse connectivity via HTTP ping. */
async function checkClickHouse(): Promise<HealthComponent> {
  const t0 = Date.now();
  const url = process.env.CLICKHOUSE_URL ?? 'http://oal:oal_dev_password@127.0.0.1:8123/oal';
  // Strip credentials and db path. fetch() rejects URLs with embedded userinfo.
  // Use URL parser then drop the userinfo.
  let pingUrl: string;
  try {
    const parsed = new URL(url);
    // Build a clean URL without username/password.
    pingUrl = `${parsed.protocol}//${parsed.hostname}:${parsed.port}/ping`;
  } catch {
    return { name: 'clickhouse', ok: false, detail: 'bad CLICKHOUSE_URL' };
  }
  try {
    const res = await fetch(pingUrl, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      return { name: 'clickhouse', ok: false, detail: `HTTP ${res.status}` };
    }
    return { name: 'clickhouse', ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { name: 'clickhouse', ok: false, detail: (e as Error).message };
  }
}

/** Check EVM RPC connectivity (eth_blockNumber on the first configured chain). */
async function checkRpc(): Promise<HealthComponent> {
  const t0 = Date.now();
  // Pick the first configured RPC (priority: ethereum, arbitrum, base).
  const rpc =
    process.env.RPC_ETHEREUM_URL ||
    process.env.RPC_ARBITRUM_URL ||
    process.env.RPC_BASE_URL ||
    process.env.RPC_POLYGON_URL;
  if (!rpc) {
    return { name: 'rpc', ok: false, detail: 'no RPC_*_URL configured' };
  }
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json()) as { result?: string; error?: unknown };
    if (json.error || !json.result) {
      return { name: 'rpc', ok: false, detail: `RPC error: ${JSON.stringify(json.error)}` };
    }
    return { name: 'rpc', ok: true, latencyMs: Date.now() - t0, detail: `block=0x${parseInt(json.result, 16).toString(16)}` };
  } catch (e) {
    return { name: 'rpc', ok: false, detail: (e as Error).message };
  }
}

/** Run all readiness checks in parallel. */
export async function runReadinessChecks(): Promise<HealthReport> {
  const components = await Promise.all([
    checkPostgres(),
    checkRedis(),
    checkClickHouse(),
    checkRpc(),
  ]);
  const allOk = components.every((c) => c.ok);
  return {
    status: allOk ? 'ok' : 'degraded',
    ts: Date.now(),
    components,
  };
}

/** Register the /health/* probes on a Fastify instance. */
export async function registerHealth(app: FastifyInstance): Promise<void> {
  // Liveness: process is up.
  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }));
  app.get('/health/live', async () => ({ status: 'ok', ts: Date.now() }));

  // Readiness: dependencies reachable.
  app.get('/health/ready', async (_req, reply) => {
    const report = await runReadinessChecks();
    if (report.status !== 'ok') {
      reply.code(503);
    }
    return report;
  });

  // RPC per-chain health + failover status.
  app.get('/health/rpc', async () => {
    const monitor = getRpcMonitor();
    const chains: ChainHealth[] = monitor.getHealth();
    return {
      ts: Date.now(),
      chains,
      allHealthy: chains.every((c) => c.healthy),
    };
  });
}
