import type { GearApi } from '@gear-js/api';
import { CliError, classifyTransportError, formatError } from '../utils/errors';
import { __testing } from '../services/api';
import { setOutputOptions } from '../utils/output';

const { retryConnect, isRetriableTransportError, jitteredBackoff, isNoRetry } = __testing;

// Test the withTimeout pattern used in api.ts
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

describe('withTimeout', () => {
  it('resolves when promise completes before timeout', async () => {
    const result = await withTimeout(
      Promise.resolve('ok'),
      1000,
      'Should not fire',
    );
    expect(result).toBe('ok');
  });

  it('rejects with CONNECTION_TIMEOUT when promise is too slow', async () => {
    jest.useFakeTimers();
    const slow = new Promise<string>(() => {}); // never resolves
    const promise = withTimeout(slow, 50, 'Timed out');
    jest.advanceTimersByTime(60);
    await expect(promise).rejects.toThrow('Timed out');
    jest.useRealTimers();
  });

  it('has correct error code on timeout', async () => {
    jest.useFakeTimers();
    const slow = new Promise<string>(() => {});
    const promise = withTimeout(slow, 50, 'Timed out');
    jest.advanceTimersByTime(60);
    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).code).toBe('CONNECTION_TIMEOUT');
    }
    jest.useRealTimers();
  });

  it('clears timer on fast resolution (no leaked timers)', async () => {
    const clearSpy = jest.spyOn(global, 'clearTimeout');
    await withTimeout(Promise.resolve(42), 10000, 'msg');
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('propagates original errors (not timeout) when promise rejects fast', async () => {
    const failing = Promise.reject(new Error('original'));
    await expect(
      withTimeout(failing, 10000, 'timeout msg'),
    ).rejects.toThrow('original');
  });

  it('clears timer on fast rejection (no leaked timers)', async () => {
    const clearSpy = jest.spyOn(global, 'clearTimeout');
    const failing = Promise.reject(new Error('fast fail'));
    await withTimeout(failing, 10000, 'msg').catch(() => {});
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  describe('CONNECTION_TIMEOUT → TRANSPORT_ERROR migration (issue #58)', () => {
    it('classifyTransportError remaps CONNECTION_TIMEOUT to TRANSPORT_ERROR / timeout', () => {
      const sentinel = new CliError('Connection timed out', 'CONNECTION_TIMEOUT');
      const remapped = classifyTransportError(sentinel, { endpoint: 'wss://rpc.vara.network' });
      expect(remapped).not.toBeNull();
      expect(remapped!.code).toBe('TRANSPORT_ERROR');
      expect(remapped!.meta?.reason).toBe('timeout');
      expect(remapped!.meta?.endpoint).toBe('wss://rpc.vara.network');
    });

    it('end-to-end: api.ts wraps the CONNECTION_TIMEOUT sentinel before it reaches the user', () => {
      // Simulates the api.ts attemptConnect catch path: when withTimeout fires
      // its CONNECTION_TIMEOUT, api.ts runs classifyTransportError(...) over it
      // and throws the migrated CliError. The user-facing output is then
      // TRANSPORT_ERROR { reason: 'timeout' }, never the internal sentinel.
      const sentinel = new CliError('Timed out', 'CONNECTION_TIMEOUT');
      const userFacing = classifyTransportError(sentinel, { endpoint: 'wss://example' }) ?? sentinel;
      const json = formatError(userFacing);
      expect(json.code).toBe('TRANSPORT_ERROR');
      expect(json.reason).toBe('timeout');
    });
  });
});

const ENDPOINT = 'wss://rpc.vara.network';
const transient = (reason: 'timeout' | 'ws_close_abnormal') =>
  new CliError(`transport ${reason}`, 'TRANSPORT_ERROR', { reason, endpoint: ENDPOINT });
const permanent = (reason: string) =>
  new CliError(`transport ${reason}`, 'TRANSPORT_ERROR', { reason, endpoint: ENDPOINT });
const fakeApi = { specVersion: 'fake' } as unknown as GearApi;

describe('isNoRetry', () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.VARA_NO_RETRY;
    delete process.env.VARA_NO_RETRY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.VARA_NO_RETRY;
    else process.env.VARA_NO_RETRY = original;
  });

  it('returns false when unset', () => {
    expect(isNoRetry()).toBe(false);
  });

  it.each(['1', 'true', 'TRUE', 'True', 'yes', 'YES', 'on', 'ON', '  1  ', '1\n', '\ttrue\t'])(
    'returns true for truthy value %j',
    (value) => {
      process.env.VARA_NO_RETRY = value;
      expect(isNoRetry()).toBe(true);
    },
  );

  it.each(['', '0', 'false', 'no', 'off', 'YEP', 'two', '2'])(
    'returns false for non-truthy value %j',
    (value) => {
      process.env.VARA_NO_RETRY = value;
      expect(isNoRetry()).toBe(false);
    },
  );
});

