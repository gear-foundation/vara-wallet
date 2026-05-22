import { parseIdlFileAuto } from './sails';
import {
  CliError,
  coerceArgsAuto,
  loadArgsJson,
  validateTopLevelArgs,
  verbose,
} from '../utils';

export interface InitOptions {
  payload: string;
  idl?: string;
  init?: string;
  args?: string;
  argsFile?: string;
}

/**
 * Resolve the init payload AND the resolved constructor name (for IDL-based
 * encoding) or `null` (for raw `--payload` flows). Used by dry-run branches so
 * output reports the actually-selected constructor name when --init was
 * auto-resolved from a single-ctor IDL.
 */
export async function resolveInitDescriptor(options: InitOptions): Promise<{ payload: string; init: string | null }> {
  if (!options.idl) {
    if (options.init) throw new CliError('--init requires --idl', 'MISSING_IDL');
    if (options.args) throw new CliError('--args requires --idl', 'MISSING_IDL');
    if (options.argsFile) throw new CliError('--args-file requires --idl', 'MISSING_IDL');
    return { payload: options.payload, init: null };
  }

  if (options.payload !== '0x') {
    throw new CliError('--payload and --idl are mutually exclusive. Use --idl with --args for Sails encoding, or --payload for raw hex.', 'MUTUALLY_EXCLUSIVE_OPTIONS');
  }

  const sails = await parseIdlFileAuto(options.idl);
  const ctors = sails.ctors;
  if (!ctors || Object.keys(ctors).length === 0) {
    throw new CliError('IDL has no constructors defined', 'NO_CONSTRUCTORS');
  }

  const ctorNames = Object.keys(ctors);
  let initName = options.init;
  if (!initName) {
    if (ctorNames.length === 1) {
      initName = ctorNames[0];
      verbose(`Auto-selected constructor: ${initName}`);
    } else {
      throw new CliError(
        `Multiple constructors found: ${ctorNames.join(', ')}. Use --init <name> to select one.`,
        'MULTIPLE_CONSTRUCTORS',
      );
    }
  }

  const ctor = ctors[initName];
  if (!ctor) {
    throw new CliError(
      `Constructor "${initName}" not found. Available: ${ctorNames.join(', ')}`,
      'CONSTRUCTOR_NOT_FOUND',
    );
  }

  let args: unknown[] = [];
  if (options.args !== undefined || options.argsFile !== undefined) {
    const parsed = loadArgsJson({
      args: options.args,
      argsFile: options.argsFile,
    });
    const arity = ctor.args?.length ?? 0;
    args = validateTopLevelArgs(parsed, arity, { kind: 'Constructor', name: initName });
  }

  const expectedArgs = ctor.args?.length ?? 0;
  if (args.length !== expectedArgs) {
    throw new CliError(
      `Constructor "${initName}" expects ${expectedArgs} arg(s), got ${args.length}`,
      'CONSTRUCTOR_ARG_MISMATCH',
    );
  }

  verbose(`Encoding constructor "${initName}" with ${args.length} arg(s)`);
  args = coerceArgsAuto(args, ctor.args || [], sails);
  try {
    return { payload: ctor.encodePayload(...args), init: initName };
  } catch (err) {
    throw new CliError(
      `Failed to encode constructor args: ${err instanceof Error ? err.message : String(err)}`,
      'ENCODE_ERROR',
    );
  }
}

export async function resolveInitPayload(options: InitOptions): Promise<string> {
  return (await resolveInitDescriptor(options)).payload;
}
