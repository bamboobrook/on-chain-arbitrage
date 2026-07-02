'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../providers';
import { STRATEGIES } from '@oal/config';
import { RiskBadge } from '@oal/ui';

export default function StrategiesPage() {
  const { data } = useQuery({
    queryKey: ['strategies'],
    queryFn: () => api<{ id: string; name: string; riskClass: string; status: string }[]>('/api/strategies'),
  });
  const rows = data ?? STRATEGIES.map((s) => ({ id: s.id, name: s.name, riskClass: s.riskClass, status: s.status }));

  return (
    <div>
      <h1>Strategies</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        Arbitrage models with explicit risk classification. Note: yield-rotator is cash management,
        <strong> not arbitrage</strong>. Cross-chain inventory and solver are phase 2/3.
      </p>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Risk</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td><code>{s.id}</code></td>
                <td>{s.name}</td>
                <td><RiskBadge riskClass={s.riskClass as never} /></td>
                <td><span className={`badge badge-${s.status}`}>{s.status}</span></td>
                <td><a href={`/strategies/${s.id}`}>details →</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
