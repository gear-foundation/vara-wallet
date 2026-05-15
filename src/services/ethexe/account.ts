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

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { PublicClient } from 'viem';
import { LocalSigner, type ITransactionSigner } from '@vara-eth/api';

import { decryptKeystore } from '../../shared/keyring-eth/keystore';
import { loadEthexeWallet } from '../../shared/keyring-eth/store';
import { KeystoreDecryptError, WrongPassphraseError } from '../../shared/errors-eth';
import { CliError } from '../../utils/errors';
import { readConfig } from '../config';

export interface EthexeAccountOptions {
  account?: string;
  passphrase?: string;
}

function resolvePassphrase(walletName: string, explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.VARA_PASSPHRASE) return process.env.VARA_PASSPHRASE;

  const passphraseFile = path.join(process.env.VARA_WALLET_DIR ?? path.join(process.env.HOME ?? '~', '.vara-wallet'), '.passphrase');
  if (existsSync(passphraseFile)) {
    return readFileSync(passphraseFile, 'utf8').trim();
  }
  throw new CliError(
    `Ethexe wallet "${walletName}" needs a passphrase. Provide --passphrase, set VARA_PASSPHRASE, or write to ~/.vara-wallet/.passphrase.`,
    'NO_PASSPHRASE',
    { walletName },
  );
}

/**
 * Resolves an ethexe account → `LocalSigner` ready to be passed into
 * {@link EthereumClient.setSigner}.
 *
 * @param publicClient - the viem PublicClient used by the ethexe api stack
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
    throw new CliError('No ethexe account selected. Use --account <name> or "config set defaultAccount".', 'NO_ACCOUNT');
  }

  const keystore = loadEthexeWallet(walletName);
  const passphrase = resolvePassphrase(walletName, options.passphrase);

  let privateKey: Uint8Array;
  try {
    privateKey = await decryptKeystore(keystore, passphrase);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes('MAC mismatch')) {
      throw new WrongPassphraseError(walletName, 0);
    }
    throw new KeystoreDecryptError(walletName, message);
  }

  // Convert private key bytes → 0x-hex string for the LocalSigner.
  const pkHex = `0x${Buffer.from(privateKey).toString('hex')}` as `0x${string}`;
  return new LocalSigner(pkHex, publicClient);
}
