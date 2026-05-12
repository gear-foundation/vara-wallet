import { GearApi } from '@gear-js/api';
import { WsProvider } from '@polkadot/api';
import { lookup as dnsLookup } from 'node:dns/promises';
import { verbose, CliError, errorMessage, markStage, classifyTransportError } from '../utils';
import { readConfig } from './config';
import { SmoldotProvider } from './light-client';
import { buildCacheKey, clearMetadataCache, loadMetadataCache, saveMetadataIfNew } from './metadata-cache';

let apiPromise: Promise<GearApi> | null = null;
let apiInstance: GearApi | null = null;
let lightProvider: SmoldotProvider | null = null;
let isDisconnecting = false;

const CONNECTION_TIMEOUT_MS = 10_000;

export function isShuttingDown(): boolean {
  return isDisconnecting;
}

const DEFAULT_ENDPOINT = 'wss://rpc.vara.network';

/**
 * Heuristic: does this error look like @polkadot/api rejected our cached
 * metadata blob (vs. a network/timeout error)? Used to gate the "clear
 * cache and retry without it" recovery path. Substring match because the
 * error path crosses several layers of wrapping inside polkadot/api and
 * the surface message is the only stable handle. Kept narrow on purpose
 * — `'unable to initialize the api'` was tempting but matches genesis-fetch
 * and provider-init failures too, which would clear a perfectly good cache
 * on a transient network error.
 */
function isMetadataError(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  return (
    msg.includes('magicnumber') ||
    msg.includes('magic number') ||
    msg.includes('unable to decode metadata') ||
    msg.includes('metadata version')
  );
}

/**
 * Post-mortem cause probe. Node's built-in WebSocket (used by recent
 * @polkadot/api) sanitizes the underlying error to "Received network error
 * or non-101 status code", so neither the rejection nor the on('error')
 * listener exposes the real socket error code. After a WS connect fails,
 * we do a quick DNS lookup on the endpoint host — if that resolves, the
 * root cause was almost certainly handshake / protocol; if it doesn't, the
 * root cause was DNS. Only runs on the failure path; the success path is
 * untouched. Best-effort: a probe that itself errors out is ignored.
 */
async function probeTransportCause(
  endpoint: string,
  existing: { code?: string; message?: string } | undefined,
): Promise<{ code?: string; message?: string } | undefined> {
  // If we already have a real socket error code from the listener, don't probe.
  if (existing?.code && existing.code !== 'unknown') return existing;
  let host: string | undefined;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return existing;
  }
  if (!host) return existing;
  try {
    await dnsLookup(host);
    // Host resolves — connect failed for some other reason (TLS, protocol,
    // refused). Leave the existing/raw cause in place.
    return existing;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return { code, message: `getaddrinfo ${code} ${host}` };
    }
    return existing;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CliError(message, 'CONNECTION_TIMEOUT')), ms);
  });
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    timeoutPromise,
  ]);
}

