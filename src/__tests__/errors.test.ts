import { CliError, formatError, classifyProgramError, classifyTransportError } from '../utils/errors';

describe('CliError', () => {
  it('stores message and code', () => {
    const err = new CliError('something broke', 'BROKEN');
    expect(err.message).toBe('something broke');
    expect(err.code).toBe('BROKEN');
    expect(err.name).toBe('CliError');
  });
});

describe('formatError', () => {
  it('formats CliError', () => {
    const err = new CliError('bad input', 'INVALID_INPUT');
    expect(formatError(err)).toEqual({ error: 'bad input', code: 'INVALID_INPUT' });
  });

  it('classifies plain connection errors as legacy CONNECTION_FAILED', () => {
    // No transport reason matches "WebSocket connection failed" alone (no ENOTFOUND/
    // ECONNREFUSED/close-code), so this falls through to the legacy classifier.
    const err = new Error('WebSocket connection failed');
    const result = formatError(err);
    expect(result.code).toBe('CONNECTION_FAILED');
  });

  it('classifies timeout errors as TRANSPORT_ERROR / timeout', () => {
    // 'timeout' in the message is a transport signal — classifyTransportError
    // now runs first in formatError and upgrades these to the new taxonomy.
    const err = new Error('Request timeout');
    const result = formatError(err);
    expect(result.code).toBe('TRANSPORT_ERROR');
    expect(result.reason).toBe('timeout');
  });

  it('classifies not-found errors', () => {
    const err = new Error('ENOENT: no such file');
    expect(formatError(err).code).toBe('NOT_FOUND');
  });

  it('sanitizes seed URIs from error messages', () => {
    const err = new Error('Failed with //Alice');
    const result = formatError(err);
    expect(result.error).not.toContain('//Alice');
    expect(result.error).toContain('//***');
  });

  it('sanitizes hex secrets from error messages', () => {
    const longHex = '0x' + 'a'.repeat(64);
    const err = new Error(`Key ${longHex} is invalid`);
    const result = formatError(err);
    expect(result.error).not.toContain(longHex);
    expect(result.error).toContain('0x***');
  });

  it('returns UNKNOWN_ERROR for non-Error values', () => {
    expect(formatError('oops')).toEqual({ error: 'oops', code: 'UNKNOWN_ERROR' });
  });

  it('serializes plain object non-Error values as JSON', () => {
    const obj = { method: 'InsufficientBalance', docs: 'Insufficient user balance.' };
    const result = formatError(obj);
    expect(result.code).toBe('UNKNOWN_ERROR');
    expect(result.error).toContain('InsufficientBalance');
    expect(result.error).toContain('Insufficient user balance.');
  });

  it('returns INTERNAL_ERROR for unclassified errors', () => {
    const err = new Error('something strange happened');
    expect(formatError(err).code).toBe('INTERNAL_ERROR');
  });

  it('decodes ERC-20 insufficient allowance contract reverts', () => {
    const spender = '0000000000000000000000000a02812883cd818ddb0db60183609da2e7685a98';
    const allowance = '0'.repeat(64);
    const needed = '0'.repeat(63) + '1';
    const err = new Error(`execution reverted: custom error 0xfb8f41b2: ${spender}${allowance}${needed}`);

    expect(formatError(err)).toEqual({
      error: 'ERC20InsufficientAllowance(0x0a02812883Cd818ddB0dB60183609Da2e7685A98, 0, 1)',
      code: 'CONTRACT_REVERT',
      reason: 'erc20_insufficient_allowance',
      contractError: 'ERC20InsufficientAllowance',
      selector: '0xfb8f41b2',
      spender: '0x0a02812883Cd818ddB0dB60183609Da2e7685A98',
      allowance: '0',
      needed: '1',
    });
  });

  it('identifies known contract errors from selector-only viem messages', () => {
    const err = new Error('The contract function reverted with the following signature:\n0xfb8f41b2');

    expect(formatError(err)).toEqual({
      error: 'ERC20InsufficientAllowance',
      code: 'CONTRACT_REVERT',
      reason: 'erc20_insufficient_allowance',
      contractError: 'ERC20InsufficientAllowance',
      selector: '0xfb8f41b2',
    });
  });

  it('merges CliError meta into the output object', () => {
    const err = new CliError('boom', 'PROGRAM_ERROR', {
      reason: 'panic',
      programMessage: 'zero error',
    });
    expect(formatError(err)).toEqual({
      error: 'boom',
      code: 'PROGRAM_ERROR',
      reason: 'panic',
      programMessage: 'zero error',
    });
  });

  it('omits meta fields when meta is absent (backward compatible shape)', () => {
    const err = new CliError('plain', 'SOME_CODE');
    const out = formatError(err);
    expect(out).toEqual({ error: 'plain', code: 'SOME_CODE' });
    expect(Object.keys(out).sort()).toEqual(['code', 'error']);
  });
});

