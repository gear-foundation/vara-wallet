/**
 * Persistence for direct Ethereum transactions submitted by Vara.eth commands.
 *
 * This is intentionally separate from injected promise persistence: Ethereum
 * mempool transactions have nonces, replacement chains, and receipts rather
 * than validator-signed promise outcomes.
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getConfigDir } from '../config';
import { verbose } from '../../utils';

export type DirectTransactionStatus = 'pending' | 'confirmed' | 'reverted' | 'replaced' | 'failed';

export interface DirectTransactionRecord {
  tx_hash: string;
  operation: string;
  mirror: string;
  claimed_id: string | null;
  sender: string;
  nonce: string;
  calldata: string;
  gas: string | null;
  max_fee_per_gas: string | null;
  max_priority_fee_per_gas: string | null;
  gas_price: string | null;
  submitted_at_ts: number;
  status: DirectTransactionStatus;
  replacement_of: string | null;
  replaced_by: string | null;
  receipt_block: string | null;
  last_error: string | null;
}

export interface InsertDirectTransaction {
  txHash: string;
  operation: string;
  mirror: string;
  claimedId?: string;
  sender: string;
  nonce: bigint;
  calldata: string;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasPrice?: bigint;
  replacementOf?: string;
}

let db: Database.Database | null = null;

function getDb(): Database.Database | null {
  if (db) return db;

  try {
    const configDir = getConfigDir();
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    db = new Database(path.join(configDir, 'vara-eth-transactions.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.exec(`
      CREATE TABLE IF NOT EXISTS direct_transactions (
        tx_hash TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        mirror TEXT NOT NULL,
        claimed_id TEXT,
        sender TEXT NOT NULL,
        nonce TEXT NOT NULL,
        calldata TEXT NOT NULL,
        gas TEXT,
        max_fee_per_gas TEXT,
        max_priority_fee_per_gas TEXT,
        gas_price TEXT,
        submitted_at_ts INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'confirmed', 'reverted', 'replaced', 'failed')),
        replacement_of TEXT,
        replaced_by TEXT,
        receipt_block TEXT,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_direct_transactions_status ON direct_transactions(status);
      CREATE INDEX IF NOT EXISTS idx_direct_transactions_sender_nonce ON direct_transactions(sender, nonce);
    `);
    return db;
  } catch (error) {
    verbose(`Warning: failed to initialize Vara.eth direct transaction store: ${error instanceof Error ? error.message : String(error)}`);
    db = null;
    return null;
  }
}

export function insertDirectTransaction(input: InsertDirectTransaction): void {
  const database = getDb();
  if (!database) return;
  database.prepare(`
    INSERT INTO direct_transactions (
      tx_hash, operation, mirror, claimed_id, sender, nonce, calldata, gas,
      max_fee_per_gas, max_priority_fee_per_gas, gas_price, submitted_at_ts,
      status, replacement_of
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    input.txHash,
    input.operation,
    input.mirror,
    input.claimedId ?? null,
    input.sender,
    input.nonce.toString(),
    input.calldata,
    input.gas?.toString() ?? null,
    input.maxFeePerGas?.toString() ?? null,
    input.maxPriorityFeePerGas?.toString() ?? null,
    input.gasPrice?.toString() ?? null,
    Date.now(),
    input.replacementOf ?? null,
  );
}

export function getDirectTransaction(txHash: string): DirectTransactionRecord | undefined {
  const database = getDb();
  if (!database) return undefined;
  return database.prepare('SELECT * FROM direct_transactions WHERE tx_hash = ?').get(txHash) as DirectTransactionRecord | undefined;
}

export function markDirectTransactionReceipt(
  txHash: string,
  status: Extract<DirectTransactionStatus, 'confirmed' | 'reverted'>,
  blockNumber: bigint,
): void {
  const database = getDb();
  if (!database) return;
  database.prepare(`
    UPDATE direct_transactions
    SET status = ?, receipt_block = ?, last_error = NULL
    WHERE tx_hash = ?
  `).run(status, blockNumber.toString(), txHash);
}

export function markDirectTransactionReplaced(originalTxHash: string, replacementTxHash: string): void {
  const database = getDb();
  if (!database) return;
  database.prepare(`
    UPDATE direct_transactions
    SET status = 'replaced', replaced_by = ?
    WHERE tx_hash = ? AND status = 'pending'
  `).run(replacementTxHash, originalTxHash);
}

export function markDirectTransactionFailed(txHash: string, error: string): void {
  const database = getDb();
  if (!database) return;
  database.prepare(`
    UPDATE direct_transactions
    SET status = 'failed', last_error = ?
    WHERE tx_hash = ? AND status = 'pending'
  `).run(error, txHash);
}

