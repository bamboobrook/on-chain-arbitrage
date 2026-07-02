//! Canonical types shared by the backtest engine, the execution router and
//! (via the napi bridge) the TypeScript `StrategyModel` interface.
//!
//! Mirrors `docs/model-interface.md`. Keep these in lock-step with the TS
//! declarations in `packages/sdk/src/types.ts`.

use crate::uint_ext::{Amount, DecimalAmount, Uint, UintExt};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Addresses — kept as lowercase hex strings (with 0x prefix) so they cross the
// napi boundary and serialize cleanly. Conversion helpers live below.
// ---------------------------------------------------------------------------

/// Lowercase 0x-prefixed 20-byte address.
pub type Address = String;
/// Lowercase 0x-prefixed 32-byte hash.
pub type Hash = String;

/// A DEX identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Dex {
    UniswapV2,
    UniswapV3,
    UniswapV4,
    Curve,
    Balancer,
    Aerodrome,
    Velodrome,
    Camelot,
    Maverick,
    /// Fallback for venues not yet modeled in detail.
    Other,
}

impl Dex {
    pub fn as_str(self) -> &'static str {
        match self {
            Dex::UniswapV2 => "uniswap-v2",
            Dex::UniswapV3 => "uniswap-v3",
            Dex::UniswapV4 => "uniswap-v4",
            Dex::Curve => "curve",
            Dex::Balancer => "balancer",
            Dex::Aerodrome => "aerodrome",
            Dex::Velodrome => "velodrome",
            Dex::Camelot => "camelot",
            Dex::Maverick => "maverick",
            Dex::Other => "other",
        }
    }
}

/// How a pool prices swaps — selects which math function applies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PoolKind {
    /// x*y=k constant product (Uniswap V2, Aerodrome volatile, ...).
    V2,
    /// Concentated liquidity with ticks (Uniswap V3).
    V3,
    /// StableSwap invariant (Curve stable pools).
    Stable,
    /// Weighted geometric invariant (Balancer weighted pools).
    Weighted,
}

// ---------------------------------------------------------------------------
// Pool references & routes
// ---------------------------------------------------------------------------

/// A reference to a liquidity venue. Hot path keeps only what the math needs;
/// full reserves/ticks are fetched/simulated separately.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PoolRef {
    pub chain_id: u32,
    pub address: Address,
    pub dex: Dex,
    pub kind: PoolKind,
    pub token0: Address,
    pub token1: Address,
    /// Fee in basis points (e.g. 30 = 0.30% for V2, 5 = 0.05% for V3 0.05%).
    pub fee_bps: u32,
    /// V3 tick spacing (ignored for V2).
    #[serde(default)]
    pub tick_spacing: u32,
    /// Auxiliary data (weights for Balancer, A for Curve, ...).
    #[serde(default)]
    pub extra: serde_json::Value,
}

/// One leg of a route.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hop {
    pub pool: PoolRef,
    pub token_in: Address,
    pub token_out: Address,
    /// True if swapping token1->token0 (used to orient reserves / ticks).
    pub zero_for_one: bool,
}

/// A complete execution path between two endpoints (possibly cyclic).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Route {
    pub hops: Vec<Hop>,
}

impl Route {
    pub fn entry_token(&self) -> Option<&Address> {
        self.hops.first().map(|h| &h.token_in)
    }
    pub fn is_cyclic(&self) -> bool {
        match (self.hops.first(), self.hops.last()) {
            (Some(a), Some(b)) => a.token_in == b.token_out,
            _ => false,
        }
    }
    /// True if the route is a cycle whose intermediate tokens are all distinct
    /// (only start==end repeats). Used to filter pseudo-cycles from graph
    /// search that arose by relaxing reverse edges.
    pub fn is_simple_cycle(&self) -> bool {
        if !self.is_cyclic() || self.hops.is_empty() {
            return false;
        }
        // In a simple cycle the sequence of visited tokens is
        //   start = hop[0].in -> hop[0].out -> hop[1].out -> ... -> hop[last].out = start
        // i.e. each hop's token_out is the next token, and start repeats only at the end.
        let mut seen: std::collections::HashSet<&Address> = std::collections::HashSet::new();
        // First hop's token_in is start; record it once.
        seen.insert(&self.hops[0].token_in);
        for (i, hop) in self.hops.iter().enumerate() {
            let is_closing = i == self.hops.len() - 1;
            // Each intermediate token_out must be new; the closing token_out
            // must equal start (already seen) which is allowed.
            if is_closing {
                if hop.token_out != self.hops[0].token_in {
                    return false;
                }
            } else if !seen.insert(&hop.token_out) {
                return false;
            }
        }
        true
    }
    pub fn hop_count(&self) -> usize {
        self.hops.len()
    }
}

