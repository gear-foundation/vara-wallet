# Vara.eth Integration Report

Status: current on branch `vs/ethexe-rail-v1` for the `0.20.0` release train.

## Summary

`vara-wallet` now drives Vara.eth as a first-class chain through
`--chain vara-eth`. The native Vara/Substrate rail remains the default
(`--chain vara`). Vara.eth supports mainnet, Hoodi, and local presets, with
read paths verified on mainnet and Hoodi and the direct L1 write path verified
on Hoodi.

The primary user-facing UX is root-command parity where possible:

```bash
vara-wallet --chain vara-eth --network hoodi program upload ./program.opt.wasm --idl ./program.idl --args '[]'
vara-wallet --chain vara-eth --network hoodi discover 0xMIRROR --idl ./program.idl
vara-wallet --chain vara-eth --network hoodi call 0xMIRROR Service/Query --args '[]' --idl ./program.idl
```

Rail-specific workflows remain available under `vara-eth:*`:

- `vara-eth:wallet create|import|list|show|keys`
- `vara-eth:message send|reply`
- `vara-eth:program deploy|top-up`
- `vara-eth:state read`
- `vara-eth:mailbox claim`
- `vara-eth:subscribe program|router|blocks`
- `vara-eth:wvara balance|transfer|approve|permit`
- `vara-eth:inheritor recover`
- `vara-eth:validators add|remove|list`

## Current Capabilities

- V3 Ethereum keystores live at
  `~/.vara-wallet/wallets/<name>.vara-eth.json`.
- Network presets are `mainnet`, `hoodi`, and `local`; Hoodi is the public
  Vara.eth testnet.
- `@vara-eth/api@0.5.0-rc.1` is vendored through
  `vendor/vara-eth-api-0.5.0-rc.1.tgz`.
- `vara-eth:message send` supports `--via eth` and `--via injected`; prefer
  `--via eth` for production writes until injected-path validator recovery is
  fully triaged.
- `--no-validate-signature` exists only for injected-path diagnostics.
- `reply.code` output is structured as `{ tag, raw, reason }`.
- Vara.eth typed errors flow through stable JSON codes such as
  `MESSAGE_REVERTED`, `PROMISE_TIMEOUT`, `CHAIN_ID_MISMATCH`, and
  `TRANSPORT_ERROR`.

## Verification

Local verification on this branch:

- Full Jest suite: 78 suites / 839 tests passing.
- `npm run build` passes.
- `npm run test:smoke` passes.
- Manual local Gear/Sails smoke deployed a demo Sails program, discovered it,
  queried `Demo/GetCounter`, submitted `Demo/Increment`, and verified the
  counter changed from `0` to `1`.

Live read verification:

- Mainnet and Hoodi WVARA balance reads work through the configured Ethereum
  and Vara.eth RPCs.
- Hoodi `vara-eth:state read` works against deployed Mirrors.
- Hoodi DEX/VFT read-only checks on the native Vara rail continue to work for
  built-in bridged token aliases.

Live write verification on Hoodi:

- Direct L1 WVARA approval succeeded.
- Direct L1 message sends against deployed Mirrors succeeded and returned
  decoded replies.
- Permit-backed `program top-up` succeeded without a separate manual approval.

See `docs/sails-real-program-e2e.md` for the reusable Sails fixture flow.

## Network Presets

| Network | Ethereum RPC | Vara.eth RPC | Router | WVARA |
|---|---|---|---|---|
| `mainnet` | `wss://mainnet-reth-rpc.gear-tech.io/ws` | `wss://validator-1-eth.vara.network` | `0x9C13FE9242dfe2ba2Cd446480A9308279aA74cb6` | `0xB67010F2246814e5c39593ac23A925D9e9d7E5aD` |
| `hoodi` | `wss://hoodi-reth-rpc.gear-tech.io/ws` | `wss://vara-eth-validator-1.gear-tech.io` | `0xE549b0AfEdA978271FF7E712232B9F7f39A0b060` | `0xE1ab85A8B4d5d5B6af0bbD0203EB322DF33d0464` |
| `local` | `ws://127.0.0.1:8545` | `ws://127.0.0.1:9944` | discovered at runtime | Router-bound |

Mainnet and Hoodi also define beacon RPCs for EIP-7594 blob lookups during code
upload. Full endpoint details live in `docs/vara-eth-networks.md`.

## Gear `ethexe-cli` Parity

`vara-wallet` is feature-complete for core Vara.eth end-user flows:

- deploy/top-up a program,
- send and reply to messages,
- read state,
- claim mailbox values,
- manage WVARA,
- recover inheritor-locked value,
- stream Router, Mirror, and block events.

It is intentionally not a node-operator replacement for Gear `ethexe-cli`.
Commands such as `run`, `key`, and `check` remain Gear node responsibilities.

Remaining gaps are operational rather than structural:

- owned-balance top-up parity,
- deploy persistence across restarts,
- live resume for pending injected promises,
- injected-path validator-signature recovery triage.

The actionable backlog is tracked in `docs/vara-eth-followups.md`.
