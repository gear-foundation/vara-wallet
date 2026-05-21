#!/usr/bin/env node

import { Command } from 'commander';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { setOutputOptions, installGlobalErrorHandler, outputError, CliError, enableTiming, markStage, markTotal, fastExit } from './utils';
import { disconnectApi } from './services/api';
import { disconnectEthexeApi } from './services/vara-eth/api';
import { registerVaraEthWalletCommand } from './commands/vara-eth-wallet';
import { registerVaraEthMessageCommand } from './commands/vara-eth-message';
import { registerVaraEthStateCommand } from './commands/vara-eth-state';
import { registerVaraEthProgramCommand } from './commands/vara-eth-program';
import { registerVaraEthMailboxCommand } from './commands/vara-eth-mailbox';
import { registerVaraEthSubscribeCommand } from './commands/vara-eth-subscribe';
import { registerVaraEthWvaraCommand } from './commands/vara-eth-wvara';
import { registerVaraEthInheritorCommand } from './commands/vara-eth-inheritor';
import { registerVaraEthValidatorsCommand } from './commands/vara-eth-validators';
import { resolveVaraEthNetwork } from './chains/vara-eth/networks';
import { resolveActionChain } from './utils/active-chain';
import { readConfig } from './services/config';
import { registerInitCommand } from './commands/init';
import { registerWalletCommand } from './commands/wallet';
import { registerBalanceCommand } from './commands/balance';
import { registerNodeCommand } from './commands/node';
import { registerMessageCommand } from './commands/message';
import { registerMailboxCommand } from './commands/mailbox';
import { registerProgramCommand } from './commands/program';
import { registerCodeCommand } from './commands/code';
import { registerStateCommand } from './commands/state';
import { registerWaitCommand } from './commands/wait';
import { registerWatchCommand } from './commands/watch';
import { registerDiscoverCommand } from './commands/discover';
import { registerCallCommand } from './commands/call';
import { registerIdlCommand } from './commands/idl';
import { registerMetadataCommand } from './commands/metadata';
import { registerTokenCommand } from './commands/token';
import { registerVftCommand } from './commands/vft';
import { registerVoucherCommand } from './commands/voucher';
import { registerEncodeCommand } from './commands/encode';
import { registerSignCommand } from './commands/sign';
import { registerTxCommand } from './commands/tx';
import { registerSubscribeCommand } from './commands/subscribe';
import { registerInboxCommand } from './commands/inbox';
import { registerEventsCommand } from './commands/events';
import { registerDexCommand } from './commands/dex';
import { registerFaucetCommand } from './commands/faucet';
import { registerConfigCommand, NETWORK_MAP } from './commands/config-cmd';

installGlobalErrorHandler();

const VERSION = process.env.VARA_WALLET_VERSION ?? '0.0.0-dev';

const program = new Command();

