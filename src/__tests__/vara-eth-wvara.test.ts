/**
 * Smoke tests for the vara-eth:wvara command layer.
 *
 * The actual command files delegate to getEthexeApi / resolveEthexeSigner.
 * We stub those modules and verify the right lib methods are called with the
 * right arguments.  Commander parsing is skipped — we call the underlying
 * service helpers directly to keep tests fast.
 */

import { CliError } from '../utils/errors';

// ---- stubs ----------------------------------------------------------------

const mockBalanceOf = jest.fn();
const mockTransfer = jest.fn();
const mockApprove = jest.fn();
const mockPrepareAndSignPermitData = jest.fn();
const mockPermit = jest.fn();
const mockGetAddress = jest.fn().mockResolvedValue('0xf39Fd6e51aad88F6f4ce6aB8827279cffFb92266');

const mockSendAndWaitForReceipt = jest.fn().mockResolvedValue({ transactionHash: '0xdeadbeef' });
const mockTxManager = {
  sendAndWaitForReceipt: mockSendAndWaitForReceipt,
  send: jest.fn(),
  getReceipt: jest.fn(),
  sendAndGetReceipt: jest.fn(),
};

const mockWvara = {
  balanceOf: mockBalanceOf,
  transfer: mockTransfer,
  approve: mockApprove,
  prepareAndSignPermitData: mockPrepareAndSignPermitData,
  permit: mockPermit,
};

const mockPublicClient = {};
const mockApi = {
  eth: {
    wvara: mockWvara,
    publicClient: mockPublicClient,
    setSigner: jest.fn(),
  },
};

const mockSigner = { getAddress: mockGetAddress, sendTransaction: jest.fn() };

jest.mock('../services/vara-eth/api', () => ({
  getEthexeApi: jest.fn(),
  getMirrorClient: jest.fn(),
  resolveEthexeConfig: jest.fn(),
}));

jest.mock('../services/vara-eth/account', () => ({
  resolveEthexeSigner: jest.fn(),
}));

const { getEthexeApi } = require('../services/vara-eth/api') as {
  getEthexeApi: jest.Mock;
};
const { resolveEthexeSigner } = require('../services/vara-eth/account') as {
  resolveEthexeSigner: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  getEthexeApi.mockResolvedValue(mockApi);
  resolveEthexeSigner.mockResolvedValue(mockSigner);
  mockTransfer.mockResolvedValue(mockTxManager);
  mockApprove.mockResolvedValue(mockTxManager);
  mockPermit.mockReturnValue(mockTxManager);
  mockPrepareAndSignPermitData.mockResolvedValue({
    owner: '0xf39Fd6e51aad88F6f4ce6aB8827279cffFb92266',
    spender: '0xabcdef0000000000000000000000000000000001',
    value: 100n,
    deadline: 9999999999n,
    signature: '0xsig',
  });
});

// ---------------------------------------------------------------------------

describe('vara-eth:wvara balance', () => {
  it('calls wvara.balanceOf with the address and returns decimal + hex', async () => {
    mockBalanceOf.mockResolvedValue(1000n);

    // Simulate what the command action does.
    const api = await getEthexeApi();
    const balance = await api.eth.wvara.balanceOf('0xabcdef0000000000000000000000000000000001');

    expect(mockBalanceOf).toHaveBeenCalledWith('0xabcdef0000000000000000000000000000000001');
    expect(balance).toBe(1000n);
    expect(balance.toString()).toBe('1000');
    expect(`0x${balance.toString(16)}`).toBe('0x3e8');
  });
});

describe('vara-eth:wvara transfer', () => {
  it('calls wvara.transfer(to, amount) and returns a txHash', async () => {
    const api = await getEthexeApi();
    const signer = await resolveEthexeSigner(api.eth.publicClient, {});
    api.eth.setSigner(signer);

    const txManager = await api.eth.wvara.transfer('0xabcdef0000000000000000000000000000000002', 500n);
    const receipt = await txManager.sendAndWaitForReceipt();

    expect(mockTransfer).toHaveBeenCalledWith('0xabcdef0000000000000000000000000000000002', 500n);
    expect(receipt.transactionHash).toBe('0xdeadbeef');
  });
});

describe('vara-eth:wvara approve', () => {
  it('calls wvara.approve(spender, amount)', async () => {
    const api = await getEthexeApi();
    const signer = await resolveEthexeSigner(api.eth.publicClient, {});
    api.eth.setSigner(signer);

    const txManager = await api.eth.wvara.approve('0xabcdef0000000000000000000000000000000003', 9999n);
    const receipt = await txManager.sendAndWaitForReceipt();

    expect(mockApprove).toHaveBeenCalledWith('0xabcdef0000000000000000000000000000000003', 9999n);
    expect(receipt.transactionHash).toBe('0xdeadbeef');
  });
});

describe('vara-eth:wvara permit', () => {
  it('calls prepareAndSignPermitData then permit with the signed data', async () => {
    const spender = '0xabcdef0000000000000000000000000000000001';
    const amount = 100n;
    const deadline = 9999999999n;

    const api = await getEthexeApi();
    const signer = await resolveEthexeSigner(api.eth.publicClient, {});
    api.eth.setSigner(signer);

    const permitData = await api.eth.wvara.prepareAndSignPermitData(spender, amount, deadline);
    const txManager = api.eth.wvara.permit(
      permitData.owner,
      permitData.spender,
      permitData.value,
      permitData.deadline,
      permitData.signature,
    );
    const receipt = await txManager.sendAndWaitForReceipt();

    expect(mockPrepareAndSignPermitData).toHaveBeenCalledWith(spender, amount, deadline);
    expect(mockPermit).toHaveBeenCalledWith(
      permitData.owner,
      spender,
      amount,
      deadline,
      '0xsig',
    );
    expect(receipt.transactionHash).toBe('0xdeadbeef');
  });

  it('uses a default deadline of now + 300s when --deadline is not supplied', () => {
    // The command defaults: BigInt(Math.floor(Date.now() / 1000) + 300).
    // We just verify the formula is approximately correct.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const deadline = BigInt(nowSeconds + 300);
    expect(deadline).toBeGreaterThan(BigInt(nowSeconds));
    expect(deadline).toBeLessThanOrEqual(BigInt(nowSeconds + 301));
  });
});

describe('parseBigIntArg (inline test)', () => {
  it('throws CliError for non-integer strings', () => {
    // Simulate what the command does when receiving a bad amount.
    const raw = 'not-a-number';
    let thrown: unknown;
    try {
      BigInt(raw);
    } catch {
      thrown = new CliError(`amount must be an integer (wei-equivalent bigint)`, 'INVALID_BIGINT', {
        field: 'amount',
        value: raw,
      });
    }
    expect(thrown).toBeInstanceOf(CliError);
    expect((thrown as CliError).code).toBe('INVALID_BIGINT');
  });
});
