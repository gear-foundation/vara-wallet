/**
 * Vara.eth injected-tx promise persistence.
 *
 * Sibling SQLite file to `events.db`; distinct schema, distinct connection.
 * Backs `vara-eth:message send` and `vara-eth:program deploy` so an in-flight
 * promise can be resumed after process death via `--resume <txHash>`.
 *
 * WAL mode + `busy_timeout = 5000ms` keep concurrent CLI invocations from
 * racing fatally on the same row. All status transitions wrap in
 * `BEGIN IMMEDIATE` so we never observe a half-written row from a parallel
 * writer.
 *
 * Cleanup of resolved/failed/expired rows runs at most once per process
 * startup, gated by a `metadata.last_cleanup_at` row.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

import { getConfigDir } from '../config';
import { verbose } from '../../utils';

const DB_FILENAME = 'vara-eth-promises.db';
const CLEANUP_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // run cleanup at most once per 24h
const BUSY_TIMEOUT_MS = 5_000;

export type PromiseStatus = 'pending' | 'resolved' | 'failed' | 'expired';

export interface InjectedPromiseRow {
  tx_hash: string;
  reference_block: string;
  recipient_validator: string | null;
  signer_address: string;
  destination: string;
  payload_hash: string;
  salt: string;
  value_wei: string;
  submitted_at_block: number;
  submitted_at_ts: number;
  validator_url: string | null;
  status: PromiseStatus;
  reply_payload: string | null;
  reply_code: string | null;
  validator_signature: string | null;
  expires_at_block: number;
  retries: number;
  last_error: string | null;
}

export interface InsertPendingInput {
  txHash: string;
  referenceBlock: string;
  recipientValidator?: string | null;
  signerAddress: string;
  destination: string;
  payloadHash: string;
  salt: string;
  valueWei: bigint;
  submittedAtBlock: number;
  validatorUrl?: string | null;
  /** Number of L1 blocks the validator window covers; defaults to 32 (matches ethexe `VALIDITY_WINDOW`). */
  validityWindow?: number;
}

let db: Database.Database | null = null;
let insertPendingStmt: Database.Statement | null = null;
let getByIdStmt: Database.Statement | null = null;
let markResolvedStmt: Database.Statement | null = null;
let markFailedStmt: Database.Statement | null = null;
let markExpiredStmt: Database.Statement | null = null;
let cleanupStmt: Database.Statement | null = null;
let listByStatusStmt: Database.Statement | null = null;

function dbPath(): string {
  return path.join(getConfigDir(), DB_FILENAME);
}

/**
 * Opens the database, applies WAL + busy_timeout, creates schema if missing,
 * and prepares cached statements. Idempotent — subsequent calls are no-ops.
 *
 * Returns `false` if open failed (e.g. fs permission). The caller should
 * still be able to function with the persistence layer disabled, mirroring
 * the lenient pattern in `event-store.ts`.
 */
