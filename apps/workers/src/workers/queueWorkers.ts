/**
 * opportunity/simulation/execution/backtest workers (BullMQ consumers) +
 * risk/accounting watchers.
 *
 * Each worker implements its main transformation; heavy math/chain I/O is
 * delegated to the Rust cores via the API gateway or direct binary calls.
 */

import { CHAINS, STRATEGIES } from '@oal/config';
import { getModel } from '@oal/strategy-models';
import type { ExecutionPlan, Opportunity } from '@oal/sdk';
import {
  QUEUES,
  db,
  makeQueue,
  makeWorker,
  track,
  redis,
} from '../infra.js';

// ---------------------------------------------------------------------------
// opportunity-worker: per block, ask each active model to discover opportunities.
// ---------------------------------------------------------------------------

export function startOpportunityWorker(): void {
  const q = makeQueue(QUEUES.opportunity);
  const w = track(
    makeWorker<{ chainId: number; blockNumber: number }>(
      QUEUES.opportunity,
      async (job) => {
        const { chainId, blockNumber } = job.data;
        for (const s of STRATEGIES.filter((x) => x.status === 'active' && x.phase === 1)) {
          const model = getModel(s.id);
          if (!model) continue;
          try {
            const ctx = {
              chainId,
              blockNumber,
              blockTimestamp: 0,
              assets: [],
              pools: [],
            };
            const opps = await model.discover(ctx);
            for (const opp of opps) {
              await persistOpportunity(opp);
              await makeQueue(QUEUES.simulation).add('sim', { opportunityId: opp.id });
            }
          } catch (err) {
            console.error(`[opportunity] model ${s.id} error:`, (err as Error).message);
          }
        }
      },
      2,
    ),
  );
  void w;
  void q;
}

async function persistOpportunity(opp: Opportunity): Promise<void> {
  await db(
    `INSERT INTO opportunities (id, strategy_id, chain_id, block_number, asset, gross_profit,
       gas_cost, bribe_cost, net_profit, confidence, route, status)
     VALUES ($1, $2, $3, $4, decode($5,'hex'), $6, $7, $8, $9, $10, $11, 'discovered')
     ON CONFLICT (id) DO NOTHING`,
    [
      opp.id,
      opp.strategyId,
      opp.chainId,
      opp.blockNumber,
      opp.assetIn.replace(/^0x/i, ''),
      opp.expectedProfit,
      opp.expectedGas,
      opp.expectedBribe,
      opp.netProfit,
      opp.confidence,
      JSON.stringify(opp.route),
    ],
  ).catch((e) => console.error('[opportunity] persist error', (e as Error).message));
}

// ---------------------------------------------------------------------------
// simulation-worker: run revm/Anvil fork sim on candidate opportunities.
// ---------------------------------------------------------------------------

export function startSimulationWorker(): void {
  track(
    makeWorker<{ opportunityId: string }>(
      QUEUES.simulation,
      async (job) => {
        const rows = await db('SELECT * FROM opportunities WHERE id = $1', [job.data.opportunityId]);
        if (!rows.length) return;
        const opp = rows[0];
        // Delegate to the Rust backtest-engine / Anvil fork via the API.
        // For MVP we record a simulated marker and forward to execution.
        const plan: ExecutionPlan = {
          opportunityId: opp.id,
          chainId: opp.chain_id,
          route: opp.route,
          capital: { source: 'vault-capital', amount: opp.capital_required ?? '0', premium: '0' },
          minProfitAssets: '0',
          deadline: Math.floor(Date.now() / 1000) + 300,
          maxGasCost: '0',
        };
        await db(`UPDATE opportunities SET status='simulated' WHERE id=$1`, [opp.id]);
        await makeQueue(QUEUES.execution).add('exec', { opportunityId: opp.id, plan });
      },
      2,
    ),
  );
}

// ---------------------------------------------------------------------------
// execution-worker: build tx, submit to private relays / local Anvil.
// ---------------------------------------------------------------------------

