#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'data');
const docsDir = resolve(root, 'docs');

const CHAIN = {
  name: 'Ethereum',
  shortName: 'ethereum',
  chainId: 1,
  rpcEnvVar: 'RPC_ETHEREUM_URL',
};

const CONTRACTS = {
  chainlog: '0xdA0Ab1e0017DEbCd72Be8599041a2aa3bA7e740F',
};

const SELECTORS = {
  chainlogCount: '0x06661abd',
  chainlogGet: '0x9507d39a',
  chainlogGetAddress: '0x21f8a721',
  clipIlk: '0xc5ce281e',
  clipCalc: '0x96f1b6be',
  clipBuf: '0x15232515',
  clipTail: '0x13d8c840',
  clipCusp: '0x49ed5931',
  clipChip: '0xb61500e4',
  clipTip: '0x2755cd2d',
};

const TOPICS = {
  kick: '0x7c5bfdc0a5e8192f6cd4972f382cec69116862fb62e6abff8003874c58e064b8',
  take: '0x05e309fd6ce72f2ab888a20056bb4210df08daed86f21f95053deb19964d86b1',
  redo: '0x275de7ecdd375b5e8049319f8b350686131c219dd4dc450a08e9cf83b03c865f',
};

const UINT_ZERO = 0n;
const RAD = 10n ** 45n;
const WAD = 10n ** 18n;
const RAY = 10n ** 27n;

const DEFAULT_CLIP_KEYS = [
  'MCD_CLIP_ETH_A',
  'MCD_CLIP_ETH_B',
  'MCD_CLIP_ETH_C',
  'MCD_CLIP_WSTETH_A',
  'MCD_CLIP_WSTETH_B',
  'MCD_CLIP_RETH_A',
  'MCD_CLIP_CBETH_A',
  'MCD_CLIP_WBTC_A',
  'MCD_CLIP_WBTC_B',
  'MCD_CLIP_WBTC_C',
  'MCD_CLIP_LINK_A',
  'MCD_CLIP_UNI_A',
  'MCD_CLIP_AAVE_A',
  'MCD_CLIP_YFI_A',
  'MCD_CLIP_MATIC_A',
  'MCD_CLIP_MANA_A',
  'MCD_CLIP_GUNIV3DAIUSDC1_A',
  'MCD_CLIP_GUNIV3DAIUSDC2_A',
];

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
    // RPC can be passed through env in CI.
  }
}

function envNumber(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envString(key, fallback) {
  const value = String(process.env[key] ?? '').trim();
  return value || fallback;
}

function hexStrip(hex) {
  return String(hex ?? '').replace(/^0x/i, '');
}

function toBlockTag(n) {
  return `0x${BigInt(n).toString(16)}`;
}

function pad32(hex) {
  return hexStrip(hex).padStart(64, '0');
}

function encodeUint(value) {
  return pad32(BigInt(value).toString(16));
}

function encodeBytes32String(value) {
  const hex = Buffer.from(String(value), 'utf8').toString('hex');
  if (hex.length > 64) throw new Error(`bytes32 string too long: ${value}`);
  return hex.padEnd(64, '0');
}

function wordAt(result, index) {
  const clean = hexStrip(result);
  return clean.slice(index * 64, index * 64 + 64);
}

function dataWordAt(data, index) {
  return wordAt(data, index);
}

function decodeUintWord(result, index) {
  const word = wordAt(result, index);
  return word ? BigInt(`0x${word}`) : UINT_ZERO;
}

function decodeUintData(data, index) {
  const word = dataWordAt(data, index);
  return word ? BigInt(`0x${word}`) : UINT_ZERO;
}

function addressFromWord(word) {
  return `0x${hexStrip(word).slice(24, 64)}`;
}

function addressFromTopic(topic) {
  return addressFromWord(topic);
}

function bytes32ToString(word) {
  const clean = hexStrip(word).replace(/00+$/g, '');
  if (!clean) return '';
  return Buffer.from(clean, 'hex').toString('utf8').replace(/\0+$/g, '');
}

function hexToBigInt(hex) {
  if (!hex || hex === '0x') return 0n;
  return BigInt(hex);
}

function hexToNumber(hex) {
  return Number(hexToBigInt(hex));
}

function fixedToNumber(value, scale) {
  if (value === null || value === undefined) return null;
  return Number(value) / Number(scale);
}

function fixedToString(value, scale, digits = 4) {
  if (value === null || value === undefined) return null;
  const n = fixedToNumber(value, scale);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function compactNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'n/a';
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });
}

