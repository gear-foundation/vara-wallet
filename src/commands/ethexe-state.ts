/**
 * `ethexe:state read <mirror>` — fetch the on-coprocessor program state.
 *
 * Surfaces three useful views:
 *   --full           full state (queue/waitlist/stash/mailbox/pages)
 *   --queue          just the message queue
 *   --mailbox        just the mailbox
 *   (default)        ProgramState only (state hash, queue size, balances, expiry)
 */

import { Command } from 'commander';
import type { Address, Hex } from 'viem';

import { getEthexeApi } from '../services/ethexe/api';
import { CliError } from '../utils/errors';
import { output } from '../utils/output';

interface ReadOptions {
  full?: boolean;
  queue?: boolean;
  mailbox?: boolean;
}

function asAddress(value: string, field: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new CliError(`${field} must be a 20-byte 0x-prefixed address`, 'INVALID_ADDRESS', { field, value });
  }
  return value as Address;
}

export function registerEthexeStateCommand(program: Command): void {
  const state = program.command('ethexe:state').description('Read program state from the ethexe co-processor');

  state
    .command('read <mirror>')
    .description('Read program state by mirror address')
    .option('--full', 'fetch the full program state (queue/waitlist/stash/mailbox/pages)')
    .option('--queue', 'fetch only the message queue')
    .option('--mailbox', 'fetch only the mailbox')
    .action(async (mirrorArg: string, options: ReadOptions) => {
      const mirror = asAddress(mirrorArg, 'mirror');
      const api = await getEthexeApi();

      const mirrorClient = (await import('@vara-eth/api')).getMirrorClient({
        address: mirror,
        publicClient: api.eth.publicClient,
      });
      const stateHash = (await mirrorClient.stateHash()) as Hex;

      if (options.full) {
        const fullState = await api.query.program.readFullState(stateHash);
        output({ mirror, stateHash, fullState });
        return;
      }
      if (options.queue) {
        const queue = await api.query.program.readQueue(stateHash);
        output({ mirror, stateHash, queue });
        return;
      }
      if (options.mailbox) {
        const mailbox = await api.query.program.readMailbox(stateHash);
        output({ mirror, stateHash, mailbox });
        return;
      }

      const programState = await api.query.program.readState(stateHash);
      output({ mirror, stateHash, programState });
    });
}
