/**
 * `ethexe:program upload`, `ethexe:program deploy`, `ethexe:program top-up`
 *
 * Phase 3b commands — wired against `api.programs.deploy` for the combined
 * upload+deploy flow.
 */

import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import type { Address, Hex } from 'viem';

import { getEthexeApi } from '../services/ethexe/api';
import { resolveEthexeSigner } from '../services/ethexe/account';
import { CliError } from '../utils/errors';
import { output } from '../utils/output';

interface DeployOptions {
  salt?: string;
  executableBalance?: string;
  abiInterface?: string;
  account?: string;
  passphrase?: string;
}

function asAddress(value: string, field: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new CliError(`${field} must be a 20-byte 0x-prefixed address`, 'INVALID_ADDRESS', { field, value });
  }
  return value as Address;
}

function asHex(value: string, field: string): Hex {
  if (!/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new CliError(`${field} must be a 0x-prefixed hex string`, 'INVALID_HEX', { field, value });
  }
  return value as Hex;
}

export function registerEthexeProgramCommand(program: Command): void {
  const cmd = program.command('ethexe:program').description('Upload code and deploy programs on the ethexe rail');

  cmd
    .command('deploy <wasmPath>')
    .description('Upload WASM code (if needed) and create a program in one ceremony')
    .option('--salt <hex>', '32-byte salt for unique program-id derivation')
    .option('--executable-balance <wei>', 'top up executable balance in init')
    .option('--abi-interface <address>', 'ABI interface contract address')
    .option('--account <name>', 'ethexe wallet name')
    .option('--passphrase <pass>', 'wallet passphrase')
    .action(async (wasmPath: string, options: DeployOptions) => {
      const code = readFileSync(wasmPath);

      const api = await getEthexeApi();
      const signer = await resolveEthexeSigner(api.eth.publicClient, options);
      api.eth.setSigner(signer);

      const result = await api.programs.deploy(new Uint8Array(code), {
        salt: options.salt ? asHex(options.salt, '--salt') : undefined,
        executableBalance: options.executableBalance ? BigInt(options.executableBalance) : undefined,
        abiInterface: options.abiInterface ? asAddress(options.abiInterface, '--abi-interface') : undefined,
      });

      output({
        codeId: result.codeId,
        programAddress: result.programAddress,
        codeValidationTxHash: result.codeValidationReceipt.transactionHash,
        deploymentTxHash: result.deploymentReceipt.transactionHash,
        codeValidationBlock: Number(result.codeValidationReceipt.blockNumber),
        deploymentBlock: Number(result.deploymentReceipt.blockNumber),
      });
    });

  cmd
    .command('top-up <mirror>')
    .description('Top up the executable balance of a program (sender pays in WVARA)')
    .requiredOption('--amount <wei>', 'amount in WVARA wei')
    .option('--account <name>', 'ethexe wallet name')
    .option('--passphrase <pass>', 'wallet passphrase')
    .action(async (mirrorArg: string, options: { amount: string; account?: string; passphrase?: string }) => {
      const mirror = asAddress(mirrorArg, 'mirror');
      const amount = BigInt(options.amount);

      const api = await getEthexeApi();
      const signer = await resolveEthexeSigner(api.eth.publicClient, options);
      api.eth.setSigner(signer);

      const mirrorClient = (await import('@vara-eth/api')).getMirrorClient({
        address: mirror,
        publicClient: api.eth.publicClient,
        signer,
      });
      const tx = await mirrorClient.executableBalanceTopUp(amount);
      const receipt = await tx.getReceipt();

      output({
        mirror,
        amount: amount.toString(),
        txHash: receipt.transactionHash,
        blockNumber: Number(receipt.blockNumber),
        status: receipt.status,
      });
    });
}
