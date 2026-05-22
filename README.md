# vara-wallet

Agentic wallet CLI for Vara Network — designed for AI coding agents.

All output is structured JSON by default. No interactive prompts. Wallets are encrypted automatically with zero setup required.

## Quick Start

```bash
# Install
npm install -g vara-wallet

# Create a wallet (auto-generates passphrase, encrypts, no secrets shown)
vara-wallet wallet create --name my-wallet

# Check balance
vara-wallet balance

# Transfer VARA
vara-wallet transfer <destination> 10

# Interact with a Sails program on native Vara
vara-wallet call <programId> Service/Method --args '["arg1", "arg2"]'

# Pass hex strings for binary args — auto-converted to byte arrays
vara-wallet call <programId> Service/Upload --args '["0xdeadbeef"]'

# Pass SS58 or hex addresses for ActorId args — SS58 auto-normalized to hex
vara-wallet call <programId> Vft/BalanceOf --args '["5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"]'

# Use the Vara.eth rail on Hoodi
vara-wallet vara-eth:wallet create agent-eth --passphrase "$PASSPHRASE"
vara-wallet --chain vara-eth --network hoodi vara-eth:wvara balance 0xYOUR_ETH_ADDRESS
```

## Installation

Requires Node.js 22 or newer.

```bash
npm install -g vara-wallet
```

The CLI ships as a single bundled file (~2 MB gzipped) with only two runtime dependencies (`better-sqlite3` and `smoldot`), so global install is a few seconds on any network.

### From source

```bash
git clone https://github.com/gear-foundation/vara-wallet.git
cd vara-wallet
npm install --legacy-peer-deps
npm run build
npm link
```

## Global Options

```
--ws <endpoint>       WebSocket endpoint (default: wss://rpc.vara.network)
--light               Use embedded light client (smoldot) instead of WebSocket
--seed <seed>         Account seed (SURI like //Alice or hex)
--mnemonic <mnemonic> Account mnemonic phrase
--account <name>      Wallet name to use
--passphrase <pass>   Vara.eth wallet passphrase
--json                Force JSON output
--human               Force human-readable output
--quiet               Suppress all output except errors
--verbose             Show debug info on stderr
--network <name>      Network shorthand: mainnet, testnet, or local
--chain <name>        Target chain: vara (default) or vara-eth
```

`--network` maps to the well-known endpoint for the active chain. Native Vara uses `mainnet|testnet|local`; Vara.eth uses `mainnet|hoodi|local`. Pick the chain first with `--chain`.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VARA_WS` | WebSocket endpoint | `wss://rpc.vara.network` |
| `VARA_SEED` | Account seed | — |
| `VARA_MNEMONIC` | Account mnemonic | — |
| `VARA_LIGHT` | Set to `1` to use embedded light client (smoldot) | — |
| `VARA_PASSPHRASE` | Wallet passphrase (CI/Docker fallback) | — |
| `VARA_WALLET_DIR` | Config directory | `~/.vara-wallet` |
| `VARA_DEX_FACTORY` | DEX factory program address | — |
| `VARA_FAUCET_URL` | Faucet API URL | `https://faucet.gear-tech.io` |
| `VARA_ETH_RPC` | Vara.eth validator RPC | network preset |
| `ETHEREUM_RPC` | Ethereum JSON-RPC/WebSocket endpoint for Vara.eth | network preset |
| `VARA_ETH_ROUTER` | Vara.eth Router address | network preset |

## Account Resolution

When a native Vara command needs a signing account, it checks in order:

1. `--seed` flag
2. `VARA_SEED` env var
3. `--mnemonic` flag
4. `VARA_MNEMONIC` env var
5. `--account` flag (loads wallet file)
6. Default account from config

Vara.eth commands use Ethereum V3 keystores under `~/.vara-wallet/wallets/<name>.vara-eth.json`. Select them with `--account <name>` and provide the keystore passphrase with `--passphrase` or `VARA_PASSPHRASE`.

## Wallet Encryption

Wallets are encrypted by default using Polkadot's xsalsa20-poly1305 + scrypt KDF.

**Passphrase resolution for decryption:**
1. `~/.vara-wallet/.passphrase` file (primary — agent never sees it)
2. `VARA_PASSPHRASE` env var (fallback for CI/Docker)

