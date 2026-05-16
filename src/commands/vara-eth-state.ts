import { Command } from 'commander';
import type { Hex } from 'viem';

import { getEthexeApi, getMirrorClient } from '../services/vara-eth/api';
import { asAddress } from '../utils/eth-types';
import { output } from '../utils/output';

interface ReadOptions {
  full?: boolean;
  queue?: boolean;
  mailbox?: boolean;
}

export function registerVaraEthStateCommand(program: Command): void {
  const state = program.command('vara-eth:state').description('Read program state from the Vara.eth co-processor');

  state
    .command('read <mirror>')
    .description('Read program state by mirror address')
    .option('--full', 'fetch the full program state (queue/waitlist/stash/mailbox/pages)')
    .option('--queue', 'fetch only the message queue')
    .option('--mailbox', 'fetch only the mailbox')
    .action(async (mirrorArg: string, options: ReadOptions) => {
      const mirror = asAddress(mirrorArg, 'mirror');
      const api = await getEthexeApi();
      const mirrorClient = await getMirrorClient(mirror);
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
