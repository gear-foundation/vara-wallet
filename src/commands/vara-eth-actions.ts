import { readFileSync } from 'node:fs';
import type { Address, Hex, TransactionReceipt } from 'viem';
import { keccak256 } from 'viem';

import { getEthexeApi, getMirrorClient } from '../services/vara-eth/api';
import { resolveEthexeAccountAddress, resolveEthexeSigner, type EthexeAccountOptions } from '../services/vara-eth/account';
import { loadVaraEthSails } from '../services/vara-eth/sails-idl';
import { getById, initPromiseStore, insertPending, markFailed, markResolved } from '../services/vara-eth/promises';
import { insertEvent, initEventStore } from '../services/event-store';
import { readConfig } from '../services/config';
import { resolveInitDescriptor, type InitOptions } from '../services/sails-init';
import {
  describeSailsProgram,
  getSailsVersion,
  isSailsV2,
  suggestMethod,
  suggestService,
  type LoadedSails,
} from '../services/sails';
import { serializeReplyCode } from '../shared/output-eth/reply-code';
import { asAddress, asHex, parseOptionalBigInt } from '../utils/eth-types';
import {
  CliError,
  coerceArgsAuto,
  decodeSailsResult,
  errorMessage,
  loadArgsJson,
  minimalToVara,
  output,
  outputNdjson,
  toMinimalUnits,
  validateTopLevelArgs,
  validateUnits,
  verbose,
} from '../utils';

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

export interface VaraEthProgramDeployOptions extends EthexeAccountOptions, InitOptions {
  salt?: string;
  executableBalance?: string;
  dryRun?: boolean;
  value: string;
  units?: string;
}

