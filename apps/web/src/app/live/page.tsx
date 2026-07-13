'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../providers';

interface LiveOpportunityFeed {
  generatedAt: string;
  policy: {
    maxQuoteAgeMs?: number;
    maxSlippageBps?: number;
    liveExecutionEnabled?: boolean;
  };
  summary: {
    opportunityCount: number;
    actionableCount: number;
    watchCount: number;
    blockedCount: number;
    status: string;
  };
  opportunities: Array<{
    id: string;
    familyKey: string;
    chain: string;
    strategyType: string;
    executorAction: string;
    ttlSeconds: number;
    gate: { status: string; reason: string };
    economics: {
      estimatedNetProfitUsd: number | null;
      returnPct: number | null;
      capitalRequiredUsd: number | null;
      capacityUsd: number | null;
      gasUsd: number | null;
      slippageBudgetBps: number | null;
    };
    market: {
      route: string | null;
      volume24hUsd: number | null;
      poolLiquidityUsd: number | null;
      poolLiquiditySource?: string | null;
      volume24hSource?: string | null;
      depthSnapshotStatus?: string | null;
      priceImpactBps: number | null;
      priceImpactBpsSource?: string | null;
      quoteSampleCount: number | null;
      capacitySource?: string | null;
      uniswapV3DepthCapacityUsd?: number | null;
      uniswapV3DepthStatus?: string | null;
      uniswapV3DepthSource?: string | null;
      capacityCurve?: Array<{
        multiplier: number | null;
        amountUsd: number | null;
        gate: string;
        medianNetProfitUsd: number | null;
        netWinRatePct: number | null;
        annualizedNetReturnPct: number | null;
      }>;
      routePools?: Array<{
        dex?: string | null;
        poolAddress?: string | null;
        poolId?: string | null;
        poolLiquidityUsd?: number | null;
        source?: string | null;
        uniswapV3State?: {
          status: string;
          currentTick?: number | null;
          tickSpacing?: number | null;
          activeLiquidity?: string | null;
          initializedTickCount?: number | null;
        } | null;
        uniswapV3Depth?: {
          status: string;
          ready?: boolean;
          capacityUsd?: number | null;
          amountInHuman?: number | null;
          initializedTicksTraversed?: number | null;
        } | null;
      }>;
    };
    timing: {
      maxQuoteAgeMs: number;
      maxInclusionDelayMs: number;
      observedLatencyMs?: {
        mean: number | null;
        p95: number | null;
        max: number | null;
      } | null;
    };
  }>;
}

interface ExecutionDecision {
  generatedAt: string;
  status: string;
  policy: {
    capitalUsd: number;
    minNetProfitUsd: number;
    minAnnualizedReturnPct: number;
    maxGasUsd: number;
    minPoolLiquidityUsd: number;
    minLiquidityToCapitalRatio: number;
    minVolume24hUsd: number;
    requireVolume24h: boolean;
    maxSlippageBps: number;
    liveExecutionEnabled: boolean;
    signerConfigured: boolean;
    privateRelayRequired: boolean;
    privateRelayConfigured: boolean;
  };
  summary: {
    opportunityCount: number;
    actionableCount: number;
    preForkReadyCount: number;
    submitReadyCount: number;
    liveReadyCount: number;
    blockedCount: number;
  };
  opportunityDecisions: Array<{
    id: string;
    familyKey: string;
    chain: string;
    executorAction: string;
    status: string;
    submitReady: boolean;
    preForkReady: boolean;
    forkReady: boolean;
    recommendedCapitalUsd: number;
    capitalRequiredUsd: number | null;
    capacityUsd: number | null;
    estimatedNetProfitUsd: number | null;
    returnPct: number | null;
    gasUsd: number | null;
    priceImpactBps: number | null;
    poolLiquidityUsd: number | null;
    volume24hUsd: number | null;
    uniswapV3TickState?: {
      required: boolean;
      ready: boolean;
      poolCount: number;
      loadedCount: number;
    };
    uniswapV3DepthCapacity?: {
      required: boolean;
      ready: boolean;
      poolCount: number;
      readyCount: number;
      capacityUsd: number | null;
      requiredCapacityUsd: number;
    };
    quoteAgeMs: number | null;
    maxQuoteAgeMs: number;
    route: string | null;
    blockingChecks: string[];
    waitingChecks: string[];
  }>;
}

