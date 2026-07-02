# API Reference

Base URL (local): `http://localhost:4000`. All JSON. Amounts in base units are decimal strings to preserve precision.

## REST

### Reference data
| Method | Path | Description |
|---|---|---|
| GET | `/api/chains` | Supported chains |
| GET | `/api/assets` | Supported vault assets |

### Strategies
| Method | Path | Description |
|---|---|---|
| GET | `/api/strategies` | List strategies (with risk class, status, metrics) |
| GET | `/api/strategies/:id` | Strategy detail |
| GET | `/api/strategies/:id/metrics` | Live + backtest metrics, capacity curve |

### Backtests
| Method | Path | Description |
|---|---|---|
| POST | `/api/backtests` | Create a backtest run (async) |
| GET | `/api/backtests/:id` | Run status + summary |
| GET | `/api/backtests/:id/events` | Equity curve, daily PnL, trade list |

### Vaults
| Method | Path | Description |
|---|---|---|
| GET | `/api/vaults` | List vaults |
| GET | `/api/vaults/:id` | Vault detail (share price, TVL, fees) |
| GET | `/api/vaults/:id/positions` | Strategy allocations |
| GET | `/api/vaults/:id/pnl` | Historical PnL |

### Live
| Method | Path | Description |
|---|---|---|
| GET | `/api/live/opportunities` | Recent/active opportunities |
| GET | `/api/live/executions` | Recent executions |

### Admin (requires `X-Admin-Key`)
| Method | Path | Description |
|---|---|---|
| POST | `/api/admin/strategies/:id/pause` | Pause a strategy |
| POST | `/api/admin/strategies/:id/resume` | Resume a strategy |
| POST | `/api/admin/vaults/:id/rebalance` | Trigger rebalance |

## Server-Sent Events (SSE)

All SSE streams emit `data:` JSON lines and send keep-alive comments.

| Path | Events |
|---|---|
| `/stream/backtests/:id` | progress, stage, metrics, done |
| `/stream/live/opportunities` | new opportunity, status change |
| `/stream/live/executions` | submitted, confirmed, failed |
| `/stream/risk-events` | warning, critical, pause |

## Example: create a backtest

```bash
curl -X POST http://localhost:4000/api/backtests \
  -H 'Content-Type: application/json' \
  -d '{
    "strategyId": "atomic-amm",
    "chainId": 8453,
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "startBlock": 25000000,
    "endBlock": 25100000,
    "capital": "1000000000",
    "costModel": { "gasStressPct": 0, "bribeStressPct": 0, "inclusionRate": 0.7 },
    "params": {}
  }'
```

Returns `{ "id": "bt_...", "status": "queued" }`. Follow progress on `/stream/backtests/:id` or poll `/api/backtests/:id`.
