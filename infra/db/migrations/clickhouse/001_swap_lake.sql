-- 001_swap_lake.sql  (ClickHouse)
-- The swap/pool-event lake used by indexer + opportunity workers + backtest engine.

CREATE TABLE IF NOT EXISTS oal.swaps (
    chain_id      UInt32,
    block_number  UInt64,
    log_index     UInt32,
    tx_hash       String,
    pool_address  String,
    sender        String,
    token_in      String,
    token_out     String,
    amount_in     String,   -- decimal string, preserves precision
    amount_out    String,
    ts            DateTime,
    dex           LowCardinality(String)
) ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (chain_id, pool_address, block_number, log_index)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS oal.pool_states (
    chain_id      UInt32,
    pool_address  String,
    block_number  UInt64,
    ts            DateTime,
    dex           LowCardinality(String),
    reserves_json String,    -- {token0,token1,reserve0,reserve1,...} or tick liquidity summary
    extra         String
) ENGINE = ReplacingMergeTree(block_number)
PARTITION BY toYYYYMM(ts)
ORDER BY (chain_id, pool_address, block_number);

CREATE TABLE IF NOT EXISTS oal.pool_events (
    chain_id      UInt32,
    block_number  UInt64,
    log_index     UInt32,
    pool_address  String,
    event_type    LowCardinality(String),  -- mint|burn|swap|sync
    args_json     String,
    ts            DateTime
) ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (chain_id, pool_address, block_number, log_index);

-- Simulation traces (one row per simulation; full trace referenced by uri).
CREATE TABLE IF NOT EXISTS oal.simulation_traces (
    id            String,
    chain_id      UInt32,
    block_number  UInt64,
    strategy_id   String,
    opportunity_id String,
    success       UInt8,
    gas_used      UInt64,
    net_profit    String,
    failure_reason String,
    trace_uri     String,
    ts            DateTime
) ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (chain_id, block_number);
