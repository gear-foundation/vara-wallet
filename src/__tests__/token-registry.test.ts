import {
  listKnownVftTokens,
  normalizeTokenAlias,
  resolveTokenIdentifier,
  resolveTokenNetwork,
} from '../services/token-registry';

const MAINNET_WUSDC = '0xd1de816d7dce6439504552686ab333e5b7302b1549763656b30af1f8a5871b6a';
const TESTNET_WUSDC = '0x9f332e61589e0850dce6d8e6070ea5618de33d9f134a4a35d6d1164dc9002f48';

describe('token registry', () => {
  const originalVaraWs = process.env.VARA_WS;

  afterEach(() => {
    if (originalVaraWs === undefined) {
      delete process.env.VARA_WS;
    } else {
      process.env.VARA_WS = originalVaraWs;
    }
  });

  it('normalizes token aliases case-insensitively', () => {
    expect(normalizeTokenAlias(' USDC ')).toBe('usdc');
    expect(normalizeTokenAlias('tokenized_vara')).toBe('tokenized-vara');
    expect(normalizeTokenAlias('Tokenized   VARA')).toBe('tokenized-vara');
  });

  it('resolves the same alias to the selected network token', () => {
    expect(resolveTokenIdentifier('usdc', { network: 'mainnet' }).address).toBe(MAINNET_WUSDC);
    expect(resolveTokenIdentifier('USDC', { network: 'testnet' }).address).toBe(TESTNET_WUSDC);
  });

  it('infers token network from explicit endpoint', () => {
    expect(resolveTokenNetwork({ ws: 'wss://testnet.vara.network' })).toBe('testnet');
    expect(resolveTokenIdentifier('wusdc', { ws: 'wss://testnet.vara.network' }).address).toBe(TESTNET_WUSDC);
  });

  it('passes raw 32-byte token addresses through without requiring network support', () => {
    const raw = '0x' + 'ab'.repeat(32);
    const resolved = resolveTokenIdentifier(raw, { network: 'local' });
    expect(resolved.address).toBe(raw);
    expect(resolved.isKnown).toBe(false);
  });

  it('rejects 20-byte Ethereum-style hex as an invalid ActorId', () => {
    let caught: unknown;
    try {
      resolveTokenIdentifier('0x' + 'ab'.repeat(20), { network: 'mainnet' });
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: string }).code).toBe('INVALID_ADDRESS');
  });

  it('rejects aliases on unsupported networks instead of guessing', () => {
    let caught: unknown;
    try {
      resolveTokenIdentifier('usdc', { network: 'local' });
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: string }).code).toBe('TOKEN_NETWORK_UNSUPPORTED');
  });

  it('rejects unknown aliases with a token-specific error', () => {
    let caught: unknown;
    try {
      resolveTokenIdentifier('doge', { network: 'mainnet' });
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: string }).code).toBe('TOKEN_NOT_FOUND');
  });

  it('lists only the selected network unless all tokens are requested', () => {
    expect(listKnownVftTokens('mainnet')).toHaveLength(5);
    expect(listKnownVftTokens('testnet')).toHaveLength(5);
    expect(listKnownVftTokens()).toHaveLength(10);
  });
});
