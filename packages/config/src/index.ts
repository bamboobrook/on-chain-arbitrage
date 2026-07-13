/**
 * @oal/config — chain, asset and DEX-pool metadata for the MVP.
 *
 * Addresses are real mainnet contracts where known. Always verify on a block
 * explorer before any live use. Local Anvil (31337) entries use placeholder
 * addresses filled in at deploy time.
 */

export type Address = `0x${string}`;

export interface ChainConfig {
  chainId: number;
  name: string;
  shortName: string;
  /** Env var name holding the archive RPC endpoint. */
  rpcEnvVar: string;
  currency: string;
  explorerUrl: string;
  isActive: boolean;
  /** Approx blocks per year at current block time (12s = ~2_629_800). */
  blocksPerYear: number;
}

export interface AssetConfig {
  chainId: number;
  address: Address;
  symbol: string;
  decimals: number;
}

export type DexId =
  | 'uniswap-v2'
  | 'uniswap-v3'
  | 'uniswap-v4'
  | 'curve'
  | 'balancer'
  | 'aerodrome'
  | 'velodrome'
  | 'camelot'
  | 'maverick'
  | 'other';

export type PoolKind = 'v2' | 'v3' | 'stable' | 'weighted';

export interface PoolConfig {
  chainId: number;
  address: Address;
  dex: DexId;
  kind: PoolKind;
  token0: Address;
  token1: Address;
  /** Fee in basis points (30 = 0.30%). */
  feeBps: number;
  /** V3 tick spacing (0 for non-V3). */
  tickSpacing?: number;
  extra?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

export const CHAINS: ChainConfig[] = [
  {
    chainId: 1,
    name: 'Ethereum',
    shortName: 'ethereum',
    rpcEnvVar: 'RPC_ETHEREUM_URL',
    currency: 'ETH',
    explorerUrl: 'https://etherscan.io',
    isActive: true,
    blocksPerYear: 2_629_800,
  },
  {
    chainId: 8453,
    name: 'Base',
    shortName: 'base',
    rpcEnvVar: 'RPC_BASE_URL',
    currency: 'ETH',
    explorerUrl: 'https://basescan.org',
    isActive: true,
    blocksPerYear: 2_629_800,
  },
  {
    chainId: 42161,
    name: 'Arbitrum',
    shortName: 'arbitrum',
    rpcEnvVar: 'RPC_ARBITRUM_URL',
    currency: 'ETH',
    explorerUrl: 'https://arbiscan.io',
    isActive: true,
    blocksPerYear: 2_629_800,
  },
  {
    chainId: 10,
    name: 'Optimism',
    shortName: 'optimism',
    rpcEnvVar: 'RPC_OPTIMISM_URL',
    currency: 'ETH',
    explorerUrl: 'https://optimistic.etherscan.io',
    isActive: false,
    blocksPerYear: 15_768_000,
  },
  {
    chainId: 137,
    name: 'Polygon',
    shortName: 'polygon',
    rpcEnvVar: 'RPC_POLYGON_URL',
    currency: 'POL',
    explorerUrl: 'https://polygonscan.com',
    isActive: false,
    blocksPerYear: 15_768_000,
  },
  {
    chainId: 31337,
    name: 'Anvil Local',
    shortName: 'anvil',
    rpcEnvVar: 'RPC_LOCAL_URL',
    currency: 'ETH',
    explorerUrl: '',
    isActive: true,
    blocksPerYear: 2_629_800,
  },
];

export const CHAIN_BY_ID: Record<number, ChainConfig> = Object.fromEntries(
  CHAINS.map((c) => [c.chainId, c]),
);

// ---------------------------------------------------------------------------
// Assets (USDC + WETH on each active chain)
// ---------------------------------------------------------------------------

export const ASSETS: AssetConfig[] = [
  // Ethereum
  { chainId: 1, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
  { chainId: 1, address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18 },
  { chainId: 1, address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', decimals: 8 },
  // Base
  { chainId: 8453, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
  { chainId: 8453, address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18 },
  { chainId: 8453, address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', symbol: 'cbBTC', decimals: 8 },
  // Arbitrum
  { chainId: 42161, address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6 },
  { chainId: 42161, address: '0x82aF49447D8a07e3bd95BD0d56f35241523Fbab1', symbol: 'WETH', decimals: 18 },
  // Anvil placeholders (set at deploy time)
  { chainId: 31337, address: '0x0000000000000000000000000000000000000001', symbol: 'USDC', decimals: 6 },
  { chainId: 31337, address: '0x0000000000000000000000000000000000000002', symbol: 'WETH', decimals: 18 },
];

export function assetBySymbol(chainId: number, symbol: string): AssetConfig | undefined {
  return ASSETS.find((a) => a.chainId === chainId && a.symbol === symbol.toUpperCase());
}

// ---------------------------------------------------------------------------
// Canonical pools (verify on explorer before live use)
// ---------------------------------------------------------------------------

export const POOLS: PoolConfig[] = [
  // Base — Uniswap V3 USDC/WETH 0.05%
  {
    chainId: 8453,
    address: '0x88a43BbDF9f09DEaD17eBf261397eb8D3461c7d4',
    dex: 'uniswap-v3',
    kind: 'v3',
    token0: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    token1: '0x4200000000000000000000000000000000000006',
    feeBps: 5,
    tickSpacing: 10,
  },
  // Arbitrum — Uniswap V3 USDC/WETH 0.05%
  {
    chainId: 42161,
    address: '0xC6962004f452bE9eE35B0F64Bc8B75386e3A21d7',
    dex: 'uniswap-v3',
    kind: 'v3',
    token0: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    token1: '0x82aF49447D8a07e3bd95BD0d56f35241523Fbab1',
    feeBps: 5,
    tickSpacing: 10,
  },
];

export function poolsForChain(chainId: number): PoolConfig[] {
  return POOLS.filter((p) => p.chainId === chainId);
}

// ---------------------------------------------------------------------------
// Strategy registry (mirrors the DB seed)
// ---------------------------------------------------------------------------

export type RiskClass = 'low' | 'medium' | 'high' | 'experimental';
export type CapitalMode = 'flash-loan' | 'vault-capital' | 'inventory';

export interface StrategyConfig {
  id: string;
  name: string;
  version: string;
  modelType: string;
  riskClass: RiskClass;
  status: 'active' | 'paused' | 'retired';
  capitalMode: CapitalMode;
  supportedChains: number[];
  supportedAssets: string[];
  phase: 1 | 2 | 3;
}

export const STRATEGIES: StrategyConfig[] = [
  {
    id: 'atomic-amm',
    name: 'Atomic AMM Arbitrage',
    version: '1.0.0',
    modelType: 'atomic-amm',
    riskClass: 'medium',
    status: 'active',
    capitalMode: 'flash-loan',
    supportedChains: [8453, 42161],
    supportedAssets: ['USDC', 'WETH'],
    phase: 1,
  },
  {
    id: 'mev-backrun',
    name: 'MEV-Share Backrun',
    version: '1.0.0',
    modelType: 'mev-backrun',
    riskClass: 'medium',
    status: 'active',
    capitalMode: 'flash-loan',
    supportedChains: [8453, 42161],
    supportedAssets: ['USDC', 'WETH'],
    phase: 1,
  },
  {
    id: 'peg-lst',
    name: 'Peg / LST / Stable',
    version: '1.0.0',
    modelType: 'peg-lst',
    riskClass: 'medium',
    status: 'active',
    capitalMode: 'vault-capital',
    supportedChains: [8453, 42161],
    supportedAssets: ['USDC', 'WETH'],
    phase: 1,
  },
  {
    id: 'lp-market-making',
    name: 'Concentrated LP Market Making (NOT pure arbitrage)',
    version: '1.0.0',
    modelType: 'lp-market-making',
    riskClass: 'high',
    status: 'active',
    capitalMode: 'vault-capital',
    supportedChains: [8453, 42161, 1],
    supportedAssets: ['USDC', 'WETH', 'WBTC', 'cbBTC'],
    phase: 1,
  },
  {
    id: 'yield-rotator',
    name: 'Yield Rotator (cash mgmt, NOT arbitrage)',
    version: '1.0.0',
    modelType: 'yield-rotator',
    riskClass: 'low',
    status: 'active',
    capitalMode: 'vault-capital',
    supportedChains: [8453, 42161],
    supportedAssets: ['USDC'],
    phase: 1,
  },
  {
    id: 'solver-spread',
    name: 'Solver Spread Capture',
    version: '0.0.0',
    modelType: 'solver-spread',
    riskClass: 'experimental',
    status: 'paused',
    capitalMode: 'inventory',
    supportedChains: [],
    supportedAssets: [],
    phase: 2,
  },
  {
    id: 'liquidation',
    name: 'Liquidation Arbitrage',
    version: '0.0.0',
    modelType: 'liquidation',
    riskClass: 'high',
    status: 'paused',
    capitalMode: 'flash-loan',
    supportedChains: [],
    supportedAssets: [],
    phase: 2,
  },
  {
    id: 'crosschain-inventory',
    name: 'Cross-chain Inventory',
    version: '0.0.0',
    modelType: 'crosschain-inventory',
    riskClass: 'high',
    status: 'paused',
    capitalMode: 'inventory',
    supportedChains: [],
    supportedAssets: [],
    phase: 3,
  },
];

export function strategyById(id: string): StrategyConfig | undefined {
  return STRATEGIES.find((s) => s.id === id);
}
