/**
 * `ethexe:mailbox claim <mirror> <claimedId>` — claim a value entry from the
 * Mirror contract's mailbox-equivalent.
 */

import { Command } from 'commander';
import type { Address, Hex } from 'viem';

import { getEthexeApi } from '../services/ethexe/api';
import { resolveEthexeSigner } from '../services/ethexe/account';
import { CliError } from '../utils/errors';
import { output } from '../utils/output';

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

export function registerEthexeMailboxCommand(program: Command): void {
  const mailbox = program.command('ethexe:mailbox').description('Mailbox operations on the ethexe rail');

  mailbox
    .command('claim <mirror> <claimedId>')
    .description('Claim a value entry from the Mirror mailbox')
    .option('--account <name>', 'ethexe wallet name')
    .option('--passphrase <pass>', 'wallet passphrase')
    .action(async (mirrorArg: string, claimedIdArg: string, options: { account?: string; passphrase?: string }) => {
      const mirror = asAddress(mirrorArg, 'mirror');
      const claimedId = asHex(claimedIdArg, 'claimedId');

      const api = await getEthexeApi();
      const signer = await resolveEthexeSigner(api.eth.publicClient, options);
      api.eth.setSigner(signer);

      const mirrorClient = (await import('@vara-eth/api')).getMirrorClient({
        address: mirror,
        publicClient: api.eth.publicClient,
        signer,
      });
      const tx = await mirrorClient.claimValue(claimedId);
      const [receipt, event] = await Promise.all([tx.getReceipt(), tx.getValueClaimingRequestedEvent()]);

      output({
        mirror,
        claimedId,
        txHash: receipt.transactionHash,
        blockNumber: Number(receipt.blockNumber),
        status: receipt.status,
        event: { source: event.source, claimedId: event.claimedId },
      });
    });
}
