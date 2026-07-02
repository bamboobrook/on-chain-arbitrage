-- 002_timeseries.sql
-- TimescaleDB hypertables for time-series metrics.

CREATE TABLE IF NOT EXISTS share_price_ts (
    vault_id     TEXT NOT NULL REFERENCES vaults(id),
    ts           TIMESTAMPTZ NOT NULL,
    share_price  NUMERIC NOT NULL,
    tvl          NUMERIC NOT NULL,
    block_number BIGINT NOT NULL,
    PRIMARY KEY (vault_id, ts)
);
SELECT create_hypertable('share_price_ts', 'ts', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS pnl_ts (
    vault_id     TEXT NOT NULL REFERENCES vaults(id),
    ts           TIMESTAMPTZ NOT NULL,
    realized_pnl NUMERIC NOT NULL DEFAULT 0,
    unrealized_pnl NUMERIC NOT NULL DEFAULT 0,
    fees         NUMERIC NOT NULL DEFAULT 0,
    block_number BIGINT NOT NULL,
    PRIMARY KEY (vault_id, ts)
);
SELECT create_hypertable('pnl_ts', 'ts', if_not_exists => TRUE);

-- Generic rolling metrics for dashboards.
CREATE TABLE IF NOT EXISTS metrics_ts (
    scope        TEXT NOT NULL,           -- 'vault'|'strategy'|'system'
    scope_id     TEXT NOT NULL,
    ts           TIMESTAMPTZ NOT NULL,
    metric       TEXT NOT NULL,
    value        NUMERIC NOT NULL,
    PRIMARY KEY (scope, scope_id, ts, metric)
);
SELECT create_hypertable('metrics_ts', 'ts', if_not_exists => TRUE);

-- Retention policy: keep raw metrics 90 days, aggregate beyond.
SELECT add_retention_policy('share_price_ts', INTERVAL '365 days', if_not_exists => TRUE);
SELECT add_retention_policy('pnl_ts', INTERVAL '365 days', if_not_exists => TRUE);
SELECT add_retention_policy('metrics_ts', INTERVAL '90 days', if_not_exists => TRUE);
