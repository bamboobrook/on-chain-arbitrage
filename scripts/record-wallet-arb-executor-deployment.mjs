#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath =
  process.env.EXECUTOR_DEPLOYMENTS_PATH ?? resolve(root, 'data', 'executor-deployments.json');

const CHAIN_NAMES = {
  1: 'Ethereum',
  10: 'Optimism',
  56: 'BNB',
  137: 'Polygon',
  8453: 'Base',
  42161: 'Arbitrum',
};

function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value ?? ''));
}

function optionalAddress(value) {
  const trimmed = value?.trim();
  return isAddress(trimmed) ? trimmed : null;
}

function loadDotenv() {
  try {
    const text = readFileSync(resolve(root, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed
        .slice(idx + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Optional.
  }
}

async function rpcChainId() {
  const url =
    process.env.WALLET_ARB_DEPLOY_RPC_URL ??
    process.env.RPC_URL ??
    process.env.RPC_ETHEREUM_URL ??
    process.env.RPC_BASE_URL ??
    process.env.RPC_ARBITRUM_URL ??
    process.env.RPC_POLYGON_URL ??
    process.env.RPC_OPTIMISM_URL ??
    process.env.RPC_BNB_URL;
  if (!url) return null;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
  });
  if (!res.ok) throw new Error(`eth_chainId http ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? 'eth_chainId failed');
  return Number(BigInt(json.result));
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  loadDotenv();
  const executor =
    optionalAddress(process.env.WALLET_ATOMIC_ARB_EXECUTOR_ADDRESS) ??
    optionalAddress(process.env.DEX_ARB_EXECUTOR_ADDRESS);
  if (!executor) {
    throw new Error(
      'WALLET_ATOMIC_ARB_EXECUTOR_ADDRESS or DEX_ARB_EXECUTOR_ADDRESS must be a 20-byte address',
    );
  }
  const chainId = Number(process.env.DEPLOY_CHAIN_ID ?? process.env.CHAIN_ID ?? (await rpcChainId()));
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error('DEPLOY_CHAIN_ID, CHAIN_ID, or an RPC URL is required');
  }

  const adapters = {
    uniswapV2: optionalAddress(process.env.UNISWAP_V2_ADAPTER_ADDRESS),
    uniswapV3: optionalAddress(process.env.UNISWAP_V3_ADAPTER_ADDRESS),
    curveStableSwap: optionalAddress(process.env.CURVE_STABLE_SWAP_ADAPTER_ADDRESS),
    balancerV2Vault: optionalAddress(process.env.BALANCER_V2_VAULT_ADAPTER_ADDRESS),
    aerodromeStable: optionalAddress(process.env.AERODROME_STABLE_ADAPTER_ADDRESS),
    aerodromeVolatile: optionalAddress(process.env.AERODROME_VOLATILE_ADAPTER_ADDRESS),
  };

  const manifest = (await readJson(outPath)) ?? {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    deployments: {},
  };
  manifest.schemaVersion = manifest.schemaVersion ?? 1;
  manifest.generatedAt = new Date().toISOString();
  manifest.deployments = manifest.deployments ?? {};
  manifest.deployments[String(chainId)] = {
    ...(manifest.deployments[String(chainId)] ?? {}),
    walletAtomicArbitrageExecutor: {
      contract: 'WalletAtomicArbitrageExecutor',
      address: executor,
      chainId,
      chain: CHAIN_NAMES[chainId] ?? `chain-${chainId}`,
      admin: process.env.WALLET_ARB_ADMIN ?? null,
      deployer: process.env.DEPLOYER_ADDRESS ?? null,
      txHash: process.env.WALLET_ARB_EXECUTOR_DEPLOY_TX_HASH ?? null,
      blockNumber: process.env.WALLET_ARB_EXECUTOR_DEPLOY_BLOCK_NUMBER ?? null,
      verified:
        process.env.WALLET_ARB_EXECUTOR_VERIFIED === '1' ||
        process.env.WALLET_ARB_EXECUTOR_VERIFIED === 'true',
      adapters,
      recordedAt: new Date().toISOString(),
      source: 'scripts/record-wallet-arb-executor-deployment.mjs',
    },
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `recordedWalletAtomicArbDeployment chainId=${chainId} executor=${executor} manifest=${outPath}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
