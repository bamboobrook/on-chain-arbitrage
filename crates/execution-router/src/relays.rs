//! Private relay multiplexing.
//!
//! Abstraction over Flashbots / Beaverbuild / Titan / RPC submission. The
//! router fans out a signed tx (or bundle) to multiple relays and accepts
//! the first inclusion. For MVP we define the data model and a no-op
//! in-memory relay used by the Anvil demo; real relay HTTP clients are
//! wired in the workers package (TypeScript side) and via alloy on the Rust
//! side when live keys are present.

use serde::{Deserialize, Serialize};
use strategy_core::types::Hash;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bundle {
    pub chain_id: u32,
    /// Signed raw transactions (hex, 0x-prefixed).
    pub txs: Vec<String>,
    pub target_block: u64,
    pub max_block: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmissionResult {
    pub relay: RelayKind,
    pub accepted: bool,
    pub tx_hash: Option<Hash>,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RelayKind {
    Flashbots,
    Beaverbuild,
    Titan,
    Rpc,
    Demo,
}

/// A relay endpoint.
pub trait Relay: Send + Sync {
    fn kind(&self) -> RelayKind;
    fn submit_bundle(&self, bundle: &Bundle) -> SubmissionResult;
    fn latency(&self) -> Duration;
}

/// In-memory demo relay: always "accepts" and returns a synthetic hash.
/// Used by the Anvil demo flow so the execution path can be exercised
/// end-to-end without real builder credentials.
pub struct DemoRelay;

impl Relay for DemoRelay {
    fn kind(&self) -> RelayKind {
        RelayKind::Demo
    }
    fn submit_bundle(&self, bundle: &Bundle) -> SubmissionResult {
        let hash = bundle
            .txs
            .first()
            .map(|t| format!("0x{}", &sha_prefix(t)))
            .unwrap_or_else(|| "0x0".into());
        SubmissionResult {
            relay: RelayKind::Demo,
            accepted: true,
            tx_hash: Some(hash),
            message: "demo relay accepted".into(),
        }
    }
    fn latency(&self) -> Duration {
        Duration::from_millis(5)
    }
}

fn sha_prefix(s: &str) -> String {
    // Lightweight deterministic 8-hex prefix (not cryptographic; demo only).
    let mut acc: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        acc = (acc ^ (b as u64)).wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", acc)
}

/// Multiplexer: submits to all relays and returns the first acceptance.
pub struct RelayMultiplexer {
    pub relays: Vec<Box<dyn Relay>>,
}

impl RelayMultiplexer {
    pub fn submit(&self, bundle: &Bundle) -> SubmissionResult {
        for r in &self.relays {
            let res = r.submit_bundle(bundle);
            if res.accepted {
                return res;
            }
        }
        SubmissionResult {
            relay: RelayKind::Rpc,
            accepted: false,
            tx_hash: None,
            message: "all relays rejected".into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn demo_relay_accepts() {
        let r = DemoRelay;
        let b = Bundle {
            chain_id: 31337,
            txs: vec!["0x1234".into()],
            target_block: 1,
            max_block: 3,
        };
        let res = r.submit_bundle(&b);
        assert!(res.accepted);
        assert!(res.tx_hash.unwrap().starts_with("0x"));
    }

    #[test]
    fn multiplexer_returns_first_acceptance() {
        let m = RelayMultiplexer {
            relays: vec![Box::new(DemoRelay)],
        };
        let b = Bundle { chain_id: 1, txs: vec!["0x9".into()], target_block: 1, max_block: 2 };
        assert!(m.submit(&b).accepted);
    }
}
