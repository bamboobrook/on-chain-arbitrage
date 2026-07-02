/**
 * @oal/ui — shared React components for the On-Chain Arbitrage Lab console.
 *
 * Includes the mandatory risk disclaimers (docs/risk-policy.md §10.2): the
 * "must show" lines are hard-coded and the "must never show" lines are listed
 * for reference so marketing copy never sneaks in.
 */

import type { ReactNode } from 'react';
import type { RiskClass } from '@oal/sdk';

// ---------------------------------------------------------------------------
// Risk disclaimer — REQUIRED everywhere yield is shown.
// ---------------------------------------------------------------------------

/** Lines the UI MUST always show near any yield / return figure. */
export const REQUIRED_DISCLAIMER_LINES = [
  '历史收益不代表未来收益。',
  '策略目标不等于保证收益。',
  '智能合约、MEV、流动性和协议风险可能导致损失。',
  '跨链策略不是原子套利。',
] as const;

/** Phrases the UI must NEVER show (guard against marketing overreach). */
export const FORBIDDEN_PHRASES = [
  '稳赚',
  '保本',
  '保证 20%+',
  '无风险套利',
] as const;

export function Disclaimer({ variant = 'compact' }: { variant?: 'compact' | 'full' }) {
  return (
    <div
      role="note"
      style={{
        padding: '12px 14px',
        borderRadius: 8,
        background: 'rgba(234, 67, 53, 0.08)',
        border: '1px solid rgba(234, 67, 53, 0.3)',
        fontSize: variant === 'full' ? 14 : 12,
        color: '#b3261e',
        lineHeight: 1.5,
      }}
    >
      {REQUIRED_DISCLAIMER_LINES.map((line) => (
        <div key={line}>⚠️ {line}</div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

export function Card({
  children,
  title,
  action,
}: {
  children: ReactNode;
  title?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 20,
      }}
    >
      {(title || action) && (
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export function RiskBadge({ riskClass }: { riskClass: RiskClass }) {
  const colors: Record<RiskClass, { bg: string; fg: string; label: string }> = {
    low: { bg: '#dcfce7', fg: '#166534', label: 'Low' },
    medium: { bg: '#fef9c3', fg: '#854d0e', label: 'Medium' },
    high: { bg: '#fee2e2', fg: '#991b1b', label: 'High' },
    experimental: { bg: '#f3e8ff', fg: '#6b21a8', label: 'Experimental' },
  };
  const c = colors[riskClass];
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {c.label}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  const active = status === 'active' || status === 'confirmed';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: active ? '#22c55e' : '#9ca3af',
        marginRight: 6,
      }}
    />
  );
}

/** Format a base-unit decimal string into a human number string. */
export function formatAmount(value: string, decimals = 18, digits = 4): string {
  try {
    const v = BigInt(value);
    const divisor = 10n ** BigInt(decimals);
    const whole = v / divisor;
    const frac = v % divisor;
    const fracStr = frac.toString().padStart(Number(decimals), '0').slice(0, digits);
    return `${whole.toString()}.${fracStr}`;
  } catch {
    return value;
  }
}

export function formatPct(x: number, digits = 2): string {
  return `${x.toFixed(digits)}%`;
}
