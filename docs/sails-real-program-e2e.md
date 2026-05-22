# Sails Real Program E2E

This document is the manual end-to-end test for a real Sails program through
`vara-wallet`. It has two purposes:

1. Prove the current wallet can build, deploy, discover, and call a Sails
   program on the native Vara/Substrate rail.
2. Reuse the same program as the acceptance fixture for Vara.eth Sails deploy,
   discover, query, and write flows.

The native rail flow remains manual because it needs a local Gear node,
Rust/Sails toolchain, and signing account with test funds. The Vara.eth flow has
an opt-in live harness for Hoodi or a local ethexe stack.

## Current Support Boundary

Working today on `--chain vara`:

- Build a real Sails program.
- Deploy with `program upload --idl --init --args`.
- Discover services with `discover`.
- Execute query methods with `call`.
- Execute function methods with `call`, including `--dry-run`, `--estimate`,
  gas calculation, reply decoding, and event decoding.

Working today on `--chain vara-eth`:

- Root `program upload` / `program deploy` parity for Vara.eth.
- Sails IDL constructor encoding for `vara-eth:program deploy`.
- Sails-aware `discover` without connecting to Substrate RPC.
- Sails-aware `call` for queries and functions on a Mirror address.

Still outside this test's supported surface on `--chain vara-eth`:

- Full event and mailbox Sails decode parity.

## Fixture Program

Use one small mutable Sails program. The ideal fixture has:

- one constructor;
- one read-only query;
- one state-changing function;
- one emitted event from that function;
- one optional payable function, if the program template supports it.

The generated Sails template is enough if it has a query and function. If the
template names differ from the examples below, run `discover` after deployment
and update the `QUERY_METHOD` / `WRITE_METHOD` variables.

Scaffold outside this repo:

```bash
export RUST_TOOLCHAIN=nightly-2025-10-20
export SAILS_E2E=/tmp/vara-wallet-sails-e2e

/Users/ukintvs/Documents/projects/gear-skills/skills/sails-new-program/scripts/check_toolchain.sh
/Users/ukintvs/Documents/projects/gear-skills/skills/sails-new-program/scripts/create_sails_program.sh \
  "$SAILS_E2E" \
  --name wallet_e2e_counter
```

Build and test the program:

```bash
cd "$SAILS_E2E"
cargo "+$RUST_TOOLCHAIN" test
cargo "+$RUST_TOOLCHAIN" build --release
```

Locate the generated artifacts:

```bash
export WASM="$(find "$SAILS_E2E/target" -name '*.opt.wasm' -o -name '*.wasm' | sort | tail -1)"
export IDL="$(find "$SAILS_E2E" -name '*.idl' | sort | tail -1)"

test -n "$WASM" && test -f "$WASM"
test -n "$IDL" && test -f "$IDL"
printf 'WASM=%s\nIDL=%s\n' "$WASM" "$IDL"
```

Set the methods. These are intentionally variables because generated Sails
templates and hand-written programs may use different service names:

```bash
export CTOR=New
export CTOR_ARGS='[]'
export QUERY_METHOD='Counter/Value'
export QUERY_ARGS='[]'
export WRITE_METHOD='Counter/Increment'
export WRITE_ARGS='[]'
```

If constructor auto-selection works for the chosen IDL, omit `--init "$CTOR"`.
If the IDL has multiple constructors, keep `CTOR` explicit.

## Wallet Build

From `vara-wallet`:

```bash
cd /Users/ukintvs/Documents/projects/vara-wallet
npm run build
node dist/app.js --json --help >/dev/null
```

## Native Vara E2E

Start a local Gear/Vara node in another terminal. The wallet assumes local RPC
at `ws://127.0.0.1:9944` when `--network local` is used.

Then run the wallet flow with a dev seed:

```bash
export WALLET="node dist/app.js --json --network local --seed //Alice"
export SALT="0x$(openssl rand -hex 32)"
```

Preview constructor encoding without signing or network submission:

