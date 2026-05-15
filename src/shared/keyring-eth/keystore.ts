/**
 * Ethereum V3 keystore (scrypt + AES-128-CTR) — MetaMask / ethers / web3.js
 * interoperable.
 *
 * Spec: https://ethereum.org/en/developers/docs/data-structures-and-encoding/web3-secret-storage/
 *
 * Pure-JS implementation backed by `@noble/hashes` (scrypt + keccak256) and
 * `@noble/ciphers` (AES-CTR). No native deps, no wasm at runtime.
 */

import { randomUUID } from 'node:crypto';

import { ctr } from '@noble/ciphers/aes';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { scryptAsync } from '@noble/hashes/scrypt';
import { randomBytes as nobleRandomBytes } from '@noble/hashes/utils';
import { bytesToHex, hexToBytes, type Hex } from 'viem';
import { privateKeyToAddress } from 'viem/accounts';

export interface V3Keystore {
  version: 3;
  id: string;
  address: string;
  crypto: {
    cipher: 'aes-128-ctr';
    ciphertext: string;
    cipherparams: { iv: string };
    kdf: 'scrypt';
    kdfparams: {
      dklen: 32;
      n: number;
      p: number;
      r: number;
      salt: string;
    };
    mac: string;
  };
}

/** Default scrypt parameters — match MetaMask's "standard" cost. */
export const DEFAULT_SCRYPT_PARAMS = { n: 131072, r: 8, p: 1, dklen: 32 } as const;

/** Fast scrypt parameters for unit tests / CI. NEVER use these for real wallets. */
export const TEST_SCRYPT_PARAMS = { n: 1024, r: 8, p: 1, dklen: 32 } as const;

/** V3 keystore hex fields are stored unprefixed. viem's `bytesToHex` prefixes — strip. */
function toUnprefixedHex(bytes: Uint8Array): string {
  return bytesToHex(bytes).slice(2);
}

/** Accepts both prefixed and unprefixed hex strings. */
function fromAnyHex(hex: string): Uint8Array {
  return hexToBytes((hex.startsWith('0x') ? hex : `0x${hex}`) as Hex);
}

/**
 * Encrypts a private key into a V3 keystore JSON blob.
 *
 * @param privateKey - 32-byte secp256k1 key (raw bytes or `0x`-prefixed hex)
 * @param passphrase - the passphrase to derive the encryption key from
 * @param options - optional `{ scryptParams }` to override the default cost
 * @returns the V3 keystore object (serialise with `JSON.stringify`)
 */
export async function encryptKeystore(
  privateKey: Uint8Array | string,
  passphrase: string,
  options?: {
    scryptParams?: { n: number; r: number; p: number; dklen: 32 };
    /** Skip pubkey derivation if the address is already known (e.g. from HD path). */
    address?: string;
  },
): Promise<V3Keystore> {
  const pkBytes = typeof privateKey === 'string' ? fromAnyHex(privateKey) : privateKey;
  if (pkBytes.length !== 32) throw new Error('private key must be 32 bytes');

  const params = options?.scryptParams ?? DEFAULT_SCRYPT_PARAMS;
  const salt = nobleRandomBytes(32);
  const iv = nobleRandomBytes(16);

  const dk = await scryptAsync(new TextEncoder().encode(passphrase), salt, {
    N: params.n,
    r: params.r,
    p: params.p,
    dkLen: params.dklen,
  });
  // dk[0..16] is the AES key; dk[16..32] feeds into the MAC.
  const aesKey = dk.slice(0, 16);
  const macSeed = dk.slice(16, 32);

  const ciphertext = ctr(aesKey, iv).encrypt(pkBytes);
  const mac = keccak_256(new Uint8Array([...macSeed, ...ciphertext]));

  let address = options?.address ?? privateKeyToAddress(bytesToHex(pkBytes));
  if (address.startsWith('0x')) address = address.slice(2);

  return {
    version: 3,
    id: randomUUID(),
    address: address.toLowerCase(),
    crypto: {
      cipher: 'aes-128-ctr',
      ciphertext: toUnprefixedHex(ciphertext),
      cipherparams: { iv: toUnprefixedHex(iv) },
      kdf: 'scrypt',
      kdfparams: { ...params, salt: toUnprefixedHex(salt) },
      mac: toUnprefixedHex(mac),
    },
  };
}

/**
 * Decrypts a V3 keystore back into a raw 32-byte private key.
 *
 * Throws if the passphrase is wrong (MAC mismatch) or the file is malformed.
 *
 * @returns the 32-byte private key buffer
 */
export async function decryptKeystore(keystore: V3Keystore, passphrase: string): Promise<Uint8Array> {
  if (keystore.version !== 3) throw new Error(`unsupported keystore version: ${keystore.version}`);
  if (keystore.crypto.cipher !== 'aes-128-ctr') {
    throw new Error(`unsupported cipher: ${keystore.crypto.cipher}`);
  }
  if (keystore.crypto.kdf !== 'scrypt') throw new Error(`unsupported kdf: ${keystore.crypto.kdf}`);

  const params = keystore.crypto.kdfparams;
  const salt = fromAnyHex(params.salt);
  const iv = fromAnyHex(keystore.crypto.cipherparams.iv);
  const ciphertext = fromAnyHex(keystore.crypto.ciphertext);

  const dk = await scryptAsync(new TextEncoder().encode(passphrase), salt, {
    N: params.n,
    r: params.r,
    p: params.p,
    dkLen: params.dklen,
  });
  const aesKey = dk.slice(0, 16);
  const macSeed = dk.slice(16, 32);

  const expectedMac = keccak_256(new Uint8Array([...macSeed, ...ciphertext]));
  if (toUnprefixedHex(expectedMac) !== keystore.crypto.mac.toLowerCase()) {
    throw new Error('MAC mismatch (wrong passphrase or corrupt file)');
  }

  return ctr(aesKey, iv).decrypt(ciphertext);
}

/** Lowercase 0x-hex Ethereum address for a raw secp256k1 private key. */
export function deriveAddressFromPrivateKey(privateKey: Uint8Array): string {
  return privateKeyToAddress(bytesToHex(privateKey)).toLowerCase();
}
