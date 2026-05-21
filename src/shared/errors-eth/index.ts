/**
 * Wallet-side Vara.eth errors. These never live in `@vara-eth/api` (the lib stays
 * adapter-shaped) — they wrap CLI-only concerns.
 */

import { CliError } from '../../utils/errors';

/** Raised when a V3 keystore fails to decrypt (corrupt file, unsupported variant, etc.). */
export class KeystoreDecryptError extends CliError {
  constructor(walletName: string, reason: string) {
    super(`Failed to decrypt Vara.eth keystore "${walletName}": ${reason}`, 'KEYSTORE_DECRYPT_FAILED', {
      walletName,
      reason,
    });
  }
}

/** Raised when the passphrase doesn't match the keystore MAC. */
export class WrongPassphraseError extends CliError {
  constructor(walletName: string, passphraseSource?: string) {
    super(`Wrong passphrase for Vara.eth wallet "${walletName}".`, 'WRONG_PASSPHRASE', {
      walletName,
      ...(passphraseSource ? { passphraseSource } : {}),
    });
  }
}

/**
 * Raised when a `--network` preset for Vara.eth is not yet deployed and
 * the user must wait for an address announcement.
 */
export class NetworkNotDeployedError extends CliError {
  constructor(network: string) {
    super(
      `Vara.eth network "${network}" is not deployed yet. Track deployment status at https://github.com/gear-tech/gear (or wait for an address announcement).`,
      'NETWORK_NOT_DEPLOYED',
      { chain: 'vara-eth', network },
    );
  }
}

/**
 * Raised by commands stubbed for a future phase. The CLI accepts the command
 * name but errors out with a clear message instead of crashing at runtime.
 */
export class UnsupportedChainOperationError extends CliError {
  constructor(operation: string, chain: string, availableIn?: string) {
    const suffix = availableIn ? ` Available in ${availableIn}.` : '';
    super(`Operation "${operation}" is not available on chain "${chain}".${suffix}`, 'UNSUPPORTED_CHAIN_OPERATION', {
      operation,
      chain,
      availableIn,
    });
  }
}
