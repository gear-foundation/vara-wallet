import { cryptoWaitReady } from '@polkadot/util-crypto';
import { GearKeyring } from '@gear-js/api';
import { u8aToHex, hexToU8a, stringToU8a } from '@polkadot/util';
import { signatureVerify } from '@polkadot/util-crypto';

let alice: Awaited<ReturnType<typeof GearKeyring.fromSuri>>;

beforeAll(async () => {
  await cryptoWaitReady();
  alice = await GearKeyring.fromSuri('//Alice');
});

describe('sign (unit logic)', () => {
  it('signs a UTF-8 string and returns signature, publicKey, address', () => {
    const message = stringToU8a('hello world');
    const signature = alice.sign(message);

    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBe(64); // sr25519 signature is 64 bytes
    expect(u8aToHex(signature)).toMatch(/^0x[0-9a-f]{128}$/);
    expect(u8aToHex(alice.publicKey)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(alice.address).toBeTruthy();
  });

  it('signs hex data', () => {
    const message = hexToU8a('0xdeadbeef');
    const signature = alice.sign(message);

    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBe(64);
  });

  it('signs empty string (0 bytes)', () => {
    const message = stringToU8a('');
    const signature = alice.sign(message);

    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBe(64);
  });

  it('signs empty hex 0x (0 bytes)', () => {
    const message = hexToU8a('0x');
    const signature = alice.sign(message);

    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBe(64);
  });
});

describe('verify (unit logic)', () => {
  it('verifies a valid signature returns isValid: true', () => {
    const message = stringToU8a('hello world');
    const signature = alice.sign(message);
    const result = signatureVerify(message, u8aToHex(signature), alice.address);

    expect(result.isValid).toBe(true);
    expect(result.crypto).toBe('sr25519');
  });

  it('returns isValid: false for wrong data', () => {
    const message = stringToU8a('hello world');
    const signature = alice.sign(message);
    const wrongMessage = stringToU8a('wrong data');
    const result = signatureVerify(wrongMessage, u8aToHex(signature), alice.address);

    expect(result.isValid).toBe(false);
  });

  it('returns isValid: false for wrong address', async () => {
    const message = stringToU8a('hello world');
    const signature = alice.sign(message);
    const bob = await GearKeyring.fromSuri('//Bob');
    const result = signatureVerify(message, u8aToHex(signature), bob.address);

    expect(result.isValid).toBe(false);
  });

  it('round-trips sign then verify for hex data', () => {
    const message = hexToU8a('0xcafebabe');
    const signature = alice.sign(message);
    const result = signatureVerify(message, u8aToHex(signature), alice.address);

    expect(result.isValid).toBe(true);
  });

  it('round-trips sign then verify for empty data', () => {
    const message = stringToU8a('');
    const signature = alice.sign(message);
    const result = signatureVerify(message, u8aToHex(signature), alice.address);

    expect(result.isValid).toBe(true);
  });
});

describe('input validation', () => {
  it('hexToU8a is permissive — our command validates 0x prefix explicitly', () => {
    // hexToU8a does NOT throw on non-0x-prefixed or odd-length hex,
    // which is why the sign command validates the 0x prefix before calling hexToU8a
    expect(hexToU8a('deadbeef')).toBeInstanceOf(Uint8Array);
    expect(hexToU8a('0xdead0')).toBeInstanceOf(Uint8Array);
  });

  it('signatureVerify throws on wrong-length signature', () => {
    const message = stringToU8a('hello');
    expect(() => signatureVerify(message, '0xdead', alice.address)).toThrow();
  });
});