**On first `wallet create`:** If no passphrase source exists, a random 256-bit passphrase is auto-generated and saved to `~/.vara-wallet/.passphrase` with `0600` permissions. The agent never sees the passphrase value.

```bash
# Zero-setup: just works
vara-wallet wallet create --name agent-key
# Passphrase auto-generated, wallet encrypted, secrets suppressed

# Human override
vara-wallet wallet create --name human-key --passphrase "memorable-phrase"

# Opt out of encryption (not recommended)
vara-wallet wallet create --name unsafe --no-encrypt --show-secret
```

Vara.eth wallets are separate Ethereum V3 keystores:

```bash
vara-wallet vara-eth:wallet create alice --passphrase "$PASSPHRASE"
vara-wallet vara-eth:wallet import alice --private-key 0x... --passphrase "$PASSPHRASE"
vara-wallet vara-eth:wallet show alice
```

## Commands

### `init`

Initialize wallet infrastructure with a default wallet.

```bash
vara-wallet init [--name <name>]
```

### `faucet`

Request testnet TVARA tokens. Proves address ownership via a challenge-sign-claim flow. Automatically connects to testnet RPC.

```bash
vara-wallet faucet [address] [--faucet-url <url>]
```

Skips the request if the account already has >= 1000 TVARA. Faucet URL resolves from: `--faucet-url` flag > `VARA_FAUCET_URL` env > `config.faucetUrl` > default.

### `wallet`

```bash
vara-wallet wallet create [--name <n>] [--passphrase <p>] [--no-encrypt] [--show-secret]
vara-wallet wallet import [--name <n>] [--mnemonic <m>] [--seed <s>] [--json <path>] [--passphrase <p>] [--no-encrypt]
vara-wallet wallet list
vara-wallet wallet export <name> [--decrypt] [--output <path>]
vara-wallet wallet keys <name>
vara-wallet wallet default [name]
```

Without an explicit `--chain`, `wallet list` shows both native Vara and Vara.eth wallets with a `chain` field on each row. Use `--chain vara wallet list` or `--chain vara-eth wallet list` for a chain-specific inventory.

`wallet keys` outputs the raw key material: `{ address, publicKey, secretKeyPkcs8, type }`. The PKCS8 blob contains the full secret key and can be used with Polkadot tooling to reconstruct the keypair. This is a sensitive operation — the secret key is exposed in the output. For a redacted export suitable for sharing, use `wallet export`.

### Vara.eth rail

Vara.eth is selected with `--chain vara-eth`. Its public testnet preset is `hoodi`; `--network testnet` remains the native Vara/Substrate testnet and is not a Vara.eth alias.

```bash
# Read-only preflight
vara-wallet --chain vara-eth --network hoodi vara-eth:wvara balance 0xYOUR_ETH_ADDRESS
vara-wallet --chain vara-eth --network hoodi vara-eth:state read 0xMIRROR

# Send a message through the direct Ethereum path (safe default for writes)
vara-wallet --chain vara-eth --network hoodi --account alice \
  vara-eth:message send 0xMIRROR --payload 0xfeed --via eth

# Deploy a Sails program through the root command surface
vara-wallet --chain vara-eth --network hoodi --account alice \
  program upload ./program.opt.wasm --idl ./program.idl --args '[]'

# Discover and call a Sails Mirror
vara-wallet --chain vara-eth --network hoodi discover 0xMIRROR --idl ./program.idl
vara-wallet --chain vara-eth --network hoodi call 0xMIRROR Service/Query --args '[]' --idl ./program.idl
```

Direct Vara.eth commands are available for rail-specific operations:

```bash
vara-wallet vara-eth:wallet create alice --passphrase "$PASSPHRASE"
vara-wallet --chain vara-eth --network hoodi vara-eth:program top-up 0xMIRROR --amount 1
vara-wallet --chain vara-eth --network hoodi vara-eth:subscribe router
```

Injected sends remain available with `--via injected`; use `--no-validate-signature` only for diagnostics when investigating validator-signature recovery. See `docs/vara-eth-networks.md` for endpoints and `docs/sails-real-program-e2e.md` for the full Sails deploy/discover/call smoke.

### `node`

