/**
 * Ethexe account resolver.
 *
 * Returns a `LocalSigner` for an unlocked V3 keystore. Passphrase resolution
 * follows the same priority as substrate, with an extra per-wallet fallback:
 * `--passphrase` flag > VARA_PASSPHRASE env >
 * `~/.vara-wallet/passphrases/<wallet>.passphrase` >
 * `~/.vara-wallet/.passphrase` file.
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
import { ethexeWalletExists, loadEthexeWallet } from '../../shared/keyring-eth/store';
import { KeystoreDecryptError, WrongPassphraseError } from '../../shared/errors-eth';
import { CliError } from '../../utils/errors';
import { getConfigDir, readConfig } from '../config';

export interface EthexeAccountOptions {
  account?: string;
  passphrase?: string;
}

export interface ResolvedEthexePassphrase {
  passphrase: string;
  source: 'flag' | 'env' | 'wallet-file' | 'global-file';
}

function readOptionalPassphrase(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8').trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return undefined;
  }
}

function assertSafeWalletName(walletName: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(walletName)) {
    throw new CliError(`Invalid wallet name "${walletName}": only [a-zA-Z0-9._-] allowed`, 'INVALID_WALLET_NAME', {
      walletName,
    });
  }
}

export function resolveEthexePassphrase(walletName: string, explicit?: string): ResolvedEthexePassphrase {
  if (explicit) return { passphrase: explicit, source: 'flag' };
  if (process.env.VARA_PASSPHRASE) return { passphrase: process.env.VARA_PASSPHRASE, source: 'env' };

  assertSafeWalletName(walletName);
  const configDir = getConfigDir();
  const perWallet = readOptionalPassphrase(path.join(configDir, 'passphrases', `${walletName}.passphrase`));
  if (perWallet !== undefined) {
    return { passphrase: perWallet, source: 'wallet-file' };
  }

  const global = readOptionalPassphrase(path.join(configDir, '.passphrase'));
  if (global !== undefined) return { passphrase: global, source: 'global-file' };

  throw new CliError(
    `Ethexe wallet "${walletName}" needs a passphrase. Provide --passphrase, set VARA_PASSPHRASE, write ~/.vara-wallet/passphrases/${walletName}.passphrase, or write ~/.vara-wallet/.passphrase.`,
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
  const walletName = resolveEthexeAccountName(options);
  const keystore = loadEthexeWallet(walletName);
  const { passphrase, source } = resolveEthexePassphrase(walletName, options.passphrase);

  let privateKey: Uint8Array;
  try {
    privateKey = await decryptKeystore(keystore, passphrase);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes('MAC mismatch')) {
      throw new WrongPassphraseError(walletName, source);
    }
    throw new KeystoreDecryptError(walletName, message);
  }

  return new LocalSigner(bytesToHex(privateKey), publicClient);
}

export function resolveEthexeAccountName(options: EthexeAccountOptions = {}): string {
  const config = readConfig();
  const walletName = options.account ?? config.defaultVaraEthAccount ?? (
    config.defaultAccount && ethexeWalletExists(config.defaultAccount) ? config.defaultAccount : undefined
  );
  if (!walletName) {
    throw new CliError('No Vara.eth account selected. Use --account <name> or "config set defaultVaraEthAccount".', 'NO_ACCOUNT');
  }
  return walletName;
}

export function resolveEthexeAccountAddress(options: EthexeAccountOptions = {}): `0x${string}` {
  const walletName = resolveEthexeAccountName(options);
  const keystore = loadEthexeWallet(walletName);
  return `0x${keystore.address}` as `0x${string}`;
}
