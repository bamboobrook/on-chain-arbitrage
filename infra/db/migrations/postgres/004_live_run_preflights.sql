-- 004_live_run_preflights.sql
-- Structured preflight reports for live strategy run requests.

CREATE TABLE IF NOT EXISTS live_run_preflights (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      UUID NOT NULL REFERENCES live_strategy_runs(id) ON DELETE CASCADE,
    status      TEXT NOT NULL CHECK (status IN ('passed','blocked','failed')),
    report      JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_run_preflights_run ON live_run_preflights(run_id, created_at DESC);
