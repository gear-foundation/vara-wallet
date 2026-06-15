import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const repoRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const tmp = await mkdtemp(join(tmpdir(), 'vara-wallet-pack-smoke-'));
const npmCli = process.env.npm_execpath;
const npmCmd = npmCli ? process.execPath : 'npm';
const npmBaseArgs = npmCli ? [npmCli] : [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
}

function assertInstalledResolve(prefix, request) {
  const globalRoots = process.platform === 'win32'
    ? [join(prefix, 'node_modules')]
    : [join(prefix, 'lib', 'node_modules'), join(prefix, 'node_modules')];

  let packageJsonPath;
  for (const root of globalRoots) {
    try {
      packageJsonPath = createRequire(join(root, 'resolve.cjs')).resolve('vara-wallet/package.json');
      break;
    } catch {
      // Try the next npm global layout.
    }
  }

  if (!packageJsonPath) {
    throw new Error(`Packed install did not expose vara-wallet/package.json under ${prefix}`);
  }

  try {
    createRequire(packageJsonPath).resolve(request);
  } catch (error) {
    throw new Error(`Packed install cannot resolve ${request}: ${error.message}`);
  }
}

try {
  run(npmCmd, [...npmBaseArgs, 'pack', '--pack-destination', tmp]);

  const tarball = join(tmp, `vara-wallet-${packageJson.version}.tgz`);
  const prefix = join(tmp, 'prefix');
  run(npmCmd, [...npmBaseArgs, 'install', '--prefix', prefix, '-g', tarball]);

  const bin = process.platform === 'win32'
    ? join(prefix, 'vara-wallet.cmd')
    : join(prefix, 'bin', 'vara-wallet');

  run(bin, ['--version'], { cwd: tmp });
  assertInstalledResolve(prefix, 'viem/utils');
  assertInstalledResolve(prefix, 'kzg-wasm');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
