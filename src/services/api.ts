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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Transient TRANSPORT_ERROR reasons worth retrying. Permanent reasons
// (dns_failure, tls_failure, protocol_mismatch, connection_refused,
// unreachable, unknown) fail fast — retrying them just wastes wallclock.
const TRANSIENT_TRANSPORT_REASONS = new Set(['timeout', 'ws_close_abnormal']);

function isRetriableTransportError(err: unknown): boolean {
  if (!(err instanceof CliError) || err.code !== 'TRANSPORT_ERROR') return false;
  const reason = (err.meta as { reason?: string } | undefined)?.reason;
  return typeof reason === 'string' && TRANSIENT_TRANSPORT_REASONS.has(reason);
}

// Baseline backoff per retry attempt (index = attempt number; 0 = no delay
// before first attempt). ±50% jitter applied to each non-zero delay to
// prevent thundering-herd when N agents fail in lockstep against the same
// flaky endpoint.
const RETRY_BACKOFF_MS = [0, 250, 1000] as const;

/** Returns baseMs ± 50% jitter, floored and clamped >= 0. */
function jitteredBackoff(baseMs: number): number {
  if (baseMs <= 0) return 0;
  return Math.max(0, Math.floor(baseMs + (Math.random() - 0.5) * baseMs));
}

/**
 * Single connect attempt. Owns the WsProvider lifecycle: builds a fresh
 * provider, attaches the socket-error listener, attempts the handshake,
 * classifies transport failures via the post-mortem DNS probe, and
 * disconnects the provider on any failure path. Metadata-mismatch errors
 * propagate raw so the caller can clear the cache and retry.
 */
async function connectOnce(
  endpoint: string,
  metadata: Record<string, `0x${string}`>,
): Promise<GearApi> {
  const provider = new WsProvider(endpoint, /* autoConnect */ false);
  let lastSocketError: { code?: string; message?: string } | undefined;
  const unsubError = provider.on('error', (e: unknown) => {
    const anyE = e as { code?: string; message?: string; error?: { code?: string; message?: string } };
    lastSocketError = {
      code: anyE?.error?.code ?? anyE?.code,
      message: anyE?.message ?? anyE?.error?.message ?? String(e),
    };
  });
  try {
    try {
      // WsProvider.connect() can resolve before the WS handshake actually
      // completes; transport failures sometimes surface inside GearApi.create
      // rather than in our explicit provider.connect(). Both have to be
      // inside the catch.
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
      // Release the WS handle and background heartbeat timers WsProvider
      // keeps alive even after a rejected connect. Without this the process
      // can hang on exit until the ~1.7s heartbeat clears.
      try { await provider.disconnect(); } catch { /* ignore */ }

      // Metadata-cache mismatch errors propagate raw so the outer caller
      // can detect via isMetadataError() and retry with empty cache.
      if (isMetadataError(rawErr)) throw rawErr;

      // Post-mortem DNS probe: Node's built-in WebSocket sanitizes the
      // underlying error to "Received network error or non-101 status
      // code", so we can't read .code directly. A quick dns.lookup
      // disambiguates DNS failure from protocol mismatch.
      const probed = await probeTransportCause(endpoint, lastSocketError);
      const cli = classifyTransportError(rawErr, {
        endpoint,
        cause: probed ?? lastSocketError,
      });
      throw cli ?? rawErr;
    }
  } finally {
    // Detach the connect-time error listener now that the outcome is known.
    // Runtime errors mid-call surface through formatError's transport fallback
    // instead, so we don't need a long-lived listener after handshake.
    try { unsubError(); } catch { /* ignore */ }
  }
}

// Accept the common truthy spellings for VARA_NO_RETRY. A CI operator who
// writes `VARA_NO_RETRY: true` in YAML or `=yes` in shell expects the
// documented opt-out behavior; rejecting anything but the literal '1' would
// silently inflate suite wallclock 3× exactly where the operator asked for
// strict single-attempt semantics.
const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);

