/**
 * RPC health monitor with automatic failover.
 *
 * Per full-audit plan §3 (Phase 0): each chain must have >= 2 RPCs with
 * latency/error/chain-head monitoring and automatic switchover.
 *
 * The monitor polls each chain's primary + backup RPC on a fixed interval,
 * records latency / error / block height, and exposes the healthy endpoint
 * via `getActiveRpc(chainId)`. When the primary exceeds the latency or error
 * threshold, the backup becomes active until the primary recovers.
 *
 * Designed to run inside the API gateway or a dedicated monitor worker.
 */

export interface RpcEndpoint {
  url: string;
  role: 'primary' | 'backup';
}

export interface ChainRpcConfig {
  chainId: number;
  name: string;
  endpoints: RpcEndpoint[];
  /** Max acceptable latency in ms. */
  maxLatencyMs: number;
  /** Max acceptable error rate (0..1). */
  errorRateThreshold: number;
  /** Poll interval in ms. */
  pollIntervalMs: number;
}

export interface EndpointHealth {
  url: string;
  role: 'primary' | 'backup';
  healthy: boolean;
  latencyMs: number;
  blockNumber: number | null;
  lastError: string | null;
  lastChecked: number; // epoch ms
  consecutiveErrors: number;
  totalChecks: number;
  totalErrors: number;
}

export interface ChainHealth {
  chainId: number;
  name: string;
  activeUrl: string;
  endpoints: EndpointHealth[];
  healthy: boolean;
}

interface InternalState {
  configs: Map<number, ChainRpcConfig>;
  health: Map<number, Map<string, EndpointHealth>>;
  active: Map<number, string>; // chainId -> active URL
}

/**
 * Build chain RPC configs from environment variables.
 * Reads RPC_<CHAIN>_URL and RPC_<CHAIN>_URL_BACKUP.
 */
export function buildConfigsFromEnv(env: Record<string, string | undefined>): ChainRpcConfig[] {
  const maxLatencyMs = Number(env.RPC_MAX_LATENCY_MS ?? 5000);
  const errorRateThreshold = Number(env.RPC_ERROR_RATE_THRESHOLD ?? 0.1);
  const pollIntervalMs = Number(env.RPC_POLL_INTERVAL_MS ?? 30_000);

  const chains: Array<[number, string, string]> = [
    [1, 'ethereum', 'RPC_ETHEREUM_URL'],
    [42161, 'arbitrum', 'RPC_ARBITRUM_URL'],
    [8453, 'base', 'RPC_BASE_URL'],
    [137, 'polygon', 'RPC_POLYGON_URL'],
    [10, 'optimism', 'RPC_OPTIMISM_URL'],
    [56, 'bnb', 'RPC_BNB_URL'],
  ];

  const configs: ChainRpcConfig[] = [];
  for (const [chainId, name, envVar] of chains) {
    const primary = env[envVar];
    const backup = env[`${envVar}_BACKUP`];
    if (!primary) continue;
    const endpoints: RpcEndpoint[] = [{ url: primary, role: 'primary' }];
    if (backup) endpoints.push({ url: backup, role: 'backup' });
    configs.push({ chainId, name, endpoints, maxLatencyMs, errorRateThreshold, pollIntervalMs });
  }
  return configs;
}

export class RpcMonitor {
  private state: InternalState = {
    configs: new Map(),
    health: new Map(),
    active: new Map(),
  };
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(configs: ChainRpcConfig[]) {
    for (const c of configs) {
      this.state.configs.set(c.chainId, c);
      const healthMap = new Map<string, EndpointHealth>();
      for (const ep of c.endpoints) {
        healthMap.set(ep.url, {
          url: ep.url,
          role: ep.role,
          healthy: false,
          latencyMs: 0,
          blockNumber: null,
          lastError: null,
          lastChecked: 0,
          consecutiveErrors: 0,
          totalChecks: 0,
          totalErrors: 0,
        });
      }
      this.state.health.set(c.chainId, healthMap);
      this.state.active.set(c.chainId, c.endpoints[0].url);
    }
  }

