#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath =
  process.env.EXECUTOR_DEPLOYMENTS_PATH ?? resolve(root, 'data', 'executor-deployments.json');

const AAVE_POOLS = {
  1: '0x87870Bca3F3fD6335C3F4cE8392D69350B4fA4E2',
  8453: '0xA238Dd80C259a72e81d7e4664a9801593f98d1c5',
  42161: '0x794a61358D6845594F94dC1dB02A252b5b4814aD',
  137: '0x794a61358D6845594F94dC1dB02A252b5b4814aD',
};

const CHAIN_NAMES = {
  1: 'Ethereum',
  8453: 'Base',
  42161: 'Arbitrum',
  137: 'Polygon',
};

function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value ?? ''));
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
    process.env.AAVE_DEPLOY_RPC_URL ??
    process.env.RPC_URL ??
    process.env.RPC_ETHEREUM_URL ??
    process.env.RPC_BASE_URL ??
    process.env.RPC_ARBITRUM_URL ??
    process.env.RPC_POLYGON_URL;
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
  const executor = process.env.AAVE_LIQUIDATION_EXECUTOR_ADDRESS?.trim();
  if (!isAddress(executor)) {
    throw new Error('AAVE_LIQUIDATION_EXECUTOR_ADDRESS must be a 20-byte address');
  }
  const chainId = Number(process.env.DEPLOY_CHAIN_ID ?? process.env.CHAIN_ID ?? (await rpcChainId()));
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error('DEPLOY_CHAIN_ID, CHAIN_ID, or an RPC URL is required');
  }
  const aavePool = process.env.AAVE_POOL?.trim() ?? AAVE_POOLS[chainId];
  if (!isAddress(aavePool)) {
    throw new Error(`AAVE_POOL is required for unsupported chain ${chainId}`);
  }

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
    aaveV3LiquidationExecutor: {
      contract: 'AaveV3LiquidationExecutor',
      address: executor,
      chainId,
      chain: CHAIN_NAMES[chainId] ?? `chain-${chainId}`,
      aavePool,
      admin: process.env.AAVE_EXECUTOR_ADMIN ?? null,
      deployer: process.env.DEPLOYER_ADDRESS ?? null,
      txHash: process.env.AAVE_EXECUTOR_DEPLOY_TX_HASH ?? null,
      blockNumber: process.env.AAVE_EXECUTOR_DEPLOY_BLOCK_NUMBER ?? null,
      verified: process.env.AAVE_EXECUTOR_VERIFIED === '1' || process.env.AAVE_EXECUTOR_VERIFIED === 'true',
      recordedAt: new Date().toISOString(),
      source: 'scripts/record-aave-executor-deployment.mjs',
    },
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `recordedAaveExecutorDeployment chainId=${chainId} executor=${executor} pool=${aavePool} manifest=${outPath}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
