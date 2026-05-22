# TODOs

## Vara.eth deploy persistence/resume hardening
**Priority:** P2 | **Effort:** M (human ~2 days / CC ~45 min)

Persist multi-transaction Vara.eth deploy ceremonies so interrupted code
validation, create, and init-message phases can be resumed or audited after
process restart. Current recovery JSON covers deploy-success/init-failure, but
does not provide durable resume state.

## Vara.eth Sails event, reply, and mailbox decode parity
**Priority:** P2 | **Effort:** M (human ~2 days / CC ~45 min)

Extend Vara.eth Sails decoding beyond root `discover` and `call` into event
streams, mailbox-like surfaces, and richer reply/error payloads so the JSON
shape matches native Vara where the rail semantics allow it.

## Vara.eth owned-balance top-up parity
**Priority:** P3 | **Effort:** M (human ~1 day / CC ~30 min)

Add the owned-balance top-up flow exposed by upstream ethexe tooling. Keep
`program top-up` focused on executable balance until the owner-balance semantics
and output shape are explicit.

## Vara.eth injected-path stabilization diagnostics
**Priority:** P3 | **Effort:** S (human ~0.5 day / CC ~15 min)

Stabilize the injected send path on Hoodi and add a diagnostic
`--no-validate-signature` flag for controlled validator-signature triage.
Do not enable the diagnostic by default.

## Program list --owner filter
**Priority:** P3 | **Effort:** M (human ~2 days / CC ~30 min)

Add `--owner <address>` filter to `program list` to find programs deployed by a specific
account. Requires an indexer-backed endpoint for server-side filtering; client-side filtering
would be O(n) RPC calls on mainnet. Deferred from the v0.9.0 DX audit.

**Depends on:** Indexer support for program ownership queries.

## Full payload codec system
**Priority:** P3 | **Effort:** L (human ~2 weeks / CC ~2 hours)

Auto-detect payload type (SCALE-encoded, UTF-8 text, raw binary) and pretty-print
with optional IDL context. Every payload surface in the CLI would intelligently render
content based on detected type, with `--format` flags for output control.

**Context:** Currently the CLI supports hex payloads, ASCII text via `--payload-ascii`
and `tryHexToText`, and IDL-based constructor encoding via `--idl`/`--init`/`--args`
on `program upload`/`deploy` (added in v0.8.0). The remaining scope is SCALE decoding
of program responses with IDL context, which would let agents read structured replies
without external tooling. Sails-JS v1.0.0-beta.2 exposes high-level v2 decoders
(`decodeCall`, `decodeReply`, `decodeError`, `decodeEvent`, `decodeCtor`) that should
be evaluated as the foundation for this feature instead of hand-rolling payload
routing.

**Depends on:** ASCII payload support (completed). Constructor encoding (completed v0.8.0).

## Voucher auto-discovery
**Priority:** P3 | **Effort:** S (human ~1 day / CC ~15 min)

Add `--voucher auto` mode that queries `api.voucher.getAllForAccount()` and selects the
best available voucher for the target program. Falls back to explicit `--voucher <id>` if
multiple vouchers match or none exist. Also consider `VARA_VOUCHER_ID` env var for agent
workflows.

**Context:** v0.6.0 added explicit `--voucher <id>` to all write commands. Auto-discovery
would complete the sponsored execution UX by removing the need to copy-paste voucher IDs.

**Depends on:** `--voucher` flag support (completed v0.6.0).
