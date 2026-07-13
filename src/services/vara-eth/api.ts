/**
 * Ethexe API singleton.
 *
 * Mirrors the substrate `services/api.ts` shape: a single cached `VaraEthApi`
 * instance per-process keyed by RPC endpoint. Falls back through the CLI
 * network preset, env vars, and config file when no explicit endpoint is supplied.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { createPublicClient, http, webSocket, type Address, type PublicClient } from 'viem';
import {
  createVaraEthApi,
  WsVaraEthProvider,
  getMirrorClient as makeMirrorClient,
  type ITransactionSigner,
  type MirrorClient,
  type VaraEthApi,
} from '@vara-eth/api';

import { CliError, classifyTransportError } from '../../utils/errors';
import { readConfig } from '../config';
import { resolveVaraEthNetwork } from '../../chains/vara-eth/networks';
import { markStage } from '../../utils/timing';

interface CacheEntry {
  api: VaraEthApi;
  ws: WsVaraEthProvider;
}

let cached: CacheEntry | null = null;

const ETHEXE_CONNECTION_TIMEOUT_MS = 10_000;

export interface EthexeApiOptions {
  varaEthRpc?: string;
  ethereumRpc?: string;
  ethereumHttpRpc?: string;
  /** Use WebSocket only for long-lived event streams; requests prefer HTTP. */
  ethereumTransport?: 'request' | 'stream';
  routerAddress?: Address;
  /** Resolved Vara.eth network preset from --network. */
  networkPreset?: {
    varaEthRpc: string;
    ethereumRpc: string;
    ethereumHttpRpc?: string;
    routerAddress: `0x${string}` | null;
  };
}

const BROADCAST_CANDIDATE_NAMES = new Set(['run-latest.json', 'broadcast.log.json']);
const BROADCAST_SKIP_DIRS = new Set(['.git', '.claude', '.wolf', 'build', 'dist', 'node_modules', 'target']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asAddress(value: unknown): Address | undefined {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value) ? (value as Address) : undefined;
}

function withEthexeConnectionTimeout<T>(
  promise: Promise<T>,
  endpoint: string | (() => string),
  cleanupAfterTimeout?: () => void,
): Promise<T> {
  let didTimeout = false;
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        didTimeout = true;
        cleanupAfterTimeout?.();
        const timedOutEndpoint = typeof endpoint === 'function' ? endpoint() : endpoint;
        reject(new CliError(
          `Connection to ${timedOutEndpoint} timed out after 10s. Check your configured RPC endpoints.`,
          'CONNECTION_TIMEOUT',
        ));
      },
      ETHEXE_CONNECTION_TIMEOUT_MS,
    );
  });
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
      if (didTimeout) cleanupAfterTimeout?.();
    }),
    timeoutPromise,
  ]);
}

function errorMentionsEndpoint(error: unknown, endpoint: string): boolean {
  const seen = new Set<object>();
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (typeof current === 'string') return current.includes(endpoint);
    if (typeof current !== 'object' || seen.has(current)) return false;
    seen.add(current);
    const wrapped = current as { message?: unknown; cause?: unknown };
    if (typeof wrapped.message === 'string' && wrapped.message.includes(endpoint)) return true;
    current = wrapped.cause;
  }
  return false;
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
 * Required: `varaEthRpc` (WS), `ethereumRpc`, `routerAddress` (0x-hex).
 * `ethereumHttpRpc` is optional and used for one-shot requests when available.
 * Throws {@link CliError} with `MISSING_ETHEXE_CONFIG` if any are missing.
 */
