import { Command } from 'commander';

const MIRROR = '0xabcdef0000000000000000000000000000000001';

const mockPrepareAndSignPermitData = jest.fn();
const mockExecutableBalanceTopUpWithPermit = jest.fn();
const mockSendAndWaitForReceipt = jest.fn();
const mockSetSigner = jest.fn();
const mockDecimals = jest.fn();
const mockGetMirrorClient = jest.fn();
const mockResolveEthexeSigner = jest.fn();
const mockOutput = jest.fn();

jest.mock('../services/vara-eth/api', () => ({
  getEthexeApi: jest.fn(() => Promise.resolve({
    eth: {
      publicClient: {},
      setSigner: mockSetSigner,
      wvara: {
        prepareAndSignPermitData: mockPrepareAndSignPermitData,
        decimals: mockDecimals,
      },
    },
  })),
  getMirrorClient: (...args: unknown[]) => mockGetMirrorClient(...args),
}));

jest.mock('../services/vara-eth/account', () => ({
  resolveEthexeSigner: (...args: unknown[]) => mockResolveEthexeSigner(...args),
}));

jest.mock('../utils/output', () => ({
  output: (value: unknown) => mockOutput(value),
}));

import { registerVaraEthProgramCommand } from '../commands/vara-eth-program';

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--account <name>', 'account');
  program.option('--passphrase <pass>', 'passphrase');
  registerVaraEthProgramCommand(program);
  return program;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveEthexeSigner.mockResolvedValue({ signer: true });
  mockPrepareAndSignPermitData.mockResolvedValue({ signature: '0xsig' });
  mockDecimals.mockResolvedValue(18);
  mockSendAndWaitForReceipt.mockResolvedValue({
    transactionHash: '0x' + '11'.repeat(32),
    blockNumber: 123n,
    status: 'success',
  });
  mockExecutableBalanceTopUpWithPermit.mockResolvedValue({
    sendAndWaitForReceipt: mockSendAndWaitForReceipt,
  });
  mockGetMirrorClient.mockResolvedValue({
    executableBalanceTopUpWithPermit: mockExecutableBalanceTopUpWithPermit,
  });
});

describe('vara-eth:program top-up', () => {
  it('uses WVARA permit and submits the top-up transaction', async () => {
    await makeProgram().parseAsync(['vara-eth:program', 'top-up', MIRROR, '--amount', '1'], { from: 'user' });

    const deadline = mockPrepareAndSignPermitData.mock.calls[0][2];
    expect(typeof deadline).toBe('bigint');
    expect(mockPrepareAndSignPermitData).toHaveBeenCalledWith(MIRROR, 1n, deadline);
    expect(mockExecutableBalanceTopUpWithPermit).toHaveBeenCalledWith(1n, deadline, '0xsig');
    expect(mockSendAndWaitForReceipt).toHaveBeenCalledTimes(1);
    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      mirror: MIRROR,
      amountRaw: '1',
      approval: 'permit',
      status: 'success',
    }));
  });

  it('classifies invalid raw top-up amounts through CliError', async () => {
    await expect(
      makeProgram().parseAsync(['vara-eth:program', 'top-up', MIRROR, '--amount', 'not-a-number'], { from: 'user' }),
    ).rejects.toMatchObject({
      code: 'INVALID_BIGINT',
      meta: { field: '--amount', value: 'not-a-number' },
    });
  });

  it('classifies invalid executable balances before dispatch', async () => {
    await expect(
      makeProgram().parseAsync(
        ['vara-eth:program', 'deploy', 'program.wasm', '--executable-balance', 'not-a-number'],
        { from: 'user' },
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_BIGINT',
      meta: { field: '--executable-balance', value: 'not-a-number' },
    });
  });
});
