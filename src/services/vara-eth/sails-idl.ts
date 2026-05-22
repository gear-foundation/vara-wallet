import { hexToBytes, type Address, type Hex } from 'viem';

import { readCachedIdl, writeCachedIdl, evictCachedIdl } from '../idl-cache';
import {
  detectIdlVersion,
  parseIdlFileAuto,
  parseIdlStringAuto,
  type LoadedSails,
} from '../sails';
import { extractSailsIdl } from '../wasm-section';
import { CliError, errorMessage, verbose } from '../../utils';

const MAX_WASM_BYTES = 10 * 1024 * 1024;

export interface VaraEthSailsMethodRequirement {
  service: string;
  method: string;
}

export interface LoadedVaraEthSails {
  sails: LoadedSails;
  codeId: Hex | null;
  source: 'local' | 'cache' | 'chain';
}

export async function loadVaraEthSails(
  api: {
    query: {
      program: { codeId(programAddress: Address): Promise<Hex> };
      code: { getOriginal(codeId: Hex): Promise<Hex> };
    };
  },
  programAddress: Address,
  options: { idl?: string; requiredMethod?: VaraEthSailsMethodRequirement } = {},
): Promise<LoadedVaraEthSails> {
  if (options.idl) {
    verbose(`Loading Vara.eth IDL from file: ${options.idl}`);
    return {
      sails: await parseIdlFileAuto(options.idl),
      codeId: null,
      source: 'local',
    };
  }

  let codeId: Hex;
  try {
    codeId = await api.query.program.codeId(programAddress);
    verbose(`Resolved Vara.eth codeId for ${programAddress}: ${codeId}`);
  } catch (err) {
    throw new CliError(
      `No IDL source available for Vara.eth program ${programAddress}: failed to resolve codeId (${errorMessage(err)}). Pass --idl <path.idl> for a one-off call.`,
      'IDL_NOT_FOUND',
      { programAddress },
    );
  }

  const cached = readCachedIdl(codeId);
  if (cached) {
    try {
      const sails = await parseIdlStringAuto(cached.idl);
      if (matchesRequirement(sails, options.requiredMethod)) {
        verbose(`Vara.eth IDL cache hit: ${codeId} (source=${cached.meta.source})`);
        return { sails, codeId, source: 'cache' };
      }
      verbose(`Vara.eth IDL cache hit but required method was missing; evicting ${codeId}`);
      evictCachedIdl(codeId);
    } catch (err) {
      verbose(`Vara.eth IDL cache entry failed to parse; evicting ${codeId}: ${errorMessage(err)}`);
      evictCachedIdl(codeId);
    }
  }

  const wasmHex = await readOriginalCode(api, codeId);
  const wasm = hexToBytes(wasmHex);
  if (wasm.length > MAX_WASM_BYTES) {
    throw new CliError(
      `No IDL source available for Vara.eth program ${programAddress}: original WASM for codeId ${codeId} is too large to inspect (${wasm.length} bytes). Pass --idl <path.idl>.`,
      'IDL_NOT_FOUND',
      { programAddress, codeId, wasmSizeBytes: wasm.length },
    );
  }

  let idl: string | null;
  try {
    idl = await extractSailsIdl(wasm);
  } catch (err) {
    throw new CliError(
      `Failed to extract sails:idl from Vara.eth code ${codeId}: ${errorMessage(err)}`,
      'IDL_PARSE_ERROR',
      { programAddress, codeId },
    );
  }
  if (idl === null) {
    throw new CliError(
      `No IDL available for Vara.eth program ${programAddress}. The code is readable, but it has no \`sails:idl\` custom section. Pass --idl <path.idl> or import the IDL with "vara-wallet idl import <path.idl> --code-id ${codeId}".`,
      'IDL_NOT_FOUND',
      { programAddress, codeId },
    );
  }

  const sails = await parseIdlStringAuto(idl);
  if (!matchesRequirement(sails, options.requiredMethod)) {
    throw new CliError(
      `Embedded IDL for Vara.eth program ${programAddress} does not contain ${options.requiredMethod?.service}/${options.requiredMethod?.method}`,
      'METHOD_NOT_FOUND',
      { programAddress, codeId },
    );
  }

  writeCachedIdl(codeId, idl, {
    version: detectIdlVersion(idl),
    source: 'chain',
    importedAt: new Date().toISOString(),
  });
  return { sails, codeId, source: 'chain' };
}

async function readOriginalCode(
  api: { query: { code: { getOriginal(codeId: Hex): Promise<Hex> } } },
  codeId: Hex,
): Promise<Hex> {
  try {
    return await api.query.code.getOriginal(codeId);
  } catch (err) {
    throw new CliError(
      `No IDL source available for Vara.eth code ${codeId}: failed to read original code (${errorMessage(err)}). Pass --idl <path.idl>.`,
      'IDL_NOT_FOUND',
      { codeId },
    );
  }
}

function matchesRequirement(sails: LoadedSails, required: VaraEthSailsMethodRequirement | undefined): boolean {
  if (!required) return true;
  const service = sails.services[required.service];
  if (!service) return false;
  return required.method in service.queries || required.method in service.functions;
}
