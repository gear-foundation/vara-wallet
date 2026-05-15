/**
 * End-to-end decode tests for `decodeSailsEvent`.
 *
 * Builds a synthetic `UserMessageSent`-shaped object whose payload uses
 * beta.2's Sails message header helper followed by a SCALE-encoded event
 * payload. The event is decoded against the loaded IDL and the decoded
 * `data` is asserted.
 *
 * `service.interface_id` in the v2 IDL header is `0x...` (8 bytes) and
 * is computed from the service signature; we read it back from the
 * loaded SailsProgram so the test stays in lock-step with whatever
 * hashing scheme the parser uses today.
 */
import * as path from 'path';
import { SailsProgram } from 'sails-js';
import { InterfaceId, SailsMessageHeader } from 'sails-js/parser';
import { parseIdlFileV2 } from '../services/sails';
import { decodeSailsEvent } from '../services/sails-events';

const EVENTS_FIXTURE = path.join(__dirname, 'fixtures', 'sample-v2-events.idl');
const EXTENDS_FIXTURE = path.join(__dirname, 'fixtures', 'sample-v2-extends.idl');

function buildHeader(interfaceIdLike: unknown, entryId: number, routeIdx: number): Uint8Array {
  const interfaceId = InterfaceId.from(interfaceIdLike as Parameters<typeof InterfaceId.from>[0]);
  return SailsMessageHeader.v1(interfaceId, entryId, routeIdx).toBytes();
}

function toHex(bytes: Uint8Array): string {
  let out = '0x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

interface ServiceWire {
  interface_id?: unknown;
  events?: Array<{ name: string; entry_id?: number; fields?: Array<{ name?: string; type: unknown }> }>;
  route_idx?: number;
}

function getServiceWire(sails: SailsProgram, name: string): ServiceWire {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = (sails as any)._doc;
  const svc = doc.services.find((s: { name: string }) => s.name === name);
  if (!svc) throw new Error(`service not found: ${name}`);
  return svc as ServiceWire;
}

function getRouteIdx(sails: SailsProgram, name: string): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = (sails.services as any)[name];
  return svc.routeIdx as number;
}

function buildUserMessageSent(payload: Uint8Array, sourceHex: string): unknown {
  // sails-js's `events[E].is()` checks `message.destination.eq(ZERO_ADDRESS)`
  // and reads bytes off `message.payload`. We mock both — `payload` is the
  // U8a-like object the parser reads via `tryFromBytes` (treats Uint8Array
  // and U8a uniformly).
  const ZERO = '0x' + '00'.repeat(32);
  return {
    data: {
      message: {
        payload: Object.assign(payload, { toHex: () => toHex(payload), toU8a: () => payload }),
        source: { toHex: () => sourceHex, eq: (other: unknown) => sourceHex === String(other) },
        destination: { eq: (other: unknown) => String(other) === ZERO || (other as { toHex?: () => string })?.toHex?.() === ZERO },
      },
    },
  };
}

describe('decodeSailsEvent — happy paths', () => {
  it('decodes a v2 single-unnamed payload event (StepCount(u32))', async () => {
    const sails = await parseIdlFileV2(EVENTS_FIXTURE) as SailsProgram;
    const svc = getServiceWire(sails, 'Walker');
    const stepCountIdx = (svc.events ?? []).findIndex((e) => e.name === 'StepCount');
    expect(stepCountIdx).toBeGreaterThanOrEqual(0);
    const entryId = svc.events![stepCountIdx].entry_id ?? stepCountIdx;
    const header = buildHeader(svc.interface_id!, entryId, getRouteIdx(sails, 'Walker'));

    // Payload: u32 = 42 in SCALE LE.
    const payloadValue = new Uint8Array([42, 0, 0, 0]);
    const fullPayload = concat(header, payloadValue);

    const ums = buildUserMessageSent(fullPayload, '0x' + '00'.repeat(32));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decoded = decodeSailsEvent(sails, ums as any);
    expect(decoded).not.toBeNull();
    expect(decoded!.service).toBe('Walker');
    expect(decoded!.event).toBe('StepCount');
    expect(decoded!.data).toBe(42);
  });

  it('decodes a v2 unit variant event (Stopped)', async () => {
    const sails = await parseIdlFileV2(EVENTS_FIXTURE) as SailsProgram;
    const svc = getServiceWire(sails, 'Walker');
    const stoppedIdx = (svc.events ?? []).findIndex((e) => e.name === 'Stopped');
    const entryId = svc.events![stoppedIdx].entry_id ?? stoppedIdx;
    const header = buildHeader(svc.interface_id!, entryId, getRouteIdx(sails, 'Walker'));

    const ums = buildUserMessageSent(header, '0x' + '00'.repeat(32));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decoded = decodeSailsEvent(sails, ums as any);
    expect(decoded).not.toBeNull();
    expect(decoded!.service).toBe('Walker');
    expect(decoded!.event).toBe('Stopped');
    expect(decoded!.data).toBeNull();
  });

  it('decodes a v2 event through SailsProgram.decodeEvent and normalizes nested u256', async () => {
    const sails = await parseIdlFileV2(EVENTS_FIXTURE) as SailsProgram;
    const svc = getServiceWire(sails, 'Walker');
    const balanceIdx = (svc.events ?? []).findIndex((e) => e.name === 'BalanceChanged');
    expect(balanceIdx).toBeGreaterThanOrEqual(0);
    const entryId = svc.events![balanceIdx].entry_id ?? balanceIdx;
    const header = buildHeader(svc.interface_id!, entryId, getRouteIdx(sails, 'Walker'));

    const amount = new Uint8Array(32);
    amount[0] = 42;
    const fullPayload = concat(header, amount);

    const ums = buildUserMessageSent(fullPayload, '0x' + '00'.repeat(32));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decoded = decodeSailsEvent(sails, ums as any);
    expect(decoded).toEqual({
      service: 'Walker',
      event: 'BalanceChanged',
      data: { amount: '42' },
    });
  });

  it('decodes an event from an inherited service via extends (v2)', async () => {
    const sails = await parseIdlFileV2(EXTENDS_FIXTURE) as SailsProgram;
    const baseSvc = getServiceWire(sails, 'Base');
    const baseEventIdx = (baseSvc.events ?? []).findIndex((e) => e.name === 'BaseEvent');
    const entryId = baseSvc.events![baseEventIdx].entry_id ?? baseEventIdx;
    // The Composite service inherits Base; the route_idx in the header
    // identifies which physical service the message goes through, but
    // events fired by Base from the program path bind to Base directly.
    const header = buildHeader(baseSvc.interface_id!, entryId, getRouteIdx(sails, 'Base'));

    // Payload: u32 = 7 in SCALE LE.
    const payloadValue = new Uint8Array([7, 0, 0, 0]);
    const fullPayload = concat(header, payloadValue);

    const ums = buildUserMessageSent(fullPayload, '0x' + '00'.repeat(32));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decoded = decodeSailsEvent(sails, ums as any);
    expect(decoded).not.toBeNull();
    expect(decoded!.service).toBe('Base');
    expect(decoded!.event).toBe('BaseEvent');
    expect(decoded!.data).toBe(7);
  });
});
