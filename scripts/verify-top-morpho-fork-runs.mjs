#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = apiRequire('pg');

function loadDotenv() {
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed
        .slice(idx + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Optional.
  }
}

function walletBuffer(address) {
  return Buffer.from(address.replace(/^0x/i, '').padStart(40, '0'), 'hex');
}

function parseReport(stdout) {
  const prefix = 'forkSimulationReport=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(prefix));
  if (!line) return null;
  return JSON.parse(line.slice(prefix.length));
}

async function main() {
  loadDotenv();
  const artifact = JSON.parse(
    readFileSync(new URL('../data/morpho-blue-liquidation-candidates-ethereum.json', import.meta.url), 'utf8'),
  );
  const candidates = artifact.candidates
    .filter((candidate) => candidate.gate?.status === 'pass')
    .slice(0, Number(process.env.MORPHO_VERIFY_LIMIT ?? 5));
  if (candidates.length < 1) throw new Error('no passing Morpho candidates to verify');

  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://oal:oal_dev_password@127.0.0.1:5432/oal',
  });
  const wallet = process.env.MORPHO_VERIFY_WALLET ?? '0x0000000000000000000000000000000000000001';
  const results = [];
  try {
    for (const candidate of candidates) {
      const plan = {
        id: `morpho-blue-liq-plan-${candidate.id}`,
        candidateId: candidate.id,
        generatedAt: new Date().toISOString(),
        mode: 'dry-run',
        status: 'fork-simulation-required',
        strategyId: 'atomic-amm',
        chainId: 1,
        chain: candidate.chain,
        strategyType: 'morpho-blue-liquidation-arbitrage',
        capital: '1000000000',
        borrower: candidate.user,
        liquidation: {
          morpho: candidate.liveInterface?.requiredContracts?.morpho ?? '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
          marketId: candidate.marketId,
          marketParams: candidate.marketParams,
          loanAsset: candidate.bestEstimate?.loanAsset ?? candidate.marketParams.loanToken,
          loanSymbol: candidate.bestEstimate?.loanSymbol ?? null,
          collateralAsset: candidate.bestEstimate?.collateralAsset ?? candidate.marketParams.collateralToken,
          collateralSymbol: candidate.bestEstimate?.collateralSymbol ?? null,
          repayUsd: candidate.bestEstimate?.repayUsd ?? null,
          liquidationSelector: '0xd8eabcb8',
        },
        riskLimits: [
          { key: 'maxSlippageBps', value: 30, unit: 'bps' },
          { key: 'maxGasUsd', value: 25, unit: 'USD' },
          { key: 'minNetProfitUsd', value: candidate.gate.minNetProfitUsd ?? 5, unit: 'USD' },
        ],
        blockedBy: [
          'temporary fork verification run; no transaction is submitted by this script',
        ],
        evidence: {
          isPureArbitrage: candidate.isPureArbitrage,
          gate: candidate.gate,
          bestEstimate: candidate.bestEstimate,
        },
      };
      const { rows } = await pool.query(
        `INSERT INTO live_strategy_runs
           (candidate_id, strategy_id, status, chain_id, wallet_address, capital, plan, risk_limits, blocked_by)
         VALUES ($1, $2, 'blocked', $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          candidate.id,
          'atomic-amm',
          1,
          walletBuffer(wallet),
          '1000000000',
          JSON.stringify(plan),
          JSON.stringify(plan.riskLimits),
          JSON.stringify(plan.blockedBy),
        ],
      );
      const runId = rows[0].id;
      let stdout = '';
      let stderr = '';
      let exitCode = 0;
      try {
        const result = await execFileAsync('node', ['scripts/fork-simulate-live-run.mjs', runId], {
          cwd: new URL('../', import.meta.url),
          env: {
            ...process.env,
            PATH: `${process.env.HOME ?? ''}/.foundry/bin:${process.env.PATH ?? ''}`,
          },
          timeout: Number(process.env.MORPHO_VERIFY_TIMEOUT_MS ?? 240_000),
          maxBuffer: 8 * 1024 * 1024,
        });
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (err) {
        stdout = err.stdout ?? '';
        stderr = err.stderr ?? '';
        exitCode = err.code ?? 1;
      }
      const report = parseReport(stdout);
      results.push({
        candidateId: candidate.id,
        runId,
        exitCode,
        reason: report?.reason ?? null,
        forkSimulation: report?.forkSimulation ?? null,
        executorStatus: report?.morphoBlueExecutor?.executorForkSimulation?.status ?? null,
        executorCalldataStatus: report?.morphoBlueExecutor?.executeCalldataStatus ?? null,
        unwindQuoteStatus: report?.collateralUnwindQuote?.status ?? null,
        collateralSymbol: candidate.bestEstimate?.collateralSymbol ?? null,
        netProfitUsd: candidate.bestEstimate?.netProfitUsd ?? null,
        stderrHead: stderr.slice(0, 500),
      });
      console.log(`morphoForkVerify=${JSON.stringify(results[results.length - 1])}`);
    }
  } finally {
    await pool.end();
  }
  console.log(`morphoForkVerifySummary=${JSON.stringify(results)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
