/**
 * Backtest V2 data layer — the credible replay system.
 *
 * This module replaces V1's "historical events + current price" approach
 * with event-block-truthful replay: oracle-at-block prices, fork-quoted exit
 * routes, full cost model, competition modeling, walk-forward, daily NAV,
 * capacity curves, and schemaVersion=2 provenance on every artifact.
 *
 * Per full-audit plan §2 (Phase 1).
 */

export * from './types.js';
export * from './provenance.js';
export * from './historicalPrice.js';
export * from './exitRoute.js';
export * from './costModel.js';
export * from './competition.js';
export * from './walkForward.js';
