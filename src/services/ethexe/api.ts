/**
 * Ethexe API singleton.
 *
 * Mirrors the substrate `services/api.ts` shape: a single cached `VaraEthApi`
 * instance per-process keyed by RPC endpoint. Falls back to env vars + config
 * file when no explicit endpoint is supplied.
 */

import { createPublicClient, webSocket, type Address, type PublicClient } from 'viem';
import { createVaraEthApi, HttpVaraEthProvider, WsVaraEthProvider } from '@vara-eth/api';
import type { VaraEthApi } from '@vara-eth/api';

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
}

/**
 * Resolves the ethexe endpoint stack from explicit options → env vars → config.
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
  const varaEthRpc = options.varaEthRpc ?? process.env.VARA_ETH_RPC ?? (config as { varaEthRpc?: string }).varaEthRpc;
  const ethereumRpc = options.ethereumRpc ?? process.env.ETHEREUM_RPC ?? (config as { ethereumRpc?: string }).ethereumRpc;
  const routerAddress = (options.routerAddress ??
    (process.env.VARA_ETH_ROUTER as Address | undefined) ??
    ((config as { routerAddress?: Address }).routerAddress)) as Address | undefined;

  const missing: string[] = [];
  if (!varaEthRpc) missing.push('varaEthRpc (env: VARA_ETH_RPC)');
  if (!ethereumRpc) missing.push('ethereumRpc (env: ETHEREUM_RPC)');
  if (!routerAddress) missing.push('routerAddress (env: VARA_ETH_ROUTER)');
  if (missing.length > 0) {
    throw new CliError(
      `Ethexe is not configured. Missing: ${missing.join(', ')}. Set via env vars or "vara-wallet config set …".`,
      'MISSING_ETHEXE_CONFIG',
      { missing },
    );
  }

  return { varaEthRpc: varaEthRpc!, ethereumRpc: ethereumRpc!, routerAddress: routerAddress! };
}

/**
 * Returns a cached `VaraEthApi` for the current process.
 *
 * Reuses the same instance across commands within the same CLI invocation;
 * a second call with conflicting options throws (caller's bug — split into
 * separate processes if you really need two endpoints).
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

/** Tears down the cached ethexe connections. Safe to call when nothing is open. */
export function disconnectEthexeApi(): void {
  if (!cached) return;
  try {
    cached.ws.disconnect?.();
  } catch {
    // ignore — disconnect during shutdown
  }
  cached = null;
}