// ---------------------------------------------------------------------------
// Strategy model metadata
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CapitalMode {
    FlashLoan,
    VaultCapital,
    Inventory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskClass {
    Low,
    Medium,
    High,
    Experimental,
}

/// Lightweight descriptor; the actual model logic lives in TS strategy-models
/// (or in backtest as a Rust impl). This struct is for the registry / UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyDescriptor {
    pub id: String,
    pub name: String,
    pub version: String,
    pub supported_chains: Vec<u32>,
    pub supported_assets: Vec<Address>,
    pub capital_mode: CapitalMode,
    pub risk_class: RiskClass,
}

// ---------------------------------------------------------------------------
// Market context, opportunities, quotes, plans, simulation, score
// ---------------------------------------------------------------------------

/// Snapshot handed to `discover`. The worker fills in chain + block + a
/// pool-state provider handle. Backtest fills the same struct per block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketContext {
    pub chain_id: u32,
    pub block_number: u64,
    pub block_timestamp: u64,
    /// Assets the model is allowed to trade this run.
    pub assets: Vec<Address>,
    /// Pools in scope (whitelisted).
    pub pools: Vec<PoolRef>,
}

bitflags::bitflags! {
    /// Per-opportunity risk annotations surfaced by the model.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct RiskFlags: u16 {
        const NONE            = 0;
        const LONG_TAIL_TOKEN = 1 << 0;
        const THIN_LIQUIDITY  = 1 << 1;
        const FEE_ON_TRANSFER = 1 << 2;
        const REBASING        = 1 << 3;
        const BLACKLISTABLE   = 1 << 4;
        const HIGH_SLIPPAGE   = 1 << 5;
        const STALE_STATE     = 1 << 6;
    }
}

/// A candidate trade discovered by a model. Contains *estimates*; precise
/// pricing happens in `quote`, exact execution in `simulate`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Opportunity {
    pub id: String,
    pub strategy_id: String,
    pub chain_id: u32,
    pub block_number: u64,
    pub asset_in: Address,
    pub capital_required: Amount,
    pub expected_profit: Amount,
    pub expected_gas: u64,
    pub expected_bribe: Amount,
    pub net_profit: Amount,
    pub route: Route,
    pub confidence: f64,
    pub ttl_blocks: u32,
    pub risk_flags: RiskFlags,
    pub status: OpportunityStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpportunityStatus {
    Discovered,
    Quoted,
    Simulated,
    Approved,
    Rejected,
    Expired,
    Executed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CapitalSource {
    VaultCapital,
    FlashLoanAave,
    FlashLoanBalancer,
    FlashSwapUniswapV2,
    FlashSwapUniswapV3,
}

/// Precise pricing for a given opportunity + capital size.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quote {
    pub amount_in: Amount,
    pub amount_out: Amount,
    pub min_amount_out: Amount,
    pub price_impact_bps: i64,
    pub liquidity_used: Amount,
    pub gas: u64,
    pub cost_breakdown: CostBreakdown,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct CostBreakdown {
    pub gas: Amount,
    pub bribe: Amount,
    pub fee: Amount,
}

/// Where capital comes from for this execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capital {
    pub source: CapitalSource,
    pub amount: Amount,
    pub premium: Amount,
}

