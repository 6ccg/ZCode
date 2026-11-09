# @zcode/zcode-cua

Without an explicit backend, Computer Use remains unavailable/fail-closed.
This source package has two separate opt-in integrations. Neither has completed
native acceptance on this fork.

## Windows external runtime bridge

On Windows, supply the existing complete JavaScript runtime using the absolute
`ZCODE_CUA_RUNTIME_PACKAGE_DIR`, plus a matching helper through
`ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR` (or the existing `ZCODE_CUA_DEV_ROOT`).
The desktop host keeps process ownership; the supplied runtime retains broker,
session, observation and frame behavior. The original Windows connection policy
is unchanged. No vendor code or native binaries are committed here.

Packaging requires both inputs. It stages the JavaScript runtime to
`resources/tools/zcode-cua`, validates the helper separately and stages Sharp at
the CUA plugin root. Missing or incompatible inputs fail the relevant build/CUA
operation. They do not establish native compatibility or redistribution rights.

The inspected helper declares Electron 41.0.3 while this tree targets 44.7.0.
The version gate remains closed pending real Windows addon, startup, screenshot,
input and shutdown testing. Node-API incompatibility has **not** been established.
See `specs/windows-external-runtime-bridge.md` and
`specs/prebuilt-computer-use-helper.md` for boundaries and validation.

## Experimental macOS AX backend

An **independently written macOS accessibility backend** is selected by
`ZCODE_CUA_SOURCE_BACKEND=macos-ax` with the Computer Use plugin enabled.
It uses existing API-key providers; no official account or downloaded helper.

Supported: application inventory, foreground AX observation, AX set value and
advertised AX actions, with local consent on every call. Observe again after each
action. Protected controls and permission applications are excluded.

Unsupported: screenshots, mouse coordinates, keyboard, clipboard, background
control, specific window selection, Windows/Linux and feature parity with the
official runtime. Never use this experimental backend for unattended actions or
multiple simultaneous hosts; controller arbitration is in-process only.

The native dialog can change foreground focus. The adapter never forces focus
back; it fails closed instead. Stable AX identity across subprocesses is not
proven; full-snapshot comparison is only a stale-tree check. A real macOS ARM
acceptance run is required before treating the backend as usable in production.

Run deterministic tests: `pnpm --filter @zcode/zcode-cua test:source`.
See `specs/source-computer-use.md` for native acceptance cases.

Official macOS helper installation, signature and launcher integration remain
unavailable. `zcodeCuaPlaceholder` stays true; a narrower `windowsBroker` capability
controls the explicit Windows bridge without enabling macOS helper packaging.
License for this source package: Apache-2.0.
