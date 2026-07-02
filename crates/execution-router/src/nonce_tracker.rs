//! Nonce management for the executor EOA.
//!
//! Tracks pending nonce in-memory and reconciles with the chain. For MVP we
//! expose a simple monotonic counter with manual reconciliation; the live
//! worker wraps this with chain `eth_getTransactionCount` polling.

use parking_lot::Mutex;
use strategy_core::types::Address;

#[derive(Debug)]
pub struct NonceTracker {
    addr: Address,
    pending: Mutex<u64>,
}

impl NonceTracker {
    pub fn new(addr: Address, current_nonce: u64) -> Self {
        Self {
            addr,
            pending: Mutex::new(current_nonce),
        }
    }

    /// Reserve the next nonce for an outgoing tx.
    pub fn next(&self) -> u64 {
        let mut p = self.pending.lock();
        let n = *p;
        *p += 1;
        n
    }

    /// Reconcile with the chain's confirmed nonce (called periodically).
    pub fn reconcile(&self, chain_nonce: u64) {
        let mut p = self.pending.lock();
        // Local pending should never be below the confirmed chain nonce.
        if *p < chain_nonce {
            *p = chain_nonce;
        }
    }

    pub fn address(&self) -> &Address {
        &self.addr
    }

    pub fn pending(&self) -> u64 {
        *self.pending.lock()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nonce_monotonic() {
        let t = NonceTracker::new("0x1".into(), 5);
        assert_eq!(t.next(), 5);
        assert_eq!(t.next(), 6);
        assert_eq!(t.pending(), 7);
    }

    #[test]
    fn reconcile_raises_low() {
        let t = NonceTracker::new("0x1".into(), 3);
        t.reconcile(10);
        assert_eq!(t.pending(), 10);
        // reconcile with lower does nothing
        t.reconcile(5);
        assert_eq!(t.pending(), 10);
    }
}
