const ADDRESS = '0xabcdef0000000000000000000000000000000001';
const TO = '0xabcdef0000000000000000000000000000000002';
const TX_HASH = '0x' + '11'.repeat(32);
const CODE_ID = '0x' + 'aa'.repeat(32);
const MESSAGE_ID = '0x' + '22'.repeat(32);

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockGetBalance = jest.fn();
const mockBalanceOf = jest.fn();
const mockDecimals = jest.fn();
const mockSymbol = jest.fn();
const mockTransfer = jest.fn();
const mockPrepareAndSignPermitData = jest.fn();
const mockExecutableBalanceTopUpWithPermit = jest.fn();
const mockSendReply = jest.fn();
const mockDeploy = jest.fn();
const mockSendAndWait = jest.fn();
const mockEstimateFee = jest.fn();
const mockSetSigner = jest.fn();
const mockGetAddress = jest.fn();
const mockSendAndWaitForReceipt = jest.fn();
const mockGetMirrorClient = jest.fn();
const mockProgramEvents = jest.fn();
const mockRouterEvents = jest.fn();
const mockBlocks = jest.fn();

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
  programs: {
    deploy: mockDeploy,
    sendAndWait: mockSendAndWait,
  },
  fees: {
    estimate: mockEstimateFee,
  },
  query: {
    program: {
      codeId: jest.fn(),
    },
    code: {
      getOriginal: jest.fn(),
    },
  },
  call: {
    program: {
      calculateReplyForHandle: jest.fn(),
    },
  },
  stream: {
    programEvents: mockProgramEvents,
    routerEvents: mockRouterEvents,
    blocks: mockBlocks,
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
  outputVaraEthDiscover,
  outputVaraEthMessageSend,
  outputVaraEthMessageReply,
  outputVaraEthProgramUpload,
  outputVaraEthSailsCall,
  outputVaraEthProgramTopUp,
  outputVaraEthWvaraTransfer,
  subscribeVaraEthBlocks,
  subscribeVaraEthProgram,
  subscribeVaraEthRouter,
  _isNullReturnTypeForTests,
} from '../commands/vara-eth-actions';
import { CliError } from '../utils/errors';
import { parseIdlFileV2 } from '../services/sails';

const FIXTURE_IDL = join(__dirname, 'fixtures', 'sample-v2.idl');

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
  mockProgramEvents.mockReturnValue(jest.fn());
  mockRouterEvents.mockReturnValue(jest.fn());
  mockBlocks.mockReturnValue(jest.fn());
  mockSendAndWaitForReceipt.mockResolvedValue({
    transactionHash: TX_HASH,
    blockNumber: 123n,
    status: 'success',
  });
  mockTransfer.mockResolvedValue({ sendAndWaitForReceipt: mockSendAndWaitForReceipt });
  mockPrepareAndSignPermitData.mockResolvedValue({ signature: '0xsig' });
  mockExecutableBalanceTopUpWithPermit.mockResolvedValue({ sendAndWaitForReceipt: mockSendAndWaitForReceipt });
  mockSendReply.mockResolvedValue({ sendAndWaitForReceipt: mockSendAndWaitForReceipt });
  mockDeploy.mockResolvedValue({
    codeId: CODE_ID,
    programAddress: TO,
    codeValidationReceipt: { transactionHash: '0x' + '33'.repeat(32), blockNumber: 122n },
    deploymentReceipt: { transactionHash: TX_HASH, blockNumber: 123n },
  });
  mockSendAndWait.mockResolvedValue({
    messageId: MESSAGE_ID,
    txHash: '0x' + '44'.repeat(32),
    reply: {
      payload: '0x',
      value: 0n,
      code: {
        isSuccess: true,
        asSuccess: { isManual: true, isAuto: false },
        isError: false,
        toBytes: () => new Uint8Array([0]),
      },
    },
  });
  mockEstimateFee.mockResolvedValue({
    gas: 21_000n,
    ethCostWei: 1_000_000n,
  });
  mockGetMirrorClient.mockResolvedValue({
    executableBalanceTopUpWithPermit: mockExecutableBalanceTopUpWithPermit,
    sendReply: mockSendReply,
  });
});