```bash
node dist/app.js --json --network local \
  program upload "$WASM" \
  --idl "$IDL" \
  --init "$CTOR" \
  --args "$CTOR_ARGS" \
  --dry-run
```

Deploy the real program:

```bash
UPLOAD_JSON="$($WALLET program upload "$WASM" \
  --idl "$IDL" \
  --init "$CTOR" \
  --args "$CTOR_ARGS" \
  --salt "$SALT")"

printf '%s\n' "$UPLOAD_JSON" | jq .
export PROGRAM_ID="$(printf '%s\n' "$UPLOAD_JSON" | jq -r .programId)"
export CODE_ID="$(printf '%s\n' "$UPLOAD_JSON" | jq -r .codeId)"

test "$PROGRAM_ID" != "null"
test "$CODE_ID" != "null"
```

Verify the program is on-chain:

```bash
node dist/app.js --json --network local program info "$PROGRAM_ID" | jq .
```

Discover the Sails interface:

```bash
node dist/app.js --json --network local \
  discover "$PROGRAM_ID" \
  --idl "$IDL" | tee /tmp/vara-wallet-sails-discover.json | jq .
```

If `QUERY_METHOD` or `WRITE_METHOD` was guessed incorrectly, read
`/tmp/vara-wallet-sails-discover.json`, set the correct method names, and
continue.

Run the query dry-run. This proves Sails payload encoding without a signer:

```bash
node dist/app.js --json --network local \
  call "$PROGRAM_ID" "$QUERY_METHOD" \
  --idl "$IDL" \
  --args "$QUERY_ARGS" \
  --dry-run | jq .
```

Run the real query:

```bash
QUERY_BEFORE_JSON="$(node dist/app.js --json --network local \
  call "$PROGRAM_ID" "$QUERY_METHOD" \
  --idl "$IDL" \
  --args "$QUERY_ARGS")"

printf '%s\n' "$QUERY_BEFORE_JSON" | jq .
```

Preview the state-changing call and estimate gas:

```bash
$WALLET call "$PROGRAM_ID" "$WRITE_METHOD" \
  --idl "$IDL" \
  --args "$WRITE_ARGS" \
  --dry-run \
  --estimate | jq .
```

Submit the state-changing call:

```bash
WRITE_JSON="$($WALLET call "$PROGRAM_ID" "$WRITE_METHOD" \
  --idl "$IDL" \
  --args "$WRITE_ARGS")"

printf '%s\n' "$WRITE_JSON" | jq .
export MESSAGE_ID="$(printf '%s\n' "$WRITE_JSON" | jq -r '.messageId // empty')"
```

Assert the reply decoded and the transaction landed:

```bash
printf '%s\n' "$WRITE_JSON" | jq -e '.txHash and .blockHash and .result'
```

Run the query again and compare with the first result:

```bash
QUERY_AFTER_JSON="$(node dist/app.js --json --network local \
  call "$PROGRAM_ID" "$QUERY_METHOD" \
  --idl "$IDL" \
  --args "$QUERY_ARGS")"

printf '%s\n' "$QUERY_AFTER_JSON" | jq .
```

Acceptance for the native Vara rail:

- `UPLOAD_JSON.programId` and `UPLOAD_JSON.codeId` are non-null.
- `program info` returns `exists: true`.
- `discover` lists the fixture service.
- query dry-run returns an `encodedPayload`.
- write dry-run plus estimate returns `encodedPayload` and `estimateGas`.
- real write returns `txHash`, `blockHash`, `messageId`, and decoded `result`.
- the final query reflects the write.

## Vara.eth Live E2E

Use the same `WASM`, `IDL`, constructor, query, and write method variables.
This section is opt-in because it needs a funded Vara.eth wallet and live RPC
access. The public testnet preset is `hoodi`; use `local` only with a running
local ethexe stack and router discovery configured.

Preflight the funded Hoodi account:

