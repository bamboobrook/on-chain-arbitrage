//! Anti-overfit: walk-forward + capacity + cost-stress evaluation.
//!
//! Mirrors design §8.4. These are pure transforms over a sequence of
//! per-block P&L observations; they don't touch the network.

use serde::{Deserialize, Serialize};
use strategy_core::uint_ext::{Amount, Uint};

/// One P&L observation: block + realized net profit (asset units).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PnlPoint {
    pub block: u64,
    pub net_profit: Amount,
}

/// Walk-forward split: train window, then test window.
/// Returns (train, test) slices in chronological order.
pub fn walk_forward_split(points: &[PnlPoint], train_blocks: u64, test_blocks: u64) -> (Vec<PnlPoint>, Vec<PnlPoint>) {
    if points.is_empty() {
        return (vec![], vec![]);
    }
    let start = points[0].block;
    let train_end = start.saturating_add(train_blocks);
    let test_end = train_end.saturating_add(test_blocks);

    let train: Vec<PnlPoint> = points
        .iter()
        .filter(|p| p.block >= start && p.block < train_end)
        .copied()
        .collect();
    let test: Vec<PnlPoint> = points
        .iter()
        .filter(|p| p.block >= train_end && p.block < test_end)
        .copied()
        .collect();
    (train, test)
}

/// Capacity curve: re-run P&L under different capital sizes by scaling the
/// net profit with a slippage model `profit(capital) = profit0 * f(capital)`.
/// We expose the simple callable; the actual capacity run is driven by the
/// backtest driver (it re-simulates per capital).
pub fn capacity_curve(profit_at_capital: &[(u64, Amount)]) -> CapacityCurve {
    CapacityCurve {
        points: profit_at_capital
            .iter()
            .map(|(cap, p)| CapacityPoint {
                capital: *cap,
                net_profit: *p,
            })
            .collect(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapacityCurve {
    pub points: Vec<CapacityPoint>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct CapacityPoint {
    pub capital: u64,
    pub net_profit: Amount,
}

impl CapacityCurve {
    /// Largest capital at which net profit is still positive.
    pub fn break_even_capital(&self) -> Option<u64> {
        self.points
            .iter()
            .filter(|p| p.net_profit > Uint::ZERO)
            .map(|p| p.capital)
            .max()
    }
}

/// Sum net profit over a slice (e.g. test window).
pub fn sum_profit(points: &[PnlPoint]) -> Amount {
    let mut acc = Uint::ZERO;
    for p in points {
        acc = acc.saturating_add(p.net_profit);
    }
    acc
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pt(block: u64, profit: u64) -> PnlPoint {
        PnlPoint {
            block,
            net_profit: Uint::from(profit),
        }
    }

    #[test]
    fn walk_forward_splits_correctly() {
        let pts: Vec<PnlPoint> = (0..20).map(|i| pt(i, 10)).collect();
        let (train, test) = walk_forward_split(&pts, 10, 5);
        assert_eq!(train.len(), 10);
        assert_eq!(test.len(), 5);
        assert_eq!(test[0].block, 10);
        assert_eq!(test[4].block, 14);
    }

    #[test]
    fn capacity_break_even() {
        let curve = capacity_curve(&[
            (1_000, Uint::from(100u64)),
            (10_000, Uint::from(50u64)),
            (100_000, Uint::ZERO),
        ]);
        assert_eq!(curve.break_even_capital(), Some(10_000));
    }
}
