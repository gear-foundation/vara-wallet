/**
 * Minimal stub of `@vara-eth/api` exposed only to jest. Unit tests that exercise
 * the keystore + chain dispatch + wallet store don't actually need the api;
 * the real package pulls viem (ESM-only) through ts-jest which is slow and
 * trips over `import.meta.url` in kzg-wasm. End-to-end behaviour lives in the
 * smoke tests under `dist/`.
 */

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
