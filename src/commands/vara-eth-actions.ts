import type { Address, Hex } from 'viem';
import { keccak256 } from 'viem';

import { getEthexeApi, getMirrorClient } from '../services/vara-eth/api';
import { resolveEthexeAccountAddress, resolveEthexeSigner, type EthexeAccountOptions } from '../services/vara-eth/account';
import { getById, initPromiseStore, insertPending, markFailed, markResolved } from '../services/vara-eth/promises';
import { insertEvent, initEventStore } from '../services/event-store';
import { readConfig } from '../services/config';
import { serializeReplyCode } from '../shared/output-eth/reply-code';
import { asAddress, asHex, parseOptionalBigInt } from '../utils/eth-types';
import { CliError, minimalToVara, output, outputNdjson, toMinimalUnits, validateUnits, verbose } from '../utils';

export interface VaraEthSendOptions extends EthexeAccountOptions {
  payload?: string;
  value?: string;
  via?: 'eth' | 'injected';
  timeoutMs?: string;
  validateSignature?: boolean;
  resume?: string;
}

export interface VaraEthReplyOptions extends EthexeAccountOptions {
  payload?: string;
  value?: string;
  mirror?: string;
}

export interface VaraEthStateReadOptions {
  full?: boolean;
  queue?: boolean;
  mailbox?: boolean;
}

export async function outputVaraEthBalance(addressArg: string | undefined, opts: EthexeAccountOptions = {}): Promise<void> {
  const address = addressArg ? asAddress(addressArg, 'address') : resolveEthexeAccountAddress(opts);
  const api = await getEthexeApi();

  const [ethBalance, wvaraBalance, decimals, symbol] = await Promise.allSettled([
    api.eth.publicClient.getBalance({ address }),
    api.eth.wvara.balanceOf(address),
    api.eth.wvara.decimals(),
    api.eth.wvara.symbol(),
  ]);

  const wvaraDecimals = decimals.status === 'fulfilled' ? decimals.value : 18;
  const wvaraRaw = wvaraBalance.status === 'fulfilled' ? wvaraBalance.value : null;
  const ethRaw = ethBalance.status === 'fulfilled' ? ethBalance.value : null;

  output({
    chain: 'vara-eth',
    display: 'Vara.eth',
    address,
    eth: {
      ok: ethBalance.status === 'fulfilled',
      balance: ethRaw === null ? null : minimalToVara(ethRaw, 18),
      balanceRaw: ethRaw === null ? null : ethRaw.toString(),
      error: ethBalance.status === 'rejected' ? formatUnknownError(ethBalance.reason) : null,
    },
    wvara: {
      ok: wvaraBalance.status === 'fulfilled',
      token: symbol.status === 'fulfilled' ? symbol.value : 'WVARA',
      tokenAddress: api.eth.wvara.address,
      decimals: wvaraDecimals,
      balance: wvaraRaw === null ? null : minimalToVara(wvaraRaw, wvaraDecimals),
      balanceRaw: wvaraRaw === null ? null : wvaraRaw.toString(),
      ready: wvaraRaw !== null && wvaraRaw > 0n,
      error: wvaraBalance.status === 'rejected' ? formatUnknownError(wvaraBalance.reason) : null,
    },
  });
}

export async function outputVaraEthWvaraTransfer(
  toArg: string,
  amountArg: string,
  options: EthexeAccountOptions & { units?: string } = {},
): Promise<void> {
  const to = asAddress(toArg, 'to');
  const api = await getEthexeApi();
  const { amount, decimals, units } = await resolveVaraEthTokenAmount(api, amountArg, options.units);
  if (amount <= 0n) throw new CliError('Amount must be positive', 'INVALID_AMOUNT');

  const signer = await resolveEthexeSigner(api.eth.publicClient, options);
  api.eth.setSigner(signer);

  const from = await signer.getAddress();
  const txManager = await api.eth.wvara.transfer(to, amount);
  const receipt = await txManager.sendAndWaitForReceipt();

  output({
    chain: 'vara-eth',
    display: 'Vara.eth',
    txHash: receipt.transactionHash,
    blockNumber: Number(receipt.blockNumber),
    status: receipt.status,
    from,
    to,
    amount: minimalToVara(amount, decimals),
    amountRaw: amount.toString(),
    units,
  });
}

