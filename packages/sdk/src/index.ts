/**
 * @oal/sdk — shared types, API client and contract bindings.
 *
 * This package is the single source of truth for the TS side:
 * - types.ts: canonical types mirroring the Rust cores
 * - api.ts: typed REST/SSE client for the Fastify gateway
 * - contracts.ts: hand-curated ABIs + deployed addresses
 *
 * The Rust cores are bridged via napi in a future iteration; for the MVP the
 * worker runs the heavy lifting via the API gateway which calls into Rust
 * sidecars / the backtest-engine binary.
 */

export * from './types.js';
export * from './api.js';
export * from './contracts.js';
export * from './rpcMonitor.js';
export * from './backtest-v2/index.js';
