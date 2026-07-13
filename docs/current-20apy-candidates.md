# Current 20%+ On-Chain Candidates

Generated: 2026-07-03T04:20:05.563Z

Source: https://yields.llama.fi/pools

Important: these are on-chain APY candidates from DeFiLlama Yields. They are not guaranteed returns and they are not pure arbitrage unless explicitly marked `isPureArbitrage=true`. In the current snapshot all selected candidates are LP / market-making / yield candidates.

| ID | Chain | Project | Symbol | Classification | APY base % | 7d APY base % | 30d mean APY % | TVL USD | Live interface |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| candidate-1-base-usdc-cbbtc | Base | aerodrome-slipstream | USDC-CBBTC | lp-market-making | 423.27533 | 281.99348 | 447.14984 | 5267322 | needs-slipstream-adapter |
| candidate-2-ethereum-serv-weth | Ethereum | uniswap-v3 | SERV-WETH | lp-market-making | 87.36021 | 185.88894 | 74.38118 | 1600159 | needs-uniswap-v3-npm-adapter |
| candidate-3-ethereum-wtao-usdc | Ethereum | uniswap-v3 | WTAO-USDC | lp-market-making | 116.61964 | 29.38327 | 126.85982 | 1010127 | needs-uniswap-v3-npm-adapter |
| candidate-4-base-weth-usdc | Base | uniswap-v3 | WETH-USDC | lp-market-making | 77.66767 | 28.37175 | 112.84696 | 98186074 | needs-uniswap-v3-npm-adapter |
| candidate-5-base-eurc-usdc | Base | aerodrome-slipstream | EURC-USDC | lp-market-making | 46.82962 | 31.66185 | 29.62676 | 2111282 | needs-slipstream-adapter |

## Caveats

- Historical yields are not future yields.
- LP strategies carry impermanent-loss, range, gas, rebalance, and protocol risk.
- These candidates satisfy an observable 20%+ APY filter, not a promise of 20%+ annualized return.
- Pure public-RPC AMM arbitrage remains unproven in this repo; see `docs/arbitrage-search-results.md`.

## 2026-07-06 External Pure On-Chain Model Check

Reviewed official / primary protocol material for wallet-only pure on-chain
arbitrage patterns:

- Aave V3 flash loans: a single transaction can borrow a reserve through
  `flashLoanSimple`, run strategy logic, and repay before the transaction ends.
  This is a valid building block for wallet-only arbitrage, but it does not
  provide persistent yield by itself.
- Balancer V2 flash loans: Balancer Vault liquidity can be borrowed inside one
  transaction and the transaction reverts if repayment fails. This is also a
  valid capital source, but profitability depends on finding an actual edge
  after gas.
- Flashbots MEV-Share examples: searchers can build bots that monitor orderflow,
  backrun price-moving transactions, and submit atomic bundles. This is a real
  pure arbitrage model, but it is competitive, latency-sensitive, and not
  suitable for a public "guaranteed 20% APY" claim.
- CoW Protocol solver model: solvers compete to execute user intents. This can
  capture surplus/arbitrage-like value, but becoming a solver is an operational
  competition and not a simple wallet-only vault for end users.
- Compound V3 liquidations: `isLiquidatable`, `absorb`, and `buyCollateral`
  create a pure on-chain liquidation/arbitrage flow, but it is a current-state
  opportunity model, not recurring APY. The first conservative repo scan found
  1 candidate and 0 passing gates.
- Morpho Blue liquidations: `liquidate` can be used in a pure on-chain
  liquidation/collateral-unwind flow. The first conservative repo scan checked
  40 positions across 4 Ethereum markets and found 0 passing gates.

Sources checked:

- https://aave.com/docs/aave-v3/guides/flash-loans
- https://docs-v2.balancer.fi/reference/contracts/flash-loans.html
- https://docs.flashbots.net/flashbots-mev-share/searchers/tutorials/flash-loan-arbitrage/simple-blind-arbitrage
- https://docs.flashbots.net/flashbots-mev-share/searchers/tutorials/flash-loan-arbitrage/flash-loan-basics
- https://docs.cow.fi/cow-protocol/concepts/introduction/solvers
- https://docs.compound.finance/liquidation/
- https://github.com/compound-finance/comet/tree/main/deployments
- https://docs.morpho.org/get-started/resources/contracts/morpho/
- https://docs.morpho.org/tools/offchain/api/morpho/

Conclusion: the model families exist, but the current evidence still does not
support five pure on-chain, wallet-only strategies with stable 20%+ annualized
returns. The system should continue to treat pure DEX/flash-loan/MEV candidates
as gated opportunities that require quote replay, gas modelling, fork
simulation, and loss-reverting execution before any live user capital is allowed.
