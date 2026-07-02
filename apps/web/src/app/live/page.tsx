'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../providers';

export default function LivePage() {
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

  return (
    <div>
      <h1>Live Monitor</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        Real-time opportunity queue, simulation pass rate and execution results. Admin can pause/resume here.
      </p>
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
