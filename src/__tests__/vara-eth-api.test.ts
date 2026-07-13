import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  disconnectEthexeApi,
  getEthexeApi,
  getEthexeEthereumClient,
  getEthexeEthereumContext,
  resolveEthexeConfig,
} from '../services/vara-eth/api';

const LOCAL_PRESET = {
  varaEthRpc: 'ws://127.0.0.1:9944',
  ethereumRpc: 'ws://127.0.0.1:8545',
  ethereumHttpRpc: 'http://127.0.0.1:8545',
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
  'ETHEREUM_HTTP_RPC',
  'VARA_ETH_RPC',
  'VARA_ETH_NETWORK_PRESET_NAME',
  'VARA_ETH_NETWORK_PRESET_VARA_ETH_RPC',
  'VARA_ETH_NETWORK_PRESET_ETHEREUM_RPC',
  'VARA_ETH_NETWORK_PRESET_ETHEREUM_HTTP_RPC',
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
  disconnectEthexeApi();
  process.chdir(origCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  restoreEnv();
  jest.useRealTimers();
  const apiStub = require('@vara-eth/api') as {
    __resetVaraEthApiStubForTests?: () => void;
  };
  apiStub.__resetVaraEthApiStubForTests?.();
});

describe('resolveEthexeConfig', () => {
  it('discovers the local Router from a broadcast artifact when the preset router is null', () => {
    writeBroadcastArtifact(path.join(tmpDir, 'broadcast', 'DeployRouter.s.sol', '31337', 'run-latest.json'), DISCOVERED_ROUTER);

    const cfg = resolveEthexeConfig({ networkPreset: LOCAL_PRESET });

    expect(cfg.varaEthRpc).toBe(LOCAL_PRESET.varaEthRpc);
    expect(cfg.ethereumRpc).toBe(LOCAL_PRESET.ethereumRpc);
    expect(cfg.ethereumHttpRpc).toBe(LOCAL_PRESET.ethereumHttpRpc);
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
    process.env.VARA_ETH_NETWORK_PRESET_ETHEREUM_HTTP_RPC = 'https://hoodi-eth.example';
    process.env.VARA_ETH_NETWORK_PRESET_ROUTER = CLI_ROUTER;

    const cfg = resolveEthexeConfig();

    expect(cfg.varaEthRpc).toBe('wss://hoodi-validator.example');
    expect(cfg.ethereumRpc).toBe('wss://hoodi-eth.example');
    expect(cfg.ethereumHttpRpc).toBe('https://hoodi-eth.example');
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

  it('accepts an explicit HTTP endpoint for one-shot Ethereum requests', () => {
    process.env.ETHEREUM_HTTP_RPC = 'https://custom-eth.example';

    const cfg = resolveEthexeConfig({
      varaEthRpc: LOCAL_PRESET.varaEthRpc,
      ethereumRpc: LOCAL_PRESET.ethereumRpc,
      routerAddress: EXPLICIT_ROUTER,
    });

    expect(cfg.ethereumHttpRpc).toBe('https://custom-eth.example');

    const explicit = resolveEthexeConfig({
      varaEthRpc: LOCAL_PRESET.varaEthRpc,
      ethereumRpc: LOCAL_PRESET.ethereumRpc,
      ethereumHttpRpc: 'https://explicit-eth.example',
      routerAddress: EXPLICIT_ROUTER,
    });
    expect(explicit.ethereumHttpRpc).toBe('https://explicit-eth.example');
  });

  it('does not borrow a preset HTTP endpoint for a custom Ethereum WebSocket', () => {
    writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ varaEthNetwork: 'hoodi' }) + '\n');

    const cfg = resolveEthexeConfig({
      ethereumRpc: 'wss://custom-eth.example',
      routerAddress: EXPLICIT_ROUTER,
    });

    expect(cfg.ethereumRpc).toBe('wss://custom-eth.example');
    expect(cfg.ethereumHttpRpc).toBeUndefined();
  });

  it('keeps an explicit Ethereum WebSocket ahead of an options network preset HTTP endpoint', async () => {
    const apiStub = require('@vara-eth/api') as {
      __getLastPublicClientTransportForTests: () => string | undefined;
    };

    const cfg = resolveEthexeConfig({
      networkPreset: LOCAL_PRESET,
      ethereumRpc: 'wss://custom-eth.example',
      routerAddress: EXPLICIT_ROUTER,
    });
    expect(cfg.ethereumHttpRpc).toBeUndefined();

    await getEthexeApi({
      networkPreset: LOCAL_PRESET,
      ethereumRpc: 'wss://custom-eth.example',
      routerAddress: EXPLICIT_ROUTER,
    });
    expect(apiStub.__getLastPublicClientTransportForTests()).toBe('webSocket');
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

describe('getEthexeApi', () => {
  it('creates an Ethereum request context without opening the validator API', () => {
    const apiStub = require('@vara-eth/api') as {
      __getWsConnectCallsForTests: () => number;
      __getCreateApiCallsForTests: () => number;
    };

    const context = getEthexeEthereumContext({ networkPreset: LOCAL_PRESET, routerAddress: EXPLICIT_ROUTER });

    expect(context.transport).toBe('http');
    expect(context.endpoint).toBe(LOCAL_PRESET.ethereumHttpRpc);
    expect(apiStub.__getWsConnectCallsForTests()).toBe(0);
    expect(apiStub.__getCreateApiCallsForTests()).toBe(0);
  });

  it('initializes and caches an Ethereum-only client without opening the validator API', async () => {
    const apiStub = require('@vara-eth/api') as {
      __getWsConnectCallsForTests: () => number;
      __getCreateApiCallsForTests: () => number;
      __getEthereumClientConstructCallsForTests: () => number;
      __getEthereumClientInitCallsForTests: () => number;
    };

    const first = await getEthexeEthereumClient({ networkPreset: LOCAL_PRESET, routerAddress: EXPLICIT_ROUTER });
    const second = await getEthexeEthereumClient({ networkPreset: LOCAL_PRESET, routerAddress: EXPLICIT_ROUTER });

    expect(second).toBe(first);
    expect(apiStub.__getEthereumClientConstructCallsForTests()).toBe(1);
    expect(apiStub.__getEthereumClientInitCallsForTests()).toBe(1);
    expect(apiStub.__getWsConnectCallsForTests()).toBe(0);
    expect(apiStub.__getCreateApiCallsForTests()).toBe(0);
  });

  it('starts validator connection and API bootstrap concurrently, then caches the result', async () => {
    const apiStub = require('@vara-eth/api') as {
      __setWsConnectImplementationForTests: (fn: () => Promise<void>) => void;
      __setCreateApiImplementationForTests: (fn: () => Promise<unknown>) => void;
      __getWsConnectCallsForTests: () => number;
      __getCreateApiCallsForTests: () => number;
    };
    let resolveConnect!: () => void;
    let resolveApi!: (value: unknown) => void;
    const expectedApi = { initialized: true };
    apiStub.__setWsConnectImplementationForTests(() => new Promise<void>((resolve) => {
      resolveConnect = resolve;
    }));
    apiStub.__setCreateApiImplementationForTests(() => new Promise((resolve) => {
      resolveApi = resolve;
    }));

    const promise = getEthexeApi({ networkPreset: LOCAL_PRESET, routerAddress: EXPLICIT_ROUTER });

    expect(apiStub.__getWsConnectCallsForTests()).toBe(1);
    expect(apiStub.__getCreateApiCallsForTests()).toBe(1);

    resolveConnect();
    resolveApi(expectedApi);
    await expect(promise).resolves.toBe(expectedApi);
    await expect(getEthexeApi({
      varaEthRpc: 'wss://ignored.example',
      ethereumRpc: 'wss://ignored.example',
      routerAddress: FALLBACK_ROUTER,
    })).resolves.toBe(expectedApi);
    expect(apiStub.__getWsConnectCallsForTests()).toBe(1);
    expect(apiStub.__getCreateApiCallsForTests()).toBe(1);
  });

  it('uses HTTP for requests and WebSocket for streams', async () => {
    const apiStub = require('@vara-eth/api') as {
      __getLastPublicClientTransportForTests: () => string | undefined;
    };

    await getEthexeApi({ networkPreset: LOCAL_PRESET, routerAddress: EXPLICIT_ROUTER });
    expect(apiStub.__getLastPublicClientTransportForTests()).toBe('http');

    disconnectEthexeApi();
    await getEthexeApi({
      networkPreset: LOCAL_PRESET,
      routerAddress: EXPLICIT_ROUTER,
      ethereumTransport: 'stream',
    });
    expect(apiStub.__getLastPublicClientTransportForTests()).toBe('webSocket');
  });

  it('falls back to the configured Ethereum WebSocket when no HTTP endpoint exists', async () => {
    const apiStub = require('@vara-eth/api') as {
      __getLastPublicClientTransportForTests: () => string | undefined;
    };
    const customPreset = {
      varaEthRpc: LOCAL_PRESET.varaEthRpc,
      ethereumRpc: LOCAL_PRESET.ethereumRpc,
      routerAddress: EXPLICIT_ROUTER,
    } as const;

    await getEthexeApi({ networkPreset: customPreset });

    expect(apiStub.__getLastPublicClientTransportForTests()).toBe('webSocket');
  });

  it('identifies a malformed HTTP override by its actual config key', async () => {
    await expect(getEthexeApi({
      networkPreset: LOCAL_PRESET,
      ethereumHttpRpc: 'ftp://invalid.example',
      routerAddress: EXPLICIT_ROUTER,
    })).rejects.toMatchObject({
      code: 'INVALID_CONFIG_VALUE',
      meta: {
        key: 'ethereumHttpRpc',
        value: 'ftp://invalid.example',
      },
    });
  });

  it('classifies Vara.eth provider connect timeouts and disconnects the provider', async () => {
    jest.useFakeTimers();
    const apiStub = require('@vara-eth/api') as {
      __setWsConnectImplementationForTests: (fn: () => Promise<void>) => void;
      __getWsDisconnectCallsForTests: () => number;
    };
    apiStub.__setWsConnectImplementationForTests(() => new Promise(() => {}));

    const promise = getEthexeApi({ networkPreset: LOCAL_PRESET, routerAddress: EXPLICIT_ROUTER });
    jest.advanceTimersByTime(10_000);

    await expect(promise).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
      meta: {
        reason: 'timeout',
        endpoint: LOCAL_PRESET.varaEthRpc,
      },
    });
    expect(apiStub.__getWsDisconnectCallsForTests()).toBe(1);
  });

  it('disconnects exactly once when API bootstrap fails', async () => {
    const apiStub = require('@vara-eth/api') as {
      __setCreateApiImplementationForTests: (fn: () => Promise<unknown>) => void;
      __getWsDisconnectCallsForTests: () => number;
    };
    apiStub.__setCreateApiImplementationForTests(async () => {
      throw new Error('bootstrap failed');
    });

    await expect(getEthexeApi({
      networkPreset: LOCAL_PRESET,
      routerAddress: EXPLICIT_ROUTER,
    })).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
      meta: { cause: 'bootstrap failed' },
    });

    expect(apiStub.__getWsDisconnectCallsForTests()).toBe(1);
  });

  it('attributes nested Ethereum HTTP failures to the HTTP endpoint', async () => {
    const apiStub = require('@vara-eth/api') as {
      __setCreateApiImplementationForTests: (fn: () => Promise<unknown>) => void;
    };
    const socketError = Object.assign(new Error('getaddrinfo ENOTFOUND custom-eth.example'), {
      code: 'ENOTFOUND',
    });
    const fetchError = Object.assign(new Error('fetch failed'), { cause: socketError });
    apiStub.__setCreateApiImplementationForTests(async () => {
      throw Object.assign(
        new Error(`HTTP request failed. URL: ${LOCAL_PRESET.ethereumHttpRpc}/`),
        { cause: fetchError },
      );
    });

    await expect(getEthexeApi({
      networkPreset: LOCAL_PRESET,
      routerAddress: EXPLICIT_ROUTER,
    })).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
      meta: {
        reason: 'dns_failure',
        endpoint: LOCAL_PRESET.ethereumHttpRpc,
        host: '127.0.0.1',
      },
    });
  });

  it('attributes a bootstrap timeout to HTTP after the validator is connected', async () => {
    jest.useFakeTimers();
    const apiStub = require('@vara-eth/api') as {
      __setCreateApiImplementationForTests: (fn: () => Promise<unknown>) => void;
    };
    apiStub.__setCreateApiImplementationForTests(() => new Promise(() => {}));

    const promise = getEthexeApi({ networkPreset: LOCAL_PRESET, routerAddress: EXPLICIT_ROUTER });
    await Promise.resolve();
    jest.advanceTimersByTime(10_000);

    await expect(promise).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
      meta: {
        reason: 'timeout',
        endpoint: LOCAL_PRESET.ethereumHttpRpc,
      },
    });
  });

  it('disconnects late-settling provider connections after a timeout', async () => {
    jest.useFakeTimers();
    const apiStub = require('@vara-eth/api') as {
      __setWsConnectImplementationForTests: (fn: () => Promise<void>) => void;
      __getWsDisconnectCallsForTests: () => number;
    };
    let resolveConnect!: () => void;
    apiStub.__setWsConnectImplementationForTests(() => new Promise<void>((resolve) => {
      resolveConnect = resolve;
    }));

    const promise = getEthexeApi({ networkPreset: LOCAL_PRESET, routerAddress: EXPLICIT_ROUTER });
    jest.advanceTimersByTime(10_000);

    await expect(promise).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
      meta: {
        reason: 'timeout',
        endpoint: LOCAL_PRESET.varaEthRpc,
      },
    });
    expect(apiStub.__getWsDisconnectCallsForTests()).toBe(1);

    resolveConnect();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    expect(apiStub.__getWsDisconnectCallsForTests()).toBe(2);
  });

  it('consumes a late API-bootstrap rejection after the shared timeout', async () => {
    jest.useFakeTimers();
    const apiStub = require('@vara-eth/api') as {
      __setWsConnectImplementationForTests: (fn: () => Promise<void>) => void;
      __setCreateApiImplementationForTests: (fn: () => Promise<unknown>) => void;
      __getWsDisconnectCallsForTests: () => number;
    };
    let rejectApi!: (error: Error) => void;
    apiStub.__setWsConnectImplementationForTests(() => new Promise(() => {}));
    apiStub.__setCreateApiImplementationForTests(() => new Promise((_, reject) => {
      rejectApi = reject;
    }));

    const promise = getEthexeApi({ networkPreset: LOCAL_PRESET, routerAddress: EXPLICIT_ROUTER });
    jest.advanceTimersByTime(10_000);
    await expect(promise).rejects.toMatchObject({ code: 'TRANSPORT_ERROR' });

    rejectApi(new Error('late bootstrap failure'));
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    expect(apiStub.__getWsDisconnectCallsForTests()).toBe(2);
  });
});