program
  .name('vara-wallet')
  .description('Agentic wallet CLI for Vara Network — designed for AI coding agents')
  .version(VERSION)
  .option('--ws <endpoint>', 'WebSocket endpoint (default: wss://rpc.vara.network)')
  .option('--light', 'use embedded light client (smoldot) instead of WebSocket')
  .option('--seed <seed>', 'account seed (SURI like //Alice or hex)')
  .option('--mnemonic <mnemonic>', 'account mnemonic phrase')
  .option('--account <name>', 'wallet name to use')
  .option('--passphrase <pass>', 'wallet passphrase (Vara.eth keystores; substrate side reads VARA_PASSPHRASE / .passphrase instead)')
  .option('--json', 'force JSON output')
  .option('--human', 'force human-readable output')
  .option('--quiet', 'suppress all output except errors')
  .option('--verbose', 'show verbose debug info on stderr')
  .option('--network <name>', 'network shorthand: mainnet, testnet, or local')
  .option('--chain <name>', 'target chain: vara (default, substrate) or vara-eth (Vara.eth co-processor on Ethereum)')
  .option('--timing', 'emit per-stage timing NDJSON to stderr (no-op without flag)')
  .hook('preAction', (_thisCommand, actionCommand) => {
    const opts = program.opts();
    setOutputOptions({
      json: opts.json,
      human: opts.human,
      quiet: opts.quiet,
      verbose: opts.verbose,
    });
    if (opts.timing) {
      enableTiming();
    }
    if (opts.light) {
      process.env.VARA_LIGHT = '1';
    }
    const config = readConfig();
    const chain = resolveActionChain(actionCommand, opts.chain, config.defaultChain);
    if (opts.network) {
      if (chain === 'vara-eth') {
        // Vara.eth path — resolve against the Vara.eth network registry.
        if (opts.varaEthRpc) {
          throw new CliError('Cannot use both --network and --vara-eth-rpc', 'CONFLICTING_OPTIONS');
        }
        if (opts.ethereumRpc) {
          throw new CliError('Cannot use both --network and --ethereum-rpc', 'CONFLICTING_OPTIONS');
        }
        // resolveVaraEthNetwork throws NetworkNotDeployedError or CliError on bad input.
        const preset = resolveVaraEthNetwork(opts.network);
        // Stash the preset in env vars for resolveEthexeConfig to pick up (lowest precedence).
        process.env.VARA_ETH_NETWORK_PRESET_VARA_ETH_RPC = preset.varaEthRpc;
        process.env.VARA_ETH_NETWORK_PRESET_ETHEREUM_RPC = preset.ethereumRpc;
        if (preset.routerAddress) {
          process.env.VARA_ETH_NETWORK_PRESET_ROUTER = preset.routerAddress;
        } else {
          delete process.env.VARA_ETH_NETWORK_PRESET_ROUTER;
        }
      } else {
        // Substrate / Vara path — existing behaviour.
        if (opts.ws) {
          throw new CliError('Cannot use both --network and --ws', 'CONFLICTING_OPTIONS');
        }
        const url = NETWORK_MAP[opts.network];
        if (!url) {
          throw new CliError(
            `Unknown network "${opts.network}". Valid: ${Object.keys(NETWORK_MAP).join(', ')}`,
            'INVALID_NETWORK',
          );
        }
        process.env.VARA_WS = url;
      }
    }
  });

// Substrate / Vara commands
registerInitCommand(program);
registerWalletCommand(program);
registerBalanceCommand(program);
registerNodeCommand(program);
registerFaucetCommand(program);
registerConfigCommand(program);
registerMessageCommand(program);
registerMailboxCommand(program);
registerProgramCommand(program);
registerCodeCommand(program);
registerStateCommand(program);
registerWaitCommand(program);
registerWatchCommand(program);
registerDiscoverCommand(program);
registerCallCommand(program);
registerIdlCommand(program);
registerMetadataCommand(program);
registerTokenCommand(program);
registerVftCommand(program);
registerVoucherCommand(program);
registerEncodeCommand(program);
registerSignCommand(program);
registerTxCommand(program);
registerSubscribeCommand(program);
registerInboxCommand(program);
registerEventsCommand(program);
registerDexCommand(program);

// Vara.eth co-processor commands — prefixed `vara-eth:`.
registerVaraEthWalletCommand(program);
registerVaraEthMessageCommand(program);
registerVaraEthStateCommand(program);
registerVaraEthProgramCommand(program);
registerVaraEthMailboxCommand(program);
registerVaraEthSubscribeCommand(program);
registerVaraEthWvaraCommand(program);
registerVaraEthInheritorCommand(program);
registerVaraEthValidatorsCommand(program);

// Subscribe commands register their own signal handler with `prependOnceListener`
// so it runs before this catch-all and tears down the subscription cleanly.
process.on('SIGINT', () => {
  disconnectApi();
  disconnectEthexeApi();
  fastExit(0);
});
process.on('SIGTERM', () => {
  disconnectApi();
  disconnectEthexeApi();
  fastExit(0);
});

async function main(): Promise<void> {
  try {
    await cryptoWaitReady();
    await program.parseAsync(process.argv);
  } catch (error) {
    outputError(error);
    process.exitCode = 1;
  } finally {
    disconnectApi();
    disconnectEthexeApi();
    markStage('shutdown');
    markTotal();
    fastExit(typeof process.exitCode === 'number' ? process.exitCode : 0);
  }
}

main();
