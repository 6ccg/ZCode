# @zcode/zcode-cua

Default behavior remains unavailable/fail-closed. This package also contains an
**experimental, independently written macOS accessibility backend** selected by
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

Official broker/helper installation, signature, PiP and image-frame surfaces
remain placeholders. `zcodeCuaPlaceholder` intentionally continues to prevent
packaging an unavailable official helper. No extracted proprietary vendor or
native binaries are bundled. License: Apache-2.0.
