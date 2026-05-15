/**
 * `ethexe:program deploy` — upload WASM and create a program.
 * `ethexe:program top-up`  — top up a program's executable balance.
 */

import { readFileSync } from 'node:fs';
import { Command } from 'commander';

import { getEthexeApi, getMirrorClient } from '../services/ethexe/api';
import { resolveEthexeSigner } from '../services/ethexe/account';
import { asAddress, asHex } from '../utils/eth-types';
import { output } from '../utils/output';

interface DeployOptions {
  salt?: string;
  executableBalance?: string;
  abiInterface?: string;
  account?: string;
  passphrase?: string;
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

      const mirrorClient = await getMirrorClient(mirror, signer);
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
