# Aave 当前 Watchlist 容量与触发分析

生成时间：2026-07-08T09:55:10.063Z

## 总览

| 指标 | 数值 |
|---|---:|
| watch entries | 7 |
| liquidatable | 0 |
| near-liquidation | 0 |
| passing current profitability | 0 |
| total debt-to-cover capacity | $654,661.41 |
| total estimated net profit | $29,458.31 |
| minimum HF | 1.119363 |
| closest liquidation distance | 10.6635% |

## 组合聚合

| pair | count | min HF | trigger move | debt capacity | est. net profit | max ROI | buckets |
|---|---:|---:|---:|---:|---:|---:|---|
| USDT/WETH | 2 | 1.119363 | 10.6635% | $584,371.49 | $26,296.3 | 4.5000% | small, large |
| USDC/WBTC | 2 | 1.203172 | 16.8864% | $29,518.91 | $1,327.94 | 4.4992% | medium, small |
| USDT/WBTC | 3 | 1.203172 | 16.8864% | $40,771 | $1,834.07 | 4.4994% | small, dust, medium |

## Top Watch Entries

| id | pair | category | HF | trigger move | debt capacity | est. net profit | ROI | gate |
|---|---|---|---:|---:|---:|---:|---:|---|
| liq-ethereum-71d3e4-usdt-weth | USDT/WETH | watch | 1.119363 | 10.6635% | $1,314.34 | $58.94 | 4.4842% | block: health factor 1.119363 is not below 1 |
| liq-ethereum-43d873-gho-wbtc-usdc-wbtc | USDC/WBTC | watch | 1.203172 | 16.8864% | $27,279.21 | $1,227.36 | 4.4992% | block: health factor 1.203172 is not below 1 |
| liq-ethereum-43d873-gho-wbtc-usdt-wbtc | USDT/WBTC | watch | 1.203172 | 16.8864% | $5,773.07 | $259.58 | 4.4964% | block: health factor 1.203172 is not below 1 |
| liq-ethereum-ca649c-usdc-cbbtc-usdc-wbtc | USDC/WBTC | watch | 1.213785 | 17.6131% | $2,239.7 | $100.58 | 4.4907% | block: health factor 1.213785 is not below 1 |
| liq-ethereum-5a537f-usdt-weth | USDT/WETH | watch | 1.281368 | 21.9584% | $583,057.16 | $26,237.36 | 4.5000% | block: health factor 1.281368 is not below 1 |
| liq-ethereum-5a537f-usdt-weth-usdt-wbtc | USDT/WBTC | watch | 1.281368 | 21.9584% | $0 | $-0.21 | -35087.7403% | block: health factor 1.281368 is not below 1 |
| liq-ethereum-687d1d-usdt-cbbtc-usdt-wbtc | USDT/WBTC | watch | 1.334033 | 25.0393% | $34,997.94 | $1,574.7 | 4.4994% | block: health factor 1.334033 is not below 1 |

## 结论

- 当前没有 Aave watchlist entry 可执行，全部卡在 HF >= 1。
- 这些 entry 是 scanner 节点应该持续盯的账户和组合，不应进入 executor 下单队列。
- 触发后仍必须经过同区块 fork simulation、债务资金来源、抵押品退出 quote、gas/slippage gate。
