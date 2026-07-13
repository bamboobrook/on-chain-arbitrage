# Morpho Blue 当前机会 Gate 审计

生成时间：2026-07-08  
项目目录：`/home/bumblebee/Project/on-chain-arbitrage`

## 1. 这轮补了什么

本轮专门检查 Morpho Blue 是否能从“历史强信号”升级为新的可执行策略族。

新增脚本：

`scripts/diagnose-morpho-oracles.mjs`

新增产物：

`data/morpho-blue-oracle-diagnostics-ethereum.json`

已刷新产物：

- `data/morpho-blue-liquidation-candidates-ethereum.json`
- `data/morpho-blue-liquidation-watchlist-ethereum.json`
- `data/pure-arbitrage-search-overview.json`
- `data/strategy-discovery-ranked-candidates.json`

## 2. 当前扫描结果

`data/morpho-blue-liquidation-candidates-ethereum.json`

| 指标 | 数值 |
|---|---:|
| 扫描市场 | 250 |
| 仓位候选 | 3562 |
| 当前 liquidatable | 46 |
| near-liquidation | 259 |
| watch | 283 |
| 当前通过 gate | 0 |
| 状态 | did-not-find-five-passing-morpho-blue-liquidation-opportunities |

`data/morpho-blue-liquidation-watchlist-ethereum.json`

| 指标 | 数值 |
|---|---:|
| 历史稳定市场 | 13 |
| watchlist 候选 | 16 |
| liquidatable | 4 |
| near-liquidation | 5 |
| passing current profitability | 0 |

## 3. 最大当前机会

当前最大账面机会：

| 字段 | 值 |
|---|---|
| candidate | `morpho-blue-liq-ethereum-fd0d72-e38a65-usdc-aznd` |
| market | USDC / AZND |
| borrowUsd | $8,343,029.47 |
| LTV / LLTV | 0.8670 / 0.8600 |
| estimated net profit | $365,749.56 |
| block reason | `on-chain oracle price check failed: eth_call: execution reverted` |

结论：这个机会不能执行。GraphQL 显示它 liquidatable，但当前链上 oracle `price()` 直接 revert；如果 Morpho 执行路径也需要这个 oracle，清算交易会失败。

## 4. Oracle 诊断结果

`data/morpho-blue-oracle-diagnostics-ethereum.json`

| 指标 | 数值 |
|---|---:|
| 诊断市场 | 22 |
| oracle 通过 | 0 |
| oracle 失败 | 22 |
| liquidatable 且 oracle 通过 | 0 |
| 状态 | no-liquidatable-market-with-passing-oracle-check |

Top 失败样例：

| market | 标的 | 风险状态 | oracle | code size | 失败原因 |
|---|---|---|---|---:|---|
| `0xfd0d72...d4cc2` | USDC / AZND | liquidatable | `0x270B...5588b` | 2598 bytes | `eth_call: execution reverted` |
| `0xb37c30...bc95c` | USDC / PT-apyUSD | watch | `0x1001...4E65` | 2598 bytes | `eth_call: execution reverted` |
| `0xec9765...a264` | WETH / hgETH | liquidatable | `0x56DB...678C` | 2598 bytes | `eth_call: execution reverted` |
| `0x23a7d0...49c8` | USDC / msY | liquidatable | `0xB0b6...Aa4` | 2598 bytes | `eth_call: execution reverted` |

这些 oracle 地址都有 bytecode，所以不是“地址没部署”。问题是 `price()` 调用自身 revert，且 RPC 没有返回可解码的 revert data。

## 5. 对策略发现的影响

Morpho 现在不能计入“已通过策略”，原因不是没有历史边际，而是 current-state 执行前置条件没过：

1. 1000 条历史清算回放里，有 137 条候选通过历史稳定性，但 live gate blocked。
2. 当前扫描 250 个市场发现 46 个 liquidatable，但没有一个通过 oracle gate。
3. 历史稳定市场的 watchlist 有 4 个 liquidatable，但同样没有 oracle 通过。
4. 所以 Morpho 当前状态应保持 A 级强信号，而不是 S 级通过策略。

## 6. 下一步怎么补

要把 Morpho 变成可通过策略，下一步不是改 UI，而是补以下策略适配：

1. 对每个 Morpho market 做 oracle 类型识别。
2. 对 `price()` revert 的 market 标记为 `oracle-reverting-market`，禁止进入执行队列。
3. 对 oracle 通过的 market，再做 on-chain position/market 读取，不能只相信 GraphQL USD。
4. 建立抵押品退出路径白名单：
   - 优先：WETH、wstETH、WBTC、cbBTC、USDC、USDT、DAI。
   - 谨慎：PT、LST/LRT、RWA、长尾稳定币。
   - 默认禁止：oracle revert 且无高流动性退出路径的长尾资产。
5. 只有同时满足以下条件才允许进入 fork 模拟：
   - current liquidatable。
   - oracle `price()` passed。
   - repay token 可由用户资金或链上 flash liquidity 覆盖。
   - collateral unwind quote after gas/slippage 为正。
   - fork liquidation call 成功。

## 7. 当前策略优先级调整

维持：

- S 级：Aave V3 Ethereum 清算回放 5 条。
- A 级：Morpho Blue 清算，但必须先解决 oracle/退出路径。
- B 级：Pendle PT 期限收敛，不算原子套利。
- C 级：普通 DEX 价差，当前证据弱。

本轮没有发现新的 live-ready 策略。live-ready 仍为 0。

