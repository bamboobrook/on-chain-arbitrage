#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');
const automationSessionsPath = resolve(dataDir, 'live-automation-sessions.json');
const liveExecutionQueuePath = resolve(dataDir, 'live-execution-queue.json');
const liveExecutionQueueResultsPath = resolve(dataDir, 'live-execution-queue-results.json');

function loadDotenv() {
  try {
    const text = readFileSync(resolve(root, '.env'), 'utf8');
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

function envNumber(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envNumberAllowZero(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function envBool(key, fallback = false) {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'y'].includes(String(raw).toLowerCase());
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function runCommand(label, command, args, acceptedExitCodes = [0], timeoutMs = 300_000) {
  const startedAt = Date.now();
  try {
    const result = await execFileAsync(command, args, {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${process.env.HOME ?? ''}/.foundry/bin:${process.env.PATH ?? ''}`,
      },
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      label,
      status: 'passed',
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      stdoutTail: result.stdout.slice(-1000),
      stderrTail: result.stderr.slice(-1000),
    };
  } catch (err) {
    const exitCode = err.code ?? 1;
    return {
      label,
      status: acceptedExitCodes.includes(exitCode) ? 'accepted-nonzero' : 'failed',
      exitCode,
      durationMs: Date.now() - startedAt,
      stdoutTail: String(err.stdout ?? '').slice(-1000),
      stderrTail: String(err.stderr ?? err.message ?? '').slice(-1000),
    };
  }
}

async function writeStatus(fileName, report) {
  await mkdir(dataDir, { recursive: true });
  const path = resolve(dataDir, fileName);
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

function check(key, status, reason, evidence = null) {
  return { key, status, reason, evidence };
}

function verificationByCandidateId(verification) {
  const rows = Array.isArray(verification?.results) ? verification.results : [];
  return new Map(rows.map((row) => [row.candidateId, row]));
}

function quoteAgeMs(opp) {
  const generatedAt = Date.parse(opp?.artifactGeneratedAt ?? '');
  return Number.isFinite(generatedAt) ? Math.max(0, Date.now() - generatedAt) : null;
}

function isDexLike(familyKey) {
  return (
    familyKey.includes('dex') ||
    familyKey.includes('uniswap') ||
    familyKey.includes('curve') ||
    familyKey.includes('balancer')
  );
}

function uniswapV3TickStateCheck(opp) {
  const pools = Array.isArray(opp?.market?.routePools) ? opp.market.routePools : [];
  const uniswapPools = pools.filter((pool) => pool.dex === 'uniswap-v3');
  if (!uniswapPools.length) {
    return {
      required: false,
      ready: true,
      poolCount: 0,
      loadedCount: 0,
      failedPools: [],
    };
  }
  const loaded = uniswapPools.filter((pool) => pool.uniswapV3State?.status === 'loaded');
  return {
    required: true,
    ready: loaded.length === uniswapPools.length,
    poolCount: uniswapPools.length,
    loadedCount: loaded.length,
    failedPools: uniswapPools
      .filter((pool) => pool.uniswapV3State?.status !== 'loaded')
      .map((pool) => ({
        poolAddress: pool.poolAddress ?? null,
        status: pool.uniswapV3State?.status ?? 'missing',
        error: pool.uniswapV3State?.error ?? null,
      })),
  };
}

function uniswapV3DepthCapacityCheck(opp, requiredCapacityUsd) {
  const pools = Array.isArray(opp?.market?.routePools) ? opp.market.routePools : [];
  const uniswapPools = pools.filter((pool) => pool.dex === 'uniswap-v3');
  if (!uniswapPools.length) {
    return {
      required: false,
      ready: true,
      poolCount: 0,
      readyCount: 0,
      capacityUsd: null,
      requiredCapacityUsd,
      failedPools: [],
    };
  }
  const depthRows = uniswapPools.map((pool) => ({
    poolAddress: pool.poolAddress ?? null,
    tokenIn: pool.tokenIn ?? null,
    tokenOut: pool.tokenOut ?? null,
    status: pool.uniswapV3Depth?.status ?? 'missing',
    ready: pool.uniswapV3Depth?.ready === true,
    capacityUsd: numberOrNull(pool.uniswapV3Depth?.capacityUsd),
    method: pool.uniswapV3Depth?.method ?? null,
  }));
  const readyRows = depthRows.filter((row) => row.ready && row.capacityUsd != null);
  const capacityUsd =
    readyRows.length === uniswapPools.length ? Math.min(...readyRows.map((row) => row.capacityUsd)) : null;
  return {
    required: true,
    ready: capacityUsd != null && requiredCapacityUsd > 0 && capacityUsd >= requiredCapacityUsd,
    poolCount: uniswapPools.length,
    readyCount: readyRows.length,
    capacityUsd,
    requiredCapacityUsd,
    source: 'uniswap-v3-exact-input-to-loaded-initialized-ticks',
    failedPools: depthRows.filter((row) => !row.ready || row.capacityUsd == null || row.capacityUsd < requiredCapacityUsd),
  };
}

function opportunityExecutionDecision(opp, verificationRow, policy) {
  const gate = opp?.gate?.status ?? 'unknown';
  const capitalUsd = policy.capitalUsd;
  const capitalRequiredUsd = numberOrNull(opp?.economics?.capitalRequiredUsd);
  const capacityUsd = numberOrNull(opp?.economics?.capacityUsd);
  const netProfitUsd = numberOrNull(opp?.economics?.estimatedNetProfitUsd);
  const returnPct = numberOrNull(opp?.economics?.returnPct);
  const gasUsd = numberOrNull(opp?.economics?.gasUsd);
  const priceImpactBps = numberOrNull(opp?.market?.priceImpactBps);
  const poolLiquidityUsd = numberOrNull(opp?.market?.poolLiquidityUsd);
  const volume24hUsd = numberOrNull(opp?.market?.volume24hUsd);
  const uniTickState = uniswapV3TickStateCheck(opp);
  const ageMs = quoteAgeMs(opp);
  const maxQuoteAgeMs = numberOrNull(opp?.timing?.maxQuoteAgeMs) ?? policy.maxQuoteAgeMs;
  const maxSlippageBps = numberOrNull(opp?.economics?.slippageBudgetBps) ?? policy.maxSlippageBps;
  const familyMinReturnPct = isDexLike(opp.familyKey)
    ? policy.minAnnualizedReturnPct
    : policy.minExecutionReturnPct;
  const capitalMeetsRequired = capitalRequiredUsd == null || capitalUsd >= capitalRequiredUsd;
  const recommendedCapitalUsd =
    capitalMeetsRequired && capitalUsd > 0 && capacityUsd != null && capacityUsd > 0
      ? Math.min(capitalUsd, capacityUsd)
      : 0;
  const depthCapitalUsd = recommendedCapitalUsd || capitalRequiredUsd || capitalUsd;
  const uniDepthCapacity = uniswapV3DepthCapacityCheck(opp, depthCapitalUsd);
  const requiredPoolLiquidityUsd = Math.max(
    policy.minPoolLiquidityUsd,
    depthCapitalUsd * policy.minLiquidityToCapitalRatio,
  );
  const checks = [];

  checks.push(
    check(
      'gate-pass',
      gate === 'pass' ? 'pass' : 'block',
      gate === 'pass' ? 'candidate gate passed' : `candidate gate is ${gate}`,
      opp?.gate ?? null,
    ),
  );
  checks.push(
    check(
      'executor-action',
      opp.executorAction === 'fork-verify-now' ? 'pass' : 'block',
      opp.executorAction === 'fork-verify-now'
        ? 'scanner marked opportunity for fork verification'
        : `scanner action is ${opp.executorAction}`,
      { executorAction: opp.executorAction },
    ),
  );
  checks.push(
    check(
      'capital-configured',
      capitalUsd > 0 ? 'pass' : 'block',
      capitalUsd > 0 ? 'executor capital is configured' : 'set EXECUTOR_CAPITAL_USD or provide capital in API/UI',
      { capitalUsd },
    ),
  );
  checks.push(
    check(
      'capital-required',
      capitalMeetsRequired ? 'pass' : 'block',
      capitalMeetsRequired
        ? 'configured capital covers the tested or required notional'
        : 'configured capital is below the tested or required notional',
      { capitalUsd, capitalRequiredUsd },
    ),
  );
  checks.push(
    check(
      'capacity',
      capacityUsd != null && capacityUsd > 0 && recommendedCapitalUsd > 0 ? 'pass' : 'block',
      capacityUsd != null && capacityUsd > 0 && recommendedCapitalUsd > 0
        ? 'positive executable capacity is available'
        : 'no positive capacity from current quote/liquidation estimate',
      { capacityUsd, recommendedCapitalUsd, capacitySource: opp?.market?.capacitySource ?? null },
    ),
  );
  checks.push(
    check(
      'net-profit',
      netProfitUsd != null && netProfitUsd >= policy.minNetProfitUsd ? 'pass' : 'block',
      netProfitUsd != null && netProfitUsd >= policy.minNetProfitUsd
        ? 'net profit clears configured minimum'
        : 'net profit is missing or below configured minimum',
      { netProfitUsd, minNetProfitUsd: policy.minNetProfitUsd },
    ),
  );
  checks.push(
    check(
      'return',
      returnPct != null && returnPct >= familyMinReturnPct ? 'pass' : 'block',
      returnPct != null && returnPct >= familyMinReturnPct
        ? 'return clears configured minimum'
        : 'return is missing or below configured minimum',
      { returnPct, minReturnPct: familyMinReturnPct },
    ),
  );
  checks.push(
    check(
      'pool-liquidity',
      poolLiquidityUsd != null && poolLiquidityUsd >= requiredPoolLiquidityUsd ? 'pass' : 'block',
      poolLiquidityUsd != null && poolLiquidityUsd >= requiredPoolLiquidityUsd
        ? 'route pool liquidity clears required depth'
        : 'route pool liquidity is missing or below required depth',
      {
        poolLiquidityUsd,
        requiredPoolLiquidityUsd,
        poolLiquiditySource: opp?.market?.poolLiquiditySource ?? null,
      },
    ),
  );
  checks.push(
    check(
      'volume-24h',
      !policy.requireVolume24h || (volume24hUsd != null && volume24hUsd >= policy.minVolume24hUsd)
        ? 'pass'
        : 'block',
      !policy.requireVolume24h || (volume24hUsd != null && volume24hUsd >= policy.minVolume24hUsd)
        ? '24h volume requirement is satisfied or disabled'
        : '24h volume is missing or below required threshold',
      {
        volume24hUsd,
        minVolume24hUsd: policy.minVolume24hUsd,
        requireVolume24h: policy.requireVolume24h,
        volume24hSource: opp?.market?.volume24hSource ?? null,
      },
    ),
  );
  checks.push(
    check(
      'uniswap-v3-tick-state',
      uniTickState.ready ? 'pass' : 'block',
      uniTickState.ready
        ? 'Uniswap V3 tick state is loaded or not required for this route'
        : 'Uniswap V3 route is missing slot0/liquidity/tick state',
      uniTickState,
    ),
  );
  checks.push(
    check(
      'uniswap-v3-depth-capacity',
      uniDepthCapacity.ready ? 'pass' : 'block',
      uniDepthCapacity.ready
        ? 'Uniswap V3 loaded tick range covers recommended capital or is not required'
        : 'Uniswap V3 loaded tick-range capacity is missing or below recommended capital',
      uniDepthCapacity,
    ),
  );
  checks.push(
    check(
      'gas',
      gasUsd != null && gasUsd <= policy.maxGasUsd ? 'pass' : 'block',
      gasUsd != null && gasUsd <= policy.maxGasUsd
        ? 'gas estimate is within budget'
        : 'gas estimate is missing or above budget',
      { gasUsd, maxGasUsd: policy.maxGasUsd },
    ),
  );
  checks.push(
    check(
      'slippage-price-impact',
      priceImpactBps != null && priceImpactBps <= maxSlippageBps ? 'pass' : 'block',
      priceImpactBps != null && priceImpactBps <= maxSlippageBps
        ? 'price-impact proxy is inside slippage budget'
        : 'price-impact proxy is missing or above slippage budget',
      {
        priceImpactBps,
        maxSlippageBps,
        priceImpactBpsSource: opp?.market?.priceImpactBpsSource ?? null,
      },
    ),
  );
  checks.push(
    check(
      'quote-freshness',
      ageMs != null && ageMs <= maxQuoteAgeMs ? 'pass' : 'block',
      ageMs != null && ageMs <= maxQuoteAgeMs
        ? 'quote artifact is fresh enough for executor handoff'
        : 'quote artifact is stale or missing generation time',
      { quoteAgeMs: ageMs, maxQuoteAgeMs },
    ),
  );

  const preForkReady = checks.every((item) => item.status === 'pass');
  const forkReady = verificationRow?.liveReady === true;
  checks.push(
    check(
      'fork-verification',
      forkReady ? 'pass' : preForkReady ? 'wait' : 'block',
      forkReady
        ? 'same-block fork verification is live-ready'
        : preForkReady
          ? 'preconditions passed; fork verification must run next'
          : 'fork verification is not useful until preconditions pass',
      verificationRow ?? null,
    ),
  );
  checks.push(
    check(
      'production-enabled',
      policy.liveExecutionEnabled ? 'pass' : 'block',
      policy.liveExecutionEnabled
        ? 'LIVE_EXECUTION_ENABLED is on'
        : 'LIVE_EXECUTION_ENABLED is off; no transaction will be submitted',
      { liveExecutionEnabled: policy.liveExecutionEnabled },
    ),
  );
  checks.push(
    check(
      'signer',
      policy.signerConfigured ? 'pass' : 'block',
      policy.signerConfigured
        ? 'executor signer mode is configured'
        : 'executor signer mode is missing',
      { signerConfigured: policy.signerConfigured },
    ),
  );
  checks.push(
    check(
      'private-relay',
      policy.privateRelayConfigured || !policy.privateRelayRequired ? 'pass' : 'block',
      policy.privateRelayConfigured || !policy.privateRelayRequired
        ? 'private relay requirement is satisfied or disabled'
        : 'private relay/bundle channel is required but not configured',
      {
        privateRelayRequired: policy.privateRelayRequired,
        privateRelayConfigured: policy.privateRelayConfigured,
      },
    ),
  );

  const submitReady = checks.every((item) => item.status === 'pass');
  const blockingChecks = checks.filter((item) => item.status === 'block').map((item) => item.key);
  const waitingChecks = checks.filter((item) => item.status === 'wait').map((item) => item.key);
  const status = submitReady
    ? 'ready-for-submit'
    : preForkReady && !forkReady
      ? 'ready-for-fork-verification'
      : 'blocked-preconditions';

  return {
    id: opp.id,
    familyKey: opp.familyKey,
    chain: opp.chain,
    rank: opp.rank,
    executorAction: opp.executorAction,
    status,
    submitReady,
    preForkReady,
    forkReady,
    recommendedCapitalUsd,
    capitalRequiredUsd,
    capacityUsd,
    estimatedNetProfitUsd: netProfitUsd,
    returnPct,
    gasUsd,
    priceImpactBps,
    poolLiquidityUsd,
    volume24hUsd,
    uniswapV3TickState: uniTickState,
    uniswapV3DepthCapacity: uniDepthCapacity,
    quoteAgeMs: ageMs,
    maxQuoteAgeMs,
    route: opp?.market?.route ?? null,
    blockingChecks,
    waitingChecks,
    checks,
  };
}

async function scannerIteration() {
  const tasks = [];
  tasks.push(
    await runCommand(
      'refresh-live-opportunities',
      'npm',
      ['run', 'refresh:live-opportunities'],
      [0, 2],
      envNumber('SCANNER_REFRESH_TIMEOUT_MS', 900_000),
    ),
  );
  tasks.push(
    await runCommand(
      'build-live-opportunity-feed',
      'npm',
      ['run', 'build:live-opportunity-feed'],
      [0, 2],
      envNumber('SCANNER_FEED_TIMEOUT_MS', 120_000),
    ),
  );
  const feed = await readJson(resolve(dataDir, 'live-opportunity-feed.json'));
  const report = {
    schemaVersion: 1,
    role: 'scanner',
    generatedAt: new Date().toISOString(),
    nodeId: process.env.ARB_NODE_ID ?? 'scanner-local',
    scanner: {
      intervalMs: envNumber('SCANNER_INTERVAL_MS', 120_000),
      feedStatus: feed?.summary?.status ?? 'missing-feed',
      opportunityCount: feed?.summary?.opportunityCount ?? 0,
      actionableCount: feed?.summary?.actionableCount ?? 0,
      watchCount: feed?.summary?.watchCount ?? 0,
      maxQuoteAgeMs: feed?.policy?.maxQuoteAgeMs ?? null,
      maxSlippageBps: feed?.policy?.maxSlippageBps ?? null,
    },
    tasks,
  };
  const path = await writeStatus('scanner-node-status.json', report);
  console.log(`scannerStatus=${report.scanner.feedStatus} actionable=${report.scanner.actionableCount} report=${path}`);
  return report;
}

function executorDecision(feed, verification, overrides = {}) {
  const actionable = feed?.opportunities?.filter?.((opp) => opp.executorAction === 'fork-verify-now') ?? [];
  const liveReadyCount = verification?.summary?.liveReadyCount ?? 0;
  const enabled = envBool('LIVE_EXECUTION_ENABLED', false);
  const policy = {
    capitalUsd: numberOrNull(overrides.capitalUsd) ?? envNumberAllowZero('EXECUTOR_CAPITAL_USD', 0),
    minNetProfitUsd: envNumberAllowZero('EXECUTOR_MIN_NET_PROFIT_USD', 0.01),
    minExecutionReturnPct: envNumberAllowZero('EXECUTOR_MIN_EXECUTION_RETURN_PCT', 0),
    minAnnualizedReturnPct: envNumberAllowZero(
      'EXECUTOR_MIN_ANNUALIZED_RETURN_PCT',
      numberOrNull(feed?.policy?.minAnnualizedReturnPct) ?? 20,
    ),
    maxGasUsd: envNumber('EXECUTOR_MAX_GAS_USD', 25),
    minPoolLiquidityUsd: envNumberAllowZero('EXECUTOR_MIN_POOL_LIQUIDITY_USD', 0),
    minLiquidityToCapitalRatio: envNumber('EXECUTOR_MIN_LIQUIDITY_TO_CAPITAL_RATIO', 10),
    minVolume24hUsd: envNumberAllowZero('EXECUTOR_MIN_VOLUME_24H_USD', 0),
    requireVolume24h: envBool('EXECUTOR_REQUIRE_VOLUME_24H', true),
    maxQuoteAgeMs: numberOrNull(feed?.policy?.maxQuoteAgeMs) ?? envNumber('LIVE_FEED_MAX_QUOTE_AGE_MS', 2500),
    maxSlippageBps: numberOrNull(feed?.policy?.maxSlippageBps) ?? envNumber('LIVE_FEED_MAX_SLIPPAGE_BPS', 30),
    liveExecutionEnabled: enabled,
    signerConfigured: Boolean(process.env.EXECUTOR_PRIVATE_KEY || process.env.EXECUTOR_WALLET_MODE),
    privateRelayRequired: envBool('EXECUTOR_PRIVATE_RELAY_REQUIRED', true),
    privateRelayConfigured: Boolean(
      process.env.EXECUTOR_PRIVATE_RELAY_URL ||
        process.env.FLASHBOTS_RELAY_URL ||
        process.env.MEV_BLOCKER_RPC_URL,
    ),
  };
  const verificationRows = verificationByCandidateId(verification);
  const evaluated = (feed?.opportunities ?? [])
    .map((opp) => opportunityExecutionDecision(opp, verificationRows.get(opp.id), policy))
    .sort((a, b) => {
      if (a.submitReady !== b.submitReady) return a.submitReady ? -1 : 1;
      if (a.preForkReady !== b.preForkReady) return a.preForkReady ? -1 : 1;
      return (b.estimatedNetProfitUsd ?? -1_000_000) - (a.estimatedNetProfitUsd ?? -1_000_000);
    });
  const submitReadyCount = evaluated.filter((item) => item.submitReady).length;
  const preForkReadyCount = evaluated.filter((item) => item.preForkReady).length;
  if (!actionable.length) {
    return {
      status: 'idle-no-gate-pass-opportunities',
      reason: 'scanner feed has no gate-pass opportunities',
      actionableCount: 0,
      liveReadyCount,
      submitReadyCount,
      preForkReadyCount,
      policy,
      opportunityDecisions: evaluated.slice(0, overrides.maxOutput ?? envNumber('EXECUTOR_DECISION_MAX_OUTPUT', 50)),
    };
  }
  if (liveReadyCount <= 0) {
    return {
      status: 'blocked-fork-verification',
      reason: 'gate-pass opportunities exist but fork verification has not produced live-ready evidence',
      actionableCount: actionable.length,
      liveReadyCount,
      submitReadyCount,
      preForkReadyCount,
      policy,
      opportunityDecisions: evaluated.slice(0, overrides.maxOutput ?? envNumber('EXECUTOR_DECISION_MAX_OUTPUT', 50)),
    };
  }
  if (!enabled) {
    return {
      status: 'ready-but-production-disabled',
      reason: 'LIVE_EXECUTION_ENABLED is not set; executor will not submit transactions',
      actionableCount: actionable.length,
      liveReadyCount,
      submitReadyCount,
      preForkReadyCount,
      policy,
      opportunityDecisions: evaluated.slice(0, overrides.maxOutput ?? envNumber('EXECUTOR_DECISION_MAX_OUTPUT', 50)),
    };
  }
  if (!process.env.EXECUTOR_PRIVATE_KEY && !process.env.EXECUTOR_WALLET_MODE) {
    return {
      status: 'ready-but-signer-missing',
      reason: 'production execution is enabled, but no executor signer mode is configured',
      actionableCount: actionable.length,
      liveReadyCount,
      submitReadyCount,
      preForkReadyCount,
      policy,
      opportunityDecisions: evaluated.slice(0, overrides.maxOutput ?? envNumber('EXECUTOR_DECISION_MAX_OUTPUT', 50)),
    };
  }
  return {
    status: submitReadyCount > 0 ? 'ready-for-submit' : 'blocked-execution-risk-gates',
    reason:
      submitReadyCount > 0
        ? 'live-ready fork evidence exists and production execution is enabled'
        : 'live-ready evidence exists, but sizing/risk gates did not produce a submit-ready opportunity',
    actionableCount: actionable.length,
    liveReadyCount,
    submitReadyCount,
    preForkReadyCount,
    policy,
    opportunityDecisions: evaluated.slice(0, overrides.maxOutput ?? envNumber('EXECUTOR_DECISION_MAX_OUTPUT', 50)),
  };
}

async function readAutomationSessions() {
  const artifact = await readJson(automationSessionsPath);
  return Array.isArray(artifact?.sessions) ? artifact.sessions : [];
}

async function writeAutomationSessions(sessions) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    automationSessionsPath,
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

function normalizeSessionFamilies(session, feed) {
  const requested = Array.isArray(session?.strategyFamilies)
    ? session.strategyFamilies.map((item) => String(item)).filter(Boolean)
    : [];
  if (requested.length) return Array.from(new Set(requested)).sort();
  const fromFeed = Array.isArray(feed?.opportunities)
    ? feed.opportunities.map((item) => String(item.familyKey ?? '')).filter(Boolean)
    : [];
  return Array.from(new Set(fromFeed)).sort();
}

function automationSessionStatus({ selectedSubmitReadyCount, selectedPreForkReadyCount, selectedOpportunityCount, decision }) {
  if (selectedSubmitReadyCount > 0) {
    return {
      status: 'armed-submit-ready',
      reason: 'selected strategy set has submit-ready opportunities under current executor gates',
    };
  }
  if (selectedPreForkReadyCount > 0) {
    return {
      status: 'waiting-fork-verification',
      reason: 'selected strategy set has pre-fork-ready opportunities; fork verification must pass before submission',
    };
  }
  if (selectedOpportunityCount === 0) {
    return {
      status: 'blocked-no-selected-opportunities',
      reason: 'selected strategy families are not present in the current scanner feed',
    };
  }
  if (decision.status === 'idle-no-gate-pass-opportunities') {
    return {
      status: 'scanning-no-gate-pass-opportunities',
      reason: 'scanner feed has no gate-pass opportunities for the selected strategy set',
    };
  }
  return {
    status: 'blocked-no-submit-ready-opportunity',
    reason:
      'selected strategy set does not currently pass scanner, sizing, depth, return, freshness, fork, production, signer, and relay gates',
  };
}

async function updateAutomationSessions(feed, verification) {
  const sessions = await readAutomationSessions();
  if (!sessions.length) {
    await writeAutomationSessions([]);
    return {
      sessionCount: 0,
      activeSessionCount: 0,
      armedSubmitReadyCount: 0,
      waitingForkVerificationCount: 0,
      blockedOrScanningCount: 0,
    };
  }
  const now = new Date().toISOString();
  const updated = sessions.map((session) => {
    if (session.status === 'stopped') {
      return { ...session, updatedAt: now };
    }
    const capitalUsd = numberOrNull(session.capitalUsd) ?? 0;
    const strategyFamilies = normalizeSessionFamilies(session, feed);
    const decision = executorDecision(feed, verification, {
      capitalUsd,
      maxOutput: envNumber('AUTOMATION_DECISION_MAX_OUTPUT', 200),
    });
    const selectedRows = (decision.opportunityDecisions ?? []).filter((row) =>
      strategyFamilies.includes(String(row.familyKey ?? '')),
    );
    const selectedPreForkReadyCount = selectedRows.filter((row) => row.preForkReady === true).length;
    const selectedSubmitReadyCount = selectedRows.filter((row) => row.submitReady === true).length;
    const status = automationSessionStatus({
      selectedSubmitReadyCount,
      selectedPreForkReadyCount,
      selectedOpportunityCount: selectedRows.length,
      decision,
    });
    return {
      ...session,
      updatedAt: now,
      strategyFamilies,
      status: status.status,
      reason: status.reason,
      decisionSummary: {
        ...(decision.summary ?? {}),
        status: decision.status,
        actionableCount: decision.actionableCount,
        preForkReadyCount: decision.preForkReadyCount,
        submitReadyCount: decision.submitReadyCount,
        liveReadyCount: decision.liveReadyCount,
      },
      selectedOpportunityCount: selectedRows.length,
      selectedPreForkReadyCount,
      selectedSubmitReadyCount,
      selectedTop: selectedRows.slice(0, 12).map((row) => ({
        id: row.id,
        familyKey: row.familyKey,
        chain: row.chain,
        status: row.status,
        executorAction: row.executorAction,
        preForkReady: row.preForkReady,
        submitReady: row.submitReady,
        forkReady: row.forkReady,
        recommendedCapitalUsd: row.recommendedCapitalUsd,
        blockingChecks: row.blockingChecks,
        waitingChecks: row.waitingChecks,
      })),
      lastEvaluatedAt: now,
    };
  });
  await writeAutomationSessions(updated);
  return {
    sessionCount: updated.length,
    activeSessionCount: updated.filter((session) => session.status !== 'stopped').length,
    armedSubmitReadyCount: updated.filter((session) => session.status === 'armed-submit-ready').length,
    waitingForkVerificationCount: updated.filter((session) => session.status === 'waiting-fork-verification').length,
    blockedOrScanningCount: updated.filter((session) =>
      ['blocked-no-selected-opportunities', 'blocked-no-submit-ready-opportunity', 'scanning-no-gate-pass-opportunities'].includes(
        session.status,
      ),
    ).length,
  };
}

function queueActionForSession(session, candidate) {
  if (session.status === 'armed-submit-ready' && candidate?.submitReady === true) return 'submit';
  if (session.status === 'waiting-fork-verification' && candidate?.preForkReady === true) return 'fork-verify';
  if (session.status === 'scanning-no-gate-pass-opportunities') return 'wait-scanner';
  return 'blocked';
}

async function writeLiveExecutionQueue(sessions, executorStatus) {
  const active = sessions.filter((session) => session.status !== 'stopped');
  const tasks = [];
  for (const session of active) {
    const selectedTop = Array.isArray(session.selectedTop) ? session.selectedTop : [];
    const candidates = selectedTop.length ? selectedTop : [null];
    for (const candidate of candidates.slice(0, envNumber('LIVE_EXECUTION_QUEUE_MAX_PER_SESSION', 5))) {
      const action = queueActionForSession(session, candidate);
      tasks.push({
        sessionId: session.id,
        walletAddress: session.walletAddress,
        walletChainId: session.walletChainId ?? null,
        capitalUsd: session.capitalUsd,
        strategyFamilies: session.strategyFamilies ?? [],
        action,
        opportunityId: candidate?.id ?? null,
        familyKey: candidate?.familyKey ?? null,
        chain: candidate?.chain ?? null,
        candidateStatus: candidate?.status ?? null,
        executorAction: candidate?.executorAction ?? null,
        recommendedCapitalUsd: candidate?.recommendedCapitalUsd ?? null,
        blockingChecks: candidate?.blockingChecks ?? [],
        waitingChecks: candidate?.waitingChecks ?? [],
        reason: session.reason,
        lastEvaluatedAt: session.lastEvaluatedAt ?? session.updatedAt ?? null,
      });
    }
  }
  const submitTaskCount = tasks.filter((task) => task.action === 'submit').length;
  const forkVerifyTaskCount = tasks.filter((task) => task.action === 'fork-verify').length;
  const waitScannerTaskCount = tasks.filter((task) => task.action === 'wait-scanner').length;
  const blockedTaskCount = tasks.filter((task) => task.action === 'blocked').length;
  const status =
    submitTaskCount > 0
      ? 'has-submit-ready-tasks'
      : forkVerifyTaskCount > 0
        ? 'has-fork-verify-tasks'
        : waitScannerTaskCount > 0
          ? 'waiting-for-scanner-opportunities'
          : active.length
            ? 'blocked-no-runnable-tasks'
            : 'idle-no-active-sessions';
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    executorStatus,
    summary: {
      sessionCount: sessions.length,
      activeSessionCount: active.length,
      taskCount: tasks.length,
      submitTaskCount,
      forkVerifyTaskCount,
      waitScannerTaskCount,
      blockedTaskCount,
    },
    tasks,
  };
  await writeFile(liveExecutionQueuePath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function consumeLiveExecutionQueue(queue, policy) {
  const handledAt = new Date().toISOString();
  const results = (queue.tasks ?? []).map((task) => {
    if (task.action === 'wait-scanner') {
      return {
        ...task,
        handledAt,
        handledStatus: 'waiting',
        decision: 'scanner must find a gate-pass opportunity before fork verification or submission',
      };
    }
    if (task.action === 'fork-verify') {
      return {
        ...task,
        handledAt,
        handledStatus: 'queued-for-fork-verification',
        decision:
          'executor already runs verify-live-fork-candidates once per iteration; task remains queued until liveReady evidence appears',
      };
    }
    if (task.action === 'submit') {
      const signerConfigured = Boolean(process.env.EXECUTOR_PRIVATE_KEY || process.env.EXECUTOR_WALLET_MODE);
      const privateRelayConfigured = Boolean(
        process.env.EXECUTOR_PRIVATE_RELAY_URL ||
          process.env.FLASHBOTS_RELAY_URL ||
          process.env.MEV_BLOCKER_RPC_URL,
      );
      const productionReady =
        policy.liveExecutionEnabled &&
        policy.requireForkVerification &&
        (!policy.requireSignerWhenEnabled || signerConfigured) &&
        (!policy.privateRelayRequired || privateRelayConfigured);
      return {
        ...task,
        handledAt,
        handledStatus: productionReady ? 'submit-ready-not-sent' : 'blocked-production-gates',
        decision: productionReady
          ? 'submit-ready task detected; transaction submission adapter is intentionally not invoked in this queue consumer yet'
          : 'submit task is blocked because production execution, signer, fork verification, or private relay gates are not satisfied',
      };
    }
    return {
      ...task,
      handledAt,
      handledStatus: 'blocked',
      decision: task.reason ?? 'task is blocked by executor gates',
    };
  });
  const summary = {
    taskCount: results.length,
    waitingCount: results.filter((item) => item.handledStatus === 'waiting').length,
    forkVerifyQueuedCount: results.filter((item) => item.handledStatus === 'queued-for-fork-verification').length,
    submitReadyNotSentCount: results.filter((item) => item.handledStatus === 'submit-ready-not-sent').length,
    blockedCount: results.filter((item) => String(item.handledStatus).startsWith('blocked')).length,
  };
  const report = {
    schemaVersion: 1,
    generatedAt: handledAt,
    queueStatus: queue.status,
    summary,
    results,
  };
  await writeFile(liveExecutionQueueResultsPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function executorIteration() {
  const tasks = [];
  tasks.push(
    await runCommand(
      'verify-live-fork-candidates',
      'npm',
      ['run', 'verify:live-fork-candidates'],
      [0, 2],
      envNumber('EXECUTOR_VERIFY_TIMEOUT_MS', 420_000),
    ),
  );
  const feed = await readJson(resolve(dataDir, 'live-opportunity-feed.json'));
  const verification = await readJson(resolve(dataDir, 'live-fork-verification.json'));
  const decision = executorDecision(feed, verification);
  const automationSessions = await updateAutomationSessions(feed, verification);
  const sessionRows = await readAutomationSessions();
  const executionQueue = await writeLiveExecutionQueue(sessionRows, decision.status);
  const queueResults = await consumeLiveExecutionQueue(executionQueue, {
    liveExecutionEnabled: envBool('LIVE_EXECUTION_ENABLED', false),
    requireForkVerification: true,
    requireSignerWhenEnabled: true,
    privateRelayRequired: envBool('EXECUTOR_PRIVATE_RELAY_REQUIRED', true),
  });
  const report = {
    schemaVersion: 1,
    role: 'executor',
    generatedAt: new Date().toISOString(),
    nodeId: process.env.ARB_NODE_ID ?? 'executor-local',
    policy: {
      liveExecutionEnabled: envBool('LIVE_EXECUTION_ENABLED', false),
      requireForkVerification: true,
      requireSignerWhenEnabled: true,
      privateRelayRequired: envBool('EXECUTOR_PRIVATE_RELAY_REQUIRED', true),
    },
    decision,
    automationSessions,
    executionQueue: {
      status: executionQueue.status,
      summary: executionQueue.summary,
    },
    queueResults: {
      summary: queueResults.summary,
    },
    feedSummary: feed?.summary ?? null,
    verificationSummary: verification?.summary ?? null,
    tasks,
  };
  const path = await writeStatus('executor-node-status.json', report);
  console.log(`executorStatus=${decision.status} liveReady=${decision.liveReadyCount} report=${path}`);
  return report;
}

async function loop(role) {
  const once = envBool('ARB_NODE_ONCE', false);
  const intervalMs =
    role === 'scanner'
      ? envNumber('SCANNER_INTERVAL_MS', 120_000)
      : envNumber('EXECUTOR_INTERVAL_MS', 30_000);
  do {
    if (role === 'scanner') await scannerIteration();
    else await executorIteration();
    if (once) break;
    await sleep(intervalMs);
  } while (true);
}

async function main() {
  loadDotenv();
  const role = String(process.argv[2] ?? process.env.ARB_NODE_ROLE ?? 'scanner').toLowerCase();
  if (!['scanner', 'executor'].includes(role)) {
    throw new Error(`unsupported role ${role}; expected scanner or executor`);
  }
  await loop(role);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
