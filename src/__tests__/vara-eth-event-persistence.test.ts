import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testing as varaEthActionsTesting } from '../commands/vara-eth-actions';
import { closeEventStore, initEventStore, queryEvents } from '../services/event-store';
import { writeConfig } from '../services/config';

const savedWalletDir = process.env.VARA_WALLET_DIR;
const savedPresetName = process.env.VARA_ETH_NETWORK_PRESET_NAME;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vw-vara-eth-events-'));
  process.env.VARA_WALLET_DIR = tmpDir;
  process.env.VARA_ETH_NETWORK_PRESET_NAME = 'hoodi';
  writeConfig({ varaEthNetwork: 'mainnet' });
  initEventStore();
});

afterEach(() => {
  closeEventStore();
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedWalletDir === undefined) delete process.env.VARA_WALLET_DIR;
  else process.env.VARA_WALLET_DIR = savedWalletDir;
  if (savedPresetName === undefined) delete process.env.VARA_ETH_NETWORK_PRESET_NAME;
  else process.env.VARA_ETH_NETWORK_PRESET_NAME = savedPresetName;
});

describe('Vara.eth event persistence', () => {
  it('stores events under the resolved command-line network instead of stale config', () => {
    varaEthActionsTesting.persistVaraEthEvent('block', {
      number: 42,
      hash: '0xabc',
      eventId: 'hoodi-block-42',
    });

    expect(queryEvents({ chain: 'vara-eth', network: 'hoodi' })).toHaveLength(1);
    expect(queryEvents({ chain: 'vara-eth', network: 'mainnet' })).toHaveLength(0);
  });
});
