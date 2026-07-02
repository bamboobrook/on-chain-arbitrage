# Contracts

On-chain layer of the On-Chain Arbitrage Lab — Solidity 0.8.24 / Foundry. **Pre-audit.**

## Modules

| Contract | Role |
|---|---|
| `ArbVault.sol` | ERC-4626 single-asset vault: deposits, redemptions, performance fee (as share mint), emergency pause, profit reporting. |
| `StrategyController.sol` | vault↔strategy allocations, executor whitelist, capital + daily-loss caps, max deployable %. |
| `StrategyExecutor.sol` | Atomic route execution: pulls principal, walks whitelisted DexAdapters, returns principal+profit, reverts if profit < floor. |
| `RiskManager.sol` | Per-tx/day loss caps, per-token/DEX exposure, allowed chains, blacklist, scope pause. |
| `Accounting.sol` | Realized profit + execution ledger with indexer-friendly events. |
| `FlashLoanAdapter.sol` | EIP-3156 borrower for flash-loan capital. |
| `adapters/` | UniswapV2, UniswapV3 (callback), Curve, Balancer swap adapters. |
| `ArbTimelockController.sol` | Parameter-change timelock (OZ). |

## Build & test

```bash
forge build
forge test -vv
forge test --match-path "test/fork/*" -vv   # mainnet-fork (needs RPC_BASE_URL)
```

## Deploy

Local Anvil:
```bash
anvil --chain-id 31337 --block-time 1     # terminal 1
forge script script/LocalAnvil.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --private-key $PRIVATE_KEY \
  --tc LocalAnvilScript
```

Parameterized (any chain):
```bash
forge script script/Deploy.s.sol \
  --rpc-url $RPC --broadcast --private-key $PK \
  --tc DeployScript
```

## Security rules enforced (design §5.2)

- Only whitelisted DexAdapters — no arbitrary `call`.
- SafeERC20 everywhere.
- Before/after balance checks; profit judged by final asset balance.
- `minProfitAssets` in every execution calldata; atomic revert if not met.
- Deadline + gas-cost guards.
- Pause + timelock + multisig paths.
- Independent audit required before any mainnet capital (see [`../docs/risk-policy.md`](../docs/risk-policy.md)).

## Addresses

Deployed addresses are emitted by the scripts and recorded in `packages/sdk/src/contracts.ts` for the local Anvil run.