describe('isRetriableTransportError', () => {
  it.each(['timeout', 'ws_close_abnormal'])('returns true for transient reason %s', (reason) => {
    expect(isRetriableTransportError(transient(reason as 'timeout' | 'ws_close_abnormal'))).toBe(true);
  });

  it.each(['dns_failure', 'connection_refused', 'tls_failure', 'protocol_mismatch', 'unreachable', 'unknown'])(
    'returns false for permanent reason %s',
    (reason) => {
      expect(isRetriableTransportError(permanent(reason))).toBe(false);
    },
  );

  it('returns false for non-CliError throws', () => {
    expect(isRetriableTransportError(new Error('plain'))).toBe(false);
    expect(isRetriableTransportError('string throw')).toBe(false);
    expect(isRetriableTransportError(undefined)).toBe(false);
  });

  it('returns false for non-TRANSPORT_ERROR CliError', () => {
    expect(isRetriableTransportError(new CliError('boom', 'PROGRAM_ERROR'))).toBe(false);
    expect(isRetriableTransportError(new CliError('boom', 'WALLET_NOT_FOUND'))).toBe(false);
  });

  it('returns false for TRANSPORT_ERROR with no reason in meta', () => {
    expect(isRetriableTransportError(new CliError('boom', 'TRANSPORT_ERROR'))).toBe(false);
    expect(isRetriableTransportError(new CliError('boom', 'TRANSPORT_ERROR', { reason: undefined }))).toBe(false);
  });
});

