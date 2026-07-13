/**
 * Minimal stub of `@vara-eth/api` exposed only to jest. Unit tests that exercise
 * the keystore + chain dispatch + wallet store don't actually need the api;
 * the real package pulls viem (ESM-only) through ts-jest which is slow and
 * trips over `import.meta.url` in kzg-wasm. End-to-end behaviour lives in the
 * smoke tests under `dist/`.
 */

export const VaraEthErrorCode = {
  ViemForkRequired: 'VIEM_FORK_REQUIRED',
  InjectedTxStale: 'INJECTED_TX_STALE',
  PromiseTimeout: 'PROMISE_TIMEOUT',
  PromiseSigInvalid: 'PROMISE_SIG_INVALID',
  PermitExpired: 'PERMIT_EXPIRED',
  BlobUnderpriced: 'BLOB_UNDERPRICED',
  CodeValidationTimeout: 'CODE_VALIDATION_TIMEOUT',
  NoSailsIdl: 'NO_SAILS_IDL',
  RpcConnectionFailed: 'RPC_CONNECTION_FAILED',
  ChainIdMismatch: 'CHAIN_ID_MISMATCH',
  MessageReverted: 'MESSAGE_REVERTED',
} as const;
export type VaraEthErrorCode = (typeof VaraEthErrorCode)[keyof typeof VaraEthErrorCode];

export class VaraEthError extends Error {
  public readonly code: VaraEthErrorCode;
  constructor(code: VaraEthErrorCode, message: string, _options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}
export class MessageRevertedError extends VaraEthError {
  public readonly reason: string;
  public readonly functionName: string;
  constructor(reason: string, functionName: string, cause?: unknown) {
    super(VaraEthErrorCode.MessageReverted, `${functionName} reverted: ${reason}`, { cause });
    this.reason = reason;
    this.functionName = functionName;
  }
}
export class NoSailsIdlError extends VaraEthError {
  constructor() {
    super(VaraEthErrorCode.NoSailsIdl, 'WASM has no `sails_idl` custom section.');
  }
}
export class LocalSigner {}
let wsConnectImplementation: () => Promise<void> = async () => {};
let createApiImplementation: (...args: unknown[]) => Promise<unknown> = async () => ({});
let wsConnectCalls = 0;
let wsDisconnectCalls = 0;
let createApiCalls = 0;
let lastCreateApiArgs: unknown[] = [];

export function __setWsConnectImplementationForTests(fn: () => Promise<void>): void {
  wsConnectImplementation = fn;
}

export function __setCreateApiImplementationForTests(fn: (...args: unknown[]) => Promise<unknown>): void {
  createApiImplementation = fn;
}

export function __getWsConnectCallsForTests(): number {
  return wsConnectCalls;
}

export function __getWsDisconnectCallsForTests(): number {
  return wsDisconnectCalls;
}

export function __getCreateApiCallsForTests(): number {
  return createApiCalls;
}

export function __getLastPublicClientTransportForTests(): string | undefined {
  const client = lastCreateApiArgs[1] as { transport?: { type?: string } } | undefined;
  return client?.transport?.type;
}

export function __resetVaraEthApiStubForTests(): void {
  wsConnectImplementation = async () => {};
  createApiImplementation = async () => ({});
  wsConnectCalls = 0;
  wsDisconnectCalls = 0;
  createApiCalls = 0;
  lastCreateApiArgs = [];
}

export const createVaraEthApi = async (...args: unknown[]) => {
  createApiCalls += 1;
  lastCreateApiArgs = args;
  return createApiImplementation(...args);
};
export class WsVaraEthProvider {
  constructor(_url: string) {}
  async connect() {
    wsConnectCalls += 1;
    return wsConnectImplementation();
  }
  disconnect() { wsDisconnectCalls += 1; }
}
export class HttpVaraEthProvider {
  constructor(_url?: string) {}
  disconnect() {}
}
export const getMirrorClient = () => ({});
export const getRouterClient = () => ({});
export const getWrappedVaraClient = () => ({});