describe('classifyProgramError', () => {
  it('classifies Rust-style panic with quoted message and extracts programMessage', () => {
    const err = new Error(
      "Program 0x1234 panicked with 'Result::unwrap() on Err value: zero error' at src/lib.rs:42",
    );
    const result = classifyProgramError(err);
    expect(result).toBeInstanceOf(CliError);
    expect(result.code).toBe('PROGRAM_ERROR');
    expect(result.meta).toEqual({
      reason: 'panic',
      programMessage: 'Result::unwrap() on Err value: zero error',
    });
  });

  it('classifies InactiveProgram errors', () => {
    const err = new Error('Program 0xabc returned InactiveProgram error');
    const result = classifyProgramError(err);
    expect(result.code).toBe('PROGRAM_ERROR');
    expect(result.meta?.reason).toBe('inactive');
  });

  it('classifies ProgramNotFound errors', () => {
    const err = new Error('ProgramNotFound: no such program');
    const result = classifyProgramError(err);
    expect(result.code).toBe('PROGRAM_ERROR');
    expect(result.meta?.reason).toBe('not_found');
  });

  it('classifies "does not exist" as not_found', () => {
    const err = new Error('Program 0xdead does not exist on-chain');
    const result = classifyProgramError(err);
    expect(result.code).toBe('PROGRAM_ERROR');
    expect(result.meta?.reason).toBe('not_found');
  });

  it('classifies "entered unreachable code" as unreachable', () => {
    const err = new Error('Program 0xfff entered unreachable code in src/svc.rs');
    const result = classifyProgramError(err);
    expect(result.code).toBe('PROGRAM_ERROR');
    expect(result.meta?.reason).toBe('unreachable');
  });

  it('falls back to PROGRAM_ERROR with no reason for unknown program errors', () => {
    const err = new Error('something went wrong inside the program');
    const result = classifyProgramError(err);
    expect(result.code).toBe('PROGRAM_ERROR');
    expect(result.meta).toBeUndefined();
  });

  it('handles non-Error thrown values', () => {
    const result = classifyProgramError({ method: 'OutOfGas' });
    expect(result.code).toBe('PROGRAM_ERROR');
    expect(result.message).toContain('OutOfGas');
  });

  it('does NOT touch transport/timeout/connection classification', () => {
    // Timeout / connection_refused now route through the new TRANSPORT_ERROR
    // taxonomy with reason subcodes (issue #58). ENOENT has no transport
    // signal so still falls through to the legacy NOT_FOUND classifier.
    const t = formatError(new Error('Request timeout'));
    expect(t.code).toBe('TRANSPORT_ERROR');
    expect(t.reason).toBe('timeout');
    const wsPlain = formatError(new Error('WebSocket connect failed'));
    // No ECONNREFUSED in the message — legacy fallback wins.
    expect(wsPlain.code).toBe('CONNECTION_FAILED');
    expect(formatError(new Error('ENOENT: no such file')).code).toBe('NOT_FOUND');
  });

  it('formatError preserves reason and programMessage for a classified panic', () => {
    const err = new Error("panicked with 'zero error'");
    const cli = classifyProgramError(err);
    const formatted = formatError(cli);
    expect(formatted.code).toBe('PROGRAM_ERROR');
    expect(formatted.reason).toBe('panic');
    expect(formatted.programMessage).toBe('zero error');
  });

  it('captures full panic message when it contains nested quotes', () => {
    const err = new Error(
      `panicked with 'user "alice" not found in registry' at src/svc.rs:99`,
    );
    const result = classifyProgramError(err);
    expect(result.meta?.reason).toBe('panic');
    expect(result.meta?.programMessage).toBe('user "alice" not found in registry');
  });

  it('does NOT classify generic "does not exist" errors (e.g. account) as not_found', () => {
    const err = new Error('Account 0xdead does not exist');
    const result = classifyProgramError(err);
    // No program-specific signature, no transport signature -> default
    // PROGRAM_ERROR with no reason. Critically, NOT { reason: 'not_found' }.
    expect(result.code).toBe('PROGRAM_ERROR');
    expect(result.meta).toBeUndefined();
  });

  it('routes program-path timeouts to TRANSPORT_ERROR / timeout', () => {
    // Simulates queryBuilder.call() rejecting because the RPC roundtrip timed out.
    // After issue #58, transport classifier runs first in classifyProgramError
    // so the contract is now TRANSPORT_ERROR { reason: 'timeout' }, NOT a bare
    // 'TIMEOUT' code. Agent contract: retry the network, do not retry the program.
    const err = new Error('Request timeout after 60s');
    const result = classifyProgramError(err);
    expect(result.code).toBe('TRANSPORT_ERROR');
    expect(result.meta?.reason).toBe('timeout');
  });

  it('routes program-path connection_refused to TRANSPORT_ERROR / connection_refused', () => {
    const err = new Error('WebSocket connect failed: ECONNREFUSED');
    const result = classifyProgramError(err);
    expect(result.code).toBe('TRANSPORT_ERROR');
    expect(result.meta?.reason).toBe('connection_refused');
  });

  it('preserves NOT_FOUND (non-transport) classification through the program path', () => {
    // ENOENT has no transport reason, so program-path classification falls
    // through to the legacy classifyError → NOT_FOUND. Critically NOT mapped
    // to PROGRAM_ERROR { reason: 'not_found' } (which requires the word "Program").
    const err = new Error('ENOENT: no such file');
    const result = classifyProgramError(err);
    expect(result.code).toBe('NOT_FOUND');
    expect(result.meta).toBeUndefined();
  });
});

