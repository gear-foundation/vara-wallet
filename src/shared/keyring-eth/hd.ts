/**
 * BIP39 mnemonic + BIP32 HD derivation for Ethereum (m/44'/60'/0'/0/n).
 *
 * Wraps `@scure/bip39` and `@scure/bip32`. No native deps.
 */

import { HDKey } from '@scure/bip32';
import { generateMnemonic as scureGenerateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

/** Default BIP44 derivation path for the first Ethereum account. */
export const DEFAULT_ETH_HD_PATH = "m/44'/60'/0'/0/0";

/** Generates a fresh 12-word (128-bit) BIP39 mnemonic phrase. */
export function generateMnemonic(): string {
  return scureGenerateMnemonic(wordlist, 128);
}

/** Validates a BIP39 mnemonic against the English wordlist. */
export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic.trim(), wordlist);
}

/**
 * Derives a 32-byte secp256k1 private key from a mnemonic + BIP44 path.
 *
 * @param mnemonic - 12/15/18/21/24-word BIP39 phrase
 * @param path - BIP44 path (defaults to {@link DEFAULT_ETH_HD_PATH})
 * @param passphrase - optional BIP39 passphrase (rarely used by ETH wallets)
 * @throws if the mnemonic is invalid, the path is malformed, or the derived
 *         leaf node has no private key (shouldn't happen with a normal path)
 */
export function deriveEthereumKey(
  mnemonic: string,
  path: string = DEFAULT_ETH_HD_PATH,
  passphrase = '',
): Uint8Array {
  const trimmed = mnemonic.trim();
  if (!isValidMnemonic(trimmed)) {
    throw new Error('invalid BIP39 mnemonic');
  }
  const seed = mnemonicToSeedSync(trimmed, passphrase);
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(path);
  if (!child.privateKey) {
    throw new Error(`HD derivation at ${path} produced no private key`);
  }
  return child.privateKey;
}
