/**
 * Ethexe wallet store — file layout `~/.vara-wallet/wallets/<name>.ethexe.json`.
 *
 * Mirrors the substrate wallet store at `services/wallet-store.ts` but writes
 * V3 (Ethereum) keystores instead of polkadot xsalsa20-poly1305 JSONs. Files
 * are chmod 0600 on creation (Section 3 security gate).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CliError } from '../../utils/errors';
import type { V3Keystore } from './keystore';

const DEFAULT_ROOT = path.join(process.env.HOME ?? '~', '.vara-wallet');

function getRootDir(): string {
  return process.env.VARA_WALLET_DIR ?? DEFAULT_ROOT;
}

function getWalletsDir(): string {
  const dir = path.join(getRootDir(), 'wallets');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
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
 * Persists a V3 keystore to disk. Throws if the file already exists; callers
 * must explicitly `removeEthexeWallet` first to overwrite.
 *
 * File is written with mode 0600 — readable/writable only by the owning user.
 */
export function saveEthexeWallet(name: string, keystore: V3Keystore): string {
  const filePath = ethexeWalletPath(name);
  if (existsSync(filePath)) {
    throw new CliError(`Ethexe wallet "${name}" already exists at ${filePath}`, 'WALLET_EXISTS', { name, path: filePath });
  }
  writeFileSync(filePath, JSON.stringify(keystore, null, 2) + '\n', { mode: 0o600 });
  return filePath;
}

/** Loads a V3 keystore from disk by wallet name. */
export function loadEthexeWallet(name: string): V3Keystore {
  const filePath = ethexeWalletPath(name);
  if (!existsSync(filePath)) {
    throw new CliError(`Ethexe wallet "${name}" not found at ${filePath}`, 'WALLET_NOT_FOUND', { name, path: filePath });
  }
  const raw = readFileSync(filePath, 'utf8');
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
  const dir = getWalletsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ethexe.json'))
    .map((f) => f.replace(/\.ethexe\.json$/, ''))
    .sort();
}

/** Returns true if an ethexe wallet exists with this name. */
export function ethexeWalletExists(name: string): boolean {
  return existsSync(ethexeWalletPath(name));
}

/**
 * One-time migration: renames pre-existing `<name>.json` to `<name>.vara.json`
 * so the chain suffix becomes explicit alongside `<name>.ethexe.json` files.
 *
 * Called from `wallet list` and the first ethexe command. Idempotent — safe to
 * call repeatedly; only renames files that lack a chain suffix.
 *
 * Returns the list of renames performed (empty if nothing to do).
 */
export function migrateVaraWalletSuffix(): Array<{ from: string; to: string }> {
  const dir = getWalletsDir();
  if (!existsSync(dir)) return [];
  const renames: Array<{ from: string; to: string }> = [];
  for (const file of readdirSync(dir)) {
    // Files we shouldn't touch: already-suffixed (.vara.json / .ethexe.json),
    // non-JSON, or hidden files.
    if (!file.endsWith('.json')) continue;
    if (file.endsWith('.vara.json') || file.endsWith('.ethexe.json')) continue;
    if (file.startsWith('.')) continue;
    const from = path.join(dir, file);
    const to = path.join(dir, file.replace(/\.json$/, '.vara.json'));
    // If the target already exists (somehow), skip — don't overwrite.
    if (existsSync(to)) continue;
    const { renameSync } = require('node:fs') as typeof import('node:fs');
    renameSync(from, to);
    renames.push({ from, to });
  }
  return renames;
}
