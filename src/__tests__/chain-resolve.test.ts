import { Command } from 'commander';

import { resolveChain, isChain, chainDisplay } from '../chains/types';
import { resolveActionChain } from '../utils/active-chain';

describe('resolveChain', () => {
  it('defaults to vara when nothing supplied', () => {
    expect(resolveChain(undefined, undefined)).toBe('vara');
  });

  it('honors explicit --chain over config default', () => {
    expect(resolveChain('vara-eth', 'vara')).toBe('vara-eth');
  });

  it('falls back to config default when no explicit flag', () => {
    expect(resolveChain(undefined, 'vara-eth')).toBe('vara-eth');
  });

  it('throws on unknown chain', () => {
    expect(() => resolveChain('solana')).toThrow(/Unknown chain/i);
  });

  it('rejects the pre-rename ethexe token', () => {
    expect(() => resolveChain('ethexe')).toThrow(/Unknown chain/i);
  });
});

describe('isChain', () => {
  it('accepts vara and vara-eth', () => {
    expect(isChain('vara')).toBe(true);
    expect(isChain('vara-eth')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isChain('ethexe')).toBe(false);
    expect(isChain('solana')).toBe(false);
    expect(isChain('')).toBe(false);
    expect(isChain(null)).toBe(false);
    expect(isChain(42)).toBe(false);
  });
});

describe('chainDisplay', () => {
  it('maps each chain to its branded display name', () => {
    expect(chainDisplay('vara')).toBe('Vara');
    expect(chainDisplay('vara-eth')).toBe('Vara.eth');
  });
});

describe('resolveActionChain', () => {
  function nestedVaraEthCommand(): Command {
    const program = new Command();
    const wallet = program.command('vara-eth:wallet');
    return wallet.command('list');
  }

  it('infers Vara.eth for prefixed commands when --chain is omitted', () => {
    expect(resolveActionChain(nestedVaraEthCommand(), undefined, undefined)).toBe('vara-eth');
    expect(resolveActionChain(nestedVaraEthCommand(), undefined, 'vara')).toBe('vara-eth');
  });

  it('keeps explicit --chain ahead of command namespace inference', () => {
    expect(resolveActionChain(nestedVaraEthCommand(), 'vara', undefined)).toBe('vara');
  });
});