export interface VaraEthSailsCallOptions extends EthexeAccountOptions {
  args?: string;
  argsFile?: string;
  idl?: string;
  value: string;
  units?: string;
  dryRun?: boolean;
  estimate?: boolean;
  origin?: string;
  via?: 'eth' | 'injected';
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

export async function outputVaraEthProgramUpload(
  wasmPath: string,
  opts: VaraEthProgramDeployOptions,
): Promise<void> {
  const code = readWasmFile(wasmPath);
  const initDesc = await resolveInitDescriptor(opts);
  const valueInfo = resolveVaraEthValue(opts.value, opts.units);
  const executableBalance = parseOptionalBigInt(opts.executableBalance, '--executable-balance') ?? 0n;

  if (opts.dryRun) {
    output({
      chain: 'vara-eth',
      kind: 'program-upload',
      init: initDesc.init,
      initPayload: initDesc.payload,
      wasmPath,
      codeBytes: code.length,
      salt: opts.salt ?? null,
      executableBalanceRaw: executableBalance.toString(),
      value: valueInfo.human,
      valueRaw: valueInfo.raw.toString(),
      units: valueInfo.units,
      willSubmit: false,
    });
    return;
  }

  const api = await getEthexeApi();
  const signer = await resolveEthexeSigner(api.eth.publicClient, opts);
  api.eth.setSigner(signer);

  const deployOptions = {
    ...(opts.salt ? { salt: asHex(opts.salt, '--salt') } : {}),
    ...(executableBalance > 0n ? { executableBalance } : {}),
  };
  const deployed = await api.programs.deploy(code, deployOptions);

  await outputDeploymentWithOptionalInit({
    api,
    programAddress: deployed.programAddress,
    codeId: deployed.codeId,
    deploymentReceipt: deployed.deploymentReceipt,
    codeValidationReceipt: deployed.codeValidationReceipt,
    initDesc,
    value: valueInfo.raw,
    valueHuman: valueInfo.human,
    units: valueInfo.units,
    via: 'eth',
  });
}

export async function outputVaraEthProgramDeploy(
  codeIdArg: string,
  opts: VaraEthProgramDeployOptions,
): Promise<void> {
  const codeId = asHex(codeIdArg, 'codeId');
  const initDesc = await resolveInitDescriptor(opts);
  const valueInfo = resolveVaraEthValue(opts.value, opts.units);
  const executableBalance = parseOptionalBigInt(opts.executableBalance, '--executable-balance') ?? 0n;

  if (opts.dryRun) {
    output({
      chain: 'vara-eth',
      kind: 'program-deploy',
      init: initDesc.init,
      codeId,
      initPayload: initDesc.payload,
      salt: opts.salt ?? null,
      executableBalanceRaw: executableBalance.toString(),
      value: valueInfo.human,
      valueRaw: valueInfo.raw.toString(),
      units: valueInfo.units,
      willSubmit: false,
    });
    return;
  }

  const api = await getEthexeApi();
  const signer = await resolveEthexeSigner(api.eth.publicClient, opts);
  api.eth.setSigner(signer);

  let builder = api.eth.router.createProgramBuilder(codeId);
  if (opts.salt) builder = builder.withSalt(asHex(opts.salt, '--salt'));
  if (executableBalance > 0n) {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const permitData = await api.eth.wvara.prepareAndSignPermitData(api.eth.router.address, executableBalance, deadline);
    builder = builder.withExecutableBalance(executableBalance, deadline, permitData.signature);
  }
  const tx = builder.build();
  const deploymentReceipt = await tx.sendAndWaitForReceipt();
  const programAddress = await tx.getProgramId() as Address;

  await outputDeploymentWithOptionalInit({
    api,
    programAddress,
    codeId,
    deploymentReceipt,
    initDesc,
    value: valueInfo.raw,
    valueHuman: valueInfo.human,
    units: valueInfo.units,
    via: 'eth',
  });
}

export async function outputVaraEthDiscover(programArg: string, opts: { idl?: string } = {}): Promise<void> {
  const programAddress = asAddress(programArg, 'programAddress');
  const api = await getEthexeApi();
  const loaded = await loadVaraEthSails(api, programAddress, { idl: opts.idl });
  output({
    chain: 'vara-eth',
    programAddress,
    codeId: loaded.codeId,
    idlSource: loaded.source,
    idlVersion: getSailsVersion(loaded.sails),
    services: describeSailsProgram(loaded.sails),
  });
}

export async function outputVaraEthSailsCall(
  programArg: string,
  methodArg: string,
  opts: VaraEthSailsCallOptions,
): Promise<void> {
  const programAddress = asAddress(programArg, 'programAddress');
  const via = resolveVaraEthSendPath(opts.via);
  const { serviceName, methodName } = parseSailsMethod(methodArg);
  const api = await getEthexeApi();
  const valueInfo = resolveVaraEthValue(opts.value, opts.units);
  const loaded = await loadVaraEthSails(api, programAddress, {
    idl: opts.idl,
    requiredMethod: { service: serviceName, method: methodName },
  });
  const resolved = resolveSailsMethod(loaded.sails, serviceName, methodName);
  let args = resolveCallArgs(opts, resolved.method.args?.length ?? 0, methodName);
  args = coerceArgsAuto(args, resolved.method.args || [], loaded.sails, serviceName);
  const encodedPayload = resolved.method.encodePayload(...args) as Hex;
  const origin = resolveVaraEthOrigin(opts);

  if (opts.dryRun) {
    const feeEstimate = opts.estimate && resolved.kind === 'function'
      ? await estimateVaraEthSendFee(api, programAddress, encodedPayload, valueInfo.raw, opts)
      : undefined;
    output({
      chain: 'vara-eth',
      kind: resolved.kind,
      programAddress,
      service: serviceName,
      method: methodName,
      args,
      encodedPayload,
      origin,
      via: resolved.kind === 'function' ? via : null,
      value: valueInfo.human,
      valueRaw: valueInfo.raw.toString(),
      units: valueInfo.units,
      feeEstimate,
      willSubmit: false,
    });
    return;
  }

  if (resolved.kind === 'query') {
    const reply = await api.call.program.calculateReplyForHandle(origin, programAddress, encodedPayload, valueInfo.raw);
    output({
      chain: 'vara-eth',
      kind: 'query',
      programAddress,
      service: serviceName,
      method: methodName,
      origin,
      value: valueInfo.human,
      valueRaw: valueInfo.raw.toString(),
      units: valueInfo.units,
      result: decodeVaraEthSailsReply(loaded.sails, resolved.method, serviceName, reply.payload),
      reply: {
        payload: reply.payload,
        value: String(reply.value),
        code: serializeReplyCode(reply.code),
      },
    });
    return;
  }

  if (opts.estimate) {
    output({
      chain: 'vara-eth',
      estimate: true,
      kind: 'function',
      programAddress,
      service: serviceName,
      method: methodName,
      encodedPayload,
      value: valueInfo.human,
      valueRaw: valueInfo.raw.toString(),
      units: valueInfo.units,
      feeEstimate: await estimateVaraEthSendFee(api, programAddress, encodedPayload, valueInfo.raw, opts),
    });
    return;
  }

  const signer = await resolveEthexeSigner(api.eth.publicClient, opts);
  api.eth.setSigner(signer);
  const from = await signer.getAddress();
  if (opts.origin && origin.toLowerCase() !== from.toLowerCase()) {
    throw new CliError(
      '--origin must match the signing account for submitted Vara.eth function calls',
      'ORIGIN_MISMATCH',
      { origin, signer: from },
    );
  }
  const result = await api.programs.sendAndWait(programAddress, encodedPayload, {
    value: valueInfo.raw,
    via,
  });
  output({
    chain: 'vara-eth',
    kind: 'function',
    programAddress,
    service: serviceName,
    method: methodName,
    origin: from,
    via,
    messageId: result.messageId,
    txHash: result.txHash,
    validator: result.validator ?? null,
    value: valueInfo.human,
    valueRaw: valueInfo.raw.toString(),
    units: valueInfo.units,
    result: decodeVaraEthSailsReply(loaded.sails, resolved.method, serviceName, result.reply.payload),
    reply: {
      payload: result.reply.payload,
      value: result.reply.value.toString(),
      code: serializeReplyCode(result.reply.code),
    },
  });
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
  const network = persist ? resolveVaraEthEventNetwork() : null;

  const api = await getEthexeApi();
  verbose(`subscribing to program events ${mirror}`);
  let seen = 0;
  const unsubscribe = api.stream.programEvents(
    mirror,
    {
      onEvent: (event) => {
        const data = { kind: 'program', chain: 'vara-eth', ...event };
        outputNdjson(data);
        if (persist) persistVaraEthEvent('program', data, { programId: mirror, network });
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
  const network = persist ? resolveVaraEthEventNetwork() : null;

  const api = await getEthexeApi();
  verbose('subscribing to router events');
  let seen = 0;
  const unsubscribe = api.stream.routerEvents(
    {
      onEvent: (event) => {
        const data = { kind: 'router', chain: 'vara-eth', ...event };
        outputNdjson(data);
        if (persist) persistVaraEthEvent('router', data, { network });
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
  const network = persist ? resolveVaraEthEventNetwork() : null;

  const api = await getEthexeApi();
  verbose('subscribing to blocks');
  let seen = 0;
  const unsubscribe = api.stream.blocks(
    {
      onEvent: (header) => {
        const data = { kind: 'block', chain: 'vara-eth', ...header };
        outputNdjson(data);
        if (persist) persistVaraEthEvent('block', data, { network });
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

async function outputDeploymentWithOptionalInit(params: {
  api: Awaited<ReturnType<typeof getEthexeApi>>;
  programAddress: Address;
  codeId: Hex;
  deploymentReceipt: TransactionReceipt;
  codeValidationReceipt?: TransactionReceipt;
  initDesc: { payload: string; init: string | null };
  value: bigint;
  valueHuman: string;
  units: 'human' | 'raw';
  via: 'eth';
}): Promise<void> {
  const base = {
    chain: 'vara-eth',
    codeId: params.codeId,
    programAddress: params.programAddress,
    codeValidationTxHash: params.codeValidationReceipt?.transactionHash ?? null,
    deploymentTxHash: params.deploymentReceipt.transactionHash,
    codeValidationBlock: params.codeValidationReceipt ? Number(params.codeValidationReceipt.blockNumber) : null,
    deploymentBlock: Number(params.deploymentReceipt.blockNumber),
    init: params.initDesc.init,
    initPayload: params.initDesc.payload,
    value: params.valueHuman,
    valueRaw: params.value.toString(),
    units: params.units,
  };

  const shouldInit = params.initDesc.init !== null || params.initDesc.payload !== '0x' || params.value > 0n;
  if (!shouldInit) {
    output({ ...base, initStatus: 'skipped' });
    return;
  }

  try {
    const init = await params.api.programs.sendAndWait(params.programAddress, asHex(params.initDesc.payload, 'initPayload'), {
      value: params.value,
      via: params.via,
    });
    output({
      ...base,
      initStatus: 'success',
      initTxHash: init.txHash,
      initMessageId: init.messageId,
      initReply: {
        payload: init.reply.payload,
        value: init.reply.value.toString(),
        code: serializeReplyCode(init.reply.code),
      },
    });
  } catch (err) {
    const recovery = {
      ...base,
      initStatus: 'failed',
      initError: {
        error: errorMessage(err),
      },
    };
    output(recovery);
    throw new CliError('Vara.eth program deployed but init message failed', 'VARA_ETH_INIT_FAILED', recovery);
  }
}

function parseSailsMethod(method: string): { serviceName: string; methodName: string } {
  const parts = method.split('/');
  if (parts.length !== 2) {
    throw new CliError(
      `Method must be in "Service/Method" format (e.g. Counter/Increment). Got: "${method}"`,
      'INVALID_METHOD_FORMAT',
    );
  }
  return { serviceName: parts[0], methodName: parts[1] };
}

function resolveSailsMethod(
  sails: LoadedSails,
  serviceName: string,
  methodName: string,
): { kind: 'query' | 'function'; method: SailsMethodLike } {
  const service = sails.services[serviceName];
  if (!service) {
    const available = Object.keys(sails.services).join(', ');
    const hint = suggestService(sails, serviceName);
    const prefix = hint ? `Did you mean: ${hint}/${methodName}? ` : '';
    throw new CliError(
      `${prefix}Service "${serviceName}" not found. Available services: ${available}`,
      'SERVICE_NOT_FOUND',
    );
  }

  if (methodName in service.queries) return { kind: 'query', method: service.queries[methodName] as SailsMethodLike };
  if (methodName in service.functions) return { kind: 'function', method: service.functions[methodName] as SailsMethodLike };

  const allMethods = [
    ...Object.keys(service.functions || {}).map((name) => `${serviceName}/${name} (function)`),
    ...Object.keys(service.queries || {}).map((name) => `${serviceName}/${name} (query)`),
  ];
  const hint = suggestMethod(sails, serviceName, methodName);
  const prefix = hint ? `Did you mean: ${hint}? ` : '';
  throw new CliError(
    `${prefix}Method "${methodName}" not found in service "${serviceName}". Available: ${allMethods.join(', ')}`,
    'METHOD_NOT_FOUND',
  );
}

type SailsMethodLike = {
  args: Array<{ name: string; typeDef: unknown }>;
  returnTypeDef: unknown;
  encodePayload: (...args: unknown[]) => Hex;
  decodeResult?: (payload: Hex) => unknown;
};

function resolveCallArgs(opts: VaraEthSailsCallOptions, arity: number, methodName: string): unknown[] {
  const parsed = loadArgsJson({
    args: opts.args,
    argsFile: opts.argsFile,
    argsDefault: '[]',
  });
  return validateTopLevelArgs(parsed, arity, { kind: 'Method', name: methodName });
}

function decodeVaraEthSailsReply(
  sails: LoadedSails,
  method: SailsMethodLike,
  serviceName: string,
  payload: Hex,
): unknown {
  if (isSailsV2(sails)) {
    try {
      const decoded = sails.decodeReply(payload);
      if (decoded.kind === 'reply') {
        const entry = decoded.entry as { service: string; fn: string };
        const replyMethod = sails.services[entry.service]?.functions[entry.fn]
          ?? sails.services[entry.service]?.queries[entry.fn];
        return decodeSailsResult(
          sails,
          replyMethod?.returnTypeDef ?? method.returnTypeDef,
          decoded.result,
          entry.service,
        );
      }
    } catch (err) {
      verbose(`Vara.eth Sails reply was not an enveloped v2 reply; falling back to method result decode. ${errorMessage(err)}`);
    }
  }
  const decoded = method.decodeResult ? method.decodeResult(payload) : payload;
  return decodeSailsResult(sails, method.returnTypeDef, decoded, serviceName);
}

function resolveVaraEthOrigin(opts: EthexeAccountOptions & { origin?: string }): Address {
  if (opts.origin) return asAddress(opts.origin, '--origin');
  try {
    return resolveEthexeAccountAddress(opts);
  } catch {
    return '0x0000000000000000000000000000000000000000';
  }
}

function resolveVaraEthSendPath(via: string | undefined): 'eth' | 'injected' {
  if (via === undefined) return 'eth';
  if (via === 'eth' || via === 'injected') return via;
  throw new CliError('--via must be "eth" or "injected"', 'INVALID_VIA', { via });
}

function resolveVaraEthValue(
  amountArg: string,
  units: string | undefined,
): { raw: bigint; human: string; units: 'human' | 'raw' } {
  const resolvedUnits = validateUnits(units) ?? 'human';
  const amount = resolvedUnits === 'raw' ? BigInt(amountArg) : toMinimalUnits(amountArg, 18);
  return {
    raw: amount,
    human: minimalToVara(amount, 18),
    units: resolvedUnits,
  };
}

async function estimateVaraEthSendFee(
  api: Awaited<ReturnType<typeof getEthexeApi>>,
  mirror: Address,
  payload: Hex,
  value: bigint,
  opts: EthexeAccountOptions,
): Promise<{ gas: string; ethCostWei: string; wvaraFee: string | null }> {
  const signer = await resolveEthexeSigner(api.eth.publicClient, opts);
  api.eth.setSigner(signer);
  const estimate = await api.fees.estimate({
    type: 'sendMessage',
    mirror,
    payload,
    value,
  });
  return {
    gas: estimate.gas.toString(),
    ethCostWei: estimate.ethCostWei.toString(),
    wvaraFee: estimate.wvaraFee?.toString() ?? null,
  };
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

function persistVaraEthEvent(
  type: string,
  data: Record<string, unknown>,
  options: { programId?: Address; network?: string | null } = {},
): void {
  const network = 'network' in options ? options.network : resolveVaraEthEventNetwork();
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

function resolveVaraEthEventNetwork(): string | null {
  return process.env.VARA_ETH_NETWORK_PRESET_NAME ?? readConfig().varaEthNetwork ?? null;
}

function readWasmFile(wasmPath: string): Uint8Array {
  try {
    return new Uint8Array(readFileSync(wasmPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError(`WASM file not found: ${wasmPath}`, 'FILE_NOT_FOUND');
    }
    throw err;
  }
}

function extractNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

export const __testing = {
  persistVaraEthEvent,
  resolveVaraEthEventNetwork,
};

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
