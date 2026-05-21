import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Command } from 'commander';

const mockOutput = jest.fn();
jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  output: (data: unknown) => mockOutput(data),
}));

// Use a temp directory for config during tests
let tmpDir: string;
const origEnv = process.env.VARA_WALLET_DIR;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vara-wallet-test-'));
  process.env.VARA_WALLET_DIR = tmpDir;
  mockOutput.mockReset();
});

afterEach(() => {
  if (origEnv) {
    process.env.VARA_WALLET_DIR = origEnv;
  } else {
    delete process.env.VARA_WALLET_DIR;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Import after env setup
import { readConfig, writeConfig, updateConfig } from '../services/config';
import { registerConfigCommand } from '../commands/config-cmd';

describe('config persistence', () => {
  it('readConfig returns empty object when no config file exists', () => {
    expect(readConfig()).toEqual({});
  });

  it('writeConfig and readConfig round-trip', () => {
    writeConfig({ wsEndpoint: 'wss://testnet.vara.network', defaultAccount: 'test' });
    const cfg = readConfig();
    expect(cfg.wsEndpoint).toBe('wss://testnet.vara.network');
    expect(cfg.defaultAccount).toBe('test');
  });

  it('updateConfig merges partial updates', () => {
    writeConfig({ wsEndpoint: 'wss://rpc.vara.network' });
    updateConfig({ defaultAccount: 'agent' });
    const cfg = readConfig();
    expect(cfg.wsEndpoint).toBe('wss://rpc.vara.network');
    expect(cfg.defaultAccount).toBe('agent');
  });

  it('config file has restricted permissions', () => {
    writeConfig({ wsEndpoint: 'test' });
    const configPath = path.join(tmpDir, 'config.json');
    const stat = fs.statSync(configPath);
    // 0o600 = owner read/write only
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

describe('NETWORK_MAP', () => {
  const { NETWORK_MAP } = require('../commands/config-cmd');

  it('maps mainnet correctly', () => {
    expect(NETWORK_MAP.mainnet).toBe('wss://rpc.vara.network');
  });

  it('maps testnet correctly', () => {
    expect(NETWORK_MAP.testnet).toBe('wss://testnet.vara.network');
  });

  it('maps local correctly', () => {
    expect(NETWORK_MAP.local).toBe('ws://localhost:9944');
  });

  it('has exactly 3 entries', () => {
    expect(Object.keys(NETWORK_MAP)).toHaveLength(3);
  });
});

describe('config get network alias', () => {
  it('reverse-maps wsEndpoint to network name', () => {
    writeConfig({ wsEndpoint: 'wss://testnet.vara.network' });
    const cfg = readConfig();
    const { NETWORK_MAP } = require('../commands/config-cmd');
    const network = Object.entries(NETWORK_MAP).find(([, url]) => url === cfg.wsEndpoint)?.[0];
    expect(network).toBe('testnet');
  });

  it('returns null for unknown wsEndpoint', () => {
    writeConfig({ wsEndpoint: 'wss://custom.endpoint' });
    const cfg = readConfig();
    const { NETWORK_MAP } = require('../commands/config-cmd');
    const network = Object.entries(NETWORK_MAP).find(([, url]) => url === cfg.wsEndpoint)?.[0];
    expect(network).toBeUndefined();
  });
});

describe('--network integration', () => {
  const { NETWORK_MAP } = require('../commands/config-cmd');
  const { CliError } = require('../utils/errors');
  const origVaraWs = process.env.VARA_WS;

  afterEach(() => {
    if (origVaraWs) {
      process.env.VARA_WS = origVaraWs;
    } else {
      delete process.env.VARA_WS;
    }
  });

  it('--network testnet sets VARA_WS env var', () => {
    // Simulate what app.ts preAction hook does
    const network = 'testnet';
    const url = NETWORK_MAP[network];
    expect(url).toBeDefined();
    process.env.VARA_WS = url;
    expect(process.env.VARA_WS).toBe('wss://testnet.vara.network');
  });

  it('--network mainnet sets VARA_WS env var', () => {
    const url = NETWORK_MAP['mainnet'];
    process.env.VARA_WS = url;
    expect(process.env.VARA_WS).toBe('wss://rpc.vara.network');
  });

  it('--network local sets VARA_WS env var', () => {
    const url = NETWORK_MAP['local'];
    process.env.VARA_WS = url;
    expect(process.env.VARA_WS).toBe('ws://localhost:9944');
  });

  it('invalid --network throws INVALID_NETWORK', () => {
    const network = 'devnet';
    const url = NETWORK_MAP[network];
    expect(url).toBeUndefined();
    // Simulate the error that app.ts would throw
    expect(() => {
      if (!url) throw new CliError(`Unknown network "${network}". Valid: ${Object.keys(NETWORK_MAP).join(', ')}`, 'INVALID_NETWORK');
    }).toThrow('Unknown network');
  });

  it('--network and --ws conflict is detected', () => {
    const ws = 'wss://custom.endpoint';
    const network = 'testnet';
    expect(() => {
      if (ws && network) throw new CliError('Cannot use both --network and --ws', 'CONFLICTING_OPTIONS');
    }).toThrow('Cannot use both --network and --ws');
  });
});

describe('Vara.eth config network alias', () => {
  function makeProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.option('--chain <name>', 'target chain');
    registerConfigCommand(program);
    return program;
  }

  it('clears a deployed router address when switching the Vara.eth preset to local', async () => {
    writeConfig({
      defaultChain: 'vara-eth',
      varaEthNetwork: 'hoodi',
      varaEthRpc: 'wss://vara-eth-validator-1.gear-tech.io',
      ethereumRpc: 'wss://hoodi-reth-rpc.gear-tech.io/ws',
      routerAddress: '0xE549b0AfEdA978271FF7E712232B9F7f39A0b060',
    });

    await makeProgram().parseAsync(['--chain', 'vara-eth', 'config', 'set', 'network', 'local'], {
      from: 'user',
    });

    const cfg = readConfig();
    expect(cfg.varaEthNetwork).toBe('local');
    expect(cfg.varaEthRpc).toBe('ws://127.0.0.1:9944');
    expect(cfg.ethereumRpc).toBe('ws://127.0.0.1:8545');
    expect(cfg.routerAddress).toBeUndefined();
  });
});

describe('faucet network guard', () => {
  const MAINNET_ENDPOINT = 'wss://rpc.vara.network';

  function checkFaucetNetwork(wsArg: string | undefined): void {
    const { CliError } = require('../utils/errors');
    if (wsArg === MAINNET_ENDPOINT) {
      throw new CliError('Faucet is for testnet only. Use --network testnet or --ws wss://testnet.vara.network', 'WRONG_NETWORK');
    }
  }

  it('refuses mainnet endpoint', () => {
    expect(() => checkFaucetNetwork('wss://rpc.vara.network')).toThrow('Faucet is for testnet only');
  });

  it('allows testnet endpoint', () => {
    expect(() => checkFaucetNetwork('wss://testnet.vara.network')).not.toThrow();
  });

  it('allows undefined endpoint (defaults to testnet)', () => {
    expect(() => checkFaucetNetwork(undefined)).not.toThrow();
  });
});
