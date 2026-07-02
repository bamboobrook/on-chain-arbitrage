# Infra

Local-development infrastructure for On-Chain Arbitrage Lab.

## Services

| Service | Image | Port(s) |
|---|---|---|
| Postgres + TimescaleDB | `timescale/timescaledb:2.17.2-pg16` | 5432 |
| Redis | `redis:7.4-alpine` | 6379 |
| ClickHouse | `clickhouse/clickhouse-server:24.8-alpine` | 8123 (HTTP), 9000 (native) |
| Prometheus | `prom/prometheus:v3.0.1` | 9090 (profile: `monitoring`) |
| Grafana | `grafana/grafana:11.4.0` | 3001 (profile: `monitoring`) |

## Usage

```bash
make db-up          # start databases (compose auto-loads .env)
make db-migrate     # apply postgres + clickhouse migrations
make db-seed        # seed chains/assets/pools/strategies
make db-status      # show applied migrations

# optional dashboards
docker compose -f infra/docker-compose.yml --profile monitoring up -d prometheus grafana
```

First-time container init also runs `db/init/{postgres,clickhouse}/*.sql` (Timescale extension, ClickHouse db/user).

## Layout

```
infra/
  docker-compose.yml
  prometheus/prometheus.yml
  db/
    init/postgres/00-init.sql      # Timescale + pgcrypto extensions
    init/clickhouse/00-init.sql    # oal database + user
    migrations/postgres/           # 001 core tables, 002 timeseries hypertables
    migrations/clickhouse/         # 001 swap/pool lake
    seeds/                         # chains, assets, strategies, pools
  scripts/
    setup-toolchain.sh             # Node + pnpm + Rust + Foundry installer
    migrate.sh                     # up / seed / status
```

## Notes

- Data is persisted under `infra/data/` (gitignored). `make db-reset` wipes volumes and re-applies migrations + seeds.
- ClickHouse credentials and the Postgres password default to dev values — override via `.env` for anything beyond local dev.
- The migration runner is intentionally dependency-free (psql + curl). For a team, swap in `sqlx migrate` / `node-pg-migrate` later without changing the SQL files.
