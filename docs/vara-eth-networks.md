# Vara.eth Networks Guide

How to point vara-wallet at each Vara.eth deployment. Select via
`--chain vara-eth --network <name>`.

## Preset registry

| Name | Ethereum WS | Ethereum HTTP | Vara.eth RPC | Router | WVARA | Block time |
|------|-------------|---------------|--------------|--------|-------|------------|
| `mainnet` | `wss://mainnet-reth-rpc.gear-tech.io/ws` | `https://mainnet-reth-rpc.gear-tech.io` | `wss://validator-1-eth.vara.network` | [`0x9C13FE9242…aA74cb6`](https://etherscan.io/address/0x9C13FE9242dfe2ba2Cd446480A9308279aA74cb6) | [`0xB67010F224…E9d7E5aD`](https://etherscan.io/address/0xB67010F2246814e5c39593ac23A925D9e9d7E5aD) | 12 s |
| `hoodi`   | `wss://hoodi-reth-rpc.gear-tech.io/ws` | `https://hoodi-reth-rpc.gear-tech.io` | `wss://vara-eth-validator-1.gear-tech.io` | [`0xE549b0AfEd…A0b060`](https://hoodi.etherscan.io/address/0xE549b0AfEdA978271FF7E712232B9F7f39A0b060) | [`0xE1ab85A8B4…d7E5aD`](https://hoodi.etherscan.io/address/0xE1ab85A8B4d5d5B6af0bbD0203EB322DF33d0464) | 12 s |
| `local`   | `ws://127.0.0.1:8545` (Anvil) | `http://127.0.0.1:8545` | `ws://127.0.0.1:9944` | discovered at runtime | bound to Router | 1 s |

Vara.eth commands use the HTTP endpoint for Ethereum-side request/response JSON-RPC. Commands that need validator state or injected transactions open the validator connection in parallel with Ethereum bootstrap. Direct Ethereum submit-only messages (`--via eth --wait submitted`), WVARA writes, and direct submit-only Sails calls with an explicit `--idl` do not open the validator connection. Event subscriptions use Ethereum WebSocket because they require a persistent stream. For custom endpoints, set `ETHEREUM_HTTP_RPC`; if it is absent, requests fall back to `ETHEREUM_RPC`.

Mainnet and Hoodi each expose an additional beacon RPC for EIP-7594 blob
lookups (used by `vara-eth:program deploy` to upload WASM bytecode):
`https://mainnet-lighthouse-rpc.gear-tech.io` and
`https://hoodi-lighthouse-rpc.gear-tech.io` respectively.

## Mainnet (production)

Mainnet is live on Ethereum mainnet. Read-only operations work without a
wallet; any state-changing operation needs an ETH-funded signer plus
WVARA to cover Vara.eth fees.

```bash
# Read-only — inspect Router state, list validators, etc.
vara-wallet --chain vara-eth --network mainnet vara-eth:state read 0xMIRROR

# Read your WVARA balance
vara-wallet --chain vara-eth --network mainnet vara-eth:wvara balance 0xYOUR_ADDR

# Send a message (needs an --account wallet and WVARA-funded signer)
vara-wallet --chain vara-eth --network mainnet \
  vara-eth:message send 0xMIRROR --payload 0xfeed --account alice

# Fast transaction-only path: return after RPC acceptance, before receipt/reply
vara-wallet --chain vara-eth --network mainnet \
  vara-eth:message send 0xMIRROR --payload 0xfeed --account alice \
  --via eth --wait submitted
```

## Submission versus completion

Use `--wait submitted` for automation that only needs proof the RPC accepted a transaction:

- Direct `--via eth` message output contains `txHash`, `status: "submitted"`, and `messageId: null`. The message ID is emitted by the Mirror contract and is unavailable until the Ethereum receipt is mined.
- Injected output contains both `txHash` and the locally derived `messageId`, but no reply or validator-signature validation is performed.
- WVARA transfers and message replies return their Ethereum `txHash` without waiting for a block receipt.
- A raw-unit WVARA submit does not perform a decimals read; `amountRaw` is authoritative and the immediate output reports `amount: null` and `decimals: null`.

The compatibility defaults remain completion-oriented: message sends and Sails functions use `--wait reply`; WVARA transfers and message replies use `--wait receipt`. `--timeout-ms` applies to the reply-wait path, not submit-only RPC acceptance. Submit-only injected sends are not stored as resumable pending rows; `--resume` only reports terminal outcomes captured by the reply-wait path until upstream subscription-by-hash support exists.

A direct Sails submit can skip validator bootstrap only when `--idl <path>` is supplied. Without a local IDL, the wallet must query Vara.eth for the program code ID and embedded/cached interface before encoding the call.

## Claiming mailbox values safely

`vara-eth:mailbox claim` is a direct Ethereum transaction. The wallet now records
the submitted transaction, its nonce, calldata, and EIP-1559 fees locally so a
pending claim can be inspected or replaced without recreating the call by hand.

```bash
# Submit and receive the hash, nonce, gas limit, and selected EIP-1559 fees immediately.
vara-wallet --chain vara-eth --network mainnet --account alice \
  vara-eth:mailbox claim 0xMIRROR 0xCLAIMED_ID --wait submitted

# Wait for the receipt for at most 45 seconds (or choose a different bound).
vara-wallet --chain vara-eth --network mainnet --account alice \
  vara-eth:mailbox claim 0xMIRROR 0xCLAIMED_ID --timeout-ms 30000

# Recheck a locally submitted claim without signing or broadcasting anything.
vara-wallet --chain vara-eth --network mainnet \
  vara-eth:mailbox claim --resume 0xTX_HASH

# Replace a still-pending claim with the same calldata and nonce, using a fresh
# EIP-1559 quote and at least a 12.5% fee bump over the saved transaction.
vara-wallet --chain vara-eth --network mainnet --account alice \
  vara-eth:mailbox claim --replace 0xTX_HASH
```

`status: "pending"` with `code: "CLAIM_PENDING"` means the transaction has
not produced a receipt within the requested wait window; it is not proof that
the claim failed. `CLAIM_REPLACED_OR_MINED` means the account nonce advanced
without a receipt for that hash, so it was replaced externally or mined through
an unavailable RPC path. Use `--resume` first. Use `--replace` only for a saved
pending claim: it preserves the original Mirror, `claimedId`, nonce, and calldata.
A mined receipt with `ValueClaimingRequested` confirms that Mirror accepted the
claim request; `ValueClaimed` is the later co-processor completion event. Advanced
callers may set `--nonce`, `--gas`, `--max-fee-per-gas`, and
`--max-priority-fee-per-gas` explicitly; replacement fee overrides must exceed
the saved values.

## Persistent agent actions

For agents that perform several Sails calls in one run, `vara-eth:session` removes repeated process startup, connection, signer, and IDL-loading work. It accepts one JSON request per stdin line and emits one NDJSON response per request. The session keeps running after a malformed request, making it suitable for an autonomous action loop.

```bash
vara-wallet --chain vara-eth --network hoodi --account agent-eth \
  vara-eth:session <<'EOF'
{"id":"read","program":"0xMIRROR","method":"Game/State","args":[],"idl":"./game.idl"}
{"id":"act","program":"0xMIRROR","method":"Game/Move","args":["north"],"idl":"./game.idl"}
EOF
```

The session writes a `ready` record first. Queries return a decoded result. Functions use the injected path and return `status: "submitted"` with a deterministic `txHash` and `messageId` once accepted; they do not wait for execution or a program reply. Send the same `program` and `idl` values on subsequent requests to reuse the loaded interface.

Bridge / faucet links and full deployment status: see the official
gear-tech announcement channels.

## Hoodi (public testnet)

Hoodi is the primary Vara.eth public testnet, anchored to the Hoodi
Ethereum testnet. Use it for any pre-production workflow.

### Funding

1. Get Hoodi ETH from a Hoodi faucet (e.g.
   `https://faucet.hoodi.ethpandaops.io`).
2. Acquire Hoodi WVARA — bridge from Hoodi ETH via the Router contract,
   or use `vara-eth:wvara transfer` from a pre-funded account.
3. Permit / approve WVARA for the Router as needed (the
   `vara-eth:program deploy` helper signs the EIP-2612 permit
   automatically).

### Quick start

```bash
# Create a new Vara.eth wallet
vara-wallet vara-eth:wallet create alice --passphrase mypass

# Read your address's WVARA balance
vara-wallet --chain vara-eth --network hoodi \
  vara-eth:wvara balance 0xYOUR_ADDR

# Subscribe to Router events for a minute (good smoke test)
vara-wallet --chain vara-eth --network hoodi vara-eth:subscribe router
```

## Local development

Requires Anvil + an `ethexe run --dev` node on the same host.

```bash
# Terminal 1 — Anvil with a 1-second block time
anvil --block-time 1

# Terminal 2 — local ethexe node (auto-deploys Router into Anvil)
ethexe run --dev

# Terminal 3 — drive the wallet at the local stack
vara-wallet --chain vara-eth --network local \
  vara-eth:wvara balance 0xf39Fd6e51aad88F6f4ce6aB8827279cffFb92266
```

The local preset's `routerAddress` is `null`; the Anvil broadcast
artifact under `ethexe run --dev`'s working directory is used to
discover the deployed Router at runtime.

## Cross-chain note

`--network` values are per-chain — there's no shared `testnet`/`mainnet`
token between substrate (`--chain vara`) and Vara.eth (`--chain
vara-eth`). The substrate rail keeps `mainnet|testnet|local`; the
Vara.eth rail uses `mainnet|hoodi|local`. Pick the chain first via
`--chain`, then the network.

## Internal references

- Mainnet info dashboard: `https://grafana-ovh.gear-tech.io/dashboards`
  (canonical-quarantine setting: 8 blocks)
- Hoodi info dashboard: same Grafana, canonical-quarantine: 4 blocks
- libp2p bootnode + validator peer IDs aren't surfaced through the
  wallet — it speaks RPC, not gossipsub. See the ethexe node config
  if you need to peer at the network layer.
