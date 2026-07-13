/**
 * Unit tests for the Vara.eth network presets registry.
 */

import { listVaraEthNetworkNames, resolveVaraEthNetwork } from '../chains/vara-eth/networks';
import { CliError } from '../utils/errors';

describe('resolveVaraEthNetwork', () => {
  it('returns the local preset with routerAddress null', () => {
    const cfg = resolveVaraEthNetwork('local');
    expect(cfg.routerAddress).toBeNull();
    expect(cfg.ethereumRpc).toBe('ws://127.0.0.1:8545');
    expect(cfg.ethereumHttpRpc).toBe('http://127.0.0.1:8545');
    expect(cfg.varaEthRpc).toBe('ws://127.0.0.1:9944');
    expect(cfg.blockTimeMs).toBe(1_000);
  });

  it('returns the hoodi preset with the canonical router + WVARA addresses', () => {
    const cfg = resolveVaraEthNetwork('hoodi');
    expect(cfg.ethereumRpc).toContain('hoodi-reth-rpc.gear-tech.io');
    expect(cfg.ethereumHttpRpc).toBe('https://hoodi-reth-rpc.gear-tech.io');
    expect(cfg.beaconRpc).toContain('hoodi-lighthouse-rpc.gear-tech.io');
    expect(cfg.varaEthRpc).toContain('vara-eth-validator-1.gear-tech.io');
    expect(cfg.blockTimeMs).toBe(12_000);
    expect(cfg.routerAddress).toBe('0xE549b0AfEdA978271FF7E712232B9F7f39A0b060');
    expect(cfg.wrappedVaraAddress).toBe('0xE1ab85A8B4d5d5B6af0bbD0203EB322DF33d0464');
  });

  it('returns the mainnet preset with the canonical router + WVARA addresses', () => {
    const cfg = resolveVaraEthNetwork('mainnet');
    expect(cfg.ethereumRpc).toContain('mainnet-reth-rpc.gear-tech.io');
    expect(cfg.ethereumHttpRpc).toBe('https://mainnet-reth-rpc.gear-tech.io');
    expect(cfg.beaconRpc).toContain('mainnet-lighthouse-rpc.gear-tech.io');
    expect(cfg.varaEthRpc).toContain('validator-1-eth.vara.network');
    expect(cfg.blockTimeMs).toBe(12_000);
    expect(cfg.routerAddress).toBe('0x9C13FE9242dfe2ba2Cd446480A9308279aA74cb6');
    expect(cfg.wrappedVaraAddress).toBe('0xB67010F2246814e5c39593ac23A925D9e9d7E5aD');
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
  it('lists every deployed preset (mainnet, hoodi, local)', () => {
    const names = listVaraEthNetworkNames();
    expect(names).toEqual(expect.arrayContaining(['mainnet', 'hoodi', 'local']));
    expect(names).toHaveLength(3);
  });
});
