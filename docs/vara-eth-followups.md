# Vara.eth Follow-Ups

Deferred items from the Vara.eth rail (Phase 3 finalization, plan §15 in
`research-ethexe-client-primitives-composed-hummingbird.md`). Each entry
is independently shippable — none of them block the current branch.

## 1. Upstream `MirrorClient.transferLockedValueToInheritor` in `@vara-eth/api`

**Where the gap is**: `Mirror.sol` exposes
`transferLockedValueToInheritor()`, but the JS client in
`@vara-eth/api@0.5.0-rc.0` doesn't wrap it.

**Wallet-side workaround**: `src/commands/vara-eth-inheritor.ts` uses
`signer.sendTransaction` with an inline ABI fragment. Functional but
duplicates the contract surface the lib should own.

**Fix shape**: add a method on `MirrorClient` mirroring the Solidity
signature. Wallet then drops the inline ABI and calls
`mirrorClient.transferLockedValueToInheritor()` like every other Mirror
method.

**Owner / tracking**: needs an upstream PR on `gear-tech/gear-js` once
the current PR (#2483) merges or as a follow-up `0.5.1` patch.

## 2. Live-resume for in-flight injected promises

**Where the gap is**: `api.programs.sendAndWait` is a one-shot wrapper —
it hides the lower-level `InjectedTx` primitive. Once a process dies
mid-await, there's no way to re-attach to the in-flight subscription
purely from the txHash.

**Wallet-side stub**: `vara-eth:message send --resume <txHash>` returns
`RESUME_PENDING_NOT_SUPPORTED` for `pending`-status rows; only terminal
outcomes (`resolved`/`failed`/`expired`) can be re-read post-restart.

**Fix shape**: add `api.injected.subscribeByTxHash(txHash, opts)` (or
expose `InjectedTx.attach({ txHash, ... })`) upstream. Wallet then drops
the typed-error stub and the resume path waits on the lib subscription.

**Owner / tracking**: pairs with #1 above — both are `@vara-eth/api`
follow-ups. Track in the same upstream issue.

## 3. Promise persistence for `vara-eth:program deploy`

**Where the gap is**: Step 5 wired persistence into `vara-eth:message
send` but not `vara-eth:program deploy`. The deploy ceremony has two L1
txs (`requestCodeValidation` + `createProgram*`); both should be
recorded.

**Fix shape**: mirror the `vara-eth-message.ts` persistence pattern in
`vara-eth-program.ts`. Two `injected_promises` rows per deploy. Same
typed error semantics on resume.

**Blocker / unblock**: trivially shippable today; rolled into a separate
PR after the wallet validates against live Hoodi to avoid bundling
unrelated scope.

## 4. Hostile-QA full kill/restart smoke

**Where the gap is**: the current 100-row parallel-insert unit test
proxies for the hostile case but doesn't actually kill+restart a
process between submit and reply.

**Fix shape**: a shell-driven smoke harness that forks `vara-wallet
vara-eth:message send` 100×, SIGKILLs every other one mid-flight, then
re-runs each with `--resume` and asserts every txHash is either
confirmed or recoverable from `vara-eth-promises.db`.

**Blocker / unblock**: hard-blocked by #2 (live-resume). Without
`subscribeByTxHash`, only the post-mortem flavour works.

## 5. Rename `docs/vara-eth-testnet.md` → `docs/vara-eth-networks.md`

**Where the gap is**: the doc was created as Hoodi-only in Step 3 then
expanded to cover mainnet + Hoodi + local in `2ad3663`. The filename
still says "testnet".

**Fix shape**: single `git mv` + reference updates. Skipped during the
deployment-info commit to avoid bundling a rename into a content
change.

## 6. `vara-eth:*` subcommands don't honor global `--account` / `--passphrase`

**Where the gap is**: substrate commands read `program.optsWithGlobals()`
inside their actions (see `src/commands/balance.ts:15`,
`src/commands/message.ts:76`). The Vara.eth commands skipped this
pattern — each action's `options` argument is the SUBCOMMAND-local
opts bag, so global `--account` / `--passphrase` flags don't propagate.

**Smoke-discovered symptom**: passing `--account hoodi-smoke` (in any
position) had no effect; the resolver always fell back to
`config.defaultAccount`. Workaround during the Hoodi smoke was to set
`defaultAccount` in config + use `VARA_PASSPHRASE` env var.

**Fix shape**: every `.action((arg1, arg2, options) => …)` in the
seven `vara-eth-*.ts` files becomes
`.action((arg1, arg2, options, cmd) => { const globals =
cmd.optsWithGlobals(); … })`. Then merge globals over local options
before calling `resolveEthexeSigner`.

**Blocker / unblock**: not blocking — env-var + config-default
workaround works. Worth a focused commit since it's mechanical and
affects every write-side Vara.eth command.

## 7. ABIs / canonical-quarantine settings exposure

**Where the gap is**: the network presets carry RPC + Router + WVARA
but not the `canonical-quarantine` block depth (mainnet: 8, hoodi: 4).
The wallet doesn't currently need it, but anything reading on-chain
state past the head should.

**Fix shape**: add `canonicalQuarantineBlocks?: number` to
`VaraEthNetworkConfig`; surface it in any future `vara-eth:state read`
deep-history flag. No call site needs it today.

**Blocker / unblock**: not blocking; record it here so the registry
keeps growing in the right direction.
