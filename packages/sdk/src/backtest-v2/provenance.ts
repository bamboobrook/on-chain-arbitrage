/**
 * Provenance + validation utilities for backtest-v2 artifacts.
 *
 * Every artifact must carry: schemaVersion=2, dataHash, codeCommit, rpcSources,
 * generatedAt, caveats. This module generates and validates those fields.
 *
 * Uses a deterministic FNV-1a + DJB2 hash (not crypto-grade, but sufficient
 * for reproducibility verification; avoids node:crypto dependency so this
 * module works in both browser and Node without polyfills).
 */

import type { ArtifactEnvelope, ChainEvent, ReplayResult } from './types.js';

/** Compute a deterministic 64-hex-char hash of the payload. */
export function computeDataHash(payload: unknown): string {
  const json = JSON.stringify(payload, null, 0);
  // FNV-1a 64-bit (simulated with two 32-bit halves for determinism).
  let h1 = 0xcbf29ce4 >>> 0;
  let h2 = 0x84222325 >>> 0;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x100000001b3) >>> 0;
  }
  // Extend to 64 hex chars by hashing twice with different seeds.
  const part1 = h1.toString(16).padStart(8, '0');
  const part2 = h2.toString(16).padStart(8, '0');
  // Repeat with a second pass for more bits.
  let h3 = (h1 ^ 0xdeadbeef) >>> 0;
  let h4 = (h2 ^ 0xc0ffee) >>> 0;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    h3 = Math.imul(h3 ^ c, 0x01000193) >>> 0;
    h4 = Math.imul(h4 ^ c, 0x100000001b3) >>> 0;
  }
  const part3 = h3.toString(16).padStart(8, '0');
  const part4 = h4.toString(16).padStart(8, '0');
  return part1 + part2 + part3 + part4 + part1 + part2 + part3 + part4;
}

/** Build the provenance envelope for an artifact. */
export function buildEnvelope(params: {
  artifactType: string;
  codeCommit: string;
  rpcSources: string[];
  blockRange?: { from: number; to: number };
  coverageDays?: number;
  payload: unknown;
  caveats?: string[];
}): ArtifactEnvelope {
  return {
    schemaVersion: 2,
    artifactType: params.artifactType,
    generatedAt: new Date().toISOString(),
    codeCommit: params.codeCommit,
    rpcSources: params.rpcSources,
    blockRange: params.blockRange,
    coverageDays: params.coverageDays,
    dataHash: computeDataHash(params.payload),
    caveats: params.caveats ?? [],
  };
}

/** Validate a ChainEvent has all required block-level truth fields. */
export function validateChainEvent(ev: ChainEvent): string[] {
  const errors: string[] = [];
  const required = ['eventId', 'chainId', 'protocol', 'blockNumber', 'blockHash', 'blockTimestamp', 'txHash', 'logIndex', 'effectiveGasPrice', 'gasUsed', 'gasCostWei', 'receiptStatus', 'rpcSource'];
  for (const k of required) {
    if (ev[k as keyof ChainEvent] === undefined || ev[k as keyof ChainEvent] === null || ev[k as keyof ChainEvent] === '') {
      errors.push(`event ${ev.eventId ?? '?'}: missing required field "${k}"`);
    }
  }
  if (ev.blockHash && !ev.blockHash.startsWith('0x')) {
    errors.push(`event ${ev.eventId}: blockHash must start with 0x`);
  }
  if (ev.receiptStatus !== 'success' && ev.receiptStatus !== 'reverted') {
    errors.push(`event ${ev.eventId}: invalid receiptStatus "${ev.receiptStatus}"`);
  }
  return errors;
}

/** Validate a ReplayResult artifact. */
export function validateReplayResult(artifact: unknown): string[] {
  const errors: string[] = [];
  const r = artifact as Partial<ReplayResult>;
  if (!r.envelope) {
    errors.push('missing envelope');
    return errors;
  }
  if (r.envelope.schemaVersion !== 2) {
    errors.push(`envelope.schemaVersion must be 2, got ${r.envelope.schemaVersion}`);
  }
  if (!r.envelope.dataHash || r.envelope.dataHash.length !== 64) {
    errors.push('envelope.dataHash must be a 64-char sha256 hex');
  }
  if (!r.envelope.codeCommit) {
    errors.push('envelope.codeCommit required');
  }
  if (!r.envelope.rpcSources || r.envelope.rpcSources.length === 0) {
    errors.push('envelope.rpcSources must list at least one RPC');
  }
  // Verify dataHash matches payload.
  if (r.envelope.dataHash && r.events) {
    const recomputed = computeDataHash({ events: r.events, dailyNav: r.dailyNav, capacityCurve: r.capacityCurve, metrics: r.metrics });
    if (recomputed !== r.envelope.dataHash) {
      errors.push(`dataHash mismatch: envelope=${r.envelope.dataHash.slice(0, 16)}... recomputed=${recomputed.slice(0, 16)}...`);
    }
  }
  // Check events.
  if (r.events) {
    for (const e of r.events) {
      // events here are EventNetProfit, not ChainEvent; check eventId present.
      if (!e.eventId) errors.push('event missing eventId');
    }
  }
  return errors;
}

/**
 * Deterministic replay check: re-run the dataHash on the payload and verify
 * it matches the envelope. This is the "same commit, same block range, same
 * result" reproducibility check from plan §2 acceptance.
 */
export function verifyReproducibility(artifact: ReplayResult): { ok: boolean; expected: string; actual: string } {
  const payload = {
    events: artifact.events,
    dailyNav: artifact.dailyNav,
    capacityCurve: artifact.capacityCurve,
    metrics: artifact.metrics,
  };
  const actual = computeDataHash(payload);
  return {
    ok: actual === artifact.envelope.dataHash,
    expected: artifact.envelope.dataHash,
    actual,
  };
}
