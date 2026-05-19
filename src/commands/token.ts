import { Command } from 'commander';
import {
  listKnownVftTokens,
  resolveTokenIdentifier,
  resolveTokenNetwork,
  TokenResolveOptions,
  KnownVftToken,
} from '../services/token-registry';
import { output } from '../utils';

interface TokenListOptions {
  all?: boolean;
}

export function registerTokenCommand(program: Command): void {
  const token = program
    .command('token')
    .description('Resolve and list built-in bridged VFT token aliases');

  token
    .command('list')
    .description('List built-in bridged VFT tokens for the selected network')
    .option('--all', 'list tokens for all supported networks')
    .action((options: TokenListOptions) => {
      const opts = program.optsWithGlobals() as TokenResolveOptions;
      const network = options.all ? undefined : resolveTokenNetwork(opts);
      const tokens = listKnownVftTokens(network).map(formatKnownToken);

      output({
        network: network ?? 'all',
        tokens,
      });
    });

  token
    .command('resolve')
    .description('Resolve a built-in token alias or raw token program address')
    .argument('<token>', 'token alias (e.g. usdc) or token program address')
    .action((tokenInput: string) => {
      const opts = program.optsWithGlobals() as TokenResolveOptions;
      const resolved = resolveTokenIdentifier(tokenInput, opts);

      output({
        input: tokenInput,
        address: resolved.address,
        isKnown: resolved.isKnown,
        ...(resolved.token && {
          network: resolved.network,
          symbol: resolved.token.symbol,
          name: resolved.token.name,
          aliases: resolved.token.aliases,
          category: resolved.token.category,
          decimals: resolved.token.decimals ?? null,
          source: resolved.token.source,
        }),
      });
    });
}

function formatKnownToken(token: KnownVftToken): Record<string, unknown> {
  return {
    network: token.network,
    symbol: token.symbol,
    name: token.name,
    address: token.address,
    aliases: token.aliases,
    category: token.category,
    decimals: token.decimals ?? null,
    source: token.source,
  };
}
