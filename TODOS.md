# TODOS

## Light client integration into vara-wallet

**What:** After smoldot fork validation succeeds, integrate the forked smoldot into vara-wallet with `--light` flag, `ScProvider`, and bundled chain spec.

**Why:** Enables trustless, decentralized chain access from the CLI without depending on centralized RPC infrastructure. Currently vara-wallet requires a WebSocket connection to a full node (`wss://rpc.vara.network`).

**Pros:** True decentralization for balance queries, extrinsic submission, event streaming. No single point of failure. Works offline after initial sync.

**Cons:** 10-30s initial sync latency per CLI invocation. Gear-specific RPC methods (gas calculation, `readState`) won't work through light client — commands like `message send` would require manual `--gas-limit`. Maintenance burden of keeping the smoldot fork in sync with upstream.

**Context:**
- `GearApi.create({ provider })` already accepts any `ProviderInterface` — no fork of @gear-js/api needed
- `ScProvider` from `@polkadot/rpc-provider/substrate-connect` wraps smoldot and implements `ProviderInterface`
- Files to modify: `src/services/api.ts` (provider selection), `src/services/config.ts` (add `lightClient` field), `src/app.ts` (add `--light`, `--chain-spec` flags), all 17 command files (update `getApi()` call signature), new `src/services/light-client.ts`
- Chain specs needed: mainnet (`wss://rpc.vara.network`) and testnet (`wss://testnet.vara.network`), fetched via `sync_state_genSyncSpec`
- Commands that won't work with light client: anything using `gear_calculateGasForHandle`, `gear_calculateReplyForHandle`, `gear_readState` — these are custom Gear RPC methods not available in smoldot

**Depends on / blocked by:** Successful smoldot fork validation (this PR).

---

## Fix smoldot legacy JSON-RPC subscription for Vara

**What:** `chain_getFinalizedHead` and `state_getStorage` never respond via smoldot's legacy JSON-RPC API when connected to Vara Network, even though the runtime compiles and `state_getMetadata` works.

**Why:** The JSON-RPC background task's `RuntimeServiceSubscription` state machine gets stuck. After an initial `StorageQueryError` during runtime download (which auto-retries and succeeds), the subscription never transitions to `Active` state. The `chain_getFinalizedHead` request sits in `pending_get_finalized_head` queue forever, and `state_getStorage`/`state_getKeysPaged` requests block on `BlockHashNotKnown` which requires the subscription to be active.

**Pros:** Enables balance queries and full state access through the light client. Without this, only metadata and new head subscriptions work.

**Cons:** Requires deep understanding of smoldot's runtime_service.rs and json_rpc_service/background.rs state machines. May be a pre-existing upstream smoldot bug.

**Context:**
- Root cause: `RuntimeServiceSubscription` state machine in `light-base/src/json_rpc_service/background.rs` (lines 603-654)
- The subscription depends on `runtime_service.subscribe_all()` which gates on `finalized_block_known = true` (runtime_service.rs lines 879-887)
- Alternative: Use smoldot's new JSON-RPC API (`chainHead_v1_*` methods) instead of legacy API — this bypasses the broken state machine entirely
- Debug log shows: `runtime-download-error` with `StorageQueryError { errors: [] }`, then successful retry 15s later, but subscription never activates
- Key files: `light-base/src/json_rpc_service/background.rs`, `light-base/src/runtime_service.rs`

**Depends on / blocked by:** Nothing — can be worked on independently.

---

## Smoldot fork validation results

**Completed 2026-03-17.** Fork at `/tmp/smoldot-vara-fork` with 32 Gear host function stubs.

| Test | Result |
|------|--------|
| addChain | PASS |
| system_chain | PASS — "Vara Network" |
| chain_getFinalizedHead | FAIL — smoldot subscription bug |
| state_getMetadata | **PASS — 291 KB** |
| state_getStorage | FAIL — depends on finalized subscription |
| chain_subscribeNewHeads | PASS — live blocks |
| extrinsic encoding | PASS — feasible |

**Files modified in smoldot fork:**
- `lib/src/executor/host/functions.rs` — 32 host function stubs with correct signatures
- `lib/src/executor/host.rs` — Dispatch match arms returning safe defaults
