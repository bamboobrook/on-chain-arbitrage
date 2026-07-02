/**
 * @oal/sdk contracts — minimal human-readable ABIs for the on-chain contracts,
 * plus helpers to build viem contract configs. The full ABIs live in
 * contracts/out/*.json after `forge build`; this file hand-curates the entries
 * the frontend + workers actually call.
 */

import type { Address } from './types.js';

/** ArbVault ABI surface used by the UI + accounting worker. */
export const arbVaultAbi = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'redeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'assets', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalAssets',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalRealizedProfit',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'convertToAssets',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: 'assets', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'asset',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'pause',
    stateMutability: 'nonpayable',
    inputs: [],
  },
  {
    type: 'function',
    name: 'unpause',
    stateMutability: 'nonpayable',
    inputs: [],
  },
  {
    type: 'function',
    name: 'performanceFeeBps',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'ProfitReported',
    inputs: [
      { name: 'executor', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'feeTaken', type: 'uint256', indexed: false },
    ],
  },
] as const;

/** StrategyExecutor ABI surface (used by the execution worker). */
export const strategyExecutorAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'req',
        type: 'tuple',
        components: [
          { name: 'vault', type: 'address' },
          { name: 'asset', type: 'address' },
          { name: 'strategyId', type: 'bytes32' },
          { name: 'principal', type: 'uint256' },
          {
            name: 'route',
            type: 'Hop[]',
            internalType: 'struct StrategyExecutor.Hop[]',
          },
          { name: 'minProfitAssets', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'profit', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'ExecutionSucceeded',
    inputs: [
      { name: 'vault', type: 'address', indexed: true },
      { name: 'strategyId', type: 'bytes32', indexed: true },
      { name: 'principal', type: 'uint256', indexed: false },
      { name: 'profit', type: 'uint256', indexed: false },
      { name: 'gasUsed', type: 'uint256', indexed: false },
    ],
  },
] as const;

/** ERC20 ABI subset (asset token). */
export const erc20Abi = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [
    { name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' },
  ], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [
    { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' },
  ], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [
    { name: 'account', type: 'address' },
  ], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
] as const;

export interface ContractAddresses {
  arbVault?: Address;
  strategyExecutor?: Address;
  strategyController?: Address;
  riskManager?: Address;
  accounting?: Address;
  timelock?: Address;
}

/**
 * Addresses deployed on the local Anvil node by LocalAnvilScript. Replace with
 * real addresses (per chain) after deploying to testnet/mainnet.
 */
export const LOCAL_ANVIL_ADDRESSES: Record<number, ContractAddresses> = {
  31337: {
    arbVault: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
    strategyExecutor: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    strategyController: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    riskManager: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    accounting: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    timelock: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  },
};

export function getAddresses(chainId: number): ContractAddresses {
  return LOCAL_ANVIL_ADDRESSES[chainId] ?? {};
}
