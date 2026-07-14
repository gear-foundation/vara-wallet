import { Command } from 'commander';
import type { TransactionReceipt, TransactionRequest } from 'viem';

import { getEthexeApi, getMirrorClient } from '../services/vara-eth/api';
import { resolveEthexeSigner } from '../services/vara-eth/account';
import {
  getDirectTransaction,
  insertDirectTransaction,
  markDirectTransactionFailed,
  markDirectTransactionReceipt,
  markDirectTransactionReplaced,
  type DirectTransactionRecord,
} from '../services/vara-eth/direct-transactions';
import { asAddress, asHex, parseOptionalBigInt, parseOptionalPositiveInteger } from '../utils/eth-types';
import { CliError } from '../utils/errors';
import { output } from '../utils/output';

const DEFAULT_RECEIPT_TIMEOUT_MS = 45_000;
const FEE_HEADROOM_NUMERATOR = 1200n;
const FEE_HEADROOM_DENOMINATOR = 1000n;
const REPLACEMENT_BUMP_NUMERATOR = 1125n;
const REPLACEMENT_BUMP_DENOMINATOR = 1000n;

interface ClaimOptions {
  account?: string;
  passphrase?: string;
  wait?: string;
  timeoutMs?: string;
  replaceAfterMs?: string;
  resume?: string;
  replace?: string;
  nonce?: string;
  gas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

interface PreparedClaim {
  mirror: `0x${string}`;
  claimedId: `0x${string}`;
  tx: {
    send(): Promise<`0x${string}`>;
    estimateGas(): Promise<bigint>;
    getTx(): TransactionRequest;
    getValueClaimingRequestedEvent(): Promise<{ source: string; claimedId: string }>;
  };
  sender: `0x${string}`;
  nonce: bigint;
  request: TransactionRequest;
}

export function registerVaraEthMailboxCommand(program: Command): void {
  const mailbox = program.command('vara-eth:mailbox').description('Mailbox operations on the Vara.eth rail');

  mailbox
    .command('claim [mirror] [claimedId]')
    .description('Claim a value entry from the Mirror mailbox')
    .option('--account <name>', 'Vara.eth wallet name')
    .option('--passphrase <pass>', 'wallet passphrase')
    .option('--wait <stage>', 'completion stage: submitted or receipt (default)', 'receipt')
    .option('--timeout-ms <ms>', `receipt wait timeout in milliseconds (default: ${DEFAULT_RECEIPT_TIMEOUT_MS})`)
    .option('--replace-after-ms <ms>', 'after this pending interval, submit one fee-bumped replacement')
    .option('--resume <txHash>', 'inspect a saved claim transaction without submitting a new one')
    .option('--replace <txHash>', 'replace a saved pending claim with the same nonce and fresh fees')
    .option('--nonce <nonce>', 'explicit Ethereum nonce')
    .option('--gas <gas>', 'explicit gas limit')
    .option('--max-fee-per-gas <wei>', 'EIP-1559 maximum fee per gas in wei')
    .option('--max-priority-fee-per-gas <wei>', 'EIP-1559 priority fee per gas in wei')
    .action(async (
      mirrorArg: string | undefined,
      claimedIdArg: string | undefined,
      _options: ClaimOptions,
      cmd: Command,
    ) => {
      const opts = cmd.optsWithGlobals() as ClaimOptions;
      await outputVaraEthMailboxClaim(mirrorArg, claimedIdArg, opts);
    });
}

export async function outputVaraEthMailboxClaim(
  mirrorArg: string | undefined,
  claimedIdArg: string | undefined,
  opts: ClaimOptions,
): Promise<void> {
  if (opts.resume && opts.replace) {
    throw new CliError('--resume and --replace are mutually exclusive', 'INVALID_CLAIM_OPERATION');
  }
  if (opts.resume) {
    if (mirrorArg || claimedIdArg) throw new CliError('--resume does not accept mirror or claimedId arguments', 'INVALID_CLAIM_OPERATION');
    await resumeClaim(asHex(opts.resume, '--resume'));
    return;
  }

  const storedReplacement = opts.replace ? requireStoredClaim(asHex(opts.replace, '--replace')) : undefined;
  const mirror = resolveClaimMirror(mirrorArg, storedReplacement);
  const claimedId = resolveClaimedId(claimedIdArg, storedReplacement);
  const wait = resolveClaimWait(opts.wait);
  const timeoutMs = parseOptionalPositiveInteger(opts.timeoutMs, '--timeout-ms', 'INVALID_TIMEOUT') ?? DEFAULT_RECEIPT_TIMEOUT_MS;
  const replaceAfterMs = parseOptionalPositiveInteger(opts.replaceAfterMs, '--replace-after-ms', 'INVALID_TIMEOUT');
  if (wait === 'submitted' && replaceAfterMs !== undefined) {
    throw new CliError('--replace-after-ms requires --wait receipt', 'INVALID_CLAIM_OPERATION');
  }

  const prepared = await prepareClaim(mirror, claimedId, opts, storedReplacement);
  const txHash = await submitClaim(prepared, storedReplacement?.tx_hash);
  if (storedReplacement) markDirectTransactionReplaced(storedReplacement.tx_hash, txHash);

  if (wait === 'submitted') {
    outputClaimSubmission(prepared, txHash, 'submitted', storedReplacement?.tx_hash ?? null);
    return;
  }

  const firstWaitMs = replaceAfterMs ?? timeoutMs;
  const receipt = await waitForClaimReceipt(prepared, txHash, firstWaitMs);
  if (receipt) {
    await outputClaimReceipt(prepared, txHash, receipt, storedReplacement?.tx_hash ?? null);
    return;
  }

  if (replaceAfterMs === undefined) {
    outputClaimSubmission(prepared, txHash, 'pending', storedReplacement?.tx_hash ?? null, 'CLAIM_PENDING');
    return;
  }

  // Persistence is best-effort. Keep an in-memory representation so automatic
  // replacement always uses the original nonce even when its SQLite write failed.
  const replacement = await prepareClaim(
    mirror,
    claimedId,
    opts,
    getDirectTransaction(txHash) ?? directRecordFromPreparedClaim(prepared, txHash),
  );
  const replacementHash = await submitClaim(replacement, txHash);
  markDirectTransactionReplaced(txHash, replacementHash);
  const replacementReceipt = await waitForClaimReceipt(replacement, replacementHash, timeoutMs);
  if (replacementReceipt) {
    await outputClaimReceipt(replacement, replacementHash, replacementReceipt, txHash);
    return;
  }
  outputClaimSubmission(replacement, replacementHash, 'pending', txHash, 'CLAIM_PENDING');
}

function resolveClaimWait(raw: string | undefined): 'submitted' | 'receipt' {
  const wait = raw ?? 'receipt';
  if (wait === 'submitted' || wait === 'receipt') return wait;
  throw new CliError('--wait must be one of: submitted, receipt', 'INVALID_WAIT_MODE', { wait });
}

function resolveClaimMirror(mirrorArg: string | undefined, stored?: DirectTransactionRecord): `0x${string}` {
  if (!mirrorArg && !stored) throw new CliError('mirror is required unless --replace is used', 'MISSING_REQUIRED_OPTION');
  const mirror = asAddress(mirrorArg ?? stored!.mirror, 'mirror');
  if (stored && mirrorArg && mirror.toLowerCase() !== stored.mirror.toLowerCase()) {
    throw new CliError('mirror does not match the saved claim transaction', 'CLAIM_REPLACEMENT_MISMATCH');
  }
  return mirror;
}

function resolveClaimedId(claimedIdArg: string | undefined, stored?: DirectTransactionRecord): `0x${string}` {
  if (!claimedIdArg && !stored?.claimed_id) throw new CliError('claimedId is required unless --replace is used', 'MISSING_REQUIRED_OPTION');
  const claimedId = asHex(claimedIdArg ?? stored!.claimed_id!, 'claimedId');
  if (stored?.claimed_id && claimedIdArg && claimedId.toLowerCase() !== stored.claimed_id.toLowerCase()) {
    throw new CliError('claimedId does not match the saved claim transaction', 'CLAIM_REPLACEMENT_MISMATCH');
  }
  return claimedId;
}

function requireStoredClaim(txHash: `0x${string}`): DirectTransactionRecord {
  const stored = getDirectTransaction(txHash);
  if (!stored || stored.operation !== 'mailbox_claim') {
    throw new CliError('No saved mailbox claim was found for --replace', 'CLAIM_REPLACEMENT_NOT_FOUND', { txHash });
  }
  if (stored.status !== 'pending') {
    throw new CliError('Only a pending mailbox claim can be replaced', 'CLAIM_NOT_PENDING', { txHash, status: stored.status });
  }
  return stored;
}

async function prepareClaim(
  mirror: `0x${string}`,
  claimedId: `0x${string}`,
  opts: ClaimOptions,
  replacement?: DirectTransactionRecord,
): Promise<PreparedClaim> {
  const api = await getEthexeApi();
  const signer = await resolveEthexeSigner(api.eth.publicClient, opts);
  api.eth.setSigner(signer);
  const sender = await signer.getAddress();
  const mirrorClient = await getMirrorClient(mirror, signer);
  const tx = await mirrorClient.claimValue(claimedId) as PreparedClaim['tx'];
  const request = tx.getTx();
  const explicitNonce = parseNonce(opts.nonce);
  const nonce = replacement ? parseNonce(replacement.nonce)! : (explicitNonce ?? await api.eth.publicClient.getTransactionCount({ address: sender, blockTag: 'pending' }));
  if (replacement && explicitNonce !== undefined && explicitNonce !== nonce) {
    throw new CliError('--nonce must equal the nonce of the claim being replaced', 'CLAIM_REPLACEMENT_MISMATCH', { nonce: nonce.toString() });
  }

  request.nonce = nonce;
  const explicitGas = parseOptionalBigInt(opts.gas, '--gas');
  if (explicitGas !== undefined) request.gas = explicitGas;
  else await tx.estimateGas();
  await applyClaimFees(request, api.eth.publicClient, opts, replacement);

  return { mirror, claimedId, tx, sender, nonce: BigInt(nonce), request };
}

function parseNonce(raw: string | undefined): number | undefined {
  const value = parseOptionalBigInt(raw, '--nonce');
  if (value === undefined) return undefined;
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CliError('--nonce must be a non-negative safe integer', 'INVALID_NONCE', { value: raw });
  }
  return Number(value);
}

