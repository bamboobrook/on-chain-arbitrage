-- Runs once on first Postgres container init.
-- Enable TimescaleDB extension for hypertables (share-price, pnl, metrics time-series).
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid()
