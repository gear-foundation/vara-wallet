import { createInterface } from 'node:readline';

import { Command } from 'commander';
import type { Address, Hex } from 'viem';

import {
  decodeVaraEthSailsReply,
  parseSailsMethod,
  resolveSailsMethod,
  type SailsMethodLike,
} from './vara-eth-actions';
import { resolveEthexeSigner, type EthexeAccountOptions } from '../services/vara-eth/account';
import { getEthexeApi } from '../services/vara-eth/api';
import { loadVaraEthSails, type LoadedVaraEthSails } from '../services/vara-eth/sails-idl';
import { serializeReplyCode } from '../shared/output-eth/reply-code';
import { coerceArgsAuto, CliError, errorMessage, outputNdjson } from '../utils';
import { asAddress } from '../utils/eth-types';

export interface SessionOptions extends EthexeAccountOptions {}

interface SessionCall {
  id?: string | number;
  program: string;
  method: string;
  args?: unknown[];
  idl?: string;
}

function requestId(request: unknown): string | number | null {
  return request !== null && typeof request === 'object' && 'id' in request
    && (typeof (request as { id?: unknown }).id === 'string' || typeof (request as { id?: unknown }).id === 'number')
    ? (request as { id: string | number }).id
    : null;
}

function sessionError(id: string | number | null, error: unknown): void {
  const cli = error instanceof CliError ? error : null;
  outputNdjson({
    type: 'error',
    id,
    error: {
      code: cli?.code ?? 'SESSION_REQUEST_FAILED',
      message: errorMessage(error),
      ...(cli?.meta ?? {}),
    },
  });
}

function parseRequest(line: string): SessionCall {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new CliError('Session request must be valid JSON', 'INVALID_SESSION_REQUEST');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError('Session request must be an object', 'INVALID_SESSION_REQUEST');
  }
  const request = parsed as SessionCall;
  if (typeof request.program !== 'string' || typeof request.method !== 'string') {
    throw new CliError('Session request requires string fields "program" and "method"', 'INVALID_SESSION_REQUEST');
  }
  if (request.args !== undefined && !Array.isArray(request.args)) {
    throw new CliError('Session request "args" must be a JSON array', 'INVALID_ARGS_FORMAT');
  }
  if (request.idl !== undefined && typeof request.idl !== 'string') {
    throw new CliError('Session request "idl" must be a string path', 'INVALID_SESSION_REQUEST');
  }
  return request;
}

function assertSuccessReply(code: { isSuccess: boolean }): void {
  if (!code.isSuccess) throw new CliError('Sails query returned a non-success reply', 'PROGRAM_ERROR');
}

export function registerVaraEthSessionCommand(program: Command): void {
  program
    .command('vara-eth:session')
    .description('Persistent NDJSON Vara.eth Sails session for autonomous agents')
    .option('--account <name>', 'Vara.eth wallet name')
    .option('--passphrase <pass>', 'wallet passphrase')
    .action(async (_options: SessionOptions, command: Command) => {
      if (process.stdin.isTTY) {
        throw new CliError('vara-eth:session requires NDJSON requests on stdin', 'STDIN_REQUIRED');
      }

      const opts = command.optsWithGlobals() as SessionOptions;
      await runVaraEthSession(opts);
    });
}

export async function runVaraEthSession(
  opts: SessionOptions,
  input: NodeJS.ReadableStream = process.stdin,
): Promise<void> {
  const api = await getEthexeApi();
  const signer = await resolveEthexeSigner(api.eth.publicClient, opts);
  api.eth.setSigner(signer);
  const origin = await signer.getAddress() as Address;
  const idls = new Map<string, LoadedVaraEthSails>();

  outputNdjson({ type: 'ready', chain: 'vara-eth', origin });

  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let raw: unknown = null;
    try {
      raw = JSON.parse(line);
      const request = parseRequest(line);
      const id = requestId(raw);
      const programAddress = asAddress(request.program, 'program');
      const { serviceName, methodName } = parseSailsMethod(request.method);
      const cacheKey = `${programAddress.toLowerCase()}|${request.idl ?? ''}`;
      let loaded = idls.get(cacheKey);
      if (!loaded) {
        loaded = await loadVaraEthSails(api, programAddress, {
          idl: request.idl,
          requiredMethod: { service: serviceName, method: methodName },
        });
        idls.set(cacheKey, loaded);
      }
      const resolved = resolveSailsMethod(loaded.sails, serviceName, methodName);
      const args = coerceArgsAuto(request.args ?? [], resolved.method.args || [], loaded.sails, serviceName);
      const payload = resolved.method.encodePayload(...args) as Hex;

      if (resolved.kind === 'query') {
        const reply = await api.call.program.calculateReplyForHandle(origin, programAddress, payload, 0n);
        assertSuccessReply(reply.code);
        outputNdjson({
          type: 'result',
          id,
          kind: 'query',
          programAddress,
          service: serviceName,
          method: methodName,
          result: decodeVaraEthSailsReply(loaded.sails, resolved.method as SailsMethodLike, serviceName, reply.payload),
          reply: { payload: reply.payload, value: String(reply.value), code: serializeReplyCode(reply.code) },
        });
        continue;
      }

      const injected = await api.createInjectedTransaction({ destination: programAddress, payload, value: 0n });
      injected.setDefaultValidator();
      await injected.send();
      outputNdjson({
        type: 'result',
        id,
        kind: 'function',
        status: 'submitted',
        programAddress,
        service: serviceName,
        method: methodName,
        txHash: injected.txHash,
        messageId: injected.messageId,
      });
    } catch (error) {
      sessionError(requestId(raw), error);
    }
  }
}
