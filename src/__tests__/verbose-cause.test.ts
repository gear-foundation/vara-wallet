import { setOutputOptions } from '../utils/output';
import { CliError, outputError } from '../utils/errors';

describe('outputError --verbose cause echo (issue #58)', () => {
  let stderrWrites: string[] = [];
  let origStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    stderrWrites = [];
    origStderrWrite = process.stderr.write.bind(process.stderr);
    (process.stderr.write as any) = (chunk: any) => {
      stderrWrites.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    };
  });

  afterEach(() => {
    (process.stderr.write as any) = origStderrWrite;
    setOutputOptions({});
  });

  it('writes a [verbose] cause line before the structured JSON when --verbose is set', () => {
    setOutputOptions({ verbose: true });
    const err = new CliError('Cannot resolve host bad.example', 'TRANSPORT_ERROR', {
      reason: 'dns_failure',
      endpoint: 'wss://bad.example',
      host: 'bad.example',
      cause: 'getaddrinfo ENOTFOUND bad.example',
    });
    outputError(err);

    expect(stderrWrites.length).toBeGreaterThanOrEqual(2);
    const verboseLine = stderrWrites[0];
    const jsonLine = stderrWrites[stderrWrites.length - 1];

    expect(verboseLine).toMatch(/^\[verbose\] cause:/);
    expect(verboseLine).toContain('dns_failure');
    // Verbose line precedes the JSON payload.
    expect(jsonLine).toContain('"code":"TRANSPORT_ERROR"');
    expect(jsonLine).toContain('"reason":"dns_failure"');
  });

  it('does NOT write the [verbose] line when --verbose is unset', () => {
    setOutputOptions({});
    const err = new CliError('boom', 'TRANSPORT_ERROR', { reason: 'unknown' });
    outputError(err);
    const hasVerbose = stderrWrites.some(w => w.startsWith('[verbose]'));
    expect(hasVerbose).toBe(false);
    // The JSON still goes out.
    expect(stderrWrites.some(w => w.includes('"code":"TRANSPORT_ERROR"'))).toBe(true);
  });

  it('swallows EPIPE / closed-stderr errors from the verbose write without crashing', () => {
    setOutputOptions({ verbose: true });
    let calls = 0;
    (process.stderr.write as any) = () => {
      calls++;
      // First write (the verbose line) throws EPIPE. Subsequent calls succeed
      // so the structured JSON can still surface to a non-closed sink.
      if (calls === 1) {
        const e: any = new Error('write EPIPE');
        e.code = 'EPIPE';
        throw e;
      }
      return true;
    };
    expect(() => {
      outputError(new CliError('boom', 'TRANSPORT_ERROR', { reason: 'unknown' }));
    }).not.toThrow();
    // The verbose write was attempted, swallowed; we don't assert the JSON
    // succeeded — only that no crash escapes outputError.
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it('emits UNKNOWN_ERROR for a raw context-less {} payload — outputError will not invent a transport claim', () => {
    // A bare {} reaching outputError without endpoint/cause hints stays
    // UNKNOWN_ERROR; the transport classification happens at the api.ts catch
    // site where ctx.endpoint is known (covered by light-client + errors tests).
    setOutputOptions({});
    outputError({});
    const jsonLine = stderrWrites[stderrWrites.length - 1];
    expect(jsonLine).toContain('"code":"UNKNOWN_ERROR"');
  });
});
