# Launch Ladder (Phase 7)

Per full-audit plan §7. Each stage is a gate; failure at any stage returns
to the previous. Stages MUST be sequential.

## Stage 1: Research (current)
- Status: ACTIVE
- Backtests only, 0 real capital
- Aave V3 V2 replay: 243 events, admitted-with-caveat
- Other protocols: blocked by RPC limits

## Stage 2: Shadow
- Requirements: real-time scanner running 14 days + >= 30 executable signals
- Scanner code: DONE (apps/workers/src/workers/indexerWorker.ts)
- Executor in shadow mode: DONE (logs "would execute" when LIVE_EXECUTION_ENABLED=false)
- NOT STARTED: 14-day continuous run

## Stage 3: Testnet/Anvil
- Requirements: 100 automated lifecycle tests on testnet
- Contracts: compiled + tested (47 unit + 4 invariant tests)
- Deploy script: LocalAnvilScript verified
- NOT STARTED: testnet deployment

## Stage 4: Mainnet canary
- Requirements: developer $100-500, single strategy, 30 days
- Prerequisite: independent security audit (NOT DONE)
- NOT STARTED

## Stage 5: Mainnet limited
- Requirements: max 10% capacity, 30 more days
- NOT STARTED

## Stage 6: Public beta
- Requirements: admitted + canary-passed strategies only, capacity limits
- NOT STARTED

## Auto-rollback triggers (any stage)
- Rolling 30-day APY < 20%
- Live capture rate < backtest stress assumption
- 3 consecutive revert/nonce/relay failures
- Single-day loss > strategy budget
- Oracle/RPC/indexer/reconciliation inconsistency

## Current blockers
1. Only 1 strategy admitted (need 5 for full production)
2. 35-day history (need 12 months for 'stable')
3. No independent security audit
4. No testnet/mainnet deployment (needs deployer key + funded account)
