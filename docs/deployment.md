# Deployment & Operations

> **Status:** local-development deployment is fully supported. Public testnet/mainnet deployment is intentionally **not** automated here — it requires your deployer key and funded accounts and should follow an external runbook once contracts are audited.

## 1. Local development stack

Everything runs via Docker Compose (`infra/docker-compose.yml`):

| Service | Port | Purpose |
|---|---|---|
| Postgres (+ Timescale ext) | 5432 | Core tables + time-series hypertables |
| Redis | 6379 | BullMQ queues, worker coordination, live caches |
| ClickHouse | 8123 (HTTP), 9000 (native) | swap/pool_state/event lake |
| Prometheus (optional) | 9090 | metrics scrape |
| Grafana (optional) | 3001 | dashboards |

```bash
make db-up        # start
make db-migrate   # apply migrations
make db-seed      # seed chains/assets/pools
make db-down      # stop
make db-reset     # wipe + recreate
```

## 2. Local EVM chain (Anvil)

```bash
make anvil          # terminal 1 — local node on :8545, chain 31337
make deploy-local   # terminal 2 — deploy ArbVault + executors + adapters
```

Anvil's default accounts are pre-funded; the deployer mnemonic lives in `.env` (default is the Anvil test mnemonic — safe for local dev only).

## 3. Running the apps

```bash
pnpm install
make dev-api       # Fastify gateway on :4000
make dev-workers   # all 6 BullMQ workers
make dev-web       # Next.js on :3000
```

The frontend talks to the API at `http://localhost:4000` and to the local Anvil node at `http://localhost:8545` by default (override in `.env`).

## 4. Environment

Copy `.env.example` → `.env`. The critical variables:

| Var | Required for | Notes |
|---|---|---|
| `RPC_BASE_URL`, `RPC_ARBITRUM_URL` | indexing, backtest, fork tests | must be **archive** endpoints |
| `DEPLOYER_PRIVATE_KEY` | live/local execution | dedicated account; Anvil mnemonic for dev |
| `POSTGRES_*` / `DATABASE_URL` | api, workers | |
| `REDIS_URL` | workers | |
| `CLICKHOUSE_*` | indexer, backtest | |
| `ADMIN_API_KEY` | admin endpoints | |
| `FLASHBOTS_RELAY_URL` | live execution (optional for MVP) | |

Never commit `.env`. The repo `.gitignore` excludes it.

## 5. Production notes (future)

When moving toward production:

- Separate the Postgres role for app vs migrations; least-privilege.
- Put ClickHouse behind auth + TLS; it holds swap history.
- Run workers as multiple replicas behind a queue; the indexer is a singleton per chain.
- Use a dedicated, funded executor EOA with rotating nonce management.
- Private relays: multiplex Flashbots / Beaverbuild / Titan; never broadcast arb txs to the public mempool.
- Observability: Prometheus + Grafana + Sentry + OpenTelemetry tracing (config scaffold in `infra/`).
- Secrets: move from `.env` to a real secret manager; rotate keys.
- Deploy contracts through a multisig + timelock; verify on block explorers.
- **Audit first**, then time-locked parameter changes, then small-capital live, then gradual opening.
