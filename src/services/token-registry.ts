import { readConfig, NETWORK_MAP } from './config';
import { addressToHex, CliError } from '../utils';

export type TokenNetwork = 'mainnet' | 'testnet';

export interface KnownVftToken {
  network: TokenNetwork;
  symbol: string;
  name: string;
  address: `0x${string}`;
  aliases: readonly string[];
  category: 'bridged';
  decimals?: number;
  source: string;
}

export interface TokenResolveOptions {
  network?: string;
  ws?: string;
}

export interface ResolvedToken {
  input: string;
  address: `0x${string}`;
  isKnown: boolean;
  network?: TokenNetwork;
  alias?: string;
  token?: KnownVftToken;
}

const BRIDGE_DEVELOPER_HUB =
  'https://wiki.vara.network/docs/vara-network/bridge/developer_hub';

export const KNOWN_VFT_TOKENS: readonly KnownVftToken[] = [
  {
    network: 'mainnet',
    symbol: 'WUSDC',
    name: 'Wrapped USDC',
    address: '0xd1de816d7dce6439504552686ab333e5b7302b1549763656b30af1f8a5871b6a',
    aliases: ['wusdc', 'usdc'],
    category: 'bridged',
    decimals: 6,
    source: BRIDGE_DEVELOPER_HUB,
  },
  {
    network: 'mainnet',
    symbol: 'WUSDT',
    name: 'Wrapped USDT',
    address: '0x4255ff4a87a4c13dc39f74ace8c4948bbef2f75fb639d66639a1cfcc99e6243e',
    aliases: ['wusdt', 'usdt'],
    category: 'bridged',
    decimals: 6,
    source: BRIDGE_DEVELOPER_HUB,
  },
  {
    network: 'mainnet',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    address: '0xde45bdbb0345919a11561d43a5082e0b25061d4a2c6eb80009c1cfbccb80d0de',
    aliases: ['weth'],
    category: 'bridged',
    decimals: 18,
    source: BRIDGE_DEVELOPER_HUB,
  },
  {
    network: 'mainnet',
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    address: '0x4984671804477d0689eabcd5418eb751207f20f251eaf7884a25b98645f342b1',
    aliases: ['wbtc'],
    category: 'bridged',
    decimals: 8,
    source: BRIDGE_DEVELOPER_HUB,
  },
  {
    network: 'mainnet',
    symbol: 'WVARA',
    name: 'Tokenized VARA',
    address: '0x29c42c668012b1ce20720e4615229215023281ef4676fdc77bf047d7fbcb9d17',
    aliases: ['wvara', 'tokenized-vara'],
    category: 'bridged',
    decimals: 12,
    source: BRIDGE_DEVELOPER_HUB,
  },
  {
    network: 'testnet',
    symbol: 'WUSDC',
    name: 'Wrapped USDC',
    address: '0x9f332e61589e0850dce6d8e6070ea5618de33d9f134a4a35d6d1164dc9002f48',
    aliases: ['wusdc', 'usdc'],
    category: 'bridged',
    decimals: 6,
    source: BRIDGE_DEVELOPER_HUB,
  },
  {
    network: 'testnet',
    symbol: 'WUSDT',
    name: 'Wrapped USDT',
    address: '0x464511231a1afe9108a689ed3dbbb047ca308d6f5dfb86453e4df5612a2d668a',
    aliases: ['wusdt', 'usdt'],
    category: 'bridged',
    decimals: 6,
    source: BRIDGE_DEVELOPER_HUB,
  },
  {
    network: 'testnet',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    address: '0xba764e2836b28806be10fe6f674d89d1e0c86898d25728f776588f03bddc6f58',
    aliases: ['weth'],
    category: 'bridged',
    decimals: 18,
    source: BRIDGE_DEVELOPER_HUB,
  },
  {
    network: 'testnet',
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    address: '0xc1ec06d99efcffd863f9c2ad2bc76f656aff861acf06f438046c64e5b41e3fd9',
    aliases: ['wbtc'],
    category: 'bridged',
    decimals: 8,
    source: BRIDGE_DEVELOPER_HUB,
  },
  {
    network: 'testnet',
    symbol: 'WTVARA',
    name: 'Tokenized VARA',
    address: '0xa1a37e5a36e8a53921f6bedefadec91dc510636079a22238e9edf8233aaa494e',
    aliases: ['wtvara', 'tokenized-vara'],
    category: 'bridged',
    decimals: 12,
    source: BRIDGE_DEVELOPER_HUB,
  },
] as const;

