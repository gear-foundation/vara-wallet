import { Command } from 'commander';

import { resolveChain, type Chain } from '../chains/types';
import { readConfig } from '../services/config';

export function resolveActiveChain(command: Command): Chain {
  const opts = command.optsWithGlobals() as { chain?: string };
  const config = readConfig();
  return resolveChain(opts.chain, config.defaultChain);
}

export function resolveActionChain(actionCommand: Command | undefined, explicit?: string, configDefault?: string): Chain {
  if (!explicit && isVaraEthCommand(actionCommand)) return 'vara-eth';
  return resolveChain(explicit, configDefault);
}

function isVaraEthCommand(command: Command | undefined): boolean {
  let current: Command | undefined = command;
  while (current) {
    if (current.name().startsWith('vara-eth:')) return true;
    current = current.parent ?? undefined;
  }
  return false;
}
