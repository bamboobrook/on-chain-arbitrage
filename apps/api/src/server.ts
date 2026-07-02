/**
 * On-Chain Arbitrage Lab — API gateway entrypoint.
 */

import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './routes.js';
import { closeDb } from './db.js';

const host = process.env.API_HOST ?? '0.0.0.0';
const port = Number(process.env.API_PORT ?? 4000);

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

async function main(): Promise<void> {
  await app.register(cors, { origin: true });
  await registerRoutes(app);

  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }));

  await app.listen({ host, port });
  app.log.info(`OAL API listening on http://${host}:${port}`);

  const shutdown = async (sig: string) => {
    app.log.info(`${sig} received, shutting down`);
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
