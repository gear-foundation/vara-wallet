import { Command } from 'commander';

import {
  outputVaraEthMessageReply,
  outputVaraEthMessageSend,
  type VaraEthReplyOptions,
  type VaraEthSendOptions,
} from './vara-eth-actions';

type SendOptions = VaraEthSendOptions;
type ReplyOptions = VaraEthReplyOptions;

export function registerVaraEthMessageCommand(program: Command): void {
  const message = program.command('vara-eth:message').description('Send messages and replies on the Vara.eth rail');

  message
    .command('send <mirror>')
    .description('Send a message to a Mirror program (default: injected via validator)')
    .option('--payload <hex>', '0x-prefixed payload bytes (required unless --resume is set)')
    .option('--value <wei>', 'value in wei to attach (default: 0)')
    .option('--via <path>', 'injected (default) or eth (direct Mirror.sendMessage)', 'injected')
    .option('--account <name>', 'Vara.eth wallet name')
    .option('--passphrase <pass>', 'wallet passphrase')
    .option('--timeout-ms <ms>', 'timeout for injected promise wait (default: server-controlled)')
    .option(
      '--no-validate-signature',
      'skip validator-signature check on injected-path replies (diagnostics only; accepts any validator claim)',
    )
    .option(
      '--resume <txHash>',
      'look up a previously-submitted injected-tx outcome by txHash (no new submit). Only finds terminal-state cached promises; reattaching to in-flight pending promises requires lib-level support not yet shipped.',
    )
    .action(async (mirrorArg: string, _options: SendOptions, cmd: Command) => {
      const opts = cmd.optsWithGlobals() as SendOptions;
      await outputVaraEthMessageSend(mirrorArg, opts);
    });

  message
    .command('reply <mirror> <messageId>')
    .description('Reply to a previously received message')
    .requiredOption('--payload <hex>', '0x-prefixed reply payload')
    .option('--value <wei>', 'value to attach')
    .option('--account <name>', 'Vara.eth wallet name')
    .option('--passphrase <pass>', 'wallet passphrase')
    .action(async (mirrorArg: string, msgIdArg: string, _options: ReplyOptions, cmd: Command) => {
      const opts = cmd.optsWithGlobals() as ReplyOptions;
      await outputVaraEthMessageReply(mirrorArg, msgIdArg, opts);
    });
}