async function rpc(rpcUrl, method, params, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), envNumber('MAKER_RPC_TIMEOUT_MS', 20_000));
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: `${Date.now()}-${Math.random()}`, method, params }),
        signal: controller.signal,
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error?.message ?? `RPC ${method} ${res.status}`);
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(300 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function ethCall(rpcUrl, to, data, blockTag = 'latest') {
  return rpc(rpcUrl, 'eth_call', [{ to, data }, blockTag]);
}

async function optionalEthCall(rpcUrl, to, data, blockTag = 'latest') {
  try {
    const result = await ethCall(rpcUrl, to, data, blockTag);
    if (!result || result === '0x') return null;
    return result;
  } catch {
    return null;
  }
}

async function getLogs(rpcUrl, address, fromBlock, toBlock, topics) {
  return rpc(rpcUrl, 'eth_getLogs', [
    {
      address,
      fromBlock: toBlockTag(fromBlock),
      toBlock: toBlockTag(toBlock),
      topics,
    },
  ]);
}

async function loadChainlogEntries(rpcUrl) {
  const count = Number(decodeUintWord(await ethCall(rpcUrl, CONTRACTS.chainlog, SELECTORS.chainlogCount), 0));
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const result = await optionalEthCall(
      rpcUrl,
      CONTRACTS.chainlog,
      SELECTORS.chainlogGet + encodeUint(i),
    );
    if (!result) continue;
    entries.push({
      index: i,
      key: bytes32ToString(wordAt(result, 0)),
      address: addressFromWord(wordAt(result, 1)),
    });
  }
  return entries;
}

async function loadClipperEntriesFromKeys(rpcUrl, keys) {
  const entries = [];
  for (const [index, key] of keys.entries()) {
    const result = await optionalEthCall(
      rpcUrl,
      CONTRACTS.chainlog,
      SELECTORS.chainlogGetAddress + encodeBytes32String(key),
    );
    if (!result) continue;
    const address = addressFromWord(wordAt(result, 0));
    if (!address || address === '0x0000000000000000000000000000000000000000') continue;
    entries.push({ index, key, address });
  }
  return entries;
}

async function enrichClipper(rpcUrl, entry) {
  const [ilkResult, calcResult, bufResult, tailResult, cuspResult, chipResult, tipResult] =
    await Promise.all([
      optionalEthCall(rpcUrl, entry.address, SELECTORS.clipIlk),
      optionalEthCall(rpcUrl, entry.address, SELECTORS.clipCalc),
      optionalEthCall(rpcUrl, entry.address, SELECTORS.clipBuf),
      optionalEthCall(rpcUrl, entry.address, SELECTORS.clipTail),
      optionalEthCall(rpcUrl, entry.address, SELECTORS.clipCusp),
      optionalEthCall(rpcUrl, entry.address, SELECTORS.clipChip),
      optionalEthCall(rpcUrl, entry.address, SELECTORS.clipTip),
    ]);

  return {
    ...entry,
    ilk: ilkResult ? bytes32ToString(wordAt(ilkResult, 0)) : entry.key.replace(/^MCD_CLIP_/, ''),
    calc: calcResult ? addressFromWord(wordAt(calcResult, 0)) : null,
    bufRay: bufResult ? decodeUintWord(bufResult, 0).toString() : null,
    buf: bufResult ? fixedToNumber(decodeUintWord(bufResult, 0), RAY) : null,
    tailSeconds: tailResult ? Number(decodeUintWord(tailResult, 0)) : null,
    cuspRay: cuspResult ? decodeUintWord(cuspResult, 0).toString() : null,
    cusp: cuspResult ? fixedToNumber(decodeUintWord(cuspResult, 0), RAY) : null,
    chipWad: chipResult ? decodeUintWord(chipResult, 0).toString() : null,
    chip: chipResult ? fixedToNumber(decodeUintWord(chipResult, 0), WAD) : null,
    tipRad: tipResult ? decodeUintWord(tipResult, 0).toString() : null,
    tipDai: tipResult ? fixedToNumber(decodeUintWord(tipResult, 0), RAD) : null,
  };
}

