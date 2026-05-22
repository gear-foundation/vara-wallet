/**
 * Ethexe API singleton.
 *
 * Mirrors the substrate `services/api.ts` shape: a single cached `VaraEthApi`
 * instance per-process keyed by RPC endpoint. Falls back through the CLI
 * network preset, env vars, and config file when no explicit endpoint is supplied.
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

import { CliError, classifyTransportError } from '../../utils/errors';
import { readConfig } from '../config';
import { resolveVaraEthNetwork } from '../../chains/vara-eth/networks';

interface CacheEntry {
  api: VaraEthApi;
  ws: WsVaraEthProvider | HttpVaraEthProvider;
}

let cached: CacheEntry | null = null;

const ETHEXE_CONNECTION_TIMEOUT_MS = 10_000;

interface EthexeApiOptions {
  varaEthRpc?: string;
  ethereumRpc?: string;
  routerAddress?: Address;
  /** Resolved Vara.eth network preset from --network. */
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

function withEthexeConnectionTimeout<T>(promise: Promise<T>, endpoint: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new CliError(
        `Connection to ${endpoint} timed out after 10s. Check your network or VARA_ETH_RPC setting.`,
        'CONNECTION_TIMEOUT',
      )),
      ETHEXE_CONNECTION_TIMEOUT_MS,
    );
  });
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    timeoutPromise,
  ]);
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
 * Resolves the Vara.eth endpoint stack from explicit options → command-line
 * network preset → env vars → config → config network preset.
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
  const configPreset = config.varaEthNetwork ? resolveVaraEthNetwork(config.varaEthNetwork) : undefined;
  const hasCliPreset = options.networkPreset !== undefined ||
    Boolean(process.env.VARA_ETH_NETWORK_PRESET_VARA_ETH_RPC || process.env.VARA_ETH_NETWORK_PRESET_ETHEREUM_RPC);
  const cliPresetVaraEthRpc = options.networkPreset?.varaEthRpc ?? process.env.VARA_ETH_NETWORK_PRESET_VARA_ETH_RPC;
  const cliPresetEthereumRpc = options.networkPreset?.ethereumRpc ?? process.env.VARA_ETH_NETWORK_PRESET_ETHEREUM_RPC;
  const cliPresetRouter =
    options.networkPreset?.routerAddress ??
    (process.env.VARA_ETH_NETWORK_PRESET_ROUTER as Address | undefined);

  const varaEthRpc = options.varaEthRpc ?? cliPresetVaraEthRpc ?? process.env.VARA_ETH_RPC ?? config.varaEthRpc ?? configPreset?.varaEthRpc;
  const ethereumRpc = options.ethereumRpc ?? cliPresetEthereumRpc ?? process.env.ETHEREUM_RPC ?? config.ethereumRpc ?? configPreset?.ethereumRpc;
  let routerAddress = options.routerAddress;

  if (!routerAddress && hasCliPreset) {
    routerAddress = cliPresetRouter ?? undefined;
  }
  if (!routerAddress && !hasCliPreset) {
    routerAddress = (process.env.VARA_ETH_ROUTER as Address | undefined)
      ?? config.routerAddress
      ?? configPreset?.routerAddress
      ?? undefined;
  }

  if (!routerAddress && (
    hasCliPreset ||
    (!hasCliPreset && configPreset?.routerAddress === null)
  )) {
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
  let api: VaraEthApi;
  try {
    await withEthexeConnectionTimeout(ws.connect(), cfg.varaEthRpc);

    const publicClient = createPublicClient({ transport: webSocket(cfg.ethereumRpc) }) as PublicClient;
    api = await withEthexeConnectionTimeout(
      createVaraEthApi(ws, publicClient, cfg.routerAddress),
      cfg.varaEthRpc,
    );
  } catch (rawErr) {
    try {
      ws.disconnect?.();
    } catch {
      // ignore failed cleanup after connect/bootstrap failure
    }
    throw classifyTransportError(rawErr, { endpoint: cfg.varaEthRpc }) ?? rawErr;
  }

  cached = { api, ws };
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
