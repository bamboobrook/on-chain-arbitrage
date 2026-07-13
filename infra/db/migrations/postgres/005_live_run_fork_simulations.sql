-- 005_live_run_fork_simulations.sql
-- Ordered Anvil fork simulation reports for live strategy run requests.

CREATE TABLE IF NOT EXISTS live_run_fork_simulations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      UUID NOT NULL REFERENCES live_strategy_runs(id) ON DELETE CASCADE,
    status      TEXT NOT NULL CHECK (status IN ('passed','failed')),
    exit_code   INT,
    summary     TEXT,
    result      JSONB NOT NULL,
    stdout      TEXT NOT NULL DEFAULT '',
    stderr      TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_run_fork_simulations_run
    ON live_run_fork_simulations(run_id, created_at DESC);
