'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../providers';
import { Disclaimer } from '@oal/ui';

interface Vault {
  id: string;
  chain_id: number;
  address: string;
  asset_address: string;
  strategy_id: string;
  status: string;
  tvl: string;
  share_price: string;
}

export default function VaultsPage() {
  const { data } = useQuery({
    queryKey: ['vaults'],
    queryFn: () => api<Vault[]>('/api/vaults'),
  });
  const vaults = data ?? [];

  return (
    <div>
      <h1>Vaults</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        ERC-4626 vaults. Deposit the asset, receive shares, withdraw anytime (subject to pause / withdrawal queue).
        Profit accrues to share price; performance fee charged on realized profit.
      </p>
      <Disclaimer />
      <div className="card">
        {vaults.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', padding: 20, textAlign: 'center' }}>
            No vaults yet. Deploy one via <code>make deploy-local</code> on Anvil, then register it here.
          </div>
        ) : (
          <table>
            <thead>
              <tr><th>ID</th><th>Chain</th><th>Asset</th><th>TVL</th><th>Share Price</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {vaults.map((v) => (
                <tr key={v.id}>
                  <td><code>{v.id}</code></td>
                  <td>{v.chain_id}</td>
                  <td><code>{v.asset_address?.slice(0, 10)}…</code></td>
                  <td>{v.tvl}</td>
                  <td>{v.share_price}</td>
                  <td><span className={`badge badge-${v.status === 'active' ? 'active' : 'paused'}`}>{v.status}</span></td>
                  <td><a href={`/vaults/${v.id}`}>open →</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
