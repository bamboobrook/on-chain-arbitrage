/**
 * @oal/sdk API client — typed REST + SSE client for the Fastify gateway.
 */

import type {
  BacktestMetrics,
  BacktestRunDTO,
  CostModelParams,
  ExecutionDTO,
  RiskEventDTO,
  StrategyDTO,
  VaultDTO,
} from './types.js';

/** Minimal EventSource shape we depend on (DOM EventSource is one impl). */
interface EventSourceLike {
  onmessage: (ev: { data: string }) => void;
  onerror: (e: unknown) => void;
  close(): void;
}

export interface ApiClientOptions {
  baseUrl: string;
  adminApiKey?: string;
  fetch?: typeof fetch;
}

export class ApiClient {
  private baseUrl: string;
  private adminApiKey?: string;
  private fetchFn: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.adminApiKey = opts.adminApiKey;
    this.fetchFn = opts.fetch ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (this.adminApiKey) headers.set('X-Admin-Key', this.adminApiKey);
    const res = await this.fetchFn(`${this.baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(res.status, res.statusText, text);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // -- reference -----------------------------------------------------------
  chains = () => this.request<{ chainId: number; name: string }[]>('/api/chains');
  assets = () => this.request<{ chainId: number; symbol: string; decimals: number }[]>('/api/assets');

  // -- strategies ----------------------------------------------------------
  strategies = () => this.request<StrategyDTO[]>('/api/strategies');
  strategy = (id: string) => this.request<StrategyDTO>(`/api/strategies/${id}`);
  strategyMetrics = (id: string) => this.request<Record<string, number>>(`/api/strategies/${id}/metrics`);

  // -- backtests -----------------------------------------------------------
  createBacktest = (body: {
    strategyId: string;
    chainId: number;
    asset: string;
    startBlock: number;
    endBlock: number;
    capital: string;
    costModel?: CostModelParams;
    params?: Record<string, unknown>;
  }) => this.request<{ id: string; status: string }>('/api/backtests', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  backtest = (id: string) => this.request<BacktestRunDTO>(`/api/backtests/${id}`);
  backtestEvents = (id: string) => this.request<{ metrics: BacktestMetrics }>(`/api/backtests/${id}/events`);

  // -- vaults --------------------------------------------------------------
  vaults = () => this.request<VaultDTO[]>('/api/vaults');
  vault = (id: string) => this.request<VaultDTO>(`/api/vaults/${id}`);
  vaultPositions = (id: string) => this.request<unknown[]>(`/api/vaults/${id}/positions`);
  vaultPnl = (id: string) => this.request<{ day: string; pnl: string }[]>(`/api/vaults/${id}/pnl`);

  // -- live ----------------------------------------------------------------
  liveOpportunities = () => this.request<unknown[]>('/api/live/opportunities');
  liveExecutions = () => this.request<ExecutionDTO[]>('/api/live/executions');

  // -- admin ---------------------------------------------------------------
  pauseStrategy = (id: string) =>
    this.request<{ ok: boolean }>(`/api/admin/strategies/${id}/pause`, { method: 'POST' });
  resumeStrategy = (id: string) =>
    this.request<{ ok: boolean }>(`/api/admin/strategies/${id}/resume`, { method: 'POST' });
  rebalanceVault = (id: string) =>
    this.request<{ ok: boolean }>(`/api/admin/vaults/${id}/rebalance`, { method: 'POST' });

  // -- SSE -----------------------------------------------------------------
  /** Open an SSE stream. Returns a disposer. */
  stream<T = unknown>(
    path: string,
    handlers: { onMessage: (data: T) => void; onError?: (e: unknown) => void },
  ): () => void {
    const url = `${this.baseUrl}${path}`;
    // Prefer native EventSource when available (browser). In Node the apps use
    // their own SSE reader; this is the shared contract.
    const ES = (globalThis as unknown as { EventSource?: { new (url: string): EventSourceLike } }).EventSource;
    if (ES) {
      const es = new ES(url);
      es.onmessage = (ev: { data: string }) => {
        try {
          handlers.onMessage(JSON.parse(ev.data) as T);
        } catch {
          handlers.onMessage(ev.data as unknown as T);
        }
      };
      es.onerror = (e: unknown) => handlers.onError?.(e);
      return () => es.close();
    }
    handlers.onError?.(new Error('EventSource not available in this environment'));
    return () => {};
  }

  streamRiskEvents = (h: { onMessage: (e: RiskEventDTO) => void; onError?: (e: unknown) => void }) =>
    this.stream<RiskEventDTO>('/stream/risk-events', h);
  streamLiveExecutions = (h: { onMessage: (e: ExecutionDTO) => void; onError?: (e: unknown) => void }) =>
    this.stream<ExecutionDTO>('/stream/live/executions', h);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: string,
  ) {
    super(`API ${status} ${statusText}: ${body}`);
    this.name = 'ApiError';
  }
}