function decodeEvent(log, clipper) {
  const topic0 = String(log.topics?.[0] ?? '').toLowerCase();
  const common = {
    chain: CHAIN.name,
    clipperKey: clipper.key,
    clipper: clipper.address,
    ilk: clipper.ilk,
    blockNumber: hexToNumber(log.blockNumber),
    txHash: log.transactionHash,
    transactionIndex: hexToNumber(log.transactionIndex),
    logIndex: hexToNumber(log.logIndex),
    auctionId: log.topics?.[1] ? hexToBigInt(log.topics[1]).toString() : null,
  };

  if (topic0 === TOPICS.kick.toLowerCase()) {
    const top = decodeUintData(log.data, 0);
    const tab = decodeUintData(log.data, 1);
    const lot = decodeUintData(log.data, 2);
    const coin = decodeUintData(log.data, 3);
    return {
      ...common,
      type: 'kick',
      usr: log.topics?.[2] ? addressFromTopic(log.topics[2]) : null,
      kpr: log.topics?.[3] ? addressFromTopic(log.topics[3]) : null,
      topRay: top.toString(),
      topApprox: fixedToNumber(top, RAY),
      tabRad: tab.toString(),
      tabDaiApprox: fixedToNumber(tab, RAD),
      lotWad: lot.toString(),
      lotApprox: fixedToNumber(lot, WAD),
      coinRad: coin.toString(),
      coinDaiApprox: fixedToNumber(coin, RAD),
    };
  }

  if (topic0 === TOPICS.redo.toLowerCase()) {
    const top = decodeUintData(log.data, 0);
    const tab = decodeUintData(log.data, 1);
    const lot = decodeUintData(log.data, 2);
    const coin = decodeUintData(log.data, 3);
    return {
      ...common,
      type: 'redo',
      usr: log.topics?.[2] ? addressFromTopic(log.topics[2]) : null,
      kpr: log.topics?.[3] ? addressFromTopic(log.topics[3]) : null,
      topRay: top.toString(),
      topApprox: fixedToNumber(top, RAY),
      tabRad: tab.toString(),
      tabDaiApprox: fixedToNumber(tab, RAD),
      lotWad: lot.toString(),
      lotApprox: fixedToNumber(lot, WAD),
      coinRad: coin.toString(),
      coinDaiApprox: fixedToNumber(coin, RAD),
    };
  }

  if (topic0 === TOPICS.take.toLowerCase()) {
    const max = decodeUintData(log.data, 0);
    const price = decodeUintData(log.data, 1);
    const owe = decodeUintData(log.data, 2);
    const tab = decodeUintData(log.data, 3);
    const lot = decodeUintData(log.data, 4);
    return {
      ...common,
      type: 'take',
      usr: log.topics?.[2] ? addressFromTopic(log.topics[2]) : null,
      maxRay: max.toString(),
      maxApprox: fixedToNumber(max, RAY),
      priceRay: price.toString(),
      priceApprox: fixedToNumber(price, RAY),
      oweRad: owe.toString(),
      oweDaiApprox: fixedToNumber(owe, RAD),
      tabRad: tab.toString(),
      tabDaiApprox: fixedToNumber(tab, RAD),
      lotWad: lot.toString(),
      lotApprox: fixedToNumber(lot, WAD),
    };
  }

  return { ...common, type: 'unknown', topic0 };
}

