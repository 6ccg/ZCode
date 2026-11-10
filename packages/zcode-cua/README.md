# @zcode/zcode-cua

This public package provides contracts and an adapter for fixed bundled Computer
Use components. Vendor JS/native files stay outside the public checkout.

## Distribution

The build tool in `scripts/bundled-cua.mjs` extracts pinned official 3.17.2/CUA
0.6.5 components, applies versioned adaptations and prepares a private bundle.
Builds select it with `ZCODE_CUA_BUNDLE_DIR`. The application discovers its shipped
runtime under `resources/tools/zcode-cua`; users need no environment variables,
post-install patches or component downloads.

The adapters in `scripts/cua-runtime-adapter/` are maintained by this project
against the current public contracts and official component version. The build
requires the official archive and this checkout; no external patch repository,
old tag, vendor template or installer is needed.

CUA has no independent updater. Upgrade the complete application to replace its
components. Missing bundled helpers fail explicitly; helper download paths are
disabled. The existing local Host owns the native process and the authority used
by admitted clients. Settings and normal OS privacy permissions still apply.

Windows x64 uses the official Electron 44.7.0 helper. Component acquisition/build
checks and native UI acceptance are separate checks; see `specs/bundled-computer-use.md`.

Run deterministic tests: `pnpm --filter @zcode/zcode-cua test:source`.
Without a private payload, `zcodeCuaPlaceholder` remains true and real calls stay
unavailable. The experimental independent AX backend has been removed.
License for this source package: Apache-2.0.
