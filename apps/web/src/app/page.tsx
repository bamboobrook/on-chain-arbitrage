import { Disclaimer } from '@oal/ui';

export default function DashboardPage() {
  return (
    <div>
      <h1 style={{ margin: '0 0 4px' }}>Dashboard</h1>
      <p style={{ color: 'var(--text-dim)', marginTop: 0 }}>
        On-Chain Arbitrage Lab — overview of total value locked, today&apos;s net P&amp;L,
        active strategies and system status.
      </p>

      <div className="topbar">
        <div className="stat">
          <div className="label">Total TVL</div>
          <div className="value">$0</div>
          <div className="hint">across all vaults</div>
        </div>
        <div className="stat">
          <div className="label">Today Net P&amp;L</div>
          <div className="value">$0</div>
          <div className="hint">realized, after gas + bribe</div>
        </div>
        <div className="stat">
          <div className="label">Active Strategies</div>
          <div className="value">3</div>
          <div className="hint">atomic-amm · mev-backrun · peg-lst</div>
        </div>
        <div className="stat">
          <div className="label">System Status</div>
          <div className="value" style={{ color: 'var(--green)' }}>● Running</div>
          <div className="hint">all workers up</div>
        </div>
      </div>

      <Disclaimer variant="full" />

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Recent Executions</h3>
          <div style={{ color: 'var(--text-dim)', padding: 20, textAlign: 'center' }}>
            Connect the workers and a chain to populate live executions. See <a href="/live">/live</a>.
          </div>
        </div>
        <div className="card">
          <h3>Vault Performance</h3>
          <div style={{ color: 'var(--text-dim)', padding: 20, textAlign: 'center' }}>
            Deploy a vault via the contracts and start depositing at <a href="/vaults">/vaults</a>.
          </div>
        </div>
      </div>
    </div>
  );
}
