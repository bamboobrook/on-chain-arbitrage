# On-Chain Arbitrage Lab — convenience targets.
# Each target sources the toolchain so it works from any shell.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# Make toolchains discoverable inside recipe shells.
NVM_DIR ?= $(HOME)/.nvm
export PATH := $(HOME)/.foundry/bin:$(HOME)/.cargo/bin:$(PATH)

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
# Git
# ----------------------------------------------------------------------------
.PHONY: help setup db-up db-down db-logs db-migrate db-migrate-down db-seed db-reset \
        cargo-build cargo-test cargo-clippy \
        forge-build forge-test forge-test-fork anvil deploy-local \
        install build dev-web dev-api dev-workers lint typecheck test
