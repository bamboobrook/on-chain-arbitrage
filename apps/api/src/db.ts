/**
 * Postgres client pool for the API gateway. Reads DATABASE_URL from env.
 */

import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://oal:oal_dev_password@127.0.0.1:5432/oal',
  max: 10,
  idleTimeoutMillis: 30_000,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await pool.query<T>(text, params as never);
  return res.rows;
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

/** Format a bytea address column (Postgres returns hex string with \x prefix). */
export function formatAddress(row: unknown, key: string): string {
  const v = (row as Record<string, unknown>)[key];
  if (typeof v === 'string') return v.startsWith('\\x') ? '0x' + v.slice(2) : v;
  return '0x' + Buffer.from(v as string).toString('hex');
}
