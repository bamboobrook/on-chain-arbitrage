'use client';

import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, API_BASE } from '../../providers';
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
  const [busy, setBusy] = useState(false);

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
            Connect an injected wallet, approve the vault to spend the asset, then deposit into the ERC-4626 vault.
          </p>
          <div className="form-row">
            <label>Amount (base units)<input value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} /></label>
          </div>
          <div className="form-row">
            <button onClick={() => void approveAndDeposit(vault, depositAmt, setTx, setBusy)} disabled={busy}>
              {busy ? 'Submitting...' : 'Approve + Deposit'}
            </button>
            <button onClick={() => setTx('Withdraw builder is next; use the vault redeem/withdraw functions directly for now.')}>
              Withdraw
            </button>
          </div>
          {tx && <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 8 }}>{tx}</div>}
        </div>
        <div className="card">
          <h3>Strategy Management (Phase 5)</h3>
          <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            Allocate deposited capital to an admitted strategy, start/stop automated execution.
          </p>
          <div className="form-row">
            <label>Strategy<select id="strat-select"><option value="aave-v3-liquidation">Aave V3 Liquidation</option></select></label>
            <label>Amount (USD)<input id="alloc-amt" defaultValue="1000" /></label>
            <button onClick={async () => {
              const s = document.getElementById('strat-select') as HTMLSelectElement;
              const a = document.getElementById('alloc-amt') as HTMLInputElement;
              const res = await fetch(`${API_BASE}/api/vaults/${vault.id}/allocate`, {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ userAddress: '0x0000000000000000000000000000000000000000', strategyId: s.value, amountUsd: parseFloat(a.value) }),
              });
              const r = await res.json();
              setTx(`Allocated: ${r.allocationId} (${r.status})`);
            }}>Allocate</button>
          </div>
          <div className="form-row">
            <label>Allocation ID<input id="alloc-id" defaultValue="" placeholder="from allocate above" /></label>
            <button onClick={async () => {
              const a = document.getElementById('alloc-id') as HTMLInputElement;
              const res = await fetch(`${API_BASE}/api/vaults/${vault.id}/start`, {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ allocationId: a.value, userAddress: '0x0000000000000000000000000000000000000000' }),
              });
              const r = await res.json();
              setTx(`Started: runId=${r.runId} (${r.status})`);
            }}>Start Strategy</button>
            <button onClick={() => {
              setTx('Use the runId from Start to stop. Enter runId below.');
            }}>Stop</button>
            <label>Run ID<input id="run-id" defaultValue="" placeholder="runId to stop" /></label>
            <button onClick={async () => {
              const r = document.getElementById('run-id') as HTMLInputElement;
              const res = await fetch(`${API_BASE}/api/vaults/${vault.id}/stop`, {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ runId: r.value }),
              });
              const result = await res.json();
              setTx(`Stopped: ${result.status} PnL=$${result.pnl} executions=${result.executions}`);
            }}>Confirm Stop</button>
          </div>
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

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown[] }): Promise<unknown>;
      on?(event: string, listener: (...args: unknown[]) => void): void;
      removeListener?(event: string, listener: (...args: unknown[]) => void): void;
    };
  }
}

async function approveAndDeposit(
  vault: Vault,
  amount: string,
  setTx: (msg: string) => void,
  setBusy: (busy: boolean) => void,
) {
  if (!window.ethereum) {
    setTx('No injected wallet found.');
    return;
  }
  if (!vault.address || !vault.asset_address) {
    setTx('Vault address or asset address is missing in the API response.');
    return;
  }
  setBusy(true);
  try {
    const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
    const receiver = accounts[0];
    if (!receiver) throw new Error('wallet returned no account');

    const approveHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [
        {
          from: receiver,
          to: normalizeAddress(vault.asset_address),
          data: encodeApprove(normalizeAddress(vault.address), amount),
        },
      ],
    });
    setTx(`Approve submitted: ${String(approveHash)}`);

    const depositHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [
        {
          from: receiver,
          to: normalizeAddress(vault.address),
          data: encodeDeposit(amount, receiver),
        },
      ],
    });
    setTx(`Deposit submitted: ${String(depositHash)}. Strategy execution starts when workers allocate this vault.`);
  } catch (err) {
    setTx((err as Error).message);
  } finally {
    setBusy(false);
  }
}

function encodeApprove(spender: string, amount: string): `0x${string}` {
  return `0x095ea7b3${padAddress(spender)}${padUint(amount)}`;
}

function encodeDeposit(amount: string, receiver: string): `0x${string}` {
  return `0x6e553f65${padUint(amount)}${padAddress(receiver)}`;
}

function normalizeAddress(addr: string): `0x${string}` {
  if (addr.startsWith('\\x')) return `0x${addr.slice(2)}`;
  return addr as `0x${string}`;
}

function padAddress(addr: string): string {
  return normalizeAddress(addr).slice(2).padStart(64, '0');
}

function padUint(value: string): string {
  return BigInt(value).toString(16).padStart(64, '0');
}