function aggregateAuctions(events) {
  const auctions = new Map();
  const sorted = [...events].sort(
    (a, b) =>
      a.blockNumber - b.blockNumber ||
      a.transactionIndex - b.transactionIndex ||
      a.logIndex - b.logIndex,
  );

  for (const event of sorted) {
    const key = `${event.clipper.toLowerCase()}:${event.auctionId}`;
    const existing =
      auctions.get(key) ??
      {
        chain: event.chain,
        clipperKey: event.clipperKey,
        clipper: event.clipper,
        ilk: event.ilk,
        auctionId: event.auctionId,
        firstBlock: event.blockNumber,
        lastBlock: event.blockNumber,
        kickCount: 0,
        redoCount: 0,
        takeCount: 0,
        takeTxCount: 0,
        firstTxHash: event.txHash,
        lastTxHash: event.txHash,
        kickTopApprox: null,
        kickTabDaiApprox: null,
        kickLotApprox: null,
        remainingTabDaiApprox: null,
        remainingLotApprox: null,
        totalOweDaiApprox: 0,
        maxTakePriceApprox: null,
        minTakePriceApprox: null,
        lastEventType: null,
      };

    existing.lastBlock = event.blockNumber;
    existing.lastTxHash = event.txHash;
    existing.lastEventType = event.type;

    if (event.type === 'kick') {
      existing.kickCount += 1;
      existing.kickTopApprox = event.topApprox;
      existing.kickTabDaiApprox = event.tabDaiApprox;
      existing.kickLotApprox = event.lotApprox;
      existing.remainingTabDaiApprox = event.tabDaiApprox;
      existing.remainingLotApprox = event.lotApprox;
    } else if (event.type === 'redo') {
      existing.redoCount += 1;
      existing.remainingTabDaiApprox = event.tabDaiApprox;
      existing.remainingLotApprox = event.lotApprox;
    } else if (event.type === 'take') {
      existing.takeCount += 1;
      existing.takeTxCount += 1;
      existing.totalOweDaiApprox += event.oweDaiApprox ?? 0;
      existing.remainingTabDaiApprox = event.tabDaiApprox;
      existing.remainingLotApprox = event.lotApprox;
      existing.maxTakePriceApprox =
        existing.maxTakePriceApprox === null
          ? event.priceApprox
          : Math.max(existing.maxTakePriceApprox, event.priceApprox ?? 0);
      existing.minTakePriceApprox =
        existing.minTakePriceApprox === null
          ? event.priceApprox
          : Math.min(existing.minTakePriceApprox, event.priceApprox ?? existing.minTakePriceApprox);
    }

    existing.blockSpan = existing.lastBlock - existing.firstBlock;
    existing.closedApprox =
      existing.remainingTabDaiApprox !== null &&
      existing.remainingLotApprox !== null &&
      (existing.remainingTabDaiApprox <= 0.000001 || existing.remainingLotApprox <= 0.000001);
    existing.hasTakes = existing.takeCount > 0;
    auctions.set(key, existing);
  }

  return [...auctions.values()].sort((a, b) => b.firstBlock - a.firstBlock);
}

function summarizeByIlk(auctions, clippers) {
  const byIlk = new Map();
  for (const clipper of clippers) {
    byIlk.set(clipper.ilk, {
      ilk: clipper.ilk,
      clipperKey: clipper.key,
      clipper: clipper.address,
      auctionCount: 0,
      withTakeCount: 0,
      closedApproxCount: 0,
      redoCount: 0,
      totalOweDaiApprox: 0,
      totalKickTabDaiApprox: 0,
      maxKickTabDaiApprox: 0,
      maxTakePriceApprox: null,
      minTakePriceApprox: null,
    });
  }

  for (const auction of auctions) {
    const row =
      byIlk.get(auction.ilk) ??
      {
        ilk: auction.ilk,
        clipperKey: auction.clipperKey,
        clipper: auction.clipper,
        auctionCount: 0,
        withTakeCount: 0,
        closedApproxCount: 0,
        redoCount: 0,
        totalOweDaiApprox: 0,
        totalKickTabDaiApprox: 0,
        maxKickTabDaiApprox: 0,
        maxTakePriceApprox: null,
        minTakePriceApprox: null,
      };
    row.auctionCount += auction.kickCount || 0;
    row.withTakeCount += auction.hasTakes ? 1 : 0;
    row.closedApproxCount += auction.closedApprox ? 1 : 0;
    row.redoCount += auction.redoCount || 0;
    row.totalOweDaiApprox += auction.totalOweDaiApprox || 0;
    row.totalKickTabDaiApprox += auction.kickTabDaiApprox || 0;
    row.maxKickTabDaiApprox = Math.max(row.maxKickTabDaiApprox, auction.kickTabDaiApprox || 0);
    row.maxTakePriceApprox =
      row.maxTakePriceApprox === null
        ? auction.maxTakePriceApprox
        : Math.max(row.maxTakePriceApprox ?? 0, auction.maxTakePriceApprox ?? 0);
    row.minTakePriceApprox =
      row.minTakePriceApprox === null
        ? auction.minTakePriceApprox
        : Math.min(row.minTakePriceApprox ?? Infinity, auction.minTakePriceApprox ?? Infinity);
    byIlk.set(auction.ilk, row);
  }

  return [...byIlk.values()].sort(
    (a, b) => b.auctionCount - a.auctionCount || b.totalOweDaiApprox - a.totalOweDaiApprox,
  );
}

