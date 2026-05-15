/**
 * Generic user types must substitute type_params before coercing byte
 * fields. Without substitution, `Envelope<[u8]>.payload` would stay
 * as a hex string instead of being converted to bytes.
 */
import * as path from 'path';
import { parseIdlFileV2 } from '../services/sails';
import { coerceArgsV2, coerceHexToBytesV2 } from '../utils/hex-bytes';

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-v2-generics.idl');

describe('v2 generic substitution', () => {
  it('Envelope<[u8]>.payload coerces hex to bytes via type_param substitution', async () => {
    const program = await parseIdlFileV2(FIXTURE);
    const setPayload = program.services.Gen.functions.SetPayload;
    const out = coerceArgsV2(
      [{ id: 7, payload: '0xdeadbeef' }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setPayload.args as any,
      program,
      'Gen',
    )[0] as { id: number; payload: number[] };
    expect(out.id).toBe(7);
    expect(out.payload).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('Envelope<[u8; 8]>.payload validates fixed-size bytes', async () => {
    const program = await parseIdlFileV2(FIXTURE);
    const setFixed = program.services.Gen.functions.SetFixed;

    // Correct length → bytes.
    const ok = coerceArgsV2(
      [{ id: 1, payload: '0x' + '11'.repeat(8) }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setFixed.args as any,
      program,
      'Gen',
    )[0] as { payload: number[] };
    expect(ok.payload).toHaveLength(8);

    // Wrong length → the length-mismatch error from the fixed-array branch
    // only surfaces when substitution actually fires; a regression that
    // skipped substitution would silently leave the hex string intact.
    expect(() =>
      coerceArgsV2(
        [{ id: 1, payload: '0xaa' }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setFixed.args as any,
        program,
        'Gen',
      ),
    ).toThrow(/\[u8; 8\]/);
  });

  it('uses beta.2 TypeResolver concrete generic definitions directly', async () => {
    const program = await parseIdlFileV2(FIXTURE);
    const setPayload = program.services.Gen.functions.SetPayload;
    const out = coerceHexToBytesV2(
      { id: 1, payload: '0xabcd' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (setPayload.args[0] as any).typeDef,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      program.services.Gen.typeResolver as any,
      'p',
    ) as { payload: number[] };
    expect(out.payload).toEqual([0xab, 0xcd]);
  });
});
