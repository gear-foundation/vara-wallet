import { Command } from 'commander';
import { initEventStore, queryEvents, pruneEvents } from '../services/event-store';
import { type Chain, resolveChain } from '../chains/types';
import { output, verbose, addressToHex } from '../utils';
import { asAddress } from '../utils/eth-types';
import { parseDuration } from './subscribe/shared';

export function registerEventsCommand(program: Command): void {
  const events = program
    .command('events')
    .description('Query and manage captured events from the event store');

  events
    .command('list')
    .description('List captured events with optional filters')
    .option('--type <type>', 'filter by event type (block, message, mailbox, balance, transfer, program)')
    .option('--since <duration>', 'time filter (e.g., 1h, 30m, 7d)')
    .option('--program <id>', 'filter by program ID')
    .option('--chain <chain>', 'filter by chain: vara or vara-eth')
    .option('--network <network>', 'filter by network preset')
    .option('--limit <n>', 'max results (default: 50)', '50')
    .action((options: { type?: string; since?: string; program?: string; chain?: string; network?: string; limit: string }, cmd: Command) => {
      initEventStore();

      const since = options.since ? Date.now() - parseDuration(options.since) : undefined;
      const limit = parseInt(options.limit, 10);
      const chain = resolveExplicitChainFilter(cmd);
      const program = normalizeProgramFilter(options.program, chain);

      const rows = queryEvents({ type: options.type, since, program, chain, network: options.network, limit });
      const parsed = rows.map((row) => ({
        id: row.id,
        chain: row.chain ?? 'vara',
        network: row.network ?? null,
        ...JSON.parse(row.data),
        storedAt: row.created_at,
      }));

      if (parsed.length === 0) {
        verbose("No events captured. Run 'vara-wallet subscribe ...' first to start capturing events.");
      }

      output(parsed);
    });

  events
    .command('prune')
    .description('Delete old events from the event store')
    .option('--older-than <duration>', 'delete events older than duration (default: 7d)', '7d')
    .action((options: { olderThan: string }) => {
      initEventStore();

      const olderThanMs = parseDuration(options.olderThan);
      const count = pruneEvents(olderThanMs);

      output({ pruned: count });
    });
}

function resolveExplicitChainFilter(cmd: Command): Chain | undefined {
  if (!hasCliOptionSource(cmd, 'chain')) return undefined;
  const opts = cmd.optsWithGlobals() as { chain?: string };
  return opts.chain ? resolveChain(opts.chain) : undefined;
}

function hasCliOptionSource(cmd: Command, optionName: string): boolean {
  let current: Command | undefined = cmd;
  while (current) {
    if (current.getOptionValueSource(optionName) === 'cli') return true;
    current = current.parent ?? undefined;
  }
  return false;
}

function normalizeProgramFilter(program: string | undefined, chain: Chain | undefined): string | undefined {
  if (!program) return undefined;
  if (chain === 'vara-eth') return asAddress(program, '--program');
  if (chain === 'vara') return addressToHex(program);
  return isEthAddress(program) ? asAddress(program, '--program') : addressToHex(program);
}

function isEthAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}
