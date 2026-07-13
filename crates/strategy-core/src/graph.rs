//! Cyclic-arbitrage graph search.
//!
//! Models every whitelisted pool as two directed edges (token0->token1 and
//! token1->token0). Edge weight = `-log(effective_rate)` so a profitable
//! cycle has *negative* total weight. A modified Bellman-Ford detects
//! negative cycles (== positive-return arbitrage).
//!
//! This is the *coarse filter* from the design doc ("粗筛→精确模拟"): we keep
//! the exact quoting in [`crate::dex`] and the revm validation in the
//! backtest engine. The graph returns candidate cycles; the caller then
//! re-prices them precisely before simulation.

use crate::types::{Address, Hop, PoolRef, Route};
use crate::uint_ext::Uint;
use std::collections::HashMap;

/// An edge in the token graph: from `from` to `to` via `pool`, with weight
/// `-log(effective_rate)`.
#[derive(Debug, Clone)]
pub struct Edge {
    pub from: Address,
    pub to: Address,
    pub pool: PoolRef,
    pub weight: f64, // -ln(rate)
}

/// The token graph built from whitelisted pools.
#[derive(Debug, Clone, Default)]
pub struct TokenGraph {
    /// adjacency: token -> Vec<Edge>
    pub adj: HashMap<Address, Vec<Edge>>,
    pub nodes: Vec<Address>,
}

impl TokenGraph {
    pub fn new() -> Self {
        Self::default()
    }

    /// Insert a pool as two directed edges (one per direction).
    pub fn add_pool(&mut self, pool: &PoolRef, rate01: f64, rate10: f64) {
        self.ensure_node(&pool.token0);
        self.ensure_node(&pool.token1);
        // rate = amount_out per amount_in (gross of fee). weight = -ln(rate).
        self.adj.entry(pool.token0.clone()).or_default().push(Edge {
            from: pool.token0.clone(),
            to: pool.token1.clone(),
            pool: pool.clone(),
            weight: -rate01.ln(),
        });
        self.adj.entry(pool.token1.clone()).or_default().push(Edge {
            from: pool.token1.clone(),
            to: pool.token0.clone(),
            pool: pool.clone(),
            weight: -rate10.ln(),
        });
    }

    fn ensure_node(&mut self, addr: &Address) {
        if !self.adj.contains_key(addr) {
            self.nodes.push(addr.clone());
            self.adj.insert(addr.clone(), Vec::new());
        }
    }

