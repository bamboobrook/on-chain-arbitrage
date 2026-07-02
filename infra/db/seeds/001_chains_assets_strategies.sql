-- 001_chains_assets_strategies.sql  (Postgres seed)
-- Reference data for the MVP: Base + Arbitrum, USDC/WETH, and strategy registry.

INSERT INTO chains (chain_id, name, short_name, rpc_env_var, currency) VALUES
    (8453,  'Base',      'base',      'RPC_BASE_URL',      'ETH'),
    (42161, 'Arbitrum',  'arbitrum',  'RPC_ARBITRUM_URL',  'ETH'),
    (31337, 'Anvil Local','anvil',    'RPC_LOCAL_URL',     'ETH')
ON CONFLICT (chain_id) DO NOTHING;

-- USDC and WETH on Base (checksummed lowercase for uniformity).
INSERT INTO assets (chain_id, address, symbol, decimals) VALUES
    (8453,  decode('833589fcd6edb6e08f4c7c32d4f71b54bda02913','hex'), 'USDC', 6),
    (8453,  decode('4200000000000000000000000000000000000006','hex'), 'WETH', 18),
    (42161, decode('af88d065e77c8cc2239327c5edb3a432268e5831','hex'), 'USDC', 6),
    (42161, decode('82af49447d8a07e3bd95bd0d56f35241523fbab1','hex'), 'WETH', 18),
    (31337, decode('0000000000000000000000000000000000000001','hex'), 'USDC', 6),
    (31337, decode('0000000000000000000000000000000000000002','hex'), 'WETH', 18)
ON CONFLICT DO NOTHING;

-- Strategy registry (MVP models active; phase-2 models registered but experimental).
INSERT INTO strategies (id, name, version, model_type, risk_class, status, config) VALUES
    ('atomic-amm',      'Atomic AMM Arbitrage',  '1.0.0', 'atomic-amm',      'medium',       'active',       '{"minNetProfitBps":5,"maxGasCostUsd":5}'::jsonb),
    ('mev-backrun',     'MEV-Share Backrun',     '1.0.0', 'mev-backrun',     'medium',       'active',       '{"bribePctOfGross":30}'::jsonb),
    ('peg-lst',         'Peg / LST / Stable',    '1.0.0', 'peg-lst',         'medium',       'active',       '{"maxPositionPct":10}'::jsonb),
    ('yield-rotator',   'Yield Rotator (cash mgmt, NOT arbitrage)', '1.0.0', 'yield-rotator', 'low', 'active',  '{"label":"not-arbitrage"}'::jsonb),
    ('solver-spread',   'Solver Spread Capture', '0.0.0', 'solver-spread',   'experimental', 'paused',       '{"phase":2}'::jsonb),
    ('liquidation',     'Liquidation Arbitrage', '0.0.0', 'liquidation',     'high',         'paused',       '{"phase":2}'::jsonb),
    ('crosschain-inventory','Cross-chain Inventory','0.0.0','crosschain-inventory','high',   'paused',       '{"phase":3}'::jsonb)
ON CONFLICT (id) DO NOTHING;