type WalletState = {
  status: 'checking' | 'unavailable' | 'disconnected' | 'connecting' | 'connected';
  address: string | null;
  chainId: string | null;
  error: string | null;
};

interface LiveAutomationSession {
  id: string;
  createdAt: string;
  walletAddress: string;
  walletChainId: string | null;
  capitalUsd: number;
  strategyFamilies: string[];
  status: string;
  reason: string;
  selectedOpportunityCount: number;
  selectedPreForkReadyCount: number;
  selectedSubmitReadyCount: number;
  stoppedAt?: string | null;
}

interface LiveAutomationSessionsResponse {
  generatedAt: string;
  sessionCount: number;
  sessions: LiveAutomationSession[];
}

interface LiveExecutionQueue {
  generatedAt: string;
  status: string;
  summary: {
    sessionCount: number;
    activeSessionCount: number;
    taskCount: number;
    submitTaskCount: number;
    forkVerifyTaskCount: number;
    waitScannerTaskCount: number;
    blockedTaskCount: number;
  };
  tasks: Array<{
    sessionId: string;
    walletAddress: string;
    capitalUsd: number;
    action: string;
    opportunityId: string | null;
    familyKey: string | null;
    chain: string | null;
    candidateStatus: string | null;
    recommendedCapitalUsd: number | null;
    blockingChecks: string[];
    waitingChecks: string[];
    reason: string;
  }>;
}

