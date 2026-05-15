/**
 * `ethexe:wallet *` — manage V3 (Ethereum) keystores under `~/.vara-wallet/wallets/*.ethexe.json`.
 *
 * Commands:
 *   ethexe:wallet create <name>           — generate a new mnemonic + keystore
 *   ethexe:wallet import <name>           — import from --mnemonic / --private-key
 *   ethexe:wallet list                    — list ethexe wallets
 *   ethexe:wallet show <name>             — show address + keystore metadata (no secrets)
 *   ethexe:wallet keys <name>             — decrypt + print raw private key (DANGEROUS)
 */

import { Command } from 'commander';

import {
  DEFAULT_ETH_HD_PATH,
  decryptKeystore,
  deriveAddressFromPrivateKey,
  deriveEthereumKey,
  encryptKeystore,
  ethexeWalletExists,
  generateMnemonic,
  isValidMnemonic,
  listEthexeWallets,
  loadEthexeWallet,
  migrateVaraWalletSuffix,
  saveEthexeWallet,
} from '../shared/keyring-eth';
import { CliError } from '../utils/errors';
import { output, verbose } from '../utils/output';

interface CreateOptions {
  passphrase?: string;
  path?: string;
}

interface ImportOptions {
  mnemonic?: string;
  privateKey?: string;
  passphrase?: string;
  path?: string;
}

function requirePassphrase(opts: { passphrase?: string }): string {
  const fromOpts = opts.passphrase;
  const fromEnv = process.env.VARA_PASSPHRASE;
  const passphrase = fromOpts ?? fromEnv;
  if (!passphrase) {
    throw new CliError('Ethexe wallets require a passphrase. Set --passphrase or VARA_PASSPHRASE.', 'NO_PASSPHRASE');
  }
  return passphrase;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64) throw new CliError('Private key must be 32 bytes (64 hex chars)', 'INVALID_PRIVATE_KEY');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export function registerEthexeWalletCommand(program: Command): void {
  const wallet = program.command('ethexe:wallet').description('Manage ethexe (V3 Ethereum) keystores');

  wallet
    .command('create <name>')
    .description('Generate a new mnemonic + V3 keystore for ethexe')
    .option('--passphrase <pass>', 'passphrase to encrypt the keystore')
    .option('--path <hdPath>', `BIP44 path (default: ${DEFAULT_ETH_HD_PATH})`)
    .action(async (name: string, options: CreateOptions) => {
      if (ethexeWalletExists(name)) {
        throw new CliError(`Ethexe wallet "${name}" already exists`, 'WALLET_EXISTS', { name });
      }
      const passphrase = requirePassphrase(options);
      migrateVaraWalletSuffix();

      const mnemonic = generateMnemonic();
      const path = options.path ?? DEFAULT_ETH_HD_PATH;
      const privateKey = deriveEthereumKey(mnemonic, path);
      const address = await deriveAddressFromPrivateKey(privateKey);
      verbose(`Generated mnemonic at ${path} → ${address}`);

      const keystore = await encryptKeystore(privateKey, passphrase, { address });
      const filePath = saveEthexeWallet(name, keystore);

      output({
        name,
        address,
        path: filePath,
        hdPath: path,
        mnemonic,
        warning: 'Record the mnemonic — it is the only way to recover the key. It will not be shown again.',
      });
    });

  wallet
    .command('import <name>')
    .description('Import an existing ethexe key from mnemonic or raw private key')
    .option('--mnemonic <phrase>', 'BIP39 mnemonic')
    .option('--private-key <hex>', '32-byte secp256k1 key as 0x-hex')
    .option('--passphrase <pass>', 'passphrase to encrypt the keystore')
    .option('--path <hdPath>', `BIP44 path for mnemonic (default: ${DEFAULT_ETH_HD_PATH})`)
    .action(async (name: string, options: ImportOptions) => {
      if (ethexeWalletExists(name)) {
        throw new CliError(`Ethexe wallet "${name}" already exists`, 'WALLET_EXISTS', { name });
      }
      if (!options.mnemonic && !options.privateKey) {
        throw new CliError('Either --mnemonic or --private-key is required.', 'MISSING_KEY_SOURCE');
      }
      if (options.mnemonic && options.privateKey) {
        throw new CliError('--mnemonic and --private-key are mutually exclusive.', 'CONFLICTING_KEY_SOURCES');
      }
      const passphrase = requirePassphrase(options);
      migrateVaraWalletSuffix();

      let privateKey: Uint8Array;
      let hdPath: string | undefined;
      if (options.mnemonic) {
        if (!isValidMnemonic(options.mnemonic)) {
          throw new CliError('Invalid BIP39 mnemonic.', 'INVALID_MNEMONIC');
        }
        hdPath = options.path ?? DEFAULT_ETH_HD_PATH;
        privateKey = deriveEthereumKey(options.mnemonic, hdPath);
      } else {
        privateKey = hexToBytes(options.privateKey!);
      }

      const address = await deriveAddressFromPrivateKey(privateKey);
      const keystore = await encryptKeystore(privateKey, passphrase, { address });
      const filePath = saveEthexeWallet(name, keystore);

      output({
        name,
        address,
        path: filePath,
        hdPath: hdPath ?? null,
        source: options.mnemonic ? 'mnemonic' : 'private-key',
      });
    });

  wallet
    .command('list')
    .description('List all ethexe wallets')
    .action(() => {
      migrateVaraWalletSuffix();
      const wallets = listEthexeWallets();
      if (wallets.length === 0) {
        output({ wallets: [], message: 'No ethexe wallets. Create one with "ethexe:wallet create <name>".' });
        return;
      }
      const rows = wallets.map((name) => {
        const ks = loadEthexeWallet(name);
        return { name, address: `0x${ks.address}`, kdf: ks.crypto.kdf, n: ks.crypto.kdfparams.n };
      });
      output({ wallets: rows });
    });

  wallet
    .command('show <name>')
    .description('Show the address + keystore metadata of an ethexe wallet (no secrets)')
    .action((name: string) => {
      const ks = loadEthexeWallet(name);
      output({
        name,
        address: `0x${ks.address}`,
        version: ks.version,
        id: ks.id,
        kdf: ks.crypto.kdf,
        cipher: ks.crypto.cipher,
        scryptN: ks.crypto.kdfparams.n,
      });
    });

  wallet
    .command('keys <name>')
    .description('Decrypt and print the raw private key (DANGEROUS — for export/recovery only)')
    .option('--passphrase <pass>', 'passphrase for the keystore')
    .action(async (name: string, options: { passphrase?: string }) => {
      const passphrase = requirePassphrase(options);
      const ks = loadEthexeWallet(name);
      const privateKey = await decryptKeystore(ks, passphrase);
      output({
        name,
        address: `0x${ks.address}`,
        privateKey: '0x' + Buffer.from(privateKey).toString('hex'),
        warning: 'Treat this value as a credential — anyone with it can spend your funds.',
      });
    });
}
