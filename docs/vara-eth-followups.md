# Vara.eth Follow-Ups

Deferred items from the `0.20.0` Vara.eth rail. Items listed here are not
blockers for the current branch; they are operational parity or upstream
cleanup work.

## Shipped in 0.20.0

- `vara-eth:*` subcommands honor global `--account` and `--passphrase`.
- `reply.code` serializes as `{ tag, raw, reason }`.
- `MessageRevertedError` from `@vara-eth/api@0.6.0-rc.0` surfaces as
  `MESSAGE_REVERTED` with `reason` and `functionName`.
- `vara-eth:message send` exposes `--no-validate-signature` for injected-path
  diagnostics.
- The networks guide now covers mainnet, Hoodi, and local as
  `docs/vara-eth-networks.md`.
- Transaction-only workflows expose `--wait submitted`. Direct Ethereum and
  WVARA writes avoid the validator connection, while injected submit-only sends
  call `injected_sendTransaction` without opening a receipt subscription.

## Remaining Work

### 1. Upstream `MirrorClient.transferLockedValueToInheritor`

`Mirror.sol` exposes `transferLockedValueToInheritor()`, but the wallet still
uses a small ABI shim in `vara-eth:inheritor recover`. Add the wrapper to
`@vara-eth/api`, then replace the wallet shim with the typed client method.

### 2. Live resume for pending injected promises

`vara-eth:message send --resume <txHash>` can reread terminal cached outcomes,
but cannot reattach to a still-pending injected promise. This needs upstream
support such as `api.injected.subscribeByTxHash(txHash, opts)` or an
`InjectedTx.attach({ txHash })` API.

### 3. Promise persistence for `vara-eth:program deploy`

Message sends persist injected-tx audit rows today. Program deploy has a longer
ceremony (`requestCodeValidation` plus `createProgram*`) and should record both
L1 transactions so deploy recovery matches message recovery.

### 4. Hostile kill/restart smoke

Add a live smoke harness that starts multiple `vara-eth:message send`
processes, kills some mid-flight, and verifies each transaction is confirmed or
recoverable. This is blocked on live pending-promise resume.

### 5. Owned-balance top-up parity

`vara-wallet` exposes executable balance top-up. Gear `ethexe-cli` also has an
owned-balance top-up path; add the wallet command only if that flow is needed by
end users rather than node operators.

### 6. Hoodi injected-path validator recovery

The direct L1 write path (`--via eth`) is the safe default and has been verified
on Hoodi. The injected path still needs a time-boxed upstream check of validator
set freshness and signature recovery under Hoodi's canonical-quarantine depth.

### 7. Canonical-quarantine metadata

Mainnet uses 8 blocks and Hoodi uses 4. The wallet does not consume this today,
but future state/history reads should thread `canonicalQuarantineBlocks` through
the Vara.eth network config before exposing deep-history behavior.
