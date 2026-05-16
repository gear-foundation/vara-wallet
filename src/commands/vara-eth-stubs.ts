/**
 * Stub commands for Vara.eth operations that aren't implemented yet. Each emits
 * `UnsupportedChainOperationError` with a clear note about when it will land.
 *
 * Keeps `--help` accurate (these commands appear in the listing, marked
 * "coming soon") and avoids "command not found" surprises for agents probing
 * the surface.
 */

import { Command } from 'commander';

import { UnsupportedChainOperationError } from '../shared/errors-eth';

const COMING_SOON = 'a follow-up release';

function reject(operation: string): never {
  throw new UnsupportedChainOperationError(operation, 'vara-eth', COMING_SOON);
}

export function registerVaraEthStubCommands(program: Command): void {
  // WVARA — Phase 3b stubs (balance/transfer/approve/permit)
  const wvara = program.command('vara-eth:wvara').description('(coming soon) WVARA ERC-20 operations on the Vara.eth rail');
  wvara.command('balance <address>').description('(coming soon) Query WVARA balance').action(() => reject('vara-eth:wvara balance'));
  wvara.command('transfer <to> <amount>').description('(coming soon) Transfer WVARA').action(() => reject('vara-eth:wvara transfer'));
  wvara.command('approve <spender> <amount>').description('(coming soon) Approve WVARA spend').action(() => reject('vara-eth:wvara approve'));
  wvara.command('permit <spender> <amount>').description('(coming soon) EIP-2612 permit').action(() => reject('vara-eth:wvara permit'));

  // Inheritor recovery
  const inheritor = program.command('vara-eth:inheritor').description('(coming soon) Inheritor-chain recovery');
  inheritor.command('recover <mirror>').description('(coming soon) Recover locked value').action(() => reject('vara-eth:inheritor recover'));

  // Validator pool config
  const validators = program.command('vara-eth:validators').description('(coming soon) Validator pool configuration');
  validators.command('add <url>').description('(coming soon) Add validator endpoint').action(() => reject('vara-eth:validators add'));
  validators.command('remove <url>').description('(coming soon) Remove validator endpoint').action(() => reject('vara-eth:validators remove'));
  validators.command('list').description('(coming soon) List configured validators').action(() => reject('vara-eth:validators list'));
}
