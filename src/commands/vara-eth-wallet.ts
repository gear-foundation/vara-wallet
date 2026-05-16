import { Command } from 'commander';
import { bytesToHex, hexToBytes } from 'viem';

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

function privateKeyHexToBytes(hex: string): Uint8Array {
  const prefixed = hex.startsWith('0x') ? hex : `0x${hex}`;
  const bytes = hexToBytes(prefixed as `0x${string}`);
  if (bytes.length !== 32) throw new CliError('Private key must be 32 bytes (64 hex chars)', 'INVALID_PRIVATE_KEY');
  return bytes;
}

export function registerVaraEthWalletCommand(program: Command): void {
  const wallet = program.command('vara-eth:wallet').description('Manage Vara.eth (V3 Ethereum) keystores');

  wallet
    .command('create <name>')
    .description('Generate a new mnemonic + V3 keystore for Vara.eth')
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
      const address = deriveAddressFromPrivateKey(privateKey);
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
    .description('Import an existing Vara.eth key from mnemonic or raw private key')
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
        privateKey = privateKeyHexToBytes(options.privateKey!);
      }

      const address = deriveAddressFromPrivateKey(privateKey);
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
    .description('List all Vara.eth wallets')
    .action(() => {
      migrateVaraWalletSuffix();
      const wallets = listEthexeWallets();
      if (wallets.length === 0) {
        output({ wallets: [], message: 'No Vara.eth wallets. Create one with "vara-eth:wallet create <name>".' });
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
    .description('Show the address + keystore metadata of a Vara.eth wallet (no secrets)')
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
        privateKey: bytesToHex(privateKey),
        warning: 'Treat this value as a credential — anyone with it can spend your funds.',
      });
    });
}
