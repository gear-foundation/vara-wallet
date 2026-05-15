/**
 * Ethexe wallet store — file layout `~/.vara-wallet/wallets/<name>.ethexe.json`.
 *
 * Mirrors the substrate wallet store at `services/wallet-store.ts` but writes
 * V3 (Ethereum) keystores instead of polkadot xsalsa20-poly1305 JSONs.
 * Persistence routes through `writeUserFile` so the wallets/ dir is chmod 0700
 * and the keystore file is chmod 0600.
 */

import { readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

import { getConfigDir } from '../../services/config';
import { CliError } from '../../utils/errors';
import { writeUserFile } from '../../utils/secure-file';
import type { V3Keystore } from './keystore';

function getWalletsDir(): string {
  return path.join(getConfigDir(), 'wallets');
}

function sanitizeName(name: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new CliError(`Invalid wallet name "${name}": only [a-zA-Z0-9._-] allowed`, 'INVALID_WALLET_NAME', { name });
  }
  return name;
}

function ethexeWalletPath(name: string): string {
  return path.join(getWalletsDir(), `${sanitizeName(name)}.ethexe.json`);
}

/**
 * Persists a V3 keystore to disk. Routes through `writeUserFile` so the
 * `wallets/` parent is 0700 and the keystore file is 0600. Refuses to
 * overwrite — delete the file out-of-band to replace.
 */
export function saveEthexeWallet(name: string, keystore: V3Keystore): string {
  const filePath = ethexeWalletPath(name);
  try {
    statSync(filePath);
    throw new CliError(`Ethexe wallet "${name}" already exists at ${filePath}`, 'WALLET_EXISTS', { name, path: filePath });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  writeUserFile(filePath, JSON.stringify(keystore, null, 2) + '\n');
  return filePath;
}

/** Loads a V3 keystore from disk by wallet name. */
export function loadEthexeWallet(name: string): V3Keystore {
  const filePath = ethexeWalletPath(name);
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError(`Ethexe wallet "${name}" not found at ${filePath}`, 'WALLET_NOT_FOUND', { name, path: filePath });
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new CliError(`Ethexe wallet "${name}" is corrupted (invalid JSON)`, 'WALLET_CORRUPTED', { name, cause: String(cause) });
  }
  if (typeof parsed !== 'object' || parsed === null || (parsed as { version?: unknown }).version !== 3) {
    throw new CliError(`Ethexe wallet "${name}" is not a V3 keystore`, 'WALLET_CORRUPTED', { name });
  }
  return parsed as V3Keystore;
}

/** Lists every ethexe wallet name in `~/.vara-wallet/wallets/`. */
export function listEthexeWallets(): string[] {
  try {
    return readdirSync(getWalletsDir())
      .filter((f) => f.endsWith('.ethexe.json'))
      .map((f) => f.replace(/\.ethexe\.json$/, ''))
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** Returns true if an ethexe wallet exists with this name. */
export function ethexeWalletExists(name: string): boolean {
  try {
    statSync(ethexeWalletPath(name));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

// Memoise within a single process — every ethexe:* command calls this on entry,
// and after the first run there's nothing left to do. Avoids a per-call readdir.
let migratedThisProcess = false;

/**
 * One-time migration: renames pre-existing `<name>.json` to `<name>.vara.json`
 * so the chain suffix becomes explicit alongside `<name>.ethexe.json` files.
 *
 * Returns the list of renames performed (empty if nothing to do or already
 * migrated this process).
 */
export function migrateVaraWalletSuffix(): Array<{ from: string; to: string }> {
  if (migratedThisProcess) return [];
  migratedThisProcess = true;

  const dir = getWalletsDir();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const renames: Array<{ from: string; to: string }> = [];
  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    if (file.endsWith('.vara.json') || file.endsWith('.ethexe.json')) continue;
    if (file.startsWith('.')) continue;
    const from = path.join(dir, file);
    const to = path.join(dir, file.replace(/\.json$/, '.vara.json'));
    // Don't clobber a target that already exists from a partial earlier run.
    try {
      statSync(to);
      continue;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    renameSync(from, to);
    renames.push({ from, to });
  }
  return renames;
}

/** Test-only — reset the per-process migration flag between tests. */
export function __resetMigrationFlagForTests(): void {
  migratedThisProcess = false;
}
