import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';

const mockOutput = jest.fn();
jest.mock('../utils/output', () => ({
  ...jest.requireActual('../utils/output'),
  output: (data: unknown) => mockOutput(data),
  verbose: jest.fn(),
}));

import { registerVaraEthWalletCommand } from '../commands/vara-eth-wallet';

let tmpDir: string;
const savedWalletDir = process.env.VARA_WALLET_DIR;
const savedPassphrase = process.env.VARA_PASSPHRASE;

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--passphrase <pass>', 'wallet passphrase');
  registerVaraEthWalletCommand(program);
  return program;
}

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vw-eth-wallet-passphrase-'));
  process.env.VARA_WALLET_DIR = tmpDir;
  delete process.env.VARA_PASSPHRASE;
  mockOutput.mockReset();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedWalletDir === undefined) delete process.env.VARA_WALLET_DIR;
  else process.env.VARA_WALLET_DIR = savedWalletDir;
  if (savedPassphrase === undefined) delete process.env.VARA_PASSPHRASE;
  else process.env.VARA_PASSPHRASE = savedPassphrase;
});

describe('vara-eth:wallet keys passphrase resolution', () => {
  it('does not print seed material on create unless requested', async () => {
    await makeProgram().parseAsync(['--passphrase', 'wallet-pass', 'vara-eth:wallet', 'create', 'quiet-wallet'], {
      from: 'user',
    });

    const createOutput = mockOutput.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(createOutput.name).toBe('quiet-wallet');
    expect(createOutput.mnemonic).toBeUndefined();
    expect(createOutput.privateKey).toBeUndefined();
  });

  it('uses the per-wallet passphrase file for existing keystores', async () => {
    await makeProgram().parseAsync(['--passphrase', 'wallet-pass', 'vara-eth:wallet', 'create', 'hoodi-smoke'], {
      from: 'user',
    });

    mkdirSync(path.join(tmpDir, 'passphrases'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'passphrases', 'hoodi-smoke.passphrase'), 'wallet-pass\n');

    await makeProgram().parseAsync(['vara-eth:wallet', 'keys', 'hoodi-smoke'], { from: 'user' });

    const keysOutput = mockOutput.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(keysOutput.name).toBe('hoodi-smoke');
    expect(keysOutput.privateKey).toMatch(/^0x[0-9a-f]+$/);
  });
});