```bash
node dist/app.js --chain vara-eth --network hoodi --json \
  --account hoodi-smoke \
  balance | jq .

export HOODI_SMOKE_ADDRESS="$(node dist/app.js --chain vara-eth --network hoodi --json \
  vara-eth:wallet show hoodi-smoke | jq -r .address)"

node dist/app.js --chain vara-eth --network hoodi --json \
  vara-eth:wvara balance "$HOODI_SMOKE_ADDRESS" | jq .
```

Run the scripted harness. It skips unless `VARA_ETH_SAILS_E2E=1` is set, and
fails early with structured prerequisite diagnostics when artifacts or wallet
settings are missing:

```bash
export VARA_ETH_SAILS_E2E=1
export VARA_ETH_E2E_NETWORK=hoodi
export VARA_ETH_E2E_ACCOUNT=hoodi-smoke
export VARA_ETH_E2E_WASM="$WASM"
export VARA_ETH_E2E_IDL="$IDL"
export VARA_ETH_E2E_CTOR="$CTOR"
export VARA_ETH_E2E_CTOR_ARGS="$CTOR_ARGS"
export VARA_ETH_E2E_QUERY="$QUERY_METHOD"
export VARA_ETH_E2E_QUERY_ARGS="$QUERY_ARGS"
export VARA_ETH_E2E_WRITE="$WRITE_METHOD"
export VARA_ETH_E2E_WRITE_ARGS="$WRITE_ARGS"
export VARA_ETH_E2E_SALT="$SALT"

npm run build
npm run test:vara-eth-sails:e2e
```

The same flow can be run manually with root commands:

```bash
ETH_UPLOAD_JSON="$(node dist/app.js --chain vara-eth --network hoodi --json \
  --account hoodi-smoke \
  program upload "$WASM" \
  --idl "$IDL" \
  --init "$CTOR" \
  --args "$CTOR_ARGS" \
  --salt "$SALT")"

printf '%s\n' "$ETH_UPLOAD_JSON" | jq .
export MIRROR_ADDRESS="$(printf '%s\n' "$ETH_UPLOAD_JSON" | jq -r '.programAddress // .mirror // .programId')"
```

```bash
node dist/app.js --chain vara-eth --network hoodi --json \
  program info "$MIRROR_ADDRESS" | jq .
```

```bash
node dist/app.js --chain vara-eth --network hoodi --json \
  discover "$MIRROR_ADDRESS" \
  --idl "$IDL" | jq .
```

```bash
node dist/app.js --chain vara-eth --network hoodi --json \
  call "$MIRROR_ADDRESS" "$QUERY_METHOD" \
  --idl "$IDL" \
  --args "$QUERY_ARGS" | jq .
```

```bash
ETH_WRITE_JSON="$(node dist/app.js --chain vara-eth --network hoodi --json \
  --account hoodi-smoke \
  call "$MIRROR_ADDRESS" "$WRITE_METHOD" \
  --idl "$IDL" \
  --args "$WRITE_ARGS" \
  --via eth)"

printf '%s\n' "$ETH_WRITE_JSON" | jq .
```

Acceptance for Vara.eth support:

- root `program upload` routes to Vara.eth when `--chain vara-eth` is set;
- constructor payload is encoded from `--idl --init --args`;
- deploy output includes `programAddress`, `codeId`, L1 transaction hashes, and
  init status;
- `program deploy <codeId>` creates from validated code and can send the same
  optional init message;
- if deployment succeeds but init fails, output includes `programAddress`,
  `codeId`, deploy tx hashes, and init error data before exiting nonzero;
- `discover --idl` works against the supplied IDL and does not require a
  Substrate Gear RPC; without `--idl`, Vara.eth uses cache or embedded `sails:idl`
  from original code bytes;
- `call --dry-run` returns the same Sails `encodedPayload` as the native rail;
- `call --estimate` returns `api.fees.estimate({ type: 'sendMessage' })` data for
  function calls;
- query calls return decoded Sails results;
- function calls submit via `--via eth` or `--via injected`, wait for the reply,
  and return decoded reply/result data;
- errors are typed by stable `code` and `reason`, not by English text.
