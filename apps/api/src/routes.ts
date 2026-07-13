/**
 * REST + SSE routes for the On-Chain Arbitrage Lab API gateway.
 * Implements docs/api-reference.md.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { query } from './db.js';
import { CHAINS, ASSETS, STRATEGIES } from '@oal/config';
import { getModel } from '@oal/strategy-models';
import {
  loadAaveLiquidationArtifacts,
  loadAaveLiquidationReplayArtifacts,
  loadAaveLiquidationWatchlist,
  loadBalancerArbitrageArtifacts,
  loadCandidateArtifact,
  loadCandidateEventReplay,
  loadCandidates,
  loadCompoundV3LiquidationArtifacts,
  loadCurveStableArbitrageArtifacts,
  loadDexArbitrageArtifact,
  loadDexArbitrageArtifacts,
  loadExecutorNodeStatus,
  loadLiveOpportunityFeed,
  loadLiveForkVerification,
  loadMorphoBlueLiquidationArtifacts,
  loadMorphoBlueLiquidationWatchlist,
  loadPendlePtArbitrageArtifacts,
  loadPureArbitrageSearchOverview,
  loadUniswapV3FeeArbitrageArtifacts,
  type CandidateEventReplayArtifact,
} from './candidates.js';
import {
  buildAaveLiquidationExecutionPlan,
  buildCandidateExecutionPlan,
  buildCompoundV3LiquidationExecutionPlan,
  buildDexArbitrageExecutionPlan,
  buildMorphoBlueLiquidationExecutionPlan,
  type ExecutionPlanRequest,
  type LiveRunRecord,
  type LiveRunRequest,
} from './executionPlans.js';
import { buildExecutorExecutionDecision } from './executorDecision.js';

interface LiveAutomationSessionRequest {
  walletAddress?: string;
  walletChainId?: string | null;
  capitalUsd?: number | string;
  strategyFamilies?: string[];
  mode?: 'paper' | 'production';
  authorization?: {
    message?: string;
    signature?: string;
    signedAt?: string;
  };
}

interface LiveAutomationSession {
  schemaVersion: number;
  id: string;
  createdAt: string;
  updatedAt: string;
  walletAddress: string;
  walletChainId: string | null;
  capitalUsd: number;
  strategyFamilies: string[];
  mode: 'paper' | 'production';
  status: string;
  reason: string;
  authorization: {
    message: string;
    signature: string;
    signedAt: string;
  };
  decisionSummary: Record<string, unknown>;
  selectedOpportunityCount: number;
  selectedPreForkReadyCount: number;
  selectedSubmitReadyCount: number;
  selectedTop: Array<Record<string, unknown>>;
}

const API_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DATA_DIR = resolve(API_ROOT, 'data');
const AUTOMATION_SESSIONS_PATH = resolve(DATA_DIR, 'live-automation-sessions.json');
const LIVE_EXECUTION_QUEUE_PATH = resolve(DATA_DIR, 'live-execution-queue.json');

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // -- reference --------------------------------------------------------------
  app.get('/api/chains', async () => CHAINS.map((c) => ({ chainId: c.chainId, name: c.name })));

  app.get('/api/assets', async () =>
    ASSETS.map((a) => ({ chainId: a.chainId, symbol: a.symbol, decimals: a.decimals })),
  );

  app.get('/api/strategy-candidates', async (_req, reply) => {
    try {
      return await loadCandidates();
    } catch (err) {
      return reply.code(503).send({
        error: 'strategy candidates unavailable',
        detail: (err as Error).message,
        hint: 'run npm script search:candidates or node scripts/search-high-apy-strategies.mjs',
      });
    }
  });

  app.get('/api/strategy-candidates/artifact', async (_req, reply) => {
    try {
      return await loadCandidateArtifact();
    } catch (err) {
      return reply
        .code(503)
        .send({ error: 'strategy candidates unavailable', detail: (err as Error).message });
    }
  });

  app.get('/api/pure-arbitrage/overview', async (_req, reply) => {
    try {
      return await loadPureArbitrageSearchOverview();
    } catch (err) {
      return reply.code(503).send({
        error: 'pure arbitrage overview unavailable',
        detail: (err as Error).message,
      });
    }
  });

  app.get('/api/dex-arbitrage-candidates/artifact', async (_req, reply) => {
    const artifact = await loadDexArbitrageArtifact();
    if (!artifact) {
      return reply.code(404).send({
        error: 'dex arbitrage candidate artifact not found',
        hint: 'run node scripts/search-dex-arbitrage-candidates.mjs',
      });
    }
    return artifact;
  });

  app.get('/api/dex-arbitrage-candidates/artifacts', async (_req, reply) => {
    const artifacts = await loadDexArbitrageArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'dex arbitrage candidate artifacts not found',
        hint: 'run DEX_ARB_CHAIN=base npm run search:dex-arb and DEX_ARB_CHAIN=arbitrum npm run search:dex-arb',
      });
    }
    return artifacts;
  });

  app.get('/api/dex-arbitrage-candidates', async (_req, reply) => {
    const artifacts = await loadDexArbitrageArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'dex arbitrage candidate artifacts not found',
        hint: 'run DEX_ARB_CHAIN=base npm run search:dex-arb and DEX_ARB_CHAIN=arbitrum npm run search:dex-arb',
      });
    }
    return artifacts.candidates;
  });

  app.get('/api/curve-stable-arbitrage-candidates/artifacts', async (_req, reply) => {
    const artifacts = await loadCurveStableArbitrageArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'curve stable arbitrage candidate artifacts not found',
        hint: 'run npm run search:curve-stable-arb',
      });
    }
    return artifacts;
  });

  app.get('/api/curve-stable-arbitrage-candidates', async (_req, reply) => {
    const artifacts = await loadCurveStableArbitrageArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'curve stable arbitrage candidate artifacts not found',
        hint: 'run npm run search:curve-stable-arb',
      });
    }
    return artifacts.candidates;
  });

  app.get('/api/balancer-arbitrage-candidates/artifacts', async (_req, reply) => {
    const artifacts = await loadBalancerArbitrageArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'balancer arbitrage candidate artifacts not found',
        hint: 'run npm run search:balancer-arb',
      });
    }
    return artifacts;
  });

  app.get('/api/balancer-arbitrage-candidates', async (_req, reply) => {
    const artifacts = await loadBalancerArbitrageArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'balancer arbitrage candidate artifacts not found',
        hint: 'run npm run search:balancer-arb',
      });
    }
    return artifacts.candidates;
  });

  app.get('/api/uniswap-v3-fee-arbitrage-candidates/artifacts', async (_req, reply) => {
    const artifacts = await loadUniswapV3FeeArbitrageArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'uniswap v3 fee arbitrage candidate artifacts not found',
        hint: 'run UNI_FEE_ARB_CHAIN=base npm run search:uniswap-v3-fee-arb',
      });
    }
    return artifacts;
  });

  app.get('/api/uniswap-v3-fee-arbitrage-candidates', async (_req, reply) => {
    const artifacts = await loadUniswapV3FeeArbitrageArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'uniswap v3 fee arbitrage candidate artifacts not found',
        hint: 'run UNI_FEE_ARB_CHAIN=base npm run search:uniswap-v3-fee-arb',
      });
    }
    return artifacts.candidates;
  });

  app.get('/api/pendle-pt-arbitrage-candidates/artifacts', async (_req, reply) => {
    const artifacts = await loadPendlePtArbitrageArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'pendle pt arbitrage candidate artifacts not found',
        hint: 'run npm run search:pendle-pt-arb',
      });
    }
    return artifacts;
  });

  app.get('/api/pendle-pt-arbitrage-candidates', async (_req, reply) => {
    const artifacts = await loadPendlePtArbitrageArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'pendle pt arbitrage candidate artifacts not found',
        hint: 'run npm run search:pendle-pt-arb',
      });
    }
    return artifacts.candidates;
  });

  app.post<{ Params: { id: string } }>(
    '/api/uniswap-v3-fee-arbitrage-candidates/:id/execution-plan',
    async (req, reply) => {
      const artifacts = await loadUniswapV3FeeArbitrageArtifacts();
      if (!artifacts) {
        return reply.code(404).send({
          error: 'uniswap v3 fee arbitrage candidate artifacts not found',
          hint: 'run UNI_FEE_ARB_CHAIN=base npm run search:uniswap-v3-fee-arb',
        });
      }
      const candidate = artifacts.candidates.find((c) => c.id === req.params.id);
      if (!candidate) {
        return reply.code(404).send({ error: 'uniswap v3 fee arbitrage candidate not found' });
      }
      return buildDexArbitrageExecutionPlan(candidate, (req.body ?? {}) as ExecutionPlanRequest);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/uniswap-v3-fee-arbitrage-candidates/:id/live-runs',
    async (req, reply) => {
      try {
        const artifacts = await loadUniswapV3FeeArbitrageArtifacts();
        if (!artifacts) {
          return reply.code(404).send({
            error: 'uniswap v3 fee arbitrage candidate artifacts not found',
            hint: 'run UNI_FEE_ARB_CHAIN=base npm run search:uniswap-v3-fee-arb',
          });
        }
        const candidate = artifacts.candidates.find((c) => c.id === req.params.id);
        if (!candidate) {
          return reply.code(404).send({ error: 'uniswap v3 fee arbitrage candidate not found' });
        }

        const body = (req.body ?? {}) as LiveRunRequest;
        if (!body.walletAddress) {
          return reply.code(400).send({ error: 'walletAddress is required to create a live run' });
        }
        if (!body.capital || Number(body.capital) <= 0) {
          return reply.code(400).send({ error: 'capital must be a positive base-unit amount' });
        }

        const plan = buildDexArbitrageExecutionPlan(candidate, body);
        const blockedBy = [
          ...plan.blockedBy,
          'Uniswap V3 cross-fee live worker is not enabled; route execution remains dry-run only',
          'no transaction is submitted by this API call',
        ];
        const rows = await query<LiveRunRecord>(
          `INSERT INTO live_strategy_runs
             (candidate_id, strategy_id, status, chain_id, wallet_address, capital, plan, risk_limits, blocked_by)
           VALUES ($1, $2, 'blocked', $3, decode($4,'hex'), $5, $6, $7, $8)
           RETURNING id, candidate_id, strategy_id, status, chain_id,
             '0x' || encode(wallet_address, 'hex') AS wallet_address,
             capital::text AS capital, plan, risk_limits, blocked_by, last_error,
             created_at, updated_at, started_at, stopped_at`,
          [
            candidate.id,
            plan.strategyId,
            plan.chainId,
            body.walletAddress.replace(/^0x/i, ''),
            body.capital,
            JSON.stringify(plan),
            JSON.stringify(plan.riskLimits),
            JSON.stringify(blockedBy),
          ],
        );
        return reply.code(201).send(rows[0]);
      } catch (err) {
        return reply.code(503).send({
          error: 'unable to create uniswap v3 fee arbitrage live run request',
          detail: (err as Error).message,
        });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/balancer-arbitrage-candidates/:id/execution-plan',
    async (req, reply) => {
      const artifacts = await loadBalancerArbitrageArtifacts();
      if (!artifacts) {
        return reply.code(404).send({
          error: 'balancer arbitrage candidate artifacts not found',
          hint: 'run npm run search:balancer-arb',
        });
      }
      const candidate = artifacts.candidates.find((c) => c.id === req.params.id);
      if (!candidate) return reply.code(404).send({ error: 'balancer arbitrage candidate not found' });
      return buildDexArbitrageExecutionPlan(candidate, (req.body ?? {}) as ExecutionPlanRequest);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/balancer-arbitrage-candidates/:id/live-runs',
    async (req, reply) => {
      try {
        const artifacts = await loadBalancerArbitrageArtifacts();
        if (!artifacts) {
          return reply.code(404).send({
            error: 'balancer arbitrage candidate artifacts not found',
            hint: 'run npm run search:balancer-arb',
          });
        }
        const candidate = artifacts.candidates.find((c) => c.id === req.params.id);
        if (!candidate) return reply.code(404).send({ error: 'balancer arbitrage candidate not found' });

        const body = (req.body ?? {}) as LiveRunRequest;
        if (!body.walletAddress) {
          return reply.code(400).send({ error: 'walletAddress is required to create a live run' });
        }
        if (!body.capital || Number(body.capital) <= 0) {
          return reply.code(400).send({ error: 'capital must be a positive base-unit amount' });
        }

        const plan = buildDexArbitrageExecutionPlan(candidate, body);
        const blockedBy = [
          ...plan.blockedBy,
          'Balancer arbitrage live worker is not enabled; route execution remains dry-run only',
          'no transaction is submitted by this API call',
        ];
        const rows = await query<LiveRunRecord>(
          `INSERT INTO live_strategy_runs
             (candidate_id, strategy_id, status, chain_id, wallet_address, capital, plan, risk_limits, blocked_by)
           VALUES ($1, $2, 'blocked', $3, decode($4,'hex'), $5, $6, $7, $8)
           RETURNING id, candidate_id, strategy_id, status, chain_id,
             '0x' || encode(wallet_address, 'hex') AS wallet_address,
             capital::text AS capital, plan, risk_limits, blocked_by, last_error,
             created_at, updated_at, started_at, stopped_at`,
          [
            candidate.id,
            plan.strategyId,
            plan.chainId,
            body.walletAddress.replace(/^0x/i, ''),
            body.capital,
            JSON.stringify(plan),
            JSON.stringify(plan.riskLimits),
            JSON.stringify(blockedBy),
          ],
        );
        return reply.code(201).send(rows[0]);
      } catch (err) {
        return reply.code(503).send({
          error: 'unable to create balancer arbitrage live run request',
          detail: (err as Error).message,
        });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/curve-stable-arbitrage-candidates/:id/execution-plan',
    async (req, reply) => {
      const artifacts = await loadCurveStableArbitrageArtifacts();
      if (!artifacts) {
        return reply.code(404).send({
          error: 'curve stable arbitrage candidate artifacts not found',
          hint: 'run npm run search:curve-stable-arb',
        });
      }
      const candidate = artifacts.candidates.find((c) => c.id === req.params.id);
      if (!candidate) return reply.code(404).send({ error: 'curve stable arbitrage candidate not found' });
      return buildDexArbitrageExecutionPlan(candidate, (req.body ?? {}) as ExecutionPlanRequest);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/curve-stable-arbitrage-candidates/:id/live-runs',
    async (req, reply) => {
      try {
        const artifacts = await loadCurveStableArbitrageArtifacts();
        if (!artifacts) {
          return reply.code(404).send({
            error: 'curve stable arbitrage candidate artifacts not found',
            hint: 'run npm run search:curve-stable-arb',
          });
        }
        const candidate = artifacts.candidates.find((c) => c.id === req.params.id);
        if (!candidate) return reply.code(404).send({ error: 'curve stable arbitrage candidate not found' });

        const body = (req.body ?? {}) as LiveRunRequest;
        if (!body.walletAddress) {
          return reply.code(400).send({ error: 'walletAddress is required to create a live run' });
        }
        if (!body.capital || Number(body.capital) <= 0) {
          return reply.code(400).send({ error: 'capital must be a positive base-unit amount' });
        }

        const plan = buildDexArbitrageExecutionPlan(candidate, body);
        const blockedBy = [
          ...plan.blockedBy,
          'Curve stable arbitrage live worker is not enabled; route execution remains dry-run only',
          'no transaction is submitted by this API call',
        ];
        const rows = await query<LiveRunRecord>(
          `INSERT INTO live_strategy_runs
             (candidate_id, strategy_id, status, chain_id, wallet_address, capital, plan, risk_limits, blocked_by)
           VALUES ($1, $2, 'blocked', $3, decode($4,'hex'), $5, $6, $7, $8)
           RETURNING id, candidate_id, strategy_id, status, chain_id,
             '0x' || encode(wallet_address, 'hex') AS wallet_address,
             capital::text AS capital, plan, risk_limits, blocked_by, last_error,
             created_at, updated_at, started_at, stopped_at`,
          [
            candidate.id,
            plan.strategyId,
            plan.chainId,
            body.walletAddress.replace(/^0x/i, ''),
            body.capital,
            JSON.stringify(plan),
            JSON.stringify(plan.riskLimits),
            JSON.stringify(blockedBy),
          ],
        );
        return reply.code(201).send(rows[0]);
      } catch (err) {
        return reply.code(503).send({
          error: 'unable to create curve stable arbitrage live run request',
          detail: (err as Error).message,
        });
      }
    },
  );

  app.get('/api/aave-liquidation-candidates/artifacts', async (_req, reply) => {
    const artifacts = await loadAaveLiquidationArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'aave liquidation candidate artifacts not found',
        hint: 'run LIQ_CHAIN=base npm run search:liquidations and repeat for configured chains',
      });
    }
    return artifacts;
  });

  app.get('/api/aave-liquidation-candidates', async (_req, reply) => {
    const artifacts = await loadAaveLiquidationArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'aave liquidation candidate artifacts not found',
        hint: 'run LIQ_CHAIN=base npm run search:liquidations and repeat for configured chains',
      });
    }
    return artifacts.candidates;
  });

  app.get('/api/aave-liquidation-replay-candidates/artifacts', async (_req, reply) => {
    const artifacts = await loadAaveLiquidationReplayArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'aave liquidation replay artifacts not found',
        hint: 'run AAVE_REPLAY_CHAIN=ethereum npm run replay:aave-liquidations',
      });
    }
    return artifacts;
  });

  app.get('/api/aave-liquidation-replay-candidates', async (_req, reply) => {
    const artifacts = await loadAaveLiquidationReplayArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'aave liquidation replay artifacts not found',
        hint: 'run AAVE_REPLAY_CHAIN=ethereum npm run replay:aave-liquidations',
      });
    }
    return artifacts.candidates;
  });

  app.get('/api/aave-liquidation-watchlist', async (_req, reply) => {
    const watchlist = await loadAaveLiquidationWatchlist();
    if (!watchlist) {
      return reply.code(404).send({
        error: 'aave liquidation watchlist not found',
        hint: 'run LIQ_CHAIN=ethereum npm run search:liquidations and then npm run watch:aave-liquidations',
      });
    }
    return watchlist;
  });

  app.post<{ Params: { id: string } }>(
    '/api/aave-liquidation-replay-candidates/:id/execution-plan',
    async (req, reply) => {
      const artifacts = await loadAaveLiquidationReplayArtifacts();
      if (!artifacts) {
        return reply.code(404).send({
          error: 'aave liquidation replay artifacts not found',
          hint: 'run AAVE_REPLAY_CHAIN=ethereum npm run replay:aave-liquidations',
        });
      }
      const candidate = artifacts.candidates.find((c) => c.id === req.params.id);
      if (!candidate) return reply.code(404).send({ error: 'aave liquidation replay candidate not found' });
      return buildAaveLiquidationExecutionPlan(candidate, (req.body ?? {}) as ExecutionPlanRequest);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/aave-liquidation-replay-candidates/:id/live-runs',
    async (req, reply) => {
      try {
        const artifacts = await loadAaveLiquidationReplayArtifacts();
        if (!artifacts) {
          return reply.code(404).send({
            error: 'aave liquidation replay artifacts not found',
            hint: 'run AAVE_REPLAY_CHAIN=ethereum npm run replay:aave-liquidations',
          });
        }
        const candidate = artifacts.candidates.find((c) => c.id === req.params.id);
        if (!candidate) return reply.code(404).send({ error: 'aave liquidation replay candidate not found' });

        const body = (req.body ?? {}) as LiveRunRequest;
        if (!body.walletAddress) {
          return reply.code(400).send({ error: 'walletAddress is required to create a live run' });
        }
        if (!body.capital || Number(body.capital) <= 0) {
          return reply.code(400).send({ error: 'capital must be a positive base-unit amount' });
        }

        const plan = buildAaveLiquidationExecutionPlan(candidate, body);
        const blockedBy = [
          ...plan.blockedBy,
          'Aave liquidation replay is historical evidence; live execution requires a fresh current liquidation event',
          'no transaction is submitted by this API call',
        ];
        const rows = await query<LiveRunRecord>(
          `INSERT INTO live_strategy_runs
             (candidate_id, strategy_id, status, chain_id, wallet_address, capital, plan, risk_limits, blocked_by)
           VALUES ($1, $2, 'blocked', $3, decode($4,'hex'), $5, $6, $7, $8)
           RETURNING id, candidate_id, strategy_id, status, chain_id,
             '0x' || encode(wallet_address, 'hex') AS wallet_address,
             capital::text AS capital, plan, risk_limits, blocked_by, last_error,
             created_at, updated_at, started_at, stopped_at`,
          [
            candidate.id,
            plan.strategyId,
            plan.chainId,
            body.walletAddress.replace(/^0x/i, ''),
            body.capital,
            JSON.stringify(plan),
            JSON.stringify(plan.riskLimits),
            JSON.stringify(blockedBy),
          ],
        );
        return reply.code(201).send(rows[0]);
      } catch (err) {
        return reply.code(503).send({
          error: 'unable to create aave liquidation replay live run request',
          detail: (err as Error).message,
        });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/aave-liquidation-candidates/:id/execution-plan',
    async (req, reply) => {
      const artifacts = await loadAaveLiquidationArtifacts();
      if (!artifacts) {
        return reply.code(404).send({
          error: 'aave liquidation candidate artifacts not found',
          hint: 'run LIQ_CHAIN=base npm run search:liquidations and repeat for configured chains',
        });
      }
      const candidate = artifacts.candidates.find((c) => c.id === req.params.id);
      if (!candidate) return reply.code(404).send({ error: 'aave liquidation candidate not found' });
      return buildAaveLiquidationExecutionPlan(candidate, (req.body ?? {}) as ExecutionPlanRequest);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/aave-liquidation-candidates/:id/live-runs',
    async (req, reply) => {
      try {
        const artifacts = await loadAaveLiquidationArtifacts();
        if (!artifacts) {
          return reply.code(404).send({
            error: 'aave liquidation candidate artifacts not found',
            hint: 'run LIQ_CHAIN=base npm run search:liquidations and repeat for configured chains',
          });
        }
        const candidate = artifacts.candidates.find((c) => c.id === req.params.id);
        if (!candidate) return reply.code(404).send({ error: 'aave liquidation candidate not found' });

        const body = (req.body ?? {}) as LiveRunRequest;
        if (!body.walletAddress) {
          return reply.code(400).send({ error: 'walletAddress is required to create a live run' });
        }
        if (!body.capital || Number(body.capital) <= 0) {
          return reply.code(400).send({ error: 'capital must be a positive base-unit amount' });
        }

        const plan = buildAaveLiquidationExecutionPlan(candidate, body);
        const blockedBy = [
          ...plan.blockedBy,
          'Aave liquidation live worker is not enabled; route execution remains dry-run only',
          'no transaction is submitted by this API call',
        ];
        const rows = await query<LiveRunRecord>(
          `INSERT INTO live_strategy_runs
             (candidate_id, strategy_id, status, chain_id, wallet_address, capital, plan, risk_limits, blocked_by)
           VALUES ($1, $2, 'blocked', $3, decode($4,'hex'), $5, $6, $7, $8)
           RETURNING id, candidate_id, strategy_id, status, chain_id,
             '0x' || encode(wallet_address, 'hex') AS wallet_address,
             capital::text AS capital, plan, risk_limits, blocked_by, last_error,
             created_at, updated_at, started_at, stopped_at`,
          [
            candidate.id,
            plan.strategyId,
            plan.chainId,
            body.walletAddress.replace(/^0x/i, ''),
            body.capital,
            JSON.stringify(plan),
            JSON.stringify(plan.riskLimits),
            JSON.stringify(blockedBy),
          ],
        );
        return reply.code(201).send(rows[0]);
      } catch (err) {
        return reply.code(503).send({
          error: 'unable to create aave liquidation live run request',
          detail: (err as Error).message,
        });
      }
    },
  );

  app.get('/api/compound-v3-liquidation-candidates/artifacts', async (_req, reply) => {
    const artifacts = await loadCompoundV3LiquidationArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'compound v3 liquidation candidate artifacts not found',
        hint: 'run COMP_LIQ_CHAIN=ethereum npm run search:compound-liquidations',
      });
    }
    return artifacts;
  });

  app.get('/api/compound-v3-liquidation-candidates', async (_req, reply) => {
    const artifacts = await loadCompoundV3LiquidationArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'compound v3 liquidation candidate artifacts not found',
        hint: 'run COMP_LIQ_CHAIN=ethereum npm run search:compound-liquidations',
      });
    }
    return artifacts.candidates;
  });

  app.post<{ Params: { id: string } }>(
    '/api/compound-v3-liquidation-candidates/:id/execution-plan',
    async (req, reply) => {
      const artifacts = await loadCompoundV3LiquidationArtifacts();
      if (!artifacts) {
        return reply.code(404).send({
          error: 'compound v3 liquidation candidate artifacts not found',
          hint: 'run COMP_LIQ_CHAIN=ethereum npm run search:compound-liquidations',
        });
      }
      const candidate = artifacts.candidates.find((c) => c.id === req.params.id);
      if (!candidate) {
        return reply.code(404).send({ error: 'compound v3 liquidation candidate not found' });
      }
      return buildCompoundV3LiquidationExecutionPlan(
        candidate,
        (req.body ?? {}) as ExecutionPlanRequest,
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/compound-v3-liquidation-candidates/:id/live-runs',
    async (req, reply) => {
      try {
        const artifacts = await loadCompoundV3LiquidationArtifacts();
        if (!artifacts) {
          return reply.code(404).send({
            error: 'compound v3 liquidation candidate artifacts not found',
            hint: 'run COMP_LIQ_CHAIN=ethereum npm run search:compound-liquidations',
          });
        }
        const candidate = artifacts.candidates.find((c) => c.id === req.params.id);
        if (!candidate) {
          return reply.code(404).send({ error: 'compound v3 liquidation candidate not found' });
        }

        const body = (req.body ?? {}) as LiveRunRequest;
        if (!body.walletAddress) {
          return reply.code(400).send({ error: 'walletAddress is required to create a live run' });
        }
        if (!body.capital || Number(body.capital) <= 0) {
          return reply.code(400).send({ error: 'capital must be a positive base-unit amount' });
        }

        const plan = buildCompoundV3LiquidationExecutionPlan(candidate, body);
        const blockedBy = [
          ...plan.blockedBy,
          'Compound V3 liquidation live worker is not enabled; route execution remains dry-run only',
          'no transaction is submitted by this API call',
        ];
        const rows = await query<LiveRunRecord>(
          `INSERT INTO live_strategy_runs
             (candidate_id, strategy_id, status, chain_id, wallet_address, capital, plan, risk_limits, blocked_by)
           VALUES ($1, $2, 'blocked', $3, decode($4,'hex'), $5, $6, $7, $8)
           RETURNING id, candidate_id, strategy_id, status, chain_id,
             '0x' || encode(wallet_address, 'hex') AS wallet_address,
             capital::text AS capital, plan, risk_limits, blocked_by, last_error,
             created_at, updated_at, started_at, stopped_at`,
          [
            candidate.id,
            plan.strategyId,
            plan.chainId,
            body.walletAddress.replace(/^0x/i, ''),
            body.capital,
            JSON.stringify(plan),
            JSON.stringify(plan.riskLimits),
            JSON.stringify(blockedBy),
          ],
        );
        return reply.code(201).send(rows[0]);
      } catch (err) {
        return reply.code(503).send({
          error: 'unable to create compound v3 liquidation live run request',
          detail: (err as Error).message,
        });
      }
    },
  );

  app.get('/api/morpho-blue-liquidation-candidates/artifacts', async (_req, reply) => {
    const artifacts = await loadMorphoBlueLiquidationArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'morpho blue liquidation candidate artifacts not found',
        hint: 'run MORPHO_LIQ_CHAIN=ethereum npm run search:morpho-liquidations',
      });
    }
    return artifacts;
  });

  app.get('/api/morpho-blue-liquidation-candidates', async (_req, reply) => {
    const artifacts = await loadMorphoBlueLiquidationArtifacts();
    if (!artifacts) {
      return reply.code(404).send({
        error: 'morpho blue liquidation candidate artifacts not found',
        hint: 'run MORPHO_LIQ_CHAIN=ethereum npm run search:morpho-liquidations',
      });
    }
    return artifacts.candidates;
  });

  app.get('/api/morpho-blue-liquidation-watchlist', async (_req, reply) => {
    const watchlist = await loadMorphoBlueLiquidationWatchlist();
    if (!watchlist) {
      return reply.code(404).send({
        error: 'morpho blue liquidation watchlist not found',
        hint: 'run npm run watch:morpho-liquidations after search:morpho-liquidations and replay:morpho-liquidations',
      });
    }
    return watchlist;
  });

  app.post<{ Params: { id: string } }>(
    '/api/morpho-blue-liquidation-candidates/:id/execution-plan',
    async (req, reply) => {
      const artifacts = await loadMorphoBlueLiquidationArtifacts();
      if (!artifacts) {
        return reply.code(404).send({
          error: 'morpho blue liquidation candidate artifacts not found',
          hint: 'run MORPHO_LIQ_CHAIN=ethereum npm run search:morpho-liquidations',
        });
      }
      const candidate = artifacts.candidates.find((c) => c.id === req.params.id);
      if (!candidate) {
        return reply.code(404).send({ error: 'morpho blue liquidation candidate not found' });
      }
      return buildMorphoBlueLiquidationExecutionPlan(
        candidate,
        (req.body ?? {}) as ExecutionPlanRequest,
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/morpho-blue-liquidation-candidates/:id/live-runs',
    async (req, reply) => {
      try {
        const artifacts = await loadMorphoBlueLiquidationArtifacts();
        if (!artifacts) {
          return reply.code(404).send({
            error: 'morpho blue liquidation candidate artifacts not found',
            hint: 'run MORPHO_LIQ_CHAIN=ethereum npm run search:morpho-liquidations',
          });
        }
        const candidate = artifacts.candidates.find((c) => c.id === req.params.id);
        if (!candidate) {
          return reply.code(404).send({ error: 'morpho blue liquidation candidate not found' });
        }

        const body = (req.body ?? {}) as LiveRunRequest;
        if (!body.walletAddress) {
          return reply.code(400).send({ error: 'walletAddress is required to create a live run' });
        }
        if (!body.capital || Number(body.capital) <= 0) {
          return reply.code(400).send({ error: 'capital must be a positive base-unit amount' });
        }

        const plan = buildMorphoBlueLiquidationExecutionPlan(candidate, body);
        const blockedBy = [
          ...plan.blockedBy,
          'Morpho Blue liquidation live worker is not enabled; route execution remains dry-run only',
          'no transaction is submitted by this API call',
        ];
        const rows = await query<LiveRunRecord>(
          `INSERT INTO live_strategy_runs
             (candidate_id, strategy_id, status, chain_id, wallet_address, capital, plan, risk_limits, blocked_by)
           VALUES ($1, $2, 'blocked', $3, decode($4,'hex'), $5, $6, $7, $8)
           RETURNING id, candidate_id, strategy_id, status, chain_id,
             '0x' || encode(wallet_address, 'hex') AS wallet_address,
             capital::text AS capital, plan, risk_limits, blocked_by, last_error,
             created_at, updated_at, started_at, stopped_at`,
          [
            candidate.id,
            plan.strategyId,
            plan.chainId,
            body.walletAddress.replace(/^0x/i, ''),
            body.capital,
            JSON.stringify(plan),
            JSON.stringify(plan.riskLimits),
            JSON.stringify(blockedBy),
          ],
        );
        return reply.code(201).send(rows[0]);
      } catch (err) {
        return reply.code(503).send({
          error: 'unable to create morpho blue liquidation live run request',
          detail: (err as Error).message,
        });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/dex-arbitrage-candidates/:id/execution-plan',
    async (req, reply) => {
      const artifacts = await loadDexArbitrageArtifacts();
      if (!artifacts) {
        return reply.code(404).send({
          error: 'dex arbitrage candidate artifacts not found',
          hint: 'run DEX_ARB_CHAIN=base npm run search:dex-arb and DEX_ARB_CHAIN=arbitrum npm run search:dex-arb',
        });
      }
      const candidate = artifacts.candidates.find((c) => c.id === req.params.id);
      if (!candidate) return reply.code(404).send({ error: 'dex arbitrage candidate not found' });
      return buildDexArbitrageExecutionPlan(candidate, (req.body ?? {}) as ExecutionPlanRequest);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/dex-arbitrage-candidates/:id/live-runs',
    async (req, reply) => {
      try {
        const artifacts = await loadDexArbitrageArtifacts();
        if (!artifacts) {
          return reply.code(404).send({
            error: 'dex arbitrage candidate artifacts not found',
            hint: 'run DEX_ARB_CHAIN=base npm run search:dex-arb and repeat for configured chains',
          });
        }
        const candidate = artifacts.candidates.find((c) => c.id === req.params.id);
        if (!candidate) return reply.code(404).send({ error: 'dex arbitrage candidate not found' });

        const body = (req.body ?? {}) as LiveRunRequest;
        if (!body.walletAddress) {
          return reply.code(400).send({ error: 'walletAddress is required to create a live run' });
        }
        if (!body.capital || Number(body.capital) <= 0) {
          return reply.code(400).send({ error: 'capital must be a positive base-unit amount' });
        }

        const plan = buildDexArbitrageExecutionPlan(candidate, body);
        const blockedBy = [
          ...plan.blockedBy,
          'pure DEX live worker is not enabled; route execution remains dry-run only',
          'no transaction is submitted by this API call',
        ];
        const rows = await query<LiveRunRecord>(
          `INSERT INTO live_strategy_runs
             (candidate_id, strategy_id, status, chain_id, wallet_address, capital, plan, risk_limits, blocked_by)
           VALUES ($1, $2, 'blocked', $3, decode($4,'hex'), $5, $6, $7, $8)
           RETURNING id, candidate_id, strategy_id, status, chain_id,
             '0x' || encode(wallet_address, 'hex') AS wallet_address,
             capital::text AS capital, plan, risk_limits, blocked_by, last_error,
             created_at, updated_at, started_at, stopped_at`,
          [
            candidate.id,
            plan.strategyId,
            plan.chainId,
            body.walletAddress.replace(/^0x/i, ''),
            body.capital,
            JSON.stringify(plan),
            JSON.stringify(plan.riskLimits),
            JSON.stringify(blockedBy),
          ],
        );
        return reply.code(201).send(rows[0]);
      } catch (err) {
        return reply
          .code(503)
          .send({ error: 'unable to create dex live run request', detail: (err as Error).message });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/strategy-candidates/:id/event-replay',
    async (req, reply) => {
      const candidates = await loadCandidates();
      if (!candidates.some((c) => c.id === req.params.id)) {
        return reply.code(404).send({ error: 'candidate not found' });
      }
      const replay = await loadCandidateEventReplay(req.params.id);
      if (!replay) {
        return reply.code(404).send({
          error: 'event replay artifact not found',
          hint: `run node scripts/replay-uniswap-v3-lp-fees.mjs ${req.params.id}`,
        });
      }
      return replay;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/strategy-candidates/:id/execution-plan',
    async (req, reply) => {
      try {
        const candidates = await loadCandidates();
        const candidate = candidates.find((c) => c.id === req.params.id);
        if (!candidate) return reply.code(404).send({ error: 'candidate not found' });
        return buildCandidateExecutionPlan(candidate, (req.body ?? {}) as ExecutionPlanRequest);
      } catch (err) {
        return reply
          .code(503)
          .send({ error: 'strategy candidates unavailable', detail: (err as Error).message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/strategy-candidates/:id/live-runs',
    async (req, reply) => {
      try {
        const candidates = await loadCandidates();
        const candidate = candidates.find((c) => c.id === req.params.id);
        if (!candidate) return reply.code(404).send({ error: 'candidate not found' });

        const body = (req.body ?? {}) as LiveRunRequest;
        if (!body.walletAddress) {
          return reply.code(400).send({ error: 'walletAddress is required to create a live run' });
        }
        if (!body.capital || Number(body.capital) <= 0) {
          return reply.code(400).send({ error: 'capital must be a positive base-unit amount' });
        }

        const plan = buildCandidateExecutionPlan(candidate, body);
        const blockedBy = [
          ...plan.blockedBy,
          'live run is queued for worker preflight; no transaction is submitted by this API call',
        ];
        const rows = await query<LiveRunRecord>(
          `INSERT INTO live_strategy_runs
             (candidate_id, strategy_id, status, chain_id, wallet_address, capital, plan, risk_limits, blocked_by)
           VALUES ($1, $2, 'queued', $3, decode($4,'hex'), $5, $6, $7, $8)
           RETURNING id, candidate_id, strategy_id, status, chain_id,
             '0x' || encode(wallet_address, 'hex') AS wallet_address,
             capital::text AS capital, plan, risk_limits, blocked_by, last_error,
             created_at, updated_at, started_at, stopped_at`,
          [
            candidate.id,
            plan.strategyId,
            plan.chainId,
            body.walletAddress.replace(/^0x/i, ''),
            body.capital,
            JSON.stringify(plan),
            JSON.stringify(plan.riskLimits),
            JSON.stringify(blockedBy),
          ],
        );
        return reply.code(201).send(rows[0]);
      } catch (err) {
        return reply
          .code(503)
          .send({ error: 'unable to create live run', detail: (err as Error).message });
      }
    },
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

  // -- Phase 5: vault allocation + strategy start/stop -----------------------
  app.post<{ Params: { id: string } }>('/api/vaults/:id/allocate', async (req, reply) => {
    const body = req.body as { userAddress: string; strategyId: string; amountUsd: number };
    if (!body?.userAddress || !body?.strategyId || !body?.amountUsd) {
      return reply.code(400).send({ error: 'missing userAddress, strategyId, or amountUsd' });
    }
    const rows = await query(
      `INSERT INTO user_vault_allocations (user_address, vault_id, strategy_id, chain_id, allocated_usd, status)
       VALUES (decode($1,'hex'), $2, $3,
         (SELECT chain_id FROM vaults WHERE id = $2 LIMIT 1),
         $4, 'pending')
       RETURNING id, status`,
      [body.userAddress.replace(/^0x/i, ''), req.params.id, body.strategyId, body.amountUsd],
    );
    return { allocationId: rows[0]?.id, status: rows[0]?.status };
  });

  app.post<{ Params: { id: string } }>('/api/vaults/:id/start', async (req, reply) => {
    const body = req.body as { allocationId: string; userAddress: string };
    if (!body?.allocationId) {
      return reply.code(400).send({ error: 'missing allocationId' });
    }
    // Activate the allocation and create a live_strategy_run.
    const alloc = await query(
      `UPDATE user_vault_allocations SET status='active', started_at=now(), updated_at=now()
       WHERE id=$1 RETURNING strategy_id, vault_id, chain_id, allocated_usd`,
      [body.allocationId],
    );
    if (!alloc.length) return reply.code(404).send({ error: 'allocation not found' });
    const a = alloc[0];
    const run = await query(
      `INSERT INTO live_strategy_runs (allocation_id, user_address, strategy_id, vault_id, chain_id, status, capital_usd)
       VALUES ($1, decode($2,'hex'), $3, $4, $5, 'active', $6)
       RETURNING id, status`,
      [body.allocationId, (body.userAddress ?? '').replace(/^0x/i, ''), a.strategy_id, a.vault_id, a.chain_id, a.allocated_usd],
    );
    return { runId: run[0]?.id, status: run[0]?.status };
  });

  app.post<{ Params: { id: string } }>('/api/vaults/:id/stop', async (req, reply) => {
    const body = req.body as { runId: string };
    if (!body?.runId) return reply.code(400).send({ error: 'missing runId' });
    const run = await query(
      `UPDATE live_strategy_runs SET status='stopped', stopped_at=now()
       WHERE id=$1 RETURNING id, realized_pnl, execution_count`,
      [body.runId],
    );
    if (!run.length) return reply.code(404).send({ error: 'run not found' });
    // Also update the allocation.
    await query(
      `UPDATE user_vault_allocations SET status='stopped', stopped_at=now(), updated_at=now()
       WHERE id = (SELECT allocation_id FROM live_strategy_runs WHERE id=$1)`,
      [body.runId],
    );
    return { runId: run[0].id, status: 'stopped', pnl: run[0].realized_pnl, executions: run[0].execution_count };
  });

  app.get<{ Params: { id: string } }>('/api/vaults/:id/allocations', async (req) => {
    return query(
      `SELECT id, strategy_id, allocated_usd, status, started_at, stopped_at, realized_pnl
       FROM user_vault_allocations WHERE vault_id = $1 ORDER BY created_at DESC`,
      [req.params.id],
    );
  });

  // -- live -------------------------------------------------------------------
  app.get('/api/live/opportunity-feed', async (_req, reply) => {
    try {
      return await loadLiveOpportunityFeed();
    } catch (err) {
      return reply.code(404).send({
        error: 'live opportunity feed not found',
        detail: (err as Error).message,
        hint: 'run npm run build:live-opportunity-feed or npm run node:scanner',
      });
    }
  });

  app.get('/api/live/executor-status', async (_req, reply) => {
    try {
      return await loadExecutorNodeStatus();
    } catch (err) {
      return reply.code(404).send({
        error: 'executor node status not found',
        detail: (err as Error).message,
        hint: 'run ARB_NODE_ONCE=1 npm run node:executor',
      });
    }
  });

  app.get<{ Querystring: { capitalUsd?: string } }>(
    '/api/live/execution-decision',
    async (req, reply) => {
      try {
        const feed = await loadLiveOpportunityFeed();
        let verification: Record<string, unknown> | null = null;
        try {
          verification = await loadLiveForkVerification();
        } catch {
          verification = null;
        }
        const capitalUsd = Number(req.query.capitalUsd ?? process.env.EXECUTOR_CAPITAL_USD ?? 0);
        return buildExecutorExecutionDecision(feed, verification, {
          capitalUsd: Number.isFinite(capitalUsd) && capitalUsd >= 0 ? capitalUsd : 0,
        });
      } catch (err) {
        return reply.code(404).send({
          error: 'execution decision unavailable',
          detail: (err as Error).message,
          hint: 'run npm run build:live-opportunity-feed and optionally npm run node:executor',
        });
      }
    },
  );

  app.get('/api/live/automation-sessions', async () => {
    const sessions = await readLiveAutomationSessions();
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sessionCount: sessions.length,
      sessions: sessions.slice(0, 100),
    };
  });

  app.get('/api/live/execution-queue', async () => {
    return readLiveExecutionQueue();
  });

  app.post<{ Body: LiveAutomationSessionRequest }>(
    '/api/live/automation-sessions',
    async (req, reply) => {
      const body = (req.body ?? {}) as LiveAutomationSessionRequest;
      const walletAddress = normalizeAddress(body.walletAddress);
      if (!walletAddress) {
        return reply.code(400).send({ error: 'walletAddress must be a 20-byte 0x address' });
      }
      const capitalUsd = Number(body.capitalUsd);
      if (!Number.isFinite(capitalUsd) || capitalUsd <= 0) {
        return reply.code(400).send({ error: 'capitalUsd must be a positive number' });
      }
      const authorization = body.authorization ?? {};
      if (!isValidPersonalSignature(authorization.signature)) {
        return reply.code(400).send({
          error: 'wallet authorization signature is required',
          hint: 'sign the live automation authorization message with the connected wallet',
        });
      }

      try {
        const feed = await loadLiveOpportunityFeed();
        let verification: Record<string, unknown> | null = null;
        try {
          verification = await loadLiveForkVerification();
        } catch {
          verification = null;
        }
        const decision = buildExecutorExecutionDecision(feed, verification, { capitalUsd });
        const selectedFamilies = normalizeStrategyFamilies(body.strategyFamilies, feed);
        const selectedRows = (Array.isArray(decision.opportunityDecisions)
          ? decision.opportunityDecisions
          : []
        ).filter((row: Record<string, unknown>) =>
          selectedFamilies.includes(String(row.familyKey ?? '')),
        );
        const selectedPreForkReadyCount = selectedRows.filter((row) => row.preForkReady === true).length;
        const selectedSubmitReadyCount = selectedRows.filter((row) => row.submitReady === true).length;
        const status =
          selectedSubmitReadyCount > 0
            ? 'armed-submit-ready'
            : selectedPreForkReadyCount > 0
              ? 'waiting-fork-verification'
              : 'blocked-no-submit-ready-opportunity';
        const reason =
          selectedSubmitReadyCount > 0
            ? 'selected strategy set has submit-ready opportunities under current executor gates'
            : selectedPreForkReadyCount > 0
              ? 'selected strategy set has pre-fork-ready opportunities; fork verification must pass before submission'
              : 'no selected strategy currently passes scanner, sizing, depth, return, freshness, fork, production, signer, and relay gates';
        const now = new Date().toISOString();
        const session: LiveAutomationSession = {
          schemaVersion: 1,
          id: `las-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`,
          createdAt: now,
          updatedAt: now,
          walletAddress,
          walletChainId: body.walletChainId ?? null,
          capitalUsd,
          strategyFamilies: selectedFamilies,
          mode: body.mode === 'production' ? 'production' : 'paper',
          status,
          reason,
          authorization: {
            message: String(authorization.message ?? ''),
            signature: String(authorization.signature),
            signedAt: String(authorization.signedAt ?? now),
          },
          decisionSummary: decision.summary ?? {},
          selectedOpportunityCount: selectedRows.length,
          selectedPreForkReadyCount,
          selectedSubmitReadyCount,
          selectedTop: selectedRows.slice(0, 12).map((row) => ({
            id: row.id,
            familyKey: row.familyKey,
            chain: row.chain,
            status: row.status,
            executorAction: row.executorAction,
            recommendedCapitalUsd: row.recommendedCapitalUsd,
            blockingChecks: row.blockingChecks,
            waitingChecks: row.waitingChecks,
          })),
        };
        const sessions = await readLiveAutomationSessions();
        await writeLiveAutomationSessions([session, ...sessions].slice(0, 200));
        return reply.code(201).send(session);
      } catch (err) {
        return reply.code(404).send({
          error: 'live automation session could not be created',
          detail: (err as Error).message,
          hint: 'run npm run build:live-opportunity-feed and ARB_NODE_ONCE=1 npm run node:executor first',
        });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/live/automation-sessions/:id/stop',
    async (req, reply) => {
      const sessions = await readLiveAutomationSessions();
      const index = sessions.findIndex((session) => session.id === req.params.id);
      if (index < 0) return reply.code(404).send({ error: 'automation session not found' });
      const now = new Date().toISOString();
      const stopped = {
        ...sessions[index],
        status: 'stopped',
        reason: req.body?.reason ?? 'stopped by wallet/user request',
        stoppedAt: now,
        updatedAt: now,
        selectedPreForkReadyCount: 0,
        selectedSubmitReadyCount: 0,
      };
      const next = [...sessions];
      next[index] = stopped;
      await writeLiveAutomationSessions(next);
      return stopped;
    },
  );

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

  app.get('/api/live/runs', async () => {
    return query<LiveRunRecord>(
      `SELECT id, candidate_id, strategy_id, status, chain_id,
         CASE WHEN wallet_address IS NULL THEN NULL ELSE '0x' || encode(wallet_address, 'hex') END AS wallet_address,
         capital::text AS capital, plan, risk_limits, blocked_by, last_error,
         created_at, updated_at, started_at, stopped_at
       FROM live_strategy_runs
       ORDER BY created_at DESC LIMIT 100`,
    );
  });

  app.get<{ Params: { id: string } }>('/api/live/runs/:id', async (req, reply) => {
    const rows = await query<LiveRunRecord & Record<string, unknown>>(
      `SELECT r.id, r.candidate_id, r.strategy_id, r.status, r.chain_id,
         CASE WHEN r.wallet_address IS NULL THEN NULL ELSE '0x' || encode(r.wallet_address, 'hex') END AS wallet_address,
         r.capital::text AS capital, r.plan, r.risk_limits, r.blocked_by, r.last_error,
         r.created_at, r.updated_at, r.started_at, r.stopped_at,
         p.report AS latest_preflight,
         f.result AS latest_fork_simulation
       FROM live_strategy_runs r
       LEFT JOIN LATERAL (
         SELECT report FROM live_run_preflights WHERE run_id = r.id ORDER BY created_at DESC LIMIT 1
       ) p ON true
       LEFT JOIN LATERAL (
         SELECT result FROM live_run_fork_simulations WHERE run_id = r.id ORDER BY created_at DESC LIMIT 1
       ) f ON true
       WHERE r.id = $1`,
      [req.params.id],
    );
    if (!rows.length) return reply.code(404).send({ error: 'not found' });
    const row = rows[0];
    const eventReplay = await loadCandidateEventReplay(String(row.candidate_id));
    return {
      ...row,
      event_replay_evidence: eventReplay,
      readiness: buildLiveRunReadiness(row, eventReplay),
    };
  });

  app.post<{ Params: { id: string } }>(
    '/api/live/runs/:id/rerun-preflight',
    async (req, reply) => {
      const rows = await query<LiveRunRecord>(
        `UPDATE live_strategy_runs
         SET status='queued',
             blocked_by=$2,
             last_error=NULL,
             updated_at=now()
         WHERE id=$1
           AND status IN ('queued', 'preflight', 'blocked', 'ready')
         RETURNING id, candidate_id, strategy_id, status, chain_id,
           CASE WHEN wallet_address IS NULL THEN NULL ELSE '0x' || encode(wallet_address, 'hex') END AS wallet_address,
           capital::text AS capital, plan, risk_limits, blocked_by, last_error,
           created_at, updated_at, started_at, stopped_at`,
        [
          req.params.id,
          JSON.stringify([
            'live run queued for refreshed worker preflight; no transaction is submitted by this API call',
          ]),
        ],
      );
      if (!rows.length) {
        const existing = await query<{ status: string }>(
          'SELECT status FROM live_strategy_runs WHERE id=$1',
          [req.params.id],
        );
        if (!existing.length) return reply.code(404).send({ error: 'not found' });
        return reply.code(409).send({
          error: 'live run cannot be re-queued from its current status',
          status: existing[0].status,
        });
      }
      return rows[0];
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/live/runs/:id/fork-simulation',
    async (req, reply) => {
      const exists = await query<{ id: string }>('SELECT id FROM live_strategy_runs WHERE id=$1', [
        req.params.id,
      ]);
      if (!exists.length) return reply.code(404).send({ error: 'not found' });
      try {
        const result = await runForkSimulation(req.params.id);
        await query(
          `INSERT INTO live_run_fork_simulations
             (run_id, status, exit_code, summary, result, stdout, stderr)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            req.params.id,
            result.status,
            result.exitCode,
            result.summary,
            JSON.stringify(result),
            result.stdout,
            result.stderr,
          ],
        );
        return result;
      } catch (err) {
        return reply
          .code(503)
          .send({ error: 'fork simulation failed to start', detail: (err as Error).message });
      }
    },
  );

  app.get<{ Params: { id: string } }>('/api/live/runs/:id/preflight', async (req, reply) => {
    const rows = await query(
      `SELECT id, run_id, status, report, created_at
       FROM live_run_preflights
       WHERE run_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.params.id],
    );
    if (!rows.length) return reply.code(404).send({ error: 'preflight report not found' });
    return rows[0];
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
  app.get('/stream/live/opportunities', async (req, reply) =>
    sseStream(req, reply, opportunitiesFeed),
  );
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
      const rows = await query(
        'SELECT status, metrics, finished_at FROM backtest_runs WHERE id = $1',
        [runId],
      );
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

async function runForkSimulation(runId: string): Promise<{
  runId: string;
  status: 'passed' | 'failed';
  exitCode: number | null;
  summary: string | null;
  details?: unknown;
  stdout: string;
  stderr: string;
}> {
  const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const child = spawn('node', ['scripts/fork-simulate-live-run.mjs', runId], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PATH: `${process.env.HOME ?? ''}/.foundry/bin:${process.env.PATH ?? ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timeoutMs = Math.max(30_000, Number(process.env.FORK_SIMULATION_TIMEOUT_MS ?? 240_000));
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`fork simulation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  const summary =
    stdout
      .split(/\r?\n/)
      .reverse()
      .find((line) => line.startsWith('forkSimulation=')) ?? null;
  const details = parseForkSimulationReport(stdout);
  return {
    runId,
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    summary,
    ...(details === undefined ? {} : { details }),
    stdout,
    stderr,
  };
}

function parseForkSimulationReport(stdout: string): unknown | undefined {
  const prefix = 'forkSimulationReport=';
  const line = stdout
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(prefix));
  if (!line) return undefined;
  try {
    return JSON.parse(line.slice(prefix.length));
  } catch {
    return undefined;
  }
}

function buildLiveRunReadiness(
  row: Record<string, unknown>,
  eventReplay: CandidateEventReplayArtifact | null,
): {
  status: 'ready' | 'blocked';
  generatedAt: string;
  gates: Array<{
    key: string;
    status: 'pass' | 'warn' | 'block';
    message: string;
    evidence?: Record<string, unknown>;
  }>;
  blockers: string[];
} {
  const preflight = (row.latest_preflight ?? null) as Record<string, any> | null;
  const fork = (row.latest_fork_simulation ?? null) as Record<string, any> | null;
  const plan = (row.plan ?? null) as Record<string, any> | null;
  const walletPreflight = preflight?.walletPreflight;
  const gasPreflight = preflight?.gasPreflight;
  const callSimulation = preflight?.callSimulation;
  const isPureArbitrage = plan?.evidence?.isPureArbitrage;
  const profitabilityGate = buildProfitabilityGate(eventReplay);
  const liveExecutionEnabled = ['1', 'true', 'yes', 'y'].includes(
    String(process.env.LIVE_EXECUTION_ENABLED ?? '').toLowerCase(),
  );
  const previewCalls = Array.isArray(preflight?.transactionPreview?.calls)
    ? preflight.transactionPreview.calls
    : [];
  const executableCalls = previewCalls.filter((call: Record<string, unknown>) => call.kind !== 'approval');
  const executionTarget =
    preflight?.execution?.target ??
    plan?.targetContract?.address ??
    plan?.executor?.address ??
    null;
  const productionAdapterGate =
    !liveExecutionEnabled
      ? {
          key: 'production-adapter',
          status: 'block' as const,
          message:
            'production transaction submission is disabled; set LIVE_EXECUTION_ENABLED=1 only after audited deployment and fork evidence are in place',
          evidence: { liveExecutionEnabled, executionTarget, executableCallCount: executableCalls.length },
        }
      : preflight?.transactionPreview?.status !== 'ready'
        ? {
            key: 'production-adapter',
            status: 'block' as const,
            message: 'transaction preview must be ready before production execution',
            evidence: { liveExecutionEnabled, transactionPreviewStatus: preflight?.transactionPreview?.status ?? null },
          }
        : executableCalls.length === 0
          ? {
              key: 'production-adapter',
              status: 'block' as const,
              message: 'no executable strategy transaction is available after approvals',
              evidence: { liveExecutionEnabled, executableCallCount: executableCalls.length },
            }
          : !executionTarget
            ? {
                key: 'production-adapter',
                status: 'block' as const,
                message: 'production executor or target contract is missing',
                evidence: { liveExecutionEnabled, executionTarget },
              }
            : fork?.status !== 'passed'
              ? {
                  key: 'production-adapter',
                  status: 'block' as const,
                  message: 'ordered fork simulation must pass before production execution',
                  evidence: { liveExecutionEnabled, forkStatus: fork?.status ?? null },
                }
              : {
                  key: 'production-adapter',
                  status: 'pass' as const,
                  message: `production execution enabled for ${executableCalls.length} strategy call(s) through ${executionTarget}`,
                  evidence: { liveExecutionEnabled, executionTarget, executableCallCount: executableCalls.length },
                };
  const gates: ReturnType<typeof buildLiveRunReadiness>['gates'] = [
    {
      key: 'preflight-report',
      status: preflight ? 'pass' : 'block',
      message: preflight ? `latest preflight ${preflight.status}` : 'worker preflight report missing',
    },
    {
      key: 'quote',
      status: ['partial', 'ready'].includes(preflight?.quote?.status) ? 'pass' : 'block',
      message: preflight?.quote?.status
        ? `quote ${preflight.quote.status}`
        : 'token quote missing',
      evidence: preflight?.quote,
    },
    {
      key: 'pool-state',
      status: preflight?.poolState?.status === 'ready' ? 'pass' : 'block',
      message:
        preflight?.poolState?.status === 'ready'
          ? `pool ${preflight.poolState.poolAddress}`
          : 'pool state missing',
      evidence: preflight?.poolState,
    },
    {
      key: 'transaction-preview',
      status: preflight?.transactionPreview?.status === 'ready' ? 'pass' : 'block',
      message:
        preflight?.transactionPreview?.status === 'ready'
          ? `${preflight.transactionPreview.calls?.length ?? 0} preview calls ready`
          : 'transaction preview missing',
    },
    {
      key: 'wallet-allowance',
      status:
        walletPreflight?.status === 'ready'
          ? 'pass'
          : walletPreflight?.status === 'needs-approval'
            ? 'warn'
            : 'block',
      message:
        walletPreflight?.status === 'ready'
          ? 'wallet balances and allowances are sufficient'
          : walletPreflight?.status === 'needs-approval'
            ? 'wallet must sign approval calls before live mint'
            : 'wallet balance/allowance preflight missing or blocked',
      evidence: walletPreflight,
    },
    {
      key: 'gas-budget',
      status: gasPreflight?.maxGasOk === true ? 'pass' : gasPreflight ? 'warn' : 'block',
      message:
        gasPreflight?.maxGasOk === true
          ? `estimated gas cost ${gasPreflight.estimatedCostUsd ?? 'n/a'} USD within max ${
              gasPreflight.maxGasUsd ?? 'n/a'
            }`
          : gasPreflight
            ? gasPreflight.costError ?? 'gas estimate incomplete until approvals are confirmed'
            : 'gas preflight missing',
      evidence: gasPreflight,
    },
    {
      key: 'read-only-call-simulation',
      status:
        callSimulation?.status === 'passed'
          ? 'pass'
          : callSimulation?.status === 'partial'
            ? 'warn'
            : 'block',
      message:
        callSimulation?.status === 'passed'
          ? 'all preview calls pass eth_call'
          : callSimulation?.status === 'partial'
            ? 'approval calls pass; mint needs ordered fork state'
            : 'read-only call simulation missing or failed',
      evidence: callSimulation,
    },
    {
      key: 'ordered-fork-simulation',
      status: fork?.status === 'passed' ? 'pass' : 'block',
      message:
        fork?.status === 'passed'
          ? fork.summary ?? 'ordered fork simulation passed'
          : fork?.summary ?? 'ordered Anvil fork simulation has not passed',
      evidence: fork ?? undefined,
    },
    profitabilityGate,
    productionAdapterGate,
    {
      key: 'pure-arbitrage',
      status: isPureArbitrage === true ? 'pass' : 'block',
      message:
        isPureArbitrage === true
          ? 'candidate is marked pure arbitrage'
          : 'candidate is not verified pure arbitrage and must not be promised as fixed yield',
      evidence: { isPureArbitrage: isPureArbitrage ?? null },
    },
  ];
  const blockers = gates
    .filter((gate) => gate.status === 'block')
    .map((gate) => `${gate.key}: ${gate.message}`);
  return {
    status: blockers.length ? 'blocked' : 'ready',
    generatedAt: new Date().toISOString(),
    gates,
    blockers,
  };
}

async function readLiveAutomationSessions(): Promise<LiveAutomationSession[]> {
  try {
    const body = JSON.parse(await readFile(AUTOMATION_SESSIONS_PATH, 'utf8')) as {
      sessions?: LiveAutomationSession[];
    };
    return Array.isArray(body.sessions) ? body.sessions : [];
  } catch {
    return [];
  }
}

async function readLiveExecutionQueue(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(LIVE_EXECUTION_QUEUE_PATH, 'utf8')) as Record<string, unknown>;
  } catch {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: 'missing-execution-queue',
      hint: 'run ARB_NODE_ONCE=1 npm run node:executor',
      summary: {
        sessionCount: 0,
        activeSessionCount: 0,
        taskCount: 0,
        submitTaskCount: 0,
        forkVerifyTaskCount: 0,
        waitScannerTaskCount: 0,
        blockedTaskCount: 0,
      },
      tasks: [],
    };
  }
}

async function writeLiveAutomationSessions(sessions: LiveAutomationSession[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    AUTOMATION_SESSIONS_PATH,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        sessionCount: sessions.length,
        sessions,
      },
      null,
      2,
    )}\n`,
  );
}

function normalizeAddress(value: unknown): string | null {
  const address = String(value ?? '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : null;
}

function isValidPersonalSignature(value: unknown): boolean {
  return /^0x[0-9a-fA-F]{130}$/.test(String(value ?? '').trim());
}

function normalizeStrategyFamilies(
  bodyFamilies: unknown,
  feed: { opportunities?: Array<Record<string, unknown>> },
): string[] {
  const requested = Array.isArray(bodyFamilies)
    ? bodyFamilies.map((item) => String(item)).filter(Boolean)
    : [];
  const fromFeed = Array.isArray(feed.opportunities)
    ? feed.opportunities.map((item) => String(item.familyKey ?? '')).filter(Boolean)
    : [];
  return Array.from(new Set(requested.length ? requested : fromFeed)).sort();
}

function buildProfitabilityGate(eventReplay: CandidateEventReplayArtifact | null): {
  key: string;
  status: 'pass' | 'warn' | 'block';
  message: string;
  evidence?: Record<string, unknown>;
} {
  if (!eventReplay) {
    return {
      key: 'profitability-backtest',
      status: 'block',
      message: 'real fee/IL/gas event replay artifact is missing for this candidate',
    };
  }
  const netApyPct = eventReplay.metrics?.netApyPct;
  const durationDays = eventReplay.window?.durationDays;
  const swapCount = eventReplay.window?.swapCount;
  const minDays =
    eventReplay.gate?.minReplayDaysForGate ?? eventReplay.methodology?.minReplayDaysForGate ?? 7;
  const minSwaps =
    eventReplay.gate?.minSwapCountForGate ??
    eventReplay.methodology?.minSwapCountForGate ??
    100;
  const status = eventReplay.gate?.status === 'pass' ? 'pass' : 'block';
  const reason =
    status === 'pass'
      ? `event replay net APY ${formatPercent(netApyPct)} over ${formatNumber(durationDays)}d and ${swapCount ?? 'n/a'} swaps`
      : `event replay not sufficient: net APY ${formatPercent(netApyPct)}, ${formatNumber(
          durationDays,
        )}d/${minDays}d, ${swapCount ?? 'n/a'}/${minSwaps} swaps`;
  return {
    key: 'profitability-backtest',
    status,
    message: reason,
    evidence: eventReplay as unknown as Record<string, unknown>,
  };
}

function formatPercent(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : 'n/a';
}

function formatNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4) : 'n/a';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
