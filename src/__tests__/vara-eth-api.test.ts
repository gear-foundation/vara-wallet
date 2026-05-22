import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveEthexeConfig } from '../services/vara-eth/api';

const LOCAL_PRESET = {
  varaEthRpc: 'ws://127.0.0.1:9944',
  ethereumRpc: 'ws://127.0.0.1:8545',
  routerAddress: null,
};

const DISCOVERED_ROUTER = '0x1111111111111111111111111111111111111111';
const FALLBACK_ROUTER = '0x2222222222222222222222222222222222222222';
const EXPLICIT_ROUTER = '0x3333333333333333333333333333333333333333';
const CLI_ROUTER = '0x5555555555555555555555555555555555555555';

let tmpDir: string;
let origCwd: string;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'VARA_WALLET_DIR',
  'VARA_ETH_ROUTER',
  'ETHEREUM_RPC',
  'VARA_ETH_RPC',
  'VARA_ETH_NETWORK_PRESET_NAME',
  'VARA_ETH_NETWORK_PRESET_VARA_ETH_RPC',
  'VARA_ETH_NETWORK_PRESET_ETHEREUM_RPC',
  'VARA_ETH_NETWORK_PRESET_ROUTER',
] as const;

function snapshotEnv(): void {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function writeBroadcastArtifact(filePath: string, routerAddress: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    JSON.stringify(
      {
        transactions: [
          {
            hash: '0xabc',
            contractName: 'Counter',
            contractAddress: '0x4444444444444444444444444444444444444444',
          },
          {
            hash: '0xdef',
            contractName: 'Router',
            contractAddress: routerAddress,
          },
        ],
        receipts: [],
      },
      null,
      2,
    ) + '\n',
  );
}

beforeEach(() => {
  snapshotEnv();
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vw-ethexe-api-'));
  origCwd = process.cwd();
  process.env.VARA_WALLET_DIR = tmpDir;
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(origCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  restoreEnv();
});

describe('resolveEthexeConfig', () => {
  it('discovers the local Router from a broadcast artifact when the preset router is null', () => {
    writeBroadcastArtifact(path.join(tmpDir, 'broadcast', 'DeployRouter.s.sol', '31337', 'run-latest.json'), DISCOVERED_ROUTER);

    const cfg = resolveEthexeConfig({ networkPreset: LOCAL_PRESET });

    expect(cfg.varaEthRpc).toBe(LOCAL_PRESET.varaEthRpc);
    expect(cfg.ethereumRpc).toBe(LOCAL_PRESET.ethereumRpc);
    expect(cfg.routerAddress).toBe(DISCOVERED_ROUTER);
  });

  it('keeps a direct router address option ahead of local discovery', () => {
    writeBroadcastArtifact(path.join(tmpDir, 'broadcast', 'DeployRouter.s.sol', '31337', 'run-latest.json'), FALLBACK_ROUTER);
    process.env.VARA_ETH_ROUTER = EXPLICIT_ROUTER;

    const cfg = resolveEthexeConfig({ networkPreset: LOCAL_PRESET, routerAddress: EXPLICIT_ROUTER });

    expect(cfg.routerAddress).toBe(EXPLICIT_ROUTER);
  });

  it('keeps the command-line network preset ahead of a persisted config preset', () => {
    writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ varaEthNetwork: 'mainnet' }) + '\n');
    process.env.VARA_ETH_NETWORK_PRESET_VARA_ETH_RPC = 'wss://hoodi-validator.example';
    process.env.VARA_ETH_NETWORK_PRESET_ETHEREUM_RPC = 'wss://hoodi-eth.example';
    process.env.VARA_ETH_NETWORK_PRESET_ROUTER = CLI_ROUTER;

    const cfg = resolveEthexeConfig();

    expect(cfg.varaEthRpc).toBe('wss://hoodi-validator.example');
    expect(cfg.ethereumRpc).toBe('wss://hoodi-eth.example');
    expect(cfg.routerAddress).toBe(CLI_ROUTER);
  });

  it('keeps the command-line network preset ahead of stale env endpoints', () => {
    process.env.VARA_ETH_RPC = 'wss://stale-validator.example';
    process.env.ETHEREUM_RPC = 'wss://stale-eth.example';
    process.env.VARA_ETH_ROUTER = EXPLICIT_ROUTER;
    process.env.VARA_ETH_NETWORK_PRESET_VARA_ETH_RPC = 'wss://hoodi-validator.example';
    process.env.VARA_ETH_NETWORK_PRESET_ETHEREUM_RPC = 'wss://hoodi-eth.example';
    process.env.VARA_ETH_NETWORK_PRESET_ROUTER = CLI_ROUTER;

    const cfg = resolveEthexeConfig();

    expect(cfg.varaEthRpc).toBe('wss://hoodi-validator.example');
    expect(cfg.ethereumRpc).toBe('wss://hoodi-eth.example');
    expect(cfg.routerAddress).toBe(CLI_ROUTER);
  });

  it('does not fall back to a persisted router when the command-line preset needs local discovery', () => {
    writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
      varaEthNetwork: 'mainnet',
      routerAddress: FALLBACK_ROUTER,
    }) + '\n');
    writeBroadcastArtifact(path.join(tmpDir, 'broadcast', 'DeployRouter.s.sol', '31337', 'run-latest.json'), DISCOVERED_ROUTER);
    process.env.VARA_ETH_ROUTER = EXPLICIT_ROUTER;
    process.env.VARA_ETH_NETWORK_PRESET_VARA_ETH_RPC = LOCAL_PRESET.varaEthRpc;
    process.env.VARA_ETH_NETWORK_PRESET_ETHEREUM_RPC = LOCAL_PRESET.ethereumRpc;

    const cfg = resolveEthexeConfig();

    expect(cfg.varaEthRpc).toBe(LOCAL_PRESET.varaEthRpc);
    expect(cfg.ethereumRpc).toBe(LOCAL_PRESET.ethereumRpc);
    expect(cfg.routerAddress).toBe(DISCOVERED_ROUTER);
  });
});
