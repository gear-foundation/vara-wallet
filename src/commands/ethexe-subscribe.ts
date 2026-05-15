/**
 * `ethexe:subscribe program <mirror>` / `ethexe:subscribe router` /
 * `ethexe:subscribe blocks` — emit ethexe events as NDJSON to stdout until
 * cancelled.
 */

import { Command } from 'commander';
import type { Address } from 'viem';

import { getEthexeApi } from '../services/ethexe/api';
import { CliError } from '../utils/errors';
import { outputNdjson, verbose } from '../utils/output';

function asAddress(value: string, field: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new CliError(`${field} must be a 20-byte 0x-prefixed address`, 'INVALID_ADDRESS', { field, value });
  }
  return value as Address;
}

function parseBigInt(raw?: string, field?: string): bigint | undefined {
  if (raw === undefined) return undefined;
  try {
    return BigInt(raw);
  } catch {
    throw new CliError(`${field ?? 'value'} must be an integer`, 'INVALID_BIGINT', { value: raw });
  }
}

/**
 * Run until ctrl-c. Subscribe commands return a never-resolving Promise so the
 * shutdown hooks in app.ts wait for SIGINT before tearing down.
 */
function keepAliveForever(): Promise<void> {
  return new Promise<void>((resolve) => {
    process.on('SIGINT', () => resolve());
    process.on('SIGTERM', () => resolve());
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
      const fromBlock = parseBigInt(options.fromBlock, '--from-block');

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
      try {
        await keepAliveForever();
      } finally {
        unsubscribe();
      }
    });

  cmd
    .command('router')
    .description('Stream all events emitted by the Router')
    .option('--from-block <n>', 'back-fill from this block number')
    .action(async (options: { fromBlock?: string }) => {
      const fromBlock = parseBigInt(options.fromBlock, '--from-block');
      const api = await getEthexeApi();
      verbose('subscribing to router events');
      const unsubscribe = api.stream.routerEvents(
        {
          onEvent: (event) => outputNdjson({ kind: 'router', ...event }),
          onError: (err) => outputNdjson({ kind: 'error', error: err.message }),
        },
        { fromBlock },
      );
      try {
        await keepAliveForever();
      } finally {
        unsubscribe();
      }
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
      try {
        await keepAliveForever();
      } finally {
        unsubscribe();
      }
    });
}