```bash
vara-wallet node info
```

### `balance` / `transfer`

```bash
vara-wallet balance [address]
vara-wallet transfer <to> <amount> [--units human|raw]
vara-wallet transfer <to> --all
```

`--all` drains the entire account via Substrate's native `transferAll` extrinsic (no client-side fee/ED math). Without `--all`, transfers use `transferKeepAlive`. `--all` and an explicit amount are mutually exclusive.

### `message`

```bash
vara-wallet message send <destination> [--payload <hex>] [--gas-limit <n>] [--value <v>] [--units human|raw] [--metadata <path>] [--voucher <id>]
vara-wallet message reply <messageId> [--payload <hex>] [--gas-limit <n>] [--value <v>] [--units human|raw] [--metadata <path>] [--voucher <id>]
vara-wallet message calculate-reply <programId> [--payload <hex>] [--value <v>] [--units human|raw] [--origin <addr>] [--at <blockHash>]
```

Gas is auto-calculated if `--gas-limit` is omitted. Destination can be any actor (program, user, wallet). Use `--value` to transfer VARA tokens alongside a message. Use `--voucher <id>` to pay for the message using a voucher instead of the sender's balance.

### `program`

```bash
vara-wallet program upload <wasm> [--payload <hex>] [--idl <path>] [--init <name>] [--args <json> | --args-file <path>] [--gas-limit <n>] [--value <v>] [--units human|raw] [--salt <hex>] [--metadata <path>] [--dry-run]
vara-wallet program deploy <codeId> [--payload <hex>] [--idl <path>] [--init <name>] [--args <json> | --args-file <path>] [--gas-limit <n>] [--value <v>] [--units human|raw] [--salt <hex>] [--metadata <path>] [--dry-run]
vara-wallet program info <programId>
vara-wallet program list [--count <n>] [--all]
```

Use `--idl` to auto-encode the constructor payload from a Sails IDL file. The constructor is auto-selected if the IDL has only one; use `--init <name>` when multiple constructors exist. `--args` passes constructor arguments as a JSON array, or use `--args-file <path>` to read JSON from a file (or `-` for stdin). `--payload` and `--idl` are mutually exclusive. `--dry-run` encodes the constructor payload and exits without signing or submitting; the response reports the resolved constructor name, encoded hex, and `willSubmit: false`.

```bash
# Deploy with IDL-based constructor encoding (auto-selects "New" constructor)
vara-wallet program upload ./demo.opt.wasm --idl ./demo.idl --args '["MyToken", "MTK", 18]'

# Explicit constructor name
vara-wallet program upload ./demo.opt.wasm --idl ./demo.idl --init New --args '["MyToken", "MTK", 18]'

# Deploy from existing code ID
vara-wallet program deploy 0xCODE_ID --idl ./demo.idl --args '["MyToken", "MTK", 18]'
```

### `code`

```bash
vara-wallet code upload <wasm> [--voucher <id>]
vara-wallet code info <codeId>
vara-wallet code list [--count <n>]
```

### `call` (Sails)

High-level method invocation on Sails programs. Auto-detects queries vs functions. `--estimate` computes gas cost (account required). `--dry-run` encodes the SCALE payload without signing / submitting (no account needed, useful for previewing on read-only machines). The two compose: passing both encodes AND estimates in one call.

```bash
vara-wallet call <programId> <Service/Method> [--args <json> | --args-file <path>] [--value <v>] [--units human|raw] [--gas-limit <n>] [--idl <path>] [--voucher <id>] [--estimate] [--dry-run]
```

For programs that embed a `sails:idl` custom section, the IDL is auto-resolved from the program's on-chain WASM. This includes plain-text Sails IDL v1 (for example Sails 0.10.4) and v2 envelope formats. `--idl` is only needed when a program has no usable embedded IDL, or when overriding with a local file. Resolved IDLs are cached under `~/.vara-wallet/idl-cache/` so subsequent calls skip the fetch. Inspect or evict the cache with `vara-wallet idl list/remove/clear`.

`--args-file <path>` reads the JSON args from a file instead of the `--args` string; use `-` for stdin (`echo '[...]' | vara-wallet call ... --args-file -`). Eliminates shell-escape failures with nested JSON containing hex actor IDs or 64-byte `vec u8` signatures. Mutually exclusive with `--args` (`INVALID_ARGS_SOURCE`).

