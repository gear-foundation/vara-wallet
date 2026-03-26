import { Command } from 'commander';
import { u8aToHex, hexToU8a, stringToU8a } from '@polkadot/util';
import { signatureVerify } from '@polkadot/util-crypto';
import { resolveAccount, resolveAddress, AccountOptions } from '../services/account';
import { output, verbose, CliError } from '../utils';

function parseData(data: string, hex?: boolean): Uint8Array {
  if (hex) {
    if (!data.startsWith('0x')) {
      throw new CliError('Hex data must be 0x-prefixed', 'INVALID_HEX');
    }
    try {
      return hexToU8a(data);
    } catch {
      throw new CliError(`Invalid hex data: "${data}"`, 'INVALID_HEX');
    }
  }
  return stringToU8a(data);
}

export function registerSignCommand(program: Command): void {
  program
    .command('sign')
    .description('Sign arbitrary data with the configured account key (raw sr25519, no <Bytes> wrapping)')
    .argument('<data>', 'data to sign (UTF-8 string, or hex bytes with --hex)')
    .option('--hex', 'treat <data> as 0x-prefixed hex-encoded bytes')
    .action(async (data: string, options: { hex?: boolean }) => {
      const opts = program.optsWithGlobals() as AccountOptions;
      const account = await resolveAccount(opts);
      const message = parseData(data, options.hex);

      verbose(`Signing ${message.length} bytes with account ${account.address}`);
      const signature = account.sign(message);

      output({
        signature: u8aToHex(signature),
        publicKey: u8aToHex(account.publicKey),
        address: account.address,
      });
    });

  program
    .command('verify')
    .description('Verify a signature against data and address (raw sr25519)')
    .argument('<data>', 'original data (UTF-8 string, or hex bytes with --hex)')
    .argument('<signature>', 'signature to verify (0x-prefixed hex)')
    .option('--hex', 'treat <data> as 0x-prefixed hex-encoded bytes')
    .option('--address <address>', 'signer address (SS58 or hex); defaults to configured account')
    .action(async (data: string, signature: string, options: { hex?: boolean; address?: string }) => {
      const opts = program.optsWithGlobals() as AccountOptions;
      const message = parseData(data, options.hex);

      if (!signature.startsWith('0x')) {
        throw new CliError('Signature must be 0x-prefixed hex', 'INVALID_SIGNATURE_FORMAT');
      }

      if (!options.address) {
        verbose('No --address specified, verifying against own account');
      }

      const address = await resolveAddress(options.address, opts);

      let result;
      try {
        result = signatureVerify(message, signature, address);
      } catch {
        throw new CliError('Invalid signature: malformed or wrong length', 'INVALID_SIGNATURE');
      }

      output({
        isValid: result.isValid,
        address: address,
        cryptoType: result.crypto,
      });
    });
}
