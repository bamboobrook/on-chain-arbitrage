/**
 * REST + SSE routes for the On-Chain Arbitrage Lab API gateway.
 * Implements docs/api-reference.md.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from './db.js';
import { CHAINS, ASSETS, STRATEGIES } from '@oal/config';
import { listModels, getModel } from '@oal/strategy-models';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // -- reference --------------------------------------------------------------
  app.get('/api/chains', async () => CHAINS.map((c) => ({ chainId: c.chainId, name: c.name })));

  app.get('/api/assets', async () =>
    ASSETS.map((a) => ({ chainId: a.chainId, symbol: a.symbol, decimals: a.decimals })),
  );

  // -- strategies -------------------------------------------------------------
  app.get('/api/strategies', async () => {
    const rows = await query('SELECT * FROM strategies ORDER BY id');
    // Merge config/registry defaults with DB rows.
    return STRATEGIES.map((s) => {
      const row = rows.find((r) => r.id === s.id);
      return {
        id: s.id,
        name: s.name,
        version: s.version,
        modelType: s.modelType,
        riskClass: s.riskClass,
        status: row?.status ?? s.status,
      };
    });
  });

  app.get<{ Params: { id: string } }>('/api/strategies/:id', async (req, reply) => {
    const s = STRATEGIES.find((x) => x.id === req.params.id);
    if (!s) return reply.code(404).send({ error: 'not found' });
    const rows = await query('SELECT * FROM strategies WHERE id = $1', [s.id]);
    return { ...s, status: rows[0]?.status ?? s.status };
  });

  app.get<{ Params: { id: string } }>('/api/strategies/:id/metrics', async (req) => {
    // Rolling metrics from the metrics_ts hypertable (or zeros if none yet).
    const rows = await query(
      `SELECT metric, value FROM metrics_ts WHERE scope='strategy' AND scope_id=$1
       ORDER BY ts DESC LIMIT 10`,
      [req.params.id],
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[r.metric] = Number(r.value);
    return out;
  });

  // -- backtests --------------------------------------------------------------
  app.post('/api/backtests', async (req, reply) => {
    const body = req.body as {
      strategyId: string;
      chainId: number;
      asset: string;
      startBlock: number;
      endBlock: number;
      capital: string;
      costModel?: Record<string, unknown>;
      params?: Record<string, unknown>;
    };
    if (!body.strategyId || !getModel(body.strategyId)) {
      return reply.code(400).send({ error: 'unknown strategyId' });
    }
    const rows = await query(
      `INSERT INTO backtest_runs (strategy_id, status, chain_id, asset, start_block, end_block, capital, cost_model, params)
       VALUES ($1, 'queued', $2, decode($3,'hex'), $4, $5, $6, $7, $8)
       RETURNING id, status`,
      [
        body.strategyId,
        body.chainId,
        body.asset.replace(/^0x/i, ''),
        body.startBlock,
        body.endBlock,
        body.capital,
        JSON.stringify(body.costModel ?? {}),
        JSON.stringify(body.params ?? {}),
      ],
    );
    // The backtest worker picks this up via BullMQ; here we just enqueue.
    // (Worker notification via Redis is wired in apps/workers.)
    return { id: rows[0].id, status: rows[0].status };
  });

  app.get<{ Params: { id: string } }>('/api/backtests/:id', async (req, reply) => {
    const rows = await query('SELECT * FROM backtest_runs WHERE id = $1', [req.params.id]);
    if (!rows.length) return reply.code(404).send({ error: 'not found' });
    return rows[0];
  });

  app.get<{ Params: { id: string } }>('/api/backtests/:id/events', async (req) => {
    const rows = await query('SELECT metrics FROM backtest_runs WHERE id = $1', [req.params.id]);
    return { metrics: rows[0]?.metrics ?? null };
  });

  // -- vaults -----------------------------------------------------------------
  app.get('/api/vaults', async () => {
    return query('SELECT * FROM vaults ORDER BY created_at');
  });

  app.get<{ Params: { id: string } }>('/api/vaults/:id', async (req, reply) => {
    const rows = await query('SELECT * FROM vaults WHERE id = $1', [req.params.id]);
    if (!rows.length) return reply.code(404).send({ error: 'not found' });
    return rows[0];
  });

  app.get<{ Params: { id: string } }>('/api/vaults/:id/positions', async (req) => {
    return query(
      `SELECT strategy_id, config FROM strategies WHERE id IN (
         SELECT strategy_id FROM vaults WHERE id = $1)`,
      [req.params.id],
    );
  });

  app.get<{ Params: { id: string } }>('/api/vaults/:id/pnl', async (req) => {
    return query(
      `SELECT date_trunc('day', ts) AS day, SUM(realized_pnl) AS pnl
       FROM pnl_ts WHERE vault_id = $1 GROUP BY day ORDER BY day`,
      [req.params.id],
    );
  });

  // -- live -------------------------------------------------------------------
  app.get('/api/live/opportunities', async () => {
    return query(
      `SELECT * FROM opportunities WHERE created_at > now() - interval '1 hour'
       ORDER BY created_at DESC LIMIT 100`,
    );
  });

  app.get('/api/live/executions', async () => {
    return query(
      `SELECT * FROM executions WHERE created_at > now() - interval '24 hours'
       ORDER BY created_at DESC LIMIT 100`,
    );
  });

  // -- admin (protected) ------------------------------------------------------
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/admin')) return;
    const key = req.headers['x-admin-key'];
    if (key !== (process.env.ADMIN_API_KEY ?? 'change-me-in-production')) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/admin/strategies/:id/pause', async (req, reply) => {
    const r = await query(
      `UPDATE strategies SET status='paused', updated_at=now() WHERE id=$1 RETURNING id`,
      [req.params.id],
    );
    if (!r.length) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/admin/strategies/:id/resume', async (req, reply) => {
    const r = await query(
      `UPDATE strategies SET status='active', updated_at=now() WHERE id=$1 RETURNING id`,
      [req.params.id],
    );
    if (!r.length) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/admin/vaults/:id/rebalance', async (req, reply) => {
    // Rebalance is a no-op marker for the risk-worker to pick up; real logic
    // lives in the worker. Returns ok if the vault exists.
    const r = await query('SELECT id FROM vaults WHERE id=$1', [req.params.id]);
    if (!r.length) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });

  // -- SSE streams ------------------------------------------------------------
  app.get('/stream/risk-events', async (req, reply) => sseStream(req, reply, riskFeed));
  app.get('/stream/live/executions', async (req, reply) => sseStream(req, reply, executionsFeed));
  app.get('/stream/live/opportunities', async (req, reply) => sseStream(req, reply, opportunitiesFeed));
  app.get<{ Params: { id: string } }>('/stream/backtests/:id', async (req, reply) =>
    sseStream(req, reply, backtestFeed(req.params.id)),
  );
}

// --- SSE helpers -----------------------------------------------------------

type Feed = (reply: FastifyReply, send: (data: unknown) => void) => Promise<void>;

async function sseStream(req: FastifyRequest, reply: FastifyReply, feed: Feed): Promise<void> {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (data: unknown) => {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  // Heartbeat so proxies don't drop the connection.
  const hb = setInterval(() => reply.raw.write(': keep-alive\n\n'), 15_000);
  req.raw.on('close', () => clearInterval(hb));
  try {
    await feed(reply, send);
    // Keep the stream open until the client disconnects.
    await new Promise<void>((resolve) => req.raw.on('close', () => resolve()));
  } finally {
    clearInterval(hb);
  }
}

const riskFeed: Feed = async (_reply, send) => {
  // Poll recent risk events and stream new ones. (Production: LISTEN/NOTIFY.)
  let lastTs = new Date(0);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await query(
      `SELECT * FROM risk_events WHERE created_at > $1 ORDER BY created_at DESC LIMIT 20`,
      [lastTs],
    );
    for (const r of rows.reverse()) send(r);
    if (rows.length) lastTs = rows[rows.length - 1].created_at;
    await sleep(2000);
  }
};

const executionsFeed: Feed = async (_reply, send) => {
  let lastId: string | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows: { id: string; created_at: Date; [k: string]: unknown }[] = await query(
      `SELECT * FROM executions WHERE ($1::text IS NULL OR created_at > (SELECT created_at FROM executions WHERE id=$1))
       ORDER BY created_at DESC LIMIT 20`,
      [lastId],
    );
    for (const r of rows.slice().reverse()) send(r);
    if (rows.length) lastId = rows[0].id;
    await sleep(2000);
  }
};

const opportunitiesFeed: Feed = async (_reply, send) => {
  let lastTs = new Date(Date.now() - 60_000);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await query(
      `SELECT * FROM opportunities WHERE created_at > $1 ORDER BY created_at DESC LIMIT 20`,
      [lastTs],
    );
    for (const r of rows.reverse()) send(r);
    if (rows.length) lastTs = rows[rows.length - 1].created_at;
    await sleep(2000);
  }
};

function backtestFeed(runId: string): Feed {
  return async (_reply, send) => {
    // Stream the backtest run status + metrics as they update.
    let lastStatus = '';
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rows = await query('SELECT status, metrics, finished_at FROM backtest_runs WHERE id = $1', [runId]);
      if (!rows.length) {
        send({ error: 'not found' });
        break;
      }
      if (rows[0].status !== lastStatus) {
        lastStatus = rows[0].status;
        send({ status: lastStatus, metrics: rows[0].metrics });
        if (lastStatus === 'done' || lastStatus === 'failed') break;
      }
      await sleep(1500);
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Reference to keep the import used (models available for future enrich).
void listModels;
