import { Command } from 'commander';

import { getEthexeApi } from '../services/ethexe/api';
import { asAddress, parseOptionalBigInt } from '../utils/eth-types';
import { outputNdjson, verbose } from '../utils/output';

/**
 * Holds the process open until the user sends SIGINT/SIGTERM and tears down
 * the subscription before yielding. We register a `once` listener with
 * `prependListener` so it runs *before* the global SIGINT handler in `app.ts`
 * (which calls `fastExit` and skips our `finally` block).
 */
function awaitSignalAnd(unsubscribe: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    const onSignal = () => {
      unsubscribe();
      resolve();
    };
    process.prependOnceListener('SIGINT', onSignal);
    process.prependOnceListener('SIGTERM', onSignal);
  });
}

export function registerEthexeSubscribeCommand(program: Command): void {
  const cmd = program.command('ethexe:subscribe').description('Subscribe to ethexe events (NDJSON to stdout)');

  cmd
    .command('program <mirror>')
    .description('Stream all events emitted by a Mirror program')
    .option('--from-block <n>', 'back-fill from this block number')
    .action(async (mirrorArg: string, options: { fromBlock?: string }) => {
      const mirror = asAddress(mirrorArg, 'mirror');
      const fromBlock = parseOptionalBigInt(options.fromBlock, '--from-block');

      const api = await getEthexeApi();
      verbose(`subscribing to program events ${mirror}`);
      const unsubscribe = api.stream.programEvents(
        mirror,
        {
          onEvent: (event) => outputNdjson({ kind: 'program', ...event }),
          onError: (err) => outputNdjson({ kind: 'error', error: err.message }),
        },
        { fromBlock },
      );
      await awaitSignalAnd(unsubscribe);
    });

  cmd
    .command('router')
    .description('Stream all events emitted by the Router')
    .option('--from-block <n>', 'back-fill from this block number')
    .action(async (options: { fromBlock?: string }) => {
      const fromBlock = parseOptionalBigInt(options.fromBlock, '--from-block');
      const api = await getEthexeApi();
      verbose('subscribing to router events');
      const unsubscribe = api.stream.routerEvents(
        {
          onEvent: (event) => outputNdjson({ kind: 'router', ...event }),
          onError: (err) => outputNdjson({ kind: 'error', error: err.message }),
        },
        { fromBlock },
      );
      await awaitSignalAnd(unsubscribe);
    });

  cmd
    .command('blocks')
    .description('Stream new Ethereum block headers')
    .option('--include-pending', 'follow pending blocks too')
    .action(async (options: { includePending?: boolean }) => {
      const api = await getEthexeApi();
      verbose('subscribing to blocks');
      const unsubscribe = api.stream.blocks(
        {
          onEvent: (header) => outputNdjson({ kind: 'block', ...header }),
          onError: (err) => outputNdjson({ kind: 'error', error: err.message }),
        },
        { includePending: options.includePending },
      );
      await awaitSignalAnd(unsubscribe);
    });
}
