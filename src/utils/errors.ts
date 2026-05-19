import { VaraEthError, MessageRevertedError } from '@vara-eth/api';

import { isVerboseEnabled } from './output';

/**
 * Extract a string message from anything that might be thrown. Preferred
 * over inline `err instanceof Error ? err.message : String(err)` so error
 * formatting stays consistent across the codebase.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type ErrorMeta = Record<string, unknown>;

export class CliError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly meta?: ErrorMeta,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function outputError(error: unknown): void {
  // First try transport classification on raw error — this also kicks in
  // when the value isn't a CliError yet (mid-call WS disconnect, empty {}
  // payload from WsProvider) and remaps the legacy CONNECTION_TIMEOUT
  // sentinel to TRANSPORT_ERROR/timeout. classifyTransportError returns
  // null for any other already-classified CliError, so non-transport
  // codes (PROGRAM_ERROR, INVALID_ADDRESS, etc.) pass through unchanged.
  let routed: unknown = error;
  const transport = classifyTransportError(error);
  if (transport) routed = transport;

  const formatted = formatError(routed);

  // Verbose cause echo: surface the underlying error code + message before
  // the structured JSON. Wrapped in try/catch so EPIPE (stderr closed by a
  // piping consumer) doesn't crash the CLI tail.
  if (isVerboseEnabled()) {
    try {
      const cause = extractCauseChain(error);
      if (cause) {
        // Sanitize before writing — `cause` interpolates raw error text and
        // a pathological CliError message could carry a seed/mnemonic.
        process.stderr.write(`[verbose] cause: ${sanitizeErrorMessage(cause)}\n`);
      }
    } catch {
      // best-effort
    }
  }

  try {
    process.stderr.write(JSON.stringify(formatted) + '\n');
  } catch {
    // stderr write failure on the final line is fatal-ish but unrecoverable;
    // process.exitCode is already set by the caller.
  }
}

export function formatError(error: unknown): { error: string; code: string } & ErrorMeta {
  if (error instanceof CliError) {
    // Sanitize the message — CliError messages can include surfaced strings
    // (e.g. raw program panic text) that may carry secrets in pathological
    // cases. Spreading meta first then base ensures `error`/`code` always win
    // if a caller accidentally puts those keys in `meta`.
    const base = {
      error: sanitizeErrorMessage(error.message),
      code: error.code,
    };
    return error.meta ? { ...error.meta, ...base } : base;
  }

  // Transport-layer fallback for non-CliError values. Runs before the
  // generic Error / object branches so empty {} from WsProvider and
  // bare Error('ENOTFOUND ...') both surface as TRANSPORT_ERROR with
  // a `reason` subcode rather than UNKNOWN_ERROR / INTERNAL_ERROR.
  const transport = classifyTransportError(error);
  if (transport) {
    const base = {
      error: sanitizeErrorMessage(transport.message),
      code: transport.code,
    };
    return transport.meta ? { ...transport.meta, ...base } : base;
  }

  // Typed errors from @vara-eth/api carry stable string codes
  // (`MESSAGE_REVERTED`, `PROMISE_TIMEOUT`, …); surface them directly so
  // wallet consumers don't have to regex on .message.
  if (error instanceof VaraEthError) {
    const base = {
      error: sanitizeErrorMessage(error.message),
      code: error.code,
    };
    if (error instanceof MessageRevertedError) {
      return { reason: error.reason, functionName: error.functionName, ...base };
    }
    return base;
  }

  if (error instanceof Error) {
    const message = sanitizeErrorMessage(error.message);
    return { error: message, code: classifyError(error) };
  }

  const msg = typeof error === 'object' && error !== null
    ? JSON.stringify(error)
    : String(error);
  return { error: msg, code: 'UNKNOWN_ERROR' };
}

function extractCauseChain(error: unknown): string | undefined {
  if (error == null) return undefined;
  if (error instanceof CliError) {
    const cause = error.meta?.cause as string | undefined;
    const code = error.meta?.reason as string | undefined;
    if (cause || code) return `code=${code ?? 'unknown'}, message=${cause ?? error.message}`;
    return undefined;
  }
  const anyErr = error as { code?: string; message?: string; error?: { code?: string; message?: string } };
  const code = anyErr?.code ?? anyErr?.error?.code;
  const message = anyErr?.message ?? anyErr?.error?.message;
  if (code || message) {
    return `code=${code ?? 'unknown'}, message=${(message ?? '').slice(0, 200)}`;
  }
  if (typeof error === 'object' && error !== null) {
    return `code=unknown, message=${JSON.stringify(error).slice(0, 200)}`;
  }
  return `code=unknown, message=${String(error).slice(0, 200)}`;
}

function sanitizeErrorMessage(message: string): string {
  // Never include seeds or mnemonics in error output
  return message
    .replace(/\/\/\w+/g, '//***')
    .replace(/\b(\w+\s+){11,}\w+\b/g, '***mnemonic***')
    .replace(/0x[a-fA-F0-9]{64,}/g, '0x***');
}

function classifyError(error: Error): string {
  const msg = error.message.toLowerCase();

  if (msg.includes('connect') || msg.includes('websocket') || msg.includes('econnrefused')) {
    return 'CONNECTION_FAILED';
  }
  if (msg.includes('disconnected') || msg.includes('connection lost')) {
    return 'DISCONNECTED';
  }
  if (msg.includes('timeout')) {
    return 'TIMEOUT';
  }
  if (msg.includes('enoent') || msg.includes('not found') || msg.includes('no such file')) {
    return 'NOT_FOUND';
  }
  if (msg.includes('eacces') || msg.includes('permission')) {
    return 'PERMISSION_DENIED';
  }
  if (msg.includes('enospc')) {
    return 'DISK_FULL';
  }

  return 'INTERNAL_ERROR';
}

/**
 * Classify an error thrown from the program execution path (Sails query or
 * function call) into a `PROGRAM_ERROR` CliError with a structured `reason`
 * subcode. Lets agent consumers distinguish program panics from inactive
 * programs from not-found from unreachable code, without regex-matching
 * English panic strings on the consumer side.
 *
 * Always returns code `PROGRAM_ERROR` for backward compatibility. The
 * subcode lives in `meta.reason` (and `meta.programMessage` for panics).
 */