describe('Vara.eth subscription transport', () => {
  it('keeps every event stream on the Ethereum WebSocket transport', async () => {
    const finishImmediately = async (unsubscribe: () => void) => unsubscribe();

    await subscribeVaraEthProgram(ADDRESS, { persist: false }, finishImmediately);
    await subscribeVaraEthRouter({ persist: false }, finishImmediately);
    await subscribeVaraEthBlocks({ persist: false }, finishImmediately);

    expect(getEthexeApi).toHaveBeenNthCalledWith(1, { ethereumTransport: 'stream' });
    expect(getEthexeApi).toHaveBeenNthCalledWith(2, { ethereumTransport: 'stream' });
    expect(getEthexeApi).toHaveBeenNthCalledWith(3, { ethereumTransport: 'stream' });
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

  it('passes validated timeoutMs to Vara.eth message sends', async () => {
    await outputVaraEthMessageSend(TO, {
      account: 'hoodi-smoke',
      payload: '0xabcd',
      via: 'eth',
      timeoutMs: '2500',
    });

    expect(mockSendAndWait).toHaveBeenCalledWith(TO, '0xabcd', {
      value: undefined,
      via: 'eth',
      timeoutMs: 2500,
      validateSignature: true,
    });
  });

  it('rejects invalid Vara.eth message send timeouts before opening the API', async () => {
    await expect(outputVaraEthMessageSend(TO, {
      account: 'hoodi-smoke',
      payload: '0xabcd',
      via: 'eth',
      timeoutMs: '2500ms',
    })).rejects.toMatchObject({
      code: 'INVALID_TIMEOUT',
      meta: {
        field: '--timeout-ms',
        value: '2500ms',
      },
    });

    expect(getEthexeApi).not.toHaveBeenCalled();
    expect(mockSendAndWait).not.toHaveBeenCalled();
  });

  it('rejects invalid Vara.eth message send paths before opening the API', async () => {
    await expect(outputVaraEthMessageSend(TO, {
      account: 'hoodi-smoke',
      payload: '0xabcd',
      via: 'ethe' as any,
    })).rejects.toMatchObject({
      code: 'INVALID_VIA',
      meta: {
        via: 'ethe',
      },
    });

    expect(getEthexeApi).not.toHaveBeenCalled();
    expect(mockSendAndWait).not.toHaveBeenCalled();
  });

  it('discovers a Vara.eth Sails program from a local IDL without substrate RPC', async () => {
    await outputVaraEthDiscover(TO, { idl: FIXTURE_IDL });

    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      chain: 'vara-eth',
      programAddress: TO,
      idlSource: 'local',
      idlVersion: 'v2',
      services: expect.objectContaining({
        Demo: expect.objectContaining({
          functions: expect.objectContaining({
            Echo: expect.any(Object),
          }),
        }),
      }),
    }));
    expect(mockApi.query.program.codeId).not.toHaveBeenCalled();
  });

  it('builds a root Vara.eth Sails function dry-run with fee estimate', async () => {
    const hash = '0x' + '55'.repeat(32);

    await outputVaraEthSailsCall(TO, 'Demo/Echo', {
      idl: FIXTURE_IDL,
      args: `["0xaabb","${hash}"]`,
      value: '0',
      dryRun: true,
      estimate: true,
    });

    expect(mockEstimateFee).toHaveBeenCalledWith(expect.objectContaining({
      type: 'sendMessage',
      mirror: TO,
      value: 0n,
    }));
    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      chain: 'vara-eth',
      kind: 'function',
      programAddress: TO,
      service: 'Demo',
      method: 'Echo',
      origin: ADDRESS,
      via: 'eth',
      encodedPayload: expect.stringMatching(/^0x/),
      feeEstimate: {
        gas: '21000',
        ethCostWei: '1000000',
        wvaraFee: null,
      },
      willSubmit: false,
    }));
  });

  it('decodes empty replies for Vara.eth Sails v1 null-return functions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vara-wallet-v1-null-reply-'));
    const idl = join(dir, 'program.idl');
    writeFileSync(idl, [
      'constructor {',
      '  Init : ();',
      '};',
      '',
      'service VaraArkanoid {',
      '  SimulateGame : (num_steps: u32) -> null;',
      '};',
    ].join('\n'));

    try {
      await outputVaraEthSailsCall(TO, 'VaraArkanoid/SimulateGame', {
        account: 'hoodi-smoke',
        idl,
        args: '[10]',
        value: '0',
        via: 'eth',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(mockSendAndWait).toHaveBeenCalledWith(TO, expect.stringMatching(/^0x/), {
      value: 0n,
      via: 'eth',
    });
    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      chain: 'vara-eth',
      kind: 'function',
      service: 'VaraArkanoid',
      method: 'SimulateGame',
      result: null,
      reply: expect.objectContaining({
        payload: '0x',
      }),
    }));
  });

  it('recognizes Sails unit return types as empty replies', async () => {
    const sails = await parseIdlFileV2(FIXTURE_IDL);

    expect(_isNullReturnTypeForTests(sails, { kind: 'tuple', types: [] }, 'Demo')).toBe(true);
  });

  it('uses zero address for Vara.eth Sails read origins only when no account is configured', async () => {
    resolveEthexeAccountAddress.mockImplementationOnce(() => {
      throw new CliError(
        'No Vara.eth account selected. Use --account <name> or "config set defaultVaraEthAccount".',
        'NO_ACCOUNT',
      );
    });

    await outputVaraEthSailsCall(TO, 'Demo/GetPacket', {
      idl: FIXTURE_IDL,
      args: '[]',
      value: '0',
      dryRun: true,
    });

    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      chain: 'vara-eth',
      kind: 'query',
      origin: '0x0000000000000000000000000000000000000000',
      via: null,
      willSubmit: false,
    }));
  });

  it('does not hide explicit Vara.eth account resolution failures behind zero origin', async () => {
    resolveEthexeAccountAddress.mockImplementationOnce(() => {
      throw new CliError('Vara.eth wallet "typo" not found', 'WALLET_NOT_FOUND', { name: 'typo' });
    });

    await expect(outputVaraEthSailsCall(TO, 'Demo/GetPacket', {
      account: 'typo',
      idl: FIXTURE_IDL,
      args: '[]',
      value: '0',
      dryRun: true,
    })).rejects.toMatchObject({
      code: 'WALLET_NOT_FOUND',
      meta: { name: 'typo' },
    });
  });

  it('emits recovery JSON when deploy succeeds but init fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vara-wallet-eth-deploy-'));
    const wasm = join(dir, 'program.wasm');
    writeFileSync(wasm, Buffer.from([0x00, 0x61, 0x73, 0x6d]));
    mockSendAndWait.mockRejectedValueOnce(new Error('init reverted'));

    await expect(outputVaraEthProgramUpload(wasm, {
      account: 'hoodi-smoke',
      payload: '0x1234',
      value: '0',
    })).rejects.toMatchObject({ code: 'VARA_ETH_INIT_FAILED' });

    expect(mockDeploy).toHaveBeenCalledWith(expect.any(Uint8Array), {});
    expect(mockOutput).toHaveBeenCalledWith(expect.objectContaining({
      chain: 'vara-eth',
      codeId: CODE_ID,
      programAddress: TO,
      deploymentTxHash: TX_HASH,
      initStatus: 'failed',
      initError: { error: 'init reverted' },
    }));
    rmSync(dir, { recursive: true, force: true });
  });
});
