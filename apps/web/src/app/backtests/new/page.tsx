'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../providers';
import { STRATEGIES, CHAINS, ASSETS } from '@oal/config';
import { Disclaimer } from '@oal/ui';

const TEMPLATES = {
  Conservative: { gasStressPct: 0.5, bribeStressPct: 0.5, inclusionRate: 0.5 },
  Balanced: { gasStressPct: 0.25, bribeStressPct: 0.25, inclusionRate: 0.7 },
  Aggressive: { gasStressPct: 0, bribeStressPct: 0, inclusionRate: 0.9 },
};

export default function NewBacktestPage() {
  const router = useRouter();
  const [strategyId, setStrategyId] = useState('atomic-amm');
  const [chainId, setChainId] = useState(8453);
  const [symbol, setSymbol] = useState('USDC');
  const [startBlock, setStartBlock] = useState('25000000');
  const [endBlock, setEndBlock] = useState('25010000');
  const [capital, setCapital] = useState('10000000000'); // 10k USDC at 6 dec
  const [template, setTemplate] = useState<keyof typeof TEMPLATES>('Balanced');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const asset = ASSETS.find((a) => a.chainId === chainId && a.symbol === symbol);

  async function submit() {
    setSubmitting(true);
    setError(undefined);
    try {
      if (!asset) throw new Error('no asset for selected chain/symbol');
      const res = await api<{ id: string }>('/api/backtests', {
        method: 'POST',
        body: JSON.stringify({
          strategyId,
          chainId,
          asset: asset.address,
          startBlock: Number(startBlock),
          endBlock: Number(endBlock),
          capital,
          costModel: TEMPLATES[template],
        }),
      });
      router.push(`/backtests/${res.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>New Backtest</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        Run a strategy over historical block-level state with an explicit cost model.
        Anti-overfit (walk-forward, capacity, cost-stress) is enforced by the engine.
      </p>

      <Disclaimer />

      <div className="card" style={{ maxWidth: 720 }}>
        <div className="form-row">
          <label>
            Strategy
            <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
              {STRATEGIES.filter((s) => s.phase === 1).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label>
            Chain
            <select value={chainId} onChange={(e) => setChainId(Number(e.target.value))}>
              {CHAINS.filter((c) => c.isActive && c.chainId !== 31337).map((c) => (
                <option key={c.chainId} value={c.chainId}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            Asset
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {['USDC', 'WETH'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>Start block<input value={startBlock} onChange={(e) => setStartBlock(e.target.value)} /></label>
          <label>End block<input value={endBlock} onChange={(e) => setEndBlock(e.target.value)} /></label>
          <label>Capital (base units)<input value={capital} onChange={(e) => setCapital(e.target.value)} /></label>
        </div>
        <div className="form-row">
          <label>
            Cost template
            <select value={template} onChange={(e) => setTemplate(e.target.value as never)}>
              {Object.keys(TEMPLATES).map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 8 }}>
          Template &ldquo;{template}&rdquo;: gas/bribe stress {Math.round(TEMPLATES[template].gasStressPct * 100)}%,
          inclusion {Math.round(TEMPLATES[template].inclusionRate * 100)}%.
        </div>
        {error && <div style={{ color: 'var(--red)', marginTop: 8 }}>{error}</div>}
        <div style={{ marginTop: 16 }}>
          <button onClick={submit} disabled={submitting}>{submitting ? 'Submitting…' : 'Run backtest'}</button>
        </div>
      </div>
    </div>
  );
}
