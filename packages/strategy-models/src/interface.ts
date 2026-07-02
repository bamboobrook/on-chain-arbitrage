/**
 * @oal/strategy-models — the StrategyModel plugin interface and concrete models.
 *
 * Mirrors docs/model-interface.md and the Rust types in strategy-core. Each
 * model plugs into backtest, simulation and live execution through one
 * interface. Heavy math (DEX quoting, graph search) is delegated to the Rust
 * cores via the API gateway; this TS layer orchestrates.
 */

import type {
  CapitalMode,
  ExecutionPlan,
  MarketContext,
  Opportunity,
  Quote,
  RiskClass,
  SimulationResult,
  StrategyScore,
} from '@oal/sdk';

export interface StrategyModel {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly supportedChains: number[];
  readonly supportedAssets: `0x${string}`[];
  readonly capitalMode: CapitalMode;
  readonly riskClass: RiskClass;

  /** Scan the market and emit candidate opportunities. */
  discover(ctx: MarketContext): Promise<Opportunity[]>;
  /** Price an opportunity precisely for a given capital size. */
  quote(input: Opportunity, capital: bigint): Promise<Quote>;
  /** Simulate a full execution plan (delegates to revm/Anvil via the API). */
  simulate(input: ExecutionPlan): Promise<SimulationResult>;
  /** Build the on-chain transaction request for an approved plan. */
  buildTx(input: ExecutionPlan): Promise<{ to: string; data: `0x${string}`; value: bigint }>;
  /** Score a simulation result. */
  score(result: SimulationResult): StrategyScore;
}

/** Base class wiring common helpers. */
export abstract class BaseStrategyModel implements StrategyModel {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly supportedChains: number[];
  abstract readonly supportedAssets: `0x${string}`[];
  abstract readonly capitalMode: CapitalMode;
  abstract readonly riskClass: RiskClass;

  abstract discover(ctx: MarketContext): Promise<Opportunity[]>;

  async quote(_input: Opportunity, _capital: bigint): Promise<Quote> {
    // Default no-op; concrete models override. Real quoting runs in Rust.
    throw new Error(`${this.id}.quote: not implemented (delegate to Rust cores via API)`);
  }

  async simulate(input: ExecutionPlan): Promise<SimulationResult> {
    // In MVP the simulation worker calls the Rust backtest-engine / a local
    // Anvil fork. Here we return a placeholder that the worker replaces.
    return {
      success: false,
      chainId: input.chainId,
      blockNumber: 0,
      gasUsed: 0,
      balanceDeltas: [],
      netProfit: '0',
      failureReason: 'simulate() must be delegated to the simulation worker (revm/Anvil)',
    };
  }

  async buildTx(input: ExecutionPlan): Promise<{ to: string; data: `0x${string}`; value: bigint }> {
    // Demo encoder: selector + JSON payload, decoded by the demo executor.
    const selector = '0xdec86128';
    const json = JSON.stringify(input);
    const hex = Buffer.from(json).toString('hex');
    const len = input.opportunityId.length.toString(16).padStart(8, '0');
    return { to: '0x0000000000000000000000000000000000000000', data: `${selector}${len}${hex}` as `0x${string}`, value: 0n };
  }

  score(result: SimulationResult): StrategyScore {
    const profit = BigInt(result.netProfit || '0');
    return {
      netProfit: result.netProfit,
      score: result.success ? Math.min(1, Number(profit) / 1e18) : 0,
      confidence: result.success ? 0.8 : 0,
      capacityFit: 0.5,
      riskAdjustedReturn: 0,
    };
  }
}