async function applyClaimFees(
  request: TransactionRequest,
  publicClient: { estimateFeesPerGas(): Promise<{ maxFeePerGas?: bigint | null; maxPriorityFeePerGas?: bigint | null; gasPrice?: bigint | null }>; getGasPrice(): Promise<bigint> },
  opts: ClaimOptions,
  replacement?: DirectTransactionRecord,
): Promise<void> {
  const explicitMaxFee = parseOptionalBigInt(opts.maxFeePerGas, '--max-fee-per-gas');
  const explicitPriorityFee = parseOptionalBigInt(opts.maxPriorityFeePerGas, '--max-priority-fee-per-gas');
  const quote = await publicClient.estimateFeesPerGas();
  const previousMaxFee = replacement?.max_fee_per_gas ? BigInt(replacement.max_fee_per_gas) : undefined;
  const previousPriorityFee = replacement?.max_priority_fee_per_gas ? BigInt(replacement.max_priority_fee_per_gas) : undefined;

  if (replacement && explicitMaxFee !== undefined && previousMaxFee !== undefined && explicitMaxFee <= previousMaxFee) {
    throw new CliError('--max-fee-per-gas must exceed the previous replacement fee', 'REPLACEMENT_FEE_TOO_LOW');
  }
  if (replacement && explicitPriorityFee !== undefined && previousPriorityFee !== undefined && explicitPriorityFee <= previousPriorityFee) {
    throw new CliError('--max-priority-fee-per-gas must exceed the previous replacement fee', 'REPLACEMENT_FEE_TOO_LOW');
  }

  const quoteMaxFee = quote.maxFeePerGas === null || quote.maxFeePerGas === undefined
    ? undefined
    : feeHeadroom(quote.maxFeePerGas);
  const quotePriorityFee = quote.maxPriorityFeePerGas ?? undefined;
  if (quoteMaxFee !== undefined || explicitMaxFee !== undefined || previousMaxFee !== undefined) {
    request.maxFeePerGas = maximum(explicitMaxFee, quoteMaxFee, replacementBump(previousMaxFee));
    request.maxPriorityFeePerGas = maximum(explicitPriorityFee, quotePriorityFee, replacementBump(previousPriorityFee));
    return;
  }

  request.gasPrice = maximum(await publicClient.getGasPrice(), replacement?.gas_price ? replacementBump(BigInt(replacement.gas_price)) : undefined);
}

