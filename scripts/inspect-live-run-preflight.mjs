#!/usr/bin/env node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const runId = process.argv[2];
if (!runId) {
  console.error('usage: node scripts/inspect-live-run-preflight.mjs <live-run-id>');
  process.exit(2);
}

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = apiRequire('pg');

function loadDotenv() {
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 1) continue;
      out[trimmed.slice(0, idx).trim()] = trimmed
        .slice(idx + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

const env = { ...process.env, ...loadDotenv() };
const pool = new Pool({
  connectionString: env.DATABASE_URL ?? 'postgres://oal:oal_dev_password@127.0.0.1:5432/oal',
});

try {
  const { rows } = await pool.query(
    `SELECT report
     FROM live_run_preflights
     WHERE run_id=$1
     ORDER BY created_at DESC
     LIMIT 1`,
    [runId],
  );
  const report = rows[0]?.report;
  if (!report) throw new Error(`preflight not found for ${runId}`);
  const mintCall = report.transactionPreview?.calls?.find((call) => call.kind === 'position-mint');
  console.log(
    JSON.stringify(
      {
        quote: report.quote,
        poolState: report.poolState,
        mintPreview: report.mintPreview,
        mintCallParams: mintCall?.params,
        gasPreflight: report.gasPreflight,
        callSimulation: report.callSimulation,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
