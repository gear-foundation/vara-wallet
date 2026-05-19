import { Command } from 'commander';
import { keccak256 } from 'viem';

import { getEthexeApi, getMirrorClient } from '../services/vara-eth/api';
import { resolveEthexeSigner } from '../services/vara-eth/account';
import {
  getById,
  initPromiseStore,
  insertPending,
  markFailed,
  markResolved,
} from '../services/vara-eth/promises';
import { serializeReplyCode } from '../shared/output-eth/reply-code';
import { CliError } from '../utils/errors';
import { asAddress, asHex, parseOptionalBigInt } from '../utils/eth-types';
import { output } from '../utils/output';

interface SendOptions {
  payload?: string;
  value?: string;
  via?: 'eth' | 'injected';
  account?: string;
  passphrase?: string;
  timeoutMs?: string;
  /** Skip the send; look up a previously-recorded promise outcome by txHash. */
  resume?: string;
}

type ReplyOptions = Omit<SendOptions, 'resume'>;

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
      '--resume <txHash>',
      'look up a previously-submitted injected-tx outcome by txHash (no new submit). Only finds terminal-state cached promises; reattaching to in-flight pending promises requires lib-level support not yet shipped.',
    )
    .action(async (mirrorArg: string, _options: SendOptions, cmd: Command) => {
      const opts = cmd.optsWithGlobals() as SendOptions;
      const mirror = asAddress(mirrorArg, 'mirror');

      if (opts.resume) {
        return handleResume(opts.resume);
      }

      if (!opts.payload) {
        throw new CliError('--payload is required unless --resume is set', 'MISSING_REQUIRED_OPTION', {
          option: '--payload',
        });
      }
      const payload = asHex(opts.payload, '--payload');
      const value = parseOptionalBigInt(opts.value, '--value');
      const via: 'eth' | 'injected' = opts.via === 'eth' ? 'eth' : 'injected';

      const api = await getEthexeApi();
      const signer = await resolveEthexeSigner(api.eth.publicClient, {
        account: opts.account,
        passphrase: opts.passphrase,
      });
      api.eth.setSigner(signer);

      const timeoutMs = opts.timeoutMs ? Number(opts.timeoutMs) : undefined;
      const persist = via === 'injected';
      if (persist) initPromiseStore();
      const signerAddress = persist ? await signer.getAddress() : '0x';

      let result;
      try {
        result = await api.programs.sendAndWait(mirror, payload, { value, via, timeoutMs });
      } catch (err) {
        // Best-effort: typed errors that carry a txHash get a `failed` row so
        // the user can `--resume` to inspect it later. Errors without a
        // txHash (sign-time / submit-time) bypass persistence entirely.
        if (persist) {
          const txHash = extractTxHash(err);
          if (txHash !== null) {
            try {
              insertPending(buildPendingRow({ txHash, mirror, payload, value, signerAddress }));
              markFailed(txHash, err instanceof Error ? err.message : String(err));
            } catch {
              // Persistence is non-load-bearing; never block the real error.
            }
          }
        }
        throw err;
      }

      if (persist) {
        try {
          insertPending(
            buildPendingRow({
              txHash: result.txHash,
              mirror,
              payload,
              value,
              signerAddress,
              recipientValidator: result.validator ?? null,
            }),
          );
          markResolved(
            result.txHash,
            result.reply?.payload ?? '',
            result.reply ? serializeReplyCode(result.reply.code).raw : '',
            null, // validator signature isn't surfaced by sendAndWait; pull from a lower-level call when needed
          );
        } catch {
          // Persistence shouldn't fail the command — the send succeeded.
        }
      }

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
              code: serializeReplyCode(result.reply.code),
            }
          : null,
      });
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
      const mirror = asAddress(mirrorArg, 'mirror');
      const messageId = asHex(msgIdArg, 'messageId');
      const payload = asHex(opts.payload!, '--payload');
      const value = parseOptionalBigInt(opts.value, '--value');

      const api = await getEthexeApi();
      const signer = await resolveEthexeSigner(api.eth.publicClient, {
        account: opts.account,
        passphrase: opts.passphrase,
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

/** Reads a cached promise row by txHash and prints its outcome. */
function handleResume(txHashRaw: string): void {
  const txHash = asHex(txHashRaw, '--resume');
  initPromiseStore();
  const row = getById(txHash);
  if (!row) {
    throw new CliError(
      `No cached promise found for ${txHash}. Resume only works for previously-submitted injected-tx outcomes.`,
      'RESUME_NOT_FOUND',
      { txHash },
    );
  }
  if (row.status === 'pending') {
    throw new CliError(
      `Promise ${txHash} is still pending. Re-attaching to in-flight promises requires lib-level support not yet shipped; the wallet records pending rows but cannot subscribe to them post-restart.`,
      'RESUME_PENDING_NOT_SUPPORTED',
      { txHash, status: row.status },
    );
  }
  output({
    txHash,
    status: row.status,
    destination: row.destination,
    submittedAtBlock: row.submitted_at_block,
    submittedAtTs: row.submitted_at_ts,
    expiresAtBlock: row.expires_at_block,
    replyPayload: row.reply_payload,
    replyCode: row.reply_code,
    validatorSignature: row.validator_signature,
    retries: row.retries,
    lastError: row.last_error,
  });
}

/**
 * Best-effort txHash extraction from typed errors thrown by `@vara-eth/api`.
 * `PromiseTimeoutError`, `PromiseSignatureInvalidError`, and similar carry a
 * `txHash` field on the error instance. Untyped errors return `null`.
 */
function extractTxHash(err: unknown): `0x${string}` | null {
  if (err === null || typeof err !== 'object') return null;
  const candidate = (err as { txHash?: unknown }).txHash;
  return typeof candidate === 'string' && candidate.startsWith('0x') ? (candidate as `0x${string}`) : null;
}

function buildPendingRow(params: {
  txHash: string;
  mirror: string;
  payload: `0x${string}`;
  value: bigint | undefined;
  signerAddress: string;
  recipientValidator?: string | null;
}) {
  return {
    txHash: params.txHash,
    referenceBlock: '0x', // not exposed by the one-shot helper; placeholder
    recipientValidator: params.recipientValidator ?? null,
    signerAddress: params.signerAddress,
    destination: params.mirror,
    payloadHash: keccak256(params.payload),
    salt: '0x', // injected path uses random salt internally; not exposed
    valueWei: params.value ?? 0n,
    submittedAtBlock: 0, // would need an extra getBlockNumber call; left 0
    validatorUrl: null,
  };
}
