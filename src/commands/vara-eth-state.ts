import { Command } from 'commander';

import { outputVaraEthStateRead } from './vara-eth-actions';

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
      await outputVaraEthStateRead(mirrorArg, options);
    });
}
