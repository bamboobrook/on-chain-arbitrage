'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../providers';
import { Disclaimer } from '@oal/ui';

interface Run {
  id: string;
  strategy_id: string;
  status: string;
  chain_id: number;
  start_block: number;
  end_block: number;
  capital: string;
  metrics: {
    totalNetProfit: string;
    tradeCount: number;
    winRate: number;
    maxDrawdown: number;
    annualizedReturnPct: number;
    sharpe: number;
    equityCurve: { block: number; equity: string }[];
    dailyPnl: { day: string; pnl: string }[];
  } | null;
}

export default function BacktestResultPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const { data: run, refetch } = useQuery({
    queryKey: ['backtest', runId],
    queryFn: () => api<Run>(`/api/backtests/${runId}`),
    refetchInterval: (q) => (q.state.data?.status === 'done' || q.state.data?.status === 'failed' ? false : 2000),
  });

  if (!run) return <div>Loading…</div>;
  const m = run.metrics;

  return (
    <div>
      <h1>Backtest {run.id.slice(0, 8)}</h1>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <span className={`badge badge-${run.status === 'done' ? 'active' : 'paused'}`}>{run.status}</span>
        <span style={{ color: 'var(--text-dim)' }}>
          {run.strategy_id} · chain {run.chain_id} · blocks {run.start_block}–{run.end_block}
        </span>
        <button onClick={() => refetch()}>refresh</button>
      </div>

      <Disclaimer />

      <div className="grid grid-4" style={{ margin: '16px 0' }}>
        <div className="card stat"><div className="label">Net Profit</div><div className="value">{m?.totalNetProfit ?? '—'}</div></div>
        <div className="card stat"><div className="label">Trades</div><div className="value">{m?.tradeCount ?? '—'}</div></div>
        <div className="card stat"><div className="label">Annualized</div><div className="value">{m ? `${m.annualizedReturnPct.toFixed(2)}%` : '—'}</div></div>
        <div className="card stat"><div className="label">Max Drawdown</div><div className="value">{m ? `${m.maxDrawdown.toFixed(2)}%` : '—'}</div></div>
      </div>

      <div className="card">
        <h3>Equity Curve</h3>
        {m?.equityCurve?.length ? (
          <pre style={{ overflowX: 'auto' }}>{JSON.stringify(m.equityCurve.slice(0, 50), null, 2)}</pre>
        ) : (
          <div style={{ color: 'var(--text-dim)', padding: 20, textAlign: 'center' }}>
            {run.status === 'running' ? 'Backtest in progress…' : 'No equity data yet.'}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Daily P&amp;L</h3>
        {m?.dailyPnl?.length ? (
          <pre style={{ overflowX: 'auto' }}>{JSON.stringify(m.dailyPnl, null, 2)}</pre>
        ) : (
          <div style={{ color: 'var(--text-dim)', padding: 20, textAlign: 'center' }}>No daily data.</div>
        )}
      </div>
    </div>
  );
}