`--dry-run` output includes `encodedPayload` (the actual SCALE-encoded call bytes — round-trippable via `decode`), `destination` (the program ID the message is bound for), and `willSubmit: false`. With `--estimate` also set, `estimateGas: { gasLimit, minLimit }` is appended.

The JSON response from a real submission includes an `events: [...]` field with any decoded Sails events emitted by the call, phase-correlated to the submitting extrinsic (cross-transaction events from the same block are excluded). Nested numeric leaves (`U256`, `u128`) inside `Option`, `Vec`, tuples, structs, enums, `Result`, or user types are recursively decoded to decimal strings to match the declared IDL return type.

With Sails v2 beta.2 programs, function replies and emitted events are decoded through the header-aware `sails-js` reply/event decoders before vara-wallet normalizes the JSON shape. Plain-text embedded IDLs, including Sails IDL v1 and older beta.1-style v2 sections, still load through the raw `sails:idl` fallback, so existing deployed programs remain readable.

### `discover` (Sails)

Introspect a Sails program's services, functions, queries, and events.

```bash
vara-wallet discover <programId> [--idl <path>]
```

Same auto-resolution as `call`.

### `idl` (Sails IDL cache)

Manage the local IDL cache at `~/.vara-wallet/idl-cache/`. The cache is populated automatically when programs auto-resolve their IDL from on-chain WASM, or manually via `idl import` for programs without a usable embedded IDL section.

```bash
vara-wallet idl import <path.idl> (--code-id <hex> | --program <hex|ss58>)
vara-wallet idl list
vara-wallet idl remove <code-id>
vara-wallet idl clear [--yes]
```

- **`idl import`** seeds the cache with an out-of-band IDL. `--code-id` is fully offline; `--program` resolves `codeId` via RPC. Once imported, `call`/`discover`/`vft`/`dex` find the IDL automatically for that program's `codeId`.
- **`idl list`** prints `[{ codeId, version, source, importedAt, idlSizeBytes }, ...]`. Empty cache returns `[]`. Corrupted entries surface as `{ codeId, error: 'corrupted', ... }` rows so a single bad file never crashes the listing.
- **`idl remove <code-id>`** removes one entry. Idempotent: removing a non-existent entry returns `{ removed: false, codeId }` and exit 0.
- **`idl clear`** (terraform-style) — bare invocation prints a `wouldRemove` preview without unlinking; `--yes` commits and prints `{ removed: N, path }`. Snapshot-then-unlink: ENOENT for entries removed by parallel writers between enumeration and unlink is swallowed.

### `vft` (Fungible Tokens)

Works out of the box with standard VFT programs — no `--idl` needed (bundled IDL fallback). Official bridged VFTs can be passed by alias on mainnet/testnet.

```bash
vara-wallet token list
vara-wallet token list --all
vara-wallet token resolve usdc --network mainnet
```

Built-in bridged-token aliases: `usdc`/`wusdc`, `usdt`/`wusdt`, `weth`, `wbtc`, and `tokenized-vara` (`wvara` on mainnet, `wtvara` on testnet). Aliases use `--network`, `VARA_WS`, config, or the default mainnet endpoint to pick the network. On `local` or custom endpoints, pass the raw token program address.

```bash
vara-wallet vft info <tokenProgram|alias> [--idl <path>]
vara-wallet vft balance <tokenProgram|alias> [account] [--idl <path>]
vara-wallet vft allowance <tokenProgram|alias> <owner> <spender> [--idl <path>]
vara-wallet vft transfer <tokenProgram|alias> <to> <amount> [--idl <path>] [--units human|raw] [--voucher <id>]
vara-wallet vft approve <tokenProgram|alias> <spender> <amount> [--idl <path>] [--units human|raw] [--voucher <id>]
vara-wallet vft transfer-from <tokenProgram|alias> <from> <to> <amount> [--idl <path>] [--units human|raw] [--voucher <id>]
vara-wallet vft mint <tokenProgram|alias> <to> <amount> [--idl <path>] [--units human|raw] [--voucher <id>]
vara-wallet vft burn <tokenProgram|alias> <from> <amount> [--idl <path>] [--units human|raw] [--voucher <id>]
```