export function resolveEthexeConfig(options: EthexeApiOptions = {}): {
  varaEthRpc: string;
  ethereumRpc: string;
  ethereumHttpRpc?: string;
  routerAddress: Address;
} {
  const config = readConfig();
  const configPreset = config.varaEthNetwork ? resolveVaraEthNetwork(config.varaEthNetwork) : undefined;
  const hasCliPreset = options.networkPreset !== undefined ||
    Boolean(process.env.VARA_ETH_NETWORK_PRESET_VARA_ETH_RPC || process.env.VARA_ETH_NETWORK_PRESET_ETHEREUM_RPC);
  const cliPresetVaraEthRpc = options.networkPreset?.varaEthRpc ?? process.env.VARA_ETH_NETWORK_PRESET_VARA_ETH_RPC;
  const cliPresetEthereumRpc = options.networkPreset?.ethereumRpc ?? process.env.VARA_ETH_NETWORK_PRESET_ETHEREUM_RPC;
  const cliPresetEthereumHttpRpc = options.networkPreset?.ethereumHttpRpc
    ?? process.env.VARA_ETH_NETWORK_PRESET_ETHEREUM_HTTP_RPC;
  const cliPresetRouter =
    options.networkPreset?.routerAddress ??
    (process.env.VARA_ETH_NETWORK_PRESET_ROUTER as Address | undefined);

  const varaEthRpc = options.varaEthRpc ?? cliPresetVaraEthRpc ?? process.env.VARA_ETH_RPC ?? config.varaEthRpc ?? configPreset?.varaEthRpc;
  const ethereumRpc = options.ethereumRpc ?? cliPresetEthereumRpc ?? process.env.ETHEREUM_RPC ?? config.ethereumRpc ?? configPreset?.ethereumRpc;
  const matchingCliPresetHttpRpc = ethereumRpc === cliPresetEthereumRpc ? cliPresetEthereumHttpRpc : undefined;
  let ethereumHttpRpc = options.ethereumHttpRpc ?? matchingCliPresetHttpRpc ?? process.env.ETHEREUM_HTTP_RPC;
  if (!ethereumHttpRpc && !hasCliPreset && !options.ethereumRpc && ethereumRpc === configPreset?.ethereumRpc) {
    ethereumHttpRpc = configPreset?.ethereumHttpRpc;
  }
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

  return { varaEthRpc, ethereumRpc, ethereumHttpRpc, routerAddress };
}

function createEthereumPublicClient(
  endpoint: string,
  configKey: 'ethereumRpc' | 'ethereumHttpRpc',
): PublicClient {
  if (/^https?:\/\//i.test(endpoint)) {
    return createPublicClient({ transport: http(endpoint) }) as PublicClient;
  }
  if (/^wss?:\/\//i.test(endpoint)) {
    return createPublicClient({ transport: webSocket(endpoint) }) as PublicClient;
  }
  throw new CliError(
    `Unsupported Ethereum RPC URL "${endpoint}". Expected http(s):// or ws(s)://.`,
    'INVALID_CONFIG_VALUE',
    { key: configKey, value: endpoint },
  );
}

/**
 * Returns a cached `VaraEthApi` for the current process. Within one CLI
 * invocation every caller shares the same instance; on the second call the
 * supplied options are ignored — only the first call's resolution wins.
 */
export async function getEthexeApi(options: EthexeApiOptions = {}): Promise<VaraEthApi> {
  if (cached) return cached.api;

  const cfg = resolveEthexeConfig(options);
  const usesEthereumHttpRpc = options.ethereumTransport !== 'stream' && cfg.ethereumHttpRpc !== undefined;
  const ethereumEndpoint = usesEthereumHttpRpc ? cfg.ethereumHttpRpc! : cfg.ethereumRpc;
  const ethereumConfigKey = usesEthereumHttpRpc ? 'ethereumHttpRpc' : 'ethereumRpc';
  const ethereumTransport = /^https?:\/\//i.test(ethereumEndpoint) ? 'http' : 'websocket';
  markStage('vara_eth_config', { ethereumTransport });

  const ws = new WsVaraEthProvider(cfg.varaEthRpc);
  const disconnectWs = () => {
    try {
      const disconnect = ws.disconnect?.();
      void disconnect?.catch(() => {});
    } catch {
      // ignore failed cleanup after connect/bootstrap failure
    }
  };
  let validatorConnected = false;
  const timeoutEndpoint = () => validatorConnected ? ethereumEndpoint : cfg.varaEthRpc;
  let api: VaraEthApi;
  try {
    const publicClient = createEthereumPublicClient(ethereumEndpoint, ethereumConfigKey);
    const [, initializedApi] = await withEthexeConnectionTimeout(
      Promise.all([
        ws.connect().then(() => {
          validatorConnected = true;
        }),
        createVaraEthApi(ws, publicClient, cfg.routerAddress),
      ]),
      timeoutEndpoint,
      disconnectWs,
    );
    api = initializedApi;
    markStage('vara_eth_connect', { ethereumTransport });
  } catch (rawErr) {
    if (!(rawErr instanceof CliError && rawErr.code === 'CONNECTION_TIMEOUT')) disconnectWs();
    const failedEndpoint = rawErr instanceof CliError && rawErr.code === 'CONNECTION_TIMEOUT'
      ? timeoutEndpoint()
      : (errorMentionsEndpoint(rawErr, ethereumEndpoint) ? ethereumEndpoint : cfg.varaEthRpc);
    throw classifyTransportError(rawErr, { endpoint: failedEndpoint }) ?? rawErr;
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
