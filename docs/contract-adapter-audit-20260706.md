# Contract Adapter Audit Notes - 2026-07-06

Scope:

- `contracts/src/StrategyExecutor.sol`
- `contracts/src/adapters/UniversalDexAdapter.sol`
- `contracts/src/adapters/UniswapV2Adapter.sol`
- `contracts/src/adapters/CurveStableSwapAdapter.sol`
- `contracts/src/adapters/BalancerV2VaultAdapter.sol`
- `contracts/test/StrategyExecutor.t.sol`
- `contracts/test/AdapterSecurity.t.sol`
- `contracts/test/AdapterBaseFork.t.sol`

## Test Status

`forge` is installed at `/home/bumblebee/.foundry/bin/forge`. The patched
adapters compile, the local unit suite passes, and the optional live-pool fork
smoke suite now covers Ethereum, Base, Polygon, and Arbitrum.

```text
cd /home/bumblebee/Project/on-chain-arbitrage/contracts
/home/bumblebee/.foundry/bin/forge test -vv
25 tests passed, 0 failed, 0 skipped

RUN_FORK_TESTS=1 /home/bumblebee/.foundry/bin/forge test --match-contract AdapterBaseForkTest -vv
6 tests passed, 0 failed, 0 skipped
```

## Findings

### P0 - Uniswap V3 callback is not production-safe

`UniswapV3Adapter.uniswapV3SwapCallback` does not verify that `msg.sender` is the
pool originally passed to `swap`. It also ignores the actual amount deltas and
pays the decoded `amountOwed` from calldata. A production adapter must verify
the canonical pool address, token0/token1, fee tier, callback deltas, and owed
token before transferring funds.

Impact: if the adapter ever holds tokens, an arbitrary caller can attempt to use
the callback path to drain the decoded token. This adapter must remain a live
execution blocker.

2026-07-06 update: source has been patched to encode the expected pool into
callback data, require `msg.sender == pool`, derive the owed amount from
`amount0Delta` / `amount1Delta`, and reject mismatched callback amounts. Unit
tests cover callback rejection and amount mismatch. A Base fork smoke test
swapped WETH to USDC through the live Uniswap V3 WETH/USDC 0.05% pool, and an
Arbitrum fork smoke swapped USDC to WETH through the live Uniswap V3 USDC/WETH
0.05% pool.

### P0 - Uniswap V2 adapter does not fund the pair before swap

`UniswapV2Adapter.swap` transfers `tokenIn` from the executor to the adapter and
then increases allowance for the pair. Uniswap-V2-style pairs do not pull input
tokens with allowance; the input token must be transferred to the pair before
calling `pair.swap`.

Impact: the adapter is not a valid production V2/Sushi/Aerodrome volatile swap
adapter. It must be fixed and fork-tested before any pure DEX route is enabled.

2026-07-06 update: source has been patched to read `token0` / `token1`, validate
the pair direction, transfer `tokenIn` directly from the executor to the pair,
then call `swap` and return actual recipient output. Unit tests cover pair
funding and invalid pair-token rejection. Fork smokes now cover Polygon
QuickSwap V2 USDC/WETH and Arbitrum Sushi V2 USDC/WETH.

### 2026-07-07 - Curve and Balancer swap adapters added

Added `CurveStableSwapAdapter` and `BalancerV2VaultAdapter`.

- Curve adapter discovers coin indexes from `coins(uint256)` / `coins(int128)`,
  quotes with `get_dy(int128,int128,uint256)`, executes
  `exchange(int128,int128,uint256,uint256)`, and transfers actual output to the
  recipient.
- Balancer adapter derives `poolId` from the pool contract, settles through the
  configured Balancer V2 Vault with `GIVEN_IN`, and transfers actual output to
  the recipient.
- Unit tests cover Curve coin discovery, unknown-token rejection, Balancer poolId
  routing, Vault settlement, and allowance cleanup.
- Fork smokes cover Ethereum Curve 3pool DAI/USDC and Ethereum Balancer
  80BAL/20WETH WETH/BAL in addition to the prior V2/V3 pool smokes.

These adapters make dry-run execution plans more production-shaped, but they do
not unlock live trading by themselves. No searched pure on-chain strategy
currently passes the 20%+ after-gas evidence gate.

### P1 - V2 adapter assumes a fixed 30 bps fee

The adapter hardcodes the classic `997/1000` fee model. That is not valid for all
V2-style deployments, stable pools, custom-fee pairs, or fee-on-transfer tokens.

Impact: min-out calculations can be wrong. Production routing must use
chain-specific pool metadata or router quotes.

### P1 - StrategyExecutor is a vault/executor model, not yet wallet-only

`StrategyExecutor.execute` assumes the executor is already funded by a trusted
vault and then returns principal plus profit to the vault. That is a useful
vault-based primitive, but it is not yet the requested wallet-only flow where a
user connects a wallet and runs an atomic route directly after approval.

Impact: the frontend can show dry-run execution plans, but live DEX arbitrage
must remain blocked until the vault/executor funding path, flash-loan path, or
direct wallet approval path is explicitly implemented and fork-tested.

## Required Remediation Before Live DEX Arbitrage

1. Add Aerodrome-style V2/volatile and Slipstream fork coverage where those
   routes are enabled.
2. Add fee-aware V2 quotes or use canonical routers for quote/execution parity.
3. Add loss-reverting fork tests for two-leg and triangular pure DEX routes,
   including Curve/Balancer route legs where selected by the scanner.
4. Deploy and verify executor/adapters before setting `DEX_ARB_EXECUTOR_ADDRESS`.
5. Keep the live gate blocked until at least one strategy passes quote replay,
   same-block fork simulation, and after-gas profitability checks.

Conclusion: the patched adapters now compile and have focused unit coverage.
The fork smoke suite now covers Base Uniswap V3, Arbitrum Uniswap V3, Polygon
QuickSwap V2, Arbitrum Sushi V2, Ethereum Curve 3pool, and Ethereum Balancer
V2. Production adapter gates should still remain blocked until fee-aware quote
parity, multi-hop loss-revert forks, deployment, and external review are
complete.
