//! Performance metrics for backtests and live P&L.
//!
//! All metrics derive from a series of [`PnlPoint`]s plus a few run-level
//! scalars (capital, decimals, window duration). Designed to be
//! deterministic and dependency-free.

use crate::walk_forward::PnlPoint;
use serde::{Deserialize, Serialize};
use strategy_core::uint_ext::{Amount, Uint};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestMetrics {
    pub total_net_profit: Amount,
    pub trade_count: usize,
    pub winning_trades: usize,
    pub losing_trades: usize,
    pub win_rate: f64,
    pub avg_profit_per_trade: Amount,
    pub max_drawdown: f64, // as a fraction of peak capital, 0..1
    pub annualized_return_pct: f64,
    pub sharpe: f64,
    pub equity_curve: Vec<EquityPoint>,
    pub daily_pnl: Vec<DailyPnl>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EquityPoint {
    pub block: u64,
    pub equity: Amount,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyPnl {
    pub day: String, // YYYY-MM-DD
    pub pnl: Amount,
}

/// Compute metrics from a P&L series.
///
/// - `capital`: starting capital in base units.
/// - `decimals`: asset decimals (for ratio math).
/// - `blocks_per_year`: ~2_629_800 for 12s blocks; pass chain-specific.
/// - `window_blocks`: number of blocks spanned (for annualization).
/// - `block_to_day`: maps a block number to a day string for daily P&L.
pub fn compute(
    points: &[PnlPoint],
    capital: Amount,
    _decimals: u8,
    blocks_per_year: f64,
    window_blocks: u64,
    block_to_day: impl Fn(u64) -> String,
) -> BacktestMetrics {
    let total = points
        .iter()
        .fold(Uint::ZERO, |acc, p| acc.saturating_add(p.net_profit));

    let winning = points.iter().filter(|p| p.net_profit > Uint::ZERO).count();
    let losing = points.iter().filter(|p| p.net_profit == Uint::ZERO).count();
    let win_rate = if points.is_empty() {
        0.0
    } else {
        winning as f64 / points.len() as f64
    };

    let avg = if points.is_empty() {
        Uint::ZERO
    } else {
        total / Uint::from(points.len() as u64)
    };

    // Equity curve + max drawdown.
    let mut equity = Uint::ZERO;
    let mut peak: f64 = amount_to_f64(capital);
    let cap0 = peak.max(1.0);
    let mut max_dd = 0.0f64;
    let mut curve: Vec<EquityPoint> = Vec::with_capacity(points.len());
    for p in points {
        equity = equity.saturating_add(p.net_profit);
        curve.push(EquityPoint {
            block: p.block,
            equity,
        });
        let cur = amount_to_f64(capital) + amount_to_f64(equity);
        if cur > peak {
            peak = cur;
        }
        let dd = (peak - cur) / cap0;
        if dd > max_dd {
            max_dd = dd;
        }
    }

    // Annualized return: total/capital * (blocks_per_year/window).
    let ann = if window_blocks == 0 || capital.is_zero() {
        0.0
    } else {
        let ret = amount_to_f64(total) / amount_to_f64(capital).max(1.0);
        ret * (blocks_per_year / window_blocks as f64) * 100.0
    };

    // Sharpe (per-trade, annualized loosely).
    let returns: Vec<f64> = points
        .iter()
        .map(|p| amount_to_f64(p.net_profit) / amount_to_f64(capital).max(1.0))
        .collect();
    let sharpe = sharpe_ratio(&returns) * (blocks_per_year).sqrt();

    // Daily P&L.
    let mut daily: std::collections::BTreeMap<String, Amount> = std::collections::BTreeMap::new();
    for p in points {
        let day = block_to_day(p.block);
        let entry = daily.entry(day).or_insert(Uint::ZERO);
        *entry = entry.saturating_add(p.net_profit);
    }
    let daily_pnl: Vec<DailyPnl> = daily
        .into_iter()
        .map(|(day, pnl)| DailyPnl { day, pnl })
        .collect();

    BacktestMetrics {
        total_net_profit: total,
        trade_count: points.len(),
        winning_trades: winning,
        losing_trades: losing,
        win_rate,
        avg_profit_per_trade: avg,
        max_drawdown: max_dd,
        annualized_return_pct: ann,
        sharpe,
        equity_curve: curve,
        daily_pnl,
    }
}

fn sharpe_ratio(returns: &[f64]) -> f64 {
    if returns.is_empty() {
        return 0.0;
    }
    let mean = returns.iter().sum::<f64>() / returns.len() as f64;
    let var = returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / returns.len() as f64;
    let std = var.sqrt();
    if std == 0.0 {
        0.0
    } else {
        mean / std
    }
}

fn amount_to_f64(a: Amount) -> f64 {
    let _ = decimals_dummy();
    let limbs = a.as_limbs();
    let mut acc = 0f64;
    let mut scale = 1f64;
    for &l in limbs.iter().rev() {
        acc += l as f64 * scale;
        scale *= 2f64.powi(64);
    }
    acc
}

// keep decimals referenced for future scaling
fn decimals_dummy() -> u8 {
    6
}

#[cfg(test)]
mod tests {
    use super::*;
    use strategy_core::uint_ext::UintExt;

    #[test]
    fn metrics_basic() {
        let pts: Vec<PnlPoint> = (0..10)
            .map(|i| PnlPoint {
                block: i,
                net_profit: Uint::from(1_000_000u64),
            })
            .collect();
        let m = compute(
            &pts,
            Uint::ten_pow(6) * Uint::from(1_000u64),
            6,
            2_629_800.0,
            10,
            |_| "2026-01-01".into(),
        );
        assert_eq!(m.trade_count, 10);
        assert_eq!(m.winning_trades, 10);
        assert!((m.win_rate - 1.0).abs() < 1e-9);
        assert_eq!(m.total_net_profit, Uint::from(10_000_000u64));
        assert!(m.annualized_return_pct > 0.0);
    }
}
