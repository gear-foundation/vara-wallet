/**
 * vara-eth:inheritor — recover locked value from an exited Mirror program.
 *
 * NOTE: `transferLockedValueToInheritor()` is not exposed by the MirrorClient in
 * @vara-eth/api@0.5.0-rc.0 (the vendored lib), but the function exists in the
 * Mirror.sol ABI.  We call it directly via viem's encodeFunctionData +
 * signer.sendTransaction to avoid depending on a higher version of the lib.
 */

import { Command } from 'commander';
import { encodeFunctionData, isAddressEqual, zeroAddress, type Address } from 'viem';

import { getEthexeApi, getMirrorClient } from '../services/vara-eth/api';
import { resolveEthexeSigner } from '../services/vara-eth/account';
import { asAddress } from '../utils/eth-types';
import { CliError } from '../utils/errors';
import { output } from '../utils/output';

/** Minimal ABI fragment for the transferLockedValueToInheritor function. */
const TRANSFER_LOCKED_VALUE_ABI = [
  {
    type: 'function' as const,
    name: 'transferLockedValueToInheritor',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable' as const,
  },
] as const;

interface RecoverOptions {
  account?: string;
  passphrase?: string;
}

export function registerVaraEthInheritorCommand(program: Command): void {
  const inheritor = program
    .command('vara-eth:inheritor')
    .description('Inheritor-chain recovery for exited Vara.eth programs');

  inheritor
    .command('recover <mirror>')
    .description('Transfer locked value from an exited Mirror program to its inheritor')
    .option('--account <name>', 'Vara.eth wallet name')
    .option('--passphrase <pass>', 'wallet passphrase')
    .action(async (mirrorArg: string, _options: RecoverOptions, cmd: Command) => {
      const opts = cmd.optsWithGlobals() as RecoverOptions;
      const mirrorAddress = asAddress(mirrorArg, 'mirror');

      const api = await getEthexeApi();
      const signer = await resolveEthexeSigner(api.eth.publicClient, {
        account: opts.account,
        passphrase: opts.passphrase,
      });

      // Read the mirror state — check inheritor is set.
      const mirrorClient = await getMirrorClient(mirrorAddress, signer);
      const inheritorAddress: Address = await mirrorClient.inheritor();

      if (isAddressEqual(inheritorAddress, zeroAddress)) {
        throw new CliError(
          `Mirror "${mirrorAddress}" has no inheritor set. Only programs that called gr_exit with an inheritor address can use this recovery path.`,
          'NO_INHERITOR',
          { mirror: mirrorAddress },
        );
      }

      // Call transferLockedValueToInheritor via the raw signer — the method
      // is not wrapped by MirrorClient in the vendored lib version.
      const data = encodeFunctionData({
        abi: TRANSFER_LOCKED_VALUE_ABI,
        functionName: 'transferLockedValueToInheritor',
      });

      const txHash = await signer.sendTransaction({ to: mirrorAddress, data });

      // Wait for the receipt to confirm the transfer succeeded.
      const receipt = await api.eth.publicClient.waitForTransactionReceipt({ hash: txHash });

      output({
        chain: 'vara-eth',
        display: 'Vara.eth',
        mirror: mirrorAddress,
        txHash: receipt.transactionHash,
        recoveredTo: inheritorAddress,
      });
    });
}
