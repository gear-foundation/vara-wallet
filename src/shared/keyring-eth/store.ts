/**
 * Vara.eth wallet store — file layout `~/.vara-wallet/wallets/<name>.vara-eth.json`.
 *
 * Mirrors the substrate wallet store at `services/wallet-store.ts` but writes
 * V3 (Ethereum) keystores instead of polkadot xsalsa20-poly1305 JSONs.
 * Persistence routes through `writeUserFile` so the wallets/ dir is chmod 0700
 * and the keystore file is chmod 0600.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { getConfigDir } from '../../services/config';
import { CliError } from '../../utils/errors';
import { writeUserFile } from '../../utils/secure-file';
import type { V3Keystore } from './keystore';

const VARA_ETH_SUFFIX = '.vara-eth.json';

function getWalletsDir(): string {
  return path.join(getConfigDir(), 'wallets');
}

function sanitizeName(name: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new CliError(`Invalid wallet name "${name}": only [a-zA-Z0-9._-] allowed`, 'INVALID_WALLET_NAME', { name });
  }
  return name;
}

function varaEthWalletPath(name: string): string {
  return path.join(getWalletsDir(), `${sanitizeName(name)}${VARA_ETH_SUFFIX}`);
}

/**
 * Persists a V3 keystore to disk. Routes through `writeUserFile` so the
 * `wallets/` parent is 0700 and the keystore file is 0600. Refuses to
 * overwrite — delete the file out-of-band to replace.
 */
export function saveEthexeWallet(name: string, keystore: V3Keystore): string {
  const filePath = varaEthWalletPath(name);
  try {
    statSync(filePath);
    throw new CliError(`Vara.eth wallet "${name}" already exists at ${filePath}`, 'WALLET_EXISTS', { name, path: filePath });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  writeUserFile(filePath, JSON.stringify(keystore, null, 2) + '\n');
  return filePath;
}

/** Loads a V3 keystore from disk by wallet name. */
export function loadEthexeWallet(name: string): V3Keystore {
  const filePath = varaEthWalletPath(name);
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError(`Vara.eth wallet "${name}" not found at ${filePath}`, 'WALLET_NOT_FOUND', { name, path: filePath });
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new CliError(`Vara.eth wallet "${name}" is corrupted (invalid JSON)`, 'WALLET_CORRUPTED', { name, cause: String(cause) });
  }
  if (typeof parsed !== 'object' || parsed === null || (parsed as { version?: unknown }).version !== 3) {
    throw new CliError(`Vara.eth wallet "${name}" is not a V3 keystore`, 'WALLET_CORRUPTED', { name });
  }
  return parsed as V3Keystore;
}

/** Lists every Vara.eth wallet name in `~/.vara-wallet/wallets/`. */
export function listEthexeWallets(): string[] {
  try {
    return readdirSync(getWalletsDir())
      .filter((f) => f.endsWith(VARA_ETH_SUFFIX))
      .map((f) => f.slice(0, -VARA_ETH_SUFFIX.length))
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** Returns true if a Vara.eth wallet exists with this name. */
export function ethexeWalletExists(name: string): boolean {
  try {
    statSync(varaEthWalletPath(name));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Lists legacy substrate-style wallet filenames that still live in the shared
 * wallets directory.
 *
 * Vara.eth commands no longer mutate these files. The helper exists for
 * diagnostics and manual migration tooling only.
 */
export function listLegacyVaraWalletNames(): string[] {
  const dir = getWalletsDir();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  return entries
    .filter((file) => file.endsWith('.json') && !file.endsWith('.vara.json') && !file.endsWith(VARA_ETH_SUFFIX) && !file.startsWith('.'))
    .map((file) => file.replace(/\.json$/, ''));
}