function replacementBump(value: bigint | undefined): bigint | undefined {
  if (value === undefined) return undefined;
  return (value * REPLACEMENT_BUMP_NUMERATOR + REPLACEMENT_BUMP_DENOMINATOR - 1n) / REPLACEMENT_BUMP_DENOMINATOR;
}

function feeHeadroom(value: bigint): bigint {
  return (value * FEE_HEADROOM_NUMERATOR + FEE_HEADROOM_DENOMINATOR - 1n) / FEE_HEADROOM_DENOMINATOR;
}

function maximum(...values: Array<bigint | undefined>): bigint {
  const defined = values.filter((value): value is bigint => value !== undefined);
  if (defined.length === 0) throw new CliError('Ethereum RPC did not return a usable fee quote', 'FEE_ESTIMATE_UNAVAILABLE');
  return defined.reduce((highest, value) => value > highest ? value : highest);
}

async function submitClaim(prepared: PreparedClaim, replacementOf?: string): Promise<`0x${string}`> {
  const txHash = await prepared.tx.send();
  try {
    insertDirectTransaction({
      txHash,
      operation: 'mailbox_claim',
      mirror: prepared.mirror,
      claimedId: prepared.claimedId,
      sender: prepared.sender,
      nonce: prepared.nonce,
      calldata: prepared.request.data ?? '0x',
      gas: prepared.request.gas,
      maxFeePerGas: prepared.request.maxFeePerGas,
      maxPriorityFeePerGas: prepared.request.maxPriorityFeePerGas,
      gasPrice: prepared.request.gasPrice,
      replacementOf,
    });
  } catch {
    // A successful broadcast remains valid when local persistence is unavailable.
  }
  return txHash;
}

