import { Command } from 'commander';

import { getEthexeApi, getMirrorClient } from '../services/ethexe/api';
import { resolveEthexeSigner } from '../services/ethexe/account';
import { asAddress, asHex, parseOptionalBigInt } from '../utils/eth-types';
import { output } from '../utils/output';

interface SendOptions {
  payload: string;
  value?: string;
  via?: 'eth' | 'injected';
  account?: string;
  passphrase?: string;
  timeoutMs?: string;
}

type ReplyOptions = SendOptions;

export function registerEthexeMessageCommand(program: Command): void {
  const message = program.command('ethexe:message').description('Send messages and replies on the ethexe rail');

  message
    .command('send <mirror>')
    .description('Send a message to a Mirror program (default: injected via validator)')
    .requiredOption('--payload <hex>', '0x-prefixed payload bytes')
    .option('--value <wei>', 'value in wei to attach (default: 0)')
    .option('--via <path>', 'injected (default) or eth (direct Mirror.sendMessage)', 'injected')
    .option('--account <name>', 'ethexe wallet name')
    .option('--passphrase <pass>', 'wallet passphrase')
    .option('--timeout-ms <ms>', 'timeout for injected promise wait (default: server-controlled)')
    .action(async (mirrorArg: string, options: SendOptions) => {
      const mirror = asAddress(mirrorArg, 'mirror');
      const payload = asHex(options.payload, '--payload');
      const value = parseOptionalBigInt(options.value, '--value');
      const via: 'eth' | 'injected' = options.via === 'eth' ? 'eth' : 'injected';

      const api = await getEthexeApi();
      const signer = await resolveEthexeSigner(api.eth.publicClient, {
        account: options.account,
        passphrase: options.passphrase,
      });
      api.eth.setSigner(signer);

      const timeoutMs = options.timeoutMs ? Number(options.timeoutMs) : undefined;
      const result = await api.programs.sendAndWait(mirror, payload, { value, via, timeoutMs });

      output({
        mirror,
        via,
        messageId: result.messageId,
        txHash: result.txHash,
        validator: result.validator ?? null,
        reply: result.reply
          ? {
              payload: result.reply.payload,
              value: result.reply.value.toString(),
              code: result.reply.code.toString(),
            }
          : null,
      });
    });

  message
    .command('reply <mirror> <messageId>')
    .description('Reply to a previously received message')
    .requiredOption('--payload <hex>', '0x-prefixed reply payload')
    .option('--value <wei>', 'value to attach')
    .option('--account <name>', 'ethexe wallet name')
    .option('--passphrase <pass>', 'wallet passphrase')
    .action(async (mirrorArg: string, msgIdArg: string, options: ReplyOptions) => {
      const mirror = asAddress(mirrorArg, 'mirror');
      const messageId = asHex(msgIdArg, 'messageId');
      const payload = asHex(options.payload, '--payload');
      const value = parseOptionalBigInt(options.value, '--value');

      const api = await getEthexeApi();
      const signer = await resolveEthexeSigner(api.eth.publicClient, {
        account: options.account,
        passphrase: options.passphrase,
      });
      api.eth.setSigner(signer);

      const mirrorClient = await getMirrorClient(mirror, signer);
      const tx = await mirrorClient.sendReply(messageId, payload, value);
      const receipt = await tx.getReceipt();

      output({
        mirror,
        repliedTo: messageId,
        txHash: receipt.transactionHash,
        blockNumber: Number(receipt.blockNumber),
        status: receipt.status,
      });
    });
}