export async function outputVaraEthMessageSend(mirrorArg: string, opts: VaraEthSendOptions): Promise<void> {
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
  const signer = await resolveEthexeSigner(api.eth.publicClient, opts);
  api.eth.setSigner(signer);

  const timeoutMs = opts.timeoutMs ? Number(opts.timeoutMs) : undefined;
  const validateSignature = opts.validateSignature !== false;
  const persist = via === 'injected';
  if (persist) initPromiseStore();
  const signerAddress = persist ? await signer.getAddress() : '0x';

  let result;
  try {
    result = await api.programs.sendAndWait(mirror, payload, { value, via, timeoutMs, validateSignature });
  } catch (err) {
    if (persist) {
      const txHash = extractTxHash(err);
      if (txHash !== null) {
        try {
          insertPending(buildPendingRow({ txHash, mirror, payload, value, signerAddress }));
          markFailed(txHash, err instanceof Error ? err.message : String(err));
        } catch {
          // Persistence is non-load-bearing.
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
        null,
      );
    } catch {
      // Persistence should not fail a successful send.
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
}

export async function outputVaraEthMessageReply(
  mirrorArg: string,
  msgIdArg: string,
  opts: VaraEthReplyOptions,
): Promise<void> {
  const mirror = asAddress(mirrorArg, 'mirror');
  const messageId = asHex(msgIdArg, 'messageId');
  const payload = asHex(opts.payload!, '--payload');
  const value = parseOptionalBigInt(opts.value, '--value');

  const api = await getEthexeApi();
  const signer = await resolveEthexeSigner(api.eth.publicClient, opts);
  api.eth.setSigner(signer);

  const mirrorClient = await getMirrorClient(mirror, signer);
  const tx = await mirrorClient.sendReply(messageId, payload, value);
  const receipt = await tx.sendAndWaitForReceipt();

  output({
    mirror,
    repliedTo: messageId,
    txHash: receipt.transactionHash,
    blockNumber: Number(receipt.blockNumber),
    status: receipt.status,
  });
}

export async function outputVaraEthStateRead(mirrorArg: string, options: VaraEthStateReadOptions = {}): Promise<void> {
  const mirror = asAddress(mirrorArg, 'mirror');
  const api = await getEthexeApi();
  const mirrorClient = await getMirrorClient(mirror);
  const stateHash = (await mirrorClient.stateHash()) as Hex;

  if (options.full) {
    const fullState = await api.query.program.readFullState(stateHash);
    output({ mirror, stateHash, fullState });
    return;
  }
  if (options.queue) {
    const queue = await api.query.program.readQueue(stateHash);
    output({ mirror, stateHash, queue });
    return;
  }
  if (options.mailbox) {
    const mailbox = await api.query.program.readMailbox(stateHash);
    output({ mirror, stateHash, mailbox });
    return;
  }

  const programState = await api.query.program.readState(stateHash);
  output({ mirror, stateHash, programState });
}

export async function outputVaraEthProgramInfo(mirrorArg: string): Promise<void> {
  const mirror = asAddress(mirrorArg, 'programId');
  const api = await getEthexeApi();
  const mirrorClient = await getMirrorClient(mirror);
  const [stateHash, codeId, exited, nonce, router, inheritor, initializer] = await Promise.allSettled([
    mirrorClient.stateHash(),
    api.query.program.codeId(mirror),
    mirrorClient.exited(),
    mirrorClient.nonce(),
    mirrorClient.router(),
    mirrorClient.inheritor(),
    mirrorClient.initializer(),
  ]);

  output({
    chain: 'vara-eth',
    display: 'Vara.eth',
    programId: mirror,
    exists: stateHash.status === 'fulfilled' || codeId.status === 'fulfilled',
    stateHash: stateHash.status === 'fulfilled' ? stateHash.value : null,
    codeId: codeId.status === 'fulfilled' ? codeId.value : null,
    exited: exited.status === 'fulfilled' ? exited.value : null,
    nonce: nonce.status === 'fulfilled' ? nonce.value.toString() : null,
    router: router.status === 'fulfilled' ? router.value : null,
    inheritor: inheritor.status === 'fulfilled' ? inheritor.value : null,
    initializer: initializer.status === 'fulfilled' ? initializer.value : null,
  });
}

export async function outputVaraEthProgramList(options: { count?: string; all?: boolean } = {}): Promise<void> {
  const api = await getEthexeApi();
  const ids = await api.query.program.getIds();
  const count = options.all ? undefined : (options.count ? parseInt(options.count, 10) : 100);
  output({
    chain: 'vara-eth',
    display: 'Vara.eth',
    programs: count === undefined ? ids : ids.slice(0, count),
    total: ids.length,
  });
}

export async function outputVaraEthProgramTopUp(
  mirrorArg: string,
  opts: EthexeAccountOptions & { amount: string; units?: string },
): Promise<void> {
  const mirror = asAddress(mirrorArg, 'mirror');
  const api = await getEthexeApi();
  const { amount, decimals, units } = await resolveVaraEthTokenAmount(api, opts.amount, opts.units);
  if (amount <= 0n) throw new CliError('Amount must be positive', 'INVALID_AMOUNT');

  const signer = await resolveEthexeSigner(api.eth.publicClient, opts);
  api.eth.setSigner(signer);

  const mirrorClient = await getMirrorClient(mirror, signer);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const permitData = await api.eth.wvara.prepareAndSignPermitData(mirror, amount, deadline);
  const tx = await mirrorClient.executableBalanceTopUpWithPermit(amount, deadline, permitData.signature);
  const receipt = await tx.sendAndWaitForReceipt();

  output({
    mirror,
    amount: minimalToVara(amount, decimals),
    amountRaw: amount.toString(),
    units,
    approval: 'permit',
    deadline: deadline.toString(),
    txHash: receipt.transactionHash,
    blockNumber: Number(receipt.blockNumber),
    status: receipt.status,
  });
}

export async function subscribeVaraEthProgram(
  mirrorArg: string,
  options: { fromBlock?: string; persist?: boolean; count?: string; onLimit?: () => void },
  onDone: (unsubscribe: () => void) => Promise<void>,
): Promise<void> {
  const mirror = asAddress(mirrorArg, 'mirror');
  const fromBlock = parseOptionalBigInt(options.fromBlock, '--from-block');
  const persist = options.persist !== false;
  if (persist) initEventStore();

  const api = await getEthexeApi();
  verbose(`subscribing to program events ${mirror}`);
  let seen = 0;
  const unsubscribe = api.stream.programEvents(
    mirror,
    {
      onEvent: (event) => {
        const data = { kind: 'program', chain: 'vara-eth', ...event };
        outputNdjson(data);
        if (persist) persistVaraEthEvent('program', data, { programId: mirror });
        if (options.count && ++seen >= Number(options.count)) {
          unsubscribe();
          options.onLimit?.();
        }
      },
      onError: (err) => outputNdjson({ kind: 'error', chain: 'vara-eth', error: err.message }),
    },
    { fromBlock },
  );
  await onDone(unsubscribe);
}

export async function subscribeVaraEthRouter(
  options: { fromBlock?: string; persist?: boolean; count?: string; onLimit?: () => void },
  onDone: (unsubscribe: () => void) => Promise<void>,
): Promise<void> {
  const fromBlock = parseOptionalBigInt(options.fromBlock, '--from-block');
  const persist = options.persist !== false;
  if (persist) initEventStore();

  const api = await getEthexeApi();
  verbose('subscribing to router events');
  let seen = 0;
  const unsubscribe = api.stream.routerEvents(
    {
      onEvent: (event) => {
        const data = { kind: 'router', chain: 'vara-eth', ...event };
        outputNdjson(data);
        if (persist) persistVaraEthEvent('router', data);
        if (options.count && ++seen >= Number(options.count)) {
          unsubscribe();
          options.onLimit?.();
        }
      },
      onError: (err) => outputNdjson({ kind: 'error', chain: 'vara-eth', error: err.message }),
    },
    { fromBlock },
  );
  await onDone(unsubscribe);
}

export async function subscribeVaraEthBlocks(
  options: { includePending?: boolean; persist?: boolean; count?: string; onLimit?: () => void },
  onDone: (unsubscribe: () => void) => Promise<void>,
): Promise<void> {
  const persist = options.persist !== false;
  if (persist) initEventStore();

  const api = await getEthexeApi();
  verbose('subscribing to blocks');
  let seen = 0;
  const unsubscribe = api.stream.blocks(
    {
      onEvent: (header) => {
        const data = { kind: 'block', chain: 'vara-eth', ...header };
        outputNdjson(data);
        if (persist) persistVaraEthEvent('block', data);
        if (options.count && ++seen >= Number(options.count)) {
          unsubscribe();
          options.onLimit?.();
        }
      },
      onError: (err) => outputNdjson({ kind: 'error', chain: 'vara-eth', error: err.message }),
    },
    { includePending: options.includePending },
  );
  await onDone(unsubscribe);
}

function parseVaraEthTokenAmount(amount: string, units: string | undefined, decimals: number): bigint {
  const resolvedUnits = units ?? 'human';
  validateUnits(resolvedUnits);
  return resolvedUnits === 'raw' ? BigInt(amount) : toMinimalUnits(amount, decimals);
}

async function resolveVaraEthTokenAmount(
  api: Awaited<ReturnType<typeof getEthexeApi>>,
  amountArg: string,
  units: string | undefined,
): Promise<{ amount: bigint; decimals: number; units: 'human' | 'raw' }> {
  const resolvedUnits = validateUnits(units) ?? 'human';
  const decimals = await api.eth.wvara.decimals();
  return {
    amount: parseVaraEthTokenAmount(amountArg, resolvedUnits, decimals),
    decimals,
    units: resolvedUnits,
  };
}

function persistVaraEthEvent(type: string, data: Record<string, unknown>, options: { programId?: Address } = {}): void {
  const network = readConfig().varaEthNetwork ?? null;
  const blockNumber = extractNumber(data.blockNumber ?? data.number);
  const blockHash = extractString(data.blockHash ?? data.hash);
  const eventId = extractString(data.eventId ?? data.id ?? data.transactionHash ?? data.hash);
  insertEvent({
    chain: 'vara-eth',
    network: network ?? undefined,
    type,
    event_id: eventId ?? undefined,
    data,
    block_number: blockNumber ?? undefined,
    block_hash: blockHash ?? undefined,
    program_id: options.programId,
  });
}

function extractNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function extractString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

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
    referenceBlock: '0x',
    recipientValidator: params.recipientValidator ?? null,
    signerAddress: params.signerAddress,
    destination: params.mirror,
    payloadHash: keccak256(params.payload),
    salt: '0x',
    valueWei: params.value ?? 0n,
    submittedAtBlock: 0,
    validatorUrl: null,
  };
}

function formatUnknownError(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
