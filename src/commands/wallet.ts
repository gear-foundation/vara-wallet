import { Command } from 'commander';
import { GearKeyring } from '@gear-js/api';
import { u8aToHex } from '@polkadot/util';
import { saveWallet, loadWallet, listWallets, exportWallet, isEncrypted, readPassphraseFile, ensurePassphraseFile } from '../services/wallet-store';
import { resolvePassphrase } from '../services/account';
import { readConfig, updateConfig } from '../services/config';
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
  listLegacyVaraWalletNames,
  loadEthexeWallet,
  saveEthexeWallet,
} from '../shared/keyring-eth';
import { WrongPassphraseError } from '../shared/errors-eth';
import { resolveEthexePassphrase } from '../services/vara-eth/account';
import { resolveActiveChain } from '../utils/active-chain';
import { output, verbose, CliError } from '../utils';
import { bytesToHex, hexToBytes } from 'viem';

export function registerWalletCommand(program: Command): void {
  const wallet = program.command('wallet').description('Manage wallets');

  wallet
    .command('create')
    .description('Create a new wallet')
    .option('--name <name>', 'wallet name', 'default')
    .option('--passphrase <passphrase>', 'passphrase to encrypt the wallet')
    .option('--no-encrypt', 'create unencrypted wallet (not recommended)')
    .option('--show-secret', 'include mnemonic and seed in output')
    .option('--path <hdPath>', `Vara.eth BIP44 path (default: ${DEFAULT_ETH_HD_PATH})`)
    .action(async (options: { name: string; passphrase?: string; encrypt: boolean; showSecret?: boolean; path?: string }, command: Command) => {
      const allOpts = { ...options, ...command.optsWithGlobals() } as typeof options;
      if (resolveActiveChain(wallet) === 'vara-eth') {
        if (!allOpts.encrypt) {
          throw new CliError('Vara.eth wallets are always encrypted', 'UNSUPPORTED_CHAIN_OPTION');
        }
        await createVaraEthWallet(allOpts);
        return;
      }

      verbose(`Creating wallet "${allOpts.name}"`);

      let passphrase: string | undefined;
      if (allOpts.encrypt) {
        passphrase = resolveNewWalletPassphrase(allOpts.passphrase);
      }

      const result = await GearKeyring.create(allOpts.name, passphrase);
      const filePath = saveWallet(allOpts.name, result.json);

      const out: Record<string, unknown> = {
        address: result.keyring.address,
        name: allOpts.name,
        encrypted: allOpts.encrypt,
        path: filePath,
      };

      if (allOpts.showSecret) {
        out.mnemonic = result.mnemonic;
        out.seed = result.seed;
      }

      output(out);
    });

  wallet
    .command('import')
    .description('Import a wallet from mnemonic, seed, or JSON keystore')
    .option('--name <name>', 'wallet name', 'imported')
    .option('--mnemonic <mnemonic>', 'mnemonic phrase')
    .option('--seed <seed>', 'seed (hex or SURI like //Alice)')
    .option('--json <path>', 'path to JSON keystore file')
    .option('--private-key <hex>', 'Vara.eth 32-byte secp256k1 private key as 0x-hex')
    .option('--passphrase <passphrase>', 'passphrase to encrypt the imported wallet')
    .option('--no-encrypt', 'store unencrypted (not recommended)')
    .option('--path <hdPath>', `Vara.eth BIP44 path for mnemonic (default: ${DEFAULT_ETH_HD_PATH})`)
    .action(async (options: { name: string; mnemonic?: string; seed?: string; json?: string; privateKey?: string; passphrase?: string; encrypt: boolean; path?: string }, command: Command) => {
      // Merge with global opts so --seed/--mnemonic work regardless of which
      // Commander level parsed them (global program vs. subcommand).
      const allOpts = command.optsWithGlobals() as typeof options;
      if (resolveActiveChain(command) === 'vara-eth') {
        if (!allOpts.encrypt) {
          throw new CliError('Vara.eth wallets are always encrypted', 'UNSUPPORTED_CHAIN_OPTION');
        }
        await importVaraEthWallet(allOpts);
        return;
      }

      let keyring;

      if (allOpts.mnemonic) {
        keyring = await GearKeyring.fromMnemonic(allOpts.mnemonic, allOpts.name);
      } else if (allOpts.seed) {
        keyring = await GearKeyring.fromSuri(allOpts.seed, allOpts.name);
      } else if (allOpts.json) {
        const fs = await import('fs');
        const raw = fs.readFileSync(allOpts.json, 'utf-8');
        const jsonData = JSON.parse(raw);
        const importPassphrase = allOpts.passphrase || readPassphraseFile() || process.env.VARA_PASSPHRASE || undefined;
        try {
          keyring = GearKeyring.fromJson(jsonData, importPassphrase);
        } catch {
          throw new CliError(
            'Failed to decrypt imported JSON. The file may use a different passphrase.',
            'IMPORT_DECRYPT_FAILED',
          );
        }
      } else {
        throw new CliError(
          'Provide --mnemonic, --seed, or --json to import a wallet',
          'MISSING_IMPORT_SOURCE',
        );
      }

      let passphrase: string | undefined;
      if (allOpts.encrypt) {
        passphrase = resolveNewWalletPassphrase(allOpts.passphrase);
      }

      const json = keyring.toJson(passphrase);
      const filePath = saveWallet(allOpts.name, json);

      output({
        address: keyring.address,
        name: allOpts.name,
        encrypted: allOpts.encrypt,
        path: filePath,
      });
    });

  wallet
    .command('list')
    .description('List all wallets')
    .action(() => {
      if (hasExplicitChainOption(wallet) && resolveActiveChain(wallet) === 'vara-eth') {
        const config = readConfig();
        const wallets = listVaraEthWalletRows(config.defaultVaraEthAccount);
        output({ wallets, legacyWallets: listLegacyVaraWalletNames(), defaultAccount: config.defaultVaraEthAccount ?? null });
        return;
      }

      const config = readConfig();
      const nativeWallets = listWallets(config.defaultAccount);

      if (hasExplicitChainOption(wallet)) {
        output(nativeWallets);
        return;
      }

      output([
        ...nativeWallets.map((walletInfo) => ({ chain: 'vara' as const, ...walletInfo })),
        ...listVaraEthWalletRows(config.defaultVaraEthAccount).map((walletInfo) => ({
          chain: 'vara-eth' as const,
          name: walletInfo.name,
          address: walletInfo.address,
          isDefault: walletInfo.default,
          encrypted: true,
          kdf: walletInfo.kdf,
        })),
      ]);
    });

  wallet
    .command('export')
    .description('Export a wallet as JSON keystore')
    .argument('<name>', 'wallet name')
    .option('--decrypt', 'export decrypted JSON (exposes private key)')
    .option('--output <path>', 'save JSON to file instead of stdout')
    .action(async (name: string, options: { decrypt?: boolean; output?: string }) => {
      if (resolveActiveChain(wallet) === 'vara-eth') {
        const json = loadEthexeWallet(name);
        if (options.decrypt) {
          throw new CliError('Use "wallet keys" to export Vara.eth private key material', 'UNSUPPORTED_CHAIN_OPTION');
        }
        if (options.output) {
          const fs = await import('fs');
          const path = await import('path');
          const resolved = path.resolve(options.output);
          fs.writeFileSync(resolved, JSON.stringify(json, null, 2) + '\n', { mode: 0o600 });
          output({ path: resolved, encrypted: true });
          return;
        }
        output(json);
        return;
      }

      const json = exportWallet(name);

      let result = json;
      if (options.decrypt && isEncrypted(json)) {
        const passphrase = resolvePassphrase();
        if (!passphrase) {
          throw new CliError(
            `Wallet "${name}" is encrypted. Create ~/.vara-wallet/.passphrase or set VARA_PASSPHRASE to decrypt.`,
            'PASSPHRASE_REQUIRED',
          );
        }
        try {
          const keyring = GearKeyring.fromJson(json, passphrase);
          result = keyring.toJson();
        } catch {
          throw new CliError(
            `Failed to decrypt wallet "${name}". Check your passphrase.`,
            'DECRYPT_FAILED',
          );
        }
      }

      if (options.output) {
        const fs = await import('fs');
        const path = await import('path');
        const resolved = path.resolve(options.output);
        fs.writeFileSync(resolved, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
        output({ path: resolved, encrypted: isEncrypted(result) });
        return;
      }

      output(result);
    });

  wallet
    .command('keys')
    .description('Export raw key material from a wallet (exposes secret key)')
    .argument('<name>', 'wallet name')
    .action(async (name: string, _options: unknown, command: Command) => {
      const allOpts = command.optsWithGlobals() as { passphrase?: string };
      if (resolveActiveChain(wallet) === 'vara-eth') {
        await exportVaraEthPrivateKey(name, allOpts);
        return;
      }

      const json = loadWallet(name);
      const passphrase = isEncrypted(json) ? resolvePassphrase() : undefined;

      if (isEncrypted(json) && !passphrase) {
        throw new CliError(
          `Wallet "${name}" is encrypted. Create ~/.vara-wallet/.passphrase or set VARA_PASSPHRASE to decrypt.`,
          'PASSPHRASE_REQUIRED',
        );
      }

      let keyring;
      try {
        keyring = GearKeyring.fromJson(json, passphrase);
      } catch {
        throw new CliError(
          `Failed to decrypt wallet "${name}". Check your passphrase.`,
          'DECRYPT_FAILED',
        );
      }

      // encodePkcs8() without passphrase returns the raw PKCS8-encoded keypair
      // which contains the full secret key (miniSecretKey + public key)
      const pkcs8 = keyring.encodePkcs8();

      output({
        address: keyring.address,
        publicKey: u8aToHex(keyring.publicKey),
        secretKeyPkcs8: u8aToHex(pkcs8),
        type: keyring.type,
      });
    });

  wallet
    .command('default')
    .description('Get or set the default wallet')
    .argument('[name]', 'wallet name to set as default')
    .action((name?: string) => {
      if (resolveActiveChain(wallet) === 'vara-eth') {
        if (name) {
          const json = loadEthexeWallet(name);
          updateConfig({ defaultVaraEthAccount: name });
          verbose(`Default Vara.eth wallet set to "${name}"`);
          output({ name, address: `0x${json.address}`, status: 'set' });
        } else {
          const config = readConfig();
          if (!config.defaultVaraEthAccount) {
            throw new CliError('No default Vara.eth account configured', 'NO_DEFAULT');
          }
          const json = loadEthexeWallet(config.defaultVaraEthAccount);
          output({
            name: config.defaultVaraEthAccount,
            address: `0x${json.address}`,
          });
        }
        return;
      }

      if (name) {
        // Verify wallet exists by loading it
        loadWallet(name);
        updateConfig({ defaultAccount: name });
        verbose(`Default wallet set to "${name}"`);
        output({ name, status: 'set' });
      } else {
        const config = readConfig();
        if (!config.defaultAccount) {
          throw new CliError('No default account configured', 'NO_DEFAULT');
        }
        const json = loadWallet(config.defaultAccount);
        output({
          name: config.defaultAccount,
          address: json.address,
        });
      }
    });
}

async function createVaraEthWallet(options: { name: string; passphrase?: string; showSecret?: boolean; path?: string }): Promise<void> {
  verbose(`Creating Vara.eth wallet "${options.name}"`);
  if (ethexeWalletExists(options.name)) {
    throw new CliError(`Vara.eth wallet "${options.name}" already exists`, 'WALLET_EXISTS', { name: options.name });
  }

  const passphrase = resolveNewWalletPassphrase(options.passphrase);
  const mnemonic = generateMnemonic();
  const hdPath = options.path ?? DEFAULT_ETH_HD_PATH;
  const privateKey = deriveEthereumKey(mnemonic, hdPath);
  const address = deriveAddressFromPrivateKey(privateKey);
  const keystore = await encryptKeystore(privateKey, passphrase, { address });
  const filePath = saveEthexeWallet(options.name, keystore);

  const out: Record<string, unknown> = {
    address,
    name: options.name,
    encrypted: true,
    path: filePath,
    hdPath,
  };
  if (options.showSecret) {
    out.mnemonic = mnemonic;
    out.privateKey = bytesToHex(privateKey);
  }
  output(out);
}

async function importVaraEthWallet(options: {
  name: string;
  mnemonic?: string;
  privateKey?: string;
  seed?: string;
  json?: string;
  passphrase?: string;
  path?: string;
}): Promise<void> {
  if (ethexeWalletExists(options.name)) {
    throw new CliError(`Vara.eth wallet "${options.name}" already exists`, 'WALLET_EXISTS', { name: options.name });
  }
  if (options.json || options.seed) {
    throw new CliError('--chain vara-eth wallet import supports --mnemonic or --private-key', 'UNSUPPORTED_CHAIN_OPTION');
  }
  if (!options.mnemonic && !options.privateKey) {
    throw new CliError('Provide --mnemonic or --private-key to import a Vara.eth wallet', 'MISSING_IMPORT_SOURCE');
  }
  if (options.mnemonic && options.privateKey) {
    throw new CliError('--mnemonic and --private-key are mutually exclusive', 'CONFLICTING_KEY_SOURCES');
  }

  let privateKey: Uint8Array;
  let hdPath: string | undefined;
  if (options.mnemonic) {
    if (!isValidMnemonic(options.mnemonic)) {
      throw new CliError('Invalid BIP39 mnemonic.', 'INVALID_MNEMONIC');
    }
    hdPath = options.path ?? DEFAULT_ETH_HD_PATH;
    privateKey = deriveEthereumKey(options.mnemonic, hdPath);
  } else {
    const prefixed = options.privateKey!.startsWith('0x') ? options.privateKey! : `0x${options.privateKey}`;
    privateKey = hexToBytes(prefixed as `0x${string}`);
    if (privateKey.length !== 32) {
      throw new CliError('Private key must be 32 bytes (64 hex chars)', 'INVALID_PRIVATE_KEY');
    }
  }

  const passphrase = resolveNewWalletPassphrase(options.passphrase);
  const address = deriveAddressFromPrivateKey(privateKey);
  const keystore = await encryptKeystore(privateKey, passphrase, { address });
  const filePath = saveEthexeWallet(options.name, keystore);

  output({
    address,
    name: options.name,
    encrypted: true,
    path: filePath,
    hdPath: hdPath ?? null,
  });
}

async function exportVaraEthPrivateKey(name: string, options: { passphrase?: string } = {}): Promise<void> {
  const json = loadEthexeWallet(name);
  const { passphrase, source } = resolveEthexePassphrase(name, options.passphrase);
  try {
    const privateKey = await decryptKeystore(json, passphrase);
    output({
      name,
      address: `0x${json.address}`,
      privateKey: bytesToHex(privateKey),
      type: 'secp256k1',
    });
  } catch {
    throw new WrongPassphraseError(name, source);
  }
}

function resolveNewWalletPassphrase(explicit?: string): string {
  return explicit || readPassphraseFile() || process.env.VARA_PASSPHRASE || ensurePassphraseFile();
}

function hasExplicitChainOption(command: Command): boolean {
  let current: Command | undefined = command;
  while (current) {
    if (current.getOptionValueSource?.('chain') === 'cli') return true;
    current = current.parent ?? undefined;
  }
  return false;
}

function listVaraEthWalletRows(defaultAccount?: string): Array<{
  name: string;
  address: `0x${string}`;
  default: boolean;
  kdf: string;
}> {
  return listEthexeWallets().map((name) => {
    const ks = loadEthexeWallet(name);
    return {
      name,
      address: `0x${ks.address}`,
      default: defaultAccount === name,
      kdf: ks.crypto.kdf,
    };
  });
}
