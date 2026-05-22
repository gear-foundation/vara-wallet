import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import type { KeyringPair$Json } from '@polkadot/keyring/types';

const mockOutput = jest.fn();
jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  output: (data: unknown) => mockOutput(data),
  verbose: jest.fn(),
}));

import { registerWalletCommand } from '../commands/wallet';
import { writeConfig } from '../services/config';
import { saveWallet } from '../services/wallet-store';

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

  it('lists both wallet types when no chain is explicit, even with a Vara.eth default chain', async () => {
    saveNativeWallet('native');
    writeVaraEthWallet('eth');
    writeConfig({
      defaultChain: 'vara-eth',
      defaultAccount: 'native',
      defaultVaraEthAccount: 'eth',
    });

    await makeProgram().parseAsync(['wallet', 'list'], { from: 'user' });

    expect(mockOutput).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        chain: 'vara',
        name: 'native',
        address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
        isDefault: true,
      }),
      expect.objectContaining({
        chain: 'vara-eth',
        name: 'eth',
        address: '0xabcdef0000000000000000000000000000000001',
        isDefault: true,
        encrypted: true,
        kdf: 'scrypt',
      }),
    ]));
  });

  it('keeps explicit native wallet list filtered to native wallets', async () => {
    saveNativeWallet('native');
    writeVaraEthWallet('eth');

    await makeProgram().parseAsync(['--chain', 'vara', 'wallet', 'list'], { from: 'user' });

    const output = mockOutput.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(output).toEqual([
      expect.objectContaining({
        name: 'native',
        address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
      }),
    ]);
    expect(output.some((wallet) => wallet.name === 'eth.vara-eth')).toBe(false);
  });

  it('keeps explicit Vara.eth wallet list filtered to Vara.eth wallets', async () => {
    saveNativeWallet('native');
    writeVaraEthWallet('eth');

    await makeProgram().parseAsync(['--chain', 'vara-eth', 'wallet', 'list'], { from: 'user' });

    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      wallets: [
        expect.objectContaining({
          name: 'eth',
          address: '0xabcdef0000000000000000000000000000000001',
          kdf: 'scrypt',
        }),
      ],
    }));
  });
});

function saveNativeWallet(name: string): void {
  const json: KeyringPair$Json = {
    address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    encoded: 'encoded-data',
    encoding: { content: ['pkcs8', 'sr25519'], type: ['none'], version: '3' },
    meta: { name },
  };
  saveWallet(name, json);
}

function writeVaraEthWallet(name: string): void {
  writeFileSync(
    path.join(tmpDir, 'wallets', `${name}.vara-eth.json`),
    JSON.stringify({
      version: 3,
      address: 'abcdef0000000000000000000000000000000001',
      crypto: { kdf: 'scrypt', kdfparams: { n: 2 } },
    }),
  );
}
