/**
 * Chain dispatch: which rail a command is operating on.
 *
 * `vara` — the substrate chain (default; existing @gear-js/api backend).
 * `ethexe` — the Vara.eth co-processor on Ethereum (new in Phase 3).
 *
 * Precedence: explicit `--chain` > config.defaultChain > 'vara'.
 */

import { CliError } from '../utils/errors';

export type Chain = 'vara' | 'ethexe';

export const VALID_CHAINS: readonly Chain[] = ['vara', 'ethexe'] as const;

/**
 * Resolves which chain the current command should target.
 *
 * @param explicit - value of the `--chain` flag (string from CLI), may be undefined
 * @param configDefault - value of `config.defaultChain` from `~/.vara-wallet/config.json`
 * @returns the resolved {@link Chain}
 * @throws {@link CliError} when an unknown chain name is passed
 */
export function resolveChain(explicit?: string, configDefault?: string): Chain {
  const raw = explicit ?? configDefault ?? 'vara';
  if (!isChain(raw)) {
    throw new CliError(`Unknown chain "${raw}". Valid: ${VALID_CHAINS.join(', ')}`, 'INVALID_CHAIN', { chain: raw });
  }
  return raw;
}

export function isChain(value: unknown): value is Chain {
  return typeof value === 'string' && (VALID_CHAINS as readonly string[]).includes(value);
}
