import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  closeDirectTransactionStoreForTests,
  getDirectTransaction,
  insertDirectTransaction,
  markDirectTransactionFailed,
  markDirectTransactionReceipt,
  markDirectTransactionReplaced,
} from '../services/vara-eth/direct-transactions';

const TX_HASH = `0x${'11'.repeat(32)}`;

describe('Vara.eth direct transaction persistence', () => {
  let walletDir: string;
  let previousWalletDir: string | undefined;

  beforeEach(() => {
    previousWalletDir = process.env.VARA_WALLET_DIR;
    walletDir = mkdtempSync(join(tmpdir(), 'vara-wallet-direct-transactions-'));
    process.env.VARA_WALLET_DIR = walletDir;
    closeDirectTransactionStoreForTests();
  });

  afterEach(() => {
    closeDirectTransactionStoreForTests();
    if (previousWalletDir === undefined) delete process.env.VARA_WALLET_DIR;
    else process.env.VARA_WALLET_DIR = previousWalletDir;
    rmSync(walletDir, { recursive: true, force: true });
  });

  it('persists scope, fees, and terminal transitions', () => {
    insertDirectTransaction({
      txHash: TX_HASH,
      chainId: 5,
      operation: 'mailbox_claim',
      mirror: '0x1234560000000000000000000000000000000001',
      claimedId: `0x${'22'.repeat(32)}`,
      sender: '0x1234560000000000000000000000000000000002',
      nonce: 7n,
      calldata: '0xdeadbeef',
      gas: 50_000n,
      maxFeePerGas: 120n,
      maxPriorityFeePerGas: 3n,
    });

    expect(getDirectTransaction(TX_HASH)).toEqual(expect.objectContaining({
      chain_id: '5', nonce: '7', status: 'pending', max_fee_per_gas: '120',
    }));

    markDirectTransactionReceipt(TX_HASH, 'confirmed', 123n);
    expect(getDirectTransaction(TX_HASH)).toEqual(expect.objectContaining({ status: 'confirmed', receipt_block: '123' }));

    markDirectTransactionReplaced(TX_HASH, `0x${'33'.repeat(32)}`);
    expect(getDirectTransaction(TX_HASH)).toEqual(expect.objectContaining({ status: 'confirmed', replaced_by: null }));

    markDirectTransactionFailed(TX_HASH, 'ignored terminal update');
    expect(getDirectTransaction(TX_HASH)).toEqual(expect.objectContaining({ status: 'confirmed', last_error: null }));
  });

  it('does not throw when a locked store prevents a best-effort write', () => {
    const dbPath = join(walletDir, 'vara-eth-transactions.db');
    insertDirectTransaction({
      txHash: TX_HASH, chainId: 5, operation: 'mailbox_claim', mirror: '0x1234560000000000000000000000000000000001',
      sender: '0x1234560000000000000000000000000000000002', nonce: 7n, calldata: '0xdeadbeef',
    });
    closeDirectTransactionStoreForTests();
    const lock = new Database(dbPath);
    lock.exec('BEGIN EXCLUSIVE');

    expect(() => insertDirectTransaction({
      txHash: `0x${'44'.repeat(32)}`, chainId: 5, operation: 'mailbox_claim', mirror: '0x1234560000000000000000000000000000000001',
      sender: '0x1234560000000000000000000000000000000002', nonce: 8n, calldata: '0xdeadbeef',
    })).not.toThrow();

    lock.exec('ROLLBACK');
    lock.close();
  });

  it('migrates legacy rows without a chain ID but leaves them unsafe to replace', () => {
    const dbPath = join(walletDir, 'vara-eth-transactions.db');
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE direct_transactions (
        tx_hash TEXT PRIMARY KEY, operation TEXT NOT NULL, mirror TEXT NOT NULL, claimed_id TEXT,
        sender TEXT NOT NULL, nonce TEXT NOT NULL, calldata TEXT NOT NULL, gas TEXT,
        max_fee_per_gas TEXT, max_priority_fee_per_gas TEXT, gas_price TEXT,
        submitted_at_ts INTEGER NOT NULL, status TEXT NOT NULL, replacement_of TEXT,
        replaced_by TEXT, receipt_block TEXT, last_error TEXT
      );
      INSERT INTO direct_transactions (tx_hash, operation, mirror, sender, nonce, calldata, submitted_at_ts, status)
      VALUES ('${TX_HASH}', 'mailbox_claim', '0x1234560000000000000000000000000000000001',
        '0x1234560000000000000000000000000000000002', '7', '0xdeadbeef', 0, 'pending');
    `);
    legacy.close();

    expect(getDirectTransaction(TX_HASH)).toEqual(expect.objectContaining({ chain_id: null, status: 'pending' }));
  });
});
