import { Command } from 'commander';

import { getEthexeApi, getMirrorClient } from '../services/ethexe/api';
import { resolveEthexeSigner } from '../services/ethexe/account';
import { asAddress, asHex } from '../utils/eth-types';
import { output } from '../utils/output';

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

      const mirrorClient = await getMirrorClient(mirror, signer);
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