describe('jitteredBackoff', () => {
  afterEach(() => {
    jest.spyOn(Math, 'random').mockRestore?.();
  });

  it('returns 0 for zero/negative base', () => {
    expect(jitteredBackoff(0)).toBe(0);
    expect(jitteredBackoff(-100)).toBe(0);
  });

  it('Math.random=0 → delay = floor(base/2) (lower bound)', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    expect(jitteredBackoff(250)).toBe(125);
    expect(jitteredBackoff(1000)).toBe(500);
  });

  it('Math.random=0.999 → delay ≈ floor(base * 1.499) (upper bound)', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.999);
    expect(jitteredBackoff(250)).toBe(374);
    expect(jitteredBackoff(1000)).toBe(1499);
  });

  it('Math.random=0.5 → delay = base (centered)', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(jitteredBackoff(250)).toBe(250);
  });

  it('delay never negative', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      jest.spyOn(Math, 'random').mockReturnValue(r);
      expect(jitteredBackoff(250)).toBeGreaterThanOrEqual(0);
      expect(jitteredBackoff(1)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('retryConnect', () => {
  let originalNoRetry: string | undefined;
  let randomSpy: jest.SpyInstance;
  let verboseStderrSpy: jest.SpyInstance;

  beforeEach(() => {
    originalNoRetry = process.env.VARA_NO_RETRY;
    delete process.env.VARA_NO_RETRY;
    setOutputOptions({ verbose: true });
    // Pin jitter for deterministic backoff in test logs. With Math.random=0,
    // jitteredBackoff returns base/2 — so retry tests still wait real wallclock
    // (125ms for the 250ms attempt, 500ms for the 1000ms attempt). Total per
    // 3-attempt exhaustion test ≈ 625ms. Acceptable for local but slow on
    // constrained CI; if this becomes an issue, switch to jest.useFakeTimers().
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
    // Swallow stderr verbose writes to keep test output clean.
    verboseStderrSpy = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    if (originalNoRetry === undefined) delete process.env.VARA_NO_RETRY;
    else process.env.VARA_NO_RETRY = originalNoRetry;
    randomSpy.mockRestore();
    verboseStderrSpy.mockRestore();
    setOutputOptions({ verbose: false });
  });

  it('succeeds on first attempt without retry', async () => {
    const connectFn = jest.fn().mockResolvedValueOnce(fakeApi);
    const result = await retryConnect(ENDPOINT, {}, connectFn);
    expect(result).toBe(fakeApi);
    expect(connectFn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient timeout, succeeds on second attempt', async () => {
    const connectFn = jest.fn()
      .mockRejectedValueOnce(transient('timeout'))
      .mockResolvedValueOnce(fakeApi);
    const result = await retryConnect(ENDPOINT, {}, connectFn);
    expect(result).toBe(fakeApi);
    expect(connectFn).toHaveBeenCalledTimes(2);
  });

  it('retries on transient ws_close_abnormal, succeeds on second attempt', async () => {
    const connectFn = jest.fn()
      .mockRejectedValueOnce(transient('ws_close_abnormal'))
      .mockResolvedValueOnce(fakeApi);
    const result = await retryConnect(ENDPOINT, {}, connectFn);
    expect(result).toBe(fakeApi);
    expect(connectFn).toHaveBeenCalledTimes(2);
  });

  it('retries twice, succeeds on third attempt', async () => {
    const connectFn = jest.fn()
      .mockRejectedValueOnce(transient('timeout'))
      .mockRejectedValueOnce(transient('timeout'))
      .mockResolvedValueOnce(fakeApi);
    const result = await retryConnect(ENDPOINT, {}, connectFn);
    expect(result).toBe(fakeApi);
    expect(connectFn).toHaveBeenCalledTimes(3);
  });

  it('3-attempt exhaustion: three transients → throws last error', async () => {
    const final = transient('timeout');
    const connectFn = jest.fn()
      .mockRejectedValueOnce(transient('timeout'))
      .mockRejectedValueOnce(transient('timeout'))
      .mockRejectedValueOnce(final);
    await expect(retryConnect(ENDPOINT, {}, connectFn)).rejects.toBe(final);
    expect(connectFn).toHaveBeenCalledTimes(3);
  });

  it.each(['dns_failure', 'connection_refused', 'tls_failure', 'protocol_mismatch', 'unreachable', 'unknown'])(
    'fails fast on permanent reason %s (single attempt)',
    async (reason) => {
      const err = permanent(reason);
      const connectFn = jest.fn().mockRejectedValueOnce(err);
      await expect(retryConnect(ENDPOINT, {}, connectFn)).rejects.toBe(err);
      expect(connectFn).toHaveBeenCalledTimes(1);
    },
  );

  it('VARA_NO_RETRY=1 disables retry even on transient', async () => {
    process.env.VARA_NO_RETRY = '1';
    const err = transient('timeout');
    const connectFn = jest.fn().mockRejectedValueOnce(err);
    await expect(retryConnect(ENDPOINT, {}, connectFn)).rejects.toBe(err);
    expect(connectFn).toHaveBeenCalledTimes(1);
  });

  it.each(['1', 'true', 'TRUE', 'yes', 'YES', 'on', 'ON', ' true ', '  1\n'])(
    'VARA_NO_RETRY=%j disables retry (truthy spelling)',
    async (value) => {
      process.env.VARA_NO_RETRY = value;
      const err = transient('timeout');
      const connectFn = jest.fn().mockRejectedValueOnce(err);
      await expect(retryConnect(ENDPOINT, {}, connectFn)).rejects.toBe(err);
      expect(connectFn).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['', '0', 'false', 'no', 'off', 'yep', 'sure', '2'])(
    'VARA_NO_RETRY=%j keeps retry enabled (non-truthy spelling)',
    async (value) => {
      process.env.VARA_NO_RETRY = value;
      const connectFn = jest.fn()
        .mockRejectedValueOnce(transient('timeout'))
        .mockResolvedValueOnce(fakeApi);
      const result = await retryConnect(ENDPOINT, {}, connectFn);
      expect(result).toBe(fakeApi);
      expect(connectFn).toHaveBeenCalledTimes(2);
    },
  );

  it('bails between attempts when shuttingDownFn returns true', async () => {
    const err = transient('timeout');
    const connectFn = jest.fn().mockRejectedValue(err);
    // Shutdown predicate always true → first attempt runs, then the pre-sleep
    // shutdown gate trips and rethrows lastErr without sleeping or retrying.
    await expect(
      retryConnect(ENDPOINT, {}, connectFn, () => true),
    ).rejects.toBe(err);
    expect(connectFn).toHaveBeenCalledTimes(1);
  });

  it('runs the first attempt regardless of shutdown state', async () => {
    // Shutdown predicate true from the start — attempt 1 must still run
    // (otherwise getApi could never return on a flaky startup). Only retries
    // are gated.
    const connectFn = jest.fn().mockResolvedValueOnce(fakeApi);
    const result = await retryConnect(ENDPOINT, {}, connectFn, () => true);
    expect(result).toBe(fakeApi);
    expect(connectFn).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-CliError throws without retry', async () => {
    const err = new Error('something unexpected');
    const connectFn = jest.fn().mockRejectedValueOnce(err);
    await expect(retryConnect(ENDPOINT, {}, connectFn)).rejects.toBe(err);
    expect(connectFn).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-TRANSPORT_ERROR CliError without retry', async () => {
    const err = new CliError('not a transport error', 'PROGRAM_ERROR');
    const connectFn = jest.fn().mockRejectedValueOnce(err);
    await expect(retryConnect(ENDPOINT, {}, connectFn)).rejects.toBe(err);
    expect(connectFn).toHaveBeenCalledTimes(1);
  });

  it('rethrows TRANSPORT_ERROR with no reason without retry', async () => {
    const err = new CliError('transport, but no reason', 'TRANSPORT_ERROR');
    const connectFn = jest.fn().mockRejectedValueOnce(err);
    await expect(retryConnect(ENDPOINT, {}, connectFn)).rejects.toBe(err);
    expect(connectFn).toHaveBeenCalledTimes(1);
  });

  it('emits verbose breadcrumb on each retry boundary', async () => {
    const connectFn = jest.fn()
      .mockRejectedValueOnce(transient('timeout'))
      .mockRejectedValueOnce(transient('ws_close_abnormal'))
      .mockResolvedValueOnce(fakeApi);
    await retryConnect(ENDPOINT, {}, connectFn);
    const writes = verboseStderrSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((s) => s.includes('retry'));
    expect(writes.length).toBe(2);
    // Math.random=0 → jitteredBackoff(250)=125, jitteredBackoff(1000)=500
    expect(writes[0]).toMatch(/retry 1\/2 after transport timeout \(125ms backoff\)/);
    expect(writes[1]).toMatch(/retry 2\/2 after transport ws_close_abnormal \(500ms backoff\)/);
  });

  it('composed retry: transient transport → metadata error propagates (caller handles)', async () => {
    // The transport retry kicks in on the first transient. The second
    // attempt produces a metadata error (a non-TRANSPORT_ERROR throw).
    // retryConnect stops retrying immediately and rethrows so the outer
    // caller in getApi() can detect via isMetadataError and clear cache.
    const metadataErr = new Error('Unable to decode metadata: magicNumber mismatch');
    const connectFn = jest.fn()
      .mockRejectedValueOnce(transient('timeout'))
      .mockRejectedValueOnce(metadataErr);
    await expect(retryConnect(ENDPOINT, {}, connectFn)).rejects.toBe(metadataErr);
    expect(connectFn).toHaveBeenCalledTimes(2);
  });
});
