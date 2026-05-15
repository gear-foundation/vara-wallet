import { resolveChain, isChain } from '../chains/types';

describe('resolveChain', () => {
  it('defaults to vara when nothing supplied', () => {
    expect(resolveChain(undefined, undefined)).toBe('vara');
  });

  it('honors explicit --chain over config default', () => {
    expect(resolveChain('ethexe', 'vara')).toBe('ethexe');
  });

  it('falls back to config default when no explicit flag', () => {
    expect(resolveChain(undefined, 'ethexe')).toBe('ethexe');
  });

  it('throws on unknown chain', () => {
    expect(() => resolveChain('solana')).toThrow(/Unknown chain/i);
  });
});

describe('isChain', () => {
  it('accepts vara and ethexe', () => {
    expect(isChain('vara')).toBe(true);
    expect(isChain('ethexe')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isChain('solana')).toBe(false);
    expect(isChain('')).toBe(false);
    expect(isChain(null)).toBe(false);
    expect(isChain(42)).toBe(false);
  });
});
