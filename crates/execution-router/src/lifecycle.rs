//! Execution lifecycle: submitted -> pending -> included/expired.
//!
//! Tracks a transaction from the moment it's handed to a relay until it's
//! confirmed on-chain or expires. The live worker drives the state machine
//! by polling the chain; this module owns the state transitions + expiry.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TxState {
    Submitted,
    Pending,
    Confirmed,
    Failed,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxLifecycle {
    pub state: TxState,
    pub submitted_at: DateTime<Utc>,
    pub last_state_change: DateTime<Utc>,
    pub attempts: u32,
}

impl TxLifecycle {
    pub fn new(now: DateTime<Utc>) -> Self {
        Self {
            state: TxState::Submitted,
            submitted_at: now,
            last_state_change: now,
            attempts: 1,
        }
    }

    pub fn transition(&mut self, next: TxState, now: DateTime<Utc>) {
        self.state = next;
        self.last_state_change = now;
        if matches!(next, TxState::Submitted) {
            self.attempts += 1;
        }
    }

    /// True if the tx has been outstanding longer than `ttl` without confirmation.
    pub fn is_expired(&self, now: DateTime<Utc>, ttl: Duration) -> bool {
        !matches!(self.state, TxState::Confirmed | TxState::Failed | TxState::Expired)
            && (now - self.submitted_at).num_seconds() as u64 > ttl.as_secs()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn t(seconds_after_epoch_start: i64) -> DateTime<Utc> {
        // Use a fixed base + Duration to avoid DST/leap ambiguity in
        // with_ymd_and_hms. seconds_after_epoch_start is relative to the base.
        let base = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        base + chrono::Duration::seconds(seconds_after_epoch_start)
    }

    #[test]
    fn lifecycle_transitions() {
        let mut l = TxLifecycle::new(t(0));
        assert_eq!(l.state, TxState::Submitted);
        l.transition(TxState::Pending, t(1));
        assert_eq!(l.state, TxState::Pending);
        l.transition(TxState::Confirmed, t(5));
        assert_eq!(l.state, TxState::Confirmed);
        assert!(!l.is_expired(t(100), Duration::from_secs(10)));
    }

    #[test]
    fn expiry_detected() {
        let l = TxLifecycle::new(t(0));
        // submitted at t=0, ttl 10s
        assert!(!l.is_expired(t(5), Duration::from_secs(10)));
        assert!(l.is_expired(t(20), Duration::from_secs(10)));
    }
}
