/**
 * Smoke tests for the `vara-eth:message send --resume <txHash>` flow.
 *
 * Covers:
 * - Resume of a previously-resolved promise prints the cached outcome
 *   (no network call, no signer required).
 * - Resume of a missing txHash → RESUME_NOT_FOUND
 * - Resume of a pending row → RESUME_PENDING_NOT_SUPPORTED
 *
 * Uses tmp `VARA_WALLET_DIR` for SQLite isolation. Stubs `getEthexeApi` and
 * `resolveEthexeSigner` to fail loudly if accidentally called on the resume
 * path — `--resume` MUST short-circuit before either runs.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  __resetPromiseStoreForTests,
  initPromiseStore,
  insertPending,
  markResolved,
} from '../services/vara-eth/promises';

const TX_HASH = ('0x' + '11'.repeat(32)) as `0x${string}`;
const MIRROR_ADDR = '0x1234560000000000000000000000000000000001';

const mockGetEthexeApi = jest.fn(() => {
  throw new Error('getEthexeApi should not be called on --resume path');
});
const mockResolveEthexeSigner = jest.fn(() => {
  throw new Error('resolveEthexeSigner should not be called on --resume path');
});

jest.mock('../services/vara-eth/api', () => ({
  getEthexeApi: () => mockGetEthexeApi(),
  getMirrorClient: jest.fn(),
}));

jest.mock('../services/vara-eth/account', () => ({
  resolveEthexeSigner: () => mockResolveEthexeSigner(),
}));

const mockOutput = jest.fn();
jest.mock('../utils/output', () => ({
  // Preserve the real `verbose` re-export through the utils barrel — the
  // promise store uses it for debug logging. Mocking output without verbose
  // turns `verbose` into `undefined` and crashes initPromiseStore.
  ...jest.requireActual('../utils/output'),
  output: (data: unknown) => mockOutput(data),
}));

// Pull the command registration after mocks are wired.
import { Command } from 'commander';

import { registerVaraEthMessageCommand } from '../commands/vara-eth-message';

let tmpDir: string;
const savedEnv = process.env.VARA_WALLET_DIR;

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerVaraEthMessageCommand(program);
  return program;
}

function basePending(overrides: Partial<Parameters<typeof insertPending>[0]> = {}) {
  return {
    txHash: TX_HASH,
    referenceBlock: '0x' + 'aa'.repeat(32),
    recipientValidator: null,
    signerAddress: '0x' + '22'.repeat(20),
    destination: MIRROR_ADDR,
    payloadHash: '0x' + '44'.repeat(32),
    salt: '0x' + '55'.repeat(32),
    valueWei: 0n,
    submittedAtBlock: 100,
    validatorUrl: null,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vw-msg-resume-'));
  process.env.VARA_WALLET_DIR = tmpDir;
  __resetPromiseStoreForTests();
  mockOutput.mockReset();
  mockGetEthexeApi.mockClear();
  mockResolveEthexeSigner.mockClear();
});

afterEach(() => {
  __resetPromiseStoreForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env.VARA_WALLET_DIR;
  else process.env.VARA_WALLET_DIR = savedEnv;
});

describe('vara-eth:message send --resume', () => {
  it('prints the cached outcome of a resolved promise without touching network or signer', async () => {
    initPromiseStore();
    insertPending(basePending());
    markResolved(TX_HASH, '0xreplyPayload', '0x00000000', '0xsig');

    const program = makeProgram();
    await program.parseAsync(['vara-eth:message', 'send', MIRROR_ADDR, '--resume', TX_HASH], { from: 'user' });

    expect(mockGetEthexeApi).not.toHaveBeenCalled();
    expect(mockResolveEthexeSigner).not.toHaveBeenCalled();
    expect(mockOutput).toHaveBeenCalledTimes(1);
    const data = mockOutput.mock.calls[0][0] as Record<string, unknown>;
    expect(data.txHash).toBe(TX_HASH);
    expect(data.status).toBe('resolved');
    expect(data.replyPayload).toBe('0xreplyPayload');
    expect(data.replyCode).toBe('0x00000000');
    expect(data.validatorSignature).toBe('0xsig');
  });

  it('throws RESUME_NOT_FOUND when the txHash has no cached promise', async () => {
    const program = makeProgram();
    await expect(
      program.parseAsync(['vara-eth:message', 'send', MIRROR_ADDR, '--resume', TX_HASH], { from: 'user' }),
    ).rejects.toMatchObject({ code: 'RESUME_NOT_FOUND' });
    expect(mockGetEthexeApi).not.toHaveBeenCalled();
  });

  it('throws RESUME_PENDING_NOT_SUPPORTED when the row is still pending', async () => {
    initPromiseStore();
    insertPending(basePending());

    const program = makeProgram();
    await expect(
      program.parseAsync(['vara-eth:message', 'send', MIRROR_ADDR, '--resume', TX_HASH], { from: 'user' }),
    ).rejects.toMatchObject({ code: 'RESUME_PENDING_NOT_SUPPORTED' });
  });
});
