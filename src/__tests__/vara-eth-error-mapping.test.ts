/**
 * Verifies that VaraEthError subclasses thrown from @vara-eth/api are
 * surfaced with their stable string codes (not folded into INTERNAL_ERROR
 * by classifyError). Specifically MessageRevertedError must emit
 * `{ code: 'MESSAGE_REVERTED', reason, functionName }` so wallet consumers
 * can branch on the typed code rather than regex on the message.
 */

import { MessageRevertedError, NoSailsIdlError, VaraEthErrorCode } from '@vara-eth/api';
import { formatError } from '../utils/errors';

describe('formatError on VaraEthError', () => {
  it('surfaces MessageRevertedError as MESSAGE_REVERTED with reason + functionName', () => {
    const err = new MessageRevertedError('InitMessageNotCreatedAndCallerNotInitializer()', 'sendMessage');
    const out = formatError(err);
    expect(out.code).toBe('MESSAGE_REVERTED');
    expect(out.reason).toBe('InitMessageNotCreatedAndCallerNotInitializer()');
    expect(out.functionName).toBe('sendMessage');
    expect(out.error).toContain('reverted');
  });

  it('keeps MessageRevertedError typed when its cause includes contract revert data', () => {
    const err = new MessageRevertedError('InitMessageNotCreatedAndCallerNotInitializer()', 'sendMessage') as Error & {
      cause?: unknown;
    };
    err.cause = { data: '0xdeadbeef' };

    const out = formatError(err);

    expect(out.code).toBe('MESSAGE_REVERTED');
    expect(out.reason).toBe('InitMessageNotCreatedAndCallerNotInitializer()');
    expect(out.functionName).toBe('sendMessage');
    expect(out).not.toHaveProperty('contractError');
  });

  it('surfaces other VaraEthError subclasses with their .code', () => {
    const out = formatError(new NoSailsIdlError());
    expect(out.code).toBe(VaraEthErrorCode.NoSailsIdl);
    expect(out.error).toContain('sails_idl');
  });

  it('falls through to generic INTERNAL_ERROR for non-VaraEth Error instances', () => {
    const out = formatError(new Error('plain'));
    expect(out.code).toBe('INTERNAL_ERROR');
  });
});
