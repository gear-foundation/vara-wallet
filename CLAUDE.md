# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.


# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

vara-wallet is an agentic CLI wallet for Vara Network (Gear Protocol blockchain). It's designed for AI coding agents to interact with on-chain programs — deploying, calling, monitoring, and managing wallets. Built with Commander.js, @gear-js/api, and Sails framework bindings.

## Commands

```bash
npm run build          # rm -rf dist && tsc
npm test               # Jest test suite
npm start              # Run compiled CLI (dist/app.js)
npm run dev            # Run via ts-node (development)
npm run clean          # Remove dist/
```

Run a single test file:
```bash
npx jest src/__tests__/units.test.ts
```

## Architecture

**Entry point:** `src/app.ts` — registers all commands via Commander.js, initializes polkadot crypto, handles graceful shutdown.

**Three layers:**

1. **Commands** (`src/commands/`) — Each file exports a `registerXxxCommand(program)` function. Commands parse CLI args, resolve accounts, call services, and format output. Subscribe commands live in `src/commands/subscribe/` with shared patterns in `shared.ts`.

2. **Services** (`src/services/`) — Core logic:
   - `api.ts` — Lazy GearApi singleton (WebSocket or smoldot light client)
   - `account.ts` — Account resolution chain: `--seed` → `VARA_SEED` → `--mnemonic` → `VARA_MNEMONIC` → `--account` (wallet file) → config default
   - `wallet-store.ts` — Encrypted wallet files at `~/.vara-wallet/wallets/` (xsalsa20-poly1305, file mode 0o600)
   - `tx-executor.ts` — Sign, submit, wait for block inclusion, extract events (60s timeout)
   - `event-store.ts` — SQLite persistence via better-sqlite3 (`~/.vara-wallet/events.db`, WAL mode, 7-day auto-prune)
   - `sails.ts` — IDL loading (local file or meta-storage URL) and typed Sails method invocation
   - `light-client.ts` — SmoldotProvider implementing PolkadotJS ProviderInterface
   - `config.ts` — `~/.vara-wallet/config.json` management

3. **Utils** (`src/utils/`) — Output formatting (auto-detect JSON vs human from TTY), error sanitization (strips seeds/mnemonics from messages), VARA↔minimal unit conversion (12 decimals).

**Key patterns:**
- Output mode auto-detection: JSON if stdout is non-TTY, human-readable if TTY. Override with `--json`/`--human`.
- Errors always output as JSON to stderr with semantic error codes (CONNECTION_FAILED, TX_TIMEOUT, WALLET_NOT_FOUND, etc.).
- Sails auto-detects query (free, read-only) vs function (costs gas, needs account).
- NDJSON streaming for subscribe/watch commands.

## Testing

Tests are in `src/__tests__/` using Jest + ts-jest. Tests cover utils and services (wallet-store, errors, output, units, keystore). No E2E tests against live blockchain — all tests are offline/unit.

## Key Dependencies

- `@gear-js/api` + `@polkadot/api` — Blockchain interaction
- `sails-js` + `sails-js-parser` — Typed program interfaces via IDL
- `better-sqlite3` — Event persistence
- `smoldot` — Custom build from github.com/gear-foundation/smoldot-gear for embedded light client
- `commander` — CLI framework

## VARA Units

1 VARA = 10^12 minimal units (12 decimals). Use `varaToMinimal()`/`minimalToVara()` from `src/utils/units.ts`.