`--units human` passes amounts using the token's declared decimals (e.g., `1.5` auto-converts via the on-chain `Decimals` query). Default is `raw` (minimal units, passthrough as bigint). The legacy `token` literal was renamed to `human` in 0.15.0 for cross-command consistency. `vft balance` and `vft allowance` safely return `'0'` when the underlying query is `opt u256` and the account has no row (was a `BigInt(null)` crash in 0.14.x).

### `dex` (DEX Trading)

Trade tokens on the vara-amm decentralized exchange (Rivr DEX). Works with bundled IDLs — no `--idl` needed. Requires a factory address via `--factory`, `VARA_DEX_FACTORY` env, or `dexFactoryAddress` in config.

Rivr DEX testnet factory: `0xaec14c514124fffa6c4b832ba7c12fa19e7fa663774c549c114786e220dd0a4e`

```bash
vara-wallet dex pairs [--factory <addr>] [--limit <n>]
vara-wallet dex pool <token0|alias> <token1|alias> [--factory <addr>]
vara-wallet dex quote <tokenIn|alias> <tokenOut|alias> <amount> [--reverse] [--units human|raw]
vara-wallet dex swap <tokenIn|alias> <tokenOut|alias> <amount> [--slippage <bps>] [--deadline <s>] [--exact-out] [--skip-approve] [--voucher <id>]
vara-wallet dex add-liquidity <token0|alias> <token1|alias> <amount0> <amount1> [--slippage <bps>] [--deadline <s>] [--skip-approve] [--voucher <id>]
vara-wallet dex remove-liquidity <token0|alias> <token1|alias> <liquidity> [--slippage <bps>] [--deadline <s>] [--skip-approve] [--voucher <id>]
```

Slippage is in basis points (100 = 1%, default). Swaps auto-approve input tokens unless `--skip-approve` is set. Use `--units human` to pass amounts in the token's declared decimals (e.g. `1.5`); default is `raw` (minimal units).

```bash
vara-wallet dex quote usdc weth 10 --units human --network mainnet --factory <factory>
```

### `voucher`

```bash
vara-wallet voucher issue <spender> <value> [--units human|raw] [--duration <blocks>] [--programs <ids>]
vara-wallet voucher list <account> [--program <id>]
vara-wallet voucher revoke <spender> <voucherId>
```

### `mailbox`

```bash
vara-wallet mailbox read [address]
vara-wallet mailbox claim <messageId>
```

### `state`

```bash
vara-wallet state read <programId> [--payload <hex>] [--origin <addr>] [--at <blockHash>]
```

### `tx` / `query` (Generic Substrate)

```bash
vara-wallet tx <pallet> <method> [args...]
vara-wallet query <pallet> <method> [args...]
```

### `wait`

Wait for a reply to a message.

```bash
vara-wallet wait <messageId> [--timeout <seconds>]
```

### `subscribe`

Subscribe to on-chain events with NDJSON streaming and optional SQLite persistence. Events are stored in `~/.vara-wallet/events.db` so they survive between runs.

```bash
vara-wallet subscribe blocks [--finalized]
vara-wallet subscribe messages <programId> [--event <Service/Event | EventName | pallet:Name>] [--from-block <n>] [--idl <path>] [--no-decode]
vara-wallet subscribe mailbox <address>
vara-wallet subscribe balance <address>
vara-wallet subscribe transfers [--from <addr>] [--to <addr>]
vara-wallet subscribe program <programId>
```

**Global subscribe options:**
- `--count <n>` — exit after N events (useful for scripting)
- `--timeout <seconds>` — exit after N seconds
- `--no-persist` — stream only, skip SQLite persistence

`subscribe messages` and `watch` share the IDL-aware filtering / decoding behavior. Both use `--event` (renamed from `--type` in 0.15.0 for consistency).

### `inbox`

Query captured mailbox messages from the event store.

```bash
vara-wallet inbox list [--since <duration>] [--limit <n>]
vara-wallet inbox read <messageId>
```

### `events`

Query and manage all captured events from the event store.

```bash
vara-wallet events list [--type <type>] [--since <duration>] [--program <id>] [--limit <n>]
vara-wallet events prune [--older-than <duration>]
```

