# Apps

TypeScript applications: API gateway, workers, and the web console.

## `@oal/api` — Fastify gateway

REST + SSE implementing [`docs/api-reference.md`](../docs/api-reference.md). Postgres-backed, admin endpoints protected by `X-Admin-Key`.

```bash
pnpm --filter @oal/api dev    # http://localhost:4000
```

## `@oal/workers` — BullMQ workers

Six worker classes consuming Redis queues + per-chain indexer:

- `opportunity-worker` — model.discover per block → opportunity queue
- `simulation-worker` — revm/Anvil fork sim of candidates
- `execution-worker` — build tx, private-relay submit, lifecycle
- `backtest-worker` — runs the Rust backtest-engine on queued runs
- `risk-worker` — continuous loss/exposure checks, auto-pause
- `accounting-worker` — parse ProfitReported/ExecutionRecorded → PnL, share price

```bash
pnpm --filter @oal/workers dev
```

## `@oal/web` — Next.js 14 console

All 10 pages from design §10. TanStack Query, mandatory risk Disclaimer on every yield surface, backtest creation form, vault deposit/withdraw scaffolding.

```bash
pnpm --filter @oal/web dev    # http://localhost:3000
```

Set `NEXT_PUBLIC_API_BASE` if the API is not on `http://localhost:4000`.
