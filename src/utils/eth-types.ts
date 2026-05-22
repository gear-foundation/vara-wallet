/**
 * Argument validators shared across Vara.eth commands.
 *
 * Centralises the regex-based checks for 0x-hex strings, 20-byte addresses,
 * and decimal bigints. Each command file used to ship its own copies; this
 * module replaces five duplicates with one.
 */

import { isAddress, isHex, type Address, type Hex } from 'viem';

import { CliError } from './errors';

/** Validates a CLI argument as a 0x-prefixed hex string. */
export function asHex(value: string, field: string): Hex {
  if (!isHex(value)) {
    throw new CliError(`${field} must be a 0x-prefixed hex string`, 'INVALID_HEX', { field, value });
  }
  return value;
}

/** Validates a CLI argument as a 20-byte 0x-prefixed Ethereum address. */
export function asAddress(value: string, field: string): Address {
  // strict: false lets non-checksummed hex addresses through — agents often
  // paste lowercase strings; we don't want to fail them on EIP-55 capitalisation.
  if (!isAddress(value, { strict: false })) {
    throw new CliError(`${field} must be a 20-byte 0x-prefixed address`, 'INVALID_ADDRESS', { field, value });
  }
  return value;
}

/** Parses an optional decimal-string CLI argument into a bigint. */
export function parseOptionalBigInt(raw: string | undefined, field: string): bigint | undefined {
  if (raw === undefined) return undefined;
  try {
    return BigInt(raw);
  } catch {
    throw new CliError(`${field} must be an integer`, 'INVALID_BIGINT', { field, value: raw });
  }
}

/** Parses an optional decimal CLI argument into a positive safe integer. */
export function parseOptionalPositiveInteger(
  raw: string | undefined,
  field: string,
  code = 'INVALID_INTEGER',
): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new CliError(`${field} must be a positive integer`, code, { field, value: raw });
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new CliError(`${field} must be a positive integer`, code, { field, value: raw });
  }
  return value;
}
