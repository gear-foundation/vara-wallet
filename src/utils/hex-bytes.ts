import { SailsProgram, type Sails, type TypeDecl, type TypeResolver } from 'sails-js';
import { CliError } from './errors';
import { addressToHex } from './address';
import { getRegistryTypes, getV2TypeResolver } from '../services/sails';

const HEX_RE = /^0x[0-9a-fA-F]+$/;
const ACTOR_ID_HEX_RE = /^0x[0-9a-fA-F]{64}$/;

type FixedU8ArrayMatch = { match: true; len: number } | { match: false };

/**
 * Check if a typeDef represents `vec u8`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isVecU8(typeDef: any): boolean {
  return (
    typeDef.isVec &&
    typeDef.asVec.def.isPrimitive &&
    typeDef.asVec.def.asPrimitive.isU8
  );
}

/**
 * Check if a typeDef represents `[u8; N]`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isFixedU8Array(typeDef: any): FixedU8ArrayMatch {
  if (
    typeDef.isFixedSizeArray &&
    typeDef.asFixedSizeArray.def.isPrimitive &&
    typeDef.asFixedSizeArray.def.asPrimitive.isU8
  ) {
    return { match: true, len: typeDef.asFixedSizeArray.len };
  }
  return { match: false };
}

/**
 * Is `value` a non-empty `0x`-prefixed hex string? Used to gate the
 * coercion branches — the bare `0x` sentinel passes through unchanged
 * (tested behavior), and anything else is left for downstream encoders
 * to validate in context.
 */
function isNonEmptyHex(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && value.startsWith('0x') && value.length > 2;
}

/**
 * Convert a hex string to a byte array, with validation.
 */
function hexToBytes(value: string, fieldHint?: string): number[] {
  const hex = value.slice(2); // strip 0x
  if (hex.length % 2 !== 0) {
    throw new CliError(
      `Odd-length hex string for byte field${fieldHint ? ` "${fieldHint}"` : ''}: "${value}"`,
      'INVALID_HEX_BYTES',
    );
  }
  if (!HEX_RE.test(value)) {
    throw new CliError(
      `Invalid hex characters in byte field${fieldHint ? ` "${fieldHint}"` : ''}: "${value}"`,
      'INVALID_HEX_BYTES',
    );
  }
  return Array.from(Buffer.from(hex, 'hex'));
}

/**
 * Coerce an ActorId arg: accept canonical 32-byte hex as-is (byte-identical
 * with pre-ActorId-SS58 behavior), or SS58 via `addressToHex`. Non-string
 * values pass through so downstream encoders can accept pre-decoded shapes
 * (e.g. `number[]` of length 32).
 *
 * `addressToHex` wraps `decodeAddress`, which also accepts arbitrary-length
 * hex (e.g. 20-byte Ethereum-style strings). Those decode to the wrong
 * length for an ActorId, so we re-validate the output against the 32-byte
 * regex and throw at this layer instead of letting the downstream SCALE
 * encoder produce an opaque length error.
 */
function tryActorIdToHex(value: unknown, fieldHint?: string): unknown {
  // Plain objects are never a legitimate ActorId shape. Reject explicitly
  // so callers see "Invalid ActorId: object" instead of cryptic codec
  // errors when malformed JSON (e.g. `{"address":"0x..."}`) leaks through.
  // Arrays still pass through — pre-decoded `number[]` of length 32 is a
  // legitimate SCALE codec input shape.
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const preview = JSON.stringify(value) ?? String(value);
    const truncated = preview.length > 100 ? preview.slice(0, 100) + '...' : preview;
    throw new CliError(
      `Invalid ActorId${fieldHint ? ` for "${fieldHint}"` : ''}: expected hex string, SS58 address, or 32-byte array, got object: ${truncated}`,
      'INVALID_ADDRESS',
    );
  }
  if (typeof value !== 'string') return value;
  if (ACTOR_ID_HEX_RE.test(value)) return value;
  try {
    const hex = addressToHex(value);
    if (!ACTOR_ID_HEX_RE.test(hex)) {
      throw new Error('decoded to non-32-byte length');
    }
    return hex;
  } catch {
    throw new CliError(
      `Invalid ActorId${fieldHint ? ` for "${fieldHint}"` : ''}: "${value}". Expected hex (0x… 64 chars) or SS58 address.`,
      'INVALID_ADDRESS',
    );
  }
}

