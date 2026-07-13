import { Readable } from 'node:stream';

const ADDRESS = '0xabcdef0000000000000000000000000000000001';
const PROGRAM = '0xabcdef0000000000000000000000000000000002';
const TX_HASH = '0x' + '11'.repeat(32);
const MESSAGE_ID = '0x' + '22'.repeat(32);

const mockOutputNdjson = jest.fn();
const mockSetSigner = jest.fn();
const mockGetAddress = jest.fn();
const mockCalculateReply = jest.fn();
const mockCreateInjectedTransaction = jest.fn();
const mockLoadSails = jest.fn();
const mockResolveMethod = jest.fn();
const mockDecodeReply = jest.fn();
const mockSend = jest.fn();
const mockSetDefaultValidator = jest.fn();

jest.mock('../services/vara-eth/api', () => ({ getEthexeApi: jest.fn() }));
jest.mock('../services/vara-eth/account', () => ({ resolveEthexeSigner: jest.fn() }));
jest.mock('../services/vara-eth/sails-idl', () => ({ loadVaraEthSails: (...args: unknown[]) => mockLoadSails(...args) }));
jest.mock('../shared/output-eth/reply-code', () => ({ serializeReplyCode: jest.fn(() => ({ tag: 'Success' })) }));
jest.mock('../commands/vara-eth-actions', () => ({
  parseSailsMethod: (method: string) => {
    const [serviceName, methodName] = method.split('/');
    return { serviceName, methodName };
  },
  resolveSailsMethod: (...args: unknown[]) => mockResolveMethod(...args),
  decodeVaraEthSailsReply: (...args: unknown[]) => mockDecodeReply(...args),
}));
jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  coerceArgsAuto: (args: unknown[]) => args,
  outputNdjson: (data: unknown) => mockOutputNdjson(data),
}));

const { getEthexeApi } = require('../services/vara-eth/api') as { getEthexeApi: jest.Mock };
const { resolveEthexeSigner } = require('../services/vara-eth/account') as { resolveEthexeSigner: jest.Mock };

import { runVaraEthSession } from '../commands/vara-eth-session';

const sails = { services: {} };
const queryMethod = { args: [], returnTypeDef: {}, encodePayload: jest.fn(() => '0xaaaa') };
const functionMethod = { args: [], returnTypeDef: {}, encodePayload: jest.fn(() => '0xbbbb') };

const api = {
  eth: { publicClient: {}, setSigner: mockSetSigner },
  call: { program: { calculateReplyForHandle: mockCalculateReply } },
  createInjectedTransaction: mockCreateInjectedTransaction,
};

beforeEach(() => {
  jest.clearAllMocks();
  getEthexeApi.mockResolvedValue(api);
  resolveEthexeSigner.mockResolvedValue({ getAddress: mockGetAddress });
  mockGetAddress.mockResolvedValue(ADDRESS);
  mockLoadSails.mockResolvedValue({ sails });
  mockCalculateReply.mockResolvedValue({ code: { isSuccess: true }, payload: '0x1234', value: 0n });
  mockDecodeReply.mockReturnValue({ decoded: true });
  mockCreateInjectedTransaction.mockResolvedValue({
    txHash: TX_HASH,
    messageId: MESSAGE_ID,
    setDefaultValidator: mockSetDefaultValidator,
    send: mockSend,
  });
  mockSend.mockResolvedValue('Accept');
});

describe('vara-eth:session', () => {
  it('reuses a loaded IDL for sequential query requests and emits decoded replies', async () => {
    mockResolveMethod.mockReturnValue({ kind: 'query', method: queryMethod });

    await runVaraEthSession({}, Readable.from([
      `${JSON.stringify({ id: 1, program: PROGRAM, method: 'World/Session', args: [], idl: '/tmp/world.idl' })}\n`,
      `${JSON.stringify({ id: 2, program: PROGRAM, method: 'World/Session', args: [], idl: '/tmp/world.idl' })}\n`,
    ]));

    expect(mockLoadSails).toHaveBeenCalledTimes(1);
    expect(mockCalculateReply).toHaveBeenCalledTimes(2);
    expect(mockOutputNdjson).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'ready', origin: ADDRESS }));
    expect(mockOutputNdjson).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'result', id: 2, kind: 'query', result: { decoded: true },
    }));
  });

  it('submits functions once and returns deterministic transaction identifiers', async () => {
    mockResolveMethod.mockReturnValue({ kind: 'function', method: functionMethod });

    await runVaraEthSession({}, Readable.from([
      `${JSON.stringify({ id: 'write-1', program: PROGRAM, method: 'Digger/MoveAgent', args: [] })}\n`,
    ]));

    expect(mockSetDefaultValidator).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockOutputNdjson).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'result', id: 'write-1', kind: 'function', status: 'submitted', txHash: TX_HASH, messageId: MESSAGE_ID,
    }));
  });

  it('keeps the session alive after a malformed request', async () => {
    mockResolveMethod.mockReturnValue({ kind: 'query', method: queryMethod });

    await runVaraEthSession({}, Readable.from([
      '{"id":"bad"}\n',
      `${JSON.stringify({ id: 'good', program: PROGRAM, method: 'World/Session', args: [] })}\n`,
    ]));

    expect(mockOutputNdjson).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error', id: 'bad', error: expect.objectContaining({ code: 'INVALID_SESSION_REQUEST' }),
    }));
    expect(mockOutputNdjson).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'result', id: 'good' }));
  });
});