function isNoRetry(): boolean {
  const raw = process.env.VARA_NO_RETRY;
  if (typeof raw !== 'string') return false;
  return TRUTHY_ENV_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Wrap connectOnce with transparent retry for transient TRANSPORT_ERROR
 * subcodes (timeout, ws_close_abnormal). Permanent reasons fail fast.
 * Up to RETRY_BACKOFF_MS.length attempts total; ±50% jitter on backoff.
 * Opt-out via VARA_NO_RETRY (accepts '1', 'true', 'yes', 'on') for scripts
 * that need strict single-attempt semantics. Bails between attempts when
 * the process is shutting down (Ctrl-C) so a flaky endpoint doesn't keep
 * the CLI alive for ~30s after the operator asked to quit.
 *
 * @param connectFn Injection seam for tests; production callers should omit
 *   this and let it default to connectOnce.
 * @param shuttingDownFn Injection seam for tests; defaults to the module-level
 *   isShuttingDown() which reads disconnectApi()'s shutdown flag.
 */
async function retryConnect(
  endpoint: string,
  metadata: Record<string, `0x${string}`>,
  connectFn: (endpoint: string, metadata: Record<string, `0x${string}`>) => Promise<GearApi> = connectOnce,
  shuttingDownFn: () => boolean = isShuttingDown,
): Promise<GearApi> {
  const maxAttempts = isNoRetry() ? 1 : RETRY_BACKOFF_MS.length;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      // Bail before sleeping or making the next attempt if shutdown started
      // (Ctrl-C, exit handler) — otherwise we'd hang ~30s past the signal.
      if (shuttingDownFn()) throw lastErr;
      const baseMs = RETRY_BACKOFF_MS[attempt];
      const delay = jitteredBackoff(baseMs);
      const reason = (lastErr instanceof CliError
        ? (lastErr.meta as { reason?: string } | undefined)?.reason
        : undefined) ?? 'transient';
      verbose(`retry ${attempt}/${maxAttempts - 1} after transport ${reason} (${delay}ms backoff)`);
      if (delay > 0) await sleep(delay);
      // Second check: Ctrl-C may have landed during the sleep window.
      if (shuttingDownFn()) throw lastErr;
    }
    try {
      return await connectFn(endpoint, metadata);
    } catch (err) {
      lastErr = err;
      // Stop retrying immediately on anything non-retriable: non-CliError
      // throws, non-TRANSPORT_ERROR CliErrors (e.g. metadata mismatch), and
      // permanent TRANSPORT_ERROR reasons.
      if (!isRetriableTransportError(err)) throw err;
    }
  }
  throw lastErr;
}

// Internal helpers exported for tests. NOT part of the public API. Project
// convention: when a service module needs to expose internals to its
// `src/__tests__/` counterpart without polluting the import surface for
// commands, attach them to a single `__testing` const. Do not consume from
// production code.
export const __testing = {
  retryConnect,
  isRetriableTransportError,
  jitteredBackoff,
  isNoRetry,
  TRANSIENT_TRANSPORT_REASONS,
  RETRY_BACKOFF_MS,
  TRUTHY_ENV_VALUES,
};

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
        let api: GearApi;
        try {
          api = await retryConnect(endpoint, cachedMetadata);
        } catch (err) {
          // Cached metadata that passed magic-byte validation but trips
          // @polkadot/api's deeper Metadata wrap (e.g. version/struct
          // mismatch). Clear and retry once without cache so the user
          // isn't stuck with a poisoned entry. The empty-metadata retry
          // also gets the transient-transport retry treatment.
          if (cachedKeyCount > 0 && isMetadataError(err)) {
            verbose(
              `metadata-cache: connect failed with cached metadata (${errorMessage(err)}); clearing cache and retrying`,
            );
            clearMetadataCache();
            api = await retryConnect(endpoint, {});
          } else {
            throw err;
          }
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
