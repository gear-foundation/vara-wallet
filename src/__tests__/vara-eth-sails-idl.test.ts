import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const testDir = path.join(os.tmpdir(), `vara-eth-sails-idl-${Date.now()}-${process.pid}`);
process.env.VARA_WALLET_DIR = testDir;

import { readCachedIdl, writeCachedIdl } from '../services/idl-cache';
import { loadVaraEthSails } from '../services/vara-eth/sails-idl';

const PROGRAM = '0xabcdef0000000000000000000000000000000001' as const;
const CODE_ID = ('0x' + 'aa'.repeat(32)) as `0x${string}`;
const FIXTURE_IDL = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-v2.idl'), 'utf8');
const OTHER_IDL = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-v2-numeric.idl'), 'utf8');

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

function makeApi(overrides: {
  codeId?: () => Promise<`0x${string}`>;
  getOriginal?: () => Promise<`0x${string}`>;
} = {}) {
  return {
    query: {
      program: {
        codeId: jest.fn(overrides.codeId ?? (async () => CODE_ID)),
      },
      code: {
        getOriginal: jest.fn(overrides.getOriginal ?? (async () => bytesToHex(buildWasmWithIdl(FIXTURE_IDL)))),
      },
    },
  };
}

describe('Vara.eth Sails IDL adapter', () => {
  it('uses a validated cache hit before reading embedded code bytes', async () => {
    writeCachedIdl(CODE_ID, FIXTURE_IDL, {
      version: 'v2',
      source: 'chain',
      importedAt: '2026-05-22T00:00:00.000Z',
    });
    const api = makeApi();

    const loaded = await loadVaraEthSails(api, PROGRAM, {
      requiredMethod: { service: 'Demo', method: 'Echo' },
    });

    expect(loaded.source).toBe('cache');
    expect(api.query.program.codeId).toHaveBeenCalledWith(PROGRAM);
    expect(api.query.code.getOriginal).not.toHaveBeenCalled();
    expect(loaded.sails.services.Demo.functions.Echo).toBeDefined();
  });

  it('evicts a wrong cache entry and replaces it with embedded IDL', async () => {
    writeCachedIdl(CODE_ID, OTHER_IDL, {
      version: 'v2',
      source: 'import',
      importedAt: '2026-05-22T00:00:00.000Z',
    });
    const api = makeApi();

    const loaded = await loadVaraEthSails(api, PROGRAM, {
      requiredMethod: { service: 'Demo', method: 'Echo' },
    });

    expect(loaded.source).toBe('chain');
    expect(api.query.code.getOriginal).toHaveBeenCalledWith(CODE_ID);
    expect(readCachedIdl(CODE_ID)?.idl).toBe(FIXTURE_IDL);
  });

  it('keeps local --idl resolution offline', async () => {
    const api = makeApi({
      codeId: async () => { throw new Error('should not resolve codeId'); },
    });
    const loaded = await loadVaraEthSails(api, PROGRAM, {
      idl: path.join(__dirname, 'fixtures', 'sample-v2.idl'),
    });

    expect(loaded.source).toBe('local');
    expect(api.query.program.codeId).not.toHaveBeenCalled();
    expect(loaded.sails.services.Demo).toBeDefined();
  });
});

const WASM_HEADER = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

function buildWasmWithIdl(idl: string): Uint8Array {
  const payload = new TextEncoder().encode(idl);
  const name = new TextEncoder().encode('sails:idl');
  const nameLen = uleb128(name.length);
  const sectionBodyLen = nameLen.length + name.length + payload.length;
  return new Uint8Array([
    ...WASM_HEADER,
    0x00,
    ...uleb128(sectionBodyLen),
    ...nameLen,
    ...name,
    ...payload,
  ]);
}

function uleb128(n: number): number[] {
  const bytes: number[] = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (n !== 0);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Buffer.from(bytes).toString('hex')}`;
}
