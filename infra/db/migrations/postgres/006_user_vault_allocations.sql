-- 006_user_vault-allocations.sql
-- Per Phase 5: user vault allocation + strategy run tracking.
-- Users deposit to Vault, then allocate capital to a strategy, then start/stop.

CREATE TABLE IF NOT EXISTS user_vault_allocations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_address    BYTEA NOT NULL,           -- user's wallet
    vault_id        TEXT NOT NULL REFERENCES vaults(id),
    strategy_id     TEXT NOT NULL REFERENCES strategies(id),
    chain_id        INT NOT NULL,
    allocated_usd   NUMERIC NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'pending', -- pending|active|stopped|withdrawn
    tx_hash         BYTEA,                    -- the on-chain allocation tx
    started_at      TIMESTAMPTZ,
    stopped_at      TIMESTAMPTZ,
    realized_pnl    NUMERIC NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uva_user ON user_vault_allocations(user_address);
CREATE INDEX IF NOT EXISTS idx_uva_vault_strategy ON user_vault_allocations(vault_id, strategy_id, status);

-- Strategy run log: tracks each active run's lifecycle.
CREATE TABLE IF NOT EXISTS live_strategy_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    allocation_id   UUID REFERENCES user_vault_allocations(id),
    user_address    BYTEA NOT NULL,
    strategy_id     TEXT NOT NULL,
    vault_id        TEXT NOT NULL,
    chain_id        INT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'starting', -- starting|active|paused|stopped|failed
    capital_usd     NUMERIC NOT NULL DEFAULT 0,
    realized_pnl    NUMERIC NOT NULL DEFAULT 0,
    execution_count INT NOT NULL DEFAULT 0,
    last_block      BIGINT,
    kill_switch     BOOLEAN NOT NULL DEFAULT false,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    stopped_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lsr_user ON live_strategy_runs(user_address, status);
CREATE INDEX IF NOT EXISTS idx_lsr_strategy ON live_strategy_runs(strategy_id, status);
