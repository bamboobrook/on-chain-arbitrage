# Maker Clipper 策略发现扫描

生成时间：2026-07-08T23:57:53.526Z
链：Ethereum
状态：rpc-blocked-maker-clipper-scan

## 结论

这次 Maker Clipper 策略发现没有完成链上日志回放，原因是远端 RPC/DNS 连接失败或超时。这个结果不能解释为“Maker 没有套利机会”，只能解释为“当前基础设施没有给出足够链上数据”。

当前阻塞：

- 阻塞阶段：rpc-health-or-chainlog-read
- 错误：hard timeout after 20000ms while scanning Maker Clipper
- Clipper 策略等级：仍保留为 A 级候选，等待 RPC 恢复后回放。
- Passing：0，原因是未完成 auction curve + DEX exit quote 回测。

## 恢复后重跑

```bash
MAKER_RPC_TIMEOUT_MS=60000 MAKER_LOOKBACK_BLOCKS=20000 MAKER_LOG_CHUNK_BLOCKS=5000 MAKER_MAX_CLIPPERS=18 MAKER_MAX_LOG_REQUESTS=90 node scripts/search-maker-clipper-auctions.mjs
```

## 下一步

1. 换用稳定 Ethereum archive/full RPC，先确认 `eth_blockNumber` 15 秒内响应。
2. 先跑 20k 区块事件密度，再扩到 120k、500k。
3. 有事件后再接 auction price curve 和 collateral -> DAI 退出 quote。