### `watch`

Stream program events as NDJSON. For persistent event capture with SQLite storage, see `subscribe` above.

```bash
vara-wallet watch <programId> [--event <type>] [--idl <path>] [--no-decode]
```

`--event` accepts:
- **Gear pallet event names** (`UserMessageSent`, `MessageQueued`, ...) — bare names that match the legacy pallet vocab always resolve to the pallet path, so existing scripts keep working.
- **Qualified Sails events** as `Service/Event` — always unambiguous.
- **Bare Sails event names** — succeed when exactly one service declares the event. Multiple-service collisions hard-fail with `AMBIGUOUS_EVENT` listing the alternatives.
- **`pallet:<Name>` prefix** — explicitly forces pallet vocabulary even when an IDL is loaded. Replaces the old `--pallet-event` flag (removed in 0.15.0). Example: `--event pallet:UserMessageSent`.

When an IDL is loaded (explicit `--idl` or auto-resolved from the on-chain WASM), each emitted `UserMessageSent` is augmented with a `decoded: { kind: 'sails', service, event, data }` block alongside the existing raw fields (`payload`, `source`, `destination`, ...) — additive, so consumers parsing raw NDJSON keep working. The `kind` discriminator future-proofs the surface for additional decoder types. (Renamed from `sails: {...}` in 0.15.0.) `--no-decode` disables the opportunistic IDL auto-load entirely.

### `encode` / `decode`

```bash
vara-wallet encode <type> [value] [--args-file <path>] [--metadata <path>] [--idl <path>] [--program <id>] [--method <Service/Method>]
vara-wallet decode <type> <hex> [--metadata <path>] [--idl <path>] [--program <id>] [--method <Service/Method>]
```

For `encode`, the JSON value can be passed positionally or via `--args-file <path>` (use `-` for stdin). Positional and `--args-file` are mutually exclusive (`INVALID_ARGS_SOURCE`). Stdin via `--args-file -` rejects fast with `STDIN_IS_TTY` when no pipe is attached.

### `config`

Manage persistent CLI configuration. Settings are stored in `~/.vara-wallet/config.json`.

```bash
vara-wallet config list
vara-wallet config get <key>
vara-wallet config set <key> <value>
vara-wallet config set network testnet   # shorthand for wsEndpoint
```

Valid keys: `wsEndpoint`, `defaultAccount`, `dexFactoryAddress`, `faucetUrl`. The `network` alias maps `mainnet`/`testnet`/`local` to the corresponding `wsEndpoint` URL.

**Endpoint resolution order:** `--ws` flag > `--network` flag > `VARA_WS` env > `config.wsEndpoint` > default (`wss://rpc.vara.network`).

### `sign` / `verify`

Sign arbitrary data and verify signatures. Uses raw sr25519 signing (no `<Bytes>` wrapping). No network connection needed.

```bash
# Sign data (UTF-8 string by default)
vara-wallet sign "hello world"
# Output: { signature, publicKey, address, cryptoType }

# Sign hex data
vara-wallet sign 0xdeadbeef --hex

# Verify a signature
vara-wallet verify "hello world" 0x<signature> --address <signer-address>
# Output: { isValid, address, cryptoType }
```

The `--hex` flag treats input as 0x-prefixed hex bytes (strict validation: even-length, valid hex chars). Without `--hex`, input is treated as a UTF-8 string.

## File Structure

```
~/.vara-wallet/
  config.json          # wsEndpoint, defaultAccount, dexFactoryAddress, faucetUrl
  .passphrase          # Auto-generated or human-provided (0600)
  events.db            # SQLite event store (subscribe/inbox/events)
  wallets/
    default.json       # Encrypted keystore (0600)
    *.json
  idl-cache/
    <codeId>.cache.json  # Auto-populated from on-chain WASM or `idl import`
```

## Error Codes