export default function LivePage() {
  const [capitalUsd, setCapitalUsd] = useState('1000');
  const [wallet, setWallet] = useState<WalletState>({
    status: 'checking',
    address: null,
    chainId: null,
    error: null,
  });
  const [selectedFamilies, setSelectedFamilies] = useState<string[]>([]);
  const [automationBusy, setAutomationBusy] = useState(false);
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null);
  const [automationMessage, setAutomationMessage] = useState<string | null>(null);
  const { data: feed } = useQuery({
    queryKey: ['live-opportunity-feed'],
    queryFn: () => api<LiveOpportunityFeed>('/api/live/opportunity-feed'),
    refetchInterval: 5000,
    retry: false,
  });
  const { data: decision } = useQuery({
    queryKey: ['live-execution-decision', capitalUsd],
    queryFn: () =>
      api<ExecutionDecision>(`/api/live/execution-decision?capitalUsd=${encodeURIComponent(capitalUsd)}`),
    refetchInterval: 5000,
    retry: false,
  });
  const { data: opps } = useQuery({
    queryKey: ['live-opps'],
    queryFn: () => api<{ id: string; strategy_id: string; chain_id: number; net_profit: string; status: string }[]>('/api/live/opportunities'),
    refetchInterval: 3000,
  });
  const { data: execs } = useQuery({
    queryKey: ['live-execs'],
    queryFn: () => api<{ id: string; chain_id: number; status: string; net_profit: string }[]>('/api/live/executions'),
    refetchInterval: 3000,
  });
  const { data: automationSessions, refetch: refetchAutomationSessions } = useQuery({
    queryKey: ['live-automation-sessions'],
    queryFn: () => api<LiveAutomationSessionsResponse>('/api/live/automation-sessions'),
    refetchInterval: 5000,
    retry: false,
  });
  const { data: executionQueue } = useQuery({
    queryKey: ['live-execution-queue'],
    queryFn: () => api<LiveExecutionQueue>('/api/live/execution-queue'),
    refetchInterval: 5000,
    retry: false,
  });

  useEffect(() => {
    if (!window.ethereum) {
      setWallet({
        status: 'unavailable',
        address: null,
        chainId: null,
        error: 'No injected wallet found',
      });
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const [accounts, chainId] = await Promise.all([
          window.ethereum?.request({ method: 'eth_accounts' }) as Promise<string[]>,
          window.ethereum?.request({ method: 'eth_chainId' }) as Promise<string>,
        ]);
        if (cancelled) return;
        const address = accounts?.[0] ?? null;
        setWallet({
          status: address ? 'connected' : 'disconnected',
          address,
          chainId: chainId ?? null,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setWallet({
          status: 'disconnected',
          address: null,
          chainId: null,
          error: (err as Error).message,
        });
      }
    };
    const handleAccountsChanged = (accounts: unknown) => {
      const next = Array.isArray(accounts) ? String(accounts[0] ?? '') : '';
      setWallet((current) => ({
        ...current,
        status: next ? 'connected' : 'disconnected',
        address: next || null,
        error: null,
      }));
    };
    const handleChainChanged = (chainId: unknown) => {
      setWallet((current) => ({
        ...current,
        chainId: typeof chainId === 'string' ? chainId : current.chainId,
      }));
    };
    void refresh();
    window.ethereum.on?.('accountsChanged', handleAccountsChanged);
    window.ethereum.on?.('chainChanged', handleChainChanged);
    return () => {
      cancelled = true;
      window.ethereum?.removeListener?.('accountsChanged', handleAccountsChanged);
      window.ethereum?.removeListener?.('chainChanged', handleChainChanged);
    };
  }, []);

  useEffect(() => {
    if (!feed || selectedFamilies.length > 0) return;
    setSelectedFamilies(strategyFamiliesFromFeed(feed));
  }, [feed, selectedFamilies.length]);

  const strategyFamilies = feed ? strategyFamiliesFromFeed(feed) : [];
  const latestAutomationSession = automationSessions?.sessions?.[0] ?? null;

  const connectWallet = async () => {
    setWallet((current) => ({ ...current, status: 'connecting', error: null }));
    try {
      const address = await requestWalletAddress();
      if (!address) throw new Error('No injected wallet found');
      const chainId = window.ethereum
        ? ((await window.ethereum.request({ method: 'eth_chainId' })) as string)
        : null;
      setWallet({ status: 'connected', address, chainId, error: null });
      return { address, chainId };
    } catch (err) {
      setWallet((current) => ({
        ...current,
        status: current.address ? 'connected' : 'disconnected',
        error: (err as Error).message,
      }));
      throw err;
    }
  };

  const startAutomation = async () => {
    setAutomationBusy(true);
    setAutomationMessage(null);
    try {
      const connected = wallet.address
        ? { address: wallet.address, chainId: wallet.chainId }
        : await connectWallet();
      if (!window.ethereum) throw new Error('No injected wallet found');
      const signedAt = new Date().toISOString();
      const message = [
        'On-Chain Arbitrage Automation Authorization',
        `Wallet: ${connected.address}`,
        `Capital USD: ${capitalUsd}`,
        `Strategies: ${selectedFamilies.join(', ')}`,
        `Signed At: ${signedAt}`,
        'This signature records intent only; execution still requires all live gates to pass.',
      ].join('\n');
      const signature = (await window.ethereum.request({
        method: 'personal_sign',
        params: [message, connected.address],
      })) as string;
      const session = await api<LiveAutomationSession>('/api/live/automation-sessions', {
        method: 'POST',
        body: JSON.stringify({
          walletAddress: connected.address,
          walletChainId: connected.chainId,
          capitalUsd: Number(capitalUsd),
          strategyFamilies: selectedFamilies,
          mode: 'paper',
          authorization: { message, signature, signedAt },
        }),
      });
      setAutomationMessage(`${session.status}: ${session.reason}`);
      await refetchAutomationSessions();
    } catch (err) {
      setAutomationMessage((err as Error).message);
    } finally {
      setAutomationBusy(false);
    }
  };

  const stopAutomationSession = async (sessionId: string) => {
    setStoppingSessionId(sessionId);
    setAutomationMessage(null);
    try {
      const session = await api<LiveAutomationSession>(`/api/live/automation-sessions/${sessionId}/stop`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'stopped from live monitor' }),
      });
      setAutomationMessage(`${session.status}: ${session.reason}`);
      await refetchAutomationSessions();
    } catch (err) {
      setAutomationMessage((err as Error).message);
    } finally {
      setStoppingSessionId(null);
    }
  };

  return (
    <div>
      <h1>Live Monitor</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        Real-time opportunity queue, simulation pass rate and execution results. Admin can pause/resume here.
      </p>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ marginTop: 0 }}>Automation</h3>
            <div style={{ color: 'var(--text-dim)' }}>
              {wallet.address
                ? `${short(wallet.address)}${wallet.chainId ? ` on ${wallet.chainId}` : ''}`
                : wallet.status === 'unavailable'
                  ? 'No injected wallet'
                  : 'Wallet not connected'}
            </div>
            {wallet.error && <div style={{ color: 'var(--red)', marginTop: 8 }}>{wallet.error}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span className={`badge badge-${wallet.status === 'connected' ? 'active' : 'paused'}`}>
              {wallet.status}
            </span>
            <button onClick={connectWallet} disabled={wallet.status === 'connecting' || wallet.status === 'unavailable'}>
              {wallet.status === 'connected' ? 'Reconnect' : 'Connect wallet'}
            </button>
            <button
              onClick={startAutomation}
              disabled={automationBusy || selectedFamilies.length === 0 || wallet.status === 'unavailable'}
            >
              {automationBusy ? 'Signing' : 'Start automation'}
            </button>
          </div>
        </div>
        <div className="grid grid-4" style={{ marginTop: 16 }}>
          <label className="stat">
            <div className="label">Capital USD</div>
            <input
              value={capitalUsd}
              onChange={(event) => setCapitalUsd(event.target.value)}
              inputMode="decimal"
              style={{ width: '100%' }}
            />
          </label>
          <div className="stat">
            <div className="label">Strategies</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {strategyFamilies.map((family) => (
                <label key={family} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selectedFamilies.includes(family)}
                    onChange={() =>
                      setSelectedFamilies((current) =>
                        current.includes(family)
                          ? current.filter((item) => item !== family)
                          : [...current, family].sort(),
                      )
                    }
                  />
                  <span>{family}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="stat">
            <div className="label">Latest session</div>
            <div className="value" style={{ fontSize: 18 }}>
              {latestAutomationSession?.status ?? 'none'}
            </div>
            {latestAutomationSession ? (
              <div style={{ color: 'var(--text-dim)' }}>
                ready {latestAutomationSession.selectedSubmitReadyCount} · pre-fork{' '}
                {latestAutomationSession.selectedPreForkReadyCount}
              </div>
            ) : null}
          </div>
          <div className="stat">
            <div className="label">Authorization</div>
            <div style={{ color: 'var(--text-dim)' }}>
              {automationMessage ?? 'No active authorization in this view'}
            </div>
          </div>
        </div>
        {(automationSessions?.sessions.length ?? 0) > 0 ? (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Session</th>
                <th>Status</th>
                <th>Capital</th>
                <th>Selected</th>
                <th>Control</th>
              </tr>
            </thead>
            <tbody>
              {automationSessions!.sessions.slice(0, 8).map((session) => (
                <tr key={session.id}>
                  <td>
                    <code>{short(session.id)}</code>
                    <div style={{ color: 'var(--text-dim)' }}>{short(session.walletAddress)}</div>
                  </td>
                  <td>
                    <span className={`badge badge-${session.status === 'armed-submit-ready' ? 'active' : 'paused'}`}>
                      {session.status}
                    </span>
                    <div style={{ color: 'var(--text-dim)' }}>{session.reason}</div>
                  </td>
                  <td>{formatUsd(session.capitalUsd)}</td>
                  <td>
                    opp {session.selectedOpportunityCount}
                    <div style={{ color: 'var(--text-dim)' }}>
                      ready {session.selectedSubmitReadyCount} · pre-fork {session.selectedPreForkReadyCount}
                    </div>
                  </td>
                  <td>
                    <button
                      onClick={() => stopAutomationSession(session.id)}
                      disabled={session.status === 'stopped' || stoppingSessionId === session.id}
                    >
                      {session.status === 'stopped'
                        ? 'Stopped'
                        : stoppingSessionId === session.id
                          ? 'Stopping'
                          : 'Stop'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ marginTop: 0 }}>Execution queue</h3>
            <div style={{ color: 'var(--text-dim)' }}>
              Executor-side queue derived from active automation sessions
            </div>
          </div>
          {executionQueue ? (
            <span className={`badge badge-${executionQueue.summary.submitTaskCount > 0 ? 'active' : 'paused'}`}>
              {executionQueue.status}
            </span>
          ) : null}
        </div>
        <div className="grid grid-4" style={{ marginTop: 16 }}>
          <div className="stat">
            <div className="label">Tasks</div>
            <div className="value">{executionQueue?.summary.taskCount ?? 0}</div>
          </div>
          <div className="stat">
            <div className="label">Submit</div>
            <div className="value">{executionQueue?.summary.submitTaskCount ?? 0}</div>
          </div>
          <div className="stat">
            <div className="label">Fork verify</div>
            <div className="value">{executionQueue?.summary.forkVerifyTaskCount ?? 0}</div>
          </div>
          <div className="stat">
            <div className="label">Wait / blocked</div>
            <div style={{ color: 'var(--text-dim)' }}>
              wait {executionQueue?.summary.waitScannerTaskCount ?? 0} · blocked{' '}
              {executionQueue?.summary.blockedTaskCount ?? 0}
            </div>
          </div>
        </div>
        {(executionQueue?.tasks.length ?? 0) > 0 ? (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Action</th>
                <th>Opportunity</th>
                <th>Capital</th>
                <th>Checks</th>
              </tr>
            </thead>
            <tbody>
              {executionQueue!.tasks.slice(0, 12).map((task, index) => (
                <tr key={`${task.sessionId}-${task.opportunityId ?? index}`}>
                  <td>
                    <span className={`badge badge-${task.action === 'submit' ? 'active' : 'paused'}`}>
                      {task.action}
                    </span>
                    <div style={{ color: 'var(--text-dim)' }}>{short(task.sessionId)}</div>
                  </td>
                  <td>
                    <div>{task.chain ?? 'n/a'}</div>
                    <div style={{ color: 'var(--text-dim)' }}>{task.familyKey ?? 'n/a'}</div>
                    <code>{task.opportunityId ? short(task.opportunityId) : 'none'}</code>
                  </td>
                  <td>
                    {formatUsd(task.recommendedCapitalUsd)}
                    <div style={{ color: 'var(--text-dim)' }}>session {formatUsd(task.capitalUsd)}</div>
                  </td>
                  <td>
                    {formatChecks(task.blockingChecks, task.waitingChecks)}
                    <div style={{ color: 'var(--text-dim)' }}>{task.reason}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ color: 'var(--text-dim)', padding: 20, textAlign: 'center' }}>
            No active automation session tasks.
          </div>
        )}
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ marginTop: 0 }}>Scanner feed</h3>
            <div style={{ color: 'var(--text-dim)' }}>
              Normalized two-machine feed for scanner-to-executor handoff
            </div>
          </div>
          {feed ? (
            <span className={`badge badge-${feed.summary.actionableCount > 0 ? 'active' : 'paused'}`}>
              {feed.summary.status}
            </span>
          ) : null}
        </div>
        {feed ? (
          <>
            <div className="grid grid-4" style={{ marginTop: 16 }}>
              <div className="stat">
                <div className="label">Opportunities</div>
                <div className="value">{feed.summary.opportunityCount}</div>
              </div>
              <div className="stat">
                <div className="label">Actionable</div>
                <div className="value">{feed.summary.actionableCount}</div>
              </div>
              <div className="stat">
                <div className="label">Watch</div>
                <div className="value">{feed.summary.watchCount}</div>
              </div>
              <div className="stat">
                <div className="label">Policy</div>
                <div style={{ color: 'var(--text-dim)' }}>
                  quote {feed.policy.maxQuoteAgeMs ?? 'n/a'}ms · slippage{' '}
                  {feed.policy.maxSlippageBps ?? 'n/a'}bps · live{' '}
                  {feed.policy.liveExecutionEnabled ? 'enabled' : 'off'}
                </div>
              </div>
            </div>
            <table style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Opportunity</th>
                  <th>Action</th>
                  <th>Route</th>
                  <th>Net / Return</th>
                  <th>Capacity</th>
                  <th>Depth</th>
                  <th>Cost / Slip</th>
                  <th>Timing</th>
                  <th>Gate</th>
                </tr>
              </thead>
              <tbody>
                {feed.opportunities.slice(0, 20).map((o) => (
                  <tr key={`${o.familyKey}-${o.id}`}>
                    <td>
                      <div>{o.chain}</div>
                      <div style={{ color: 'var(--text-dim)' }}>{o.familyKey}</div>
                      <code>{short(o.id)}</code>
                    </td>
                    <td>{o.executorAction}</td>
                    <td>{o.market.route ?? o.strategyType}</td>
                    <td>
                      {formatUsd(o.economics.estimatedNetProfitUsd)}
                      <div style={{ color: 'var(--text-dim)' }}>{formatPct(o.economics.returnPct)}</div>
                    </td>
                    <td>
                      {formatUsd(o.economics.capacityUsd)}
                      <div style={{ color: 'var(--text-dim)' }}>
                        capital {formatUsd(o.economics.capitalRequiredUsd)}
                      </div>
                      <div style={{ color: 'var(--text-dim)' }}>
                        {formatCapacityCurve(o.market.capacityCurve)}
                      </div>
                    </td>
                    <td>
                      liq {formatUsd(o.market.poolLiquidityUsd)}
                      <div style={{ color: 'var(--text-dim)' }}>
                        vol {formatUsd(o.market.volume24hUsd)}
                      </div>
                      <div style={{ color: 'var(--text-dim)' }}>
                        {formatDepthSource(o.market)}
                      </div>
                      <div style={{ color: 'var(--text-dim)' }}>
                        {formatUniDepth(o.market)}
                      </div>
                    </td>
                    <td>
                      gas {formatUsd(o.economics.gasUsd)}
                      <div style={{ color: 'var(--text-dim)' }}>
                        slip {o.economics.slippageBudgetBps ?? 'n/a'} bps · impact{' '}
                        {formatBps(o.market.priceImpactBps)}
                      </div>
                      <div style={{ color: 'var(--text-dim)' }}>
                        {formatSource(o.market.priceImpactBpsSource ?? o.market.capacitySource)}
                      </div>
                    </td>
                    <td>
                      ttl {o.ttlSeconds}s
                      <div style={{ color: 'var(--text-dim)' }}>
                        quote {o.timing.maxQuoteAgeMs}ms · incl {o.timing.maxInclusionDelayMs}ms
                      </div>
                      <div style={{ color: 'var(--text-dim)' }}>
                        {formatLatency(o.timing.observedLatencyMs)}
                      </div>
                    </td>
                    <td>
                      <span className={`badge badge-${o.gate.status === 'pass' ? 'active' : 'paused'}`}>
                        {o.gate.status}
                      </span>
                      <div style={{ color: 'var(--text-dim)' }}>{o.gate.reason}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <div style={{ color: 'var(--text-dim)', padding: 20, textAlign: 'center' }}>
            No scanner feed yet. Run <code>npm run build:live-opportunity-feed</code> or{' '}
            <code>npm run node:scanner</code>.
          </div>
        )}
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ marginTop: 0 }}>Executor decision</h3>
            <div style={{ color: 'var(--text-dim)' }}>
              Capital-aware gating for the scanner feed before fork verification or submission
            </div>
          </div>
          {decision ? (
            <span className={`badge badge-${decision.summary.submitReadyCount > 0 ? 'active' : 'paused'}`}>
              {decision.status}
            </span>
          ) : null}
        </div>
        <div className="grid grid-4" style={{ marginTop: 16 }}>
          <label className="stat">
            <div className="label">Capital USD</div>
            <input
              value={capitalUsd}
              onChange={(event) => setCapitalUsd(event.target.value)}
              inputMode="decimal"
              style={{ width: '100%' }}
            />
          </label>
          <div className="stat">
            <div className="label">Pre-fork ready</div>
            <div className="value">{decision?.summary.preForkReadyCount ?? 0}</div>
          </div>
          <div className="stat">
            <div className="label">Submit ready</div>
            <div className="value">{decision?.summary.submitReadyCount ?? 0}</div>
          </div>
          <div className="stat">
            <div className="label">Executor gates</div>
            <div style={{ color: 'var(--text-dim)' }}>
              live {decision?.policy.liveExecutionEnabled ? 'on' : 'off'} · signer{' '}
              {decision?.policy.signerConfigured ? 'yes' : 'no'} · relay{' '}
              {decision?.policy.privateRelayConfigured ? 'yes' : 'no'}
            </div>
          </div>
        </div>
        {decision ? (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Status</th>
                <th>Capital</th>
                <th>Net / Return</th>
                  <th>Risk</th>
                  <th>Depth</th>
                  <th>Blocks</th>
              </tr>
            </thead>
            <tbody>
              {decision.opportunityDecisions.slice(0, 12).map((o) => (
                <tr key={`decision-${o.familyKey}-${o.id}`}>
                  <td>
                    <div>{o.chain}</div>
                    <div style={{ color: 'var(--text-dim)' }}>{o.familyKey}</div>
                    <code>{short(o.id)}</code>
                  </td>
                  <td>
                    <span className={`badge badge-${o.submitReady ? 'active' : 'paused'}`}>
                      {o.status}
                    </span>
                    <div style={{ color: 'var(--text-dim)' }}>{o.executorAction}</div>
                  </td>
                  <td>
                    use {formatUsd(o.recommendedCapitalUsd)}
                    <div style={{ color: 'var(--text-dim)' }}>
                      req {formatUsd(o.capitalRequiredUsd)} · cap {formatUsd(o.capacityUsd)}
                    </div>
                  </td>
                  <td>
                    {formatUsd(o.estimatedNetProfitUsd)}
                    <div style={{ color: 'var(--text-dim)' }}>{formatPct(o.returnPct)}</div>
                  </td>
                  <td>
                    gas {formatUsd(o.gasUsd)}
                    <div style={{ color: 'var(--text-dim)' }}>
                      impact {formatBps(o.priceImpactBps)} · quote {formatMs(o.quoteAgeMs)}
                    </div>
                  </td>
                  <td>
                    liq {formatUsd(o.poolLiquidityUsd)}
                    <div style={{ color: 'var(--text-dim)' }}>
                      vol {formatUsd(o.volume24hUsd)}
                      <div style={{ color: 'var(--text-dim)' }}>{formatUniTickState(o.uniswapV3TickState)}</div>
                      <div style={{ color: 'var(--text-dim)' }}>{formatUniDepthCapacity(o.uniswapV3DepthCapacity)}</div>
                    </div>
                  </td>
                  <td>{formatChecks(o.blockingChecks, o.waitingChecks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ color: 'var(--text-dim)', padding: 20, textAlign: 'center' }}>
            No executor decision yet.
          </div>
        )}
      </div>
      <div className="grid grid-2">
        <div className="card">
          <h3>Opportunities (last hour)</h3>
          {(opps?.length ?? 0) === 0 ? (
            <div style={{ color: 'var(--text-dim)', padding: 20, textAlign: 'center' }}>None yet. Start workers + connect a chain.</div>
          ) : (
            <table>
              <thead><tr><th>ID</th><th>Strategy</th><th>Chain</th><th>Net</th><th>Status</th></tr></thead>
              <tbody>
                {opps!.slice(0, 30).map((o) => (
                  <tr key={o.id}>
                    <td><code>{o.id.slice(0, 10)}</code></td>
                    <td>{o.strategy_id}</td>
                    <td>{o.chain_id}</td>
                    <td>{o.net_profit}</td>
                    <td><span className={`badge badge-${o.status === 'executed' ? 'active' : 'paused'}`}>{o.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h3>Executions (24h)</h3>
          {(execs?.length ?? 0) === 0 ? (
            <div style={{ color: 'var(--text-dim)', padding: 20, textAlign: 'center' }}>None yet.</div>
          ) : (
            <table>
              <thead><tr><th>ID</th><th>Chain</th><th>Net</th><th>Status</th></tr></thead>
              <tbody>
                {execs!.slice(0, 30).map((e) => (
                  <tr key={e.id}>
                    <td><code>{e.id.slice(0, 10)}</code></td>
                    <td>{e.chain_id}</td>
                    <td>{e.net_profit}</td>
                    <td><span className={`badge badge-${e.status === 'confirmed' ? 'active' : 'paused'}`}>{e.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function formatUsd(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 'n/a' : `$${value.toFixed(4)}`;
}

function formatPct(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 'n/a' : `${value.toFixed(2)}%`;
}

function formatBps(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 'n/a' : `${value.toFixed(1)} bps`;
}

function formatLatency(value: LiveOpportunityFeed['opportunities'][number]['timing']['observedLatencyMs']): string {
  if (!value) return 'latency n/a';
  return `lat p95 ${formatMs(value.p95)} · max ${formatMs(value.max)}`;
}

function formatMs(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 'n/a' : `${Math.round(value)}ms`;
}

function formatCapacityCurve(
  curve: LiveOpportunityFeed['opportunities'][number]['market']['capacityCurve'],
): string {
  if (!curve || curve.length === 0) return 'curve n/a';
  const passing = curve.filter((point) => point.gate === 'pass').length;
  const maxTested = curve.reduce<number | null>((best, point) => {
    if (point.amountUsd == null || !Number.isFinite(point.amountUsd)) return best;
    return best == null ? point.amountUsd : Math.max(best, point.amountUsd);
  }, null);
  return `curve ${passing}/${curve.length} pass · max test ${formatUsd(maxTested)}`;
}

function formatSource(value: string | null | undefined): string {
  return value ? value.replaceAll('_', ' ') : 'source n/a';
}

function formatDepthSource(market: LiveOpportunityFeed['opportunities'][number]['market']): string {
  const routePoolCount = market.routePools?.length ?? 0;
  const uniLoaded = market.routePools?.filter((pool) => pool.uniswapV3State?.status === 'loaded').length ?? 0;
  const source = market.poolLiquiditySource ?? market.depthSnapshotStatus ?? 'depth n/a';
  const volume = market.volume24hSource ? ` · ${market.volume24hSource.replaceAll('_', ' ')}` : '';
  const uni = uniLoaded ? ` · uni ticks ${uniLoaded}` : '';
  return `${source.replaceAll('_', ' ')} · pools ${routePoolCount}${uni}${volume}`;
}

function formatUniTickState(value: ExecutionDecision['opportunityDecisions'][number]['uniswapV3TickState']): string {
  if (!value?.required) return 'uni ticks n/a';
  return `uni ticks ${value.loadedCount}/${value.poolCount}`;
}

function formatUniDepth(market: LiveOpportunityFeed['opportunities'][number]['market']): string {
  if (market.uniswapV3DepthStatus === 'not-required' || market.uniswapV3DepthStatus == null) return 'uni depth n/a';
  return `uni depth ${market.uniswapV3DepthStatus} · ${formatUsd(market.uniswapV3DepthCapacityUsd)}`;
}

function formatUniDepthCapacity(
  value: ExecutionDecision['opportunityDecisions'][number]['uniswapV3DepthCapacity'],
): string {
  if (!value?.required) return 'uni depth n/a';
  return `uni depth ${formatUsd(value.capacityUsd)} / req ${formatUsd(value.requiredCapacityUsd)}`;
}

function formatChecks(blocking: string[], waiting: string[]): string {
  if (blocking.length === 0 && waiting.length === 0) return 'clear';
  const parts = [];
  if (blocking.length) parts.push(`block ${blocking.slice(0, 3).join(', ')}`);
  if (waiting.length) parts.push(`wait ${waiting.slice(0, 3).join(', ')}`);
  return parts.join(' · ');
}

function strategyFamiliesFromFeed(feed: LiveOpportunityFeed): string[] {
  return Array.from(new Set(feed.opportunities.map((opportunity) => opportunity.familyKey))).sort();
}

async function requestWalletAddress(): Promise<string | undefined> {
  if (!window.ethereum) return undefined;
  const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
  return accounts[0];
}

function short(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}...${value.slice(-6)}`;
}

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown[] }): Promise<unknown>;
      on?(event: string, listener: (...args: unknown[]) => void): void;
      removeListener?(event: string, listener: (...args: unknown[]) => void): void;
    };
  }
}
