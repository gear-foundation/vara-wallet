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
export const createVaraEthApi = async () => ({});
export class WsVaraEthProvider {
  constructor(_url: string) {}
  async connect() {}
  disconnect() {}
}
export class HttpVaraEthProvider {
  constructor(_url?: string) {}
  disconnect() {}
}
export const getMirrorClient = () => ({});
export const getRouterClient = () => ({});
export const getWrappedVaraClient = () => ({});
