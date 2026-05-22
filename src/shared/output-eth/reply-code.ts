/**
 * Serializer for `@vara-eth/api`'s `ReplyCode` discriminated-union object.
 *
 * `ReplyCode.toString()` produces `"[object Object]"`. The lib exposes the
 * discriminants as `isSuccess`/`isError` + nested `isAuto`/`isManual` etc.
 * For JSON output we surface three fields:
 *
 *   - `tag`: short dotted discriminator (e.g. `"Error.Execution.RanOutOfGas"`)
 *   - `raw`: hex of the underlying 4 bytes (lossless round-trip)
 *   - `reason`: the prose `ReplyCode.reason` getter (human-readable)
 */

import { bytesToHex } from 'viem';
import type { ReplyCode } from '@vara-eth/api';

export interface SerializedReplyCode {
  tag: string;
  raw: `0x${string}`;
  reason: string;
}

export function serializeReplyCode(code: ReplyCode): SerializedReplyCode {
  return {
    tag: replyCodeTag(code),
    raw: bytesToHex(code.toBytes()),
    reason: code.reason,
  };
}

/** Short dotted discriminator. Stable for use as a typed-error code or filter key. */
export function replyCodeTag(code: ReplyCode): string {
  if (code.isSuccess) {
    const s = code.asSuccess;
    if (s.isAuto) return 'Success.Auto';
    if (s.isManual) return 'Success.Manual';
    return 'Success.Unknown';
  }
  if (code.isError) {
    const e = code.asError;
    if (e.isExecution) {
      const x = e.asExecution;
      if (x.isRanOutOfGas) return 'Error.Execution.RanOutOfGas';
      if (x.isMemoryOverflow) return 'Error.Execution.MemoryOverflow';
      if (x.isBackendError) return 'Error.Execution.BackendError';
      if (x.isUserspacePanic) return 'Error.Execution.UserspacePanic';
      if (x.isUnreachableInstruction) return 'Error.Execution.UnreachableInstruction';
      if (x.isStackLimitExceeded) return 'Error.Execution.StackLimitExceeded';
      return 'Error.Execution.Unknown';
    }
    if (e.isUnavailableActor) {
      const u = e.asUnavailableActor;
      if (u.isProgramExited) return 'Error.UnavailableActor.ProgramExited';
      if (u.isInitializationFailure) return 'Error.UnavailableActor.InitializationFailure';
      if (u.isUninitialized) return 'Error.UnavailableActor.Uninitialized';
      if (u.isProgramNotCreated) return 'Error.UnavailableActor.ProgramNotCreated';
      if (u.isReinstrumentationFailure) return 'Error.UnavailableActor.ReinstrumentationFailure';
      return 'Error.UnavailableActor.Unknown';
    }
    if (e.isRemovedFromWaitlist) return 'Error.RemovedFromWaitlist';
    return 'Error.Unknown';
  }
  return 'Unknown';
}
