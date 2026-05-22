/**
 * Phase 3a — Ethereum V3 keystore + HD derivation unit tests.
 *
 * Uses TEST_SCRYPT_PARAMS (N=1024) so the suite finishes in ~1s.
 * Production code paths use N=131072 — keep tests fast, not realistic.
 */

import {
  DEFAULT_ETH_HD_PATH,
  decryptKeystore,
  deriveAddressFromPrivateKey,
  deriveEthereumKey,
  encryptKeystore,
  generateMnemonic,
  isValidMnemonic,
  TEST_SCRYPT_PARAMS,
} from '../shared/keyring-eth';

const ANVIL_0_KEY_HEX = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_0_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

describe('encryptKeystore / decryptKeystore', () => {
  it('round-trips a private key through encrypt → decrypt', async () => {
    const key = hexToBytes(ANVIL_0_KEY_HEX);
    const ks = await encryptKeystore(key, 'correct horse battery staple', { scryptParams: TEST_SCRYPT_PARAMS });
    const decrypted = await decryptKeystore(ks, 'correct horse battery staple');
    expect(Buffer.from(decrypted).toString('hex')).toBe(ANVIL_0_KEY_HEX);
  });

  it('throws on wrong passphrase (MAC mismatch)', async () => {
    const key = hexToBytes(ANVIL_0_KEY_HEX);
    const ks = await encryptKeystore(key, 'right', { scryptParams: TEST_SCRYPT_PARAMS });
    await expect(decryptKeystore(ks, 'wrong')).rejects.toThrow(/MAC mismatch/i);
  });

  it('derives the correct EIP-55-lowercase address from Anvil #0', async () => {
    const key = hexToBytes(ANVIL_0_KEY_HEX);
    const derived = deriveAddressFromPrivateKey(key);
    expect(derived.toLowerCase()).toBe(ANVIL_0_ADDR);
  });

  it('populates the keystore address field from a known key', async () => {
    const key = hexToBytes(ANVIL_0_KEY_HEX);
    const ks = await encryptKeystore(key, 'pw', { scryptParams: TEST_SCRYPT_PARAMS });
    expect(`0x${ks.address}`).toBe(ANVIL_0_ADDR);
  });

  it('rejects keys that are not 32 bytes', async () => {
    await expect(encryptKeystore(new Uint8Array(31), 'pw', { scryptParams: TEST_SCRYPT_PARAMS })).rejects.toThrow(
      /must be 32 bytes/,
    );
  });

  it('emits a V3 keystore with stable shape', async () => {
    const key = hexToBytes(ANVIL_0_KEY_HEX);
    const ks = await encryptKeystore(key, 'pw', { scryptParams: TEST_SCRYPT_PARAMS });
    expect(ks.version).toBe(3);
    expect(ks.crypto.cipher).toBe('aes-128-ctr');
    expect(ks.crypto.kdf).toBe('scrypt');
    expect(ks.crypto.kdfparams.n).toBe(TEST_SCRYPT_PARAMS.n);
    expect(typeof ks.id).toBe('string');
    expect(ks.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

});

describe('BIP39 + BIP32 HD derivation', () => {
  it('generates a 12-word mnemonic', () => {
    const m = generateMnemonic();
    expect(m.split(' ').length).toBe(12);
    expect(isValidMnemonic(m)).toBe(true);
  });

  it('rejects an invalid mnemonic', () => {
    expect(isValidMnemonic('not a real mnemonic')).toBe(false);
  });

  it('derives the canonical Anvil mnemonic → first account', () => {
    // Anvil's default mnemonic, see https://book.getfoundry.sh/anvil/
    const mnemonic = 'test test test test test test test test test test test junk';
    const key = deriveEthereumKey(mnemonic, DEFAULT_ETH_HD_PATH);
    // Anvil #0 derived from this mnemonic at m/44'/60'/0'/0/0
    expect(Buffer.from(key).toString('hex')).toBe(ANVIL_0_KEY_HEX);
  });

  it('throws on invalid mnemonic', () => {
    expect(() => deriveEthereumKey('garbage', DEFAULT_ETH_HD_PATH)).toThrow(/invalid BIP39/i);
  });
});
