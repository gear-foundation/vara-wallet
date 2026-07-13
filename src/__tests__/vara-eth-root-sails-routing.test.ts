import { Command } from 'commander';

const mockUpload = jest.fn();
const mockDeploy = jest.fn();
const mockDiscover = jest.fn();
const mockCall = jest.fn();

jest.mock('../commands/vara-eth-actions', () => ({
  outputVaraEthProgramUpload: (...args: unknown[]) => mockUpload(...args),
  outputVaraEthProgramDeploy: (...args: unknown[]) => mockDeploy(...args),
  outputVaraEthDiscover: (...args: unknown[]) => mockDiscover(...args),
  outputVaraEthSailsCall: (...args: unknown[]) => mockCall(...args),
  outputVaraEthProgramInfo: jest.fn(),
  outputVaraEthProgramList: jest.fn(),
  outputVaraEthProgramTopUp: jest.fn(),
}));

import { registerCallCommand } from '../commands/call';
import { registerDiscoverCommand } from '../commands/discover';
import { registerProgramCommand } from '../commands/program';

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--chain <name>', 'chain');
  program.option('--account <name>', 'account');
  program.option('--passphrase <pass>', 'passphrase');
  registerProgramCommand(program);
  registerDiscoverCommand(program);
  registerCallCommand(program);
  return program;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpload.mockResolvedValue(undefined);
  mockDeploy.mockResolvedValue(undefined);
  mockDiscover.mockResolvedValue(undefined);
  mockCall.mockResolvedValue(undefined);
});

describe('root --chain vara-eth Sails routing', () => {
  it('routes program upload to the shared Vara.eth deployment helper', async () => {
    await makeProgram().parseAsync([
      '--chain', 'vara-eth',
      '--account', 'alice',
      'program', 'upload', 'program.wasm',
      '--idl', 'program.idl',
      '--init', 'Default',
      '--args', '[]',
      '--salt', '0x' + '11'.repeat(32),
    ], { from: 'user' });

    expect(mockUpload).toHaveBeenCalledWith('program.wasm', expect.objectContaining({
      account: 'alice',
      idl: 'program.idl',
      init: 'Default',
      args: '[]',
    }));
  });

  it('routes program deploy to the shared Vara.eth code-id helper', async () => {
    const codeId = '0x' + 'aa'.repeat(32);
    await makeProgram().parseAsync([
      '--chain', 'vara-eth',
      'program', 'deploy', codeId,
      '--payload', '0x1234',
      '--dry-run',
    ], { from: 'user' });

    expect(mockDeploy).toHaveBeenCalledWith(codeId, expect.objectContaining({
      payload: '0x1234',
      dryRun: true,
    }));
  });

  it('routes discover and call to Vara.eth Sails helpers', async () => {
    const address = '0xabcdef0000000000000000000000000000000002';
    await makeProgram().parseAsync(['--chain', 'vara-eth', 'discover', address, '--idl', 'p.idl'], { from: 'user' });
    await makeProgram().parseAsync([
      '--chain', 'vara-eth',
      'call', address, 'Demo/Echo',
      '--idl', 'p.idl',
      '--origin', '0xabcdef0000000000000000000000000000000001',
      '--via', 'eth',
      '--wait', 'submitted',
      '--dry-run',
    ], { from: 'user' });

    expect(mockDiscover).toHaveBeenCalledWith(address, { idl: 'p.idl' });
    expect(mockCall).toHaveBeenCalledWith(address, 'Demo/Echo', expect.objectContaining({
      idl: 'p.idl',
      origin: '0xabcdef0000000000000000000000000000000001',
      via: 'eth',
      wait: 'submitted',
      dryRun: true,
    }));
  });

  it('strictly rejects native-only call options on Vara.eth', async () => {
    const address = '0xabcdef0000000000000000000000000000000002';
    await expect(makeProgram().parseAsync([
      '--chain', 'vara-eth',
      'call', address, 'Demo/Echo',
      '--gas-limit', '100',
    ], { from: 'user' })).rejects.toMatchObject({
      code: 'UNSUPPORTED_CHAIN_OPTION',
    });
    expect(mockCall).not.toHaveBeenCalled();
  });
});