| Code | Meaning |
|------|---------|
| `PASSPHRASE_REQUIRED` | Encrypted wallet, no passphrase available |
| `DECRYPT_FAILED` | Wrong passphrase |
| `WALLET_NOT_FOUND` | Wallet file doesn't exist |
| `WALLET_EXISTS` | Wallet name already taken |
| `NO_ACCOUNT` | No account configured |
| `TX_TIMEOUT` | Transaction not included in 60s |
| `TX_FAILED` | On-chain extrinsic failure |
| `IDL_NOT_FOUND` | No Sails IDL available. Distinguishes readable WASM with no `sails:idl` section from chain-unavailable cases (RPC down, no program) |
| `INVALID_ARGS_FORMAT` | `--args` shape mismatch. Sails methods take positional args; pass as JSON array. 1-arg struct methods also accept bare `{...}` (wrapped automatically) |
| `INVALID_ADDRESS` | `actor_id` field received a non-string non-array value. Message names the offending field: `Invalid ActorId for "<name>": ...` |
| `METHOD_NOT_FOUND` | Method not in Sails IDL |
| `DEX_FACTORY_NOT_CONFIGURED` | No factory address set |
| `DEX_SERVICE_NOT_FOUND` | DEX method not found in IDL |
| `PAIR_NOT_FOUND` | Trading pair doesn't exist |
| `TOKEN_MISMATCH` | Tokens don't match pair |
| `TOKEN_NOT_FOUND` | Built-in token alias is unknown for the selected network |
| `TOKEN_NETWORK_UNSUPPORTED` | Built-in token aliases require mainnet/testnet; pass a raw token address on local/custom endpoints |
| `INVALID_SLIPPAGE` | Slippage out of range (0-5000 bps) |
| `TRANSPORT_ERROR` | WS / RPC / light-client / chainspec-fetch failure. All fields sit at top level (no `meta` envelope): `.reason` (one of `dns_failure`, `connection_refused`, `timeout`, `ws_close_abnormal`, `protocol_mismatch`, `unreachable`, `tls_failure`, `unknown`), `.endpoint`, and either `.host` (DNS) or `.cause` (raw upstream message). Agents should switch on `.reason` to distinguish transient (`timeout`, `ws_close_abnormal` — match the wallet's own auto-retry) from permanent (`dns_failure`, `tls_failure`, `protocol_mismatch`, `connection_refused`, `unreachable`). |
| `CONNECTION_FAILED` | Faucet HTTP request failure (the WS / RPC surface now uses `TRANSPORT_ERROR`). |
| `WRONG_NETWORK` | Command not available on this network (e.g., faucet on mainnet) |
| `INVALID_NETWORK` | Unknown `--network` value |
| `INVALID_CONFIG_KEY` | Unknown config key passed to `config set/get` |
| `CONFLICTING_OPTIONS` | Mutually exclusive options used together (e.g., `--network` + `--ws`). Note: `--estimate` + `--dry-run` *compose* on `call` since 0.15.0 (no longer conflicting) |
| `INVALID_ARGS_SOURCE` | `--args` and `--args-file` (or positional value + `--args-file` on `encode`) used together |
| `STDIN_IS_TTY` | `--args-file -` used with no pipe attached |
| `INVALID_UNITS` | `--units` value isn't `human` or `raw` (rejects legacy `vara` / `token` literals from pre-0.15) |
| `PERMISSION_DENIED` | OS-level permission error (e.g. `idl clear --yes` on a read-only cache dir) |
| `INVALID_CODE_ID` | `--code-id` argument isn't a 32-byte hex string |
| `AMBIGUOUS_EVENT` | Bare Sails event name resolves to multiple services — qualify as `Service/Event` |
| `FAUCET_ERROR` | Faucet request failed |
| `PROGRAM_ERROR` | Sails program execution failed (panic/error). Includes `meta.reason` (`panic` / `unreachable` / `inactive` / `not_found`) and `meta.programMessage` (contract error variant name) for structured matching |
| `FAUCET_LIMIT` | Faucet daily/hourly limit reached |
| `RATE_LIMITED` | Too many requests (429) |
| `AUTH_ERROR` | Signature verification failed |

## Development

```bash
npm run build        # Bundle CLI with esbuild → dist/app.js
npm run dev          # Run from source via ts-node
npm test             # Run tests
npx tsc --noEmit     # Type check only
```

The published artifact is a single bundled file (`dist/app.js`) built by `scripts/build.mjs`. `better-sqlite3` and `smoldot` are kept external because they ship native binaries / WASM that cannot be inlined.

## License

MIT
