#!/usr/bin/env bash
# Lightweight migration runner for Postgres + ClickHouse.
# Usage:
#   migrate.sh up       apply all postgres + clickhouse migrations
#   migrate.sh down     (best-effort) note: no down migrations shipped
#   migrate.sh seed     apply seed data
#   migrate.sh status   list applied migrations (postgres only)
#
# Uses psql / curl(ClickHouse HTTP). No external migration framework needed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT}/.env" 2>/dev/null || true

: "${POSTGRES_HOST:=127.0.0.1}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_DB:=oal}"
: "${POSTGRES_USER:=oal}"
: "${POSTGRES_PASSWORD:=oal_dev_password}"
export PGPASSWORD="$POSTGRES_PASSWORD"
: "${CLICKHOUSE_URL:=http://oal:oal_dev_password@127.0.0.1:8123/oal}"

PG_MIG_DIR="${ROOT}/infra/db/migrations/postgres"
CH_MIG_DIR="${ROOT}/infra/db/migrations/clickhouse"
SEED_DIR="${ROOT}/infra/db/seeds"

apply_pg() {
  echo "== Applying Postgres migrations =="
  psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -v ON_ERROR_STOP=1 \
    -c "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now());"
  for f in $(ls "$PG_MIG_DIR"/*.sql 2>/dev/null | sort); do
    name="$(basename "$f")"
    if psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
        "SELECT 1 FROM _migrations WHERE name='${name}'" | grep -q 1; then
      echo "  skip ${name} (already applied)"
    else
      echo "  apply ${name}"
      psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
        -v ON_ERROR_STOP=1 -f "$f"
      psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
        -c "INSERT INTO _migrations(name) VALUES ('${name}') ON CONFLICT DO NOTHING;"
    fi
  done
}

apply_ch() {
  echo "== Applying ClickHouse migrations =="
  for f in $(ls "$CH_MIG_DIR"/*.sql 2>/dev/null | sort); do
    name="$(basename "$f")"
    echo "  apply ${name}"
    curl -sS --data-binary @"$f" "${CLICKHOUSE_URL}/" >/dev/null
  done
}

apply_seeds() {
  echo "== Applying seeds =="
  for f in $(ls "$SEED_DIR"/*.sql 2>/dev/null | sort); do
    echo "  seed $(basename "$f")"
    psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -v ON_ERROR_STOP=1 -f "$f"
  done
}

status() {
  echo "== Applied Postgres migrations =="
  psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "SELECT name, applied_at FROM _migrations ORDER BY applied_at;"
}

case "${1:-}" in
  up)     apply_pg; apply_ch ;;
  seed)   apply_seeds ;;
  status) status ;;
  down)   echo "No down-migrations shipped (dev: use 'make db-reset')." ;;
  *) echo "usage: $0 {up|seed|status|down}"; exit 1 ;;
esac
