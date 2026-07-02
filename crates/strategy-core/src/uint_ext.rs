//! Small helpers around the fixed-width unsigned integer type used across the
//! crate. We standardize on [`Uint`] (`ruint::Uint<256, 4>`) for all on-chain
//! amounts so there is exactly one bignum type to deal with.

use serde::{Deserialize, Serialize};

/// 256-bit unsigned integer. The canonical bignum type for all on-chain amounts.
pub type Uint = ruint::Uint<256, 4>;

/// Zero cost newtype-free alias for "amount in base units".
pub type Amount = Uint;

/// Convenience trait mirroring a few `u128`-style helpers on [`Uint`].
pub trait UintExt: Sized {
    fn ten_pow(exp: u32) -> Self;
    fn to_decimal_string(&self) -> String;
}

impl UintExt for Uint {
    /// 10^exp as a 256-bit integer (e.g. `10^6` for USDC decimals).
    fn ten_pow(exp: u32) -> Self {
        let mut acc = Self::from(1u64);
        let ten = Self::from(10u64);
        for _ in 0..exp {
            acc = acc.saturating_mul(ten);
        }
        acc
    }

    fn to_decimal_string(&self) -> String {
        self.to_string()
    }
}

/// A (value, decimals) pair, convenient for converting between a human amount
/// and base units. Serializes as `{ "value": "<dec string>", "decimals": n }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecimalAmount {
    pub value: Uint,
    pub decimals: u8,
}

impl DecimalAmount {
    pub fn from_human(human: f64, decimals: u8) -> Self {
        let scaled = human * 10f64.powi(decimals as i32);
        // Truncation is acceptable for input parsing; backtest hot path never
        // goes through float.
        Self {
            value: Uint::from(scaled as u128),
            decimals,
        }
    }

    pub fn zero(decimals: u8) -> Self {
        Self {
            value: Uint::ZERO,
            decimals,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ten_pow_works() {
        assert_eq!(Uint::ten_pow(0), Uint::from(1u64));
        assert_eq!(Uint::ten_pow(6), Uint::from(1_000_000u64));
        assert_eq!(Uint::ten_pow(18), Uint::from(10u64).pow(Uint::from(18u64)));
    }

    #[test]
    fn from_human_usdc() {
        let a = DecimalAmount::from_human(1.5, 6);
        assert_eq!(a.value, Uint::from(1_500_000u64));
    }
}
