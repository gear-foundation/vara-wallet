#!/usr/bin/env node
/**
 * Rebuild + relink @vara-eth/api from a sibling checkout.
 *
 * Usage:
 *   yarn dev:link:vara-eth                # uses default sibling path
 *   yarn dev:link:vara-eth ../foo/bar     # explicit path to @vara-eth/api root
 *
 * Pipeline:
 *   1. Resolve the sibling @vara-eth/api checkout (default: ../gear-js/apis/vara-eth)
 *   2. `yarn build` in the lib (clean ESM + CJS output)
 *   3. `yarn pack` to a stable filename in vara-wallet/vendor/
 *   4. Bump package.json's `file:` reference if the version moved
 *   5. `npm install` to refresh the tarball into node_modules
 *
 * The point: every lib change is one command away from being usable here,
 * without losing the `vendor/` tarball checkpoint that contributors without
 * a sibling checkout depend on.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WALLET_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LIB_PATH = resolve(WALLET_ROOT, '..', 'gear-js', 'apis', 'vara-eth');
const VENDOR_DIR = join(WALLET_ROOT, 'vendor');

const libPathArg = process.argv[2];
const libPath = libPathArg ? resolve(libPathArg) : DEFAULT_LIB_PATH;

if (!existsSync(libPath)) {
  console.error(`error: @vara-eth/api checkout not found at ${libPath}`);
  console.error('       pass an explicit path: yarn dev:link:vara-eth <path>');
  process.exit(1);
}

const libPkg = JSON.parse(readFileSync(join(libPath, 'package.json'), 'utf8'));
if (libPkg.name !== '@vara-eth/api') {
  console.error(`error: ${libPath}/package.json is "${libPkg.name}", not "@vara-eth/api"`);
  process.exit(1);
}

const version = libPkg.version;
const tarballName = `vara-eth-api-${version}.tgz`;
const tarballPath = join(VENDOR_DIR, tarballName);

console.log(`[link] lib: ${libPath} @ ${version}`);
console.log(`[link] target tarball: ${tarballPath}`);

console.log('[link] building lib...');
execSync('yarn build', { cwd: libPath, stdio: 'inherit' });

console.log('[link] packing...');
// `yarn pack --out` writes to the given path, overwriting if present.
execSync(`yarn pack --out "${tarballPath}"`, { cwd: libPath, stdio: 'inherit' });

if (!existsSync(tarballPath)) {
  console.error(`error: yarn pack did not produce ${tarballPath}`);
  process.exit(1);
}

console.log('[link] installing into node_modules...');
// `npm install <tarball>` updates package.json's file: reference to point at
// this tarball AND extracts it into node_modules in one step. No --force, so
// unrelated deps (smoldot, sails-js, etc.) aren't refetched.
//
// During rc development the version string typically doesn't change, but
// `npm install` of a tarball file always re-extracts when the content hash
// differs from the cached install, so this stays correct without --force.
// `./` prefix forces npm to treat the arg as a filesystem path rather than
// a github shorthand (`vendor/foo` is otherwise interpreted as `vendor/foo` org/repo
// and fed to `git ls-remote ssh://...`).
execSync('npm install ' + JSON.stringify(`./vendor/${tarballName}`), {
  cwd: WALLET_ROOT,
  stdio: 'inherit',
});

console.log(`[link] done. @vara-eth/api@${version} now linked from ${tarballName}`);
