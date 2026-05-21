import * as fs from 'fs';
import * as path from 'path';
import { writeUserFile } from '../utils/secure-file';

export interface VaraWalletConfig {
  wsEndpoint?: string;
  defaultAccount?: string;
  /** Default account name for the Vara.eth rail. Falls back to defaultAccount when unset. */
  defaultVaraEthAccount?: string;
  dexFactoryAddress?: string;
  faucetUrl?: string;
  defaultChain?: 'vara' | 'vara-eth';
  /** Last selected Substrate Vara network preset. */
  varaNetwork?: 'mainnet' | 'testnet' | 'local';
  /** Last selected Vara.eth network preset. Hoodi is the public testnet. */
  varaEthNetwork?: 'mainnet' | 'hoodi' | 'local';
  varaEthRpc?: string;
  ethereumRpc?: string;
  routerAddress?: `0x${string}`;
  /** Validator endpoint URLs for the Vara.eth validator pool. */
  varaEthValidatorPool?: string[];
}

export const NETWORK_MAP: Record<string, string> = {
  mainnet: 'wss://rpc.vara.network',
  testnet: 'wss://testnet.vara.network',
  local: 'ws://localhost:9944',
};

function getConfigDir(): string {
  return process.env.VARA_WALLET_DIR || path.join(process.env.HOME || '~', '.vara-wallet');
}

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

export function readConfig(): VaraWalletConfig {
  const configPath = getConfigPath();
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as VaraWalletConfig;
  } catch {
    return {};
  }
}

export function writeConfig(config: VaraWalletConfig): void {
  writeUserFile(getConfigPath(), JSON.stringify(config, null, 2) + '\n');
}

export function updateConfig(updates: Partial<VaraWalletConfig>): void {
  const config = readConfig();
  writeConfig({ ...config, ...updates });
}

export { getConfigDir };
