import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveEthexePassphrase } from '../services/vara-eth/account';

let tmpDir: string;
const savedWalletDir = process.env.VARA_WALLET_DIR;
const savedPassphrase = process.env.VARA_PASSPHRASE;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vw-eth-passphrase-'));
  process.env.VARA_WALLET_DIR = tmpDir;
  delete process.env.VARA_PASSPHRASE;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedWalletDir === undefined) delete process.env.VARA_WALLET_DIR;
  else process.env.VARA_WALLET_DIR = savedWalletDir;
  if (savedPassphrase === undefined) delete process.env.VARA_PASSPHRASE;
  else process.env.VARA_PASSPHRASE = savedPassphrase;
});

describe('resolveEthexePassphrase', () => {
  it('uses a per-wallet passphrase before the global passphrase file', () => {
    mkdirSync(path.join(tmpDir, 'passphrases'), { recursive: true });
    writeFileSync(path.join(tmpDir, '.passphrase'), 'global-pass\n');
    writeFileSync(path.join(tmpDir, 'passphrases', 'hoodi-smoke.passphrase'), 'wallet-pass\n');

    expect(resolveEthexePassphrase('hoodi-smoke')).toEqual({
      passphrase: 'wallet-pass',
      source: 'wallet-file',
    });
  });

  it('keeps explicit and environment passphrases higher precedence than files', () => {
    mkdirSync(path.join(tmpDir, 'passphrases'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'passphrases', 'hoodi-smoke.passphrase'), 'wallet-pass\n');
    process.env.VARA_PASSPHRASE = 'env-pass';

    expect(resolveEthexePassphrase('hoodi-smoke')).toEqual({
      passphrase: 'env-pass',
      source: 'env',
    });
    expect(resolveEthexePassphrase('hoodi-smoke', 'flag-pass')).toEqual({
      passphrase: 'flag-pass',
      source: 'flag',
    });
  });
});