describe('classifyTransportError', () => {
  it('classifies ENOTFOUND with .code as dns_failure and extracts host from endpoint', () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND nonexistent.example.invalid'), {
      code: 'ENOTFOUND',
    });
    const cli = classifyTransportError(err, { endpoint: 'wss://nonexistent.example.invalid' });
    expect(cli).not.toBeNull();
    expect(cli!.code).toBe('TRANSPORT_ERROR');
    expect(cli!.meta?.reason).toBe('dns_failure');
    expect(cli!.meta?.host).toBe('nonexistent.example.invalid');
    expect(cli!.meta?.endpoint).toBe('wss://nonexistent.example.invalid');
    expect(cli!.message).toContain('nonexistent.example.invalid');
  });

  it('falls back to extracting host from the error message when endpoint is missing', () => {
    const err = new Error('getaddrinfo ENOTFOUND bad-host.example');
    const cli = classifyTransportError(err);
    expect(cli!.meta?.reason).toBe('dns_failure');
    expect(cli!.meta?.host).toBe('bad-host.example');
  });

  it('classifies ECONNREFUSED as connection_refused', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9944'), {
      code: 'ECONNREFUSED',
    });
    const cli = classifyTransportError(err, { endpoint: 'ws://127.0.0.1:9944' });
    expect(cli!.meta?.reason).toBe('connection_refused');
  });

  it('classifies ETIMEDOUT as timeout', () => {
    const err = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const cli = classifyTransportError(err);
    expect(cli!.meta?.reason).toBe('timeout');
  });

  it('migrates the legacy CONNECTION_TIMEOUT sentinel to TRANSPORT_ERROR / timeout', () => {
    // withTimeout() in api.ts still throws a CliError(CONNECTION_TIMEOUT) as
    // its internal sentinel; the unified classifier remaps it for output.
    const legacy = new CliError('Connection timed out', 'CONNECTION_TIMEOUT');
    const cli = classifyTransportError(legacy, { endpoint: 'wss://rpc.vara.network' });
    expect(cli!.code).toBe('TRANSPORT_ERROR');
    expect(cli!.meta?.reason).toBe('timeout');
    expect(cli!.meta?.endpoint).toBe('wss://rpc.vara.network');
  });

  it('classifies WS close code 1006 in the message as ws_close_abnormal', () => {
    const err = new Error('disconnected from wss://rpc with code 1006');
    const cli = classifyTransportError(err);
    expect(cli!.meta?.reason).toBe('ws_close_abnormal');
  });

  it('classifies "Unexpected server response: 200" as protocol_mismatch', () => {
    const err = new Error('Unexpected server response: 200');
    const cli = classifyTransportError(err);
    expect(cli!.meta?.reason).toBe('protocol_mismatch');
  });

  it('classifies EHOSTUNREACH as unreachable', () => {
    const err = Object.assign(new Error('connect EHOSTUNREACH'), { code: 'EHOSTUNREACH' });
    const cli = classifyTransportError(err);
    expect(cli!.meta?.reason).toBe('unreachable');
  });

  it('classifies TLS handshake failures as tls_failure', () => {
    const err = Object.assign(new Error('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), {
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    });
    const cli = classifyTransportError(err);
    expect(cli!.meta?.reason).toBe('tls_failure');
  });

  it('walks the extraction chain: err.error?.code wins when err.code is absent (ws library shape)', () => {
    // The `ws` library wraps Node socket errors as { error: NetError, message, ... }.
    // Extraction order (per plan): err.code → err.error?.code → message regex → ctx.cause.
    const wsWrap = {
      message: 'failed',
      error: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND ws-host' },
    };
    const cli = classifyTransportError(wsWrap, { endpoint: 'wss://ws-host' });
    expect(cli!.meta?.reason).toBe('dns_failure');
  });

  it('uses ctx.cause from the listener when reject payload is empty', () => {
    // Last layer of the chain: WsProvider rejected with {} but the on('error')
    // listener captured ENOTFOUND first.
    const cli = classifyTransportError(
      {},
      { endpoint: 'wss://bad', cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND bad' } },
    );
    expect(cli!.meta?.reason).toBe('dns_failure');
  });

  it('returns null for non-transport Error instances (e.g. PROGRAM_ERROR-style panics)', () => {
    expect(classifyTransportError(new Error('something else broke'))).toBeNull();
    expect(classifyTransportError(new Error('ENOENT: no such file'))).toBeNull();
  });

  it('returns null for already-classified CliErrors that are not CONNECTION_TIMEOUT', () => {
    expect(classifyTransportError(new CliError('boom', 'PROGRAM_ERROR'))).toBeNull();
    expect(classifyTransportError(new CliError('boom', 'INVALID_ADDRESS'))).toBeNull();
  });

  it('classifies empty {} payload as TRANSPORT_ERROR / unknown when context exists', () => {
    // The original issue #58 repro 1 shape: WsProvider rejects with {}.
    // We have no listener-captured cause this time, but we DO know we tried
    // to talk to an endpoint, so the value-shape gives us "unknown" instead
    // of the historical UNKNOWN_ERROR opacity.
    const cli = classifyTransportError({}, { endpoint: 'wss://bad' });
    expect(cli).not.toBeNull();
    expect(cli!.code).toBe('TRANSPORT_ERROR');
    expect(cli!.meta?.reason).toBe('unknown');
    expect(cli!.meta?.endpoint).toBe('wss://bad');
  });
});

