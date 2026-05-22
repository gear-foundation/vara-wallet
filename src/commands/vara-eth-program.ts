import { Command } from 'commander';

import { outputVaraEthProgramTopUp, outputVaraEthProgramUpload } from './vara-eth-actions';
import { parseOptionalBigInt } from '../utils/eth-types';

interface DeployOptions {
  salt?: string;
  executableBalance?: string;
  payload: string;
  idl?: string;
  init?: string;
  args?: string;
  argsFile?: string;
  value: string;
  units?: string;
  dryRun?: boolean;
  account?: string;
  passphrase?: string;
}

export function registerVaraEthProgramCommand(program: Command): void {
  const cmd = program.command('vara-eth:program').description('Upload code and deploy programs on the Vara.eth rail');

  cmd
    .command('deploy <wasmPath>')
    .description('Upload WASM code (if needed) and create a program in one ceremony')
    .option('--salt <hex>', '32-byte salt for unique program-id derivation')
    .option('--executable-balance <raw>', 'top up executable balance at deployment in raw WVARA units')
    .option('--payload <payload>', 'optional init payload to send after deployment', '0x')
    .option('--idl <path>', 'path to Sails IDL file (auto-encodes constructor payload)')
    .option('--init <name>', 'constructor name (auto-selected if IDL has only one)')
    .option('--args <json>', 'constructor arguments as JSON array (requires --idl)')
    .option('--args-file <path>', 'read constructor --args JSON from file (use - for stdin, requires --idl)')
    .option('--value <value>', 'value to send with init message, in WVARA units', '0')
    .option('--units <units>', 'amount units: human (default) or raw')
    .option('--dry-run', 'encode constructor payload and exit without deployment')
    .option('--account <name>', 'Vara.eth wallet name')
    .option('--passphrase <pass>', 'wallet passphrase')
    .action(async (wasmPath: string, _options: DeployOptions, cmd: Command) => {
      const opts = cmd.optsWithGlobals() as DeployOptions;
      parseOptionalBigInt(opts.executableBalance, '--executable-balance');
      await outputVaraEthProgramUpload(wasmPath, opts);
    });

  cmd
    .command('top-up <mirror>')
    .description('Top up the executable balance of a program (sender pays in WVARA)')
    .requiredOption('--amount <wei>', 'amount in WVARA wei')
    .option('--account <name>', 'Vara.eth wallet name')
    .option('--passphrase <pass>', 'wallet passphrase')
    .action(async (
      mirrorArg: string,
      _options: { amount: string; account?: string; passphrase?: string },
      cmd: Command,
    ) => {
      const opts = cmd.optsWithGlobals() as { amount: string; account?: string; passphrase?: string };
      const amount = parseOptionalBigInt(opts.amount, '--amount')!;
      await outputVaraEthProgramTopUp(mirrorArg, { ...opts, amount: amount.toString(), units: 'raw' });
    });
}
