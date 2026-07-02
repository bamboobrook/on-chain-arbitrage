import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

const NAV = [
  ['/', 'Dashboard', '📊'],
  ['/strategies', 'Strategies', '🎯'],
  ['/backtests/new', 'New Backtest', '🧪'],
  ['/vaults', 'Vaults', '🏦'],
  ['/live', 'Live', '⚡'],
  ['/risk', 'Risk', '🛡️'],
  ['/settings', 'Settings', '⚙️'],
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="shell">
            <aside className="sidebar">
              <h2>Arbitrage Lab</h2>
              <div className="tagline">On-chain · pre-audit · research</div>
              <nav>
                {NAV.map(([href, label, icon]) => (
                  <a key={href} href={href}>
                    {icon} {label}
                  </a>
                ))}
              </nav>
              <div style={{ marginTop: 24, fontSize: 11, color: 'var(--text-dim)' }}>
                <div style={{ marginBottom: 6 }}>⚠️ 历史收益不代表未来收益</div>
                <div>策略目标不等于保证收益</div>
              </div>
            </aside>
            <main className="main">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
