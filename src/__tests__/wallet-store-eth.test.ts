/**
 * Phase 3a — Ethexe wallet store (V3 keystore file I/O) unit tests.
 *
 * Each test point isolates `VARA_WALLET_DIR` to a unique tmp path so the
 * file-system side effects don't leak between cases or interfere with the
 * user's real `~/.vara-wallet/`.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { encryptKeystore, TEST_SCRYPT_PARAMS } from '../shared/keyring-eth/keystore';
import {
  ethexeWalletExists,
  listEthexeWallets,
  listLegacyVaraWalletNames,
  loadEthexeWallet,
  saveEthexeWallet,
} from '../shared/keyring-eth/store';

const ANVIL_0_KEY_HEX = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

let tmpDir: string;
const savedEnv = process.env.VARA_WALLET_DIR;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vw-eth-store-'));
  process.env.VARA_WALLET_DIR = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env.VARA_WALLET_DIR;
  else process.env.VARA_WALLET_DIR = savedEnv;
});

describe('Vara.eth wallet store', () => {
  it('save → list → load → exists round trip', async () => {
    const key = hexToBytes(ANVIL_0_KEY_HEX);
    const ks = await encryptKeystore(key, 'pw', { scryptParams: TEST_SCRYPT_PARAMS });
    const filePath = saveEthexeWallet('alice', ks);

    expect(existsSync(filePath)).toBe(true);
    expect(filePath).toMatch(/wallets\/alice\.vara-eth\.json$/);
    expect(ethexeWalletExists('alice')).toBe(true);
    expect(listEthexeWallets()).toEqual(['alice']);

    const loaded = loadEthexeWallet('alice');
    expect(loaded.version).toBe(3);
    expect(loaded.id).toBe(ks.id);
  });

  it('refuses to overwrite an existing wallet', async () => {
    const key = hexToBytes(ANVIL_0_KEY_HEX);
    const ks = await encryptKeystore(key, 'pw', { scryptParams: TEST_SCRYPT_PARAMS });
    saveEthexeWallet('alice', ks);
    expect(() => saveEthexeWallet('alice', ks)).toThrow(/already exists/i);
  });

  it('writes the keystore file with mode 0600', async () => {
    const key = hexToBytes(ANVIL_0_KEY_HEX);
    const ks = await encryptKeystore(key, 'pw', { scryptParams: TEST_SCRYPT_PARAMS });
    const filePath = saveEthexeWallet('alice', ks);
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('rejects wallet names with invalid characters', () => {
    expect(() => ethexeWalletExists('not/safe')).toThrow(/Invalid wallet name/i);
    expect(() => ethexeWalletExists('foo bar')).toThrow(/Invalid wallet name/i);
  });

  it('lists legacy substrate wallets without mutating them', async () => {
    const walletsDir = path.join(tmpDir, 'wallets');
    mkdirSync(walletsDir, { recursive: true });
    writeFileSync(path.join(walletsDir, 'legacy.json'), '{}');
    writeFileSync(path.join(walletsDir, 'newBob.vara.json'), '{}');

    const key = hexToBytes(ANVIL_0_KEY_HEX);
    const ks = await encryptKeystore(key, 'pw', { scryptParams: TEST_SCRYPT_PARAMS });
    saveEthexeWallet('alice', ks);

    expect(existsSync(path.join(walletsDir, 'legacy.json'))).toBe(true);
    expect(existsSync(path.join(walletsDir, 'legacy.vara.json'))).toBe(false);
    expect(existsSync(path.join(walletsDir, 'newBob.vara.json'))).toBe(true);
    expect(listLegacyVaraWalletNames()).toEqual(['legacy']);
  });

  it('loadEthexeWallet throws on a corrupt file', () => {
    const walletsDir = path.join(tmpDir, 'wallets');
    mkdirSync(walletsDir, { recursive: true });
    writeFileSync(path.join(walletsDir, 'broken.vara-eth.json'), '{not json');
    expect(() => loadEthexeWallet('broken')).toThrow(/corrupted/i);
  });

  it('loadEthexeWallet throws on a non-V3 file', () => {
    const walletsDir = path.join(tmpDir, 'wallets');
    mkdirSync(walletsDir, { recursive: true });
    writeFileSync(path.join(walletsDir, 'wrong.vara-eth.json'), JSON.stringify({ version: 1 }));
    expect(() => loadEthexeWallet('wrong')).toThrow(/not a V3 keystore/i);
  });
});
