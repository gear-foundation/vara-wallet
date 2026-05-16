/**
 * Unit tests for the Vara.eth network presets registry.
 */

import { listVaraEthNetworkNames, resolveVaraEthNetwork } from '../chains/vara-eth/networks';
import { NetworkNotDeployedError } from '../shared/errors-eth';
import { CliError } from '../utils/errors';

describe('resolveVaraEthNetwork', () => {
  it('returns the local preset with routerAddress null', () => {
    const cfg = resolveVaraEthNetwork('local');
    expect(cfg.routerAddress).toBeNull();
    expect(cfg.ethereumRpc).toBe('ws://127.0.0.1:8545');
    expect(cfg.varaEthRpc).toBe('ws://127.0.0.1:9944');
    expect(cfg.blockTimeMs).toBe(1_000);
  });

  it('returns the hoodi preset', () => {
    const cfg = resolveVaraEthNetwork('hoodi');
    expect(cfg.ethereumRpc).toContain('hoodi');
    expect(cfg.varaEthRpc).toContain('vara-eth-validator');
    expect(cfg.blockTimeMs).toBe(12_000);
    expect(cfg.beaconRpc).toBeDefined();
  });

  it('throws NetworkNotDeployedError for mainnet', () => {
    expect(() => resolveVaraEthNetwork('mainnet')).toThrow(NetworkNotDeployedError);
    expect(() => resolveVaraEthNetwork('mainnet')).toThrow(/not deployed/i);
    try {
      resolveVaraEthNetwork('mainnet');
    } catch (err) {
      expect(err).toBeInstanceOf(NetworkNotDeployedError);
      expect((err as NetworkNotDeployedError).code).toBe('NETWORK_NOT_DEPLOYED');
      expect((err as NetworkNotDeployedError).meta).toMatchObject({ chain: 'vara-eth', network: 'mainnet' });
    }
  });

  it('throws CliError with INVALID_NETWORK for unknown names', () => {
    expect(() => resolveVaraEthNetwork('bogus')).toThrow(CliError);
    try {
      resolveVaraEthNetwork('bogus');
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).code).toBe('INVALID_NETWORK');
      expect((err as CliError).message).toContain('bogus');
    }
  });
});

describe('listVaraEthNetworkNames', () => {
  it('excludes hidden networks (mainnet)', () => {
    const names = listVaraEthNetworkNames();
    expect(names).not.toContain('mainnet');
    expect(names).toContain('hoodi');
    expect(names).toContain('local');
  });

  it('returns an array with at least hoodi and local', () => {
    const names = listVaraEthNetworkNames();
    expect(names.length).toBeGreaterThanOrEqual(2);
  });
});
