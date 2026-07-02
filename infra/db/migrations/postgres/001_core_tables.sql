-- 001_core_tables.sql
-- Core business tables (design §12).

-- Reference: chains we operate on.
CREATE TABLE IF NOT EXISTS chains (
    chain_id     INT PRIMARY KEY,
    name         TEXT NOT NULL,
    short_name   TEXT NOT NULL,           -- 'base', 'arbitrum'
    rpc_env_var  TEXT NOT NULL,           -- env var name holding the RPC url
    currency     TEXT NOT NULL DEFAULT 'ETH',
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reference: vault assets per chain.
CREATE TABLE IF NOT EXISTS assets (
    chain_id     INT NOT NULL REFERENCES chains(chain_id),
    address      BYTEA NOT NULL,          -- 20 bytes
    symbol       TEXT NOT NULL,
    decimals     INT NOT NULL,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, address)
);

-- DEX / pool metadata (whitelist).
CREATE TABLE IF NOT EXISTS pools (
    chain_id     INT NOT NULL REFERENCES chains(chain_id),
    address      BYTEA NOT NULL,
    dex          TEXT NOT NULL,           -- 'uniswap-v2','uniswap-v3','curve','balancer','aerodrome'
    pool_type    TEXT NOT NULL,           -- 'v2','v3','stable','weighted'
    token0       BYTEA NOT NULL,
    token1       BYTEA NOT NULL,
    fee_bps      NUMERIC(8,4) NOT NULL DEFAULT 0,
    extra        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- tick spacing, weights, etc.
    is_blacklisted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, address)
);
CREATE INDEX IF NOT EXISTS idx_pools_tokens ON pools(chain_id, token0, token1);

CREATE TABLE IF NOT EXISTS strategies (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    version      TEXT NOT NULL,
    model_type   TEXT NOT NULL,           -- 'atomic-amm','mev-backrun','peg-lst',...
    risk_class   TEXT NOT NULL CHECK (risk_class IN ('low','medium','high','experimental')),
    status       TEXT NOT NULL DEFAULT 'active',  -- active|paused|retired
    config       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vaults (
    id           TEXT PRIMARY KEY,
    chain_id     INT NOT NULL REFERENCES chains(chain_id),
    address      BYTEA,
    asset_address BYTEA NOT NULL,
    strategy_id  TEXT REFERENCES strategies(id),
    status       TEXT NOT NULL DEFAULT 'active',  -- active|paused|withdrawal-only
    tvl          NUMERIC NOT NULL DEFAULT 0,
    share_price  NUMERIC NOT NULL DEFAULT 1,
    config       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vaults_chain ON vaults(chain_id);
CREATE INDEX IF NOT EXISTS idx_vaults_strategy ON vaults(strategy_id);

CREATE TABLE IF NOT EXISTS backtest_runs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id  TEXT NOT NULL REFERENCES strategies(id),
    status       TEXT NOT NULL DEFAULT 'queued',  -- queued|running|done|failed
    chain_id     INT NOT NULL,
    asset        BYTEA NOT NULL,
    start_block  BIGINT NOT NULL,
    end_block    BIGINT NOT NULL,
    capital      NUMERIC NOT NULL,
    cost_model   JSONB NOT NULL DEFAULT '{}'::jsonb,
    params       JSONB NOT NULL DEFAULT '{}'::jsonb,
    metrics      JSONB,
    artifact_uri TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_backtests_strategy ON backtest_runs(strategy_id, created_at DESC);

CREATE TABLE IF NOT EXISTS opportunities (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id  TEXT NOT NULL REFERENCES strategies(id),
    chain_id     INT NOT NULL,
    block_number BIGINT NOT NULL,
    asset        BYTEA NOT NULL,
    gross_profit NUMERIC NOT NULL,
    gas_cost     NUMERIC NOT NULL DEFAULT 0,
    bribe_cost   NUMERIC NOT NULL DEFAULT 0,
    net_profit   NUMERIC NOT NULL,
    confidence   NUMERIC NOT NULL,
    route        JSONB NOT NULL,
    status       TEXT NOT NULL DEFAULT 'discovered', -- discovered|simulated|executed|expired|rejected
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opp_chain_block ON opportunities(chain_id, block_number DESC);
CREATE INDEX IF NOT EXISTS idx_opp_strategy ON opportunities(strategy_id, created_at DESC);

CREATE TABLE IF NOT EXISTS executions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id UUID REFERENCES opportunities(id),
    vault_id     TEXT REFERENCES vaults(id),
    chain_id     INT NOT NULL,
    tx_hash      BYTEA,
    status       TEXT NOT NULL DEFAULT 'pending',  -- pending|submitted|confirmed|failed|expired
    gross_profit NUMERIC NOT NULL DEFAULT 0,
    gas_cost     NUMERIC NOT NULL DEFAULT 0,
    bribe_cost   NUMERIC NOT NULL DEFAULT 0,
    net_profit   NUMERIC NOT NULL DEFAULT 0,
    simulation_uri TEXT,
    block_number BIGINT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_exec_chain_block ON executions(chain_id, block_number DESC);
CREATE INDEX IF NOT EXISTS idx_exec_vault ON executions(vault_id, created_at DESC);

CREATE TABLE IF NOT EXISTS risk_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    severity     TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
    scope        TEXT NOT NULL,           -- 'strategy','vault','pool','token','system'
    scope_id     TEXT,
    message      TEXT NOT NULL,
    data         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_risk_created ON risk_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_scope ON risk_events(scope, scope_id);