export async function getApi(wsEndpoint?: string): Promise<GearApi> {
  const config = readConfig();
  const endpoint = wsEndpoint || process.env.VARA_WS || config.wsEndpoint || DEFAULT_ENDPOINT;
  const useLightClient = process.env.VARA_LIGHT === '1' || endpoint === 'light';

  if (!apiPromise) {
    if (useLightClient) {
      verbose('Starting light client (smoldot)...');
      lightProvider = new SmoldotProvider();
      const connectPromise = (async () => {
        await withTimeout(
          lightProvider!.connect(),
          CONNECTION_TIMEOUT_MS,
          'Light client failed to connect after 10s. Use --ws instead.',
        );
        verbose('Light client connected, initializing API...');
        const api = await GearApi.create({ provider: lightProvider as any });
        apiInstance = api;
        verbose(`Light client ready (spec: ${api.specVersion})`);
        return api;
      })();
      apiPromise = connectPromise.catch((err) => {
        apiPromise = null;
        apiInstance = null;
        throw err;
      });
    } else {
      verbose(`Connecting to ${endpoint}`);
      // Load on-disk metadata cache. polkadot/api will skip the
      // state_getMetadata RPC if a `${genesisHash}-${specVersion}` key
      // matches the chain it's about to connect to. Auto-invalidates
      // via state_subscribeRuntimeVersion on a runtime upgrade.
      const cachedMetadata = loadMetadataCache();
      const cachedKeyCount = Object.keys(cachedMetadata).length;
      markStage('connect_begin', { endpoint, cachedMetadataKeys: cachedKeyCount });
      const connectPromise = (async (): Promise<GearApi> => {
        // Construct WsProvider explicitly (instead of GearApi.create({ providerAddress }))
        // so we can attach an error listener and capture the underlying Node
        // socket error code (ENOTFOUND / ECONNREFUSED / ETIMEDOUT) before
        // WsProvider's browser-style Event rejection laundering strips it.
        const provider = new WsProvider(endpoint, /* autoConnect */ false);
        let lastSocketError: { code?: string; message?: string } | undefined;
        const unsubError = provider.on('error', (e: unknown) => {
          const anyE = e as { code?: string; message?: string; error?: { code?: string; message?: string } };
          lastSocketError = {
            code: anyE?.error?.code ?? anyE?.code,
            message: anyE?.message ?? anyE?.error?.message ?? String(e),
          };
        });

        const attemptConnect = async (metadata: Record<string, `0x${string}`>): Promise<GearApi> => {
          // Clear any cause captured by a prior attempt — the metadata-cache
          // retry calls attemptConnect twice and stale state would otherwise
          // leak into the second attempt's classification.
          lastSocketError = undefined;
          try {
            // WsProvider.connect() can resolve before the WS handshake
            // actually completes; transport failures surface inside
            // GearApi.create rather than in our explicit provider.connect().
            // Both have to be inside the catch.
            await withTimeout(
              provider.connect(),
              CONNECTION_TIMEOUT_MS,
              `Connection to ${endpoint} timed out after 10s. Check your network or VARA_WS setting.`,
            );
            return await withTimeout(
              GearApi.create({ provider, metadata }),
              CONNECTION_TIMEOUT_MS,
              `Connection to ${endpoint} timed out after 10s. Check your network or VARA_WS setting.`,
            );
          } catch (rawErr) {
            // Metadata-cache mismatch errors must propagate raw so the caller
            // can detect them via isMetadataError() and retry with an empty
            // cache.
            if (isMetadataError(rawErr)) throw rawErr;
            // Post-mortem DNS probe: Node's built-in WebSocket sanitizes
            // the underlying error to "Received network error or non-101
            // status code", so we can't read .code directly. A quick
            // dns.lookup on the endpoint host disambiguates DNS failure
            // from protocol mismatch. Failure path only.
            const probed = await probeTransportCause(endpoint, lastSocketError);
            const cli = classifyTransportError(rawErr, {
              endpoint,
              cause: probed ?? lastSocketError,
            });
            throw cli ?? rawErr;
          }
        };

        let api: GearApi;
        try {
          try {
            api = await attemptConnect(cachedMetadata);
          } catch (err) {
            // Cached metadata that passed magic-byte validation but trips
            // @polkadot/api's deeper Metadata wrap (e.g. version/struct
            // mismatch in a future polkadot/api). Clear and retry once
            // without cache so the user isn't stuck with a poisoned entry.
            if (cachedKeyCount > 0 && isMetadataError(err)) {
              verbose(
                `metadata-cache: connect failed with cached metadata (${errorMessage(err)}); clearing cache and retrying`,
              );
              clearMetadataCache();
              // Disconnect the existing provider so retry uses a clean state.
              try { await provider.disconnect(); } catch { /* ignore */ }
              api = await attemptConnect({});
            } else {
              throw err;
            }
          }
        } catch (err) {
          // Terminal connect failure: release the WS handle and background
          // heartbeat timers WsProvider keeps alive even after a rejected
          // connect. Without this the process can hang on exit until the
          // ~1.7s heartbeat clears (fastExit helps but doesn't substitute
          // for proper teardown).
          try { await provider.disconnect(); } catch { /* ignore */ }
          throw err;
        } finally {
          // Detach the connect-time error listener now that the handshake
          // outcome is known. Runtime errors mid-call surface through
          // formatError's transport fallback instead.
          try { unsubError(); } catch { /* ignore */ }
        }
        apiInstance = api;
        verbose(`Connected to ${endpoint} (spec: ${api.specVersion})`);
        const key = buildCacheKey(api.genesisHash.toHex(), api.runtimeVersion.specVersion.toString());
        const cacheHit = cachedMetadata[key] !== undefined;
        markStage('connect', { spec: api.specVersion, cacheHit });
        // Best-effort cache write. Idempotent; only writes if missing.
        saveMetadataIfNew(api);
        return api;
      })();
      apiPromise = connectPromise.catch((err) => {
        apiPromise = null;
        apiInstance = null;
        throw err;
      });
    }
  }

  return apiPromise;
}

// Filter @polkadot's RPC-CORE disconnect noise from stderr.
// The logger writes through console.error() → process.stderr.write().
// Patching at the stderr level is simpler and guaranteed to catch it
// regardless of how esbuild bundles module scopes.
const origStderrWrite = process.stderr.write.bind(process.stderr);
const rpcCoreRe = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s+RPC-CORE:/;
process.stderr.write = ((...args: unknown[]) => {
  const chunk = args[0];
  const s = typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString();
  if (rpcCoreRe.test(s)) return true;
  return (origStderrWrite as (...a: unknown[]) => boolean)(...args);
}) as typeof process.stderr.write;

export function disconnectApi(): void {
  isDisconnecting = true;

  // Disconnect light client first to avoid race conditions
  // where @polkadot/api tries to resubscribe during teardown
  if (lightProvider) {
    lightProvider.disconnect().catch(() => {});
    lightProvider = null;
  }

  if (apiInstance) {
    try {
      apiInstance.disconnect();
    } catch {
      // Ignore disconnect errors during shutdown
    }
    apiInstance = null;
    apiPromise = null;
  }
}

// Clean up on exit (signal handlers are in app.ts)
process.on('exit', disconnectApi);