describe('formatError transport fallback (issue #58 regression)', () => {
  it('upgrades the original empty-{} repro shape to TRANSPORT_ERROR / unknown when ctx is supplied', () => {
    // EXACT shape from issue #58 repro 1: WsProvider rejected with {} when DNS
    // failed. Pre-fix: { error: '{}', code: 'UNKNOWN_ERROR' }.
    // Post-fix: api.ts's catch site supplies ctx.endpoint (and ctx.cause from
    // the on('error') listener) so the empty payload routes through
    // TRANSPORT_ERROR / unknown instead of the opaque UNKNOWN_ERROR.
    const cli = classifyTransportError({}, { endpoint: 'wss://nonexistent.example' });
    expect(cli).not.toBeNull();
    const formatted = formatError(cli);
    expect(formatted.code).toBe('TRANSPORT_ERROR');
    expect(formatted.reason).toBe('unknown');
    expect(formatted.endpoint).toBe('wss://nonexistent.example');
  });

  it('keeps a context-less empty-{} payload as UNKNOWN_ERROR (no false-positive transport claim)', () => {
    // Without an endpoint or captured cause, we can't honestly call {} a
    // transport failure — it might be a stray throw from any layer.
    expect(formatError({}).code).toBe('UNKNOWN_ERROR');
  });

  it('upgrades a raw ENOTFOUND Error to TRANSPORT_ERROR / dns_failure', () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND host.example'), {
      code: 'ENOTFOUND',
    });
    const formatted = formatError(err);
    expect(formatted.code).toBe('TRANSPORT_ERROR');
    expect(formatted.reason).toBe('dns_failure');
    expect(formatted.host).toBe('host.example');
  });

  it('preserves the legacy CONNECTION_TIMEOUT CliError as TRANSPORT_ERROR / timeout', () => {
    const legacy = new CliError(
      'Connection to wss://rpc.vara.network timed out after 10s. Check your network or VARA_WS setting.',
      'CONNECTION_TIMEOUT',
    );
    const formatted = formatError(legacy);
    // Legacy code passes through to JSON output because formatError doesn't
    // remap CliErrors it sees (only outputError pre-routes raw errors).
    // The remap happens at the api.ts catch site via classifyTransportError.
    expect(formatted.code).toBe('CONNECTION_TIMEOUT');
  });
});

describe('formatError CliError edge cases', () => {
  it('sanitizes seeds in CliError messages', () => {
    const err = new CliError('Failed to sign with //Alice', 'SOME_CODE');
    const result = formatError(err);
    expect(result.error).not.toContain('//Alice');
    expect(result.error).toContain('//***');
  });

  it('does not let meta keys overwrite "error" or "code"', () => {
    const err = new CliError('real message', 'REAL_CODE', {
      // Hostile / accidental shadowing of the canonical fields.
      error: 'overridden!',
      code: 'OVERRIDDEN!',
      reason: 'panic',
    });
    const result = formatError(err);
    expect(result.error).toBe('real message');
    expect(result.code).toBe('REAL_CODE');
    expect(result.reason).toBe('panic');
  });
});
