'use client';

import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../providers';
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

export default function VaultDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: vault } = useQuery({ queryKey: ['vault', id], queryFn: () => api<Vault>(`/api/vaults/${id}`) });
  const { data: pnl } = useQuery({
    queryKey: ['vault-pnl', id],
    queryFn: () => api<{ day: string; pnl: string }[]>(`/api/vaults/${id}/pnl`),
  });
  const [depositAmt, setDepositAmt] = useState('1000000');
  const [tx, setTx] = useState<string>();

  if (!vault) return <div>Loading…</div>;

  return (
    <div>
      <h1>Vault {vault.id}</h1>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <span className={`badge badge-${vault.status === 'active' ? 'active' : 'paused'}`}>{vault.status}</span>
        <span style={{ color: 'var(--text-dim)' }}>
          chain {vault.chain_id} · asset <code>{vault.asset_address?.slice(0, 10)}…</code>
        </span>
      </div>

      <Disclaimer />

      <div className="grid grid-3" style={{ margin: '16px 0' }}>
        <div className="card stat"><div className="label">TVL</div><div className="value">{vault.tvl}</div></div>
        <div className="card stat"><div className="label">Share Price</div><div className="value">{vault.share_price}</div></div>
        <div className="card stat"><div className="label">Strategy</div><div className="value" style={{ fontSize: 16 }}>{vault.strategy_id ?? '—'}</div></div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3>Deposit / Withdraw</h3>
          <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            Connect a wallet (RainbowKit / wagmi ready) and approve the asset before depositing.
            On local Anvil use the deployer account.
          </p>
          <div className="form-row">
            <label>Amount (base units)<input value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} /></label>
          </div>
          <div className="form-row">
            <button onClick={() => setTx('deposit requires a connected wallet (wagmi hook)')}>Deposit</button>
            <button onClick={() => setTx('withdraw requires a connected wallet')}>Withdraw</button>
          </div>
          {tx && <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 8 }}>{tx}</div>}
        </div>
        <div className="card">
          <h3>Historical P&amp;L</h3>
          {pnl?.length ? (
            <pre style={{ overflowX: 'auto' }}>{JSON.stringify(pnl, null, 2)}</pre>
          ) : (
            <div style={{ color: 'var(--text-dim)', padding: 20, textAlign: 'center' }}>No P&amp;L history yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
