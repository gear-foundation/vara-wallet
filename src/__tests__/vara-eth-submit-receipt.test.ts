import { Command } from 'commander';

const MIRROR = '0x1234560000000000000000000000000000000001';
const MESSAGE_ID = '0x' + '22'.repeat(32);
const CLAIMED_ID = '0x' + '33'.repeat(32);

const mockSetSigner = jest.fn();
const mockSendAndWaitForReceipt = jest.fn();
const mockGetReceipt = jest.fn();
const mockClaimSend = jest.fn();
const mockClaimEstimateGas = jest.fn();
const mockGetTransactionCount = jest.fn();
const mockGetChainId = jest.fn();
const mockEstimateFeesPerGas = jest.fn();
const mockWaitForTransactionReceipt = jest.fn();
const mockGetTransactionReceipt = jest.fn();
const mockSendReply = jest.fn();
const mockClaimValue = jest.fn();
const mockGetDirectTransaction = jest.fn();
const mockInsertDirectTransaction = jest.fn();
const mockMarkDirectTransactionReceipt = jest.fn();
const mockMarkDirectTransactionReplaced = jest.fn();
const mockMarkDirectTransactionFailed = jest.fn();

const claimRequest: Record<string, unknown> = { to: MIRROR, data: '0xclaim' };

const mockApi = {
  eth: {
    publicClient: {
      getTransactionCount: mockGetTransactionCount,
      getChainId: mockGetChainId,
      estimateFeesPerGas: mockEstimateFeesPerGas,
      waitForTransactionReceipt: mockWaitForTransactionReceipt,
      getTransactionReceipt: mockGetTransactionReceipt,
      getGasPrice: jest.fn(),
    },
    setSigner: mockSetSigner,
  },
};

const mockSigner = { getAddress: jest.fn() };

jest.mock('../services/vara-eth/api', () => ({
  getEthexeApi: jest.fn(),
  getEthexeEthereumContext: jest.fn(),
  getMirrorClient: jest.fn(),
}));

jest.mock('../services/vara-eth/account', () => ({
  resolveEthexeSigner: jest.fn(),
}));

