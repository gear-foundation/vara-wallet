# Vara.eth Testnet Guide

> **Status**: scaffold — full happy-path canary coming in a follow-up.

## Network presets

Use `--chain vara-eth --network <name>` to select a preset.

| Name | Ethereum RPC | Vara.eth RPC | Router | Block time |
|------|-------------|-------------|--------|------------|
| `local` | `ws://127.0.0.1:8545` (Anvil) | `ws://127.0.0.1:9944` | discovered at runtime | 1 s |
| `hoodi` | `wss://hoodi-reth-rpc.gear-tech.io/ws` | `wss://vara-eth-validator-1.gear-tech.io:9944` | TBD (pending announcement) | 12 s |
| `mainnet` | — | — | not deployed | — |

`mainnet` is hidden in `--help` and throws `NETWORK_NOT_DEPLOYED` if accessed.

## Hoodi testnet

Hoodi is the primary Vara.eth testnet running on the Hoodi Ethereum testnet (chain id 560048).

### Funding

> **Coming in a follow-up**: full Hoodi funding flow (faucet → WVARA wrap → top up executable balance).

Steps at a high level:
1. Get Hoodi ETH from a Hoodi faucet (e.g. https://faucet.hoodi.ethpandaops.io).
2. Wrap ETH to WVARA via the Router contract (or use `vara-eth:wvara transfer`).
3. Top up your program's executable balance via `vara-eth:message send`.

### Quick connect

```bash
vara-wallet vara-eth:wallet create alice --passphrase mypass
vara-wallet vara-eth:wvara balance 0xYOUR_ADDRESS --chain vara-eth --network hoodi
```

## Local development

Requires Anvil + an ethexe node running locally.

```bash
# Start Anvil
anvil --block-time 1

# Start ethexe node (dev mode)
ethexe run --dev

# Connect
vara-wallet vara-eth:wvara balance 0xYOUR_ADDRESS --chain vara-eth --network local
```
