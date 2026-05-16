/**
 * vara-eth:validators — manage the Vara.eth validator pool config.
 *
 * This command is config-only; it never makes network calls.  The validator
 * pool (a list of endpoint URLs) is stored in ~/.vara-wallet/config.json under
 * the `varaEthValidatorPool` key and consumed by future networking logic.
 */

import { Command } from 'commander';

import { readConfig, updateConfig } from '../services/config';
import { CliError } from '../utils/errors';
import { output } from '../utils/output';

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'wss:' || u.protocol === 'ws:' || u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function registerVaraEthValidatorsCommand(program: Command): void {
  const validators = program
    .command('vara-eth:validators')
    .description('Manage the Vara.eth validator pool endpoint list');

  validators
    .command('add <url>')
    .description('Append a validator endpoint URL to the pool (de-duplicates)')
    .action((url: string) => {
      if (!isValidUrl(url)) {
        throw new CliError(
          `Invalid validator URL "${url}". Must be a ws://, wss://, http://, or https:// URL.`,
          'INVALID_VALIDATOR_URL',
          { url },
        );
      }
      const config = readConfig();
      const pool = config.varaEthValidatorPool ?? [];
      if (!pool.includes(url)) {
        pool.push(url);
        updateConfig({ varaEthValidatorPool: pool });
      }
      output({ chain: 'vara-eth', display: 'Vara.eth', action: 'added', url, pool });
    });

  validators
    .command('remove <url>')
    .description('Remove a validator endpoint URL from the pool')
    .action((url: string) => {
      const config = readConfig();
      const pool = config.varaEthValidatorPool ?? [];
      const next = pool.filter((u) => u !== url);
      updateConfig({ varaEthValidatorPool: next });
      output({ chain: 'vara-eth', display: 'Vara.eth', action: 'removed', url, pool: next });
    });

  validators
    .command('list')
    .description('List all configured Vara.eth validator endpoints')
    .action(() => {
      const config = readConfig();
      const pool = config.varaEthValidatorPool ?? [];
      output({ chain: 'vara-eth', display: 'Vara.eth', pool });
    });
}