function markdownTable(rows) {
  if (rows.length === 0) return '无';
  return rows
    .map(
      (row) =>
        `| ${row.ilk} | ${row.clipperKey} | ${compactNumber(row.auctionCount, 0)} | ${compactNumber(
          row.withTakeCount,
          0,
        )} | ${compactNumber(row.closedApproxCount, 0)} | $${compactNumber(
          row.totalKickTabDaiApprox,
          2,
        )} | $${compactNumber(row.totalOweDaiApprox, 2)} |`,
    )
    .join('\n');
}

function buildReport(output) {
  const topRows = output.ilkSummaries.filter((row) => row.auctionCount > 0).slice(0, 20);
  const watchRows = output.ilkSummaries.slice(0, 20);

  return `# Maker Clipper 策略发现扫描

生成时间：${output.generatedAt}
链：${output.chain.name}
扫描范围：${compactNumber(output.scan.fromBlock, 0)} - ${compactNumber(output.scan.toBlock, 0)}

## 结论

这是策略发现原型，不是收益证明。它已经接入 Maker Chainlog，动态枚举 \`MCD_CLIP_*\` Clipper，并回放 \`Kick/Take/Redo\` 拍卖事件。

当前结果：

- Clipper 数量：${compactNumber(output.summary.clipperCount, 0)}
- 扫描事件数：${compactNumber(output.summary.eventCount, 0)}
- 拍卖数：${compactNumber(output.summary.auctionCount, 0)}
- 有 take 的拍卖数：${compactNumber(output.summary.auctionsWithTakes, 0)}
- 近似关闭的拍卖数：${compactNumber(output.summary.closedApproxCount, 0)}
- 当前判断：${output.summary.decision}

## 有事件的 ilk

| ilk | Chainlog key | kick 拍卖 | 有 take | 近似关闭 | kick tab 合计 | take owe 合计 |
|---|---|---:|---:|---:|---:|---:|
${markdownTable(topRows)}

## 前 20 个监控对象

| ilk | Chainlog key | kick 拍卖 | 有 take | 近似关闭 | kick tab 合计 | take owe 合计 |
|---|---|---:|---:|---:|---:|---:|
${markdownTable(watchRows)}

## 下一步回测

1. 对每个 active auction 按 Clipper/Abacus 价格曲线重建每个区块的 auction price。
2. 接入 DAI 结算和 collateral -> DAI 的链上退出 quote。
3. 只保留 auction price + gas + bribe + slippage 后仍为正的窗口。
4. 输出窗口持续时间、最大可成交金额、历史竞争强度和失败率。

## 资料来源

- Maker Dog / Clipper 文档：https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation
- Maker Chainlog 合约：${CONTRACTS.chainlog}
`;
}

