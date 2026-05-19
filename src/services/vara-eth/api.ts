/**
 * Ethexe API singleton.
 *
 * Mirrors the substrate `services/api.ts` shape: a single cached `VaraEthApi`
 * instance per-process keyed by RPC endpoint. Falls back to env vars + config
 * file when no explicit endpoint is supplied.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { createPublicClient, webSocket, type Address, type PublicClient } from 'viem';
import {
  createVaraEthApi,
  HttpVaraEthProvider,
  WsVaraEthProvider,
  getMirrorClient as makeMirrorClient,
  type ITransactionSigner,
  type MirrorClient,
  type VaraEthApi,
} from '@vara-eth/api';

import { CliError } from '../../utils/errors';
import { readConfig } from '../config';

interface CacheEntry {
  api: VaraEthApi;
  ws: WsVaraEthProvider | HttpVaraEthProvider;
  publicClient: PublicClient;
}

let cached: CacheEntry | null = null;

interface EthexeApiOptions {
  varaEthRpc?: string;
  ethereumRpc?: string;
  routerAddress?: Address;
  /** Resolved Vara.eth network preset (from --network flag, lowest precedence). */
  networkPreset?: { varaEthRpc: string; ethereumRpc: string; routerAddress: `0x${string}` | null };
}

const BROADCAST_CANDIDATE_NAMES = new Set(['run-latest.json', 'broadcast.log.json']);
const BROADCAST_SKIP_DIRS = new Set(['.git', '.claude', '.wolf', 'build', 'dist', 'node_modules', 'target']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asAddress(value: unknown): Address | undefined {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value) ? (value as Address) : undefined;
}

function findBroadcastArtifacts(root = process.cwd()): string[] {
  const artifacts: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Array<import('node:fs').Dirent>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!BROADCAST_SKIP_DIRS.has(entry.name)) {
          stack.push(fullPath);
        }
        continue;
      }
      if (BROADCAST_CANDIDATE_NAMES.has(entry.name) && fullPath.includes(`${path.sep}broadcast${path.sep}`)) {
        artifacts.push(fullPath);
      }
    }
  }

  return artifacts.sort((a, b) => a.localeCompare(b));
}

function discoverLocalRouterAddress(root = process.cwd()): Address | undefined {
  for (const artifactPath of findBroadcastArtifacts(root)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(artifactPath, 'utf8'));
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;

    const receiptByHash = new Map<string, Address>();
    if (Array.isArray(parsed.receipts)) {
      for (const receipt of parsed.receipts) {
        if (!isRecord(receipt)) continue;
        const txHash = typeof receipt.transactionHash === 'string' ? receipt.transactionHash.toLowerCase() : undefined;
        const contractAddress = asAddress(receipt.contractAddress);
        if (txHash && contractAddress) {
          receiptByHash.set(txHash, contractAddress);
        }
      }
    }

    if (!Array.isArray(parsed.transactions)) continue;
    const fallback: Address[] = [];
    for (const tx of parsed.transactions) {
      if (!isRecord(tx)) continue;
      const contractName = typeof tx.contractName === 'string' ? tx.contractName : '';
      const txAddress = asAddress(tx.contractAddress);
      const txHash = typeof tx.hash === 'string' ? tx.hash.toLowerCase() : undefined;
      const receiptAddress = txHash ? receiptByHash.get(txHash) : undefined;
      const address = txAddress ?? receiptAddress;
      if (!address) continue;

      if (/router/i.test(contractName)) {
        return address;
      }
      fallback.push(address);
    }

    if (fallback.length === 1) {
      return fallback[0];
    }
  }

  return undefined;
}

/**
 * Resolves the Vara.eth endpoint stack from explicit options → env vars → config → network preset.
 *
 * Required: `varaEthRpc` (WS), `ethereumRpc` (WS), `routerAddress` (0x-hex).
 * Throws {@link CliError} with `MISSING_ETHEXE_CONFIG` if any are missing.
 */
export function resolveEthexeConfig(options: EthexeApiOptions = {}): {
  varaEthRpc: string;
  ethereumRpc: string;
  routerAddress: Address;
} {
  const config = readConfig();
  const preset = options.networkPreset;
  // VARA_ETH_NETWORK_PRESET_* are set by app.ts preAction when --network is used with --chain vara-eth.
  // They act as lowest-priority fallback below explicit options, env vars, and config.
  const presetVaraEthRpc = preset?.varaEthRpc ?? process.env.VARA_ETH_NETWORK_PRESET_VARA_ETH_RPC;
  const presetEthereumRpc = preset?.ethereumRpc ?? process.env.VARA_ETH_NETWORK_PRESET_ETHEREUM_RPC;
  const presetRouter = preset?.routerAddress ?? (process.env.VARA_ETH_NETWORK_PRESET_ROUTER as Address | undefined);

  const varaEthRpc = options.varaEthRpc ?? process.env.VARA_ETH_RPC ?? config.varaEthRpc ?? presetVaraEthRpc;
  const ethereumRpc = options.ethereumRpc ?? process.env.ETHEREUM_RPC ?? config.ethereumRpc ?? presetEthereumRpc;
  let routerAddress =
    options.routerAddress ??
    (process.env.VARA_ETH_ROUTER as Address | undefined) ??
    config.routerAddress ??
    presetRouter;

  if (!routerAddress && preset?.routerAddress === null) {
    routerAddress = discoverLocalRouterAddress();
  }

  if (!varaEthRpc || !ethereumRpc || !routerAddress) {
    const missing: string[] = [];
    if (!varaEthRpc) missing.push('varaEthRpc (env: VARA_ETH_RPC)');
    if (!ethereumRpc) missing.push('ethereumRpc (env: ETHEREUM_RPC)');
    if (!routerAddress) missing.push('routerAddress (env: VARA_ETH_ROUTER)');
    throw new CliError(
      `Ethexe is not configured. Missing: ${missing.join(', ')}. Set via env vars or "vara-wallet config set …".`,
      'MISSING_ETHEXE_CONFIG',
      { missing },
    );
  }

  return { varaEthRpc, ethereumRpc, routerAddress };
}

/**
 * Returns a cached `VaraEthApi` for the current process. Within one CLI
 * invocation every caller shares the same instance; on the second call the
 * supplied options are ignored — only the first call's resolution wins.
 */
export async function getEthexeApi(options: EthexeApiOptions = {}): Promise<VaraEthApi> {
  if (cached) return cached.api;

  const cfg = resolveEthexeConfig(options);

  const ws = new WsVaraEthProvider(cfg.varaEthRpc);
  await ws.connect();

  const publicClient = createPublicClient({ transport: webSocket(cfg.ethereumRpc) }) as PublicClient;

  const api = await createVaraEthApi(ws, publicClient, cfg.routerAddress);

  cached = { api, ws, publicClient };
  return api;
}

/**
 * Builds a `MirrorClient` for the given program address, reusing the cached
 * `publicClient` from {@link getEthexeApi}. Optional `signer` switches the
 * client into write mode.
 */
export async function getMirrorClient(address: Address, signer?: ITransactionSigner): Promise<MirrorClient> {
  const api = await getEthexeApi();
  return makeMirrorClient({ address, publicClient: api.eth.publicClient, signer });
}

/** Tears down the cached Vara.eth connections. Safe to call when nothing is open. */
export function disconnectEthexeApi(): void {
  if (!cached) return;
  try {
    cached.ws.disconnect?.();
  } catch {
    // ignore — disconnect during shutdown
  }
  cached = null;
}
