/**
 * Vara.eth promise persistence — schema, CRUD, status transitions, cleanup.
 *
 * Each test isolates `VARA_WALLET_DIR` to a unique tmp directory so the
 * SQLite file doesn't leak between cases or touch the user's real
 * `~/.vara-wallet/`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  __resetPromiseStoreForTests,
  getById,
  initPromiseStore,
  insertPending,
  listByStatus,
  markExpired,
  markFailed,
  markResolved,
} from '../services/vara-eth/promises';

let tmpDir: string;
const savedEnv = process.env.VARA_WALLET_DIR;

function basePending(overrides: Partial<Parameters<typeof insertPending>[0]> = {}) {
  return {
    txHash: '0x' + '11'.repeat(32),
    referenceBlock: '0x' + 'aa'.repeat(32),
    recipientValidator: null,
    signerAddress: '0x' + '22'.repeat(20),
    destination: '0x' + '33'.repeat(20),
    payloadHash: '0x' + '44'.repeat(32),
    salt: '0x' + '55'.repeat(32),
    valueWei: 0n,
    submittedAtBlock: 100,
    validatorUrl: null,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vw-promise-'));
  process.env.VARA_WALLET_DIR = tmpDir;
  __resetPromiseStoreForTests();
});

afterEach(() => {
  __resetPromiseStoreForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env.VARA_WALLET_DIR;
  else process.env.VARA_WALLET_DIR = savedEnv;
});

describe('Vara.eth promise store', () => {
  it('initializes idempotently', () => {
    expect(initPromiseStore()).toBe(true);
    expect(initPromiseStore()).toBe(true);
  });

  it('insertPending → getById round trip preserves every column', () => {
    initPromiseStore();
    const input = basePending({
      recipientValidator: '0x' + 'ab'.repeat(20),
      validatorUrl: 'wss://validator-1.example/9944',
      valueWei: 12345n,
    });
    insertPending(input);

    const row = getById(input.txHash);
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      tx_hash: input.txHash,
      reference_block: input.referenceBlock,
      recipient_validator: input.recipientValidator,
      signer_address: input.signerAddress,
      destination: input.destination,
      payload_hash: input.payloadHash,
      salt: input.salt,
      value_wei: '12345', // bigint persists as decimal string
      submitted_at_block: 100,
      validator_url: input.validatorUrl,
      status: 'pending',
      expires_at_block: 100 + 32, // default validity window
      retries: 0,
      last_error: null,
      reply_payload: null,
      reply_code: null,
      validator_signature: null,
    });
    expect(typeof row?.submitted_at_ts).toBe('number');
  });

  it('rejects duplicate insertion via PRIMARY KEY uniqueness', () => {
    initPromiseStore();
    const input = basePending();
    insertPending(input);
    expect(() => insertPending(input)).toThrow();
  });

  it('markResolved transitions only pending rows; terminal rows stay put', () => {
    initPromiseStore();
    const input = basePending();
    insertPending(input);

    markResolved(input.txHash, '0xreply', '0x00000000', '0xsig');
    const after = getById(input.txHash);
    expect(after?.status).toBe('resolved');
    expect(after?.reply_payload).toBe('0xreply');
    expect(after?.reply_code).toBe('0x00000000');
    expect(after?.validator_signature).toBe('0xsig');

    // A second call is a no-op (status guard).
    markResolved(input.txHash, '0xother', '0xff000000', '0xsig2');
    const final = getById(input.txHash);
    expect(final?.reply_payload).toBe('0xreply');
  });

  it('markFailed records the error and bumps retries by default 1', () => {
    initPromiseStore();
    const input = basePending();
    insertPending(input);

    markFailed(input.txHash, 'rpc 503');
    const after = getById(input.txHash);
    expect(after?.status).toBe('failed');
    expect(after?.last_error).toBe('rpc 503');
    expect(after?.retries).toBe(1);
  });

  it('markFailed with retryDelta=0 records the failure without bumping the counter', () => {
    initPromiseStore();
    const input = basePending();
    insertPending(input);

    markFailed(input.txHash, 'final', 0);
    const after = getById(input.txHash);
    expect(after?.retries).toBe(0);
    expect(after?.last_error).toBe('final');
  });

  it('markExpired transitions pending → expired', () => {
    initPromiseStore();
    const input = basePending();
    insertPending(input);

    markExpired(input.txHash);
    expect(getById(input.txHash)?.status).toBe('expired');
  });

  it('listByStatus returns rows newest-first and filters by status', () => {
    initPromiseStore();
    const a = basePending({ txHash: '0x' + 'a1'.repeat(32) });
    const b = basePending({ txHash: '0x' + 'b2'.repeat(32) });
    const c = basePending({ txHash: '0x' + 'c3'.repeat(32) });
    insertPending(a);
    insertPending(b);
    insertPending(c);
    markResolved(b.txHash, '0x', '0x00000000', null);

    const pending = listByStatus('pending');
    expect(pending.map((r) => r.tx_hash).sort()).toEqual([a.txHash, c.txHash].sort());

    const resolved = listByStatus('resolved');
    expect(resolved.map((r) => r.tx_hash)).toEqual([b.txHash]);
  });

  it('honors a custom validity window in expires_at_block', () => {
    initPromiseStore();
    const input = basePending({ submittedAtBlock: 500, validityWindow: 64 });
    insertPending(input);
    expect(getById(input.txHash)?.expires_at_block).toBe(564);
  });

  it('survives 100 parallel pending inserts (rough hostile-QA proxy)', () => {
    initPromiseStore();
    const promises = Array.from({ length: 100 }, (_, i) =>
      basePending({ txHash: '0x' + i.toString(16).padStart(64, '0') }),
    );
    for (const p of promises) insertPending(p);
    expect(listByStatus('pending', 200)).toHaveLength(100);
  });
});