/// A fully-specified, executable plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionPlan {
    pub opportunity_id: String,
    pub chain_id: u32,
    pub route: Route,
    pub capital: Capital,
    pub min_profit_assets: Amount,
    pub deadline: u64,
    pub max_gas_cost: Amount,
}

/// Result of simulating an [`ExecutionPlan`] on a fork.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationResult {
    pub success: bool,
    pub chain_id: u32,
    pub block_number: u64,
    pub gas_used: u64,
    /// Per-token balance delta of the executor (profit/loss view).
    pub balance_deltas: Vec<BalanceDelta>,
    pub net_profit: Amount,
    pub failure_reason: Option<String>,
    pub trace_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BalanceDelta {
    pub token: Address,
    pub delta: Amount, // signedness encoded by sign below
    pub positive: bool,
}

/// Model-assigned score used for ranking + admission gating.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct StrategyScore {
    pub net_profit: Amount,
    pub score: f64,           // 0..1
    pub confidence: f64,      // 0..1
    pub capacity_fit: f64,    // 0..1
    pub risk_adjusted_return: f64,
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

/// A simple request to build the on-chain calldata (kept abstract in core so we
/// don't depend on alloy here).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionRequest {
    pub chain_id: u32,
    pub to: Address,
    pub data: Vec<u8>,
    pub value: Amount,
    pub gas_limit: u64,
    pub max_fee_per_gas: Amount,
    pub max_priority_fee_per_gas: Amount,
}

impl DecimalAmount {
    /// Render as a human-readable string for logs/UI.
    pub fn human_string(&self) -> String {
        let s = self.value.to_string();
        let decimals = self.decimals as usize;
        if s.len() <= decimals {
            let zeros = decimals - s.len();
            return format!("0.{}{}", "0".repeat(zeros), s);
        }
        let split = s.len() - decimals;
        format!("{}.{}", &s[..split], &s[split..])
    }
}

/// Build a [`Uint`] from a decimal string (the format used by all JSON over
/// the wire). Returns None on parse failure.
pub fn amount_from_dec_str(s: &str) -> Option<Amount> {
    if s.is_empty() {
        return Some(Uint::ZERO);
    }
    // Uint::from_str_radix expects pure digits; strip any leading '+'.
    let s = s.trim_start_matches('+');
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Uint::from_str_radix(s, 10).ok()
}

/// Convenience: 1 unit of an asset at given decimals.
pub fn one_unit(decimals: u8) -> Amount {
    Uint::ten_pow(decimals as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_cyclic_detection() {
        let t = "0xa";
        let hop = |pool: &str, out: &str| Hop {
            pool: PoolRef {
                chain_id: 1,
                address: pool.into(),
                dex: Dex::UniswapV2,
                kind: PoolKind::V2,
                token0: t.into(),
                token1: out.into(),
                fee_bps: 30,
                tick_spacing: 0,
                extra: serde_json::Value::Null,
            },
            token_in: t.into(),
            token_out: out.into(),
            zero_for_one: true,
        };
        let p = "0xp";
        // a -> b -> a is cyclic
        let cyclic = Route {
            hops: vec![hop(p, "0xb"), hop(p, t)],
        };
        assert!(cyclic.is_cyclic());
        assert_eq!(cyclic.hop_count(), 2);

        let open = Route {
            hops: vec![hop(p, "0xb")],
        };
        assert!(!open.is_cyclic());
    }

    #[test]
    fn amount_parse_roundtrip() {
        let v = amount_from_dec_str("1000000000000000000").unwrap();
        assert_eq!(v, Uint::ten_pow(18));
        assert_eq!(amount_from_dec_str(""), Some(Uint::ZERO));
        assert!(amount_from_dec_str("0x1").is_none());
    }

    #[test]
    fn human_string_rendering() {
        let a = DecimalAmount {
            value: Uint::from(1_500_000u64),
            decimals: 6,
        };
        assert_eq!(a.human_string(), "1.500000");
        let b = DecimalAmount {
            value: Uint::from(5u64),
            decimals: 6,
        };
        assert_eq!(b.human_string(), "0.000005");
    }
}
