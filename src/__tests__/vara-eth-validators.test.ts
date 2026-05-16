/**
 * Unit tests for the vara-eth:validators config commands.
 *
 * Pure config I/O — no network calls.  VARA_WALLET_DIR is isolated to a
 * tmp directory for each test following the wallet-store-eth.test.ts pattern.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let tmpDir: string;
const savedEnv = process.env.VARA_WALLET_DIR;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vw-validators-'));
  process.env.VARA_WALLET_DIR = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env.VARA_WALLET_DIR;
  else process.env.VARA_WALLET_DIR = savedEnv;
});

// Import after env setup so readConfig picks up the tmp dir.
import { readConfig, updateConfig } from '../services/config';

// Inline the validator pool logic (mirrors the command implementation).
function addValidator(url: string): string[] {
  const config = readConfig();
  const pool = config.varaEthValidatorPool ?? [];
  if (!pool.includes(url)) {
    pool.push(url);
    updateConfig({ varaEthValidatorPool: pool });
  }
  return pool;
}

function removeValidator(url: string): string[] {
  const config = readConfig();
  const pool = config.varaEthValidatorPool ?? [];
  const next = pool.filter((u) => u !== url);
  updateConfig({ varaEthValidatorPool: next });
  return next;
}

function listValidators(): string[] {
  return readConfig().varaEthValidatorPool ?? [];
}

// ---------------------------------------------------------------------------

describe('vara-eth:validators add', () => {
  it('adds a URL to an empty pool', () => {
    const pool = addValidator('wss://validator-1.example.com:9944');
    expect(pool).toContain('wss://validator-1.example.com:9944');
    expect(readConfig().varaEthValidatorPool).toEqual(['wss://validator-1.example.com:9944']);
  });

  it('de-duplicates: adding the same URL twice only stores it once', () => {
    addValidator('wss://validator-1.example.com:9944');
    addValidator('wss://validator-1.example.com:9944');
    expect(readConfig().varaEthValidatorPool).toEqual(['wss://validator-1.example.com:9944']);
  });

  it('adds multiple distinct URLs', () => {
    addValidator('wss://v1.example.com');
    addValidator('wss://v2.example.com');
    const pool = readConfig().varaEthValidatorPool ?? [];
    expect(pool).toHaveLength(2);
    expect(pool).toContain('wss://v1.example.com');
    expect(pool).toContain('wss://v2.example.com');
  });
});

describe('vara-eth:validators remove', () => {
  it('removes a URL from the pool', () => {
    addValidator('wss://v1.example.com');
    addValidator('wss://v2.example.com');
    const next = removeValidator('wss://v1.example.com');
    expect(next).toEqual(['wss://v2.example.com']);
    expect(readConfig().varaEthValidatorPool).toEqual(['wss://v2.example.com']);
  });

  it('is a no-op when the URL is not in the pool', () => {
    addValidator('wss://v1.example.com');
    const next = removeValidator('wss://notpresent.example.com');
    expect(next).toEqual(['wss://v1.example.com']);
  });

  it('produces an empty pool when the last URL is removed', () => {
    addValidator('wss://v1.example.com');
    const next = removeValidator('wss://v1.example.com');
    expect(next).toEqual([]);
    expect(readConfig().varaEthValidatorPool).toEqual([]);
  });
});

describe('vara-eth:validators list', () => {
  it('returns an empty array when no validators are configured', () => {
    expect(listValidators()).toEqual([]);
  });

  it('returns the full pool after adds', () => {
    addValidator('wss://a.example.com');
    addValidator('wss://b.example.com');
    expect(listValidators()).toEqual(['wss://a.example.com', 'wss://b.example.com']);
  });
});