jest.mock('../services/vara-eth/direct-transactions', () => ({
  getDirectTransaction: (...args: unknown[]) => mockGetDirectTransaction(...args),
  insertDirectTransaction: (...args: unknown[]) => mockInsertDirectTransaction(...args),
  markDirectTransactionReceipt: (...args: unknown[]) => mockMarkDirectTransactionReceipt(...args),
  markDirectTransactionReplaced: (...args: unknown[]) => mockMarkDirectTransactionReplaced(...args),
  markDirectTransactionFailed: (...args: unknown[]) => mockMarkDirectTransactionFailed(...args),
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
  for (const key of Object.keys(claimRequest)) delete claimRequest[key];
  Object.assign(claimRequest, { to: MIRROR, data: '0xclaim' });
  getEthexeApi.mockResolvedValue(mockApi);
  getEthexeEthereumContext.mockReturnValue({ publicClient: mockApi.eth.publicClient });
  getMirrorClient.mockResolvedValue({
    sendReply: mockSendReply,
    claimValue: mockClaimValue,
  });
  resolveEthexeSigner.mockResolvedValue(mockSigner);
  mockSigner.getAddress.mockResolvedValue('0x1234560000000000000000000000000000000002');
  mockGetChainId.mockResolvedValue(5);
  mockGetTransactionCount.mockResolvedValue(7);
  mockEstimateFeesPerGas.mockResolvedValue({ maxFeePerGas: 100n, maxPriorityFeePerGas: 2n });
  mockClaimEstimateGas.mockImplementation(async () => {
    claimRequest.gas = 50_000n;
    return 50_000n;
  });
  mockClaimSend.mockResolvedValue('0x' + '44'.repeat(32));
  mockWaitForTransactionReceipt.mockResolvedValue({
    transactionHash: '0x' + '44'.repeat(32),
    blockNumber: 123n,
    status: 'success',
  });
  mockGetTransactionReceipt.mockResolvedValue({
    transactionHash: '0x' + '44'.repeat(32),
    blockNumber: 123n,
    status: 'success',
  });
  mockGetDirectTransaction.mockReturnValue(undefined);
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
  mockClaimValue.mockResolvedValue({
    send: mockClaimSend,
    estimateGas: mockClaimEstimateGas,
    getTx: () => claimRequest,
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

  it('submits a direct L1 claim without opening the validator API', async () => {
    await makeProgram().parseAsync(
      ['vara-eth:mailbox', 'claim', MIRROR, CLAIMED_ID],
      { from: 'user' },
    );

    expect(mockClaimValue).toHaveBeenCalledWith(CLAIMED_ID);
    expect(mockClaimSend).toHaveBeenCalledTimes(1);
    expect(mockWaitForTransactionReceipt).toHaveBeenCalledWith(expect.objectContaining({
      hash: '0x' + '44'.repeat(32),
      timeout: 45_000,
    }));
    expect(getEthexeApi).not.toHaveBeenCalled();
    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      mirror: MIRROR,
      claimedId: CLAIMED_ID,
      status: 'confirmed',
      nonce: '7',
      event: null,
    }));
  });

  it('returns the submitted hash and persisted fee metadata without waiting', async () => {
    await makeProgram().parseAsync(
      ['vara-eth:mailbox', 'claim', MIRROR, CLAIMED_ID, '--wait', 'submitted'],
      { from: 'user' },
    );

    expect(mockWaitForTransactionReceipt).not.toHaveBeenCalled();
    expect(mockInsertDirectTransaction).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'mailbox_claim',
      chainId: 5,
      nonce: 7n,
      maxFeePerGas: 120n,
      maxPriorityFeePerGas: 2n,
    }));
    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      status: 'submitted',
      txHash: '0x' + '44'.repeat(32),
      nonce: '7',
    }));
  });

  it('uses the saved nonce and bumps fees when replacing a pending claim', async () => {
    const original = '0x' + '55'.repeat(32);
    mockGetDirectTransaction.mockImplementation((txHash: string) => txHash === original ? {
      tx_hash: original,
      chain_id: '5',
      operation: 'mailbox_claim',
      mirror: MIRROR,
      claimed_id: CLAIMED_ID,
      sender: '0x1234560000000000000000000000000000000002',
      nonce: '7',
      calldata: '0xclaim',
      gas: '50000',
      max_fee_per_gas: '100',
      max_priority_fee_per_gas: '2',
      gas_price: null,
      submitted_at_ts: 0,
      status: 'pending',
      replacement_of: null,
      replaced_by: null,
      receipt_block: null,
      last_error: null,
    } : undefined);

    await makeProgram().parseAsync(
      ['vara-eth:mailbox', 'claim', '--replace', original, '--wait', 'submitted'],
      { from: 'user' },
    );

    expect(claimRequest.nonce).toBe(7);
    expect(claimRequest.maxFeePerGas).toBe(120n);
    expect(claimRequest.maxPriorityFeePerGas).toBe(3n);
    expect(mockMarkDirectTransactionReplaced).toHaveBeenCalledWith(original, '0x' + '44'.repeat(32));
  });

  it('rejects a replacement from a different Ethereum account before broadcasting', async () => {
    const original = '0x' + '55'.repeat(32);
    mockGetDirectTransaction.mockReturnValue({
      tx_hash: original,
      chain_id: '5',
      operation: 'mailbox_claim', mirror: MIRROR, claimed_id: CLAIMED_ID,
      sender: '0x1234560000000000000000000000000000000003', nonce: '7', calldata: '0xclaim',
      gas: '50000', max_fee_per_gas: '100', max_priority_fee_per_gas: '2', gas_price: null,
      submitted_at_ts: 0, status: 'pending', replacement_of: null, replaced_by: null, receipt_block: null, last_error: null,
    });

    await expect(makeProgram().parseAsync(
      ['vara-eth:mailbox', 'claim', '--replace', original, '--wait', 'submitted'], { from: 'user' },
    )).rejects.toThrow('does not match the sender');

    expect(mockClaimSend).not.toHaveBeenCalled();
  });

  it('rejects a replacement on a different Ethereum chain before broadcasting', async () => {
    const original = '0x' + '55'.repeat(32);
    mockGetDirectTransaction.mockReturnValue({
      tx_hash: original,
      chain_id: '1',
      operation: 'mailbox_claim', mirror: MIRROR, claimed_id: CLAIMED_ID,
      sender: '0x1234560000000000000000000000000000000002', nonce: '7', calldata: '0xclaim',
      gas: '50000', max_fee_per_gas: '100', max_priority_fee_per_gas: '2', gas_price: null,
      submitted_at_ts: 0, status: 'pending', replacement_of: null, replaced_by: null, receipt_block: null, last_error: null,
    });

    await expect(makeProgram().parseAsync(
      ['vara-eth:mailbox', 'claim', '--replace', original, '--wait', 'submitted'], { from: 'user' },
    )).rejects.toThrow('does not match the saved claim transaction');

    expect(mockClaimSend).not.toHaveBeenCalled();
  });

  it('preserves legacy gasPrice fee mode for a replacement', async () => {
    const original = '0x' + '55'.repeat(32);
    mockGetDirectTransaction.mockReturnValue({
      tx_hash: original,
      chain_id: '5',
      operation: 'mailbox_claim', mirror: MIRROR, claimed_id: CLAIMED_ID,
      sender: '0x1234560000000000000000000000000000000002', nonce: '7', calldata: '0xclaim',
      gas: '50000', max_fee_per_gas: null, max_priority_fee_per_gas: null, gas_price: '100',
      submitted_at_ts: 0, status: 'pending', replacement_of: null, replaced_by: null, receipt_block: null, last_error: null,
    });
    mockApi.eth.publicClient.getGasPrice.mockResolvedValue(90n);

    await makeProgram().parseAsync(
      ['vara-eth:mailbox', 'claim', '--replace', original, '--wait', 'submitted'], { from: 'user' },
    );

    expect(claimRequest.gasPrice).toBe(113n);
    expect(claimRequest.maxFeePerGas).toBeUndefined();
    expect(mockEstimateFeesPerGas).not.toHaveBeenCalled();
  });

  it('does not estimate fees when both EIP-1559 values are explicit', async () => {
    await makeProgram().parseAsync(
      ['vara-eth:mailbox', 'claim', MIRROR, CLAIMED_ID, '--wait', 'submitted', '--max-fee-per-gas', '200', '--max-priority-fee-per-gas', '3'],
      { from: 'user' },
    );

    expect(mockEstimateFeesPerGas).not.toHaveBeenCalled();
    expect(claimRequest.maxFeePerGas).toBe(200n);
    expect(claimRequest.maxPriorityFeePerGas).toBe(3n);
  });

  it('reports a saved claim as pending when its receipt is not yet available', async () => {
    const original = '0x' + '55'.repeat(32);
    mockGetDirectTransaction.mockReturnValue({
      tx_hash: original,
      chain_id: '5',
      operation: 'mailbox_claim',
      mirror: MIRROR,
      claimed_id: CLAIMED_ID,
      sender: '0x1234560000000000000000000000000000000002',
      nonce: '7',
      calldata: '0xclaim',
      gas: '50000',
      max_fee_per_gas: '100',
      max_priority_fee_per_gas: '2',
      gas_price: null,
      submitted_at_ts: 0,
      status: 'pending',
      replacement_of: null,
      replaced_by: null,
      receipt_block: null,
      last_error: null,
    });
    mockGetTransactionReceipt.mockRejectedValue(Object.assign(new Error('Transaction receipt not found'), {
      name: 'TransactionReceiptNotFoundError',
    }));

    await makeProgram().parseAsync(
      ['vara-eth:mailbox', 'claim', '--resume', original],
      { from: 'user' },
    );

    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      txHash: original,
      status: 'pending',
      code: 'CLAIM_PENDING',
    }));
  });

  it('makes a claim terminal when its nonce advanced without an available receipt', async () => {
    const original = '0x' + '55'.repeat(32);
    mockGetDirectTransaction.mockReturnValue({
      tx_hash: original, chain_id: '5', operation: 'mailbox_claim', mirror: MIRROR, claimed_id: CLAIMED_ID,
      sender: '0x1234560000000000000000000000000000000002', nonce: '7', calldata: '0xclaim',
      gas: '50000', max_fee_per_gas: '100', max_priority_fee_per_gas: '2', gas_price: null,
      submitted_at_ts: 0, status: 'pending', replacement_of: null, replaced_by: null, receipt_block: null, last_error: null,
    });
    mockGetTransactionReceipt.mockRejectedValue(Object.assign(new Error('Transaction receipt not found'), {
      name: 'TransactionReceiptNotFoundError',
    }));
    mockGetTransactionCount.mockResolvedValue(8);

    await makeProgram().parseAsync(['vara-eth:mailbox', 'claim', '--resume', original], { from: 'user' });

    expect(mockMarkDirectTransactionFailed).toHaveBeenCalledWith(original, 'CLAIM_REPLACED_OR_MINED');
    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({ status: 'unknown', code: 'CLAIM_REPLACED_OR_MINED' }));
  });

  it('marks a receipt timeout as pending but persists other receipt failures', async () => {
    const failure = new Error('Ethereum RPC unavailable');
    mockWaitForTransactionReceipt.mockRejectedValue(failure);

    await expect(makeProgram().parseAsync(
      ['vara-eth:mailbox', 'claim', MIRROR, CLAIMED_ID], { from: 'user' },
    )).rejects.toThrow('Ethereum RPC unavailable');

    expect(mockMarkDirectTransactionFailed).toHaveBeenCalledWith('0x' + '44'.repeat(32), 'Ethereum RPC unavailable');
  });

  it('persists reverted receipts without looking up a second receipt for events', async () => {
    mockWaitForTransactionReceipt.mockResolvedValue({
      transactionHash: '0x' + '44'.repeat(32), blockNumber: 123n, status: 'reverted', logs: [],
    });

    await makeProgram().parseAsync(['vara-eth:mailbox', 'claim', MIRROR, CLAIMED_ID], { from: 'user' });

    expect(mockMarkDirectTransactionReceipt).toHaveBeenCalledWith('0x' + '44'.repeat(32), 'reverted', 123n);
    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({ status: 'reverted', event: null }));
  });

  it('submits one same-nonce replacement after the requested pending interval', async () => {
    const original = '0x' + '55'.repeat(32);
    const replacement = '0x' + '66'.repeat(32);
    const timeout = Object.assign(new Error('Timed out waiting for transaction receipt'), {
      name: 'WaitForTransactionReceiptTimeoutError',
    });
    mockClaimSend.mockResolvedValueOnce(original).mockResolvedValueOnce(replacement);
    mockWaitForTransactionReceipt
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ transactionHash: replacement, blockNumber: 124n, status: 'success' });
    // If local persistence is unavailable, a fresh pending nonce would be 8.
    // The automatic replacement must nevertheless reuse the original nonce 7.
    mockGetTransactionCount.mockResolvedValueOnce(7).mockResolvedValueOnce(8);

    await makeProgram().parseAsync(
      ['vara-eth:mailbox', 'claim', MIRROR, CLAIMED_ID, '--replace-after-ms', '1'],
      { from: 'user' },
    );

    expect(mockClaimSend).toHaveBeenCalledTimes(2);
    expect(mockGetTransactionCount).toHaveBeenCalledTimes(1);
    expect(claimRequest.nonce).toBe(7);
    expect(mockMarkDirectTransactionReplaced).toHaveBeenCalledWith(original, replacement);
    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      txHash: replacement,
      status: 'confirmed',
      replacementOf: original,
    }));
  });
});
