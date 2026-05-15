/**
 * Ethereum V3 keystore (scrypt + AES-128-CTR) — MetaMask / ethers / web3.js
 * interoperable.
 *
 * Spec: https://ethereum.org/en/developers/docs/data-structures-and-encoding/web3-secret-storage/
 *
 * Pure-JS implementation backed by `@noble/hashes` (scrypt + keccak256) and
 * `@noble/ciphers` (AES-CTR). No native deps, no wasm at runtime.
 */

import { ctr } from '@noble/ciphers/aes';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { scryptAsync } from '@noble/hashes/scrypt';
import { randomBytes as nobleRandomBytes } from '@noble/hashes/utils';

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

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('odd-length hex string');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function makeUuidV4(): string {
  const b = nobleRandomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = toHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function addressFromPrivateKey(privateKey: Uint8Array): string {
  // 65-byte uncompressed pubkey (0x04 ‖ x ‖ y). Drop the prefix before hashing.
  const uncompressed = secp256k1.getPublicKey(privateKey, false);
  const hash = keccak_256(uncompressed.slice(1));
  return `0x${toHex(hash.slice(12))}`;
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
    address?: string; // skip pubkey derivation if known (e.g. from HD path)
  },
): Promise<V3Keystore> {
  const pkBytes = typeof privateKey === 'string' ? fromHex(privateKey) : privateKey;
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

  let address = options?.address ?? addressFromPrivateKey(pkBytes);
  if (address.startsWith('0x')) address = address.slice(2);

  return {
    version: 3,
    id: makeUuidV4(),
    address: address.toLowerCase(),
    crypto: {
      cipher: 'aes-128-ctr',
      ciphertext: toHex(ciphertext),
      cipherparams: { iv: toHex(iv) },
      kdf: 'scrypt',
      kdfparams: { ...params, salt: toHex(salt) },
      mac: toHex(mac),
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
  const salt = fromHex(params.salt);
  const iv = fromHex(keystore.crypto.cipherparams.iv);
  const ciphertext = fromHex(keystore.crypto.ciphertext);

  const dk = await scryptAsync(new TextEncoder().encode(passphrase), salt, {
    N: params.n,
    r: params.r,
    p: params.p,
    dkLen: params.dklen,
  });
  const aesKey = dk.slice(0, 16);
  const macSeed = dk.slice(16, 32);

  const expectedMac = keccak_256(new Uint8Array([...macSeed, ...ciphertext]));
  if (toHex(expectedMac) !== keystore.crypto.mac.toLowerCase()) {
    throw new Error('MAC mismatch (wrong passphrase or corrupt file)');
  }

  return ctr(aesKey, iv).decrypt(ciphertext);
}

/**
 * Computes the lowercase 0x-hex address for a raw secp256k1 private key.
 * Used after import to populate the `address` field of a fresh keystore.
 *
 * Despite the async signature, this is now a synchronous derivation under the
 * hood — keeping the Promise return type means callers don't have to be
 * rewritten if/when we add a more expensive path here (e.g. EIP-55 checksum).
 */
export async function deriveAddressFromPrivateKey(privateKey: Uint8Array): Promise<string> {
  return addressFromPrivateKey(privateKey);
}