    /// Search for profitable cycles starting (and ending) at `start`, up to
    /// `max_hops` long, returning cycles whose total weight is below
    /// `-min_log_profit` (i.e. profit > exp(min_log_profit)).
    ///
    /// Uses a depth-limited Bellman-Ford-style relaxation seeded at `start`,
    /// tracking the predecessor chain to reconstruct cycles. Returns at most
    /// `max_results` cycles sorted by profitability.
    pub fn find_cycles(
        &self,
        start: &Address,
        max_hops: usize,
        min_log_profit: f64,
        max_results: usize,
    ) -> Vec<Cycle> {
        // dist[token] = best (lowest) weight to reach `token` from `start`.
        let mut dist: HashMap<Address, f64> = HashMap::new();
        let mut prev: HashMap<Address, Option<(Address, PoolRef)>> = HashMap::new();
        for n in &self.nodes {
            dist.insert(n.clone(), f64::INFINITY);
            prev.insert(n.clone(), None);
        }
        dist.insert(start.clone(), 0.0);

        // Relax up to max_hops times (path length bounded).
        for _ in 0..max_hops {
            let mut changed = false;
            for from in &self.nodes {
                let d_from = *dist.get(from).unwrap_or(&f64::INFINITY);
                if d_from == f64::INFINITY {
                    continue;
                }
                if let Some(edges) = self.adj.get(from) {
                    for e in edges {
                        let nd = d_from + e.weight;
                        if nd < *dist.get(&e.to).unwrap_or(&f64::INFINITY) {
                            dist.insert(e.to.clone(), nd);
                            prev.insert(e.to.clone(), Some((from.clone(), e.pool.clone())));
                            changed = true;
                        }
                    }
                }
            }
            if !changed {
                break;
            }
        }

        // Detect a closing edge back to `start` that yields a negative cycle.
        let mut cycles: Vec<Cycle> = Vec::new();
        if let Some(_edges) = self.adj.get(start) {
            // For each token t reachable with dist[t], if there's an edge t->start
            // and dist[t] + w < -min_log_profit, we have a profitable cycle.
            for (token, d) in &dist {
                if !d.is_finite() || token == start {
                    continue;
                }
                if let Some(t_edges) = self.adj.get(token) {
                    for e in t_edges {
                        if &e.to != start {
                            continue;
                        }
                        let total = d + e.weight;
                        if total < -min_log_profit {
                            // reconstruct path start -> ... -> token using `prev`,
                            // then append the closing edge token -> start.
                            let rec = self.reconstruct(start, token, &prev, &e.pool);
                            if let Some(route) = rec {
                                // Only keep *simple* cycles (no repeated token
                                // besides start==end). This filters out pseudo
                                // cycles formed by relaxing a reverse edge.
                                if route.is_simple_cycle() {
                                    cycles.push(Cycle {
                                        route,
                                        log_profit: -total,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        // Dedup by hop signature and sort by descending log profit.
        cycles.sort_by(|a, b| {
            b.log_profit
                .partial_cmp(&a.log_profit)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let mut seen: Vec<String> = Vec::new();
        let mut out: Vec<Cycle> = Vec::new();
        for c in cycles {
            let sig = c
                .route
                .hops
                .iter()
                .map(|h| h.pool.address.clone())
                .collect::<Vec<_>>()
                .join(">");
            if seen.contains(&sig) {
                continue;
            }
            seen.push(sig);
            out.push(c);
            if out.len() >= max_results {
                break;
            }
        }
        out
    }

    fn reconstruct(
        &self,
        start: &Address,
        end: &Address,
        prev: &HashMap<Address, Option<(Address, PoolRef)>>,
        closing_pool: &PoolRef,
    ) -> Option<Route> {
        // Walk back from `end` to `start` via `prev`. Each step records the
        // edge (from, pool) that reaches the current node, i.e. prev[node] =
        // (predecessor, pool_on_edge_predecessor->node).
        // We collect nodes in reverse: [end, ..., start], then reverse to get
        // the forward token sequence [start, ..., end].
        let mut nodes_rev: Vec<Address> = Vec::new();
        let mut edges_rev: Vec<PoolRef> = Vec::new();
        let mut cur = end.clone();
        let mut guard = 0usize;
        while &cur != start {
            nodes_rev.push(cur.clone());
            let (from, pool) = prev.get(&cur)?.as_ref()?;
            edges_rev.push(pool.clone());
            cur = from.clone();
            guard += 1;
            if guard > 16 {
                return None;
            }
        }
        nodes_rev.push(start.clone());

        // Forward: [start, ..., end]; edges align so edge[i] connects node[i] -> node[i+1].
        let mut nodes: Vec<Address> = nodes_rev.into_iter().rev().collect();
        let edges: Vec<PoolRef> = edges_rev.into_iter().rev().collect();

        // Build hops for each forward edge.
        let mut hops: Vec<Hop> = Vec::new();
        for i in 0..edges.len() {
            let pool = &edges[i];
            let token_in = nodes[i].clone();
            let zero_for_one = pool.token0 == token_in;
            let token_out = if zero_for_one {
                pool.token1.clone()
            } else {
                pool.token0.clone()
            };
            hops.push(Hop {
                pool: pool.clone(),
                token_in,
                token_out,
                zero_for_one,
            });
        }

        // Closing hop: end -> start via closing_pool.
        let zero_for_one = closing_pool.token0 == *end;
        let token_in = end.clone();
        let token_out = if zero_for_one {
            closing_pool.token1.clone()
        } else {
            closing_pool.token0.clone()
        };
        let _ = token_out.clone();
        hops.push(Hop {
            pool: closing_pool.clone(),
            token_in,
            token_out: if zero_for_one {
                closing_pool.token1.clone()
            } else {
                closing_pool.token0.clone()
            },
            zero_for_one,
        });

        let _ = nodes.pop(); // drop the duplicate `end` tail reference if any
        Some(Route { hops })
    }
}

/// A detected profitable cycle.
#[derive(Debug, Clone)]
pub struct Cycle {
    pub route: Route,
    /// Natural log of the gross profit multiplier (e.g. 0.01 ≈ 1% gross).
    pub log_profit: f64,
}

impl Cycle {
    /// Gross profit ratio (1.01 = +1%).
    pub fn profit_ratio(&self) -> f64 {
        self.log_profit.exp()
    }
}

// ruint is unused directly in this module after refactor; keep the import path
// consistent with the rest of the crate for downstream callers.
#[allow(dead_code)]
fn _uint_anchor() -> Uint {
    Uint::ZERO
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Dex, PoolKind};

    fn pool(addr: &str, t0: &str, t1: &str) -> PoolRef {
        PoolRef {
            chain_id: 1,
            address: addr.into(),
            dex: Dex::UniswapV2,
            kind: PoolKind::V2,
            token0: t0.into(),
            token1: t1.into(),
            fee_bps: 30,
            tick_spacing: 0,
            extra: serde_json::Value::Null,
        }
    }

    #[test]
    fn detects_profitable_triangle() {
        // Triangle A->B->C->A where the product of rates > 1.
        let mut g = TokenGraph::new();
        let p_ab = pool("0xab", "0xA", "0xB");
        let p_bc = pool("0xbc", "0xB", "0xC");
        let p_ca = pool("0xca", "0xC", "0xA");
        // rates: A->B 1.01, B->C 1.0, C->A 1.0 => product 1.01 (profit)
        g.add_pool(&p_ab, 1.01, 1.0 / 1.01);
        g.add_pool(&p_bc, 1.0, 1.0);
        g.add_pool(&p_ca, 1.0, 1.0);

        let cycles = g.find_cycles(&"0xA".to_string(), 4, 0.001, 5);
        assert!(!cycles.is_empty(), "should detect the profitable triangle");
        let c = &cycles[0];
        assert!(c.profit_ratio() > 1.0);
        assert!(c.route.is_cyclic());
    }

    #[test]
    fn no_cycle_when_unprofitable() {
        // A perfectly balanced market: every direction rates at 1.0 (net of
        // fees, i.e. no edge offers any surplus). No cycle can be profitable
        // because every cycle's total weight is 0 (>= -min_log_profit).
        let mut g = TokenGraph::new();
        let p_ab = pool("0xab", "0xA", "0xB");
        let p_bc = pool("0xbc", "0xB", "0xC");
        let p_ca = pool("0xca", "0xC", "0xA");
        g.add_pool(&p_ab, 1.0, 1.0);
        g.add_pool(&p_bc, 1.0, 1.0);
        g.add_pool(&p_ca, 1.0, 1.0);
        let cycles = g.find_cycles(&"0xA".to_string(), 4, 0.001, 5);
        assert!(cycles.is_empty());
    }
}
