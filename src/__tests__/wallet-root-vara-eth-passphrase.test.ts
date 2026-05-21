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

import { registerWalletCommand } from '../commands/wallet';

let tmpDir: string;
const savedWalletDir = process.env.VARA_WALLET_DIR;

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program
    .option('--chain <name>', 'target chain')
    .option('--passphrase <pass>', 'wallet passphrase');
  registerWalletCommand(program);
  return program;
}

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vw-root-eth-passphrase-'));
  process.env.VARA_WALLET_DIR = tmpDir;
  mockOutput.mockReset();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedWalletDir === undefined) delete process.env.VARA_WALLET_DIR;
  else process.env.VARA_WALLET_DIR = savedWalletDir;
});

describe('root wallet command on Vara.eth', () => {
  it('honors global --passphrase for create and keys', async () => {
    await makeProgram().parseAsync(
      ['--chain', 'vara-eth', '--passphrase', 'test-pass', 'wallet', 'create', '--name', 'review-smoke'],
      { from: 'user' },
    );

    await makeProgram().parseAsync(
      ['--chain', 'vara-eth', '--passphrase', 'test-pass', 'wallet', 'keys', 'review-smoke'],
      { from: 'user' },
    );

    const keysOutput = mockOutput.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(keysOutput.type).toBe('secp256k1');
    expect(keysOutput.privateKey).toMatch(/^0x[0-9a-f]+$/);
  });
});
