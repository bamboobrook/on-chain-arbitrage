# On-Chain Arbitrage Lab — convenience targets.
# Each target sources the toolchain so it works from any shell.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# Make toolchains discoverable inside recipe shells. Include the nvm-managed
# node bin (so corepack/pnpm is on PATH) + foundry + cargo. Resolve the node
# bin lazily so this works after `make setup` installs node.
NVM_DIR ?= $(HOME)/.nvm
NVM_NODE_BIN := $(wildcard $(NVM_DIR)/versions/node/*/bin)
export PATH := $(HOME)/.foundry/bin:$(HOME)/.cargo/bin:$(NVM_NODE_BIN):$(PATH)

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ----------------------------------------------------------------------------
# Environment
# ----------------------------------------------------------------------------
setup: ## Install Node/Rust/Foundry/pnpm toolchains
	bash infra/scripts/setup-toolchain.sh

# ----------------------------------------------------------------------------
# Infrastructure (Postgres+Timescale / Redis / ClickHouse)
# ----------------------------------------------------------------------------
db-up: ## Start local databases via docker compose
	docker compose -f infra/docker-compose.yml up -d

db-down: ## Stop local databases
	docker compose -f infra/docker-compose.yml down

db-logs: ## Tail database logs
	docker compose -f infra/docker-compose.yml logs -f

db-migrate: ## Apply SQL migrations
	bash infra/scripts/migrate.sh up

db-migrate-down: ## Roll back last migration
	bash infra/scripts/migrate.sh down

db-seed: ## Seed reference data (chains, assets, pools)
	bash infra/scripts/migrate.sh seed

db-reset: db-down ## Wipe and recreate databases
	docker compose -f infra/docker-compose.yml down -v
	$(MAKE) db-up
	$(MAKE) db-migrate
	$(MAKE) db-seed

# ----------------------------------------------------------------------------
# Rust cores
# ----------------------------------------------------------------------------
cargo-build: ## Build Rust workspace
	cargo build --workspace

cargo-test: ## Test Rust workspace
	cargo test --workspace

cargo-clippy: ## Lint Rust workspace
	cargo clippy --workspace --all-targets -- -D warnings

# ----------------------------------------------------------------------------
# Contracts (Foundry)
# ----------------------------------------------------------------------------
forge-build: ## Compile contracts
	cd contracts && forge build

forge-test: ## Run contract tests
	cd contracts && forge test -vv

forge-test-fork: ## Run mainnet-fork contract tests (needs RPC in .env)
	cd contracts && forge test --match-path "test/fork/*" -vv

anvil: ## Start a local Anvil node (chain 31337)
	anvil --chain-id 31337 --block-time 1

deploy-local: ## Deploy contracts to local Anvil
	cd contracts && forge script script/LocalAnvil.s.sol --broadcast --rpc-url http://127.0.0.1:8545

# ----------------------------------------------------------------------------
# Node apps (api / workers / web)
# ----------------------------------------------------------------------------
install: ## Install JS dependencies
	pnpm install

build: ## Build everything (Rust + JS)
	cargo build --workspace
	pnpm build

dev-web: ## Run the Next.js frontend
	pnpm --filter @oal/web dev

dev-api: ## Run the API gateway
	pnpm --filter @oal/api dev

dev-workers: ## Run all workers
	pnpm --filter @oal/workers dev

lint: ## Lint JS/Rust/Solidity
	pnpm lint
	cargo fmt --all -- --check
	cd contracts && forge fmt --check

typecheck: ## TypeScript typecheck
	pnpm typecheck

test: ## Run all tests
	cargo test --workspace
	cd contracts && forge test
	pnpm test

# ----------------------------------------------------------------------------
# Unified verification (Phase 0 §3 of the audit plan).
# One command that turns green only when every layer is healthy.
# ----------------------------------------------------------------------------
verify: ## Run all checks: TS typecheck, Rust test, Foundry test, JSON validate
	@echo "===== OAL verify: 7-layer check (must all pass) ====="
	@echo "----- [1/4] TypeScript typecheck (all packages + apps) -----"
	@for pkg in packages/config packages/sdk packages/ui packages/strategy-models apps/api apps/workers apps/web; do \
		echo "  typecheck $$pkg"; \
		(cd $$pkg && npx tsc --noEmit) || { echo "FAIL: $$pkg typecheck"; exit 1; }; \
	done
	@echo "----- [2/4] Rust workspace: fmt + clippy + test -----"
	@cargo fmt --all -- --check || { echo "FAIL: cargo fmt"; exit 1; }
	@cargo clippy --workspace --all-targets -- -D warnings || { echo "FAIL: cargo clippy"; exit 1; }
	@cargo test --workspace || { echo "FAIL: cargo test"; exit 1; }
	@echo "----- [3/4] Foundry: build + test -----"
	@cd contracts && forge build || { echo "FAIL: forge build"; exit 1; }
	@cd contracts && forge test || { echo "FAIL: forge test"; exit 1; }
	@echo "----- [4/4] JSON artifact schema validate -----"
	@node scripts/verify-artifacts.mjs || { echo "FAIL: JSON schema validate"; exit 1; }
	@echo "===== OAL verify: ALL GREEN ====="

# ----------------------------------------------------------------------------
# Git
# ----------------------------------------------------------------------------
.PHONY: help setup db-up db-down db-logs db-migrate db-migrate-down db-seed db-reset \
        cargo-build cargo-test cargo-clippy \
        forge-build forge-test forge-test-fork anvil deploy-local \
        install build dev-web dev-api dev-workers lint typecheck test verify
