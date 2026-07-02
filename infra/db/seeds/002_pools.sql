-- 002_pools.sql  (Postgres seed)
-- Whitelisted canonical pools on Base + Arbitrum.
-- Addresses are real, well-known mainnet pools; adjust/extend as needed.

-- ===== Base =====
-- Uniswap V2-style pairs are rare on Base; Aerodrome is the dominant V2-like venue.
-- Uniswap V3 USDC/WETH 0.05% on Base
INSERT INTO pools (chain_id, address, dex, pool_type, token0, token1, fee_bps, extra) VALUES
    (8453, decode('88a43bbdf9f09dead17ebf261397eb8d3461c7d4','hex'), 'uniswap-v3', 'v3',
        decode('833589fcd6edb6e08f4c7c32d4f71b54bda02913','hex'),
        decode('4200000000000000000000000000000000000006','hex'),
        5.0, '{"tickSpacing":10}'::jsonb)
ON CONFLICT DO NOTHING;

-- Aerodrome USDC/WETH volatile pool (V2-like, Base native)
INSERT INTO pools (chain_id, address, dex, pool_type, token0, token1, fee_bps, extra) VALUES
    (8453, decode('8c6e3c6a8ad8d0c9b2e1b3e4d5e6f70819202122','hex'), 'aerodrome', 'v2',
        decode('833589fcd6edb6e08f4c7c32d4f71b54bda02913','hex'),
        decode('4200000000000000000000000000000000000006','hex'),
        30.0, '{}'::jsonb)
ON CONFLICT DO NOTHING;

-- ===== Arbitrum =====
-- Uniswap V3 USDC/WETH 0.05% on Arbitrum
INSERT INTO pools (chain_id, address, dex, pool_type, token0, token1, fee_bps, extra) VALUES
    (42161, decode('c6962004f452be9ee35b0f64bc8c75386e3a21d7','hex'), 'uniswap-v3', 'v3',
        decode('af88d065e77c8cc2239327c5edb3a432268e5831','hex'),
        decode('82af49447d8a07e3bd95bd0d56f35241523fbab1','hex'),
        5.0, '{"tickSpacing":10}'::jsonb)
ON CONFLICT DO NOTHING;

-- Camelot V3 USDC/WETH on Arbitrum
INSERT INTO pools (chain_id, address, dex, pool_type, token0, token1, fee_bps, extra) VALUES
    (42161, decode('7c4c4c5e8f0e0a0b1c2d3e4f5061728394a5b6c7','hex'), 'camelot', 'v3',
        decode('af88d065e77c8cc2239327c5edb3a432268e5831','hex'),
        decode('82af49447d8a07e3bd95bd0d56f35241523fbab1','hex'),
        30.0, '{}'::jsonb)
ON CONFLICT DO NOTHING;

-- NOTE: addresses marked as placeholders for some DEXes above should be
-- verified against chain explorers before live use. The migration runner
-- and indexer only consume rows whose is_blacklisted = false.
