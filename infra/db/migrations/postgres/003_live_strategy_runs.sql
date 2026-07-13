-- 003_live_strategy_runs.sql
-- Persist user-created live strategy run requests and their execution-plan snapshots.

CREATE TABLE IF NOT EXISTS live_strategy_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id    TEXT NOT NULL,
    strategy_id     TEXT NOT NULL REFERENCES strategies(id),
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','preflight','blocked','ready','running','paused','stopped','failed')),
    chain_id        INT,
    wallet_address  BYTEA,
    capital         NUMERIC NOT NULL,
    plan            JSONB NOT NULL,
    risk_limits     JSONB NOT NULL DEFAULT '{}'::jsonb,
    blocked_by      JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    stopped_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_live_runs_candidate ON live_strategy_runs(candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_runs_strategy ON live_strategy_runs(strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_runs_status ON live_strategy_runs(status, created_at);
