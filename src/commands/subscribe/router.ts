import { Command } from 'commander';

import { CliError } from '../../utils';
import { resolveActiveChain } from '../../utils/active-chain';
import { subscribeVaraEthRouter } from '../vara-eth-actions';
import { emitSystemEvent, installEpipeHandler, installGlobalTimeout, keepAlive } from './shared';

export function registerRouterCommand(parent: Command): void {
  parent
    .command('router')
    .description('Subscribe to Vara.eth Router events')
    .option('--from-block <n>', 'back-fill from this Ethereum block number')
    .action(async (options: { fromBlock?: string }) => {
      const opts = parent.optsWithGlobals() as { count?: string; timeout?: string; persist?: boolean };
      if (resolveActiveChain(parent) !== 'vara-eth') {
        throw new CliError('subscribe router is only supported with --chain vara-eth', 'UNSUPPORTED_CHAIN_OPERATION');
      }

      installGlobalTimeout(opts.timeout);
      installEpipeHandler();

      let ka: ReturnType<typeof keepAlive>;
      await subscribeVaraEthRouter(
        { fromBlock: options.fromBlock, persist: opts.persist, count: opts.count, onLimit: () => ka?.triggerExit() },
        async (unsub) => {
          emitSystemEvent('subscribed', { subscription: 'router', chain: 'vara-eth' });
          ka = keepAlive([unsub], { timeout: opts.timeout ? parseInt(opts.timeout, 10) : undefined });
          await ka.promise;
        },
      );
    });
}
