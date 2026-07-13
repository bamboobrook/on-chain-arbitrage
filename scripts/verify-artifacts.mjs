#!/usr/bin/env node
/**
 * verify-artifacts.mjs — validate JSON research artifacts have required fields.
 *
 * Phase 0 §3 of the audit plan requires JSON schema checks as part of `make verify`.
 * This script validates that key artifact files (if present) are well-formed JSON
 * and contain the minimum required top-level keys.
 *
 * Runs in Node without external deps (uses fs only). Exits non-zero on violation.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = 'data';
const EVIDENCE_DIR = 'docs/evidence';

let failures = 0;
let checked = 0;

/** Required keys per artifact filename pattern. */
const SCHEMAS = [
  {
    pattern: /pure-arbitrage-search-overview/,
    requiredKeys: [],
    optionalNote: 'overview artifact; structure may vary across versions',
  },
  {
    pattern: /candidates|replay|watchlist|feed|atlas|ranked/,
    requiredKeys: [],
    optionalNote: 'research artifact; no strict schema yet (Phase 1 will add schemaVersion=2)',
  },
];

function checkFile(path) {
  if (!existsSync(path)) return;
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    console.error(`  FAIL: cannot read ${path}: ${e.message}`);
    failures++;
    return;
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    console.error(`  FAIL: invalid JSON in ${path}: ${e.message}`);
    failures++;
    return;
  }
  checked++;
  const schema = SCHEMAS.find((s) => s.pattern.test(path));
  if (schema && schema.requiredKeys.length) {
    for (const key of schema.requiredKeys) {
      if (!(key in json)) {
        console.error(`  FAIL: ${path} missing required key "${key}"`);
        failures++;
      }
    }
  }
}

console.log('JSON artifact validation:');
if (existsSync(DATA_DIR)) {
  for (const f of readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'))) {
    checkFile(join(DATA_DIR, f));
  }
}
if (existsSync(EVIDENCE_DIR)) {
  for (const f of readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith('.json'))) {
    checkFile(join(EVIDENCE_DIR, f));
  }
}

console.log(`  checked ${checked} JSON files, ${failures} failure(s)`);
if (failures > 0) {
  console.error('JSON validation FAILED');
  process.exit(1);
}
console.log('JSON validation: OK');
