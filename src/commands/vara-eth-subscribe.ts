import { Command } from 'commander';

import { subscribeVaraEthBlocks, subscribeVaraEthProgram, subscribeVaraEthRouter } from './vara-eth-actions';

/**
 * Holds the process open until the user sends SIGINT/SIGTERM and tears down
 * the subscription before yielding. We register a `once` listener with
 * `prependListener` so it runs *before* the global SIGINT handler in `app.ts`
 * (which calls `fastExit` and skips our `finally` block).
 */
function awaitSignalAnd(unsubscribe: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    const onSignal = () => {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      unsubscribe();
      resolve();
    };
    process.prependOnceListener('SIGINT', onSignal);
    process.prependOnceListener('SIGTERM', onSignal);
  });
}

export function registerVaraEthSubscribeCommand(program: Command): void {
  const cmd = program.command('vara-eth:subscribe').description('Subscribe to Vara.eth events (NDJSON to stdout)');

  cmd
    .command('program <mirror>')
    .description('Stream all events emitted by a Mirror program')
    .option('--from-block <n>', 'back-fill from this block number')
    .action(async (mirrorArg: string, options: { fromBlock?: string }) => {
      await subscribeVaraEthProgram(mirrorArg, options, awaitSignalAnd);
    });

  cmd
    .command('router')
    .description('Stream all events emitted by the Router')
    .option('--from-block <n>', 'back-fill from this block number')
    .action(async (options: { fromBlock?: string }) => {
      await subscribeVaraEthRouter(options, awaitSignalAnd);
    });

  cmd
    .command('blocks')
    .description('Stream new Ethereum block headers')
    .option('--include-pending', 'follow pending blocks too')
    .action(async (options: { includePending?: boolean }) => {
      await subscribeVaraEthBlocks(options, awaitSignalAnd);
    });
}