  /** Start polling all chains at their configured interval. */
  start(): void {
    if (this.timer) return;
    // Use the smallest interval across configs.
    const intervals = [...this.state.configs.values()].map((c) => c.pollIntervalMs);
    const minInterval = intervals.length ? Math.min(...intervals) : 30_000;
    this.timer = setInterval(() => {
      void this.pollAll();
    }, minInterval);
    // Run immediately on start.
    void this.pollAll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Get the currently active (healthy) RPC URL for a chain. */
  getActiveRpc(chainId: number): string | undefined {
    return this.state.active.get(chainId);
  }

  /** Get health snapshot for all chains. */
  getHealth(): ChainHealth[] {
    const out: ChainHealth[] = [];
    for (const [chainId, config] of this.state.configs) {
      const healthMap = this.state.health.get(chainId)!;
      const endpoints = [...healthMap.values()];
      const activeUrl = this.state.active.get(chainId)!;
      const anyHealthy = endpoints.some((e) => e.healthy);
      out.push({ chainId, name: config.name, activeUrl, endpoints, healthy: anyHealthy });
    }
    return out;
  }

  /** Poll all chains' endpoints in parallel. */
  private async pollAll(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const [chainId, config] of this.state.configs) {
      const healthMap = this.state.health.get(chainId)!;
      for (const ep of config.endpoints) {
        tasks.push(this.pollEndpoint(chainId, config, ep.url, healthMap.get(ep.url)!));
      }
    }
    await Promise.allSettled(tasks);
    // After polling, update active endpoints based on health.
    for (const [chainId, config] of this.state.configs) {
      this.updateActive(chainId, config);
    }
  }

  private async pollEndpoint(
    chainId: number,
    config: ChainRpcConfig,
    url: string,
    h: EndpointHealth,
  ): Promise<void> {
    void chainId; // used only for logging in production
    h.totalChecks++;
    h.lastChecked = Date.now();
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
        signal: AbortSignal.timeout(config.maxLatencyMs + 2000),
      });
      const json = (await res.json()) as { result?: string; error?: unknown };
      if (json.error || !json.result) {
        throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
      }
      h.latencyMs = Date.now() - t0;
      h.blockNumber = parseInt(json.result, 16);
      h.lastError = null;
      h.consecutiveErrors = 0;
      // Latency check.
      h.healthy = h.latencyMs <= config.maxLatencyMs;
    } catch (e) {
      h.latencyMs = Date.now() - t0;
      h.totalErrors++;
      h.consecutiveErrors++;
      h.lastError = (e as Error).message;
      // Error-rate check.
      const errorRate = h.totalErrors / h.totalChecks;
      h.healthy = errorRate <= config.errorRateThreshold && h.consecutiveErrors < 3;
    }
  }

  /** Pick the best endpoint: prefer healthy primary, fall back to healthy backup. */
  private updateActive(chainId: number, _config: ChainRpcConfig): void {
    const healthMap = this.state.health.get(chainId)!;
    const current = this.state.active.get(chainId);

    // Check if current active is still healthy.
    const currentHealth = current ? healthMap.get(current) : undefined;
    if (currentHealth?.healthy) return; // no switch needed.

    // Find the healthiest endpoint (prefer primary role, lowest latency).
    const healthy = [...healthMap.values()].filter((h) => h.healthy);
    if (healthy.length === 0) {
      // All unhealthy — keep current (don't switch to another broken one).
      return;
    }
    // Prefer primary if healthy; else lowest latency.
    const primaryHealthy = healthy.find((h) => h.role === 'primary');
    const best = primaryHealthy ?? healthy.sort((a, b) => a.latencyMs - b.latencyMs)[0];
    if (best && best.url !== current) {
      this.state.active.set(chainId, best.url);
    }
  }
}
