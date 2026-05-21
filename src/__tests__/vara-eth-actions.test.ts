const ADDRESS = '0xabcdef0000000000000000000000000000000001';
const TO = '0xabcdef0000000000000000000000000000000002';

const mockGetBalance = jest.fn();
const mockBalanceOf = jest.fn();
const mockDecimals = jest.fn();
const mockSymbol = jest.fn();
const mockTransfer = jest.fn();
const mockPrepareAndSignPermitData = jest.fn();
const mockExecutableBalanceTopUpWithPermit = jest.fn();
const mockSendReply = jest.fn();
const mockSetSigner = jest.fn();
const mockGetAddress = jest.fn();
const mockSendAndWaitForReceipt = jest.fn();
const mockGetMirrorClient = jest.fn();

const mockApi = {
  eth: {
    publicClient: {
      getBalance: mockGetBalance,
    },
    wvara: {
      address: '0xE1ab85A8B4d5d5B6af0bbD0203EB322DF33d0464',
      balanceOf: mockBalanceOf,
      decimals: mockDecimals,
      symbol: mockSymbol,
      transfer: mockTransfer,
      prepareAndSignPermitData: mockPrepareAndSignPermitData,
    },
    setSigner: mockSetSigner,
  },
};

const mockSigner = {
  getAddress: mockGetAddress,
};

jest.mock('../services/vara-eth/api', () => ({
  getEthexeApi: jest.fn(),
  getMirrorClient: (...args: unknown[]) => mockGetMirrorClient(...args),
}));

jest.mock('../services/vara-eth/account', () => ({
  resolveEthexeAccountAddress: jest.fn(),
  resolveEthexeSigner: jest.fn(),
}));

const mockOutput = jest.fn();
jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  output: (data: unknown) => mockOutput(data),
  outputNdjson: jest.fn(),
  verbose: jest.fn(),
}));

const { getEthexeApi } = require('../services/vara-eth/api') as { getEthexeApi: jest.Mock };
const {
  resolveEthexeAccountAddress,
  resolveEthexeSigner,
} = require('../services/vara-eth/account') as {
  resolveEthexeAccountAddress: jest.Mock;
  resolveEthexeSigner: jest.Mock;
};

import {
  outputVaraEthBalance,
  outputVaraEthMessageReply,
  outputVaraEthProgramTopUp,
  outputVaraEthWvaraTransfer,
} from '../commands/vara-eth-actions';

beforeEach(() => {
  jest.clearAllMocks();
  getEthexeApi.mockResolvedValue(mockApi);
  resolveEthexeAccountAddress.mockReturnValue(ADDRESS);
  resolveEthexeSigner.mockResolvedValue(mockSigner);
  mockGetBalance.mockResolvedValue(2_000_000_000_000_000_000n);
  mockBalanceOf.mockResolvedValue(3_000_000_000_000_000_000n);
  mockDecimals.mockResolvedValue(18);
  mockSymbol.mockResolvedValue('WVARA');
  mockGetAddress.mockResolvedValue(ADDRESS);
  mockSendAndWaitForReceipt.mockResolvedValue({
    transactionHash: '0x' + '11'.repeat(32),
    blockNumber: 123n,
    status: 'success',
  });
  mockTransfer.mockResolvedValue({ sendAndWaitForReceipt: mockSendAndWaitForReceipt });
  mockPrepareAndSignPermitData.mockResolvedValue({ signature: '0xsig' });
  mockExecutableBalanceTopUpWithPermit.mockResolvedValue({ sendAndWaitForReceipt: mockSendAndWaitForReceipt });
  mockSendReply.mockResolvedValue({ sendAndWaitForReceipt: mockSendAndWaitForReceipt });
  mockGetMirrorClient.mockResolvedValue({
    executableBalanceTopUpWithPermit: mockExecutableBalanceTopUpWithPermit,
    sendReply: mockSendReply,
  });
});

describe('Vara.eth shared actions', () => {
  it('reads ETH and WVARA balance for the selected account', async () => {
    await outputVaraEthBalance(undefined, { account: 'hoodi-smoke' });

    expect(resolveEthexeAccountAddress).toHaveBeenCalledWith({ account: 'hoodi-smoke' });
    expect(mockGetBalance).toHaveBeenCalledWith({ address: ADDRESS });
    expect(mockBalanceOf).toHaveBeenCalledWith(ADDRESS);
    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      chain: 'vara-eth',
      address: ADDRESS,
      eth: expect.objectContaining({ balanceRaw: '2000000000000000000' }),
      wvara: expect.objectContaining({ balanceRaw: '3000000000000000000', ready: true }),
    }));
  });

  it('transfers WVARA in human units by default', async () => {
    await outputVaraEthWvaraTransfer(TO, '1.5', { account: 'hoodi-smoke' });

    expect(resolveEthexeSigner).toHaveBeenCalledWith(mockApi.eth.publicClient, { account: 'hoodi-smoke' });
    expect(mockSetSigner).toHaveBeenCalledWith(mockSigner);
    expect(mockTransfer).toHaveBeenCalledWith(TO, 1_500_000_000_000_000_000n);
    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      txHash: '0x' + '11'.repeat(32),
      from: ADDRESS,
      to: TO,
      amount: '1.5',
      amountRaw: '1500000000000000000',
    }));
  });

  it('formats raw WVARA transfers using the token decimals', async () => {
    mockDecimals.mockResolvedValue(12);

    await outputVaraEthWvaraTransfer(TO, '1', { account: 'hoodi-smoke', units: 'raw' });

    expect(mockTransfer).toHaveBeenCalledWith(TO, 1n);
    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      amount: '0.000000000001',
      amountRaw: '1',
      units: 'raw',
    }));
  });

  it('tops up via WVARA permit in one submitted transaction', async () => {
    mockDecimals.mockResolvedValue(12);

    await outputVaraEthProgramTopUp(TO, { account: 'hoodi-smoke', amount: '1', units: 'raw' });

    const deadline = mockPrepareAndSignPermitData.mock.calls[0][2];
    expect(typeof deadline).toBe('bigint');
    expect(mockPrepareAndSignPermitData).toHaveBeenCalledWith(TO, 1n, deadline);
    expect(mockExecutableBalanceTopUpWithPermit).toHaveBeenCalledWith(1n, deadline, '0xsig');
    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      amount: '0.000000000001',
      amountRaw: '1',
      approval: 'permit',
      status: 'success',
    }));
  });

  it('submits reply transactions before reading the receipt', async () => {
    const messageId = '0x' + '22'.repeat(32);

    await outputVaraEthMessageReply(TO, messageId, { account: 'hoodi-smoke', payload: '0xabcd' });

    expect(mockSendReply).toHaveBeenCalledWith(messageId, '0xabcd', undefined);
    expect(mockSendAndWaitForReceipt).toHaveBeenCalled();
    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      mirror: TO,
      repliedTo: messageId,
      status: 'success',
    }));
  });
});