function buildBlockedReport(output) {
  return `# Maker Clipper 策略发现扫描

生成时间：${output.generatedAt}
链：${output.chain.name}
状态：${output.summary.status}

## 结论

这次 Maker Clipper 策略发现没有完成链上日志回放，原因是远端 RPC/DNS 连接失败或超时。这个结果不能解释为“Maker 没有套利机会”，只能解释为“当前基础设施没有给出足够链上数据”。

当前阻塞：

- 阻塞阶段：${output.summary.blockedStage}
- 错误：${output.summary.error}
- Clipper 策略等级：仍保留为 A 级候选，等待 RPC 恢复后回放。
- Passing：0，原因是未完成 auction curve + DEX exit quote 回测。

## 恢复后重跑

\`\`\`bash
MAKER_RPC_TIMEOUT_MS=60000 MAKER_LOOKBACK_BLOCKS=20000 MAKER_LOG_CHUNK_BLOCKS=5000 MAKER_MAX_CLIPPERS=18 MAKER_MAX_LOG_REQUESTS=90 node scripts/search-maker-clipper-auctions.mjs
\`\`\`

## 下一步

1. 换用稳定 Ethereum archive/full RPC，先确认 \`eth_blockNumber\` 15 秒内响应。
2. 先跑 20k 区块事件密度，再扩到 120k、500k。
3. 有事件后再接 auction price curve 和 collateral -> DAI 退出 quote。
`;
}

async function main() {
  loadDotenv();
  const rpcUrl = process.env[CHAIN.rpcEnvVar];
  if (!rpcUrl) throw new Error(`${CHAIN.rpcEnvVar} is required`);

  const latestBlock = hexToNumber(await rpc(rpcUrl, 'eth_blockNumber', []));
  const lookbackBlocks = envNumber('MAKER_LOOKBACK_BLOCKS', 120_000);
  const chunkBlocks = envNumber('MAKER_LOG_CHUNK_BLOCKS', 10_000);
  const maxClippers = envNumber('MAKER_MAX_CLIPPERS', 40);
  const maxLogRequests = envNumber('MAKER_MAX_LOG_REQUESTS', 600);
  const clipKeyRegex = new RegExp(envString('MAKER_CLIP_KEY_REGEX', '^MCD_CLIP_'));
  const enumerateChainlog = envString('MAKER_ENUM_CHAINLOG', '0') === '1';
  const configuredKeys = envString('MAKER_CLIP_KEYS', DEFAULT_CLIP_KEYS.join(','))
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  const fromBlock = Math.max(1, latestBlock - lookbackBlocks);

  const chainlogEntries = enumerateChainlog
    ? await loadChainlogEntries(rpcUrl)
    : await loadClipperEntriesFromKeys(rpcUrl, configuredKeys);
  const rawClippers = chainlogEntries
    .filter((entry) => clipKeyRegex.test(entry.key))
    .filter((entry) => entry.address && entry.address !== '0x0000000000000000000000000000000000000000')
    .slice(0, maxClippers);

  const clippers = [];
  for (const entry of rawClippers) {
    clippers.push(await enrichClipper(rpcUrl, entry));
  }

  const events = [];
  const scanErrors = [];
  let logRequestCount = 0;

  for (const clipper of clippers) {
    for (let start = fromBlock; start <= latestBlock; start += chunkBlocks + 1) {
      const end = Math.min(latestBlock, start + chunkBlocks);
      if (logRequestCount >= maxLogRequests) break;
      logRequestCount += 1;
      try {
        const logs = await getLogs(rpcUrl, clipper.address, start, end, [
          [TOPICS.kick, TOPICS.take, TOPICS.redo],
        ]);
        for (const log of logs) {
          events.push(decodeEvent(log, clipper));
        }
      } catch (error) {
        scanErrors.push({
          clipperKey: clipper.key,
          clipper: clipper.address,
          fromBlock: start,
          toBlock: end,
          error: error.message,
        });
      }
    }
  }

  const auctions = aggregateAuctions(events);
  const ilkSummaries = summarizeByIlk(auctions, clippers);
  const auctionsWithTakes = auctions.filter((auction) => auction.hasTakes).length;
  const closedApproxCount = auctions.filter((auction) => auction.closedApprox).length;

  const summary = {
    clipperCount: clippers.length,
    eventCount: events.length,
    auctionCount: auctions.length,
    auctionsWithTakes,
    closedApproxCount,
    scanErrorCount: scanErrors.length,
    logRequestCount,
    status:
      auctions.length > 0
        ? 'found-maker-clipper-auction-history'
        : 'did-not-find-maker-clipper-auctions-in-window',
    decision:
      auctions.length > 0
        ? 'strategy family is scanable; profitability still requires auction curve plus DEX exit quote replay'
        : 'keep as strategy candidate, but widen the block window before prioritizing profit replay',
  };

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    chain: CHAIN,
    scan: {
      fromBlock,
      toBlock: latestBlock,
      lookbackBlocks,
      chunkBlocks,
      maxClippers,
      maxLogRequests,
      logRequestCount,
      clipKeyRegex: clipKeyRegex.source,
      enumerateChainlog,
      configuredKeyCount: configuredKeys.length,
    },
    summary,
    clippers,
    events,
    auctions,
    ilkSummaries,
    scanErrors,
    gates: {
      passingCount: 0,
      reason:
        'This discovery pass only proves event availability. A passing strategy requires historical auction curve reconstruction plus collateral exit quote replay.',
    },
  };

  await mkdir(dataDir, { recursive: true });
  await mkdir(docsDir, { recursive: true });
  const outJson = resolve(dataDir, 'maker-clipper-auction-candidates-ethereum.json');
  const outMd = resolve(docsDir, 'maker-clipper-strategy-discovery-20260708.md');
  await writeFile(outJson, `${JSON.stringify(output, null, 2)}\n`);
  await writeFile(outMd, buildReport(output));

  console.log(
    JSON.stringify(
      {
        outJson,
        outMd,
        ...summary,
      },
      null,
      2,
    ),
  );
}

