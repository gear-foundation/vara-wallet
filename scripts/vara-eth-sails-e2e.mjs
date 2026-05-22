#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const enabled = /^(1|true|yes|on)$/i.test(process.env.VARA_ETH_SAILS_E2E ?? '');

if (!enabled) {
  console.log(JSON.stringify({
    skipped: true,
    reason: 'Set VARA_ETH_SAILS_E2E=1 to run the live Vara.eth Sails E2E harness.',
  }));
  process.exit(0);
}

const required = ['VARA_ETH_E2E_WASM', 'VARA_ETH_E2E_IDL', 'VARA_ETH_E2E_ACCOUNT', 'VARA_ETH_E2E_QUERY', 'VARA_ETH_E2E_WRITE'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(JSON.stringify({
    error: 'Missing live E2E prerequisites',
    missing,
  }));
  process.exit(2);
}

const cli = ['node', 'dist/app.js'];
if (!existsSync('dist/app.js')) {
  console.error(JSON.stringify({
    error: 'dist/app.js not found. Run npm run build before the live E2E harness.',
  }));
  process.exit(2);
}

const wasm = process.env.VARA_ETH_E2E_WASM;
const idl = process.env.VARA_ETH_E2E_IDL;
const codeId = process.env.VARA_ETH_E2E_CODE_ID;
const account = process.env.VARA_ETH_E2E_ACCOUNT;
const network = process.env.VARA_ETH_E2E_NETWORK ?? 'hoodi';
const ctor = process.env.VARA_ETH_E2E_CTOR;
const ctorArgs = process.env.VARA_ETH_E2E_CTOR_ARGS ?? '[]';
const queryMethod = process.env.VARA_ETH_E2E_QUERY;
const queryArgs = process.env.VARA_ETH_E2E_QUERY_ARGS ?? '[]';
const writeMethod = process.env.VARA_ETH_E2E_WRITE;
const writeArgs = process.env.VARA_ETH_E2E_WRITE_ARGS ?? '[]';
const salt = process.env.VARA_ETH_E2E_SALT;
const executableBalance = process.env.VARA_ETH_E2E_EXECUTABLE_BALANCE;

for (const file of [wasm, idl]) {
  if (!existsSync(file)) {
    console.error(JSON.stringify({ error: 'E2E artifact not found', file }));
    process.exit(2);
  }
}

function run(args, options = {}) {
  const result = spawnSync(cli[0], [...cli.slice(1), '--json', '--chain', 'vara-eth', '--network', network, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    console.error(result.stderr.trim() || result.stdout.trim());
    process.exit(result.status ?? 1);
  }
  if (options.raw) return result.stdout.trim();
  try {
    return JSON.parse(result.stdout);
  } catch {
    console.error(JSON.stringify({ error: 'Command did not return JSON', args, stdout: result.stdout }));
    process.exit(1);
  }
}

run(['--account', account, 'balance']);

const uploadArgs = codeId
  ? ['--account', account, 'program', 'deploy', codeId, '--idl', idl, '--args', ctorArgs]
  : ['--account', account, 'program', 'upload', wasm, '--idl', idl, '--args', ctorArgs];
if (ctor) uploadArgs.push('--init', ctor);
if (salt) uploadArgs.push('--salt', salt);
if (executableBalance) uploadArgs.push('--executable-balance', executableBalance);
const uploaded = run(uploadArgs);
const programAddress = uploaded.programAddress;
if (!programAddress) {
  console.error(JSON.stringify({ error: 'Upload did not return programAddress', uploaded }));
  process.exit(1);
}

const discovered = run(['discover', programAddress, '--idl', idl]);
const before = run(['call', programAddress, queryMethod, '--idl', idl, '--args', queryArgs]);
const written = run(['--account', account, 'call', programAddress, writeMethod, '--idl', idl, '--args', writeArgs]);
const after = run(['call', programAddress, queryMethod, '--idl', idl, '--args', queryArgs]);

console.log(JSON.stringify({
  ok: true,
  network,
  account,
  programAddress,
  codeId: uploaded.codeId,
  discoveredServices: Object.keys(discovered.services ?? {}),
  before: before.result,
  writeTxHash: written.txHash,
  writeMessageId: written.messageId,
  after: after.result,
}, null, 2));
