import { Command } from 'commander';

const MIRROR = '0x1234560000000000000000000000000000000001';
const MESSAGE_ID = '0x' + '22'.repeat(32);
const CLAIMED_ID = '0x' + '33'.repeat(32);

const mockSetSigner = jest.fn();
const mockSendAndWaitForReceipt = jest.fn();
const mockGetReceipt = jest.fn();
const mockSendReply = jest.fn();
const mockClaimValue = jest.fn();
const mockGetValueClaimingRequestedEvent = jest.fn();

const mockApi = {
  eth: {
    publicClient: {},
    setSigner: mockSetSigner,
  },
};

const mockSigner = {};

jest.mock('../services/vara-eth/api', () => ({
  getEthexeApi: jest.fn(),
  getEthexeEthereumContext: jest.fn(),
  getMirrorClient: jest.fn(),
}));

jest.mock('../services/vara-eth/account', () => ({
  resolveEthexeSigner: jest.fn(),
}));

const mockOutput = jest.fn();
jest.mock('../utils/output', () => ({
  ...jest.requireActual('../utils/output'),
  output: (data: unknown) => mockOutput(data),
}));

const { getEthexeApi, getEthexeEthereumContext, getMirrorClient } = require('../services/vara-eth/api') as {
  getEthexeApi: jest.Mock;
  getEthexeEthereumContext: jest.Mock;
  getMirrorClient: jest.Mock;
};
const { resolveEthexeSigner } = require('../services/vara-eth/account') as {
  resolveEthexeSigner: jest.Mock;
};

import { registerVaraEthMailboxCommand } from '../commands/vara-eth-mailbox';
import { registerVaraEthMessageCommand } from '../commands/vara-eth-message';

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerVaraEthMessageCommand(program);
  registerVaraEthMailboxCommand(program);
  return program;
}

beforeEach(() => {
  jest.clearAllMocks();
  getEthexeApi.mockResolvedValue(mockApi);
  getEthexeEthereumContext.mockReturnValue({ publicClient: mockApi.eth.publicClient });
  getMirrorClient.mockResolvedValue({
    sendReply: mockSendReply,
    claimValue: mockClaimValue,
  });
  resolveEthexeSigner.mockResolvedValue(mockSigner);
  mockSendAndWaitForReceipt.mockResolvedValue({
    transactionHash: '0x' + '44'.repeat(32),
    blockNumber: 123n,
    status: 'success',
  });
  mockGetReceipt.mockImplementation(() => {
    throw new Error('getReceipt should not be called before send');
  });
  mockSendReply.mockResolvedValue({
    sendAndWaitForReceipt: mockSendAndWaitForReceipt,
    getReceipt: mockGetReceipt,
  });
  mockGetValueClaimingRequestedEvent.mockResolvedValue({
    source: MIRROR,
    claimedId: CLAIMED_ID,
  });
  mockClaimValue.mockResolvedValue({
    sendAndWaitForReceipt: mockSendAndWaitForReceipt,
    getReceipt: mockGetReceipt,
    getValueClaimingRequestedEvent: mockGetValueClaimingRequestedEvent,
  });
});

describe('Vara.eth write commands submit before reading receipts', () => {
  it('submits vara-eth:message reply before waiting for a receipt', async () => {
    await makeProgram().parseAsync(
      ['vara-eth:message', 'reply', MIRROR, MESSAGE_ID, '--payload', '0xabcd'],
      { from: 'user' },
    );

    expect(mockSendReply).toHaveBeenCalledWith(MESSAGE_ID, '0xabcd', undefined);
    expect(mockSendAndWaitForReceipt).toHaveBeenCalledTimes(1);
    expect(mockGetReceipt).not.toHaveBeenCalled();
    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      mirror: MIRROR,
      repliedTo: MESSAGE_ID,
      status: 'success',
    }));
  });

  it('submits vara-eth:mailbox claim before reading claim events', async () => {
    await makeProgram().parseAsync(
      ['vara-eth:mailbox', 'claim', MIRROR, CLAIMED_ID],
      { from: 'user' },
    );

    expect(mockClaimValue).toHaveBeenCalledWith(CLAIMED_ID);
    expect(mockSendAndWaitForReceipt).toHaveBeenCalledTimes(1);
    expect(mockGetReceipt).not.toHaveBeenCalled();
    expect(mockGetValueClaimingRequestedEvent).toHaveBeenCalledTimes(1);
    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      mirror: MIRROR,
      claimedId: CLAIMED_ID,
      status: 'success',
    }));
  });
});
