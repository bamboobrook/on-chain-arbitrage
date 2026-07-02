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
  console.log('OAL workers starting...');

  // BullMQ consumers
  startOpportunityWorker();
  startSimulationWorker();
  startExecutionWorker();
  startBacktestWorker();

  // Continuous watchers
  void startRiskWorker();
  void startAccountingWorker();

  // Per-chain indexer (only for chains with an RPC env var set)
  for (const chain of CHAINS.filter((c) => c.isActive && c.chainId !== 31337)) {
    const rpc = process.env[chain.rpcEnvVar];
    if (rpc) {
      void startIndexer(chain.chainId, rpc);
    } else {
      console.log(`[indexer] skipping ${chain.shortName}: ${chain.rpcEnvVar} not set`);
    }
  }

  console.log('OAL workers ready');
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