export function normalizeTokenAlias(input: string): string {
  return input.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
}

export function isTokenNetwork(value: string | undefined): value is TokenNetwork {
  return value === 'mainnet' || value === 'testnet';
}

export function resolveTokenNetwork(options: TokenResolveOptions = {}): TokenNetwork {
  const explicit = options.network?.trim().toLowerCase();
  if (explicit) {
    if (isTokenNetwork(explicit)) return explicit;
    throw new CliError(
      `Built-in token aliases are available only on mainnet and testnet, not "${options.network}". Use a raw token program address instead.`,
      'TOKEN_NETWORK_UNSUPPORTED',
      { network: options.network },
    );
  }

  const endpoint = options.ws ?? process.env.VARA_WS ?? readConfig().wsEndpoint ?? NETWORK_MAP.mainnet;
  const network = Object.entries(NETWORK_MAP).find(([, url]) => url === endpoint)?.[0];
  if (isTokenNetwork(network)) return network;

  throw new CliError(
    `Built-in token aliases are not available for endpoint "${endpoint}". Use --network mainnet/testnet or pass a raw token program address.`,
    'TOKEN_NETWORK_UNSUPPORTED',
    { endpoint },
  );
}

export function listKnownVftTokens(network?: TokenNetwork): KnownVftToken[] {
  return KNOWN_VFT_TOKENS.filter((token) => !network || token.network === network);
}

export function resolveTokenIdentifier(input: string, options: TokenResolveOptions = {}): ResolvedToken {
  const address = tryResolveActorId(input);
  if (address) {
    return { input, address, isKnown: false };
  }

  const network = resolveTokenNetwork(options);
  const alias = normalizeTokenAlias(input);
  const token = KNOWN_VFT_TOKENS.find((candidate) => (
    candidate.network === network &&
    candidate.aliases.some((candidateAlias) => normalizeTokenAlias(candidateAlias) === alias)
  ));

  if (!token) {
    throw new CliError(
      `Unknown token alias "${input}" on ${network}. Run "vara-wallet token list --network ${network}" to see known tokens, or pass a raw token program address.`,
      'TOKEN_NOT_FOUND',
      { token: input, network },
    );
  }

  return { input, address: token.address, isKnown: true, network, alias, token };
}

export function tokenResolutionMeta(
  resolved: ResolvedToken,
  prefix = 'token',
): Record<string, unknown> {
  if (!resolved.isKnown || !resolved.token) return {};

  return {
    [`${prefix}Alias`]: resolved.alias,
    [`${prefix}Symbol`]: resolved.token.symbol,
    [`${prefix}Network`]: resolved.network,
  };
}

function tryResolveActorId(input: string): `0x${string}` | null {
  const trimmed = input.trim();

  if (/^0x/i.test(trimmed)) {
    if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
      return trimmed.toLowerCase() as `0x${string}`;
    }
    throw new CliError(
      `Invalid token program address: "${input}". Expected a 32-byte ActorId (0x + 64 hex chars).`,
      'INVALID_ADDRESS',
    );
  }

  try {
    const hex = addressToHex(trimmed);
    if (/^0x[0-9a-f]{64}$/.test(hex)) {
      return hex;
    }
    throw new CliError(
      `Invalid token program address: "${input}". Expected a 32-byte ActorId.`,
      'INVALID_ADDRESS',
    );
  } catch (err) {
    if (err instanceof CliError && err.code === 'INVALID_ADDRESS') {
      return null;
    }
    throw err;
  }
}
