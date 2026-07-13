import { Command } from 'commander';

import { getEthexeApi, getEthexeEthereumClient, getEthexeEthereumContext } from '../services/vara-eth/api';
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
  wait?: string;
}

interface WriteOptions extends AccountOptions {
  wait?: string;
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

function resolveWaitMode(raw: string | undefined): 'submitted' | 'receipt' {
  const wait = raw ?? 'receipt';
  if (wait === 'submitted' || wait === 'receipt') return wait;
  throw new CliError('--wait must be one of: submitted, receipt', 'INVALID_WAIT_MODE', {
    wait,
    allowed: ['submitted', 'receipt'],
  });
}

async function sendWvaraTransaction(
  tx: {
    send(): Promise<`0x${string}`>;
    sendAndWaitForReceipt(): Promise<{ transactionHash: `0x${string}`; status: 'success' | 'reverted' }>;
  },
  wait: 'submitted' | 'receipt',
): Promise<{ txHash: `0x${string}`; status: 'submitted' | 'success' | 'reverted' }> {
  if (wait === 'submitted') {
    return { txHash: await tx.send(), status: 'submitted' };
  }
  const receipt = await tx.sendAndWaitForReceipt();
  return { txHash: receipt.transactionHash, status: receipt.status };
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
    .option('--wait <stage>', 'completion stage: submitted or receipt (default)', 'receipt')
    .action(async (toArg: string, amountArg: string, _options: WriteOptions, cmd: Command) => {
      const opts = cmd.optsWithGlobals() as WriteOptions;
      const to = asAddress(toArg, 'to');
      const amount = parseBigIntArg(amountArg, 'amount');
      const wait = resolveWaitMode(opts.wait);

      const context = getEthexeEthereumContext();
      const [ethClient, signer] = await Promise.all([
        getEthexeEthereumClient(),
        resolveEthexeSigner(context.publicClient, opts),
      ]);
      ethClient.setSigner(signer);

      const from = await signer.getAddress();
      const txManager = await ethClient.wvara.transfer(to, amount);
      const result = await sendWvaraTransaction(txManager, wait);

      output({
        chain: 'vara-eth',
        display: 'Vara.eth',
        txHash: result.txHash,
        status: result.status,
        wait,
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
    .option('--wait <stage>', 'completion stage: submitted or receipt (default)', 'receipt')
    .action(async (spenderArg: string, amountArg: string, _options: WriteOptions, cmd: Command) => {
      const opts = cmd.optsWithGlobals() as WriteOptions;
      const spender = asAddress(spenderArg, 'spender');
      const amount = parseBigIntArg(amountArg, 'amount');
      const wait = resolveWaitMode(opts.wait);

      const context = getEthexeEthereumContext();
      const [ethClient, signer] = await Promise.all([
        getEthexeEthereumClient(),
        resolveEthexeSigner(context.publicClient, opts),
      ]);
      ethClient.setSigner(signer);

      const owner = await signer.getAddress();
      const txManager = await ethClient.wvara.approve(spender, amount);
      const result = await sendWvaraTransaction(txManager, wait);

      output({
        chain: 'vara-eth',
        display: 'Vara.eth',
        txHash: result.txHash,
        status: result.status,
        wait,
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
    .option('--wait <stage>', 'completion stage: submitted or receipt (default)', 'receipt')
    .action(async (spenderArg: string, amountArg: string, _options: PermitOptions, cmd: Command) => {
      const opts = cmd.optsWithGlobals() as PermitOptions;
      const spender = asAddress(spenderArg, 'spender');
      const amount = parseBigIntArg(amountArg, 'amount');
      const wait = resolveWaitMode(opts.wait);
      const deadlineSeconds = opts.deadline
        ? parseBigIntArg(opts.deadline, '--deadline')
        : BigInt(Math.floor(Date.now() / 1000) + 300);

      const context = getEthexeEthereumContext();
      const [ethClient, signer] = await Promise.all([
        getEthexeEthereumClient(),
        resolveEthexeSigner(context.publicClient, opts),
      ]);
      ethClient.setSigner(signer);

      const permitData = await ethClient.wvara.prepareAndSignPermitData(spender, amount, deadlineSeconds);
      const txManager = ethClient.wvara.permit(
        permitData.owner,
        permitData.spender,
        permitData.value,
        permitData.deadline,
        permitData.signature,
      );
      const result = await sendWvaraTransaction(txManager, wait);

      output({
        chain: 'vara-eth',
        display: 'Vara.eth',
        txHash: result.txHash,
        status: result.status,
        wait,
        owner: permitData.owner,
        spender,
        amount: amount.toString(),
        deadline: deadlineSeconds.toString(),
      });
    });
}
