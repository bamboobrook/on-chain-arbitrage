/**
 * On-Chain Arbitrage Lab — workers entrypoint.
 *
 * Starts all 6 worker classes + the per-chain indexer. BullMQ workers consume
 * Redis queues; the indexer and risk/accounting watchers run continuous loops.
 */

import 'dotenv/config';
import { CHAINS } from '@oal/config';
import {
  startOpportunityWorker,
  startSimulationWorker,
  startExecutionWorker,
  startBacktestWorker,
  startRiskWorker,
  startAccountingWorker,
} from './workers/queueWorkers.js';
import { startIndexer } from './workers/indexerWorker.js';

async function main(): Promise<void> {
  const role = String(process.env.WORKER_ROLE ?? 'all').toLowerCase();
  const roles = new Set(role.split(',').map((item) => item.trim()).filter(Boolean));
  const enabled = (name: 'scanner' | 'executor' | 'all') => roles.has('all') || roles.has(name);
  console.log(`OAL workers starting role=${role}`);

  if (enabled('scanner')) {
    // Scanner node: discover opportunities, refresh watchlists, and keep backtest evidence moving.
    startOpportunityWorker();
    startBacktestWorker();
  }

  if (enabled('executor')) {
    // Executor node: consume simulated opportunities and handle execution/risk/accounting.
    startSimulationWorker();
    startExecutionWorker();
    void startRiskWorker();
    void startAccountingWorker();
  }

  if (enabled('scanner')) {
    // Per-chain indexer (only for chains with an RPC env var set)
    for (const chain of CHAINS.filter((c) => c.isActive && c.chainId !== 31337)) {
      const rpc = process.env[chain.rpcEnvVar];
      if (rpc) {
        void startIndexer(chain.chainId, rpc);
      } else {
        console.log(`[indexer] skipping ${chain.shortName}: ${chain.rpcEnvVar} not set`);
      }
    }
  }

  console.log(`OAL workers ready role=${role}`);
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
