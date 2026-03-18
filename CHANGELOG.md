# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-03-18

### Added
- Subscribe command with SQLite event persistence for monitoring on-chain events
- Block numbers and readable values to CLI outputs

### Fixed
- Message send to user wallet failing with TX_FAILED
- Read CLI version from package.json instead of hardcoded string

## [0.2.0] - 2026-03-17

### Added
- Embedded light client (smoldot) for trustless chain access
- Accept both hex and SS58 addresses as CLI arguments

### Fixed
- Use normalized hex address in voucher revoke output
- Message send accepts any destination, not just programs

## [0.1.2] - 2026-03-17

### Fixed
- Resolve @polkadot/util duplicate version warnings

## [0.1.1] - 2026-03-17

### Fixed
- Don't use passphrase on unencrypted wallet

## [0.1.0] - 2026-03-17

### Added
- Initial release of vara-wallet CLI
- Wallet management (create, import, list, info)
- Token transfers and balance queries
- Program deployment and message sending
- Voucher management
- Mailbox operations
- Sails IDL-based service interaction