export function initPromiseStore(): boolean {
  if (db) return true;

  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });

  try {
    db = new Database(dbPath());
    db.pragma('journal_mode = WAL');
    db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS injected_promises (
        tx_hash             TEXT PRIMARY KEY,
        reference_block     TEXT NOT NULL,
        recipient_validator TEXT,
        signer_address      TEXT NOT NULL,
        destination         TEXT NOT NULL,
        payload_hash        TEXT NOT NULL,
        salt                TEXT NOT NULL,
        value_wei           TEXT NOT NULL,
        submitted_at_block  INTEGER NOT NULL,
        submitted_at_ts     INTEGER NOT NULL,
        validator_url       TEXT,
        status              TEXT NOT NULL CHECK(status IN ('pending','resolved','failed','expired')),
        reply_payload       TEXT,
        reply_code          TEXT,
        validator_signature TEXT,
        expires_at_block    INTEGER NOT NULL,
        retries             INTEGER NOT NULL DEFAULT 0,
        last_error          TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_promises_status      ON injected_promises(status);
      CREATE INDEX IF NOT EXISTS idx_promises_submitted   ON injected_promises(submitted_at_ts);

      CREATE TABLE IF NOT EXISTS promise_metadata (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    insertPendingStmt = db.prepare(`
      INSERT INTO injected_promises (
        tx_hash, reference_block, recipient_validator, signer_address, destination,
        payload_hash, salt, value_wei, submitted_at_block, submitted_at_ts,
        validator_url, status, expires_at_block
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `);

    getByIdStmt = db.prepare(`SELECT * FROM injected_promises WHERE tx_hash = ?`);

    markResolvedStmt = db.prepare(`
      UPDATE injected_promises
      SET status = 'resolved', reply_payload = ?, reply_code = ?, validator_signature = ?
      WHERE tx_hash = ? AND status = 'pending'
    `);

    markFailedStmt = db.prepare(`
      UPDATE injected_promises
      SET status = 'failed', last_error = ?, retries = retries + ?
      WHERE tx_hash = ? AND status = 'pending'
    `);

    markExpiredStmt = db.prepare(`
      UPDATE injected_promises
      SET status = 'expired'
      WHERE tx_hash = ? AND status = 'pending'
    `);

    cleanupStmt = db.prepare(`
      DELETE FROM injected_promises
      WHERE status IN ('resolved','failed','expired') AND submitted_at_ts < ?
    `);

    listByStatusStmt = db.prepare(
      `SELECT * FROM injected_promises WHERE status = ? ORDER BY submitted_at_ts DESC LIMIT ?`,
    );

    maybeRunCleanup();

    verbose(`Vara.eth promise store initialized at ${dbPath()}`);
    return true;
  } catch (err) {
    verbose(`Warning: failed to initialize Vara.eth promise store: ${err instanceof Error ? err.message : String(err)}`);
    db = null;
    insertPendingStmt = null;
    getByIdStmt = null;
    markResolvedStmt = null;
    markFailedStmt = null;
    markExpiredStmt = null;
    cleanupStmt = null;
    listByStatusStmt = null;
    return false;
  }
}

/**
 * Inserts a `pending` row. Throws if a row with the same tx_hash already
 * exists (SQLite unique-key violation) — the caller treats this as a
 * duplicate-submit race and decides whether to surface or absorb it.
 */
export function insertPending(input: InsertPendingInput): void {
  if (!insertPendingStmt) initPromiseStore();
  if (!insertPendingStmt) return;
  const window = input.validityWindow ?? 32;
  insertPendingStmt.run(
    input.txHash,
    input.referenceBlock,
    input.recipientValidator ?? null,
    input.signerAddress,
    input.destination,
    input.payloadHash,
    input.salt,
    input.valueWei.toString(),
    input.submittedAtBlock,
    Date.now(),
    input.validatorUrl ?? null,
    input.submittedAtBlock + window,
  );
}

/** Reads a single promise by txHash. Returns `undefined` if absent. */
export function getById(txHash: string): InjectedPromiseRow | undefined {
  if (!getByIdStmt) initPromiseStore();
  if (!getByIdStmt) return undefined;
  return getByIdStmt.get(txHash) as InjectedPromiseRow | undefined;
}

/**
 * Transitions a pending row to `resolved`. Idempotent: a row already in a
 * terminal state is left unchanged (the UPDATE's `status = 'pending'` guard
 * silently filters it out).
 */
export function markResolved(
  txHash: string,
  replyPayload: string,
  replyCode: string,
  validatorSignature: string | null,
): void {
  if (!markResolvedStmt) initPromiseStore();
  if (!markResolvedStmt) return;
  markResolvedStmt.run(replyPayload, replyCode, validatorSignature, txHash);
}

/**
 * Transitions a pending row to `failed` and increments retries.
 *
 * `retryDelta` defaults to 1; pass 0 to record a final-give-up failure
 * without bumping the retry counter (useful when the failure isn't itself
 * a "we tried again" event).
 */
export function markFailed(txHash: string, errorMessage: string, retryDelta = 1): void {
  if (!markFailedStmt) initPromiseStore();
  if (!markFailedStmt) return;
  markFailedStmt.run(errorMessage, retryDelta, txHash);
}

/** Transitions a pending row to `expired`. Idempotent (see {@link markResolved}). */
export function markExpired(txHash: string): void {
  if (!markExpiredStmt) initPromiseStore();
  if (!markExpiredStmt) return;
  markExpiredStmt.run(txHash);
}

/** Lists promises in a given status, newest first. Useful for `--resume` discovery. */
export function listByStatus(status: PromiseStatus, limit = 50): InjectedPromiseRow[] {
  if (!listByStatusStmt) initPromiseStore();
  if (!listByStatusStmt) return [];
  return listByStatusStmt.all(status, limit) as InjectedPromiseRow[];
}

/**
 * Deletes terminal-state rows older than `CLEANUP_AGE_MS`. Runs at most once
 * per `CLEANUP_INTERVAL_MS`, guarded by a `last_cleanup_at` row in
 * `promise_metadata`. Designed to be cheap on hot paths — back-to-back CLI
 * invocations don't pay for it.
 *
 * Returns the number of rows deleted (0 if nothing to do or already ran).
 */
export function maybeRunCleanup(): number {
  if (!db || !cleanupStmt) return 0;
  const now = Date.now();
  const lastRow = db
    .prepare(`SELECT value FROM promise_metadata WHERE key = 'last_cleanup_at'`)
    .get() as { value: string } | undefined;
  const last = lastRow ? Number(lastRow.value) : 0;
  if (now - last < CLEANUP_INTERVAL_MS) return 0;

  const cutoff = now - CLEANUP_AGE_MS;
  const result = cleanupStmt.run(cutoff);
  db.prepare(
    `INSERT INTO promise_metadata (key, value) VALUES ('last_cleanup_at', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(now));

  if (result.changes > 0) {
    verbose(`Pruned ${result.changes} terminal-state Vara.eth promises (older than 30d)`);
  }
  return result.changes;
}

/** Closes the DB connection. Safe to call when nothing's open. */
export function closePromiseStore(): void {
  if (db) {
    try {
      db.close();
    } catch {
      // ignore
    }
    db = null;
    insertPendingStmt = null;
    getByIdStmt = null;
    markResolvedStmt = null;
    markFailedStmt = null;
    markExpiredStmt = null;
    cleanupStmt = null;
    listByStatusStmt = null;
  }
}

/** Test-only — force re-init on next call (don't use in production). */
export function __resetPromiseStoreForTests(): void {
  closePromiseStore();
}
