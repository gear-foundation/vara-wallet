import { Command } from 'commander';

import { getEthexeApi } from '../services/vara-eth/api';
import { resolveEthexeSigner } from '../services/vara-eth/account';
import { asAddress, parseOptionalBigInt } from '../utils/eth-types';
import { CliError } from '../utils/errors';
import { output } from '../utils/output';

interface AccountOptions {
  account?: string;
  passphrase?: string;
}

interface PermitOptions extends AccountOptions {
  deadline?: string;
}

function parseBigIntArg(raw: string, field: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new CliError(`${field} must be an integer (wei-equivalent bigint)`, 'INVALID_BIGINT', {
      field,
      value: raw,
    });
  }
}

export function registerVaraEthWvaraCommand(program: Command): void {
  const wvara = program.command('vara-eth:wvara').description('WVARA ERC-20 operations on the Vara.eth rail');

  wvara
    .command('balance <address>')
    .description('Query WVARA balance for an Ethereum address')
    .action(async (addressArg: string) => {
      const address = asAddress(addressArg, 'address');
      const api = await getEthexeApi();
      const balance = await api.eth.wvara.balanceOf(address);
      output({
        chain: 'vara-eth',
        display: 'Vara.eth',
        address,
        balance: balance.toString(),
        raw: `0x${balance.toString(16)}`,
      });
    });

  wvara
    .command('transfer <to> <amount>')
    .description('Transfer WVARA to another address (amount in raw integer units)')
    .option('--account <name>', 'Vara.eth wallet name')
    .option('--passphrase <pass>', 'wallet passphrase')
    .action(async (toArg: string, amountArg: string, options: AccountOptions) => {
      const to = asAddress(toArg, 'to');
      const amount = parseBigIntArg(amountArg, 'amount');

      const api = await getEthexeApi();
      const signer = await resolveEthexeSigner(api.eth.publicClient, {
        account: options.account,
        passphrase: options.passphrase,
      });
      api.eth.setSigner(signer);

      const from = await signer.getAddress();
      const txManager = await api.eth.wvara.transfer(to, amount);
      const receipt = await txManager.sendAndWaitForReceipt();

      output({
        chain: 'vara-eth',
        display: 'Vara.eth',
        txHash: receipt.transactionHash,
        from,
        to,
        amount: amount.toString(),
      });
    });

  wvara
    .command('approve <spender> <amount>')
    .description('Approve a spender to transfer WVARA on your behalf (amount in raw integer units)')
    .option('--account <name>', 'Vara.eth wallet name')
    .option('--passphrase <pass>', 'wallet passphrase')
    .action(async (spenderArg: string, amountArg: string, options: AccountOptions) => {
      const spender = asAddress(spenderArg, 'spender');
      const amount = parseBigIntArg(amountArg, 'amount');

      const api = await getEthexeApi();
      const signer = await resolveEthexeSigner(api.eth.publicClient, {
        account: options.account,
        passphrase: options.passphrase,
      });
      api.eth.setSigner(signer);

      const owner = await signer.getAddress();
      const txManager = await api.eth.wvara.approve(spender, amount);
      const receipt = await txManager.sendAndWaitForReceipt();

      output({
        chain: 'vara-eth',
        display: 'Vara.eth',
        txHash: receipt.transactionHash,
        owner,
        spender,
        amount: amount.toString(),
      });
    });

  wvara
    .command('permit <spender> <amount>')
    .description('EIP-2612 permit: sign an off-chain approval and submit it on-chain')
    .option('--account <name>', 'Vara.eth wallet name')
    .option('--passphrase <pass>', 'wallet passphrase')
    .option('--deadline <unix-seconds>', 'permit deadline as UNIX timestamp (default: now + 300s)')
    .action(async (spenderArg: string, amountArg: string, options: PermitOptions) => {
      const spender = asAddress(spenderArg, 'spender');
      const amount = parseBigIntArg(amountArg, 'amount');
      const deadlineSeconds = options.deadline
        ? parseBigIntArg(options.deadline, '--deadline')
        : BigInt(Math.floor(Date.now() / 1000) + 300);

      const api = await getEthexeApi();
      const signer = await resolveEthexeSigner(api.eth.publicClient, {
        account: options.account,
        passphrase: options.passphrase,
      });
      api.eth.setSigner(signer);

      const permitData = await api.eth.wvara.prepareAndSignPermitData(spender, amount, deadlineSeconds);
      const txManager = api.eth.wvara.permit(
        permitData.owner,
        permitData.spender,
        permitData.value,
        permitData.deadline,
        permitData.signature,
      );
      const receipt = await txManager.sendAndWaitForReceipt();

      output({
        chain: 'vara-eth',
        display: 'Vara.eth',
        txHash: receipt.transactionHash,
        owner: permitData.owner,
        spender,
        amount: amount.toString(),
        deadline: deadlineSeconds.toString(),
      });
    });
}