/**
 * If `value` is a `0x`-prefixed hex string, convert it to a byte array.
 * When `expectedLen` is provided, throw if the decoded length doesn't
 * match — used by `[u8; N]` and fixed-width array branches. Returns
 * the value unchanged if it isn't a hex string (so downstream encoders
 * can accept pre-decoded bytes).
 */
function tryHexToBytes(value: unknown, fieldHint?: string, expectedLen?: number): unknown {
  if (!isNonEmptyHex(value)) return value;
  const bytes = hexToBytes(value, fieldHint);
  if (expectedLen !== undefined && bytes.length !== expectedLen) {
    throw new CliError(
      `Hex string decodes to ${bytes.length} bytes but [u8; ${expectedLen}] expects ${expectedLen} bytes${fieldHint ? ` for "${fieldHint}"` : ''}`,
      'INVALID_HEX_BYTES',
    );
  }
  return bytes;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TypeMap = Map<string, any>;

/**
 * Recursively walk a value alongside its IDL type definition,
 * converting hex strings to byte arrays for `vec u8` and `[u8; N]` fields.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function coerceHexToBytes(value: unknown, typeDef: any, typeMap: TypeMap, fieldHint?: string): unknown {
  if (value === null || value === undefined) return value;

  // Resolve UserDefined types to their actual definitions
  if (typeDef.isUserDefined) {
    const resolved = typeMap.get(typeDef.asUserDefined.name);
    if (!resolved) return value; // Unknown type, pass through
    return coerceHexToBytes(value, resolved, typeMap, fieldHint);
  }

  // ActorId primitive: accept SS58 or canonical hex, normalize to hex.
  if (typeDef.isPrimitive && typeDef.asPrimitive?.isActorId) {
    return tryActorIdToHex(value, fieldHint);
  }

  // vec u8: convert hex string to byte array
  if (isVecU8(typeDef)) return tryHexToBytes(value, fieldHint);

  // [u8; N]: convert hex string to byte array, validate length
  const fixed = isFixedU8Array(typeDef);
  if (fixed.match) return tryHexToBytes(value, fieldHint, fixed.len);

  // Struct: recurse into each field
  if (typeDef.isStruct && typeof value === 'object' && !Array.isArray(value)) {
    const struct = typeDef.asStruct;
    const result: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const field of struct.fields) {
      if (field.name in result) {
        result[field.name] = coerceHexToBytes(result[field.name], field.def, typeMap, field.name);
      }
    }
    return result;
  }

  // Enum: match variant and recurse into payload
  if (typeDef.isEnum && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const variant of typeDef.asEnum.variants) {
      if (variant.name in obj) {
        const variantDef = variant.def;
        if (variantDef?.isPrimitive && variantDef.asPrimitive?.isNull) {
          return value; // Unit variant, no payload
        }
        return { [variant.name]: coerceHexToBytes(obj[variant.name], variantDef, typeMap, variant.name) };
      }
    }
    return value;
  }

  // Optional: recurse into inner type
  if (typeDef.isOptional) {
    return coerceHexToBytes(value, typeDef.asOptional.def, typeMap, fieldHint);
  }

  // Result: recurse into ok/err
  if (typeDef.isResult && typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if ('ok' in obj) {
      return { ok: coerceHexToBytes(obj.ok, typeDef.asResult.ok.def, typeMap, 'ok') };
    }
    if ('err' in obj) {
      return { err: coerceHexToBytes(obj.err, typeDef.asResult.err.def, typeMap, 'err') };
    }
    return value;
  }

  // Vec (non-u8): recurse into elements
  if (typeDef.isVec && Array.isArray(value)) {
    return value.map((item) => coerceHexToBytes(item, typeDef.asVec.def, typeMap, fieldHint));
  }

  // Map: recurse into values
  if (typeDef.isMap && typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = coerceHexToBytes(v, typeDef.asMap.value.def, typeMap, k);
    }
    return result;
  }

  return value;
}

/**
 * Coerce args for a Sails v1 method/constructor call.
 * Walks the IDL type tree alongside the args, converting hex strings to byte arrays
 * for `vec u8` and `[u8; N]` typed fields.
 *
 * Falls back to returning args unchanged if type information is unavailable.
 */
export function coerceArgs(
  args: unknown[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  argDefs: Array<{ name: string; typeDef: any }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sails: any,
): unknown[] {
  if (args.length === 0) return args;

  // Build type map from sails internal program types
  let typeMap: TypeMap;
  try {
    typeMap = getRegistryTypes(sails);
  } catch {
    return args; // Graceful fallback
  }

  return args.map((arg, i) => {
    if (i >= argDefs.length) return arg;
    return coerceHexToBytes(arg, argDefs[i].typeDef, typeMap, argDefs[i].name);
  });
}

// ────────────────────────────────────────────────────────────────────────
// IDL v2 walker — parallel implementation over the new TypeDecl shape.
//
// v2 TypeDecl is a discriminated union:
//   - PrimitiveType (string literal: 'u8' | 'String' | 'ActorId' | …)
//   - { kind: 'slice',  item: TypeDecl }
//   - { kind: 'array',  item: TypeDecl, len: number }
//   - { kind: 'tuple',  types: TypeDecl[] }
//   - { kind: 'generic', name: string }
//   - { kind: 'named',  name: string, generics?: TypeDecl[] }
//
// User-defined types (from program.types) are separate `Type` entries:
//   - { kind: 'struct', name, fields: [{name?, type}] }
//   - { kind: 'enum',   name, variants: [{name, fields: [{name?, type}]}] }
//   - { kind: 'alias',  name, target: TypeDecl }
// ────────────────────────────────────────────────────────────────────────

type V2TypeDecl =
  | string
  | { kind: 'slice'; item: V2TypeDecl }
  | { kind: 'array'; item: V2TypeDecl; len: number }
  | { kind: 'tuple'; types: V2TypeDecl[] }
  | { kind: 'generic'; name: string }
  | { kind: 'named'; name: string; generics?: V2TypeDecl[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type V2Type = any; // struct | enum | alias — loose to avoid deep type churn

type V2TypeMap = Map<string, V2Type>;
type V2TypeLookup = V2TypeMap | TypeResolver;

function resolveV2UserType(typeDecl: V2TypeDecl, typeLookup: V2TypeLookup): V2Type | undefined {
  if (typeof typeDecl === 'string' || typeDecl.kind !== 'named') return undefined;
  if ('resolveNamed' in typeLookup) {
    return typeLookup.resolveNamed(typeDecl as TypeDecl);
  }
  return typeLookup.get(typeDecl.name);
}

function isV2PrimitiveU8(typeDecl: V2TypeDecl): boolean {
  return typeof typeDecl === 'string' && typeDecl === 'u8';
}

function isV2SliceU8(typeDecl: V2TypeDecl): boolean {
  return typeof typeDecl === 'object' && typeDecl.kind === 'slice' && isV2PrimitiveU8(typeDecl.item);
}

function isV2ArrayU8(typeDecl: V2TypeDecl): FixedU8ArrayMatch {
  if (typeof typeDecl === 'object' && typeDecl.kind === 'array' && isV2PrimitiveU8(typeDecl.item)) {
    return { match: true, len: typeDecl.len };
  }
  return { match: false };
}

/**
 * v2 equivalent of coerceHexToBytes.
 * Walks a TypeDecl (v2 IDL shape) and converts hex strings to byte arrays
 * for `vec u8` (slice<u8>, Vec<u8>) and `[u8; N]` fields.
 *
 * Generic user-defined types are resolved through the beta.2 TypeResolver,
 * which returns a concrete copy with `{ kind: 'generic' }` leaves substituted.
 */
export function coerceHexToBytesV2(
  value: unknown,
  typeDecl: V2TypeDecl,
  typeLookup: V2TypeLookup,
  fieldHint?: string,
): unknown {
  if (value === null || value === undefined) return value;

  // ActorId primitive: accept SS58 or canonical hex, normalize to hex.
  // MUST precede the `typeof typeDecl === 'string'` fallthrough below —
  // otherwise 'ActorId' matches as a generic string primitive and the
  // value returns unchanged, silently swallowing SS58 input.
  if (typeDecl === 'ActorId') return tryActorIdToHex(value, fieldHint);

  // Slice of u8 → bytes
  if (isV2SliceU8(typeDecl)) return tryHexToBytes(value, fieldHint);

  // Fixed array of u8 → bytes with length validation
  const fixed = isV2ArrayU8(typeDecl);
  if (fixed.match) return tryHexToBytes(value, fieldHint, fixed.len);

  // PrimitiveType (string literal): no byte fields to coerce
  if (typeof typeDecl === 'string') return value;

  // Slice (non-u8): recurse elements
  if (typeDecl.kind === 'slice') {
    if (Array.isArray(value)) {
      return value.map((item) => coerceHexToBytesV2(item, typeDecl.item, typeLookup, fieldHint));
    }
    return value;
  }

  // Array (non-u8): recurse elements
  if (typeDecl.kind === 'array') {
    if (Array.isArray(value)) {
      return value.map((item) => coerceHexToBytesV2(item, typeDecl.item, typeLookup, fieldHint));
    }
    return value;
  }

  // Tuple: recurse by index
  if (typeDecl.kind === 'tuple') {
    if (Array.isArray(value)) {
      return typeDecl.types.map((t, i) => coerceHexToBytesV2((value as unknown[])[i], t, typeLookup, fieldHint));
    }
    return value;
  }

  if (typeDecl.kind === 'generic') {
    return value;
  }

  // Named type: well-known generics or user-defined
  if (typeDecl.kind === 'named') {
    const { name, generics } = typeDecl;

    // Well-known wrappers.
    if (name === 'Option' && generics && generics.length === 1) {
      return coerceHexToBytesV2(value, generics[0], typeLookup, fieldHint);
    }
    if (name === 'Result' && generics && generics.length === 2 && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if ('ok' in obj) return { ok: coerceHexToBytesV2(obj.ok, generics[0], typeLookup, 'ok') };
      if ('err' in obj) return { err: coerceHexToBytesV2(obj.err, generics[1], typeLookup, 'err') };
      return value;
    }
    if (name === 'Vec' && generics && generics.length === 1) {
      const inner = generics[0];
      // Vec<u8> → bytes via hex coercion
      if (isV2PrimitiveU8(inner)) return tryHexToBytes(value, fieldHint);
      if (Array.isArray(value)) {
        return value.map((item) => coerceHexToBytesV2(item, inner, typeLookup, fieldHint));
      }
      return value;
    }
    if ((name === 'Map' || name === 'BTreeMap' || name === 'HashMap') && generics && generics.length === 2 && typeof value === 'object' && !Array.isArray(value)) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = coerceHexToBytesV2(v, generics[1], typeLookup, k);
      }
      return result;
    }

    // User-defined type: look up in type resolver/map and recurse.
    const userType = resolveV2UserType(typeDecl, typeLookup);
    if (!userType) return value; // Unknown type, pass through

    // Alias: recurse into target.
    if (userType.kind === 'alias' && userType.target) {
      return coerceHexToBytesV2(value, userType.target, typeLookup, fieldHint);
    }

    // Struct: recurse into fields
    if (userType.kind === 'struct' && userType.fields && typeof value === 'object' && !Array.isArray(value)) {
      const fields = userType.fields as Array<{ name?: string; type: V2TypeDecl }>;
      const result: Record<string, unknown> = { ...(value as Record<string, unknown>) };
      for (const field of fields) {
        if (field.name && field.name in result) {
          result[field.name] = coerceHexToBytesV2(result[field.name], field.type, typeLookup, field.name);
        }
      }
      return result;
    }

    // Struct (tuple-shaped — all fields unnamed): recurse by index
    if (userType.kind === 'struct' && userType.fields && Array.isArray(value)) {
      const fields = userType.fields as Array<{ name?: string; type: V2TypeDecl }>;
      return fields.map((f, i) => coerceHexToBytesV2((value as unknown[])[i], f.type, typeLookup, f.name));
    }

    // Enum: match variant and recurse into payload fields
    if (userType.kind === 'enum' && userType.variants && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      const variants = userType.variants as Array<{ name: string; fields: Array<{ name?: string; type: V2TypeDecl }> }>;
      for (const variant of variants) {
        if (variant.name in obj) {
          if (!variant.fields || variant.fields.length === 0) {
            return value; // unit variant
          }
          const payload = obj[variant.name];
          if (variant.fields.length === 1 && !variant.fields[0].name) {
            // Single unnamed field: payload is the raw value
            return { [variant.name]: coerceHexToBytesV2(payload, variant.fields[0].type, typeLookup, variant.name) };
          }
          // Struct-shaped variant payload
          if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
            const result: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
            for (const f of variant.fields) {
              if (f.name && f.name in result) {
                result[f.name] = coerceHexToBytesV2(result[f.name], f.type, typeLookup, f.name);
              }
            }
            return { [variant.name]: result };
          }
          // Tuple-shaped variant payload (array)
          if (Array.isArray(payload)) {
            return { [variant.name]: variant.fields.map((f, i) => coerceHexToBytesV2((payload as unknown[])[i], f.type, typeLookup, f.name)) };
          }
          return value;
        }
      }
      return value;
    }

    return value;
  }

  return value;
}

/**
 * Coerce args for a Sails v2 method/constructor call.
 *
 * When `serviceName` is provided, type lookup uses that service's beta.2
 * `TypeResolver`, which resolves service-local generics and avoids collisions
 * when two services declare the same-named struct. Pass undefined for ctor
 * encoding, where program-level types are in scope.
 */
export function coerceArgsV2(
  args: unknown[],
  argDefs: Array<{ name: string; typeDef: V2TypeDecl }>,
  program: SailsProgram,
  serviceName?: string,
): unknown[] {
  if (args.length === 0) return args;

  let typeLookup: V2TypeLookup;
  try {
    typeLookup = getV2TypeResolver(program, serviceName);
  } catch {
    return args; // Graceful fallback
  }

  return args.map((arg, i) => {
    if (i >= argDefs.length) return arg;
    return coerceHexToBytesV2(arg, argDefs[i].typeDef, typeLookup, argDefs[i].name);
  });
}

/**
 * Dispatch coerceArgs to the v1 or v2 walker based on the Sails instance type.
 * This is what generic commands (call, encode, program) should call.
 *
 * `serviceName` is v2-only — it narrows the type map to one service's
 * types to avoid cross-service name collisions. Ignored for v1 (which
 * has a single global type namespace).
 */
export function coerceArgsAuto(
  args: unknown[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  argDefs: Array<{ name: string; typeDef: any }>,
  sails: Sails | SailsProgram,
  serviceName?: string,
): unknown[] {
  if (sails instanceof SailsProgram) {
    return coerceArgsV2(args, argDefs as Array<{ name: string; typeDef: V2TypeDecl }>, sails, serviceName);
  }
  return coerceArgs(args, argDefs, sails);
}