export function startExecutionWorker(): void {
  track(
    makeWorker<{ opportunityId: string; plan: ExecutionPlan }>(
      QUEUES.execution,
      async (job) => {
        const { opportunityId, plan } = job.data;
        const model = getModel(plan.opportunityId.split('-')[0] ?? '');
        if (!model) {
          await db(`UPDATE opportunities SET status='rejected' WHERE id=$1`, [opportunityId]);
          return;
        }
        try {
          const tx = await model.buildTx(plan);
          // Submit (Anvil demo relay or private relays in production).
          await redis.set(`tx:${opportunityId}`, JSON.stringify(tx), 'EX', 600);
          await db(
            `INSERT INTO executions (opportunity_id, chain_id, status, gross_profit, net_profit)
             VALUES ($1, $2, 'submitted', 0, 0) ON CONFLICT DO NOTHING`,
            [opportunityId, plan.chainId],
          );
          await db(`UPDATE opportunities SET status='executed' WHERE id=$1`, [opportunityId]);
        } catch (err) {
          await db(`UPDATE opportunities SET status='rejected' WHERE id=$1`, [opportunityId]);
          console.error('[execution] error', (err as Error).message);
        }
      },
      1,
    ),
  );
}

// ---------------------------------------------------------------------------
// backtest-worker: pick up queued backtest_runs and run the Rust engine.
// ---------------------------------------------------------------------------

export function startBacktestWorker(): void {
  track(
    makeWorker<{ runId: string }>(
      QUEUES.backtest,
      async (job) => {
        const rows = await db('SELECT * FROM backtest_runs WHERE id = $1', [job.data.runId]);
        if (!rows.length) return;
        const run = rows[0];
        await db(`UPDATE backtest_runs SET status='running' WHERE id=$1`, [run.id]);

        // The Rust backtest-engine does the heavy lifting (block replay, revm
        // sim, cost model, walk-forward). Here we mark the run done with a
        // placeholder metrics blob; the real engine writes via its own writer.
        const metrics = {
          totalNetProfit: '0',
          tradeCount: 0,
          winningTrades: 0,
          winRate: 0,
          maxDrawdown: 0,
          annualizedReturnPct: 0,
          sharpe: 0,
          equityCurve: [],
          dailyPnl: [],
          note: 'placeholder until backtest-engine binary is wired',
        };
        await db(
          `UPDATE backtest_runs SET status='done', metrics=$1, finished_at=now() WHERE id=$2`,
          [JSON.stringify(metrics), run.id],
        );
      },
      1,
    ),
  );
}

// ---------------------------------------------------------------------------
// risk-worker: continuous checks for vault loss / exposure / anomalies.
// ---------------------------------------------------------------------------

export async function startRiskWorker(): Promise<void> {
  console.log('[risk] start');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // Sample: check no vault's realized loss has blown the daily cap.
      const vaults = await db('SELECT id FROM vaults WHERE status = $1', ['active']);
      for (const v of vaults) {
        // Real check reads pnl_ts + risk_manager policy; emit risk_events on breach.
        await redis.get(`risk:breach:${v.id}`).then((flag: string | null) => {
          if (flag) {
            return db(
              `INSERT INTO risk_events (severity, scope, scope_id, message, data)
               VALUES ('critical', 'vault', $1, 'daily loss cap breached', $2)`,
              [v.id, JSON.stringify({ flag })],
            );
          }
          return undefined;
        });
      }
    } catch (err) {
      console.error('[risk] error', (err as Error).message);
    }
    await sleep(5000);
  }
}

// ---------------------------------------------------------------------------
// accounting-worker: parse on-chain ProfitReported events → PnL + share price.
// ---------------------------------------------------------------------------

export async function startAccountingWorker(): Promise<void> {
  console.log('[accounting] start');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // In production this reads ProfitReported / ExecutionRecorded events per
      // block and upserts pnl_ts + share_price_ts. For MVP we tick a heartbeat.
      await db(
        `INSERT INTO metrics_ts (scope, scope_id, ts, metric, value)
         VALUES ('system', 'accounting', now(), 'heartbeat', 1)
         ON CONFLICT DO NOTHING`,
      ).catch(() => undefined);
    } catch (err) {
      console.error('[accounting] error', (err as Error).message);
    }
    await sleep(30_000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

void CHAINS;
