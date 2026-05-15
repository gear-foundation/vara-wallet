/**
 * Wallet-side ethexe errors.
 *
 * These never bubble up to `@vara-eth/api` consumers (the lib stays adapter-
 * shaped). They wrap CLI-only concerns: keystore decrypt, wallet lock state,
 * promise DB race conditions, chain-operation gating.
 */

import { CliError } from '../../utils/errors';

/** Raised when the active ethexe wallet has no decrypted key in memory. */
export class WalletLockedError extends CliError {
  constructor(walletName: string) {
    super(`Ethexe wallet "${walletName}" is locked. Provide --passphrase or set VARA_PASSPHRASE.`, 'WALLET_LOCKED', {
      walletName,
    });
  }
}

/** Raised when a V3 keystore fails to decrypt (wrong passphrase, corrupt file, etc.). */
export class KeystoreDecryptError extends CliError {
  constructor(walletName: string, reason: string) {
    super(`Failed to decrypt ethexe keystore "${walletName}": ${reason}`, 'KEYSTORE_DECRYPT_FAILED', {
      walletName,
      reason,
    });
  }
}

/** Raised on persistent wrong-passphrase attempts (after retries exhausted). */
export class WrongPassphraseError extends CliError {
  constructor(walletName: string, attemptsLeft: number) {
    super(
      `Wrong passphrase for ethexe wallet "${walletName}". ${attemptsLeft} attempt(s) left.`,
      'WRONG_PASSPHRASE',
      { walletName, attemptsLeft },
    );
  }
}

/** Raised when an in-flight injected tx exists for the same (signer, destination, salt) tuple. */
export class DuplicateSaltInFlightError extends CliError {
  constructor(signer: string, destination: string, salt: string) {
    super(`Duplicate injected-tx in flight: signer=${signer} destination=${destination} salt=${salt}`,
      'DUPLICATE_SALT_IN_FLIGHT',
      { signer, destination, salt },
    );
  }
}

/** Raised when --resume <txHash> targets a promise the DB doesn't know about. */
export class PromiseNotFoundError extends CliError {
  constructor(txHash: string) {
    super(`No persisted injected-tx promise found for ${txHash}.`, 'PROMISE_NOT_FOUND', { txHash });
  }
}

/**
 * Raised by commands stubbed for a future phase. The CLI accepts the command
 * name but errors out with a clear message instead of crashing at runtime.
 */
export class UnsupportedChainOperationError extends CliError {
  constructor(operation: string, chain: string, availableIn?: string) {
    const suffix = availableIn ? ` Available in ${availableIn}.` : '';
    super(`Operation "${operation}" is not available on chain "${chain}".${suffix}`,
      'UNSUPPORTED_CHAIN_OPERATION',
      { operation, chain, availableIn },
    );
  }
}
