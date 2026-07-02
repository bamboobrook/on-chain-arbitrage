/**
 * Shared worker infrastructure: Redis connection, BullMQ queue/worker factory,
 * Postgres helper, and graceful shutdown.
 */

import 'dotenv/config';
import { Redis } from 'ioredis';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import pg from 'pg';

const { Pool } = pg;

export const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

export const connection: ConnectionOptions = { url: redisUrl };

/** A single shared Redis client for non-BullMQ pub/sub and locks. */
export const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://oal:oal_dev_password@127.0.0.1:5432/oal',
  max: 10,
});

export async function db<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await pool.query<T>(text, params as never);
  return res.rows;
}

// --- Queues -----------------------------------------------------------------

export const QUEUES = {
  opportunity: 'opportunity',
  simulation: 'simulation',
  execution: 'execution',
  backtest: 'backtest',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export function makeQueue(name: QueueName): Queue {
  return new Queue(name, { connection });
}

export function makeWorker<T>(
  name: QueueName,
  handler: (job: { data: T; id: string }) => Promise<unknown>,
  concurrency = 1,
): Worker<T> {
  const w = new Worker<T>(
    name,
    async (job) => {
      try {
        return await handler({ data: job.data as T, id: job.id ?? '' });
      } catch (err) {
        // Logged but rethrown so BullMQ marks the job failed.
        console.error(`[worker:${name}] job ${job.id} failed:`, err);
        throw err;
      }
    },
    { connection, concurrency },
  );
  w.on('completed', (job) => console.log(`[worker:${name}] job ${job.id} done`));
  w.on('failed', (job, err) => console.error(`[worker:${name}] job ${job?.id} failed: ${err.message}`));
  return w;
}

// --- Shutdown ---------------------------------------------------------------

const workers: Worker[] = [];
export function track(w: Worker): Worker {
  workers.push(w);
  return w;
}

export async function shutdown(sig: string): Promise<void> {
  console.log(`${sig} received, closing workers...`);
  await Promise.allSettled(workers.map((w) => w.close()));
  await pool.end();
  redis.disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
