export type VaraEthNetwork = 'hoodi' | 'local' | 'mainnet';

export interface VaraEthNetworkConfig {
  ethereumRpc: string;
  beaconRpc?: string; // for EIP-7594 blob lookups (code upload)
  varaEthRpc: string;
  routerAddress: `0x${string}` | null; // null = lookup at runtime (Anvil dev)
  blockTimeMs: number;
  hidden?: boolean; // omit from --help listings
  notDeployed?: boolean; // throw NetworkNotDeployedError on access
}

export const VARA_ETH_NETWORKS: Readonly<Record<VaraEthNetwork, VaraEthNetworkConfig>> = {
  local: {
    ethereumRpc: 'ws://127.0.0.1:8545',
    varaEthRpc: 'ws://127.0.0.1:9944',
    routerAddress: null, // discovered from Anvil broadcast artifact at runtime
    blockTimeMs: 1_000,
  },
  hoodi: {
    ethereumRpc: 'wss://hoodi-reth-rpc.gear-tech.io/ws',
    beaconRpc: 'https://hoodi-lighthouse-rpc.gear-tech.io',
    varaEthRpc: 'wss://vara-eth-validator-1.gear-tech.io:9944',
    // Router address not confirmed in ethexe sources (no broadcast artifacts committed);
    // set to null until an authoritative address is published.
    routerAddress: null,
    blockTimeMs: 12_000,
  },
  mainnet: {
    ethereumRpc: '',
    varaEthRpc: '',
    routerAddress: null,
    blockTimeMs: 12_000,
    hidden: true,
    notDeployed: true,
  },
};

/** Returns network names visible in --help (excludes hidden ones). */
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
