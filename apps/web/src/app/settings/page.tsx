'use client';

import { useState } from 'react';

export default function SettingsPage() {
  const [connected, setConnected] = useState(false);
  return (
    <div>
      <h1>Settings</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        Wallet, network and notifications. No registration, no email — wallet-only (per design).
      </p>
      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Wallet</h3>
          <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            Connect an EOA to deposit/withdraw from vaults and view your positions.
            Supported chains: Base, Arbitrum (and Anvil for local dev).
          </p>
          <button onClick={() => setConnected((c) => !c)}>
            {connected ? 'Disconnect wallet' : 'Connect wallet'}
          </button>
          {connected && <div style={{ marginTop: 8, fontSize: 12 }}>Connected (demo): 0x…</div>}
        </div>
        <div className="card">
          <h3>Permit2 / Allowances</h3>
          <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            Review and revoke token allowances granted to vaults. Always revoke when leaving a strategy.
          </p>
          <div style={{ color: 'var(--text-dim)', padding: 12 }}>No active allowances.</div>
        </div>
      </div>
    </div>
  );
}
