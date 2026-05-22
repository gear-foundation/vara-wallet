/**
 * Verifies that global `--account` and `--passphrase` flags propagate into
 * `vara-eth:*` subcommand action handlers via `cmd.optsWithGlobals()`.
 *
 * Regression for follow-up #6 in docs/vara-eth-followups.md: the old code
 * read only the subcommand-local opts bag, so globals fell through and the
 * resolver hit `config.defaultAccount`.
 */

import { Command } from 'commander';

describe('vara-eth global option propagation', () => {
  function buildHarness(captured: { account?: string; passphrase?: string; localOnly?: string }) {
    const root = new Command();
    root.exitOverride();
    root
      .option('--account <name>', 'wallet name')
      .option('--passphrase <pass>', 'wallet passphrase');

    const wvara = root.command('vara-eth:wvara');
    wvara
      .command('approve <spender> <amount>')
      .option('--account <name>', 'wallet name')
      .option('--passphrase <pass>', 'wallet passphrase')
      .option('--local-only <v>', 'local-only opt')
      .action((_spender: string, _amount: string, _options: unknown, cmd: Command) => {
        const merged = cmd.optsWithGlobals() as typeof captured;
        captured.account = merged.account;
        captured.passphrase = merged.passphrase;
        captured.localOnly = merged.localOnly;
      });
    return root;
  }

  it('reads --account from the root command into the leaf action', async () => {
    const captured: { account?: string; passphrase?: string; localOnly?: string } = {};
    const root = buildHarness(captured);
    await root.parseAsync([
      'node',
      'wallet',
      '--account',
      'hoodi-smoke',
      'vara-eth:wvara',
      'approve',
      '0xspender',
      '0',
    ]);
    expect(captured.account).toBe('hoodi-smoke');
  });

  it('reads --passphrase from the root command into the leaf action', async () => {
    const captured: { account?: string; passphrase?: string; localOnly?: string } = {};
    const root = buildHarness(captured);
    await root.parseAsync([
      'node',
      'wallet',
      '--passphrase',
      'secret',
      'vara-eth:wvara',
      'approve',
      '0xspender',
      '0',
    ]);
    expect(captured.passphrase).toBe('secret');
  });

  it('local subcommand --account wins over root --account', async () => {
    const captured: { account?: string; passphrase?: string; localOnly?: string } = {};
    const root = buildHarness(captured);
    await root.parseAsync([
      'node',
      'wallet',
      '--account',
      'global',
      'vara-eth:wvara',
      'approve',
      '0xspender',
      '0',
      '--account',
      'local',
    ]);
    expect(captured.account).toBe('local');
  });

  it('local-only options on the subcommand still resolve via optsWithGlobals', async () => {
    const captured: { account?: string; passphrase?: string; localOnly?: string } = {};
    const root = buildHarness(captured);
    await root.parseAsync([
      'node',
      'wallet',
      'vara-eth:wvara',
      'approve',
      '0xspender',
      '0',
      '--local-only',
      'x',
    ]);
    expect(captured.localOnly).toBe('x');
  });
});
