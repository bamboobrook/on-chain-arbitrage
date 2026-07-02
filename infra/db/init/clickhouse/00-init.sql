-- Runs once on first ClickHouse container init.
-- Creates the database + user. Tables are created by the migration runner
-- (infra/scripts/migrate.sh) so schema stays versioned alongside Postgres.

CREATE DATABASE IF NOT EXISTS oal;

-- The official clickhouse-server image already creates CLICKHOUSE_USER; make
-- sure it can access the oal database.
GRANT ALL PRIVILEGES ON oal.* TO oal;
