import { Command } from 'commander';

import { getEthexeApi, getMirrorClient } from '../services/vara-eth/api';
import { resolveEthexeSigner } from '../services/vara-eth/account';
import { asAddress, asHex } from '../utils/eth-types';
import { output } from '../utils/output';

export function registerVaraEthMailboxCommand(program: Command): void {
  const mailbox = program.command('vara-eth:mailbox').description('Mailbox operations on the Vara.eth rail');

  mailbox
    .command('claim <mirror> <claimedId>')
    .description('Claim a value entry from the Mirror mailbox')
    .option('--account <name>', 'Vara.eth wallet name')
    .option('--passphrase <pass>', 'wallet passphrase')
    .action(async (
      mirrorArg: string,
      claimedIdArg: string,
      _options: { account?: string; passphrase?: string },
      cmd: Command,
    ) => {
      const opts = cmd.optsWithGlobals() as { account?: string; passphrase?: string };
      const mirror = asAddress(mirrorArg, 'mirror');
      const claimedId = asHex(claimedIdArg, 'claimedId');

      const api = await getEthexeApi();
      const signer = await resolveEthexeSigner(api.eth.publicClient, opts);
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
