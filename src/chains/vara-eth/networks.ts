export type VaraEthNetwork = 'mainnet' | 'hoodi' | 'local';

export interface VaraEthNetworkConfig {
  ethereumRpc: string;
  beaconRpc?: string; // for EIP-7594 blob lookups (code upload)
  varaEthRpc: string;
  routerAddress: `0x${string}` | null; // null = lookup at runtime (Anvil dev)
  /** Canonical WVARA ERC-20 address. Surfaced for diagnostics; the Router exposes it on-chain. */
  wrappedVaraAddress?: `0x${string}`;
  blockTimeMs: number;
  hidden?: boolean; // omit from --help listings
  notDeployed?: boolean; // throw NetworkNotDeployedError on access
}

/**
 * Hand-curated Vara.eth network presets. Addresses verified against the
 * canonical deployment announcement on 2026-05-17 — see CHANGELOG and
 * docs/vara-eth-networks.md for source. Bootnode and validator P2P peer IDs
 * are intentionally NOT encoded here: the wallet speaks RPC, not libp2p.
 */
export const VARA_ETH_NETWORKS: Readonly<Record<VaraEthNetwork, VaraEthNetworkConfig>> = {
  mainnet: {
    ethereumRpc: 'wss://mainnet-reth-rpc.gear-tech.io/ws',
    beaconRpc: 'https://mainnet-lighthouse-rpc.gear-tech.io',
    varaEthRpc: 'wss://validator-1-eth.vara.network',
    routerAddress: '0x9C13FE9242dfe2ba2Cd446480A9308279aA74cb6',
    wrappedVaraAddress: '0xB67010F2246814e5c39593ac23A925D9e9d7E5aD',
    blockTimeMs: 12_000,
  },
  hoodi: {
    ethereumRpc: 'wss://hoodi-reth-rpc.gear-tech.io/ws',
    beaconRpc: 'https://hoodi-lighthouse-rpc.gear-tech.io',
    varaEthRpc: 'wss://vara-eth-validator-1.gear-tech.io',
    routerAddress: '0xE549b0AfEdA978271FF7E712232B9F7f39A0b060',
    wrappedVaraAddress: '0xE1ab85A8B4d5d5B6af0bbD0203EB322DF33d0464',
    blockTimeMs: 12_000,
  },
  local: {
    ethereumRpc: 'ws://127.0.0.1:8545',
    varaEthRpc: 'ws://127.0.0.1:9944',
    routerAddress: null, // discovered from Anvil broadcast artifact at runtime
    blockTimeMs: 1_000,
  },
};

/** Returns network names visible in --help (currently all of them — no hidden presets). */
export function listVaraEthNetworkNames(): VaraEthNetwork[] {
  return (Object.entries(VARA_ETH_NETWORKS) as Array<[VaraEthNetwork, VaraEthNetworkConfig]>)
    .filter(([, cfg]) => !cfg.hidden)
    .map(([name]) => name);
}

export function resolveVaraEthNetwork(name: string): VaraEthNetworkConfig {
  if (!(name in VARA_ETH_NETWORKS)) {
    const { CliError } = require('../../utils/errors') as typeof import('../../utils/errors');
    throw new CliError(
      `Unknown Vara.eth network "${name}". Valid: ${listVaraEthNetworkNames().join(', ')}`,
      'INVALID_NETWORK',
      { network: name },
    );
  }
  const cfg = VARA_ETH_NETWORKS[name as VaraEthNetwork];
  if (cfg.notDeployed) {
    const { NetworkNotDeployedError } = require('../../shared/errors-eth') as typeof import('../../shared/errors-eth');
    throw new NetworkNotDeployedError(name);
  }
  return cfg;
}
