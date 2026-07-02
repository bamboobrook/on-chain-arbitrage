# Contributing

This is a pre-audit research/MVP build of an on-chain arbitrage platform. Contributions that improve correctness, tests and safety are very welcome.

## Setup

```bash
make setup              # Node 20 + pnpm + Rust + Foundry
pnpm install
make db-up && make db-migrate && make db-seed
```

## Layout

See [`README.md`](README.md) and [`docs/architecture.md`](docs/architecture.md). The four layers:

- `crates/` — Rust cores (DEX math, backtest, execution). Single source of truth for pricing/sim.
- `contracts/` — Solidity (Foundry). Pre-audit.
- `packages/` — TS shared (config, sdk, strategy-models, ui).
- `apps/` — api (Fastify), workers (BullMQ), web (Next.js).

## Before you push

- `cargo fmt && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
- `cd contracts && forge fmt && forge build && forge test`
- `pnpm -r exec tsc --noEmit`

CI runs all of the above.

## Adding a strategy

See [`docs/model-interface.md`](docs/model-interface.md) §5. TL;DR: implement `StrategyModel` in `packages/strategy-models`, register it, add DEX math to `crates/strategy-core` if hot-path, add contract adapters if a new venue is needed, and pass the admission gate in [`docs/risk-policy.md`](docs/risk-policy.md) §4 before any "target 20%+" label.

## Safety rules (do not break)

- No arbitrary `call` in contracts — only whitelisted adapters.
- Profit judged by final asset balance, never by a spot oracle.
- `minProfitAssets` must be in every execution calldata.
- Never show "guaranteed", "stable 20%+", "capital-protected" or "risk-free arbitrage" in the UI. The mandatory disclaimer lives in `packages/ui`.
- Backtests must include gas/bribe/failure/inclusion/competition cost models (design §8.1).

## Reporting a vulnerability

Do not open a public issue. Email the maintainers. For a pre-audit repo the contract layer is the highest-priority surface.
