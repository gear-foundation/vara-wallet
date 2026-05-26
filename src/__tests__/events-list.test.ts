import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';

const mockOutput = jest.fn();

jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  output: (data: unknown) => mockOutput(data),
  verbose: jest.fn(),
}));

import { registerEventsCommand } from '../commands/events';
import { closeEventStore, initEventStore, insertEvent } from '../services/event-store';
import { writeConfig } from '../services/config';

const ETH_PROGRAM = '0xabcdef0000000000000000000000000000000002';
const NATIVE_PROGRAM = '0x' + '11'.repeat(32);

const savedWalletDir = process.env.VARA_WALLET_DIR;
let tmpDir: string;

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--chain <name>', 'target chain');
  registerEventsCommand(program);
  return program;
}

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vw-events-list-'));
  process.env.VARA_WALLET_DIR = tmpDir;
  mockOutput.mockReset();
  writeConfig({ defaultChain: 'vara-eth' });
  initEventStore();
});

afterEach(() => {
  closeEventStore();
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedWalletDir === undefined) delete process.env.VARA_WALLET_DIR;
  else process.env.VARA_WALLET_DIR = savedWalletDir;
});

describe('events list chain filtering', () => {
  it('lists native and Vara.eth rows by default even when defaultChain is set', async () => {
    seedEvents();

    await makeProgram().parseAsync(['events', 'list'], { from: 'user' });

    const rows = latestOutputRows();
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ chain: 'vara', label: 'native' }),
      expect.objectContaining({ chain: 'vara-eth', label: 'eth' }),
    ]));
  });

  it('filters explicit native event lists to native and legacy null-chain rows', async () => {
    seedEvents();

    await makeProgram().parseAsync(['--chain', 'vara', 'events', 'list'], { from: 'user' });

    const rows = latestOutputRows();
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ chain: 'vara', label: 'native' }),
      expect.objectContaining({ chain: 'vara', label: 'legacy-native' }),
    ]));
    expect(rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'eth' }),
    ]));
  });

  it('filters explicit Vara.eth event lists to Vara.eth rows', async () => {
    seedEvents();

    await makeProgram().parseAsync(['--chain', 'vara-eth', 'events', 'list'], { from: 'user' });

    const rows = latestOutputRows();
    expect(rows).toEqual([
      expect.objectContaining({ chain: 'vara-eth', label: 'eth' }),
    ]);
  });

  it('infers program filter normalization from address shape when chain is omitted', async () => {
    seedEvents();

    await makeProgram().parseAsync(['events', 'list', '--program', ETH_PROGRAM], { from: 'user' });
    expect(latestOutputRows()).toEqual([
      expect.objectContaining({ chain: 'vara-eth', label: 'eth' }),
    ]);

    await makeProgram().parseAsync(['events', 'list', '--program', NATIVE_PROGRAM], { from: 'user' });
    expect(latestOutputRows()).toEqual([
      expect.objectContaining({ chain: 'vara', label: 'native' }),
    ]);
  });
});

function seedEvents(): void {
  insertEvent({
    type: 'program',
    chain: 'vara',
    event_id: 'native',
    data: { label: 'native' },
    program_id: NATIVE_PROGRAM,
  });
  insertEvent({
    type: 'program',
    chain: 'vara-eth',
    event_id: 'eth',
    data: { label: 'eth' },
    program_id: ETH_PROGRAM,
  });
  insertLegacyNullChainEvent();
}

function insertLegacyNullChainEvent(): void {
  const db = new Database(path.join(tmpDir, 'events.db'));
  try {
    db.prepare(`
      INSERT INTO events (type, chain, network, event_id, data, block_number, block_hash, source, destination, program_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'program',
      null,
      null,
      'legacy-native',
      JSON.stringify({ label: 'legacy-native' }),
      null,
      null,
      null,
      null,
      '0x' + '22'.repeat(32),
      Date.now(),
    );
  } finally {
    db.close();
  }
}

function latestOutputRows(): Array<Record<string, unknown>> {
  return mockOutput.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
}
