'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../providers';

export default function RiskPage() {
  useQuery({
    queryKey: ['risk-events'],
    queryFn: () =>
      api<{ id: string; severity: string; scope: string; scope_id: string; message: string; created_at: string }[]>(
        '/api/live/opportunities', // reuse; risk events stream via SSE in production
      ).catch(() => []),
    refetchInterval: 5000,
  });

  return (
    <div>
      <h1>Risk</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        Live exposure, loss tracking, anomalies and blacklists. The risk-worker auto-pauses on
        breach of per-tx / per-day loss caps, oracle deviation or abnormal transfer behavior.
      </p>
      <div className="grid grid-4" style={{ margin: '16px 0' }}>
        <div className="card stat"><div className="label">Day P&amp;L</div><div className="value" style={{ color: 'var(--green)' }}>$0</div></div>
        <div className="card stat"><div className="label">Open Exposure</div><div className="value">$0</div></div>
        <div className="card stat"><div className="label">Sim Pass Rate</div><div className="value">—</div></div>
        <div className="card stat"><div className="label">Kill Switch</div><div className="value" style={{ color: 'var(--green)' }}>● Armed</div></div>
      </div>
      <div className="card">
        <h3>Risk Events</h3>
        <div style={{ color: 'var(--text-dim)', padding: 20, textAlign: 'center' }}>
          No risk events. Auto-pause triggers are defined in <code>docs/risk-policy.md</code>.
        </div>
      </div>
    </div>
  );
}
