/**
 * Two services declaring same-named user types must not collide in arg
 * coercion. Scoping via `serviceName` selects the beta.2 service
 * TypeResolver for the caller's service.
 */
import * as path from 'path';
import { getV2TypeResolver, parseIdlFileV2 } from '../services/sails';
import { coerceArgsV2 } from '../utils/hex-bytes';

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-v2-collision.idl');

describe('v2 type scoping across services', () => {
  it('service TypeResolvers resolve only that service\'s scoped type shape', async () => {
    const program = await parseIdlFileV2(FIXTURE);

    const aSet = program.services.A.functions.Set;
    const bSet = program.services.B.functions.Set;
    const aResolver = getV2TypeResolver(program, 'A');
    const bResolver = getV2TypeResolver(program, 'B');

    // Each scoped resolver has its own Packet definition.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aPacket = aResolver.resolveNamed((aSet.args[0] as any).typeDef) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bPacket = bResolver.resolveNamed((bSet.args[0] as any).typeDef) as any;
    expect(aPacket).toBeDefined();
    expect(bPacket).toBeDefined();

    // Service A's Packet has [u8; 4], service B's has [u8; 8].
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aLen = aPacket.fields[0].type.len as number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bLen = bPacket.fields[0].type.len as number;
    expect(aLen).toBe(4);
    expect(bLen).toBe(8);

    // Program-level resolver intentionally does not see service-local Packet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(program.typeResolver.resolveNamed((aSet.args[0] as any).typeDef)).toBeUndefined();
  });

  it('coerceArgsV2 with service name uses that service\'s type shape', async () => {
    const program = await parseIdlFileV2(FIXTURE);

    const aSet = program.services.A.functions.Set;
    const bSet = program.services.B.functions.Set;

    // A expects 4 bytes. 4-byte hex should coerce cleanly; 8-byte
    // should throw the length-mismatch error.
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      coerceArgsV2([{ payload: '0x01020304' }], aSet.args as any, program, 'A'),
    ).not.toThrow();
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      coerceArgsV2([{ payload: '0x0102030405060708' }], aSet.args as any, program, 'A'),
    ).toThrow(/\[u8; 4\]/);

    // B expects 8 bytes — opposite result.
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      coerceArgsV2([{ payload: '0x0102030405060708' }], bSet.args as any, program, 'B'),
    ).not.toThrow();
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      coerceArgsV2([{ payload: '0x01020304' }], bSet.args as any, program, 'B'),
    ).toThrow(/\[u8; 8\]/);
  });
});
