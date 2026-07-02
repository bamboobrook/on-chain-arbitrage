'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../providers';
import { strategyById } from '@oal/config';
import { RiskBadge, Disclaimer } from '@oal/ui';

export default function StrategyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const meta = strategyById(id);
  const { data: metrics } = useQuery({
    queryKey: ['strategy-metrics', id],
    queryFn: () => api<Record<string, number>>(`/api/strategies/${id}/metrics`),
  });

  if (!meta) return <div>Strategy not found: {id}</div>;

  return (
    <div>
      <h1>{meta.name}</h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <RiskBadge riskClass={meta.riskClass} />
        <span className={`badge badge-${meta.status}`}>{meta.status}</span>
        <span style={{ color: 'var(--text-dim)' }}>v{meta.version} · phase {meta.phase} · {meta.capitalMode}</span>
      </div>

      <Disclaimer />

      <div className="grid grid-4" style={{ margin: '16px 0' }}>
        <div className="card stat">
          <div className="label">Live APY (rolling)</div>
          <div className="value">{fmt(metrics?.liveApy)}%</div>
        </div>
        <div className="card stat">
          <div className="label">Backtest APY (OOS)</div>
          <div className="value">{fmt(metrics?.oosApy)}%</div>
        </div>
        <div className="card stat">
          <div className="label">Max Drawdown</div>
          <div className="value">{fmt(metrics?.maxDrawdown)}%</div>
        </div>
        <div className="card stat">
          <div className="label">Capacity</div>
          <div className="value">${fmt(metrics?.capacity ?? 0)}</div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3>Description</h3>
          <p style={{ color: 'var(--text-dim)', lineHeight: 1.6 }}>
            {describe(meta.id)}. Supported chains: {meta.supportedChains.join(', ') || 'none (phase 2/3)'}.
            Supported assets: {meta.supportedAssets.join(', ') || 'none'}.
          </p>
        </div>
        <div className="card">
          <h3>Recent Trades</h3>
          <div style={{ color: 'var(--text-dim)', padding: 20, textAlign: 'center' }}>
            Trades appear once the execution worker is connected to a chain.
          </div>
        </div>
      </div>
    </div>
  );
}

function fmt(x: number | undefined): string {
  return x == null ? '—' : x.toFixed(2);
}

function describe(id: string): string {
  switch (id) {
    case 'atomic-amm':
      return 'Same-chain atomic arbitrage: buy on one DEX, sell on another within one transaction. Flash-loan or vault capital. Failed trades revert with no leftover exposure.';
    case 'mev-backrun':
      return 'Backrun large swaps from MEV-Share orderflow to capture the induced price spread. Private bundle submission.';
    case 'peg-lst':
      return 'Peg / LST / stable-baset deviations via Curve/Balancer/Uniswap + redemption. Positions held for a regression half-life. NOT risk-free — peg-break and liquidity risk apply.';
    case 'yield-rotator':
      return 'Cash management into low-risk DeFi yields. Labeled "yield rotation", explicitly NOT arbitrage.';
    default:
      return `${id} — phase 2/3 strategy (not yet active).`;
  }
}
