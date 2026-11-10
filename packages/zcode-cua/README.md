# @zcode/zcode-cua

Computer Use component interfaces and runtime loading for ZCode. The public
package owns the contracts; private JavaScript and native binaries are supplied
at build time and included in the application distribution.

## Build and runtime

`scripts/bundled-cua.mjs` assembles the versioned component bundle. Select it with
`ZCODE_CUA_BUNDLE_DIR` when building the desktop app. The installed application
loads its runtime from `resources/tools/zcode-cua` and its helper from
`resources/tools/cua-helper`.

The local Host owns the native process and authenticates admitted clients.
Computer Use is off by default and can be enabled in settings, subject to normal
OS permissions. Components are updated with the complete application; a missing
component produces an error rather than a download.

The supported bundle target is Windows x64. Without the private payload,
`zcodeCuaPlaceholder` remains true and native capabilities are unavailable.

See [component specification](../../specs/bundled-computer-use.md) for versions,
build commands and validation. Run contract tests with
`pnpm --filter @zcode/zcode-cua test:source`.

This public package uses Apache-2.0. Private component rights and bridge notices
are described in [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md#bundled-windows-computer-use).