export function classifyProgramError(err: unknown): CliError {
  const raw = err instanceof Error
    ? err.message
    : typeof err === 'object' && err !== null
      ? JSON.stringify(err)
      : String(err);

  // panicked with '<msg>' — capture inner panic string.
  // Use a non-greedy match anchored against the standard Rust panic suffix
  // (` at <file>:<line>`) or end-of-string, so panic strings containing
  // nested quotes (e.g. `panicked with 'user "alice" not found' at lib.rs:1`)
  // are captured in full rather than truncated at the first inner quote.
  const panicMatch = raw.match(/panicked with ['"]([\s\S]*?)['"](?:\s+at\s|$)/);
  if (panicMatch) {
    let programMessage = panicMatch[1];
    // Sails `#[export(unwrap_result)]` (the standard pattern for typed
    // `Result<T, EnumError>` returns) and bare Rust `.unwrap()` on `Err`
    // surface as
    //   called `Result::unwrap()` on an `Err` value: <Debug of variant>
    // Strip the wrapper so consumers can `case` on the bare variant name
    // without substring matching. Two real-world quirks the regex tolerates:
    //   - some gear/sails versions render the call site as `Result::unwrap, `
    //     instead of `Result::unwrap()`, so anything-but-backtick is allowed
    //     between `unwrap` and the closing backtick.
    //   - layered quoting (`Panic occurred: '...'` + `panicked with '...'`)
    //     leaks one or more trailing apostrophes into `panicMatch[1]`; strip
    //     them all (`'*$`).
    // Variants with payloads (e.g. `InsufficientBalance(100)`, `Custom("x")`)
    // pass through whole. The full original wrapper stays in `error` for
    // debugging.
    const unwrapMatch = programMessage.match(
      /^called `Result::unwrap[^`]*` on an `Err` value:\s*(.+?)'*$/,
    );
    if (unwrapMatch) {
      programMessage = unwrapMatch[1];
    }
    return new CliError(
      `Program execution failed: ${raw}`,
      'PROGRAM_ERROR',
      { reason: 'panic', programMessage },
    );
  }

  if (raw.includes('entered unreachable code')) {
    return new CliError(
      `Program execution failed: ${raw}`,
      'PROGRAM_ERROR',
      { reason: 'unreachable' },
    );
  }

  if (raw.includes('InactiveProgram')) {
    return new CliError(
      `Program execution failed: ${raw}`,
      'PROGRAM_ERROR',
      { reason: 'inactive' },
    );
  }

  // Require the "does not exist" / "not found" phrase to be qualified by
  // "Program" so we do not misclassify generic "Account does not exist" /
  // "File not found" errors as a program-level not_found.
  //
  // Three signatures we accept:
  //   - "ProgramNotFound"           — pallet error variant name (no space)
  //   - "Program with id ... does not exist" — gear-js ProgramDoesNotExistError
  //   - "Program not found"         — gear node RPC error data (code 8000),
  //                                   surfaced when calculateGas.handle targets
  //                                   a user account instead of a program.
  if (
    raw.includes('ProgramNotFound') ||
    raw.includes('Program not found') ||
    /[Pp]rogram\b[^\n]*\bdoes not exist\b/.test(raw)
  ) {
    return new CliError(
      `Program execution failed: ${raw}`,
      'PROGRAM_ERROR',
      { reason: 'not_found' },
    );
  }

  // No program-specific signature matched. Before defaulting to PROGRAM_ERROR,
  // check whether this is actually a transport / system error bubbling up from
  // the RPC layer (timeout, websocket disconnect, etc). Misclassifying those
  // as PROGRAM_ERROR tells agent consumers "the program failed, do not retry"
  // when the right signal is "the network blipped, retry it".
  //
  // Order: transport classifier first (richer reason subcodes), then the
  // legacy classifyError fallback for non-transport system errors
  // (ENOENT/NOT_FOUND, EACCES/PERMISSION_DENIED, ENOSPC/DISK_FULL).
  const transport = classifyTransportError(err);
  if (transport) return transport;

  if (err instanceof Error) {
    const code = classifyError(err);
    if (code !== 'INTERNAL_ERROR') {
      return new CliError(err.message, code);
    }
  }

  return new CliError(`Program execution failed: ${raw}`, 'PROGRAM_ERROR');
}

export type TransportReason =
  | 'dns_failure'
  | 'connection_refused'
  | 'timeout'
  | 'ws_close_abnormal'
  | 'protocol_mismatch'
  | 'unreachable'
  | 'tls_failure'
  | 'unknown';

export interface TransportContext {
  endpoint?: string;
  cause?: { code?: string; message?: string };
}

/**
 * Classify a transport-layer failure (DNS, WS handshake, RPC disconnect,
 * TLS, timeout) into a `TRANSPORT_ERROR` CliError with a structured
 * `reason` subcode. Returns `null` when the value doesn't match any
 * transport signature — caller falls through to the existing classifier.
 *
 * Extraction order:
 *   1. err.code                (Node net errors thrown directly)
 *   2. err.error?.code         (ws library wrap: { error: NetError, message, type, target })
 *   3. err.cause?.code         (Node fetch wraps the underlying network error as err.cause)
 *   4. err.message regex       (string-only signals: 'ENOTFOUND', '1006', 'Unexpected response: 200')
 *   5. ctx.cause               (last resort — captured by on('error') listener)
 *
 * If nothing matches and we have at least an endpoint or a captured cause,
 * emit `{ reason: 'unknown', cause: ... }`. Otherwise return null.
 */
export function classifyTransportError(err: unknown, ctx: TransportContext = {}): CliError | null {
  // Honor an upstream CONNECTION_TIMEOUT sentinel (thrown by api.ts:withTimeout)
  // by remapping it to the unified TRANSPORT_ERROR taxonomy.
  if (err instanceof CliError && err.code === 'CONNECTION_TIMEOUT') {
    return new CliError(err.message, 'TRANSPORT_ERROR', {
      reason: 'timeout' as TransportReason,
      ...(ctx.endpoint ? { endpoint: ctx.endpoint } : {}),
    });
  }
  // Don't touch errors that already have a structured CliError code —
  // only the CONNECTION_TIMEOUT sentinel above is migrated.
  if (err instanceof CliError) return null;

  // 1+2. Direct `.code` or wrapped `.error.code` / `.cause.code`.
  //   - Node net errors throw directly with `.code` (ENOTFOUND, ECONNREFUSED, …).
  //   - The `ws` library wraps as `{ error: NetError, message, type, target }`.
  //   - Node's `fetch` wraps the underlying network error as `err.cause`.
  const anyErr = err as {
    code?: string;
    message?: string;
    error?: { code?: string; message?: string };
    cause?: { code?: string; message?: string };
  } | null;
  const directCode = anyErr?.code ?? anyErr?.error?.code ?? anyErr?.cause?.code;
  const directMessage = anyErr?.message ?? anyErr?.error?.message ?? anyErr?.cause?.message;

  // 3. Message string. Available for direct Error instances, listener-captured
  //    causes, and even empty {} (which yields '').
  const msg = directMessage ?? (typeof err === 'string' ? err : '');

  // 4. Listener fallback. Used when the rejection is empty (e.g., browser-style
  //    `Event` from WsProvider) but the on('error') listener captured the
  //    underlying socket error first.
  const ctxCode = ctx.cause?.code;
  const ctxMsg = ctx.cause?.message;

  const code = directCode ?? ctxCode;
  const combinedMsg = `${msg} ${ctxMsg ?? ''}`.trim();

  const reason = matchReason(code, combinedMsg);
  if (!reason) {
    // Last-ditch fallback: only classify as 'unknown' transport if the caller
    // gave us a hint (endpoint or listener-captured cause). Without ctx we
    // can't tell a transport failure from a Sails program error that arrived
    // as a bare `{ method: '...' }` object — return null and let the
    // legacy UNKNOWN_ERROR / PROGRAM_ERROR paths take over.
    if (ctx.endpoint || ctx.cause) {
      return buildTransportError('unknown', ctx, code, combinedMsg);
    }
    return null;
  }
  return buildTransportError(reason, ctx, code, combinedMsg);
}

function matchReason(code: string | undefined, message: string): TransportReason | null {
  if (code) {
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns_failure';
    if (code === 'ECONNREFUSED') return 'connection_refused';
    if (code === 'ETIMEDOUT') return 'timeout';
    if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'unreachable';
    if (code.startsWith('ERR_TLS_') || code.startsWith('CERT_') || code.includes('UNABLE_TO_VERIFY')) {
      return 'tls_failure';
    }
    if (code === 'WS_ERR_UNEXPECTED_RESPONSE') return 'protocol_mismatch';
  }
  if (!message) return null;
  const lower = message.toLowerCase();
  // DNS / network errors that may arrive as bare Error('getaddrinfo ENOTFOUND ...').
  if (lower.includes('enotfound') || lower.includes('getaddrinfo')) return 'dns_failure';
  if (lower.includes('econnrefused')) return 'connection_refused';
  if (lower.includes('etimedout') || lower.includes('timed out') || lower.includes('timeout')) {
    return 'timeout';
  }
  if (lower.includes('ehostunreach') || lower.includes('enetunreach')) return 'unreachable';
  if (
    lower.includes('cert') ||
    lower.includes('tls handshake') ||
    lower.includes('unable to verify')
  ) {
    return 'tls_failure';
  }
  // WS protocol handshake failures: ws library reports 'Unexpected server response: 200',
  // 'Unexpected response: 426', etc. Node's built-in WebSocket sanitizes these to
  // 'Received network error or non-101 status code' — same root cause.
  if (lower.includes('unexpected server response') || lower.includes('unexpected response')) {
    return 'protocol_mismatch';
  }
  if (lower.includes('non-101 status code') || lower.includes('non-101')) {
    return 'protocol_mismatch';
  }
  // Abnormal WS close codes — explicit close-code mention.
  if (/\b(1006|1011|1012|1013)\b/.test(message)) return 'ws_close_abnormal';
  if (lower.includes('disconnected from')) return 'ws_close_abnormal';
  return null;
}

function buildTransportError(
  reason: TransportReason,
  ctx: TransportContext,
  code: string | undefined,
  message: string,
): CliError {
  const meta: ErrorMeta = { reason };
  if (ctx.endpoint) meta.endpoint = ctx.endpoint;

  let humanMessage: string;
  switch (reason) {
    case 'dns_failure': {
      const host = extractHost(ctx.endpoint) ?? extractHostFromMessage(message);
      if (host) meta.host = host;
      humanMessage = host
        ? `Cannot resolve host ${host}`
        : 'DNS lookup failed';
      break;
    }
    case 'connection_refused':
      humanMessage = ctx.endpoint ? `Connection refused by ${ctx.endpoint}` : 'Connection refused';
      break;
    case 'timeout':
      humanMessage = ctx.endpoint ? `Connection to ${ctx.endpoint} timed out` : 'Connection timed out';
      break;
    case 'ws_close_abnormal':
      humanMessage = ctx.endpoint
        ? `WebSocket connection to ${ctx.endpoint} closed abnormally`
        : 'WebSocket connection closed abnormally';
      break;
    case 'protocol_mismatch':
      humanMessage = ctx.endpoint
        ? `Endpoint ${ctx.endpoint} does not speak WebSocket`
        : 'Endpoint does not speak WebSocket';
      break;
    case 'unreachable':
      humanMessage = ctx.endpoint ? `Host ${ctx.endpoint} is unreachable` : 'Host is unreachable';
      break;
    case 'tls_failure':
      humanMessage = ctx.endpoint
        ? `TLS handshake failed for ${ctx.endpoint}`
        : 'TLS handshake failed';
      break;
    case 'unknown':
    default:
      humanMessage = ctx.endpoint
        ? `Transport failure communicating with ${ctx.endpoint}`
        : 'Transport failure';
      break;
  }

  // Always preserve the underlying signal in meta.cause for triage.
  const causeText = message || code;
  if (causeText) meta.cause = causeText;

  return new CliError(humanMessage, 'TRANSPORT_ERROR', meta);
}

function extractHost(endpoint: string | undefined): string | undefined {
  if (!endpoint) return undefined;
  try {
    // Accept ws/wss/http/https; URL constructor handles all.
    return new URL(endpoint).hostname;
  } catch {
    return undefined;
  }
}

function extractHostFromMessage(message: string): string | undefined {
  // Node's getaddrinfo emits "getaddrinfo ENOTFOUND host.example.com".
  const m = message.match(/(?:ENOTFOUND|EAI_AGAIN|getaddrinfo\s+\S+)\s+([\w.-]+)/);
  return m ? m[1] : undefined;
}

export function installGlobalErrorHandler(): void {
  // Lazy import to avoid circular dependency
  const getShutdownStatus = () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('../services/api').isShuttingDown();
    } catch {
      return false;
    }
  };

  process.on('uncaughtException', (error) => {
    if (getShutdownStatus()) return;
    outputError(error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    if (getShutdownStatus()) return;
    outputError(reason);
    process.exit(1);
  });
}
