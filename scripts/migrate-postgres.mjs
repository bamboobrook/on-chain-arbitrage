#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const migrationDir = resolve(root, 'infra/db/migrations/postgres');

async function main() {
  const { default: pg } = await import('../apps/api/node_modules/pg/lib/index.js');
  const pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://oal:oal_dev_password@127.0.0.1:5432/oal',
  });

  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT now()
      )`,
    );

    const files = (await readdir(migrationDir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const name = basename(file);
      const applied = await pool.query('SELECT 1 FROM _migrations WHERE name=$1', [name]);
      if (applied.rowCount) {
        console.log(`skip ${name}`);
        continue;
      }
      const sql = await readFile(resolve(migrationDir, file), 'utf8');
      console.log(`apply ${name}`);
      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query('INSERT INTO _migrations(name) VALUES ($1) ON CONFLICT DO NOTHING', [
          name,
        ]);
        await pool.query('COMMIT');
      } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
