/**
 * Ethexe account resolver.
 *
 * Returns a `LocalSigner` for an unlocked V3 keystore. Passphrase resolution
 * follows the same priority as substrate: `--passphrase` flag > VARA_PASSPHRASE
 * env > `~/.vara-wallet/.passphrase` file.
 *
 * Unlike the substrate side, there is no "use mnemonic directly" path here —
 * Phase 3a always goes through a stored V3 keystore. Direct-mnemonic usage is
 * a Phase 4 follow-up.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bytesToHex, type PublicClient } from 'viem';
import { LocalSigner, type ITransactionSigner } from '@vara-eth/api';

import { decryptKeystore } from '../../shared/keyring-eth/keystore';
import { loadEthexeWallet } from '../../shared/keyring-eth/store';
import { KeystoreDecryptError, WrongPassphraseError } from '../../shared/errors-eth';
import { CliError } from '../../utils/errors';
import { getConfigDir, readConfig } from '../config';

export interface EthexeAccountOptions {
  account?: string;
  passphrase?: string;
}

function resolvePassphrase(walletName: string, explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.VARA_PASSPHRASE) return process.env.VARA_PASSPHRASE;

  try {
    return readFileSync(path.join(getConfigDir(), '.passphrase'), 'utf8').trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  throw new CliError(
    `Ethexe wallet "${walletName}" needs a passphrase. Provide --passphrase, set VARA_PASSPHRASE, or write to ~/.vara-wallet/.passphrase.`,
    'NO_PASSPHRASE',
    { walletName },
  );
}

/**
 * Resolves an Vara.eth account → `LocalSigner` ready to be passed into
 * {@link EthereumClient.setSigner}.
 *
 * @param publicClient - the viem PublicClient used by the Vara.eth api stack
 *                       (signer reuses its transport + chain)
 * @param options - `--account` (wallet name) and `--passphrase` flags
 */
export async function resolveEthexeSigner(
  publicClient: PublicClient,
  options: EthexeAccountOptions = {},
): Promise<ITransactionSigner> {
  const config = readConfig();
  const walletName = options.account ?? config.defaultAccount;
  if (!walletName) {
    throw new CliError('No Vara.eth account selected. Use --account <name> or "config set defaultAccount".', 'NO_ACCOUNT');
  }

  const keystore = loadEthexeWallet(walletName);
  const passphrase = resolvePassphrase(walletName, options.passphrase);

  let privateKey: Uint8Array;
  try {
    privateKey = await decryptKeystore(keystore, passphrase);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes('MAC mismatch')) {
      throw new WrongPassphraseError(walletName);
    }
    throw new KeystoreDecryptError(walletName, message);
  }

  return new LocalSigner(bytesToHex(privateKey), publicClient);
}