async function waitForClaimReceipt(prepared: PreparedClaim, txHash: `0x${string}`, timeout: number): Promise<TransactionReceipt | null> {
  const api = await getEthexeApi();
  try {
    return await api.eth.publicClient.waitForTransactionReceipt({ hash: txHash, timeout });
  } catch (error) {
    if (isReceiptTimeout(error)) return null;
    markDirectTransactionFailed(txHash, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function outputClaimReceipt(
  prepared: PreparedClaim,
  txHash: `0x${string}`,
  receipt: TransactionReceipt,
  replacementOf: string | null,
): Promise<void> {
  const status = receipt.status === 'success' ? 'confirmed' : 'reverted';
  markDirectTransactionReceipt(txHash, status, receipt.blockNumber);
  const event = receipt.status === 'success' ? await prepared.tx.getValueClaimingRequestedEvent() : null;
  output({
    mirror: prepared.mirror,
    claimedId: prepared.claimedId,
    txHash,
    nonce: prepared.nonce.toString(),
    blockNumber: Number(receipt.blockNumber),
    status,
    replacementOf,
    fees: serializeFees(prepared.request),
    event: event ? { source: event.source, claimedId: event.claimedId } : null,
  });
}

function outputClaimSubmission(
  prepared: PreparedClaim,
  txHash: `0x${string}`,
  status: 'submitted' | 'pending',
  replacementOf: string | null,
  code?: 'CLAIM_PENDING',
): void {
  output({
    mirror: prepared.mirror,
    claimedId: prepared.claimedId,
    txHash,
    nonce: prepared.nonce.toString(),
    status,
    code: code ?? null,
    replacementOf,
    fees: serializeFees(prepared.request),
  });
}

function serializeFees(request: TransactionRequest): Record<string, string | null> {
  return {
    gas: request.gas?.toString() ?? null,
    maxFeePerGas: request.maxFeePerGas?.toString() ?? null,
    maxPriorityFeePerGas: request.maxPriorityFeePerGas?.toString() ?? null,
    gasPrice: request.gasPrice?.toString() ?? null,
  };
}

function directRecordFromPreparedClaim(prepared: PreparedClaim, txHash: `0x${string}`): DirectTransactionRecord {
  const fees = serializeFees(prepared.request);
  return {
    tx_hash: txHash,
    operation: 'mailbox_claim',
    mirror: prepared.mirror,
    claimed_id: prepared.claimedId,
    sender: prepared.sender,
    nonce: prepared.nonce.toString(),
    calldata: prepared.request.data ?? '0x',
    gas: fees.gas,
    max_fee_per_gas: fees.maxFeePerGas,
    max_priority_fee_per_gas: fees.maxPriorityFeePerGas,
    gas_price: fees.gasPrice,
    submitted_at_ts: Date.now(),
    status: 'pending',
    replacement_of: null,
    replaced_by: null,
    receipt_block: null,
    last_error: null,
  };
}

async function resumeClaim(txHash: `0x${string}`): Promise<void> {
  const stored = getDirectTransaction(txHash);
  if (!stored || stored.operation !== 'mailbox_claim') {
    throw new CliError('No saved mailbox claim was found for --resume', 'CLAIM_RESUME_NOT_FOUND', { txHash });
  }
  const api = await getEthexeApi();
  try {
    const receipt = await api.eth.publicClient.getTransactionReceipt({ hash: txHash });
    const status = receipt.status === 'success' ? 'confirmed' : 'reverted';
    markDirectTransactionReceipt(txHash, status, receipt.blockNumber);
    output({
      mirror: stored.mirror,
      claimedId: stored.claimed_id,
      txHash,
      nonce: stored.nonce,
      status,
      blockNumber: Number(receipt.blockNumber),
      replacementOf: stored.replacement_of,
      fees: {
        gas: stored.gas,
        maxFeePerGas: stored.max_fee_per_gas,
        maxPriorityFeePerGas: stored.max_priority_fee_per_gas,
        gasPrice: stored.gas_price,
      },
    });
  } catch (error) {
    if (!isReceiptMissing(error)) throw error;
    const nextMinedNonce = await api.eth.publicClient.getTransactionCount({
      address: stored.sender as `0x${string}`,
      blockTag: 'latest',
    });
    if (nextMinedNonce > parseNonce(stored.nonce)!) {
      output({
        mirror: stored.mirror,
        claimedId: stored.claimed_id,
        txHash,
        nonce: stored.nonce,
        status: 'unknown',
        code: 'CLAIM_REPLACED_OR_MINED',
        replacementOf: stored.replacement_of,
      });
      return;
    }
    output({
      mirror: stored.mirror,
      claimedId: stored.claimed_id,
      txHash,
      nonce: stored.nonce,
      status: 'pending',
      code: 'CLAIM_PENDING',
      replacementOf: stored.replacement_of,
      replacement: `vara-wallet --chain vara-eth vara-eth:mailbox claim --replace ${txHash}`,
    });
  }
}

function isReceiptTimeout(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  return name === 'WaitForTransactionReceiptTimeoutError' || /timed out waiting for transaction receipt/i.test(message);
}

function isReceiptMissing(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  return name === 'TransactionReceiptNotFoundError' || /transaction receipt.*not found/i.test(message);
}
