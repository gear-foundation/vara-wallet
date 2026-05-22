/**
 * Unit tests for the ReplyCode → JSON serializer.
 *
 * Builds minimal mocks that match the `ReplyCode` shape the serializer reads
 * (`isSuccess`, `asSuccess.isAuto`, `asError.isExecution.{...}`, etc.).
 * Avoids pulling the real `@vara-eth/api` (stubbed in tests — see
 * jest.config.js `moduleNameMapper`).
 */

import type { ReplyCode } from '@vara-eth/api';
import { replyCodeTag, serializeReplyCode } from '../shared/output-eth/reply-code';

interface MockOpts {
  success?: { auto?: boolean; manual?: boolean };
  error?:
    | {
        execution?:
          | 'RanOutOfGas'
          | 'MemoryOverflow'
          | 'BackendError'
          | 'UserspacePanic'
          | 'UnreachableInstruction'
          | 'StackLimitExceeded';
        unavailableActor?:
          | 'ProgramExited'
          | 'InitializationFailure'
          | 'Uninitialized'
          | 'ProgramNotCreated'
          | 'ReinstrumentationFailure';
        removedFromWaitlist?: boolean;
      };
  raw: `0x${string}`;
  reason: string;
}

function mockReplyCode(o: MockOpts): ReplyCode {
  const sub = (variant?: string, flags: string[] = []): Record<string, boolean> => {
    const out: Record<string, boolean> = {};
    for (const f of flags) out[`is${f}`] = f === variant;
    return out;
  };
  const execution = sub(o.error?.execution, [
    'RanOutOfGas',
    'MemoryOverflow',
    'BackendError',
    'UserspacePanic',
    'UnreachableInstruction',
    'StackLimitExceeded',
  ]);
  const unavailable = sub(o.error?.unavailableActor, [
    'ProgramExited',
    'InitializationFailure',
    'Uninitialized',
    'ProgramNotCreated',
    'ReinstrumentationFailure',
  ]);
  const isSuccess = !!o.success;
  const isError = !!o.error;
  const code = {
    isSuccess,
    isError,
    asSuccess: o.success
      ? { isAuto: !!o.success.auto, isManual: !!o.success.manual }
      : undefined,
    asError: o.error
      ? {
          isExecution: !!o.error.execution,
          asExecution: o.error.execution ? execution : undefined,
          isUnavailableActor: !!o.error.unavailableActor,
          asUnavailableActor: o.error.unavailableActor ? unavailable : undefined,
          isRemovedFromWaitlist: !!o.error.removedFromWaitlist,
        }
      : undefined,
    reason: o.reason,
    toBytes: () => hexToU8(o.raw),
  };
  return code as unknown as ReplyCode;
}

function hexToU8(hex: `0x${string}`): Uint8Array {
  const body = hex.slice(2);
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe('replyCodeTag', () => {
  it('Success.Auto', () => {
    expect(
      replyCodeTag(mockReplyCode({ success: { auto: true }, raw: '0x00000000', reason: 'auto' })),
    ).toBe('Success.Auto');
  });
  it('Success.Manual', () => {
    expect(
      replyCodeTag(mockReplyCode({ success: { manual: true }, raw: '0x00010000', reason: 'manual' })),
    ).toBe('Success.Manual');
  });
  it('Error.Execution.RanOutOfGas', () => {
    expect(
      replyCodeTag(mockReplyCode({ error: { execution: 'RanOutOfGas' }, raw: '0x01000000', reason: 'gas' })),
    ).toBe('Error.Execution.RanOutOfGas');
  });
  it('Error.Execution.UserspacePanic', () => {
    expect(
      replyCodeTag(mockReplyCode({ error: { execution: 'UserspacePanic' }, raw: '0x01000300', reason: 'panic' })),
    ).toBe('Error.Execution.UserspacePanic');
  });
  it('Error.UnavailableActor.Uninitialized', () => {
    expect(
      replyCodeTag(
        mockReplyCode({ error: { unavailableActor: 'Uninitialized' }, raw: '0x01010200', reason: 'uninit' }),
      ),
    ).toBe('Error.UnavailableActor.Uninitialized');
  });
  it('Error.UnavailableActor.ProgramExited', () => {
    expect(
      replyCodeTag(
        mockReplyCode({ error: { unavailableActor: 'ProgramExited' }, raw: '0x01010000', reason: 'exited' }),
      ),
    ).toBe('Error.UnavailableActor.ProgramExited');
  });
  it('Error.RemovedFromWaitlist', () => {
    expect(
      replyCodeTag(
        mockReplyCode({ error: { removedFromWaitlist: true }, raw: '0x01020000', reason: 'expired' }),
      ),
    ).toBe('Error.RemovedFromWaitlist');
  });
});

describe('serializeReplyCode', () => {
  it('emits tag + raw + reason for Success', () => {
    const out = serializeReplyCode(
      mockReplyCode({ success: { auto: true }, raw: '0x00000000', reason: 'auto reply' }),
    );
    expect(out.tag).toBe('Success.Auto');
    expect(out.raw).toBe('0x00000000');
    expect(out.reason).toBe('auto reply');
  });

  it('emits a structured form for Error replies', () => {
    const out = serializeReplyCode(
      mockReplyCode({ error: { execution: 'RanOutOfGas' }, raw: '0x01000000', reason: 'ran out of gas' }),
    );
    expect(out.tag).toBe('Error.Execution.RanOutOfGas');
    expect(out.raw).toBe('0x01000000');
    expect(out.reason).toContain('gas');
  });

  it('output is JSON-serializable and never produces "[object Object]"', () => {
    const out = serializeReplyCode(
      mockReplyCode({ error: { unavailableActor: 'Uninitialized' }, raw: '0x01010200', reason: 'uninit' }),
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain('[object Object]');
    expect(JSON.parse(json)).toEqual(out);
  });
});
