import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

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

try {
  const pack = spawnSync(npmCmd, [...npmBaseArgs, 'pack', '--pack-destination', tmp, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
  });
  if (pack.status !== 0) {
    process.stdout.write(pack.stdout);
    process.stderr.write(pack.stderr);
    throw new Error(`${npmCmd} pack exited with ${pack.status}`);
  }

  const tarball = join(tmp, `vara-wallet-${packageJson.version}.tgz`);
  const prefix = join(tmp, 'prefix');
  run(npmCmd, [...npmBaseArgs, 'install', '--prefix', prefix, '-g', tarball]);

  const bin = process.platform === 'win32'
    ? join(prefix, 'vara-wallet.cmd')
    : join(prefix, 'bin', 'vara-wallet');

  run(bin, ['--version'], { cwd: tmp });
} finally {
  await rm(tmp, { recursive: true, force: true });
}