const hardTimeoutMs = envNumber('MAKER_HARD_TIMEOUT_MS', 120_000);

Promise.race([
  main(),
  new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error(`hard timeout after ${hardTimeoutMs}ms while scanning Maker Clipper`)),
      hardTimeoutMs,
    );
  }),
]).catch(async (error) => {
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    chain: CHAIN,
    scan: {
      lookbackBlocks: envNumber('MAKER_LOOKBACK_BLOCKS', 120_000),
      chunkBlocks: envNumber('MAKER_LOG_CHUNK_BLOCKS', 10_000),
      maxClippers: envNumber('MAKER_MAX_CLIPPERS', 40),
      maxLogRequests: envNumber('MAKER_MAX_LOG_REQUESTS', 600),
    },
    summary: {
      clipperCount: 0,
      eventCount: 0,
      auctionCount: 0,
      auctionsWithTakes: 0,
      closedApproxCount: 0,
      passingCount: 0,
      status: 'rpc-blocked-maker-clipper-scan',
      blockedStage: 'rpc-health-or-chainlog-read',
      error: error?.message ?? String(error),
      decision:
        'do not reject the Maker Clipper strategy family; rerun when Ethereum RPC/DNS is healthy',
    },
    clippers: [],
    events: [],
    auctions: [],
    ilkSummaries: [],
    scanErrors: [
      {
        stage: 'rpc-health-or-chainlog-read',
        error: error?.message ?? String(error),
      },
    ],
    gates: {
      passingCount: 0,
      reason:
        'RPC blocked before auction event replay. A passing strategy requires historical auction curve reconstruction plus collateral exit quote replay.',
    },
  };

  await mkdir(dataDir, { recursive: true });
  await mkdir(docsDir, { recursive: true });
  const outJson = resolve(dataDir, 'maker-clipper-auction-candidates-ethereum.json');
  const outMd = resolve(docsDir, 'maker-clipper-strategy-discovery-20260708.md');
  await writeFile(outJson, `${JSON.stringify(output, null, 2)}\n`);
  await writeFile(outMd, buildBlockedReport(output));

  console.log(
    JSON.stringify(
      {
        outJson,
        outMd,
        ...output.summary,
      },
      null,
      2,
    ),
  );
  process.exit(0);
});
