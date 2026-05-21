import { Command } from 'commander';
import { readConfig, updateConfig, VaraWalletConfig, NETWORK_MAP } from '../services/config';
import { resolveVaraEthNetwork } from '../chains/vara-eth/networks';
import { resolveActiveChain } from '../utils/active-chain';
import { output, CliError } from '../utils';

const VALID_KEYS: Array<keyof VaraWalletConfig> = [
  'wsEndpoint',
  'defaultAccount',
  'defaultVaraEthAccount',
  'dexFactoryAddress',
  'faucetUrl',
  'defaultChain',
  'varaNetwork',
  'varaEthNetwork',
  'varaEthRpc',
  'ethereumRpc',
  'routerAddress',
  'varaEthValidatorPool',
];

export function registerConfigCommand(program: Command): void {
  const config = program.command('config').description('Manage CLI configuration');

  config
    .command('list')
    .description('Show all configuration values')
    .action(() => {
      output(readConfig());
    });

  config
    .command('get')
    .description('Get a configuration value')
    .argument('<key>', `config key (${VALID_KEYS.join(', ')})`)
    .action((key: string) => {
      const cfg = readConfig();

      if (key === 'network') {
        const chain = resolveActiveChain(config);
        if (chain === 'vara-eth') {
          output({ key: 'varaEthNetwork', value: cfg.varaEthNetwork ?? null, chain });
          return;
        }
        const network = cfg.varaNetwork ?? Object.entries(NETWORK_MAP).find(([, url]) => url === cfg.wsEndpoint)?.[0];
        output({ key: 'varaNetwork', value: network ?? null, chain });
        return;
      }

      if (!VALID_KEYS.includes(key as keyof VaraWalletConfig)) {
        throw new CliError(
          `Unknown config key "${key}". Valid keys: ${VALID_KEYS.join(', ')}, network`,
          'INVALID_CONFIG_KEY',
        );
      }
      const value = cfg[key as keyof VaraWalletConfig];
      output({ key, value: value ?? null });
    });

  config
    .command('set')
    .description('Set a configuration value')
    .argument('<key>', `config key (${VALID_KEYS.join(', ')}) or "network"`)
    .argument('<value>', 'value to set')
    .action((key: string, value: string) => {
      if (key === 'network') {
        const chain = resolveActiveChain(config);
        if (chain === 'vara-eth') {
          const preset = resolveVaraEthNetwork(value);
          const updates: Partial<VaraWalletConfig> = {
            varaEthNetwork: value as VaraWalletConfig['varaEthNetwork'],
            varaEthRpc: preset.varaEthRpc,
            ethereumRpc: preset.ethereumRpc,
            routerAddress: preset.routerAddress ?? undefined,
          };
          updateConfig({
            ...updates,
          });
          output({
            key: 'varaEthNetwork',
            value,
            chain,
            varaEthRpc: preset.varaEthRpc,
            ethereumRpc: preset.ethereumRpc,
            routerAddress: preset.routerAddress,
          });
          return;
        }

        const url = NETWORK_MAP[value];
        if (!url) {
          throw new CliError(
            `Unknown network "${value}". Valid networks: ${Object.keys(NETWORK_MAP).join(', ')}`,
            'INVALID_NETWORK',
          );
        }
        updateConfig({ wsEndpoint: url, varaNetwork: value as VaraWalletConfig['varaNetwork'] });
        output({ key: 'varaNetwork', value, wsEndpoint: url, chain });
        return;
      }

      if (!VALID_KEYS.includes(key as keyof VaraWalletConfig)) {
        throw new CliError(
          `Unknown config key "${key}". Valid keys: ${VALID_KEYS.join(', ')}, network`,
          'INVALID_CONFIG_KEY',
        );
      }

      if (key === 'defaultChain' && value !== 'vara' && value !== 'vara-eth') {
        throw new CliError('defaultChain must be "vara" or "vara-eth"', 'INVALID_CONFIG_VALUE');
      }
      if (key === 'varaNetwork' && !NETWORK_MAP[value]) {
        throw new CliError(
          `Unknown Vara network "${value}". Valid networks: ${Object.keys(NETWORK_MAP).join(', ')}`,
          'INVALID_NETWORK',
        );
      }
      if (key === 'varaEthNetwork') {
        resolveVaraEthNetwork(value);
      }

      updateConfig({ [key]: parseConfigValue(key, value) } as Partial<VaraWalletConfig>);
      output({ key, value });
    });
}

export { NETWORK_MAP };

function parseConfigValue(key: string, value: string): unknown {
  if (key === 'varaEthValidatorPool') {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return value;
}
