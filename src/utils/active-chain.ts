import { Command } from 'commander';

import { resolveChain, type Chain } from '../chains/types';
import { readConfig } from '../services/config';

export function resolveActiveChain(command: Command): Chain {
  const opts = command.optsWithGlobals() as { chain?: string };
  const config = readConfig();
  return resolveChain(opts.chain, config.defaultChain);
}
